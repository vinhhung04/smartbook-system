import { spawnSync } from 'node:child_process';
import { sanitizeText, qaSecretValues } from './sanitize-artifacts.mjs';

export function sanitizeCapturedStreams(result, secrets = []) {
  // A truncated password or token may not match a complete-value redactor.
  if (result.error || result.signal) return { stdout: '', stderr: '[REDACTED] Child output unavailable or incomplete.\n' };
  return { stdout: sanitizeText(result.stdout || '', secrets), stderr: sanitizeText(result.stderr || '', secrets) };
}

// Capture both streams before writing anything: arbitrary OS chunks can split a
// JWT or password. Raw browser errors must never reach hosted CI console logs.
export function runRedactedCommand(command, args, options, output = process) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', windowsHide: true,
    maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const safe = sanitizeCapturedStreams(result, qaSecretValues(options.env || process.env));
  output.stdout.write(safe.stdout);
  output.stderr.write(safe.stderr);
  return { status: result.status, signal: result.signal,
    error: result.error ? { code: result.error.code } : undefined };
}
