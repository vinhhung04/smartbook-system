import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { parse } from 'dotenv';

export const root = resolve(import.meta.dirname, '../..');
export const stateDir = resolve(root, '.git/qa-testing');
export const envFile = resolve(stateDir, 'test.env');
const composeFiles = [resolve(root, 'docker-compose.yml'), resolve(root, 'docker-compose.test.yml')].join(delimiter);
const qaSmtp = Object.freeze({
  SMTP_HOST: 'mailpit', SMTP_PORT: '1025', SMTP_USER: '', SMTP_PASS: '',
  SMTP_FROM: 'syntheticqa@example.invalid',
});

export function assertIsolated(values) {
  if (!/^smartbook-qa-[a-f0-9]{8}$/.test(values.COMPOSE_PROJECT_NAME) || values.SMARTBOOK_TEST_ISOLATED !== '1') {
    throw new Error('Refusing to operate on an unrecognised Compose project.');
  }
  if (values.COMPOSE_FILE !== composeFiles || values.COMPOSE_ENV_FILES !== envFile || values.DB_HOST !== 'db') {
    throw new Error('Only the generated QA Compose files and database host are permitted.');
  }
  if (values.GATEWAY_URL !== 'http://localhost:13000' || values.OPENROUTER_API_KEY || values.GOOGLE_BOOKS_API_KEY) {
    throw new Error('QA must use the loopback gateway and no paid provider credentials.');
  }
  if (Object.entries(qaSmtp).some(([key, value]) => values[key] !== value)) {
    throw new Error('QA mail must use the isolated Mailpit receiver without provider credentials.');
  }
}

export function createEnvironment() {
  mkdirSync(stateDir, { recursive: true });
  if (existsSync(envFile)) throw new Error('Test environment exists; use stack down before generating another.');
  const secret = () => randomBytes(36).toString('base64url');
  const fixturePassword = secret();
  let template = readFileSync(resolve(root, '.env.example'), 'utf8');
  for (const placeholder of new Set(template.match(/GENERATE_[A-Z_]+/g))) {
    template = template.replaceAll(placeholder, secret());
  }
  const values = {
    ...parse(template),
    COMPOSE_PROJECT_NAME: `smartbook-qa-${randomBytes(4).toString('hex')}`,
    COMPOSE_FILE: composeFiles,
    COMPOSE_ENV_FILES: envFile,
    WEB_API_ORIGIN: 'http://localhost:13000', WEB_WS_ORIGIN: 'ws://localhost:13000',
    BASE_URL: 'http://localhost:13000', GATEWAY_URL: 'http://localhost:13000',
    PLAYWRIGHT_BASE_URL: 'http://localhost:15173', MAILPIT_URL: 'http://localhost:18025',
    RABBITMQ_MANAGEMENT_URL: 'http://localhost:15673',
    ALLOWED_ORIGINS: 'http://localhost:15173', SOCKET_CORS_ORIGIN: 'http://localhost:15173',
    FRONTEND_URL: 'http://localhost:15173',
    AUTH_LOGIN_RATE_LIMIT_MAX: '5000', AUTH_OTP_VERIFY_RATE_LIMIT_MAX: '1000',
    AUTH_OTP_RESEND_RATE_LIMIT_MAX: '1000', GATEWAY_RATE_LIMIT_MAX: '50000',
    STAFF_EMAIL_OTP_MODE: 'optional', E2E_STAFF_OTP: '1',
    DEMO_PASSWORD: fixturePassword, PURCHASE_TEST_PASSWORD: fixturePassword,
    SUPPLIER_TEST_PASSWORD: fixturePassword, ADMIN_PASSWORD: fixturePassword,
    ANALYTICS_TEST_PASSWORD: fixturePassword, ASSISTANT_TEST_PASSWORD: fixturePassword,
    OPENROUTER_API_KEY: '', GOOGLE_BOOKS_API_KEY: '', ENABLE_NIGHTLY_BRIEFING: 'false',
    VNPAY_HASH_SECRET: secret(), VNPAY_TMN_CODE: randomBytes(4).toString('hex'),
    VNPAY_PAYMENT_URL: 'http://localhost:18099/paymentv2/vpcpay.html',
    VNPAY_RETURN_URL: 'http://localhost:13000/webhooks/vnpay/return',
    VNPAY_SIMULATOR_PORT: '18099', VNPAY_SIMULATOR: '1',
    SMARTBOOK_TEST_ISOLATED: '1',
    ...qaSmtp,
  };
  // Secrets stay under .git and are never uploaded as test artifacts.
  writeFileSync(envFile, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  return values;
}

export function testEnvironment() {
  const values = parse(readFileSync(envFile, 'utf8'));
  return buildTestEnvironment(values);
}

export function buildTestEnvironment(values, inherited = process.env) {
  // Do not inherit developer .env values, database URLs or paid provider keys.
  const env = { ...inherited, ...values, DOTENV_CONFIG_PATH: envFile };
  // Older private QA env files have no SMTP settings. Normalize after the merge
  // without rewriting them, and remove unknown provider-specific SMTP options.
  for (const key of Object.keys(env)) if (/^SMTP_/i.test(key)) delete env[key];
  Object.assign(env, qaSmtp);
  assertIsolated(env);
  env.RABBITMQ_URL = `amqp://${values.RABBITMQ_USER}:${values.RABBITMQ_PASSWORD}@localhost:15674`;
  delete env.DATABASE_URL;
  delete env.DEPOSIT_TEST_DATABASE_URL;
  delete env.BORROW_TEST_DATABASE_URL;
  delete env.TEST_PG_DSN;
  delete env.ANALYTICS_TEST_PG_URL;
  delete env.BORROW_POLICY_DATABASE_URL;
  delete env.INVENTORY_AUDIT_TEST_DATABASE_URL;
  delete env.AUTH_AUDIT_DATABASE_URL;
  delete env.BORROW_AUDIT_PRISMA_CLIENT;
  delete env.INVENTORY_AUDIT_PRISMA_CLIENT;
  delete env.AUTH_AUDIT_PRISMA_CLIENT;
  delete env.VNPAY_SANDBOX;
  delete env.E2E_LIVE_BOOK_SOURCES;
  return env;
}
