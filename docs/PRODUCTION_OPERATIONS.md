# Production operations

This runbook describes the repository's proposed operating controls. Local QA
evidence is not a production deployment, external notification test, or measured
production RPO/RTO. Keep the production release blocked until an operator has
verified credentials, storage capacity, alert routing, and an independent restore.

## Release and database ownership

Release only a full 40-character commit SHA whose mandatory CI jobs all pass.
The deploy workflow builds that checkout and records exact application image
digests in `state/images/<SHA>.env`; the deployment script refuses missing,
duplicate, or mismatched entries. Do not substitute mutable tags for this file.

The explicit owner jobs apply Prisma migrations for Auth, Inventory, and Borrow,
then `python migrate.py` for AI, including `migrations/20261118_inference_budget.sql`.
The owner identity is available only to these jobs and DB bootstrap. Run
`04-runtime-roles.sh` after migrations so new tables receive runtime permissions.
Application identities have DML on their own database, no schema CREATE/TEMP/
TRUNCATE, no migration-table writes, and no cluster administration. Analytics is
read-only. Keep each runtime password separate from the owner credential.
`AI_SCHEMA_MANAGED_EXTERNALLY=true` makes runtime initialization check the schema
without creating it. Runtime containers use non-root users; the explicit volume
preparation job grants their fixed UID access to the named upload/model volumes.

Deployment drains/stops application writers before capture and migration. A
failure retains maintenance and the existing database. Prefer a reviewed forward
fix. Image fallback requires exact old/new SHA compatibility evidence in
`state/compatibility/<new>-<old>.json`, with matching `from`, `to`,
`schema_and_business_compatible: true`, and the SHA-256 of the retained QA report
in `qa_evidence_sha256`. The operator must verify that report and rehearse the
pair against the new schema/business state; the JSON declaration alone is not
proof. No database schema rollback or production restore occurs automatically.

## Backup capture and freshness

Import the **public** recovery encryption key on the backup host and configure
`BACKUP_ENCRYPTION_RECIPIENT`. Keep its private key and recovery instructions in
independent protected custody. Configure an authenticated rclone destination in
`BACKUP_RCLONE_REMOTE`; `BACKUP_OFFSITE_REQUIRED=true` is the default. Verify the
destination's independent retention/access policy and recoverability. Do not
publish the destination credentials or private recovery key in reports.

Run `deploy/scripts/backup.sh --quiesce` in the deployed application directory.
This introduces a maintenance interval: stop/drain writers, capture four custom
PostgreSQL dumps, role globals, packing evidence, procurement documents, and
release/configuration metadata. Streams are encrypted before storage. The
manifest and SHA256SUMS describe the ciphertext set. Partial DB-only captures
are refused. The EXIT handler restarts the previously running services and
returns failure if readiness cannot be restored.

Local capture and successful checked offsite copy have separate freshness
timestamps. A capture does not mean restore verification; the manifest initially
records `restore_verified: false`. Failed upload/check must not advance offsite
freshness. Preserve failed capture artifacts for diagnosis. No automatic deletion
or retention cleanup is performed by these scripts; capacity and retention need
an explicit operator policy.

## Independent restore

Use a separately provisioned project named `smartbook-recovery-<8 hex digits>`
with new empty databases and new named file volumes, on storage sized for a full
restore. Its Compose services must be `db` and `recovery-files`, with the latter
mounting packing/procurement volumes at `/recovery/packing` and
`/recovery/procurement`. Use a PostgreSQL image containing the source extensions
(including vector where present). Never point this procedure at production.
Use an explicitly privileged recovery **owner helper** for the new file volumes
(for example `user: "0:0"` on `recovery-files`) and pin its reviewed image/digest.
An application image's non-root default cannot write an unprepared root-owned
volume. This owner helper is an isolated operation, not application runtime.

Set `SMARTBOOK_RECOVERY_ISOLATED=1`, `SMARTBOOK_RECOVERY_PROJECT`,
`SMARTBOOK_RECOVERY_COMPOSE`, and `SMARTBOOK_RECOVERY_DB_USER`. Supply the
independently held GPG private key through the isolated recovery keyring. Run
`deploy/scripts/restore.sh <capture-directory> --isolated-empty-target`.
The script verifies ciphertext checksums, container identity and actual storage,
volume ownership, all decrypted DB headers and archive paths/types, empty DBs
(including non-public objects), and empty file directories before restoring.
It refuses external volumes, unexpected writable binds, archive links, and
production Compose. It never cleans/replaces existing databases or file volumes.

After a partial failure, retain that target and logs; provision another empty
target for the next attempt. Do not remove or reset retained data to force a
retry. After success verify row counts, financial invariants, custody/workflow
state, document hashes and controlled application smoke tests. Record source
SHA, capture time, recovery duration and the reviewed verification result.
Encrypted role globals and configuration require a separate review before any
application; the script does not automatically apply captured credentials.

This recovery set covers relational business state and the two business upload
volumes. RabbitMQ/Redis contents, model/browser caches, Caddy certificates and
monitoring history are not volume snapshots in this set. Recovery must include
reviewed durable-outbox replay, broker topology recreation and session/cache
invalidation before admitting writes. Rebuild model caches and monitoring from
versioned configuration; do not claim recovery of historical monitoring data.

The earlier quota-only AI drill has been superseded by full QA recovery
`c573b903` into `smartbook-recovery-dcf0db2f`: Auth/Inventory/Borrow/AI table
counts 14/69/29/11, 40,048 rows, every public table's canonical-row SHA-256,
sequence states, schema fingerprints, and both file hashes match the isolated
source. Eight controlled fixture invariants and actual indexed AI vector lookup
also pass. The preexisting audit fixtures are not a globally consistent business
snapshot; the cross-service invariant checks cover the explicitly linked new
fixtures. No restored application HTTP workflow was tested in this drill.
The successful restore command took 73.836 seconds in QA, excluding target
provisioning, retries and post-restore verification. It is not production RTO;
production RPO was not measured. See
[full recovery evidence](tasks/FULL_RECOVERY_DRILL.md) for boundaries and retained
failure targets. Repeat the operator's recovery rehearsal with the intended
production topology, role provisioning, queue/session recovery and app smoke
checks before production approval.

## Monitoring and incident ownership

Set a strong independent `GRAFANA_ADMIN_PASSWORD` and the monitoring secrets
(`MONITORING_DB_PASSWORD`, `MONITORING_INGEST_TOKEN`, `MONITORING_SECRET_KEY`).
Grafana is bound to loopback port 3100; access through a controlled tunnel.
Prometheus and the exporters have no public host port. Grafana's only contact
point is monitoring-service on the internal network (bearer token); it owns
incidents, deduplication, routing and delivery (email, in-app, Slack/Discord)
with retries and history. `ALERT_WEBHOOK_URL` is now only the healthcheck's
direct fallback path. See `docs/MONITORING.md` and the runbooks in
`docs/runbooks/MONITORING_RUNBOOKS.md`.

The current Node HTTP exporter uses `http_server_request_duration_*` in seconds,
with `http_response_status_code` and `http_request_method` labels. The dashboard
p95 expressions multiply by 1000 and display milliseconds; error-rate alerts
retain their ratio thresholds. Prometheus adds `service_name` at scrape time for
service filtering/grouping. Old `http_server_duration_*` time series are not
inputs to the current dashboard/alert queries.

The operations role owns the provisioned alert rules and the five-minute
`healthcheck.sh` cron. Assign an actual primary and backup person and acknowledge
a synthetic test notification through the real channel before launch; repository
configuration does not establish delivery or on-call coverage. The healthcheck
does not record successful notification delivery after webhook failure.

Investigate aged/failed inventory outbox records, Borrow automatic/manual
reconciliation and unapplied settlements from durable DB state rather than
worker sample buffers. Preserve correlation identifiers and inspect the manual
queue read-only before any reviewed repair. Do not mark a record complete merely
to clear an alert. Also respond to DLQ depth, DB connection pressure/long queries,
container OOM/restarts, provider failures/budget denials, backup freshness, TLS,
and missing metrics. Metrics and alerts contain counts and bounded categories,
not callback bodies, customer data, JWTs, passwords or provider keys.

## Mandatory QA and artifacts

The mandatory DB runner verifies the independent QA Compose project and loopback
binding, provisions audit-named DBs additively, applies owner migrations, discovers
all DB regressions and rejects any skipped/failed/cancelled test. AI uses a new
`ai_pg_audit_<8 hex>` DB and executes both PG modules in one process after the
actual owner migration command. Do not weaken these guards to accept arbitrary
DSNs. The separate test image includes development dependencies and shared
deterministic evaluation fixtures; it is not a deployable image.

Browser gates use zero retries and tracing disabled. Upload only the sanitizer's
curated artifacts, not raw Playwright reports/network traces/storage state or
environment files. All local evidence describes the tested runtime version;
repeat the mandatory gates and runtime/image proofs after dependency upgrades.
