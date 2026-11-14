# Plan: SmartBook comprehensive demo data

## Approach

1. Map existing seed keys and schemas, then extend records without disturbing the established golden flows.
2. Enrich authentication first so user IDs are available to downstream operational records.
3. Enrich inventory master and transactional data next, retaining deterministic catalog and warehouse keys for borrow references.
4. Enrich borrowing data with lifecycle-complete records that reference available catalog/warehouse keys.
5. Add lightweight seed-contract tests and run the available verification commands.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Cross-service IDs diverge | Reuse the existing service boundary convention and constants already present in seeds. |
| Reruns create conflicts | Use unique business keys and the existing upsert/`skipDuplicates` patterns. |
| Lifecycle state is invalid | Validate against Prisma enum fields and mirror controller-supported states. |

## Tasks

1. [x] Extend authentication demo identities, roles/scopes, and audit variety; verify seed source integrity.
2. [x] Extend inventory catalog, warehouse/supplier, stock, and operational-document states; verify seed source integrity.
3. [x] Extend borrowing customer, membership, transaction, financial, and engagement records; verify seed source integrity.
4. [x] Add contract tests and run relevant workspace checks.

## Checkpoints

- After each service seed: syntax check plus focused tests.
- At completion: `pnpm test:workspace-config`, `pnpm test:node`, and `pnpm demo:seed` if Docker is running.
