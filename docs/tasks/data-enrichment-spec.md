# Spec: SmartBook comprehensive demo data

## Objective

Enrich the idempotent Prisma demo seeds so a clean SmartBook environment contains coherent, realistic Vietnamese-library data in every supported business area. The data must make catalog, inventory, supplier, customer, borrowing, fine, wallet, notification, and audit screens demonstrable without manual setup.

## Assumptions

1. The target is local/demo data only; production data and schemas must not change.
2. Existing identifiers, demo accounts, golden-flow records, and credentials must remain valid.
3. Rerunning `pnpm demo:seed` must be safe and must not duplicate records.
4. “All data” means every entity currently seeded by the authentication, inventory, and borrow services, not unimplemented schema tables with no application flow.

## Commands

- Seed: `pnpm demo:seed`
- Node tests: `pnpm test:node`
- Workspace checks: `pnpm test:workspace-config`
- Full verification when Docker and Python dependencies are available: `pnpm verify`

## Project Structure

- `services/auth-service/prisma/seed.js`: users, roles, scopes, audit records.
- `services/inventory-service/prisma/seed.js`: catalog, warehouses, locations, stock, suppliers, and purchasing/fulfilment data.
- `services/borrow-service/prisma/seed.js`: memberships, customers, loans, payments, notifications, and reader activity.
- `tests/`: seed source/contract checks when database-backed verification is unavailable.

## Code Style

Use deterministic business keys and Prisma `upsert`/`createMany({ skipDuplicates: true })` patterns already used by the seeds.

```js
await prisma.customers.upsert({
  where: { customer_code: 'CUST-EXT-001' },
  update: {},
  create: { customer_code: 'CUST-EXT-001', full_name: '...', status: 'ACTIVE' },
});
```

## Testing Strategy

- Add source-level checks for the new dataset's deterministic identifiers and representative lifecycle states.
- Run service Node tests and workspace configuration tests.
- Run the demo seed against Docker services when the local stack is available.

## Boundaries

- Always: preserve idempotence and cross-service foreign-key references; use realistic fictional personal data.
- Ask first: schema migrations, new dependencies, modifying application behavior, or replacing existing demo accounts.
- Never: seed secrets, use real personal data, or modify production databases.

## Success Criteria

- Authentication includes operational users across every canonical role and warehouse scope.
- Inventory includes richer Vietnamese and international catalog records plus active/inactive and low-stock examples, supplier associations, and operational documents in representative statuses.
- Borrowing includes varied customer profiles, plans, reservations, loan/item states, fines/payments, wallets, alerts, reviews, and notifications.
- Data remains internally consistent and safe to seed repeatedly.

## Out of Scope

- Database schema changes, external data scraping/importing, production data, and UI changes.
