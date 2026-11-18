import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function sanitizeText(text, secrets = []) {
  let output = String(text).replace(/postgres(?:ql)?(?:\+asyncpg)?:\/\/[^\s"'<>]+/g, '[REDACTED_DSN]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/(authorization["']?\s*[:=]\s*["']?Bearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]');
  for (const secret of [...new Set(secrets)].filter(value => value && value.length >= 8).sort((a, b) => b.length - a.length)) {
    output = output.replaceAll(secret, '[REDACTED_QA_SECRET]');
  }
  return output;
}

export function qaSecretValues(environment) {
  return Object.entries(environment).filter(([key]) => /PASSWORD|SECRET|TOKEN|(?:^|_)KEY$/i.test(key)).map(([, value]) => value);
}

export function sanitizeArtifacts(root) {
  const values = { ...process.env };
  const environment = resolve(root, '.git/qa-testing/test.env');
  if (existsSync(environment)) for (const line of readFileSync(environment, 'utf8').split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  const secrets = qaSecretValues(values);
  const input = resolve(root, 'test-results/qa');
  const output = resolve(input, 'safe-artifacts');
  mkdirSync(output, { recursive: true });
  const copy = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (file === output) continue;
      if (entry.isDirectory()) copy(file);
      else if (/\.(?:log|tap|json|xml)$/.test(entry.name)) {
        const destination = resolve(output, relative(input, file));
        mkdirSync(resolve(destination, '..'), { recursive: true });
        writeFileSync(destination, sanitizeText(readFileSync(file, 'utf8'), secrets));
      }
    }
  };
  if (existsSync(input)) copy(input);
  // Raw Playwright HTML/zip/traces/storageState are never upload inputs. Only
  // a bounded summary is copied from its JSON report, without errors/attachments.
  const browserReport = resolve(root, 'apps/web/test-results/results.json');
  if (existsSync(browserReport)) {
    const report = JSON.parse(readFileSync(browserReport, 'utf8'));
    writeFileSync(resolve(output, 'browser-summary.json'), JSON.stringify({ stats: report.stats }, null, 2));
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sanitizeArtifacts(resolve(import.meta.dirname, '../..'));
}
