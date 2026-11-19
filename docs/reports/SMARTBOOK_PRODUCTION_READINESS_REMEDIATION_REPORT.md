# SmartBook Production Readiness Remediation

**BẢN ĐANG CẬP NHẬT — chưa nghiệm thu, chưa phê duyệt release.** Ngày18/11/2026, Asia/Saigon. Đang xác minh Phase6 trên Node24/Python3.12; Phase7–8 chưa chốt. Các số dưới đây là checkpoint có artifact, không phải kết quả cuối cùng của toàn working tree.

Baseline `324f8d13953a8694f08994b5b8562c3569ae7fcb`, branch `hungg`, repository `vinhhung04/smartbook-system`. HEAD chưa thay đổi; không commit/push/deploy. Báo cáo audit gốc được giữ riêng tại `SMARTBOOK_PRODUCTION_READINESS_AUDIT.md`.

## A. Executive Summary

Quyết định hiện tại: **NO-GO** vì kiểm chứng vận hành, dependency remediation và các mandatory gate cuối chưa hoàn tất. Không dùng kết quả audit cũ làm kết quả remediation mới, không cộng các lượt test tập trung vào full suite, và không tính skipped là passed.

Toàn bộ21 finding được đối chiếu lại trên baseline không đổi; bằng chứng gồm actual controller/PostgreSQL/process/proxy tests, shell sandbox, read-only schema diff, và dependency scanner. Tái hiện bằng test chạy được và xác nhận static/configuration được phân biệt ở dưới. Những checkpoint PASS vẫn cần chạy lại trên dependency/runtime và working tree cuối.

Các thay đổi UI chỉ truyền stable idempotency key cho thanh toán fine; layout/style/navigation không đổi. Không thực hiện giao dịch VNPay/refund thật, không gọi paid provider thật, không chạy migration production, reset/drop dữ liệu hay xóa volume. File người dùng `apps/web/public/__tmp_enrich.json` và trạng thái Git của repository cha không bị sửa.

## B. Detailed Findings — checkpoint

`LOCAL PASS` = implementation và test tập trung/full checkpoint đã đạt; chưa đồng nghĩa production đã được xác minh. `IN PROGRESS` và `UNFIXED` chưa được tính là hoàn tất.

| ID | Severity | Initial verification/root cause | Changes and migration | New evidence | Current result / remaining risk |
|---|---|---|---|---|---|
| PRA01 | P0 | PG reproduced: nghĩa vụ fine thay đổi khiến callback thành công không được bảo toàn; intent expiry bị coi như provider outcome | Immutable `provider_payment_settlements`, gross=applied+unapplied; suspense manual cases; late success; atomic live intents; signed public callback protocol. Migration20261118010000 | `financial-readiness.db.test.js`, callback protocol, real-PG concurrent callbacks/intents, failure rollback | LOCAL PASS. Real provider settlement/refund và lịch sử production chưa xác minh |
| PRA02 | P1 | PG reproduced: generic GRN bypass delivery guard | Shared delivery-row locking/active receipt guard at create and POST; preserve historical duplicates and return409 | `receipt-entrypoint-invariants.db.test.js`, concurrency and multi-delivery controls | LOCAL PASS. Historical production duplicates require read-only audit/operator review |
| PRA03 | P1 | PG reproduced: generic transfer POST then dedicated damaged receipt caused custody divergence | Shared transfer receiving transaction: accepted/damage/quarantine/status/counters; safe legacy replay/cancel | Real-PG alternate-route, legacy, cancellation/retry and outbox cases | LOCAL PASS. Ambiguous historical receipts409; no guessed stock correction |
| PRA04 | P1 | PG reproduced: stored direct-loan replay trusted caller-supplied warehouse/actor/payload | Authorize stored warehouse; actor/resource/normalized payload binding; conservative legacy reconstruction | `direct-loan-binding.db.test.js` and existing/new loan cases | LOCAL PASS. Deployed actor matrix still needs operator validation |
| PRA05 | P1 | PG/browser-client-unit reproduced: partial counter payments repeated after lost response | Durable request key/fingerprint/result in money transaction; stable web dialog key; identity-less requests fail closed. Migration20261118010000 | `financial-readiness.db.test.js`, `fine-legacy-payment-retry.db.test.js` pre-upgrade cutover RED→GREEN, web fine-payment unit; lost-response browser scenario added | LOCAL PASS. New browser scenario pending final QA run |
| PRA06 | P1 | PG reproduced: distinct fines raced cached customer debt | Customer-first serialization across fine writers; read-only debt discrepancy detector; current-rate refresh retains historical accrual periods | Five concurrency cases, debt detector, financial/fine-policy suites; payment-first vs sweep-first rate-change reproduction/fix | LOCAL PASS. Production debt/history not declared clean |
| PRA07 | P1 | Crash-window tests reproduced no durable approved plan before remote mutations | Durable approved operation state machine before reserve/consume/release/return; stable IDs/keys; atomic local completion; lease recovery/manual ambiguity; read-only legacy/orphan detector. Migration20261118020000 | All six operations; DB intent failure; real child SIGKILL at stubbed response boundary; restart; refusal/manual/return-cutoff regressions | IN PROGRESS final cutoff/full handoff. Remote mutation boundary in kill test is mocked, not a live Inventory assertion |
| PRA08 | P1 | PG reproduced:50 older manual cases starved automatic release | Filter before LIMIT; CAS claims/lease expiry; exponential backoff/cap; complete queue counts/age/freshness; audited manual tool | `reconciliation-queue.db.test.js`, metrics/timeout tests, legacy unit regressions | LOCAL PASS. Real alert receiver delivery not verified |
| PRA09 | P1 | Static + shell sandbox reproduced procurement omission/incomplete recovery boundary | Encrypted four-DB + packing/procurement/config capture; manifest/checksums; writer-stop boundary; empty isolated restore only | Shell regressions green checkpoint; actual retained independent restore drill being built | IN PROGRESS. Full real restore/RPO/RTO not yet claimed |
| PRA10 | P1 | Shell reproduced offsite failure reporting freshness success | Fail closed on copy/check failure; separate local/offsite stamps | Offsite failure/check regressions | IN PROGRESS real drill/verification |
| PRA11 | P1 | Offline ASGI fake providers reproduced anonymous paid aliases | Capability/session/internal service boundary; durable HMAC-principal/global quotas and concurrency; explicit owner SQL migration20261118_inference_budget | Expanded32 targeted AI tests including cross-process PostgreSQL quota; full AI checkpoint | LOCAL PASS. Provider currency budget/account controls remain external |
| PRA12 | P1 | Actual logger and Caddy reproduced synthetic token leakage, including error path | Safe application paths, no query/header logging; supplier DB errors emit code/request ID only; global and access Caddy field filters | Shared Node20 full34; supplier error test; real Caddy2.8.4 upstream502 marker test RED→GREEN | LOCAL PASS. Historical live logs/link invalidation not inspected or modified |
| PRA13 | P1 | Static/DAG tests reproduce missing mandatory DB/integration/E2E image gate | Discover all DB suites; verified isolated audit DBs; no-skip reports; same-SHA verification/build/deploy being implemented | CI/runner contracts and local execution pending | IN PROGRESS. Hosted CI on future committed SHA NOT EXECUTED |
| PRA14 | P1 | Static/shell reproduction of unsafe old-image fallback after migration | Default fallback disabled; retain DB and stop failed fleet; explicit exact-pair compatibility evidence required | Shell failure/fallback regressions | IN PROGRESS. No untested old image declared compatible |
| PRA15 | P2 | Actual read-only diff exit2: FK action/relation/index drift | Match Prisma to authoritative SQL; preserve custom objects; add only missing alias indexes20261118040000 | Auth/Borrow/Inventory mandatory PG schema tests eachPASS; current diffs empty; custom object hash unchanged | LOCAL PASS. Production schema drift not inspected |
| PRA16 | P2 | Offline ASGI + actual proxy reproduced oversized/chunked/spoofed-image acceptance | Total actual byte caps; bounded ingress slots/deadlines; pre-parser application admission; image magic/pixels/decode; Caddy16MiB | Gateway22 tests; AI targeted upload cases; real Caddy declared and explicit chunked overflow413/valid byte preservation | LOCAL PASS. Capacity/load tests still pending |
| PRA17 | P2 | Static/process/helper tests reproduced lifecycle gaps | Stop admission/readiness, drain HTTP/workers, attempt all resource closes, bounded timeout; AI lifespan work in progress | Shared/consumer/gateway checkpoints; real Node20 PG+remote SIGTERM/restart3 testsPASS; AI proof pending | IN PROGRESS. Lifecycle final review still active |
| PRA18 | P2 | Actual metric/shell tests reproduce batch-size backlog601→0 and false delivery stamp | Persisted total backlog/oldest age/financial+reconciliation metrics and alert delivery corrections being completed | Borrow queue metricsPASS; Inventory/monitoring final checks pending | IN PROGRESS. Actual rota/receiver NOT_VERIFIABLE |
| PRA19 | P2 | Dockerfile/Compose/startup tests confirm root/superuser/runtime DDL | Nonroot images, separate DML identities/owner migrator, no production runtime DDL | Source/config checkpoint; actual privilege/container proof pending | IN PROGRESS. No production credential/grant change executed |
| PRA20 | P2 | PG reproduced reserve/GRN/wallet changed-payload silent replay | Immutable normalized bindings; trusted service-delegated original actor; ledger fingerprints/global new-key customer binding; exact safe legacy handling. Wallet index20261118030000 | Wallet19 focused; Inventory final486/486 includes reserve/GRN/concurrency/legacy/schema | LOCAL PASS. Some legacy identities cannot be proven and return explicit409 reconciliation |
| PRA21 | P2 | Actual scanner on unchanged lock graph:100 pnpm advisory entries; Python installed-image audit | Read-only reachability/fixed-version triage completed; dependency/runtime changes not yet applied | `docs/tasks/DEPENDENCY_ADVISORY_TRIAGE.md` | UNFIXED pending Phase6; no audit-clean claim |

## C. Database Changes

New additive migrations rehearsed only on independently verified loopback PostgreSQL:

| Migration | Purpose | Verification/compatibility |
|---|---|---|
| Borrow20261118010000 | Immutable provider settlements and counter-payment requests | Existing fine/payment counts/sums unchanged; append-only/conservation tests; no historical receipt backfill |
| Borrow20261118020000 | Due time, lease and safe error code for retry queue | Existing row/status counts unchanged; concurrent claims/backoff/lease recovery |
| Borrow20261118030000 | Wallet key lookup index | Nonunique index; original customer/key unique constraint retained; new/legacy identity tests |
| Inventory20261118040000 | Two normalized-alias/status indexes | All public constraints, noninternal triggers and partial indexes unchanged; read-only diff empty |
| AI20261118_inference_budget.sql | Durable cross-process request quotas/leases | Separate `ai_audit`; no startup CREATE; no prompts/photos/raw identities in lease table |

Preflight documents under `docs/tasks/` and AI migration folder state lock/data/backfill/compatibility/verification/forward-fix details. Auth's unchanged three baseline migrations were applied only to a newly created independent `auth_audit` for drift checking. No deployed migration file was edited. No destructive reset, db push, data history deletion or production migration was performed.

## D. Security Changes

Stored-object authorization and actor/payload replay identity now supplement request scope checks. Supplier tokens are removed from both application and reverse-proxy logs, including database-exception and upstream-error cases. Paid AI aliases require the appropriate verified capability or narrowly scoped internal service identity; public chat/discovery remain supported. Body limits count actual bytes before multipart parsing, and concurrency/read/provider deadlines bound resource use. Dependency changes remain a separate unfinished Phase6; see the advisory triage rather than assuming scanner findings are all equally exploitable.

## E. Cross-Service Recovery

Approved normalized plans are persisted before remote mutation; JWTs are never stored. Remote child keys and loan/reservation/item identities survive replay. Business state and successful completion are committed together. Automatic workers claim by lease, recover stale leases and back off to manual review. Uncertain financial timing/pricing/state is not repaired by guessing a refund or stock adjustment. The latest return-cutoff work preserves the original batch processing-time policy using durable remote completion context.

Read-only custody reconciliation pages local terminal reservations, operation history (including operator-resolved records), and remote Inventory hold candidates. It can therefore identify legacy remote orphans with no local intent. A queue acknowledgement does not hide physical drift. Cross-service snapshots may observe legitimate in-flight work, so findings require recheck/evidence; the detector performs no automatic repair.

## F. CI/CD Changes

IN PROGRESS: mandatory discovered DB suites, isolated targets, no-skip result validation, integration/E2E prerequisites, source-SHA propagation, explicit owner migrations and safe failed-rollout handling. Local script/config checks do not stand in for a hosted workflow on a future committed SHA. No registry publication or VPS deployment was performed.

## G. Backup/Restore

IN PROGRESS: recovery set includes encrypted globals, four DB dumps, packing/procurement files and configuration; manifest/checksum and local/offsite freshness are distinct. Writers are stopped for a coherent capture boundary. Restore targets must be separate and empty, with no clean/drop/overwrite path. Shell failure cases pass checkpoints; actual independent DB/file restore, missing/corrupt archive handling and measured RPO/RTO are not yet claimed.

## H. Test Results — checkpoint only

Checkpoint Phase6 mới nhất (không cộng với các full snapshots bên dưới): Node24.16.0 lint/typecheck/build web+mobile **PASS**; workspace config **84/84**, web unit **82/82**, mobile unit **216/216** đều0skip. Hai assertion config cũ được cập nhật để kiểm tra dependency Python đã pin và CI dừng container giữ dữ liệu thay vì bắt buộc `down`. Shared+dependency runtime focus **44/44**, custom Caddy runtime **2/2**, real Prometheus metric consumer **2/2** đềuPASS. Backend PostgreSQL full trên Node24, Python final image và final QA đang chạy; không suy ra release gate từ các checkpoint này. Node audit hiện còn4entries (0critical/2high/2moderate), xem Phase6 trong `docs/tasks/DEPENDENCY_ADVISORY_TRIAGE.md`.

Artifacts are under ignored `test-results/remediation/` and `test-results/production-readiness/`. They contain synthetic fixture IDs, not production PII or credentials. Full snapshots and focused runs overlap and must not be summed.

| Suite/checkpoint | Result | Artifact/limit |
|---|---|---|
| Financial initial full Borrow |278PASS,0skip|`financial-snapshot-full-node20.log` |
| Current Borrow pre-final cutoff full |331PASS,0skip|`node20-borrow-6a354721.log`; later cutoff hardening requires final full rerun |
| Latest cutoff/core focused |63PASS,0skip|`node20-borrow-105b7d0a.log` |
| Final Inventory Phase4 + schema |486PASS,0skip|`node20-inventory-1588380f.log` |
| Wallet identity focused |19PASS,0skip|`node20-borrow-6aa88a7e.log` |
| Borrow queue/deadline/metrics focused |16PASS,0skip|`node20-borrow-785df33d.log` |
| Custody detector |2PASS,0skip|`node20-borrow-28bd7d7a.log` |
| Inventory internal evidence/candidates |7PASS,0skip|`node20-inventory-6f6200b3.log` |
| Schema drift Auth/Borrow/Inventory |1+1+1PASS,0skip|`25a6ad0a`, `37e62c3c`, `b502138f` |
| Shared logging pre-lifecycle full |34PASS,0skip|`node20-shared-bffa82f3.log`; newer lifecycle checkpoint37PASS |
| Supplier controller exception redaction |1PASS,0skip|`node20-inventory-d8e6c93c.log` |
| Caddy actual logs/body |1+1PASS|`caddy-logging-green.log`, `caddy-body-limit.log`; baseline RED logs retained |
| AI full Phase4 |1633PASS +166subtestPASS,12SKIP|`phase4-ai-full.log`; existing PostgreSQL12 NOT countedPASS |
| AI targeted including new PG quota |32PASS|`phase4-ai-targeted.log` |
| Gateway final Phase4 |22PASS|`node20-gateway-520e5b5f.log` |
| Real SIGTERM/PG/remote lifecycle |3PASS|`3d67770b`; synthetic remote, no production mutation |
| Final build/lint/typecheck/browser/mobile/all DB/runtime gate |NOT EXECUTED final tree|Pending Phase6–8; historical audit results not reused |

## I. Remaining U01–U09

| Group | Current limit |
|---|---|
| U01 Backup/restore | Actual independent encrypted full-set restore/RPO/RTO in progress; production offsite recovery not yet verified |
| U02 Historical production data | NOT_VERIFIABLE: no production/restored-production data or audit account accessed |
| U03 Upgrade/fallback | Default unsafe fallback disabled in source; exact deployed image/schema pair rehearsal pending |
| U04 Distributed failures | New PG/process/lease/restart tests pass checkpoints; live broker/service fault matrix and final QA still pending |
| U05 Monitoring/ownership | Receiver/rota/on-call names and real delivery NOT_VERIFIABLE |
| U06 External integrations | No real payment/refund, SMTP recipient or paid AI call; provider evidence NOT_EXECUTED |
| U07 Security actor matrix | Local negative boundary tests added; final deployed role/scope matrix not yet proven |
| U08 Load/capacity | Bounded concurrency/fault tests do not constitute sustained VPS-equivalent load/SLO proof |
| U09 AI PG/mobile/supply chain |12 old AI PG tests still pending; physical device not available; dependency/runtime work not yet complete |

## J. Regression24 Original Issues

PENDING Phase7 final matrix. Current Borrow/Inventory snapshots include historical regression files, but they are not a substitute for a complete24-row final evidence matrix after lifecycle, dependency/runtime and integration changes. No old issue is declared regressed or verified-final merely from a matching source pattern.

## K. Final Recommendation

**NO-GO at this checkpoint.** Remediation is still active. Do not treat this draft, an isolated green test, or a configuration change as evidence that production release gates or external operational requirements have passed. The final revision must replace pending statuses, include final counts/results, and distinguish locally fixed code from unexecuted operator verification.
