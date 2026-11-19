# SB01–SB24 final regression execution map

Status: **PASS —24/24 selected SB regressions verified** on2026-11-19 (Asia/Saigon):68 exact, non-skipped TAP assertions matched the three Node24 runs below. This is a source- and execution-scoped regression result, not production approval or a claim that all21 PRA findings are cleared. Approved SB03/SB07/SB12/SB20 policies are the current remediation policies.

Paths below are relative to the repository root. `B` = `services/borrow-service/test/`; `I` = `services/inventory-service/test/`; `A` = `services/analytics-service/test/`. DB tests require the explicit isolated audit targets and matching migrations/clients. Mandatory execution must fail when required DSNs are missing; a skipped database test is not a PASS.

| ID | Current invariant | Exact existing test file and name selected for final execution | Status | TAP evidence |
|---|---|---|---|---|
| SB01 | Borrowed plus active reserved quantity obey the membership cap | B `business-logic-audit.db.test.js` — `SB01: direct loans count active reserved quantities as well as borrowed items` | PASS | `B:553` |
| SB02 | Future membership is excluded; established accrued-fine policy is consistent | B `business-logic-audit.db.test.js` — `SB02: future renewal cannot supersede membership active today`; `SB02: overdue sweep preserves the rate of an expired but still ACTIVE membership`; B `expired-membership-return.db.test.js` — `expired ACTIVE fine policy is independent of sweep-before-return ordering and never enables checkout` | PASS | `B:562,605,816` |
| SB03 | Paid history is immutable; later uncovered days accrue; full-episode waiver is explicit | B `fine-policy.db.test.js` — `SB03 PG: paid period stays immutable; subsequent days form one idempotent incremental period`; `SB03 PG: ordinary waiver permits later accrual; authorized full-episode waiver stops it`; `SB03 PG: payment racing accrual cannot lose a payment or bill a covered day twice`; `SB03 PG: additive migrations preserve legacy financial history and establish a prospective cutoff` | PASS | `B:955,961,973,997` |
| SB04 | A returned copy cannot move stock or settle money again under another key | B `business-logic-audit.db.test.js` — `SB04: explicitly returning an already returned item does not repeat inventory or monetary effects`; I `audit-24.db.test.js` — `SB-04: different keys cannot return the same loan item twice or consume another item stock` | PASS | `B:581; I:72` |
| SB05 | Deposit/commit failure after consume retains recovery evidence | B `business-logic-audit.db.test.js` — `SB05: a wallet race after direct inventory consume queues the consumed stock for reconciliation`; `SB05: conversion validates the deposit before remote inventory consume`; B `borrow-operation-durability.db.test.js` — `PRA07: failure publishing local completion rolls back local loan and can replay remote success` | PASS | `B:587,599,271` |
| SB06 | Same reservation conversion produces one stable loan | B `business-logic-audit.db.test.js` — `SB06/SB23: concurrent conversion retries replay one committed loan and consume once` | PASS | `B:499` |
| SB07 | Count-time cutoff, freeze and later delta follow approved policy | I `stock-audit-cutoff.db.test.js` — `SB07: count cutoff, freeze and overlap invariants on PostgreSQL`, including `count10→8 then outbound2 approves to6 exactly once and releases overlap reservation` and `legacy submitted count is rejected unchanged, explicit recount establishes a real cutoff` | PASS | `I:2525,2475,2500` |
| SB08 | One delivery produces one live GRN under concurrency | I `audit-24.db.test.js` — `SB-08: simultaneous GRNs with distinct keys for one delivery create one draft` | PASS | `I:36` |
| SB09 | Concurrent declarations cannot exceed the PO remaining quantity | I `audit-24.db.test.js` — `SB-09: concurrent delivery declarations share the remaining ordered quantity` | PASS | `I:42` |
| SB10 | Duplicate-variant root lines add repick quantities once | I `audit-24.db.test.js` — `SB-10: outbound duplicate-variant root lines add the repick quantity once` | PASS | `I:78` |
| SB11 | Receiving includes root plus repick quantities, including legacy fallback | I `audit-24.db.test.js` — `SB-11: receiving displays, counts and posts original plus repick shipped quantity`; `SB-11: legacy receive-in-full fallback includes repick without a draft GRN` | PASS | `I:84,90` |
| SB12 | Accepted, quarantine and missing custody stay distinct; resolution is authorized and idempotent | I `transfer-discrepancy.db.test.js` — `SB12 PostgreSQL custody, approval and replay invariants`, including `receipt posts90 accepted,5 quarantine and5 missing once; receipt cancellation cannot orphan custody` and `concurrent found approvals cannot exceed missing quantity; same key replays, different payload conflicts` | PASS | `I:2941,2917,2923` |
| SB13 | Supplier returns trace exact putaway allocations and cannot reuse returned stock | I `receipt-lifecycle-audit.db.test.js` — `SB13: returns after putaway use traced shelf quantities and cannot reuse prior returned allocations` | PASS | `I:1801` |
| SB14 | Cancellation reverses putaway/inbound/PO quantities once and fails atomically when custody is unavailable | I `receipt-lifecycle-audit.db.test.js` — `SB14: simultaneous cancellation reverts both movements only once`; `SB14: borrowed shelf stock blocks cancellation and rolls back receipt status`; `SB14: concurrent cancellation reverses PO received quantity only once` | PASS | `I:1807,1813,1819` |
| SB15 | Pending delivery blocks closure; processed discrepancy permits legitimate closure | I `receipt-lifecycle-audit.db.test.js` — `SB15: pending delivery prevents closure, processed discrepancy permits it` | PASS | `I:1825` |
| SB16 | Every delivery line needs an explicit count, including zero | I `audit-24.db.test.js` — `SB-16: incomplete count is refused and an explicit zero creates a shortage outcome`; I `procurement-receipt.test.js` — `SB-16: posting a legacy incomplete GRN refuses to lose an uncounted delivery line` | PASS | `I:24,1101` |
| SB17 | Deployed partial unique index rejects concurrent duplicate invoices while preserving allowed namespaces | I `audit-24.db.test.js` — `SB-17: deployed partial unique index exists and both concurrent service calls hit it`; `SB-17: supplier, series and CANCELLED semantics preserve legitimate invoices` | PASS | `I:12,18` |
| SB18 | Open shortage PO lines remain incoming; closed/draft/cancelled lines are excluded | A `reorder-incoming-shortage.db.test.js` — `SB-18: open lines on a shortage PO remain incoming; closed lines and draft/cancelled POs do not` | PASS | `A:737` |
| SB19 | Return committed after a sweep scan cannot be reopened or billed by stale state | B `business-logic-audit.db.test.js` — `SB19: sweep and a return overlap after the scan; returned item is neither reopened nor fined` | PASS | `B:479` |
| SB20 | One request preserves per-copy condition, reason, fine, deposit and retry identity | B `mixed-return.db.test.js` — `SB20: one request previews and settles GOOD, DAMAGED and LOST independently`; `SB20: duplicate, foreign, inactive and unexplained damaged copies fail before any stock call`; `SB20: uncertain mid-batch remote return is reconciled with per-copy outcomes`; `SB20: concurrent batches cannot bind one parent key to different copies` | PASS | `B:1301,1347,1362,1379` |
| SB21 | Final normal return cannot hide an earlier LOST copy | B `business-logic-audit.db.test.js` — `SB21: returning the final active item preserves earlier LOST items in the loan aggregate`; `SB21: concurrent returns of distinct items close from the committed state of all items` | PASS | `B:473,521` |
| SB22 | Inventory retry key is bound to operation, original resource and normalized payload | I `audit-24.db.test.js` — template `SB-22 ${op}: real concurrent requests change stock once and conflicting replay is 409`, executed for each release/consume/return; I `borrow-idempotency-binding.test.js` — template `SB-22 ${name}: key reused with ${Object.keys(diff)[0]} conflicts` and `SB-22: a release key cannot acknowledge a consume request` | PASS | `I:54,60,66,144,150,156,162,180,186,192,198,216,222,228,234,240,246,252,258,264` |
| SB23 | Cancel/convert have exactly one terminal winner without spending another hold | B `business-logic-audit.db.test.js` — `SB23: concurrent conversion and cancellation have exactly one successful terminal transition`; `SB23: cancellation winning before conversion prevents any consume or loan`; I `audit-24.db.test.js` — `SB-23: simultaneous inventory release/consume cannot spend another reservation stock` | PASS | `B:487,493; I:48` |
| SB24 | GRN replay and collision recovery recheck current permission on the persisted warehouse | I `audit-24.db.test.js` — `SB-24: replay checks the actual persisted document warehouse and actor`; I `supplier-delivery-receipt.test.js` — `SB-24: unique-key recovery rechecks warehouse permission if access was revoked`; `SB-24: a simultaneous key collision for a different delivery cannot replay the winner` | PASS | `I:30,2790,2784` |

## Executions and identities

`B:<line>`, `I:<line>` and `A:<line>` reference the persisted TAP log line, not the source line. Every selected assertion is `ok` with no SKIP/TODO directive; all three suite summaries also report zero failures/cancellations/skips/todos. Retained containers exited0 and their actual image IDs match the corresponding identity JSON.

| Alias | Actual runtime / complete-suite result | Exact tested builder image ID | Log and identity |
|---|---|---|---|
| B | Linux Node`v24.16.0`; **348/348PASS,0skip** | `sha256:70f1364889dbbd86b993be364724c57db5d15725e7c6f623aecd842c01016328` | `test-results/remediation/node24-borrow-2838e966.log` and `.json` |
| I | Linux Node`v24.16.0`; **503/503PASS,0skip** | `sha256:03de3d08bf2ee0811de2f7847035c5d1b3e58a7183c6fa0426f877d77b8344be` | `test-results/remediation/node24-inventory-3dde3442.log` and `.json` |
| A | Linux Node`v24.16.0`; **163/163PASS,0skip** | `sha256:e060d3689ea66e9d290e91044e94fb2c59ecfad86abef9edde118ab2cf5e2ca2` | `test-results/remediation/node24-analytics-fb6444eb.log` and `.json` |

The image aliases recorded at execution are `smartbook-remediation-p6-borrow-test:latest`, `smartbook-remediation-p6-inventory-test:latest` and `smartbook-remediation-p6-analytics-test:latest`; the exact IDs above, not a later alias lookup, define the evidence. Their working directories were `/workspace/services/<service>-service`. The executed command was `node --test --test-reporter=tap --test-concurrency=1` followed by every filename in the identity JSON's `scope`, in that order; Borrow/Inventory prefixed it with `node_modules/.bin/prisma generate &&`. These were full suites, not test-name-filtered samples. The harness used the verified isolated loopback audit PostgreSQL (Borrow/Analytics `borrow_audit`, Inventory `inventory_audit_verified`) through the audit container network namespace, with matching clients generated for the two Prisma services. No production database was selected.

## Source and lock cutover proof

Read-only extraction from the retained tested containers was compared byte-for-byte with current service `src`, `test`, `prisma` (where present), service manifest and shared manifest. No selected-source mismatch was found. The machine evidence `test-results/remediation/sb24-final-map-proof.json` retains all68 exact checks (name, source file, parent, log line and status), suite summaries, tree hashes, log hashes and image metadata. Its extracted source directory is recorded in that JSON; no container was restarted or test rerun to manufacture this mapping.

| Service | Matching source/test/schema file counts | Recorded global pnpm lock SHA256 |
|---|---|---|
| borrow | src=65, test=53, prisma=48; service/shared manifests match | `ad447708268231a8ccd756f512180d50b8ee317f79bc46bf1e8aa526704745b2` |
| inventory | src=129, test=58, prisma=21; service/shared manifests match | `938b5d875b8a4e6cb5ac0a3def8414bc08d009ea080726e659081998bd49c4af` |
| analytics | src=25, test=28; service/shared manifests match | `ad447708268231a8ccd756f512180d50b8ee317f79bc46bf1e8aa526704745b2` |

All three identities record shared manifest SHA256 `3a2f1f706119cef0ca576068fddcd45b335d42e6d3e42bca63189706198588fe`. Inventory503 ran after its **Multer2.5.0** cutover on the final global lock `938b5d875b8a4e6cb5ac0a3def8414bc08d009ea080726e659081998bd49c4af`. Borrow348 and Analytics163 ran on the earlier global lock `ad447708268231a8ccd756f512180d50b8ee317f79bc46bf1e8aa526704745b2`; this document does **not** claim those processes used938b.

To establish the narrower unchanged-graph claim, dependency/optional/dev snapshot reachability, including linked workspace dependencies and package metadata, was traversed under each service importer in both complete lockfiles. Borrow's122-node closure and Analytics'129-node closure are identical, with no unresolved graph nodes and no Multer node:

| Unchanged service graph | SHA256 of identical old/final graph |
|---|---|
| borrow | `5e99b3a2880718a01d5c5b30b144f19477dbe0c7e415c6db9f70820cf4222682` |
| analytics | `38ab9580fc55e305d4e551df4390ad21589cdaa6f4af07fb6c7325cce4123477` |

Thus the cited Borrow/Analytics business source and service dependency graphs remain applicable after the Inventory-only cutover; this is not a workspace-wide lock equivalence assertion. A fresh mandatory all-service run on938b is separate final-gate evidence.

Inventory's later runtime-only evidence-directory `mkdir/chown` rebuild does not change the matching business `src`/`test`/schema/manifests or the tested dependency graph. The503 checks ran in the exact **builder test image** above, and do not themselves prove directory ownership/non-root writes in the separately rebuilt runtime image. Runtime volume ownership, deployed artifact identity and startup require their own gates. No later runtime-image PASS is inferred from this map.

## Nested parent suites explicitly passed

The selected nested checks also have successful, non-skipped parent assertions. Their full hierarchy is retained in the machine proof:

| Parent test name | TAP evidence | Result |
|---|---|---|
| `SB07/13/14/15: receipt lifecycle and stock-count PostgreSQL audit` | `I:1850` | PASS |
| `SB07: count cutoff, freeze and overlap invariants on PostgreSQL` | `I:2525` | PASS |
| `SB12 PostgreSQL custody, approval and replay invariants` | `I:2941` | PASS |
| `SmartBook audit: migrated PostgreSQL business invariants` | `I:96` | PASS |

## SB22 dynamic names — all expanded checks

The template in the main row is a source selector, not an assumed result. All20 expanded checks below appeared individually as non-skipped `ok` assertions. The first three belong to the passed `SmartBook audit: migrated PostgreSQL business invariants` parent; the other17 are top-level assertions.

| Source file | Actual expanded test name | TAP evidence | Result |
|---|---|---|---|
| `test/audit-24.db.test.js` | `SB-22 release: real concurrent requests change stock once and conflicting replay is 409` | `I:54` | PASS |
| `test/audit-24.db.test.js` | `SB-22 consume: real concurrent requests change stock once and conflicting replay is 409` | `I:60` | PASS |
| `test/audit-24.db.test.js` | `SB-22 return: real concurrent requests change stock once and conflicting replay is 409` | `I:66` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 release: key reused with reservation_id conflicts` | `I:144` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 release: key reused with reason conflicts` | `I:150` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 release: key reused with warehouse_id conflicts` | `I:156` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 release: key reused with quantity conflicts` | `I:162` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 consume: key reused with reservation_id conflicts` | `I:180` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 consume: key reused with loan_id conflicts` | `I:186` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 consume: key reused with warehouse_id conflicts` | `I:192` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 consume: key reused with quantity conflicts` | `I:198` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 return: key reused with loan_id conflicts` | `I:216` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 return: key reused with loan_item_id conflicts` | `I:222` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 return: key reused with variant_id conflicts` | `I:228` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 return: key reused with warehouse_id conflicts` | `I:234` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 return: key reused with quantity conflicts` | `I:240` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 return: key reused with item_condition_on_return conflicts` | `I:246` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 return: key reused with mark_lost conflicts` | `I:252` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22 return: key reused with location_id conflicts` | `I:258` | PASS |
| `test/borrow-idempotency-binding.test.js` | `SB-22: a release key cannot acknowledge a consume request` | `I:264` | PASS |

## Limits of these24 PASS results

These checks execute actual PostgreSQL/controller/service behavior but often replace other-service HTTP boundaries. They do not independently prove deployed cross-service commit, real provider settlement, physical custody, browser layout, all failure drills or all21 PRA findings. Those remain separate release evidence. No missing name, skipped DB case, old audit status or aggregate-only success was used as a substitute for a selected assertion. New source, schema, dependency-graph or policy changes require revalidation of the affected mapping.
