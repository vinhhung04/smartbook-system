import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, envFile, createEnvironment, testEnvironment } from './environment.mjs';

const action = process.argv[2];
if (action === 'setup') {
  const env = createEnvironment();
  console.log(`Created isolated project ${env.COMPOSE_PROJECT_NAME}; secrets stored only under .git.`);
  process.exit(0);
}
const env = testEnvironment();
const reports = resolve(root, 'test-results/qa');
mkdirSync(reports, { recursive: true });
function run(command, args, extraEnv = {}) {
  if (command === 'pnpm') {
    if (!process.env.npm_execpath) throw new Error('Run through pnpm test:stack so its CLI path is available.');
    args = [process.env.npm_execpath, ...args]; command = process.execPath;
  }
  const result = spawnSync(command, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error?.code})`);
}
const compose = (...args) => run('docker', ['compose', ...args]);
try {
  if (action === 'up') compose('up', '-d', '--build', '--wait', '--wait-timeout', '300');
  else if (action === 'up-ai') compose('--profile', 'ai', 'up', '-d', '--build', '--wait', '--wait-timeout', '300', 'ai-service');
  else if (action === 'contracts') run('pnpm', ['-r', '--filter', 'inventory-service', '--filter', 'analytics-service', 'test:contract']);
  else if (action === 'ai-db') {
    compose('exec', '-T', 'db', 'psql', '-U', env.DB_USER, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE qa_ai_test');
    run('python', ['-m', 'pytest', 'services/ai-service/test_pgvector_store.py', 'services/ai-service/test_agent_store_pg.py', '-q', '--junitxml=test-results/qa/ai-postgres.xml'], {
      TEST_PG_DSN: `postgresql+asyncpg://${env.DB_USER}:${env.DB_PASSWORD}@127.0.0.1:15432/qa_ai_test`,
    });
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
    const url = `postgresql://${env.DB_USER}:${env.DB_PASSWORD}@127.0.0.1:15432/borrow_db?schema=public`;
    // exec node bypasses borrow-service's pretest hook. Docker-generated clients
    // live in the image, so a clean host needs its own matching client first.
    run('pnpm', ['--filter', 'borrow-service', 'prisma:generate'], { DATABASE_URL: url });
    run('pnpm', ['--filter', 'borrow-service', 'exec', 'node', '--test', '--test-reporter=tap', 'test/deposit.db.test.js', 'test/vnpay-topup.db.test.js', 'test/reservation-idempotency.db.test.js'], {
      DEPOSIT_TEST_DATABASE_URL: url, BORROW_TEST_DATABASE_URL: url,
    });
    run('pnpm', ['--filter', 'analytics-service', 'exec', 'node', '--test', '--test-reporter=tap', 'test/borrow-trends-timezone.test.js'], {
      ANALYTICS_TEST_PG_URL: url,
    });
  } else if (action === 'e2e') {
    const simulator = spawn(process.execPath, ['scripts/vnpay-simulator.mjs'], { cwd: root, env, stdio: 'inherit' });
    try {
      // Wait for readiness, never a fixed delay in lieu of a state check.
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try { await fetch('http://localhost:18099/'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
      }
      if (!ready) throw new Error('VNPay simulator did not start.');
      run('pnpm', ['--filter', 'web', 'test:e2e', ...process.argv.slice(3)], { BASE_URL: env.PLAYWRIGHT_BASE_URL, CI: '1' });
    } finally { simulator.kill(); }
  } else if (action === 'logs') compose('logs', '--no-color', '--tail=300');
  else if (action === 'down') {
    compose('--profile', 'ai', '--profile', 'demo', 'down', '-v', '--remove-orphans');
    unlinkSync(envFile);
  } else throw new Error('Usage: pnpm test:stack setup|up|seed|db|integration|smoke|e2e|logs|down');
  writeFileSync(resolve(reports, `${action}.json`), JSON.stringify({ action, status: 'PASS', timestamp: new Date().toISOString() }, null, 2));
} catch (error) {
  writeFileSync(resolve(reports, `${action}.json`), JSON.stringify({ action, status: 'FAIL', message: error.message }, null, 2));
  console.error(error.message); process.exitCode = 1;
}
