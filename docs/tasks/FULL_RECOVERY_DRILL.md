# Full isolated recovery — 19 November 2026 checkpoint

**PASS for the tested QA recovery set; not production readiness approval.**
Machine-readable evidence: `test-results/remediation/recovery-drill-c573b903.json`.
Successful restore log: `recovery-full-resume-fresh.log`; additional read-only
proofs: `recovery-full-vector-proof.log`, `recovery-full-schema-proof.log` in the
same artifact directory.

The original audit PostgreSQL container was verified as the independent
pgvector/PG15 instance bound to loopback `127.0.0.1:25432`. Only metadata/read-only
dump commands accessed the originals: `auth_audit`, `inventory_audit_verified`,
`borrow_audit`, `ai_pg_audit_9e875b56`. All four captures finished on 18 November
at 13:26:16 UTC. No original DB was modified. Source snapshot restrictions have
been released to the other QA agents.

New source clone `smartbook-backup-test-c573b903` and recovery project
`smartbook-recovery-dcf0db2f` use network-none PostgreSQL containers and separately
owned named volumes. Controlled synthetic records were inserted only in the
source clone before capture. No application/provider call was made.

| Database | Restored tables | Verification |
|---|---:|---|
| Auth | 14 | Every public-table row fingerprint and schema checks match |
| Inventory | 69 | Same, including synthetic physical custody/stock/movement |
| Borrow | 29 | Same, including synthetic wallet/ledger/deposit/fine allocation |
| AI | 11 | Same, including vector/document/chunk/action/audit/quota data |

All **40,048 rows across 123 public tables** have matching canonical-row SHA-256
fingerprints and counts. Both sequence states match, including whether each was
called. Constraints, indexes, triggers, extension versions, column definitions,
defaults, nullability, identity/generated attributes, nonaggregate public
routines, views and row policies have matching fingerprints. Owner/ACL identity
is intentionally handled separately by reviewed owner jobs and runtime grants.
Packing and procurement object SHA-256 checks both match.

Eight controlled checks pass before capture and after recovery: wallet
credit-minus-hold/available balance, held-deposit/account balance, paid-plus-waived
fine allocation and cached balance, borrowed stock/unit custody, cross-database
loan/unit/movement IDs, Auth operator existence, AI vector/content/catalog IDs,
and conversation/action/audit/quota links. A separate read-only query proves the
recovered HNSW index is used and returns the expected zero cosine distance.
These fixture checks do not assert that all historical test records form a
globally consistent business state.

The actual `backup.sh` encrypted all four custom-format DB dumps, globals,
configuration and both file archives with a temporary QA GPG key. No plaintext
dump staging was used. The actual `restore.sh` verified ciphertext checksums,
all decrypted headers/archives, actual storage identity and empty targets before
restoring. Test-specific Compose/GPG adapters and an exclusive mkdir lock were
used because the driver host is Windows; the Linux GPG process and PostgreSQL
operations were real. Offsite transfer was disabled only in this isolated drill;
offsite failure/freshness checks have separate sandbox evidence.

The complete dump exposed a valid-large-archive bug: `pg_restore --list` exits
after its TOC and can break the upstream GPG pipe. The bounded fix drains the
remaining decrypted stream and preserves the header reader's failure status.
The old line reproduces RED in `restore-large-header-red.log`; current preflight
tests pass **14/14**, including a 2MiB stream and a failed-header drain case, in
`restore-preflight-full-artifact.log`.

An intermediate target `smartbook-recovery-c573b903` restored its DBs but file
extraction failed because its mutable QA helper tag had become non-root during
the interruption. It is retained **unverified**. Its data was never cleaned or
reset. The successful target is a newly provisioned project, with an explicit
recovery owner and a separately retained, image-ID-verified local helper tag
(`pull_policy: never`). The temporary GPG key material is private under `.git`,
not in these report artifacts.

The successful restore command took **73.836s**. This excludes provisioning,
failed attempts, the usage interruption, source verification and final checks;
it is not a production RTO measurement. No production RPO was measured. There
was no production restore/deploy or role change, and no DB/volume deletion.
RabbitMQ/Redis/model/browser/certificate/monitoring volume recovery, production
offsite access/key-custody, runtime-role recreation on a restored deployment and
restored application HTTP smoke remain separate operational rehearsals.
