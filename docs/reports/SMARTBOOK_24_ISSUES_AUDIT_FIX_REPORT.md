# SMARTBOOK — Audit & Fix 24 Business Logic Issues

> Cập nhật bàn giao Git: sau khi hoàn tất báo cáo này, người dùng đã yêu cầu commit và push lên `hungg`. Các ghi chú “chưa/không commit, push” bên dưới mô tả trạng thái tại thời điểm kiểm toán và kiểm chứng, trước yêu cầu bàn giao. Production chưa được triển khai.

Ngày kiểm toán: 2026-11-17 (Asia/Saigon). Đã khôi phục và xử lý24 mục:19 lỗi xác nhận đã sửa,1 đã sửa từ trước,4 thay đổi chính sách đã được người dùng chốt và triển khai. Bốn mục chính sách không được phân loại lại thành lỗi baseline. Chi tiết triển khai tiếp nối và kiểm chứng tại [báo cáo chính sách](SMARTBOOK_APPROVED_POLICIES_IMPLEMENTATION_REPORT.md).

## A. Repository baseline

| Mục | Bằng chứng |
|---|---|
| Repository | `https://github.com/vinhhung04/smartbook-system.git` |
| Thư mục thực sự | `C:/Users/hungx/Desktop/Work/Work/KLTN/smartbook-system` — repository lồng trong workspace ngoài |
| Branch | `hungg` |
| HEAD lúc bắt đầu | `c7b5fa42d4bb79aeb6fc0f44170e81df23410ce5` |
| Remote | Đã `git fetch origin hungg`; `git rev-list --left-right --count HEAD...origin/hungg` = `0 0` |
| Working tree lúc bắt đầu | Chỉ có file untracked của người dùng `apps/web/public/__tmp_enrich.json`; giữ nguyên. Repository ngoài có staging/deletion riêng, không chỉnh sửa |
| Git | Không chuyển branch, không reset/clean, không commit/push |
| Stack | pnpm workspace; Express/CommonJS, Prisma 5.21, PostgreSQL 15, React/Vite web, Expo mobile |
| Môi trường | PostgreSQL audit riêng trên loopback 25432; QA Compose riêng `smartbook-qa-9430d4a3` trên gateway 13000/UI 15173/PostgreSQL 15432; dữ liệu demo mới, không dùng database hiện hữu |

Sau kiểm thử, chỉ các container audit/QA do phiên này tạo được dừng để giải phóng tài nguyên; container, volume và dữ liệu kiểm chứng vẫn được giữ. Không dùng `down -v`, không xóa database. Cấu hình QA/URL và client Prisma kiểm thử nằm dưới `.git/`, không đưa bí mật vào báo cáo.

### Nguồn gốc danh sách

Danh sách SB-01–SB-15 không có trong báo cáo Git hiện tại. Sau khi tìm repository và lịch sử không shallow, đã khôi phục đúng nguồn từ chat ChatGPT kết nối **“Rà soát lỗi nghiệp vụ”**, ID `6afb4f80-d8fc-83ee-b292-0ab6caf3c4dd`, message `10ee8c14-0311-4d98-89ae-1d7d169259bf`, audit cũ nhánh `khoa`, commit `908bc956`.

Bản mô tả gốc đầy đủ của 15 mục đầu được lưu tại [SMARTBOOK_24_ORIGINAL_SOURCE.md](SMARTBOOK_24_ORIGINAL_SOURCE.md). SB-16–SB-24 đối chiếu với master prompt người dùng cung cấp. Các mã SB lịch sử về tracing/outbox/k6 là taxonomy khác và không được dùng thay thế. Mọi kết luận của audit cũ chỉ là giả thuyết; kết quả dưới đây dựa trên code baseline và test mới.

## B. Kết quả kiểm toán 24 lỗi

| ID | Vấn đề gốc | Kết quả audit | Có sửa không | Test/bằng chứng riêng |
|---|---|---|---|---|
| SB-01 | Giới hạn mượn trực tiếp không tính sách đặt trước | CONFIRMED BUG | Có | PostgreSQL: borrowed=3, reserved=2, limit=5, direct+1 trước201/sau409 |
| SB-02 | Thành viên tương lai được áp dụng sớm | CONFIRMED BUG | Có | PostgreSQL: kế hoạch tương lai không được chọn; sweep không lấy đơn giá tương lai |
| SB-03 | Phạt PAID/WAIVED không tăng khi tiếp tục giữ sách | APPROVED POLICY — IMPLEMENTED | Có | Chốt phạt theo kỳ; ngày quá hạn mới tạo khoản mới; miễn tương lai cần quyền và lý do; bảo toàn tiền sử |
| SB-04 | Cùng loan_item được trả nhiều lần | CONFIRMED BUG | Có | Trả lại item đã trả bằng key mới; PostgreSQL đồng thời hai key chỉ một movement |
| SB-05 | AccountError sau consume không có reconciliation | CONFIRMED BUG | Có | PostgreSQL wallet/deposit failure sau consume: outbox bắt buộc được tạo |
| SB-06 | Hai conversion tạo hai loan cho một reservation | CONFIRMED BUG | Có, chung cơ chế SB-23 | Controller baseline trên PostgreSQL tạo hai loan; bản sửa tạo một loan và replay |
| SB-07 | Kiểm kê không xử lý biến động sau lúc đếm | APPROVED POLICY — IMPLEMENTED | Có | Nháp không khóa kho; bắt đầu đếm chụp baseline và khóa vị trí; chốt đếm mở lại; duyệt delta giữ biến động sau đếm |
| SB-08 | Hai GRN đồng thời cho cùng Delivery Note | CONFIRMED BUG | Có | PostgreSQL Promise.all: trước2GRN, sau1GRN |
| SB-09 | Nhiều Delivery Note vượt tổng PO | CONFIRMED BUG | Có | PostgreSQL Promise.all80+80/PO100: trước hai201, sau201/400 |
| SB-10 | Repick cộng lặp vào nhiều dòng cùng variant | CONFIRMED BUG | Có | Tổng xuất trước9, mong muốn/sau7 |
| SB-11 | Nhận điều chuyển bỏ số lượng repick | CONFIRMED BUG | Có | GRN/lines/received totals trước5, sau7 |
| SB-12 | Thiếu quy trình xử lý chênh lệch điều chuyển | APPROVED POLICY — IMPLEMENTED | Có | Hàng hỏng/từ chối cách ly; hàng thiếu không tăng tồn; hồ sơ xử lý có quyền, bằng chứng, ledger và chống lặp |
| SB-13 | Supplier return không tìm được hàng sau putaway | CONFIRMED BUG | Có | PostgreSQL: truy theo movement của đúng GRN và giới hạn allocation đã trả |
| SB-14 | Hủy GRN sau putaway không đảo đầy đủ tồn kho | CONFIRMED BUG | Có | PostgreSQL: unwind putaway rồi inbound; cancellation đồng thời đúng một lần; thiếu hàng409 rollback |
| SB-15 | Đóng PO line khi Delivery Note còn chờ xử lý | CONFIRMED BUG | Có | Pending delivery trước đóng200, sau409; processed delivery vẫn được đóng |
| SB-16 | GRN bỏ dòng Delivery Note | CONFIRMED BUG | Có | Payload thiếu dòng400; dòng thực nhận0 tạo shortage rõ ràng; legacy DRAFT không được post thiếu |
| SB-17 | Invoice NCC trùng khi đồng thời | ALREADY FIXED | Không | Unique index hiện hữu được deploy; Promise.all service thật: một thành công/một409; supplier/series/CANCELLED/case |
| SB-18 | Incoming bỏ toàn bộ SHORTAGE_REPORTED PO | CONFIRMED BUG | Có | SQL PostgreSQL thực qua controller: incoming trước0/sau6; giữ lọc closed/draft/cancelled |
| SB-19 | Sweep ghi đè item đã trả bằng snapshot cũ | CONFIRMED BUG | Có | Promise.all sweep/return với barrier sau scan; không reopen, không tạo audit/phạt stale |
| SB-20 | Batch return dùng chung condition cho mọi item | APPROVED POLICY — IMPLEMENTED | Có | items[] riêng điều kiện/ghi chú/lý do/cọc/phạt, preview, key bền vững và kết quả đối soát từng bản |
| SB-21 | RETURNED che LOST của item đã xử lý trước | CONFIRMED BUG | Có | PostgreSQL mixed LOST+RETURNED cuối phiếu vẫn LOST; notification không nói trả đủ |
| SB-22 | Key không ràng buộc đối tượng/payload | CONFIRMED BUG | Có | Từng release/consume/return có mismatch tests riêng, Promise.all thật, replay cũ và LOST legacy |
| SB-23 | Cancel/convert reservation xung đột | CONFIRMED BUG | Có | PostgreSQL cả hai thứ tự; duplicate conversion; inventory ACTIVE claim ngăn release+consume cùng thắng |
| SB-24 | Replay GRN bỏ warehouse WRITE scope | CONFIRMED BUG | Có | Manager khác kho403 không data; authorized replay200; cả nhánh P2002 kiểm tra đúng invoice/PO/kho |

## C. Các lỗi thực sự tồn tại

Chi tiết actor, file/function/dòng, input/output trước-sau, nguyên nhân và regression test được lưu theo nhóm:

- [Borrow evidence](SMARTBOOK_24_BORROW_EVIDENCE.md): SB-01–SB-06, SB-19–SB-21, SB-23; ví/cọc/phạt, loan status và cross-service reconciliation.
- [Inventory evidence](SMARTBOOK_24_INVENTORY_EVIDENCE.md): SB-04, SB-08–SB-11, SB-16/SB-17/SB-22–SB-24; unique constraint, concurrency, stock và scope.
- [Original/lifecycle evidence](SMARTBOOK_24_ORIGINAL_EVIDENCE.md): nguồn được khôi phục, SB-07/SB-12–SB-15; putaway lineage, cancellation và closure.
- [Analytics evidence](SMARTBOOK_24_ANALYTICS_EVIDENCE.md): SB-18, actual SQL RED `0 !== 6`, trạng thái PO/line và budget.

Các mục dùng chung bản sửa vẫn có test riêng cho từng điều kiện. Không suy ra PASS từ báo cáo cũ hay tên commit.

### Chỉ mục code và mức độ

Các đường dẫn dưới đây tương đối với repository, dòng được kiểm tra trên working tree cuối cùng; evidence theo nhóm ghi chi tiết test/input/output. Mức độ High ưu tiên bảo toàn tiền, tồn kho hoặc quyền; Medium là áp dụng chính sách/đề xuất sai.

| ID | File / function / dòng | Mức độ |
|---|---|---|
| SB-01 | `services/borrow-service/src/controllers/loan.controller.js:179` — createDirectLoan | High |
| SB-02 | `services/borrow-service/src/services/membership.service.js:6` — resolveActiveMembership; `fine.service.js:220` — runOverdueSweep | High |
| SB-04 | `services/borrow-service/src/controllers/loan.controller.js:1221` — returnLoan; `services/inventory-service/src/controllers/borrow-integration.controller.js:697` — returnBorrowedLoan | High |
| SB-05 | `services/borrow-service/src/controllers/loan.controller.js:179/854` — createDirectLoan / convertReservationToLoan | High |
| SB-06 | `services/borrow-service/src/controllers/loan.controller.js:854` — convertReservationToLoan | High |
| SB-08 | `services/inventory-service/src/controllers/supplier-delivery.controller.js:250` — createGoodsReceiptFromInvoice | High |
| SB-09 | `services/inventory-service/src/controllers/supplier-delivery.controller.js:150` — createSupplierDelivery | High |
| SB-10 | `services/inventory-service/src/controllers/outbound.controller.js:813` — confirmOutbound; `services/repick-quantities.service.js:3` — addRepickQuantities | High |
| SB-11 | `services/inventory-service/src/controllers/transfer-receiving.controller.js:100/167/273` — queue / getTransferReceivingLines / confirmTransferReceiving | High |
| SB-13 | `services/inventory-service/src/services/supplier-return.service.js:101` — executeReturnStock; `controllers/supplier-return.controller.js:360` — executeSupplierReturn | High |
| SB-14 | `services/inventory-service/src/services/receipt-putaway-reversal.service.js:5` — reverseReceiptPutaway; `controllers/goods-receipt.controller.js:1274` — updateGoodsReceipt, khóa trước đọc tại1296 | High |
| SB-15 | `services/inventory-service/src/controllers/purchase-order-line-closure.controller.js:35` — closeRemainingLine | High |
| SB-16 | `services/inventory-service/src/controllers/supplier-delivery.controller.js:250` — createGoodsReceiptFromInvoice; `services/procurement-receipt.service.js:150` — settleSupplierReceiptQuantities | High |
| SB-18 | `services/analytics-service/src/controllers/analytics.controller.js:851/853` — INCOMING_PO_STATUSES / getIncomingQtyByVariant | Medium |
| SB-19 | `services/borrow-service/src/services/fine.service.js:220` — runOverdueSweep | High |
| SB-21 | `services/borrow-service/src/controllers/loan.controller.js:1221` — returnLoan | High |
| SB-22 | `services/inventory-service/src/controllers/borrow-integration.controller.js:48/60/445/574/697` — identity / replay / release / consume / return | High |
| SB-23 | `services/borrow-service/src/controllers/reservation.controller.js:470` — cancelReservation; loan convert và inventory release/consume nêu trên | High |
| SB-24 | `services/inventory-service/src/controllers/supplier-delivery.controller.js:427` — replayCreatedReceipt | High |

## D. Các lỗi không sửa

### ALREADY FIXED

SB-17: migration `20261113090000_add_procurement_document_workflow/migration.sql:225` có partial unique index `uq_procurement_documents_live_invoice_number`. Test đọc `pg_indexes`, chạy service tạo invoice đồng thời và kiểm tra P2002→409. Không sửa production cho mục này.

### Quyết định cần chốt tại thời điểm audit ban đầu (đã được chốt sau đó)

- **SB-03:** khoản PAID/WAIVED hiện kết thúc nghĩa vụ phạt cùng loan_item/type theo contract hiện có. Cần quyết định thanh toán chỉ chốt đến ngày thanh toán hay chốt cả kỳ; miễn toàn bộ hay chỉ đến một cutoff. Không tự mở lại khoản phạt đã thanh toán hoặc thu thêm tiền.
- **SB-07:** cần xác định thời điểm count có hiệu lực, cách ghi movement giữa creation/count/approval, và overlapping audit. Ví dụ snapshot10/count8/xuất2 phải phản ánh cả shortage lẫn xuất, nhưng schema không có counted_at để suy ra lịch sử an toàn. Không thay công thức đơn thuần khiến audit chồng lấn điều chỉnh thiếu hai lần.
- **SB-12:** cần quyết định hàng hỏng/từ chối được ai giữ, vào bucket/vị trí nào, ai chịu trách nhiệm hàng thiếu và quy trình phê duyệt/đóng hồ sơ. Không tự tạo workflow hay nhập hàng hỏng vào available stock.
- **SB-20:** UI đã có từng-item action và cọc/phạt riêng. API batch hiện đồng nhất tình trạng. Cần chọn mở rộng additive `items[]` cho mixed batch hay giữ thao tác từng cuốn; không tự redesign trải nghiệm.

Không dùng NOT A BUG/NOT REPRODUCED/BLOCKED để che lỗi đã tái hiện. Các giới hạn môi trường kiểm thử được ghi riêng ở F/G.

## E. Các thay đổi code

Không có migration/schema/enum mới, không đổi kiến trúc service. Hai mapping web giữ dòng kiểm đếm0, không redesign giao diện. Test mua hàng–putaway chọn đúng dòng sách của GRN thay vì nút header mở toàn kho.

**File mới** (ngoài sáu báo cáo/source trong thư mục này):

- `services/analytics-service/test/reorder-incoming-shortage.db.test.js`
- `services/borrow-service/test/business-logic-audit.db.test.js`
- `services/borrow-service/test/inventory-consume-timeout.test.js`
- `services/inventory-service/src/services/receipt-putaway-reversal.service.js`
- `services/inventory-service/src/services/repick-quantities.service.js`
- `services/inventory-service/test/audit-24.db.test.js`
- `services/inventory-service/test/borrow-idempotency-binding.test.js`
- `services/inventory-service/test/grn-cancel-putaway.test.js`
- `services/inventory-service/test/po-closure-delivery-guard.test.js`
- `services/inventory-service/test/receipt-lifecycle-audit.db.test.js`
- `scripts/testing/customer-fixture.mjs` — đăng ký/xác thực email qua API và Mailpit thật, cấp tiền cọc cho reader mới trong stack QA riêng.

**File sửa**:

- Web: `apps/web/e2e/purchase-to-putaway.spec.ts`, `apps/web/e2e/reorder-budget.spec.ts`, `apps/web/e2e/reservation-pickup-loan-return.spec.ts`, `apps/web/src/components/pages/goods-receipt.tsx`, `apps/web/src/components/pages/supplier-deliveries.tsx`.
- Integration: `scripts/borrow-warehouse-scope-integration.mjs` dùng reader fixture riêng trong QA; chế độ không-isolated giữ hành vi cũ.
- Analytics: `services/analytics-service/src/controllers/analytics.controller.js`, `services/analytics-service/test/reorder-budget-endpoint.test.js`.
- Borrow: `services/borrow-service/src/controllers/loan.controller.js`, `src/controllers/reservation.controller.js`, `src/services/fine.service.js`, `src/services/inventory-integration.service.js`, `src/services/membership.service.js`, `test/overdue-sweep.test.js` (các đường dẫn rút gọn cùng prefix `services/borrow-service/`).
- Inventory controllers (prefix `services/inventory-service/src/controllers/`): `borrow-integration.controller.js`, `goods-receipt.controller.js`, `outbound.controller.js`, `purchase-order-line-closure.controller.js`, `receiving-putaway.controller.js`, `supplier-delivery.controller.js`, `supplier-return.controller.js`, `transfer-receiving.controller.js`.
- Inventory services (prefix `services/inventory-service/src/services/`): `procurement-receipt.service.js`, `supplier-return.service.js`.
- Inventory tests (prefix `services/inventory-service/test/`): `contract/borrow-integration.contract.test.js`, `helpers/procurement-fake-db.js`, `procurement-receipt.test.js`, `receiving-putaway.controller.test.js`, `supplier-delivery-receipt.test.js`, `supplier-return.test.js`.
- Báo cáo mới: `SMARTBOOK_24_ISSUES_AUDIT_FIX_REPORT.md`, `SMARTBOOK_24_ORIGINAL_SOURCE.md`, `SMARTBOOK_24_ORIGINAL_EVIDENCE.md`, `SMARTBOOK_24_BORROW_EVIDENCE.md`, `SMARTBOOK_24_INVENTORY_EVIDENCE.md`, `SMARTBOOK_24_ANALYTICS_EVIDENCE.md` trong `docs/reports/`.

**API/compatibility:** không thêm endpoint, không đổi request/response success shape. Các request vốn sai nghiệp vụ nay bị từ chối: GRN thiếu dòng, dùng key khác payload, release hold đã consumed, trả lại loan_item đã trả, đóng PO line có delivery pending. Valid replay vẫn được hỗ trợ. `detail.active_reservation_count` bổ sung vào lỗi giới hạn mượn trực tiếp; tùy chọn timeoutMs chỉ là đối số nội bộ, không đưa vào payload HTTP. Trạng thái LOST dùng enum sẵn có. Frontend/mobile vẫn dùng payload cũ.

## F. Kết quả kiểm thử

Không cộng lặp focused PostgreSQL vào tổng suite đã bao gồm chúng. Log chi tiết là artifact local bị Git ignore trong `test-results/`; các bảng/evidence trong báo cáo này giữ kết quả kiểm toán review được.

| Test suite | Kết quả | Tổng test | Pass | Fail | Skip |
|---|---|---:|---:|---:|---:|
| Inventory unit + PostgreSQL, bản code cuối | PASS |398|398|0|0|
| Borrow unit + PostgreSQL | PASS |239|239|0|0|
| Analytics unit + PostgreSQL | PASS |162|162|0|0|
| Web unit | PASS |80|80|0|0|
| Inventory HTTP contracts | PASS |12|12|0|0|
| Analytics HTTP contracts | PASS |7|7|0|0|
| Deployed integration — đơn vị flow | PASS |31|31|0|0|
| Browser E2E trọng yếu — Edge | PASS |4|4|0|0|

Inventory: `pnpm --filter inventory-service exec node --test test/*.test.js`, với database audit và client đúng schema; log `inventory-24-audit-final.log`. Borrow: `pnpm --filter borrow-service test` với ba biến URL database audit; log `borrow-audit-full-green.log`. Analytics: `pnpm --filter analytics-service test` với ANALYTICS_TEST_PG_URL; log `analytics-audit.log`. Web: `pnpm --filter web test:unit`, log `web-audit-unit.log`. Tổng backend799 test; cộng web là879, không bao gồm integration/browser bên dưới.

`pnpm lint`, `pnpm --filter web exec tsc --noEmit`, `pnpm build`: exit0. Logs `audit-lint-complete.log`, `audit-web-typecheck-final.log`, `audit-build-final.log`. Lint được chạy lại sau các sửa fixture/selector test cuối. Không tuyên bố đã chạy toàn bộ suite mobile/AI Python; các app đó không sửa code trong đợt này. Tất cả36 file JS/MJS mới/sửa qua `node --check`; `git diff --check` qua.

**Deployed regression cuối:** rebuild service từ code cuối rồi `pnpm test:stack integration` đạt31/31 flow (`audit-integration-complete.log`, `test-results/qa/integration/results.json`). Các flow bao gồm PO tạo/duyệt, nhiều delivery/GRN, supplier portal, đối soát/return, close remaining/revision, picking/transfer/receive, reserve/cancel/convert/return, cọc/ví/phạt/thanh toán/miễn giảm, warehouse scope và outbox/reconciliation. Concurrency chuyên biệt SB-04/06/08/09/14/17/19/22/23 được chứng minh thêm bằng PostgreSQL tests đã liệt kê, không suy ra chỉ từ flow tổng quát.

`pnpm test:stack contracts` đạt12 inventory +7 analytics, không skip (`audit-contracts-final.log`). `PLAYWRIGHT_CHANNEL=msedge pnpm test:stack e2e purchase-to-putaway.spec.ts reorder-budget.spec.ts reservation-pickup-loan-return.spec.ts warehouse-transfer-lifecycle.spec.ts` đạt4/4, không skip (`audit-e2e-complete.log`). Đây là bốn E2E trọng yếu được chọn theo phạm vi, không phải toàn bộ danh mục Playwright. Runtime thật được kiểm tra, không chỉ build tĩnh.

### Database và data integrity

Đã deploy đủ6 migration Borrow và14 migration Inventory hiện hữu vào database audit mới, với extensions cần thiết. SB-17 kiểm tra unique index thực trong pg_indexes và concurrent P2002→409. Transaction rollback được assert khi thiếu tồn/hỏng quota hoặc money validation failure; số dư, movement, received_qty, deposit/outbox được kiểm tra sau concurrent requests. Không có migration mới trong bản sửa. Không xác nhận trạng thái migration của một môi trường production bên ngoài vì không truy cập môi trường đó.

Các lần thất bại đã quan sát và xử lý phải được giữ trong lịch sử kết quả cuối:

- RED tests trước sửa từng bug.
- Fresh inventory migration thiếu extension `pg_trgm`: giữ nguyên DB thử ban đầu, tạo database kiểm thử riêng với extensions theo convention rồi deploy đủ migration; không reset dữ liệu.
- Chromium bundled thiếu executable: bốn test chưa vào được UI; chạy lại với Edge đã cài.
- Integration ban đầu29/31: hai flow phụ thuộc AI trả503; bật AI của QA rồi chạy lại hai flow thành công11/11 và8/8 assertions.
- Contract chạy không có QA environment trỏ sai localhost3000; chạy qua `test:stack contracts`. Assertion release reservation đã CONSUMED từng đòi200 được sửa thành409 theo SB-23; valid release/replay schema tests vẫn giữ.
- UI putaway chọn nút header toàn kho làm lấy nhầm backlog cũ; sửa selector chọn dòng đúng sách của GRN, chạy lại thành công1/1.
- UI budget ban đầu skip vì không có dòng được cấp tiền; bổ sung **một fixture mới** trong QA (stock0, reorder point5, cost10000; không sửa/xóa dữ liệu cũ), chạy lại thành công1/1.
- Đợt deployed cuối sau SB-14:30/31 integration flow, lỗi borrow-warehouse-scope do customer01 tích lũy3 khoản mượn đạt hạn mức3; UI cùng reader cũng không thể đặt trước, budget lại skip do các PO cũ phủ nhu cầu. Không tăng hạn mức/clear loans để vượt kiểm tra: test scope và UI mượn/trả nay đăng ký reader riêng bằng API/OTP thật và nạp cọc qua ledger; test budget thêm demand fixture riêng mỗi lần.
- Lần kiểm chứng fixture ngân sách phát hiện selector chỉ theo title lấy nhầm variant có cùng tên (expected rỗng nhưng nhận5). Test nay bám đúng variant qua quan hệ aria-describedby và chọn đúng checkbox trong row đó; không sửa UI hay thuật toán ngân sách để làm test pass.

Các lỗi RED và lỗi môi trường/fixture ở trên là lịch sử chạy thật, vẫn được ghi nhận dù đợt cuối đã xanh. Không tính những lần FAIL/SKIP đó thành PASS; bảng cuối chỉ thể hiện từng suite sau sửa và sau chuẩn bị đúng điều kiện của chính lần chạy cuối.

## G. Rủi ro và giới hạn

- Bốn quyết định nghiệp vụ ở D đã được người dùng chốt sau audit ban đầu; hiện đã triển khai, xem báo cáo chính sách tiếp nối.
- GRN DRAFT cũ thiếu dòng sẽ bị chặn posting: phải hủy/tạo lại với đủ count, không tự ghi thiếu thành nhận đủ. Chứng từ POSTED cũ không được tự sửa dữ liệu.
- Legacy stock movements không lưu đủ request fingerprint; dùng references/metadata hiện có. Những trường trước đây bị bỏ qua khi LOST không thể tái tạo chính xác; valid retry vẫn được bảo toàn.
- Local DB transaction không bao phủ Inventory Service. Conversion giữ khóa cục bộ và gọi inventory có timeout, nhưng lỗi mạng/commit sau remote success vẫn cần durable reconciliation/manual resolution hiện có.
- Movement không có receipt provenance không được tự gán cho một GRN. Hàng đã xuất/cho mượn không đủ khả dụng thì cancel/return phải409 và rollback.
- Không chạy trên production, không tự sửa dữ liệu lịch sử, không kết luận mọi bất biến toàn hệ thống đã được chứng minh chỉ bằng vài test.

## H. Final Assessment

| Chỉ tiêu | Số lượng |
|---|---:|
| Mục đã đối chiếu mô tả gốc và kiểm tra |24|
| CONFIRMED BUG |19|
| Đã FIX trong phiên này |19|
| ALREADY FIXED |1|
| NOT A BUG |0|
| NOT REPRODUCED |0|
| APPROVED POLICY — IMPLEMENTED |4|
| BLOCKED |0|

Đã sửa toàn bộ lỗi được xác nhận trong phạm vi có thể xác định nghiệp vụ. Bốn mục SB-03/SB-07/SB-12/SB-20 đã được phê duyệt và triển khai trong phần tiếp nối; xem báo cáo chính sách để biết kết quả kiểm chứng hiện tại. Không commit/push, không reset dữ liệu. HEAD vẫn là baseline, các thay đổi nằm trong working tree để review.

Kết quả kiểm chứng cuối:879 unit/PostgreSQL tests,19 HTTP contract counts,31 integration flows và4 browser E2E đều pass trong từng lần chạy cuối, không fail/skip. Các con số dùng đơn vị khác nhau không được gộp thành một số “tổng test” đánh đồng. Phạm vi chưa chạy và rủi ro còn lại nêu tại F/G/D.
