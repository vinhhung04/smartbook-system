import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';

const root = resolve(import.meta.dirname, '../../..');
const auth = createRequire(resolve(root, 'services/auth-service/package.json'));

test('PRA21: installed Nodemailer bounds the maintainer address-parser regression input', async () => {
  const parser = auth.resolve('nodemailer/lib/addressparser');
  // Maintainer GHSA-v53p-9fqp-m79j input; isolate CPU work so a vulnerable parser
  // cannot block the test runner or a service. No SMTP traffic occurs here.
  const child = spawn(process.execPath, ['-e', `
    const parse=require(${JSON.stringify(parser)});
    process.send('ready');
    process.once('message',()=>{parse(' >'+'[x]'.repeat(40000));process.disconnect();});
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let timer, timedOut = false, stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = new Promise((yes, no) => {
    child.once('error', no);
    child.once('exit', code => { clearTimeout(timer); yes(code); });
  });
  child.once('message', () => {
    timer = setTimeout(() => { timedOut = true; child.kill(); }, 3000);
    child.send('parse');
  });
  const startup = setTimeout(() => child.kill(), 10000);
  try {
    assert.equal(await exit, 0, timedOut ? 'address parser exceeded isolated 3s CPU budget' : stderr);
    assert.equal(timedOut, false);
  } finally { clearTimeout(startup); child.kill(); }
});

test('PRA21: real SMTP transport preserves all service mailers and recipient refusal reporting', async () => {
  const sessions = new Set(), messages = [];
  const server = net.createServer(socket => {
    sessions.add(socket); socket.once('close', () => sessions.delete(socket));
    socket.setEncoding('utf8'); socket.write('220 localhost synthetic SMTP\r\n');
    let buffer = '', data = false, lines = [], recipient = '';
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            messages.push({ recipient, body: lines.join('\r\n') });
            data = false; lines = []; socket.write('250 queued locally\r\n');
          } else lines.push(line);
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH /.test(line)) socket.write('235 authenticated synthetic user\r\n');
        else if (/^MAIL FROM:/.test(line)) socket.write('250 sender accepted\r\n');
        else if (/^RCPT TO:/.test(line)) {
          recipient = line;
          socket.write(line.includes('reject@example.invalid') ? '550 recipient rejected\r\n' : '250 recipient accepted\r\n');
        } else if (line === 'DATA') { data = true; socket.write('354 end with dot\r\n'); }
        else if (line === 'QUIT') socket.end('221 goodbye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const envKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port),
    SMTP_USER: 'synthetic', SMTP_PASS: 'synthetic', SMTP_FROM: 'proof@example.invalid' });
  try {
    const authMailer = auth('./src/lib/email-sender.js');
    const inventory = createRequire(resolve(root, 'services/inventory-service/package.json'))('./src/lib/email-sender.js');
    const borrow = createRequire(resolve(root, 'services/borrow-service/package.json'))('./src/lib/email-sender.js');
    await authMailer.deliverEmail('accept@example.invalid', 'EMAIL_OTP', { code: '123456', purpose: 'login', full_name: 'Synthetic' });
    assert.equal((await inventory.sendMail({ to: 'accept@example.invalid', subject: 'Synthetic', text: 'local only' })).ok, true);
    assert.equal(await borrow.sendEmail('accept@example.invalid', 'FINE_CREATED', { amount: '1', customer_name: 'Synthetic' }), true);
    assert.equal(messages.length, 3);
    assert.ok(messages.every(message => message.recipient.includes('accept@example.invalid')));
    await assert.rejects(authMailer.deliverEmail('reject@example.invalid', 'EMAIL_OTP', { code: '123456' }));
    assert.equal((await inventory.sendMail({ to: 'reject@example.invalid', subject: 'Synthetic', text: 'local only' })).ok, false);
    assert.equal(await borrow.sendEmail('reject@example.invalid', 'FINE_CREATED', {}), false);
    assert.equal(messages.length, 3, 'rejected recipients never receive DATA');
  } finally {
    for (const key of envKeys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    for (const socket of sessions) socket.destroy();
    await new Promise(done => server.close(done));
  }
});
