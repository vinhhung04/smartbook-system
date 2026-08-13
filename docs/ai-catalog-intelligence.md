# AI Catalog Intelligence

## Flow

1. Web calls AI Service `POST /isbn-intelligence` or `POST /enrich-book-after-isbn`.
2. AI Service gathers ISBN provider evidence and asks Inventory Service to normalize catalog authorities through its internal authenticated endpoint.
3. Web creates a reconciliation draft, reviews individual fields, then applies only `ACCEPTED` fields.
4. Web checks duplicate intelligence before creating or linking an edition/variant.

No endpoint in this flow merges, deletes, or reassigns an existing variant. Stock balances, loans, reservations, purchase orders, invoices, and audit history remain attached to their original variant.

## Public staff APIs

All Inventory APIs require a bearer token. Read operations require `inventory.catalog.read` or `inventory.catalog.write`; review and apply operations also require the manager role and `inventory.catalog.write`.

- `POST /api/metadata-reconciliations` creates a draft from `{ isbn, lookup, aiSuggestions?, bookId? }`.
- `GET /api/metadata-reconciliations/:id` loads a draft and its per-field decisions.
- `PATCH /api/metadata-reconciliations/:id/fields/:field` accepts `{ status: ACCEPTED|REJECTED, value? }`.
- `POST /api/metadata-reconciliations/:id/apply` accepts `{ bookId, createEntities? }`. Only accepted fields are applied in one transaction. `createEntities` must explicitly opt in to new `authors`, `publisher`, or `categories`.
- `POST /api/duplicate-intelligence/check` accepts `{ normalizedMetadata }`.
- `GET /api/duplicate-intelligence/reviews/:id` loads a duplicate review.
- `PATCH /api/duplicate-intelligence/reviews/:id` accepts one of `LINK_EXISTING_VARIANT`, `CREATE_VARIANT_FOR_EDITION`, `CREATE_NEW_EDITION`, `CREATE_NEW_TITLE`, or `DISMISS_WARNING`.

The internal `POST /internal/authority/normalize` endpoint is for AI Service only and requires `X-Internal-Service-Key`.

## Authority policy

- Exact canonical names and `APPROVED` aliases are `AUTO_MATCH`.
- Similar values are `REVIEW_REQUIRED`; unmatched values are `NEW_ENTITY`.
- New entities are never auto-created. A manager must accept the field and explicitly choose Create new entity.
- Display-name variants of an accepted canonical author/publisher become `PENDING` alias candidates; they are not automatically approved.

## Development database migration

PostgreSQL must have `pg_trgm` installed before applying the initial migration because the schema creates trigram indexes:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

The migration `20260809020000_add_location_coordinates_and_pick_sequence` is a development recovery shim because its original SQL was absent from repository history. It is safe for a freshly reset development database and deliberately has no schema delta in the current datamodel.

Do not run this recovery path against an existing production database that already recorded a different checksum. Recover the original migration SQL from the production release artifact first.

## Verification

```powershell
pnpm --dir services/inventory-service exec prisma migrate status --schema prisma/schema.prisma
node --test services/inventory-service/test/authority-normalization.test.js services/inventory-service/test/duplicate-intelligence.test.js
python -m unittest test_enrich_book_after_isbn.py # from services/ai-service
pnpm --dir apps/web lint
pnpm --dir apps/web build
```
