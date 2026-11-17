# SmartBook — Testing & CI hardening

## A. Executive Summary

Ngày thực hiện: 17/11/2026. Branch: `khoa`. Baseline: `908bc956fc7427b6a2386ee1fa9ed3aae0bf2ae4`.

Đã audit test thực tế, source liên quan, package scripts, Playwright, Pytest, Node Test Runner và CI. Đã đọc `AGENTS.md`, `CLAUDE.md`, persona test engineer, testing patterns và các skill review/CI/browser/testing liên quan. Chỉ chuyển branch khi working tree an toàn. File có sẵn `apps/web/public/__tmp_enrich.json` được giữ nguyên; không commit/push/merge, không thay branch protection hoặc workflow production.

Trước thay đổi, repository đã có nhiều test nghiệp vụ tốt, đặc biệt procurement, payment, metadata và AI/reorder. Vấn đề chính là cách chạy và độ tin cậy của bằng chứng: CI chưa target `khoa`; chỉ chạy một phần script integration; ba suite borrow PostgreSQL bị skip nếu thiếu URL; E2E payment simulator/staff OTP chưa được bật; một số fixture chọn tồn tổng thay vì tồn khả dụng hoặc dùng warehouse không được seed. Hai script audit chỉ in log mà không fail khi vi phạm. Assertion invoice concurrency cho phép không có request nào thành công.

Đã bổ sung môi trường Docker dùng database/volume/project riêng, secrets ngẫu nhiên, guard chống chạy nhầm môi trường, manifest 31 integration flows, unit/regression cho tiền cọc/phạt/membership/scope/JSON validation/token revocation, chuyển kho xuyên service và trình duyệt, kiểm chứng persistence OCR, ledger và stock bằng dữ liệu thật. Không mock toàn bộ E2E; chỉ cô lập các biên OCR/provider và dùng VNPay simulator địa phương.

Ba defect source đã được tái hiện bằng test đỏ rồi sửa tối thiểu: token vẫn hợp lệ khi login rồi khóa tài khoản trong cùng giây; transfer receiving và supplier receiving chấp nhận boolean/array làm số lượng. Không thay đổi UI/UX hoặc schema/API endpoint.

CI YAML đã được cập nhật, kiểm tra cấu trúc và chạy các nhóm tương ứng ở local. **Hosted GitHub Actions của thay đổi này: NOT RUN** vì chưa được phép push. Cấu hình workflow không đồng nghĩa branch protection đã bật.

## B. Testing Coverage Matrix

`PASS` = đã thực thi; `SKIPPED` = runner báo skip; `NOT RUN` = chưa thực thi; `NOT APPLICABLE` = tầng đó không phù hợp với phạm vi. Bảng mô tả quy tắc/luồng đã kiểm tra, không phải phần trăm line/branch coverage. Unit dùng fake ở biên dependency không chứng minh transaction database; các cột integration dùng Docker PostgreSQL/service thật.

| Module / nghiệp vụ | Priority | Unit | Integration | E2E | Trạng thái / bằng chứng |
|---|---|---|---|---|---|
| Auth, trạng thái tài khoản, OTP, role, token revocation | P0 | PASS — auth tests + shared revocation, timestamp dưới một giây | PASS — admin-user-management, email-otp, warehouse-assignment, security-phase5 | PASS — login/role/account lifecycle + OTP | Khóa tài khoản và đổi quyền phải vô hiệu token cũ; login mới vẫn dùng được |
| Warehouse scope, READ/WRITE, admin không mặc nhiên superuser | P0 | PASS — borrow warehouse-scope, auth/scope tests hiện có | PASS — warehouse-scope, borrow-warehouse-scope, stock-data-scope, STT audit, copilot security | PASS — role/read UI smoke; cross-warehouse denial ở integration | Kiểm tra 403 và dữ liệu không đổi; đúng kho sở hữu phiếu, không suy diễn từ mọi kho được tham chiếu |
| Wallet, cọc, hoàn cọc, phạt theo từng bản, ledger và rollback | P0 | PASS — money-rules, fine-upsert, wallet/payment tests | PASS — 41 PostgreSQL cases; borrow-phase2, renewal-fine-concurrency, partial-failure reconciliation | PASS — hold/refund + fine payment UI | Decimal conservation, cọc lớn/nhỏ hơn phạt, UTC overdue, hư hỏng/mất, không thu/hoàn hai lần |
| Reservation → pickup → loan → return; race/idempotency | P0 | PASS — inventory reservation guards, membership-item-count, borrow tests | PASS — reservation-pickup-loan-return, reservation-concurrency-race, limit-item-count | PASS — 2 pickup/return flows | Fixture dùng available stock ở vị trí pickable; có assertion wallet available/held |
| VNPay / nạp ví / thanh toán phạt | P0 | PASS — signature/amount/return/IPN tests hiện có | PASS — PostgreSQL duplicate/concurrent IPN, rollback | PASS — 6 local simulator cases | Simulator thực qua gateway; callback replay phải giữ payment count = 1; sandbox ngoài: NOT RUN |
| Procurement PR/PO, nhiều delivery/GRN, invoice độc lập, close/revise/return/matching | P0 | PASS — procurement-document/receipt/reconciliation, PO line/revision/response | PASS — purchase-supplier-receiving, document-workflow, close-remaining, revision, invoice/GRN concurrency, supplier-return, three-way-matching | PASS — purchase-to-putaway (repair run) | Invoice race yêu cầu đúng một success; GRN/putaway kiểm tra stock, không chỉ HTTP |
| Transfer request → approve → picking → outbound → receiving | P0 | PASS — counting/state/validation tests | PASS — transfer-receiving-counting + warehouse-transfer-lifecycle | PASS — destination receiving UI + real API setup | Source -2 / destination +2, không nhập sớm, tổng tồn bảo toàn, concurrent receipt/replay chỉ ghi một lần |
| Outbox, consumer durability, return reconciliation | P0 | PASS — existing outbox/reconciliation unit | PASS — outbox-durability, gateway-consumer-durability, partial-failure audit | NOT APPLICABLE | Failure injection + persisted queue/retry/dedup assertion; không cần UI riêng cho worker |
| Catalog, metadata, duplicate/provenance, AI OCR save boundary | P1 | PASS — inventory metadata/provenance; Python OCR/fusion/validation; web tests | PASS — service contracts + AI PG metadata/vector store | PASS — OCR boundary fixtures + real catalog persistence | OCR fixture chỉ thay response provider; create/update/read catalog thật, quantity = 0; live OCR quality: NOT RUN |
| AI reorder, lead time, safety stock, budget, forecast, action confirmation | P0/P1 | PASS — Python stock_request/forecast/action/planner tests hiện có | PASS — AI Postgres/pgvector 12 cases, scoped endpoints qua security integration | PASS — real reorder budget; copilot provider fixture | Không dùng model trả phí; live model correctness/quality: NOT RUN |
| Supplier portal / anonymous supplier submission | P1 | PASS — supplier/procurement validation hiện có | PASS — supplier-portal, purchase-supplier-receiving | PASS — anonymous portal trong procurement flow | Portal và purchase-to-putaway dùng stack thật |
| Membership, notifications, availability alert | P1 | PASS — plan/dates/item-count/notification/availability tests | PASS — borrow-limit-item-count, availability-alert, email-otp | PASS — form/read UI smoke; alerts ở integration | Membership query đếm bản sách đang mượn, không chỉ số phiếu |
| Analytics / dashboard | P1 | PASS — analytics service tests | PASS — analytics-integration + 7 contracts + 3 timezone PG | PASS — real budget + read-only page smoke | Query/filter/scope test hiện có; không tuyên bố visual coverage toàn dashboard |
| Mobile | P1 | PASS — Jest 33 suites, 216 tests | NOT RUN — không có device backend integration trong scope hiện tại | NOT RUN — không có emulator/device suite hiện hữu | Typecheck/build cũng được verify; không quy đổi component test thành device E2E |

Danh mục source test/case/assertion/skip có thể tái tạo bằng `python scripts/testing/audit_tests.py`: [TEST_INVENTORY.json](TEST_INVENTORY.json). Đây là chỉ mục tìm kiếm bằng regex, có thể thiếu tên case động/parametrized; không phải công cụ đo coverage.

## C. Files Changed

Danh sách đầy đủ theo từng nhóm; mỗi đường dẫn là file, các dấu `/` trong mô tả service là relative từ repository root.

**Test mới**

- `apps/web/e2e/warehouse-transfer-lifecycle.spec.ts`
- `services/borrow-service/test/membership-item-count.test.js`
- `services/borrow-service/test/money-rules.test.js`
- `services/borrow-service/test/warehouse-scope.test.js`
- `tests/testing-safety.test.mjs`

**Test đã sửa**

- `apps/web/e2e/admin-user-lifecycle.spec.ts`
- `apps/web/e2e/ai-import-ocr.spec.ts`
- `apps/web/e2e/customer-reservation-pickup.spec.ts`
- `apps/web/e2e/helpers.ts`
- `apps/web/e2e/purchase-to-putaway.spec.ts`
- `apps/web/e2e/vnpay-payment.spec.ts`
- `apps/web/e2e/vnpay-sandbox.spec.ts`
- `packages/shared/test/token-revocation.test.cjs`
- `services/auth-service/test/email-otp-auth-flow.test.js`
- `services/auth-service/test/refresh-tokens.test.js`
- `services/auth-service/test/token-revocation-queue.test.js`
- `services/borrow-service/test/reservation-idempotency.db.test.js`
- `services/inventory-service/test/procurement-receipt.test.js`
- `services/inventory-service/test/transfer-receiving-counting.test.js`
- `tests/workspace-config.test.mjs`

**Source / seed / build context**

- `services/ai-service/.dockerignore`
- `services/auth-service/prisma/seed.js`
- `services/auth-service/src/controllers/auth.controller.js`
- `services/auth-service/src/lib/refresh-tokens.js`
- `services/auth-service/src/lib/token-revocation.js`
- `services/auth-service/src/middlewares/redis-auth.middleware.js`
- `services/inventory-service/src/controllers/transfer-receiving.controller.js`
- `services/inventory-service/src/services/procurement-receipt.service.js`

**CI và cấu hình**

- `.github/workflows/ci.yml`
- `.gitignore`
- `apps/web/playwright.config.ts`
- `apps/web/eslint.config.js`
- `docker-compose.test.yml`
- `package.json`

**Harness và integration scripts**

- `scripts/borrow-limit-item-count-integration.mjs`
- `scripts/borrow-renewal-fine-concurrency-integration.mjs`
- `scripts/concurrent-invoice-over-po-integration.mjs`
- `scripts/copilot-3-2-security-integration.mjs`
- `scripts/gateway-consumer-durability-integration.mjs`
- `scripts/outbox-durability-integration.mjs`
- `scripts/reservation-concurrency-race-integration.mjs`
- `scripts/return-loan-partial-failure-audit.mjs`
- `scripts/testing/audit_tests.py`
- `scripts/testing/environment.mjs`
- `scripts/testing/integration-flows.json`
- `scripts/testing/run-integration.mjs`
- `scripts/testing/stack.mjs`
- `scripts/testing/stock-fixture.mjs`
- `scripts/warehouse-assignment-integration.mjs`
- `scripts/warehouse-scope-stt123-audit.mjs`
- `scripts/warehouse-stock-data-scope-integration.mjs`
- `scripts/warehouse-transfer-lifecycle-integration.mjs`

**Tài liệu**

- `docs/testing/README.md`
- `docs/testing/SMARTBOOK_TESTING_COVERAGE_REPORT.md`
- `docs/testing/TEST_INVENTORY.json`

Lý do: các nhóm test bổ sung bất biến và regression nêu ở B/E; harness tạo môi trường độc lập và chạy đủ manifest; source chỉ sửa ba defect, seed nhận fixture password, Docker context bỏ cache; CI/config thêm khoa, evidence và cleanup. Tài liệu ghi cách tái chạy và giới hạn.

## D. Test Execution Results

Các lệnh chạy từ repository root. `pnpm verify` bao gồm lint, typecheck, build và các lệnh unit/workspace; **không bao gồm** integration Docker hoặc Playwright. Test DB bị skip trong lệnh unit được chạy lại với database thật ở hàng riêng, không cộng hai lần để tuyên bố coverage.

| Nhóm / command | Tổng số | Passed | Failed | Skipped | Not Run |
|---|---:|---:|---:|---:|---:|
| `pnpm test:workspace-config` (qua verify) | 84 | 84 | 0 | 0 | 0 |
| `pnpm test:web` (qua verify) | 79 | 79 | 0 | 0 | 0 |
| `pnpm test:mobile` (qua verify) | 216 / 33 suites | 216 | 0 | 0 | 0 |
| `pnpm test:node` (qua verify) | 818 counted cases | 815 | 0 | 3 analytics PG | 0 |
| `pnpm test:ai` (qua verify) | 1609 | 1597 | 0 | 12 PG | 0 |
| `pnpm test:stack db` — borrow | 41 | 41 | 0 | 0 | 0 |
| `pnpm test:stack ai-db` | 12 | 12 | 0 | 0 | 0 |
| `pnpm test:stack contracts` | 19 | 19 | 0 | 0 | 0 |
| `pnpm test:stack integration` | 31 scripts | 31 | 0 | 0 | 0 |
| `pnpm test:stack smoke` → `pnpm test:smoke` | 3 flows | 3 | 0 | 0 | 0 |
| `pnpm verify` | lint/typecheck/build + các unit groups trên | PASS | 0 | xem ghi chú | 0 |
| `pnpm --filter <service> exec prisma validate` | 3 schemas | 3 | 0 | 0 | 0 |
| Docker Compose config core / ai+monitoring | 2 configurations | 2 | 0 | 0 | 0 |
| Hosted GitHub Actions của working tree này | 8 status checks | 0 | 0 | 0 | 8 |

| `pnpm test:stack db` — analytics timezone PG | 3 | 3 | 0 | 0 | 0 |
| `pnpm test:stack e2e` — full unfiltered, trước sửa hai lỗi test | 89 | 73 | 2 | 14 | 0 |
| `pnpm test:stack e2e ai-import-ocr.spec.ts purchase-to-putaway.spec.ts --grep "OCR never writes\|the page shows either\|purchase request through"` — repair verification | 3 | 3 | 0 | 0 | 0 |

**Diễn giải E2E:** full unfiltered đã thực thi mọi case được cấu hình (12.5 phút, không flaky, 2 failures đều là fixture/readiness nêu ở E). Sau sửa, chạy lại ba case liên quan và PASS 3/3 (1.0 phút), bao gồm cả hai case từng fail và regression persistence OCR. Như vậy **75 case runnable đã được xác minh qua các lượt chạy**, 14 case tùy chọn SKIPPED. Không gọi lượt full đầu tiên là PASS và không tuyên bố có một lượt unfiltered mới xanh sau sửa test.

14 skips: 9 live ISBN/provider, 4 VNPay sandbox ngoài, 1 number-input exploratory audit (`NUMBER_INPUT_AUDIT=1`, có thể chạy riêng, timeout 20 phút). Không skip staff OTP, local VNPay simulator, fine-payment, reorder budget hoặc P0 procurement/transfer. Các bài membership number fields vẫn đã chạy trong full suite. Smoke, PG, integration và unit là các lượt chạy riêng, không thay thế E2E.

Artifacts local: `test-results/qa/playwright-full-results.json` giữ kết quả full trước repair; `test-results/qa/playwright-repair-results.json` giữ kết quả repair. HTML/JSON/JUnit mặc định hiển thị lượt browser gần nhất.

Ba analytics PG tests bị skip trong unit do thiếu `ANALYTICS_TEST_PG_URL`; runner `db` hiện đã đưa chúng vào CI với session-local temporary tables.

Node chi tiết: shared 31, gateway 15, auth 89, inventory 343, borrow 179, analytics 158 passed + 3 skipped. Ba borrow suite PostgreSQL bị bỏ qua ở cấp suite khi không có URL trong `verify` (41 cases không xuất hiện trong tổng counted cases 818); chúng đã được chạy riêng và PASS 41/41. Python 12 skips chính là hai file PostgreSQL đã chạy riêng và PASS 12/12; 153 subtests passed được Pytest báo riêng, không cộng vào 1597.

Inventory/analytics contracts lần lượt 12/7. Smoke gồm purchase, reservation và borrow; riêng borrow in 15/15 checks. Strict invoice concurrency được chạy lại sau khi nâng assertion, 4/4 checks PASS. Hai mutation probes đều bị test phát hiện.

Log cuối `pnpm verify`: exit 0; không fail lint/typecheck/build/test. Warnings có sẵn gồm FastAPI `on_event` deprecation, Browserslist data cũ và build chunk size; không bỏ qua lỗi để đạt kết quả. Chỉ mục audit gồm 272 file test source.

Lượt debug OCR đầu tiên có lỗi selector chờ PUT trong khi service dùng PATCH; trace cho thấy POST tạo sách thành công và UI reset. Đã sửa test theo source thật. Procurement E2E cũng tái hiện trên database sạch: fixture cũ Nhà Giả Kim không nằm trong catalog seed hiện tại. Đã kiểm tra PostgreSQL và đổi sang sách seed thật Dế Mèn Phiêu Lưu Ký; không thay logic tìm kiếm hay nới assertion. Các lượt debug thất bại không được dùng làm kết quả PASS.

Lệnh tái chạy và điều kiện môi trường ở [README.md](README.md). Chạy `down` sau từng project; browser job dùng database mới, không dùng dữ liệu đã bị integration thay đổi. Có thể dùng `PLAYWRIGHT_CHANNEL=msedge` tại Windows nếu browser bundled không tải được. Các artifacts runtime nằm trong `test-results/qa/`, `apps/web/test-results/` và `apps/web/playwright-report/`, được gitignore; không chứa file secrets `.git/qa-testing/test.env`.

## E. Defects Found

| Defect / khoảng trống | Bằng chứng | Sửa và xác minh |
|---|---|---|
| P0: token được phát hành trước khi khóa tài khoản nhưng trong cùng giây vẫn dùng được | warehouse-assignment integration test 13 từng nhận 200 sau LOCKED; 3 precision regressions RED | JWT iat, refresh issuedAt và revocation cutoff giữ fractional seconds; OTP challenge so sánh cùng độ chính xác. 50 focused security tests GREEN; full integration 31/31 gồm khóa/đổi quyền/login lại |
| Transfer nhận `true`, `[]`, array hoặc object như số lượng | 5 malformed JSON unit cases RED trước type guard | Chỉ number/string được đi tiếp vào parser hiện có; transfer 13 focused tests GREEN, counting + lifecycle integration PASS |
| Supplier receipt cùng lỗi coercion JSON | 5 malformed JSON cases RED | Type guard tối thiểu; 19 receipt focused tests GREEN, procurement integration PASS |
| Invoice concurrency test cho phép 0 success | Assertion cũ chỉ `succeeded.length < 2` | Đổi sang `=== 1`; dedicated strict flow 4/4 PASS |
| Audit script có thể exit 0 khi bất biến bị vi phạm | Chỉ xuất SQL/API snapshots | Thêm assert 403 + stock không đổi, reconciliation queue đúng một bản ghi của item đã thành công; chạy trong manifest |
| Procurement E2E tham chiếu sách đã không còn trong seed | Database sạch cũng trả không có variant Nhà Giả Kim; dialog hiển thị Không tìm thấy sách | Dùng Dế Mèn Phiêu Lưu Ký đã xác nhận tồn tại trong PostgreSQL; giữ nguyên toàn bộ PR/PO/supplier/receiving/putaway UI và stock assertions |
| Fixture scope/stock tạo lỗi giả hoặc phụ thuộc seed cũ | Warehouse không có trong seed; on-hand bị coi là available; loan chọn stock không pickable | Resolve warehouse bằng code seed thật, query available tại BIN/SHELF_COMPARTMENT, owner-aware transfer scope; không bỏ kiểm tra quyền |
| E2E selector payment cũ và fine case có thể skip vì không có dữ liệu | Native select không còn tồn tại; phụ thuộc fine có sẵn | Chọn Radix combobox theo accessible role; tạo fine trong DB QA rồi kiểm tra PAID và replay không nhân đôi |
| E2E reservation có thể chọn branch ngoài scope librarian | Public catalog mặc định không cố định branch | Chọn chi nhánh phù hợp nhân viên seed, xác minh warehouse trên reservation, ledger/balance và cleanup thật |
| Generated Playwright report bị ESLint coi là source | HTML/trace reporter tạo bundle minified dưới playwright-report; verify lặp lại báo 3528 lint errors trên generated assets | Global ignore chỉ dist/playwright-report/test-results; source và E2E test vẫn lint đầy đủ |
| OCR degraded-mode E2E assert trước khi capabilities response về | AI profile tắt, snapshot vẫn Đang kiểm tra AI OCR; response gateway khoảng 7 giây, assertion chỉ đợi 5 giây | Đợi response capabilities thật rồi assert trạng thái UI, không thêm fixed sleep hoặc bỏ test |
| CI thiếu khoa, thiếu DB suites/flows/artifact | Baseline workflow và env-gated test inspection | Cấu hình trigger + 8 status checks, 31 flows, real DB, payment/OTP, always artifacts + cleanup |
| AI Docker context hút research virtualenv/cache nhiều GB | Local build context thực tế khoảng 2.4 GB | Bổ sung .venv*/.hf-cache vào .dockerignore, không loại runtime source/model assets |

Hai mutation probes thực tế (đổi `Decimal.min` thành `max` trong split cọc và đảo warehouse filter) đều làm test thất bại; source đã khôi phục nguyên byte. Đây là hai phép kiểm tra độ nhạy, **không phải mutation score toàn repository**.

Không ghi nhận thêm lỗi source cần sửa trong các lượt xác minh cuối; các giới hạn chưa kiểm chứng được liệt kê bên dưới, không gắn PASS cho chúng.

## F. CI/CD Assessment

| Hạng mục | Cấu hình sau thay đổi | Kết quả xác minh |
|---|---|---|
| Push `khoa` | Có, cùng `main`, `hungg` | YAML PASS; hosted execution NOT RUN |
| PR target `khoa` | Có; target branch, không phải chỉ source branch | YAML PASS; hosted execution NOT RUN |
| Unit/workspace | `pnpm install --frozen-lockfile`, Python requirements, `pnpm verify`, pipefail | Local execution ghi ở D |
| Integration | Project/volume/database riêng, seed, AI không provider key, contracts, PG, 31 flows, smoke | Local execution ghi ở D |
| E2E | Chromium cài bằng Playwright, project sạch, VNPay simulator, Mailpit OTP | Local Edge execution ghi ở D; CI Chromium NOT RUN |
| Artifacts | verify log; AI PG JUnit; integration log + JSON; Playwright HTML/JSON/JUnit/traces/screenshots; giữ 7 ngày | `if: always()`, service logs khi failure trước upload |
| Failure behavior | Nonzero propagates, không continue-on-error, có timeout; teardown always | Runner/manifest guards test; không mask lỗi test |
| Secrets / chi phí | Secrets ngẫu nhiên dưới .git; provider keys rỗng; localhost payment simulator | Không dùng production DB, merchant credentials hoặc paid model |
| Production deploy | Không thay đổi | Chỉ `.github/workflows/ci.yml` được chỉnh |

GitHub read-only protection lookup cho `khoa` trả **404 Branch not protected** tại thời điểm kiểm tra. Không thay đổi cài đặt. Đề xuất yêu cầu tám checks: **Full workspace verification**, **Integration flows (Docker)**, **E2E flows (Playwright)**, **AI integration (Postgres + pgvector)**, **Prisma schema (auth-service)**, **Prisma schema (inventory-service)**, **Prisma schema (borrow-service)**, **docker-compose config validation**; thêm PR review và cấm force push khi được phép.

Tài liệu nền tảng: [Docker Compose environment](https://docs.docker.com/compose/how-tos/environment-variables/envvars/), [Compose !override](https://docs.docker.com/reference/compose-file/merge/), [Playwright reporters](https://playwright.dev/docs/test-reporters). Fractional NumericDate phù hợp [RFC 7519 §2](https://www.rfc-editor.org/rfc/rfc7519.html#section-2); [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) nhận iat tường minh và tính expiration từ đó.

## G. Remaining Risks

- Chưa push nên chưa thể kiểm chứng GitHub-hosted Node 20/Python 3.10/Ubuntu/Chromium. Local dùng Windows, Node 24, Python 3.14 và Microsoft Edge; tải bundled Chromium từ CDN bị timeout. Không coi local PASS là hosted CI PASS.
- Lượt unfiltered E2E trước sửa test có 2 failures; repair run đã xác minh lại cả hai thành công. Chưa lặp lại toàn bộ 89 case sau thay đổi chỉ ở readiness/fixture; kết quả D giữ nguyên lịch sử, không gộp thành một full-run PASS.
- Không đo line/branch coverage, không chứng minh mọi hoán vị concurrency hay mọi trạng thái sản phẩm. Matrix nói rõ các luồng được thực thi, không tuyên bố 100% coverage.
- Hai live-model scripts `ai-assistant-integration.mjs`, `cover-search-integration.mjs`, optional `--ai`, live ISBN/provider và VNPay sandbox ngoài môi trường đều NOT RUN theo giới hạn không gọi paid/external production providers. Deterministic unit/provider-boundary tests, PostgreSQL action tests và VNPay simulator đã chạy; chúng không chứng minh chất lượng trả lời live model hay khả năng kết nối merchant thật.
- Mobile device E2E/emulator không có trong bộ suite hiện hữu và chưa chạy. Component/Jest/typecheck/build không thay thế kiểm tra thiết bị.
- Các skip tùy chọn và warning thực tế được ghi ở D. Không bật skip mới để né P0. Runtime logs có thể bị ghi đè khi tái chạy, nên CI lưu artifacts trên từng run.
- Giới hạn sẵn có của revocation queue khi Redis outage + restart auth-service (queue trong RAM) vẫn tồn tại như tài liệu security hiện hữu; thay đổi này chỉ sửa độ chính xác timestamp. Không mở rộng phạm vi thành tái thiết kế cơ chế session.

## H. Final Verdict

**READY WITH LIMITATIONS** cho phạm vi thay đổi QA/CI trên working tree `khoa`; chưa phải phê duyệt merge/deploy.

Các luồng P0 đã chọn trong matrix có bằng chứng thực thi unit + database/service integration + UI khi phù hợp. Ba defect source đã sửa có regression; không còn failure P0 chưa xử lý trong các case đã chạy. Full browser run phát hiện hai lỗi test; cả hai đã sửa và chạy lại thành công, cùng kiểm tra persistence OCR. `pnpm verify` PASS, 31/31 integration flows, 44/44 borrow + analytics PG, 12/12 AI PG và 19/19 contracts PASS.

Giới hạn cần giữ rõ: hosted CI NOT RUN; branch protection chưa bật; 14 E2E optional cases bị skip; live providers/sandbox/mobile device chưa kiểm chứng; chưa có lượt unfiltered E2E mới sau hai sửa test cuối. Cần một hosted run đầy đủ sau khi được phép push để xác nhận môi trường CI. Không đánh giá READY không điều kiện hoặc tuyên bố coverage 100%.

Cleanup đã hoàn tất: project `smartbook-qa-79db6600`, containers, network và volumes thử nghiệm đã được gỡ; file secrets `.git/qa-testing/test.env` đã xóa. Branch vẫn là `khoa` tại baseline SHA, thay đổi còn trong working tree để review. `git diff --check` PASS; workflow deploy production không đổi.
