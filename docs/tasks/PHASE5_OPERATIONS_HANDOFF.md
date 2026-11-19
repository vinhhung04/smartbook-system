# Phase 5 operations handoff — 2026-11-18

Source changes are ready for the coordinated Phase 6 dependency/runtime update.
This is **not production approval**. No production deploy, restore, role change,
container/volume removal, publication or external notification was performed.

Phase 6 follow-on source checkpoint: CI now pins Node 24.16.0 and Python
3.12.16, installs the three hashed AI lockfiles, and builds/verifies Caddy as
the eighth release image. `IMAGE_SERVICES` contains the seven application
services plus Caddy; `APP_SERVICES` remains the seven writers. Custom Caddy
runtime checks require the explicitly built `smartbook-qa-caddy:<40SHA>` tag.
The test Dockerfile uses the same pinned official Node 24 base as production.
Targeted release/ops gates are 18/18 pass, zero skips in
`test-results/remediation/p6-ci-components.log`. This source checkpoint does
not claim a completed Phase 6 image build or full regression run.

| Evidence | Observed result | Scope |
|---|---|---|
| `test-results/remediation/ops-phase5-targets.log` | 37/37 pass, zero skips/failures/cancellations | Original 16 contracts plus guarded runner, artifact safety, callback metrics, restart failure and restore preflight negatives |
| `test-results/remediation/restore-preflight.log` | 12/12 pass | Archive link/traversal/artifact checks, non-public DB objects, declared and actual storage identity, PGDATA, valid control; strict rejection reason and no-write assertions |
| `test-results/remediation/recovery-drill-4559f1e0.json` | Real encrypted isolated recovery pass | Four independent QA DB clones; table counts 14/69/29/1 and packing/procurement hashes match; AI was quota-only |
| `test-results/remediation/runtime-role-proof.json` | Real PG DML/no-DDL privilege proof pass | Four runtime identities; own DB only, no cluster administration/TEMP/TRUNCATE/migration writes; Analytics read-only; probe DML rolled back |
| `test-results/remediation/p5-nonroot-image-proof.json` | Fresh Borrow/Auth production image proof pass | Node 20.20.2, UID/GID 1000, read-only/no-network execution, no actual .env files, all Borrow operational scripts shipped |
| `test-results/qa/mandatory-db/{auth,inventory,borrow}.tap` | 90/90, 488/488, 347/347 pass, zero skips | Current migrations and discovered suites in Node 20 test images |
| `test-results/remediation/mandatory-analytics-fixtures.log` | 163/163 pass, zero skips | Analytics-only rerun after adding shared simulation/sample-seed fixtures to test image |
| `test-results/remediation/ai-pg-9e875b56.log` | Independent 12/12 PG tests pass, zero skips | Actual owner migrate.py, full 11-table AI schema, verified loopback audit DB, Python 3.10.22; separate evidence owned by financial reviewer |

The combined mandatory runner did **not** finish end to end. Its first attempt
correctly failed when a concurrently added test was absent from its built image;
its second reached Analytics and failed on missing cross-service evaluation
fixtures. The fixture packaging defect is fixed and Analytics was rerun green.
The AI stage in that combined invocation was not reached. Run the complete
immutable-checkout gate after Phase 6; do not merge partial reports into a claim
that the whole gate ran successfully.

Five YAML files and production Compose interpolation were validated; shell and
JavaScript syntax were checked. No production container was started. The latest
actual-mount/PGDATA restore preflight additions are sandbox tested after the
earlier real restore drill; its populated retained target was not reset/reused.

## Source interface handoff

- Phase 6 may update all service Dockerfile runtimes, `deploy/Dockerfile.test`,
  CI Node/Python versions, image-build matrix and telemetry dependency family.
- Application digest manifest has seven keys. If Caddy becomes an eighth built
  image, update deploy workflow artifacts, `deploy.sh` manifest verification and
  `lib.sh` digest loading together, while keeping edge Caddy outside
  `APP_SERVICES` (the seven application writers drained for backup).
- Preserve explicit owner migrations and post-migration grants, including AI
  quota leases. Runtime schema creation remains disabled in production.
- Preserve shared lifecycle exports/safe logging and newly added metrics imports
  when migrating telemetry APIs. Inventory's outbox gauges query durable total
  count/oldest age, not the last worker batch. Borrow payment callback metrics
  leave response protocol and callback behavior unchanged.
- CI's AI PG XML assertion requires exactly 12 tests and no skips. Mandatory DB
  runner uses a new guarded AI DB and one unittest process for both modules.
  Browser gate uses retries=0 and trace=off; only curated sanitized artifacts are
  uploaded. `ai-db` delegates the same guarded runner rather than creating the
  obsolete unguarded `qa_ai_test` target.

## Required final evidence and operator work

The real drill covers relational state and two business document volumes, not
broker/cache/model/certificate/monitoring volume snapshots. Repeat recovery with
the complete AI schema and controlled business invariants; measure the intended
RPO/RTO independently. The retained recovery containers/data are preserved.
The Windows drill used disclosed real Linux GPG/jq/locking adapters; it is not a
claim that an unmodified VPS command was executed on Linux.

Monitoring provisioning and Grafana's documented `$ALERT_WEBHOOK_URL` expansion
are configured, but live notification delivery and assigned human on-call are
unverified. Configure a compatible real receiver and confirm delivery before
launch. There was no network message to an operator/provider. Source-only
fallback gating refuses unreviewed old images; no real failed deployment or
old/new schema/business compatibility rehearsal has been executed.

See [production operations](../PRODUCTION_OPERATIONS.md) for the exact operating
boundaries and safe restore procedure. Final readiness remains blocked on the
remaining audit phases and the documented production-specific evidence.
