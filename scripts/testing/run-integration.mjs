import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, testEnvironment } from './environment.mjs';

const env = testEnvironment();
const flows = JSON.parse(readFileSync(new URL('./integration-flows.json', import.meta.url), 'utf8'));
const output = resolve(root, 'test-results/qa/integration');
mkdirSync(output, { recursive: true });
const results = [];
for (const flow of flows) {
  if (!/^[a-z0-9-]+\.mjs$/.test(flow)) throw new Error(`Invalid manifest entry: ${flow}`);
  console.log(`Running ${flow}`);
  const start = Date.now();
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', flow)], {
    cwd: root, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  });
  const log = `${result.stdout || ''}\n${result.stderr || ''}`;
  writeFileSync(resolve(output, `${flow}.log`), log);
  const status = result.status === 0 && !result.error ? 'PASS' : 'FAIL';
  results.push({ flow, status, exitCode: result.status, durationMs: Date.now() - start, error: result.error?.code });
  console.log(`${status} ${flow}`);
  if (status === 'FAIL') console.error(log.slice(-5000));
}
writeFileSync(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(`${results.filter(r => r.status === 'PASS').length}/${results.length} integration flows passed`);
if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
