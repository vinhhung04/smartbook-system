import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, envFile, createEnvironment, testEnvironment } from './environment.mjs';
import { runMandatoryDatabaseTests } from './mandatory-db.mjs';
import { startAi } from './ai-startup.mjs';
import { runRedactedCommand } from './redacted-command.mjs';

const action = process.argv[2];
if (action === 'setup') {
  const env = createEnvironment();
  console.log(`Created isolated project ${env.COMPOSE_PROJECT_NAME}; secrets stored only under .git.`);
  process.exit(0);
}
const env = testEnvironment();
const reports = resolve(root, 'test-results/qa');
mkdirSync(reports, { recursive: true });
function run(command, args, extraEnv = {}, redactOutput = false) {
  if (command === 'pnpm') {
    if (!process.env.npm_execpath) throw new Error('Run through pnpm test:stack so its CLI path is available.');
    args = [process.env.npm_execpath, ...args]; command = process.execPath;
  }
  const options = { cwd: root, env: { ...env, ...extraEnv } };
  const result = redactOutput ? runRedactedCommand(command, args, options)
    : spawnSync(command, args, { ...options, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error?.code})`);
}
const compose = (...args) => run('docker', ['compose', ...args]);
try {
  if (action === 'up') compose('up', '-d', '--build', '--wait', '--wait-timeout', '300');
  else if (action === 'up-ai') startAi(compose);
  else if (action === 'contracts') run('pnpm', ['-r', '--filter', 'inventory-service', '--filter', 'analytics-service', 'test:contract']);
  else if (action === 'ai-db') {
    // Keep the legacy action on the same guarded owner-before-test path.
    runMandatoryDatabaseTests(env);
  }
  else if (action === 'seed') {
    for (const service of ['demo-seed-auth', 'demo-seed-inventory', 'demo-seed-borrow']) {
      compose('--profile', 'demo', 'run', '--rm', '--build', service);
    }
  } else if (action === 'smoke') run('pnpm', ['test:smoke']);
  else if (action === 'flow') {
    const name = process.argv[3];
    if (!/^[a-z0-9-]+\.mjs$/.test(name || '')) throw new Error('Expected an integration script filename');
    run(process.execPath, [resolve(root, 'scripts', name)]);
  }
  else if (action === 'integration') run(process.execPath, ['scripts/testing/run-integration.mjs']);
  else if (action === 'db') {
    runMandatoryDatabaseTests(env);
  } else if (action === 'e2e') {
    const simulator = spawn(process.execPath, ['scripts/vnpay-simulator.mjs'], { cwd: root, env, stdio: 'inherit' });
    try {
      // Wait for readiness, never a fixed delay in lieu of a state check.
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try { await fetch('http://localhost:18099/'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
      }
      if (!ready) throw new Error('VNPay simulator did not start.');
        run('pnpm', ['--filter', 'web', 'test:e2e', ...process.argv.slice(3), '--retries=0', '--trace=off'], { BASE_URL: env.PLAYWRIGHT_BASE_URL, CI: '1' }, true);
    } finally { simulator.kill(); }
  } else if (action === 'logs') compose('logs', '--no-color', '--tail=300');
  else if (action === 'stop') compose('--profile', 'ai', '--profile', 'demo', 'stop');
  else if (action === 'down') {
    compose('--profile', 'ai', '--profile', 'demo', 'down', '-v', '--remove-orphans');
    unlinkSync(envFile);
  } else throw new Error('Usage: pnpm test:stack setup|up|seed|db|integration|smoke|e2e|logs|down');
  writeFileSync(resolve(reports, `${action}.json`), JSON.stringify({ action, status: 'PASS', timestamp: new Date().toISOString() }, null, 2));
} catch (error) {
  writeFileSync(resolve(reports, `${action}.json`), JSON.stringify({ action, status: 'FAIL', message: error.message }, null, 2));
  console.error(error.message); process.exitCode = 1;
}
