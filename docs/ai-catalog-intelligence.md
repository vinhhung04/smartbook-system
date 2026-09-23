# AI Catalog Intelligence

## Flow

1. Web calls AI Service `POST /isbn-intelligence` or `POST /enrich-book-after-isbn`.
2. AI Service gathers ISBN provider evidence and asks Inventory Service to normalize catalog authorities through its internal authenticated endpoint.
3. Web creates a reconciliation draft, reviews individual fields, then applies only `ACCEPTED` fields.
4. Web checks duplicate intelligence before creating or linking an edition/variant.

No endpoint in this flow merges, deletes, or reassigns an existing variant. Stock balances, loans, reservations, purchase orders, invoices, and audit history remain attached to their original variant.

## Evidence-grounded metadata intelligence v2

The optional v2 pipeline makes book metadata proposals traceable from a source
snapshot to the field the reviewer accepts. It is intentionally a proposal
workflow: catalog data changes only after the existing reconciliation review
and apply flow completes.

Enable it in AI Service with `ENABLE_METADATA_INTELLIGENCE_V2=true`. It is
disabled by default so existing ISBN lookup and enrichment clients retain their
current behaviour.

`POST /metadata-intelligence/extract` accepts one input form at a time:

```json
{ "input": { "isbn": "9786041234567" } }
```

```json
{ "input": { "html": "<article>...</article>", "sourceUrl": "https://publisher.example/book" } }
```

```json
{ "input": { "text": "Title: ...", "sourceUrl": "pasted-catalogue" } }
```

The endpoint reuses Inventory catalog authorization before processing. A
`sourceUrl` is a display label only; the service never fetches an arbitrary URL
from this endpoint. HTML and text are bounded in size and treated as untrusted
source data.

For JSON/API, JSON-LD, and labelled text, the rule extractor creates direct or
rule-derived candidates. Qwen is used only for incomplete HTML/text documents.
It must return a literal quote for every proposed field; the service resolves
that quote to a Unicode `[start, end)` span in the cleaned snapshot and rejects
unsupported output. The model has no tools and cannot apply catalog changes.

The response contains `documents`, `candidates`, `evidence`, `decisions`, and
`provenance` alongside the compatibility projection used by the current import
screen. Candidate origins are `SOURCE_DIRECT`, `RULE_EXTRACTED`, or
`LLM_EXTRACTED`. Any LLM transformation remains a suggestion; an accepted human
value records a review event and an edited value records `HUMAN_EDITED` with its
before/after values.

Before fusion, ISBN-10/13 values are checksummed and canonicalized. Candidates
from a conflicting or rejected edition cannot enter factual fusion. Field
fusion then normalizes values, de-duplicates non-independent snapshots, keeps
alternatives, and calculates an explainable heuristic confidence. Conflicts,
unverified editions, and confidence below `0.80` require review. Dates retain
their original year/month/day precision; they are never made into a fictional
full date.

The pipeline limits each run to five source documents, at most three Qwen
documents, two chunks per Qwen document, and a 60-second total budget. A
timeout returns its validated partial result with warnings. The evaluation
harness and annotation protocol are in
`services/ai-service/eval/metadata_intelligence/`; it supports B1--B5 and the
three planned ablations against frozen source snapshots.

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
python -m unittest discover # from services/ai-service
pnpm --dir apps/web lint
pnpm --dir apps/web build
```
