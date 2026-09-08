# E2E tests (Playwright)

Golden-path UI tests, driven through the real browser against a running SmartBook stack —
these click through the app the way a person would, complementing the API-level flow
scripts in `../../scripts/*.mjs`.

## Run locally

1. Bring up the core stack and seed demo data (see root `README.md` → 🐳 Chạy Project Bằng
   Docker). You need at least: `db`, `redis`, `auth-service`, `inventory-service`,
   `borrow-service`, `analytics-service`, `api-gateway`.
2. Start the web app's dev server on port 5173 (`pnpm --filter web dev`), or point
   `BASE_URL` at wherever it's running.
3. First run only: `npx playwright install --with-deps chromium` (downloads the browser
   binary Playwright drives — not the same as any browser already on your machine).
4. From `apps/web`: `pnpm test:e2e`

```powershell
pnpm demo:env
docker compose up -d --build db redis auth-service inventory-service borrow-service analytics-service api-gateway
pnpm demo:seed
pnpm --filter web dev  # separate terminal, leave running
cd apps/web
npx playwright install --with-deps chromium  # first run only
pnpm test:e2e
```

## What's covered

- `auth.spec.ts` — staff and customer login reach the right app; a wrong password is
  rejected without a redirect.
- `reservation-pickup-loan-return.spec.ts` — the core library flow end to end: customer
  reserves a book → staff confirms → staff marks it ready for pickup (pickup code issued)
  → staff converts the pickup code to a loan at the counter → staff returns the loan.
  Runs as two browser contexts (customer + staff) in one test.

## Notes

- These tests create real data against whatever stack `BASE_URL` points at — don't run
  them against a shared/demo environment other people are using.
- The reservation flow needs at least one book with available stock; `pnpm demo:seed`
  provides that. If every book has been reserved out by repeated local runs, re-seed
  (`pnpm demo:seed` is idempotent, or reset the volumes for a fully clean slate).
- Login attempts are rate-limited server-side (`AUTH_LOGIN_RATE_LIMIT_MAX` in `auth-service`,
  default 10 per 15 minutes per IP). Repeated local test runs in a short window can trip it —
  CI raises this limit for its own run; do the same locally (`AUTH_LOGIN_RATE_LIMIT_MAX=1000`
  in `.env`, then restart `auth-service`) if you're iterating quickly.
