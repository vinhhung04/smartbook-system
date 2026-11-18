# SmartBook testing

Use the existing pnpm workspace and Python environment. No new test framework is required.

## Offline quality gate

```sh
pnpm install --frozen-lockfile
python -m pip install -r services/ai-service/requirements.txt pytest
pnpm verify
```

`verify` runs lint, TypeScript, web/mobile builds, workspace/web/mobile/Node/Python tests and Expo configuration. Database suites intentionally report SKIPPED here; execute them below. The inventory JSON is an index of source tests, not measured line/branch coverage or execution evidence.

## Disposable database and service tests

Requires Docker Compose 2.24.4+ (`!override`), a primary checkout with a `.git` directory, and available loopback ports 13000, 15173, 15432, 15673, 15674, 18025 and 18099.

```sh
pnpm test:stack setup
pnpm test:stack up
pnpm test:stack up-ai
pnpm test:stack seed
pnpm test:stack db
pnpm test:stack contracts
pnpm test:stack ai-db
pnpm test:stack integration
pnpm test:stack smoke
pnpm test:stack down
```

Always execute `down`, including after a failure. It removes only the generated `smartbook-qa-*` project, including optional AI containers and its volumes. `setup` refuses to overwrite an existing environment. Secrets are generated under `.git/qa-testing/test.env`, never in the developer's `.env` or report artifacts. The auth seed and E2E helpers accept the generated `DEMO_PASSWORD`; normal demo defaults remain available outside QA. The runner rejects another Compose configuration, non-loopback gateway or paid provider credentials.

The integration manifest schedules all offline `*-integration.mjs` scripts and two assertion-based reconciliation/scope audits. `ai-assistant-integration.mjs` and `cover-search-integration.mjs` are live-model checks, outside deterministic CI; their provider boundaries are exercised by Python tests and controlled Playwright fixtures instead. Do not enable paid providers in QA. `copilot-3-2-security-integration.mjs` runs its default security checks without the optional `--ai` model calls.

`test:stack db` first generates the host borrow Prisma Client (the Docker client stays inside its image), then executes all three borrow PostgreSQL suites with real migrations, wallet ledger constraints and concurrent transactions, followed by the three analytics Vietnam-time bucket tests against session-local temporary tables. `ai-db` needs Python `asyncpg`, SQLAlchemy and pgvector (already in AI requirements) and a fresh QA project. CI's dedicated AI job supplies its own isolated Postgres/pgvector service.

## Browser tests on a separate clean project

Do not reuse the integration job's mutated database for browser assertions.

```sh
pnpm --filter web exec playwright install chromium
pnpm test:stack setup
pnpm test:stack up
pnpm test:stack seed
pnpm test:stack e2e
pnpm test:stack down
```

For an offline local machine with Microsoft Edge installed, set `PLAYWRIGHT_CHANNEL=msedge` in that shell; CI continues to install Chromium. `e2e` starts the local VNPay simulator, enables staff OTP against Mailpit and exports HTML, JSON, JUnit, screenshots and traces. It never uses VNPay merchant credentials. Browser database fixtures require `SMARTBOOK_TEST_ISOLATED=1`, which the runner supplies.

To debug one flow use `pnpm test:stack flow <script-name.mjs>`, or `pnpm test:stack e2e <file.spec.ts>`. CI always uses the unfiltered manifest/full Playwright suite. Logs and result files live under `test-results/qa/` and `apps/web/{test-results,playwright-report}/`; secrets stay outside those paths.

## CI and branch protection

`ci.yml` covers push and PR **targets** `main`, `hungg`, `khoa`, and manual dispatch. Keep all eight status checks required on `khoa`: Full workspace verification; Integration flows (Docker); E2E flows (Playwright); AI integration (Postgres + pgvector); Prisma schema (auth-service); Prisma schema (inventory-service); Prisma schema (borrow-service); docker-compose config validation.

Branch protection is a GitHub setting, not enabled by this YAML. Configure it separately after approval, also requiring a PR review and rejecting force pushes. This task does not publish changes, dispatch an uncommitted workflow, change protection or edit production deployment workflows.

Implementation references: [Docker Compose environment selection](https://docs.docker.com/compose/how-tos/environment-variables/envvars/), [Compose port overrides](https://docs.docker.com/reference/compose-file/merge/), [Playwright reporters](https://playwright.dev/docs/test-reporters). Revocation uses fractional NumericDate timestamps permitted by [RFC 7519 §2](https://www.rfc-editor.org/rfc/rfc7519.html#section-2); [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) accepts an explicit `iat` while deriving expiration.
