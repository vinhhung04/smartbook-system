import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function caddyImage(root) {
  const compose = readFileSync(resolve(root, 'compose.prod.yml'), 'utf8');
  if (!/^  caddy:\s*\r?\n\s+image:\s*[^\r\n]*CADDY_IMAGE/m.test(compose)) throw new Error('Production Caddy digest override required');
  const image = process.env.SMARTBOOK_TEST_CADDY_IMAGE;
  if (!/^smartbook-qa-caddy:[a-f0-9]{40}$/.test(image || '')) throw new Error('Explicit locally built source-SHA Caddy image required for runtime verification');
  return image;
}

export function borrowTestImage(root) {
  let project = process.env.COMPOSE_PROJECT_NAME;
  const env = resolve(root, '.git/qa-testing/test.env');
  if (!project && existsSync(env)) project = readFileSync(env, 'utf8').match(/^COMPOSE_PROJECT_NAME=(smartbook-qa-[a-f0-9]{8})\r?$/m)?.[1];
  if (!/^smartbook-qa-[a-f0-9]{8}$/.test(project || '')) throw new Error('Verified isolated QA project required for the Node upstream test image');
  return `${project}-borrow-service:latest`;
}
