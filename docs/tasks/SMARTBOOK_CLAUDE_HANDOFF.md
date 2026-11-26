# Bàn giao SmartBook remediation cho Claude

Ngày cập nhật: **19/11/2026, Asia/Saigon**. Trạng thái: **chưa hoàn tất Phase 8, NO-GO**.

> **Cập nhật Claude (19/11/2026, chiều):** mục 5 và các bước 2–5 ở mục 6 đã chạy xong trên CANDIDATE: integration **31/31**, DB gate **PASS 0 skip** (90/503/348/163 + AI-PG 12), contracts **19/19**, smoke PASS, ops 72/78 host (6 MODULE_NOT_FOUND) + dependency files 7/7 trong container lock frozen, E2E **80 pass / 5 fail ngoài scope (EAN, visual verification) / 14 skip optional**. Chi tiết sửa: `CANDIDATE/test-results/remediation/phase8-fixes.md`; báo cáo đề xuất đã cập nhật (mục L, M) tại `test-results/remediation/report-proposed.md`. Còn lại: thay báo cáo thật trong `docs/reports/`, port các fix sang HEAD (mục M), Caddy nonroot proof.

## 1. Phạm vi người dùng đã chốt

Người dùng đã chọn rõ **“Chốt phạm vi remediation cũ”** khi được hỏi về HEAD mới. Không mở rộng sang monitoring-service hoặc thay đổi lending/return theo shelf vừa merge.

- Repository gốc: `C:\Users\hungx\Desktop\Work\Work\KLTN\smartbook-system`.
- Baseline audit ban đầu: `324f8d13953a8694f08994b5b8562c3569ae7fcb`.
- HEAD quan sát sau các cập nhật bên ngoài: `85303e1dc8e486cf8f16434d702120b129d799c9`, branch `hungg`.
- Agent remediation **không commit/push**. Commit `43ed99f` là snapshot công việc đang làm do cập nhật bên ngoài; `4163175` thêm monitoring; `85303e1` merge nhánh khoa.
- **Thư mục làm việc cho kiểm thử còn lại:** `C:\Users\hungx\Desktop\Work\Work\KLTN\smartbook-system\.git\remediation-final-candidate` (gọi tắt là `CANDIDATE`).
- CANDIDATE là bản sao cô lập, **không phải một branch/worktree Git độc lập**. Không chạy lệnh Git thay đổi trạng thái từ đây; không chép đè hàng loạt về HEAD mới.

Các yêu cầu đầy đủ nằm trong attachment:
`C:\Users\hungx\.codex\attachments\4a255402-6251-4b52-a080-80b9a98171db\Pasted text.txt`.

## 2. Những việc đã có bằng chứng

Các số dưới đây là checkpoint riêng, không cộng các lần chạy chồng lặp thành một tổng duy nhất.

- Node 24.16.0: Borrow **348**, Inventory **503**, Auth **90**, Analytics **163**, Shared **37**, Gateway **22** PASS; tổng checkpoint **1.163**, zero fail/skip. Borrow/Auth/Analytics có provenance lock trước lần pin Multer; dependency graph của chúng không đổi. Final mandatory gate trên lock cuối vẫn cần chạy.
- AI image cuối: Python **3.12.16/Trixie**, full **1.639 PASS +166 subtests**; 12 PG-only test bị skip trong full offline run đã được chạy riêng **12/12 PASS, zero skip**; quota/boundary **32/32 PASS**; offline CPU/browser, nonroot và owner-before-runtime-schema proof PASS.
- AI image: `smartbook-remediation-ai312:phase6`, ID `sha256:d666321aadb1b4e9bc765195d25ef615f6d0c4ef3b79ac04dabcb9b3a4202e1e`.
- Inventory cuối: Multer **2.5.0**, thêm giới hạn tên/depth/index multipart vì version upgrade một mình chưa đủ. **15/15** upload tests PASS. Runtime ID `sha256:4a14c5626a264770e23a172424f5a0e42344d35fb37506c4f045a2e0329ebc1f`; fresh evidence volumes writable UID1000, HTTP/metrics/SIGTERM PASS.
- Web nonroot/CSP/assets PASS; browser fine-payment lost-response retry **1/1 PASS**, ghi tiền đúng một lần. Đây chưa phải full E2E.
- Web unit **82/82**, mobile unit **216/216**, workspace config **84/84**, lint/typecheck/web+mobile build PASS ở checkpoint đã ghi. Không coi đó là chứng nhận HEAD mới.
- Cross-service contract **19/19 PASS**. Fixture reserve retry đã sửa để dùng cùng `expires_at`, không nới kiểm tra payload.
- SB01–SB24: **24/24 PASS**, đối chiếu **68 exact non-skipped TAP assertions**. Xem `docs/tasks/SB24_FINAL_REGRESSION_MAP.md` và proof JSON liên quan.
- Actual encrypted recovery: Auth14/Inventory69/Borrow29/AI11 = **123 bảng**, **40.048 hàng**; table/sequence/schema/object/file hashes, 8 synthetic business invariants và HNSW vector search preserved. Target retained `smartbook-recovery-dcf0db2f`; bộ mã hóa từ `c573b903`. Restore command **73,836 giây** chỉ là số đo QA, **không phải production RTO**.
- Đã sửa lỗi restore lớn do `pg_restore --list` đóng pipe sớm: đọc hết stream để GPG hoàn tất integrity check, vẫn giữ exit status lỗi. Không reset/drop target để làm lại; target cũ được giữ riêng.
- Log application/Caddy và stdout lỗi E2E/integration được che trước khi in; capture bị truncate/timeout bị loại bỏ fail closed. Một token phiên QA từng xuất hiện trong log thô đã được blacklist, log đã redacted. Không đọc/in lại dữ liệu credential.
- SMTP QA được cố định Mailpit:1025/blank credentials; loại bỏ SMTP_* thừa kế từ máy phát triển.

## 3. CANDIDATE được phục hồi như thế nào

Không dùng application source đang thay đổi trên HEAD mới để giả định lại kết quả cũ.

- Node src/test/prisma/package được copy từ **đúng retained test containers** đã đạt các suite trên.
- AI `/app` từ đúng image d666; hash của cả 5 Docker/dependency files khớp proof cuối.
- Hạ tầng lấy từ Git `43ed99f`, overlay có liệt kê các bản sửa QA/owner/redaction sau đó.
- Root package/lock/workspace lấy từ retained SSL test image. Lock SHA256 chính xác:
  `938b5d875b8a4e6cb5ac0a3def8414bc08d009ea080726e659081998bd49c4af`.
- Manifest integration giữ **31 flow baseline**, không thêm EAN classification. Bản script ngoài scope được giữ tại `CANDIDATE\.git\excluded-scope`, không xóa hoặc làm yếu test completeness.
- Web/mobile/E2E source lấy từ snapshot43ed; riêng fine retry E2E có bổ sung chờ response thật trước khi assert toast. Runtime UI dùng image đã giữ, không rebuild bằng HEAD mới.
- Provenance: `CANDIDATE\frozen-app-provenance.json`, `CANDIDATE\.git\infrastructure-source-manifest.json`.
- Static infrastructure preflight **38/38 PASS**.
- Khi fresh QA phát hiện thiếu 4 runtime DB passwords ở dev init, đã sửa **chỉ trong CANDIDATE**: `docker-compose.yml`, `.env.example`, `tests/production-readiness/runtime-role-bootstrap.test.mjs`. Hai regression RED rồi **2/2 GREEN**. Đã chạy rõ ràng owner script trên fresh QA để tạo 4 role; không reset/drop/reinit. Các app QA vẫn dùng owner URLs để chạy fixture/migration, không coi đó là production least-privilege proof.
- Infrastructure provenance đã refresh bổ sung hash của ba file role fix và project mới.

## 4. QA hiện tại

- Project: **`smartbook-qa-8f2bf406`**; state: `CANDIDATE\.git\frozen-qa-state.json`.
- Gateway `http://localhost:13000`; UI `http://localhost:15173`; PG loopback15432; Mailpit18025.
- Private env chỉ ở `CANDIDATE\.git\qa-testing\test.env`. **Không cat, in, commit hoặc đưa env vào artifact.**
- Exact runtime aliases và trạng thái startup: `CANDIDATE\test-results\remediation\frozen-qa-ready.json`.
- Auth/Inventory/Borrow seed **3/3 PASS**, dùng retained runtime images, không build source mới.
- AI owner migration chạy trước runtime với `AI_SCHEMA_MANAGED_EXTERNALLY=true`.
- QA cũ `smartbook-qa-9430d4a3` và tất cả volume/data được giữ. Các core container QA cũ đã dừng để tránh conflict; không `down -v`.
- Docker Desktop từng tự shutdown/hang do ENOSPC khi ghi log. Restart thường timeout; đã dừng đúng Docker Desktop + distro `docker-desktop` rồi mở lại, **không factory reset/prune/delete volume**. API đã phục hồi (29.8.2). Project mới tránh stale Compose rename conflicts. Default project `smartbook-system` đang chạy tính năng mới của người dùng: **không đụng vào**.

## 5. Kết quả mới nhất: integration 28/31, còn 3 FAIL

Lượt `pnpm test:stack integration` trong CANDIDATE **đã hoàn tất**, không còn là “chưa chạy”.

Nguồn kết quả:

- `CANDIDATE\test-results\qa\integration\results.json`.
- `CANDIDATE\test-results\remediation\phase8-integration-full.log`.
- Per-flow log trong `CANDIDATE\test-results\qa\integration\`.

Ba flow cần xử lý trước khi chốt:

1. **`borrow-phase2-integration.mjs`**: assertion `10.fine payment` FAIL với `IDEMPOTENCY_KEY_REQUIRED` (14/15 assertion pass). Caller cũ gửi counter fine payment không có request key. Bổ sung stable key phù hợp cho logical operation trong fixture/caller; **không bỏ idempotency check của ứng dụng**. Kiểm tra cả case overpay để nó thực sự tới business validation, không “PASS nhầm” vì thiếu key.
2. **`reservation-concurrency-race-integration.mjs`**: first race trả `201=1,409=3,other=2`; release/consume mỗi nhóm có 1 response ngoài dự kiến. Stock effect/conservation checks vẫn PASS nhưng HTTP contract chưa PASS. Thu đầy đủ status/body đã sanitize và server errors; xác định serialization/timeout/race thật, không đổi assertion thành nhận mọi lỗi. Lượt này 4/7 assertions PASS.
3. **`return-loan-partial-failure-audit.mjs`**: sau injected second-item failure, **same-key retry trả409 pending reconciliation thay vì200**, tại dòng112. Có `LOAN_RETURN_UNRESOLVED`. Cần đối chiếu approved durable operation recovery và ADR; xác định implementation defect hay fixture kỳ vọng không còn phù hợp. Không xóa outbox/manual records, không tự sửa stock/money và không nới expectation chỉ để xanh.

Sau fix: chạy từng flow có vấn đề, rồi chạy lại đủ **31/31** với cùng frozen scope; ghi rõ source changes/test evidence.

## 6. Những việc Claude cần làm tiếp, theo thứ tự

1. **Đọc scope/provenance và kiểm tra QA đang healthy**. Không dùng HEAD85303 hoặc `.git/qa-testing` ở repository gốc nhầm với env trong CANDIDATE. Không khởi động test trùng tiến trình đang chạy; khi bàn giao, integration31 đã kết thúc.
2. **Sửa ba integration failures trên**, bổ sung regression hợp lý, giữ approved policies và custody/financial invariants.
3. **Chạy final mandatory DB gate hoàn chỉnh từ CANDIDATE:**
   `pnpm test:stack db`.
   Runner dùng đúng Node24/OpenSSL3 test Dockerfile; phải chạy Auth/Inventory/Borrow/Analytics và AI12 PG tests, **zero mandatory skips**, xuất combined manifest. **Gate này chưa bắt đầu trên CANDIDATE: 0 suites, chưa có combined manifest.** Không ghép các file checkpoint cũ để giả thành một lần PASS.
4. **Chạy full ops/security gate** từ CANDIDATE với:
   `SMARTBOOK_TEST_CADDY_IMAGE=smartbook-qa-caddy:324f8d13953a8694f08994b5b8562c3569ae7fcb`
   và `node --test --test-concurrency=1 tests/production-readiness/*.test.mjs tests/production-readiness/integration/*.test.mjs`.
   Caddy image đã có sẵn. Có thể cần cung cấp junction `node_modules` cho các service/packages trong CANDIDATE nếu focused dependency tests không resolve được module; hiện root và apps/web đã có junction. Kiểm chứng version trước khi dùng dependency từ workspace mới; ưu tiên đúng retained image graph. Không thêm payload case mới chỉ để mở rộng phạm vi.
5. **Full E2E và smoke/contract**: `pnpm test:stack contracts`, `pnpm test:stack e2e`, `pnpm test:stack smoke`. Có Edge trên máy, dùng `PLAYWRIGHT_CHANNEL=msedge` khi cần; runner đã đặt retries0/traceoff, simulator nội bộ. Toàn bộ E2E chưa chạy; chỉ fine-retry targeted1/1 có bằng chứng. Không bật `VNPAY_SANDBOX`, paid AI hoặc `E2E_LIVE_BOOK_SOURCES`. Ghi rõ optional/external skips; mandatory test không được skip im lặng. Tránh chạy E2E và các business integration flow cùng lúc trên một dataset.
6. **Chốt báo cáo và artifact**. Báo cáo thật `docs/reports/SMARTBOOK_PRODUCTION_READINESS_REMEDIATION_REPORT.md` vẫn là draft cũ, có nhiều dòng Phase5/6 đã stale. Bản cập nhật đề xuất nằm ở repository gốc `test-results/remediation/report-proposed.md`; nó cũng cần đổi trạng thái Docker đã phục hồi và integration28/31, rồi thêm final gate results. Báo cáo phải có A–J theo prompt,21finding với initial/verification/rootcause/files/migration/tests/result/risks, U01–09, SB24 matrix, quyết định GO/CONDITIONAL/NO-GO và scope cũ rõ ràng. Không chứng nhận HEAD85303. Cần tạo source/provenance/patch bàn giao có thể review, **không archive cả `.git` hoặc private env/node_modules**; một số fix cuối chỉ nằm trong CANDIDATE.

## 7. Bằng chứng và giới hạn bắt buộc giữ

Các artifact Phase1–7 ở repository gốc `test-results/remediation/`; Phase8 mới ở CANDIDATE `test-results/`.

- `p6-node-validation-checkpoint.json`, `p6-node-runtime-package-graphs.json`.
- `phase6-ai/final-source-hashes.json`, `phase6-ai/final-image-inventory.json`, `phase6-ai-trivy-final.json`.
- `recovery-drill-c573b903.json`, `recovery-full-resume-fresh.log`.
- `p6-fine-retry-browser-green.log`, `p6-web-nonroot-green.log`, `p6-cross-service-contracts-green.log`.
- `docs/tasks/DEPENDENCY_ADVISORY_TRIAGE.md`, `CONTAINER_RUNTIME_ADVISORY_TRIAGE.md`, `AI_RUNTIME_DEPENDENCY_UPGRADE_PLAN.md`.
- `docs/decisions/001-borrow-approved-operation-recovery.md` và migration preflights dưới `docs/tasks/`.

Không gọi dependency/image là sạch:

- Final pnpm snapshot:3entries (Zod high, Glob/Minimatch moderate). Picomatch2.3.2 vẫn bị Trivy báo dù biến mất khỏi pnpm response. Không coi scanner discrepancy là đã sửa.
- AI pip-audit:67audited/0findings, **Torch+cpu bị skip**; normalized base OSV0 không thay thế native coverage. Trivy OS1critical/477high, vendor-no-fix records và setuptools vendored-subset assessment được giữ.
- Node còn npm/tooling findings riêng và OS records; zlib/minizip source false-positive có Debian primary-source evidence, không xóa raw scan.
- Caddy còn conditional go-jose path, hiện không bật embedded ACME server; không tuyên bố toàn binary unreachable. **Chưa có nonroot proof cho Caddy**, chỉ Node/AI/web.
- RabbitMQ3.13 còn unsupported; không tự major-upgrade broker/data tại lúc chốt.
- Hosted CI với future committed source, VPS, historical production data, real VNPay/refund, real alert receiver/rota, sustained VPS-equivalent load và mobile thiết bị thật vẫn chưa xác minh. Không bịa bằng chứng hoặc người phụ trách. Giữ **NO-GO** khi các gate bắt buộc chưa PASS.

## 8. Quy tắc bảo toàn

- Không commit/push/deploy, không reset/clean/checkout để xóa thay đổi, không xóa file người dùng/ledger/outbox/history/volumes.
- Không chạy `pnpm test:stack down` (có `down -v`). Nếu cần dừng, dùng `stop` đúng frozen project.
- Giữ nguyên `apps/web/public/__tmp_enrich.json`, audit gốc, và staging/deletions của repository cha KLTN.
- Không đọc/in credentials/DSNs/JWT/private env. Dùng sanitizer và chỉ publish curated artifacts.
- Giữ current HEAD/new monitoring/shelf work của người dùng; chỉ thao tác snapshot cũ và đúng frozen QA project cho phần được bàn giao.
