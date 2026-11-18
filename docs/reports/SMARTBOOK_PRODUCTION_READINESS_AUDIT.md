# SmartBook — Production Readiness Audit độc lập

Ngày: **2026-11-17, Asia/Saigon**. Repository: `vinhhung04/smartbook-system`; branch **hungg**; commit **324f8d13953a8694f08994b5b8562c3569ae7fcb**.

## A. Executive Summary

**Quyết định: NO-GO. SmartBook chưa đủ bằng chứng và điều kiện để đưa lên production.**

| Phân loại | Số lượng |
|---|---:|
| Findings trong báo cáo | **21** |
| P0 | **1** |
| P1 | **13** |
| P2 | **7** |
| P3 | **0** |
| Findings có bằng chứng code/configuration/thực thi | **21** |
| Trong đó đã tái hiện bằng controller/DB/job/logger probe | **8**: PRA-01–06, PRA-08, PRA-12 |
| Kiểm chứng vận hành chưa có bằng chứng, không tính PASS | **9** nhóm U-01–09 |
| 24 mục cũ | **21 VERIFIED_FIXED; 3 PARTIALLY_FIXED** |

“Có bằng chứng” xác nhận đường lỗi hoặc thiếu sót trong bản mã này; **không có nghĩa đã quan sát mất tiền, lộ token hay mất dữ liệu trên production**. PRA-07 là cửa sổ mất tính bền vững được xác nhận từ thứ tự commit/call/catch; chưa diễn tập kill-process tại cửa sổ đó. PRA-15 được đo bằng schema diff; PRA-21 xác nhận kết quả advisory, chưa chứng minh mọi advisory có đường khai thác.

Các lỗi chặn release nổi bật:

- Callback VNPay có kết quả thành công nhưng nghĩa vụ đã giảm bị ghi FAILED, không có ghi nhận tiền chờ đối soát/refund.
- Cùng delivery 10 cuốn tạo và POST hai GRN thành tồn 20; hai lần POST đều HTTP 200 trên PostgreSQL audit.
- POST GRN điều chuyển qua đường chung rồi xác nhận nhận hàng hỏng có thể ghi custody 12 cho chuyến xuất 10.
- Replay direct-loan kiểm kho do request mới cung cấp, không kiểm kho của loan lưu trước đó.
- Một thanh toán phạt 20.000 bị retry có thể được ghi hai lần; trả hai khoản phạt khác nhau đồng thời có thể để tổng nợ cache 50.000 dù không còn khoản nợ.
- Một số intent bù trừ chỉ được tạo sau remote side effect; queue đối soát có thể bị các hồ sơ manual cũ chiếm hết batch.
- Backup bỏ tệp chứng từ procurement; offsite failure có thể vẫn ghi nhận freshness; chưa có diễn tập restore độc lập.

Suite Borrow **258/258**, Inventory **419/419**, Analytics **162/162** đều đạt với database audit và client đúng schema. Các probe bổ sung vẫn tái hiện lỗi. Vì vậy các suite xanh không đủ để kết luận GO.

### Phạm vi, tính độc lập và giới hạn

- Audit code, migration, test, Docker/Compose, deploy, bảo mật và vận hành; không sửa source ứng dụng, migration, Prisma schema, RBAC hoặc UI/UX.
- Chỉ tạo báo cáo và artifact audit. Probe/script/client sinh riêng dưới `.git/`; log dưới `test-results/production-readiness/`. Không commit/push, không deployment VPS, không reset/drop/truncate database, không xóa volume.
- Các test có ghi dữ liệu chỉ chạy trên PostgreSQL audit loopback `127.0.0.1:25432`, database `borrow_audit` / `inventory_audit_verified`, và Compose QA `smartbook-qa-9430d4a3`, gateway `localhost:13000`, UI `localhost:15173`, PostgreSQL `127.0.0.1:15432`. Đã kiểm tên project, mapping cổng, cờ isolated và không có paid AI keys trước khi chạy. Không dùng database developer/prod hiện hữu.
- Fixture là dữ liệu kiểm thử của các test đã kiểm tra và các probe tái hiện **lỗi**, không dùng fixture để tuyên bố dữ liệu lịch sử production đã sạch. Không có bản sao dữ liệu production, quyền VPS hoặc bằng chứng provider settlement thật.
- Kết quả từ hai báo cáo cũ được dùng làm giả thuyết, không chép thành kết quả mới. Các kiểm chứng chưa chạy được ghi rõ NOT EXECUTED/NOT_VERIFIABLE.
- Không thể chứng minh không còn bất kỳ lỗi nào chỉ bằng audit hữu hạn. “Danh sách lỗi” dưới đây là toàn bộ findings được xác lập trong phạm vi này, không phải cam kết hệ thống hết lỗi khác.

## Phase 0 — Codebase và provenance

| Kiểm tra | Kết quả mới |
|---|---|
| Workspace ngoài | `C:/Users/hungx/Desktop/Work/Work/KLTN`, origin `vinhhung04/KLTN.git`; có staging/deletions riêng, giữ nguyên |
| Repository thực tế | `C:/Users/hungx/Desktop/Work/Work/KLTN/smartbook-system` |
| Branch / HEAD | `hungg` / `324f8d13953a8694f08994b5b8562c3569ae7fcb` |
| Remote | `https://github.com/vinhhung04/smartbook-system.git` |
| Xác minh push | `git ls-remote origin refs/heads/hungg` trả đúng full HEAD trên; không checkout/reset/fetch làm đổi working tree |
| Git status đầu audit | Chỉ `?? apps/web/public/__tmp_enrich.json`; file người dùng giữ nguyên |
| Commit liên quan | `2ea2d03` inventory invariants/policies; `552871a` borrow settlement/retry; `677e46e` analytics incoming; `324f8d1` báo cáo |
| Runtime kiểm thử host | Node 24.16.0, pnpm 10.6.2; CI/image dùng Node 20 — kết quả host không thay thế xác minh mọi image production |

Đã đọc `AGENTS.md`, `docs/reports/SMARTBOOK_24_ISSUES_AUDIT_FIX_REPORT.md`, `SMARTBOOK_APPROVED_POLICIES_IMPLEMENTATION_REPORT.md`, nguồn/evidence liên quan và code hiện hành. Đã inventory cây tracked bằng `rg --files`: `apps/web`, `apps/mobile`, `apps/api-gateway`; `services/auth-service`, `inventory-service`, `borrow-service`, `analytics-service`, `ai-service`; `packages/shared`, `db-init`, `deploy`, `.github/workflows`, `observability`, `scripts/testing`, test/E2E. **Không có Notification Service triển khai độc lập**: notification/email/socket nằm trong Borrow/Auth/Inventory và Gateway; Analytics đọc inventory/borrow qua pool, không có Prisma migration riêng; AI có DDL startup trong `schema.sql`.

### Xác minh lại 24 hạng mục

Các file trong cột bằng chứng tương đối với repository. `B` = `services/borrow-service/src/`; `I` = `services/inventory-service/src/`; `A` = `services/analytics-service/src/`. DB suites được chạy lại bằng client sinh từ schema ở HEAD, không skip. VERIFIED_FIXED chỉ áp dụng vấn đề gốc và phạm vi test đã nêu.

| ID | Vấn đề | Trạng thái trong code hiện tại | Bằng chứng | Test xác minh mới | Kết luận |
|---|---|---|---|---|---|
| SB-01 | Direct borrow bỏ reservation khi tính limit | VERIFIED_FIXED | B `controllers/loan.controller.js:251`, `:339`; membership lock và recount | `business-logic-audit.db.test.js`, membership-item-count; PASS | Có tính lượng đang reserved trong phép cấp mượn |
| SB-02 | Membership tương lai áp dụng sớm | VERIFIED_FIXED | B `services/membership.service.js:13`; `fine.service.js:299` | membership-dates và business-logic-audit DB; PASS | Start-date được lọc; sweep giữ đúng rate membership theo contract |
| SB-03 | Phạt sau kỳ PAID/WAIVED | VERIFIED_FIXED | B `services/overdue-accrual.service.js:8`; `fine.controller.js:317`; migration periods/due dates | fine-policy DB, overdue-accrual, browser fine-period-waiver; PASS | Kỳ đã chốt giữ nguyên; kỳ sau phát sinh riêng. PRA-01/06 vẫn là rủi ro tài chính khác |
| SB-04 | Trả lại một loan_item nhiều lần | VERIFIED_FIXED | B `services/return-request.service.js:44`; `loan.controller.js:1341`; I borrow integration | business-logic-audit DB; Inventory audit-24 DB; PASS | Request mới cho item inactive bị chặn, replay chuẩn không lặp movement |
| SB-05 | AccountError sau consume không có recovery | PARTIALLY_FIXED | B `loan.controller.js:459`; `reconciliation.service.js:18` | business-logic-audit DB, inventory-consume-timeout; PASS ở catch có DB hoạt động | Có ghi outbox trong catch, nhưng process crash/DB outage vẫn mất intent; PRA-07 |
| SB-06 | Double conversion cùng reservation | VERIFIED_FIXED | B `loan.controller.js:986–1007` | business-logic-audit DB Promise.all; PASS | Lock trạng thái, phát hiện converted loan, replay |
| SB-07 | Biến động sau đếm bị ghi đè | VERIFIED_FIXED | I stock-audit count/approval services; trigger migration `20261117160000` | stock-audit-cutoff DB và browser; PASS: 10→đếm8→xuất2→6 | DRAFT chưa freeze, start refresh baseline, approval delta đúng một lần |
| SB-08 | Hai GRN cùng delivery | PARTIALLY_FIXED | I `supplier-delivery.controller.js:250` có guard; `goods-receipt.controller.js:613–623,711` bỏ guard | audit-24 DB của route chuyên biệt PASS; probe route chung PG tái hiện 2 GRN/20 cuốn | PRA-02; không an toàn trên mọi endpoint |
| SB-09 | Nhiều delivery vượt PO | VERIFIED_FIXED | I `supplier-delivery.controller.js:150` và lock PO | audit-24 DB concurrent delivery; PASS | Guard tổng giao của luồng kiểm tra hoạt động; không suy ra bảo vệ generic GRN |
| SB-10 | Repick cộng lặp variant | VERIFIED_FIXED | I `services/repick-quantities.service.js:3`; outbound confirm | audit-24 DB và picking-shortage; PASS | Cộng tổng repick đúng dòng/variant |
| SB-11 | Nhận transfer bỏ repick | VERIFIED_FIXED | I `transfer-receiving.controller.js:100,167,273` | audit-24 DB/transfer-receiving-counting; PASS | Dedicated receiving nhận cả repick |
| SB-12 | Thiếu workflow discrepancy | PARTIALLY_FIXED | I transfer-discrepancy service; generic POST `goods-receipt.controller.js:1414` | transfer-discrepancy DB/browser dedicated PASS; alternate-route PG custody12/10 | Workflow có custody/ledger nhưng tương tác route chung sai; PRA-03 |
| SB-13 | Supplier return sau putaway | VERIFIED_FIXED | I `services/supplier-return.service.js:101` | receipt-lifecycle-audit DB, supplier-return; PASS | Theo lineage đúng GRN và allocation còn lại |
| SB-14 | Hủy GRN không unwind putaway | VERIFIED_FIXED | I `receipt-putaway-reversal.service.js:5`; `goods-receipt.controller.js:1296` | receipt-lifecycle-audit DB concurrent cancel; PASS | Supplier/manual receipt unwind đúng; không mở rộng thành chứng nhận mọi transfer cancellation |
| SB-15 | Close PO khi delivery pending | VERIFIED_FIXED | I `purchase-order-line-closure.controller.js:35` | po-closure-delivery-guard, receipt-lifecycle-audit DB; PASS | Pending bị chặn, processed được đóng |
| SB-16 | GRN thiếu dòng delivery | VERIFIED_FIXED | I `procurement-receipt.service.js:150–163` kiểm lại cả lúc POST | supplier-delivery-receipt, procurement-receipt, audit-24 DB; PASS | Generic create có thể nháp thiếu nhưng POST chặn thiếu dòng |
| SB-17 | Invoice NCC trùng | VERIFIED_FIXED | migration procurement `:225` partial unique index | audit-24 DB đọc index và tạo invoice concurrent; PASS | Constraint thực thi, có xử lý unique conflict |
| SB-18 | Incoming bỏ SHORTAGE_REPORTED | VERIFIED_FIXED | A `controllers/analytics.controller.js:851–853` | reorder-incoming-shortage DB; PASS, incoming6 | Giữ phần PO open còn lại |
| SB-19 | Sweep snapshot cũ mở lại sách đã trả | VERIFIED_FIXED | B `fine.service.js:309–315` re-read dưới lock | overdue-sweep và business-logic-audit DB overlap; PASS | Không reopen item đã return |
| SB-20 | Batch return một condition chung | VERIFIED_FIXED | B return-request/return-operation services; loan return per-item | mixed-return DB; browser GOOD/DAMAGED/LOST; PASS | Per-copy outcome/cọc/key. Crash recovery ngoài happy path còn PRA-07 |
| SB-21 | RETURNED che LOST trước đó | VERIFIED_FIXED | B `loan.controller.js:1382–1393` đếm toàn bộ LOST | business-logic-audit DB, mixed-return DB/browser; PASS | Phiếu cuối vẫn LOST |
| SB-22 | release/consume/return key không bind payload | VERIFIED_FIXED | I `borrow-integration.controller.js:48,60,445,574,697` | borrow-idempotency-binding, audit-24 DB; PASS | Ba operation gốc được ràng buộc; reserve/GRN/wallet còn PRA-20 |
| SB-23 | Cancel/convert xung đột | VERIFIED_FIXED | B reservation-state lock tại cancel/convert; Inventory ACTIVE claim | business-logic-audit DB và reservation-idempotency DB; PASS | Thắng một state transition; crash sau cancel commit là PRA-07 |
| SB-24 | GRN replay bỏ warehouse WRITE | VERIFIED_FIXED | I `supplier-delivery.controller.js:427–445` kiểm stored receipt + PO | audit-24 DB, supplier-delivery-receipt; PASS | Cả replay/P2002 kiểm kho; direct-loan vẫn có PRA-04 |

Không gán REGRESSION chỉ vì tìm thêm đường bypass. PRA-02 có route cũ từ `b6da8e1e`; SB-08 sửa route chuyên biệt trong `2ea2d03`, chưa loại bỏ route chung. PRA-03 là tương tác generic transfer posting (`ac7f3b3e`), nhánh existing POSTED (`efdf6cb2`) và workflow discrepancy mới (`2ea2d03`). Chưa chạy toàn bộ commit lịch sử để chứng minh một phiên bản đã từng an toàn rồi tái hỏng. Các thiếu sót Borrow có blame trước `552871a`: direct replay `91d296b4/054cfa59`, thanh toán quầy `91d296b4`, stale VNPay `987ca479`, queue starvation `b06b4878`, fine aggregate `7807dd7c`.

## B. Detailed Findings

Severity thể hiện ảnh hưởng có thể xảy ra nếu đường lỗi được thực hiện. Tất cả đề xuất ở đây là đầu ra audit, **chưa áp dụng bản sửa**.

### PRA-01 — Tiền VNPay thành công không được hạch toán khi fine thay đổi

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-01 / **P0** / Financial, Payment recovery |
| Description | Fine đã được trả một phần/miễn/settle cọc sau khi tạo link; callback xác minh thành công với số tiền cũ bị xử lý như FAILED. Polling còn có thể chuyển intent sang EXPIRED trước callback đến muộn. |
| Evidence | `services/borrow-service/src/services/vnpay-payment.service.js:22–23,84–91`; `controllers/vnpay-webhook.controller.js:89–93`; `vnpay-payment.controller.js:53–79,115–117` |
| Root cause | Đồng nhất “không còn khớp nghĩa vụ” với “provider chưa thu tiền”; không có suspense/refund/reconciliation state cho tiền đã thu. Tạo live intent dùng findFirst→create không atomic. |
| Reproduction | Trên borrow_audit: fine100.000, ghi hai partial20.000; insert trực tiếp fixture intent100.000 để dựng trạng thái stale; gọi finalizer thật bằng callback ở ranh giới đã-verified với response00, amount đúng intent. Không chạy create-link controller, signature verification hoặc ngân hàng trong probe này. |
| Expected | Bảo toàn bằng chứng thu100.000; phân bổ phần còn nợ và phần dư vào cơ chế chờ đối soát/refund, không ack mất nghĩa vụ tài chính. |
| Actual | `STALE_REMAINING_BALANCE`, intent `FAILED`; vẫn chỉ2 fine_payments cũ, outbox cho fine=0. IPN controller sẽ ACK00 cho outcome này. |
| Impact | Tiền có thể đã bị provider trừ nhưng ứng dụng không ghi nhận tiền đến/hoàn trả; không thể tự khôi phục bằng retry callback. |
| Recommendation | Settlement record bất biến theo provider transaction; late-success path; nghĩa vụ dư/refund rõ ràng; atomic claim live intent và reconciliation với provider. |
| Verification | PG probe PASS tái hiện lỗi, `money-db-probes.log`; unit VNPay cũng PASS chính hành vi stale này. **Live provider settlement/refund NOT EXECUTED**. |

### PRA-02 — Generic GRN cho phép nhập trùng một delivery

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-02 / **P1** / Procurement, Inventory |
| Description | `POST /api/goods-receipts` nhận PO+delivery nhưng không dùng guard của endpoint tạo GRN từ delivery. |
| Evidence | `services/inventory-service/src/controllers/goods-receipt.controller.js:582–623,711–732`; `routes/goods-receipt.routes.js:34`; `prisma/schema.prisma:218`; migration procurement `:188–191` chỉ index delivery/status không unique |
| Root cause | Hai orchestration tạo GRN cho cùng aggregate; uniqueness chỉ trên idempotency_key, generic create không lưu key. |
| Reproduction | PO100, DN10, gọi generic create hai lần với cùng DN/variant10; POST cả hai GRN. |
| Expected | Một GRN active cho delivery hoặc phân bổ phần còn lại có ràng buộc, tổng nhập delivery không quá10. |
| Actual | PostgreSQL: create `[201,201]`, hai receipt; POST `[200,200]`; tồn đích **20** cho DN10. |
| Impact | Tăng tài sản không có thật; PO cap100 không ngăn nhập trùng delivery10. |
| Recommendation | Một service nghiệp vụ tạo/POST GRN; guard/constraint active delivery phù hợp thiết kế và idempotency bền vững. |
| Verification | Controller fake và PostgreSQL thực đều tái hiện; `inventory-db-probes.log`. Thêm concurrent và alternate-route tests sau sửa. |

### PRA-03 — Generic POST transfer làm sai custody khi nhận discrepancy

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-03 / **P1** / Transfer, Stock conservation |
| Description | Generic POST nhập đủ transfer nhưng không hoàn tất state receiving; dedicated receive thấy GRN POSTED thì bỏ re-post accepted, vẫn cộng quarantine. |
| Evidence | `services/inventory-service/src/controllers/goods-receipt.controller.js:1413–1415`; `transfer-receiving.controller.js:444–446,542–545`; `services/transfer-discrepancy.service.js` |
| Root cause | Receipt state và transfer/discrepancy state không có một transition atomic duy nhất cho mọi endpoint. |
| Reproduction | Transfer shipped10 có DRAFT GRN10; generic PATCH POSTED; dedicated confirm delivered10/damaged2. |
| Expected | Receiving8+quarantine2=10 tại kho đích. |
| Actual | PG: cả hai HTTP200; receiving10+quarantine2=**12**, available0. |
| Impact | Custody/tổng tài sản sai; không phát hiện bằng kiểm available đơn thuần. |
| Recommendation | Cấm hoặc route generic transfer mutation vào cùng receiving workflow; kiểm invariant posted receipt, accepted và quarantine trước transition. |
| Verification | Fake và PG thực tái hiện; `inventory-db-probes.log`; cần thêm cancellation và retry của cả hai endpoint. |

### PRA-04 — Direct-loan replay vượt phạm vi kho của stored loan

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-04 / **P1** / Authorization, Idempotency |
| Description | Quyền được kiểm trên warehouse của request mới; loan ID chỉ suy từ key và replay stored loan ngay. |
| Evidence | `services/borrow-service/src/controllers/loan.controller.js:223–231` |
| Root cause | Key global không bind actor/payload và không authorize đối tượng thực được trả về. |
| Reproduction | Stored loan khoB; actor có WRITE khoA, biết/reuse key; gửi request với warehouseA và key cũ. |
| Expected | Authorize stored warehouseB; từ chối403 hoặc409 nếu actor/payload khác. |
| Actual | Actual-controller mock probe HTTP200, trả loan khoB dù resolver chỉ cho khoA. Chưa khai thác trên service deployed. |
| Impact | Lộ dữ liệu loan ngoài scope và replay sai customer/variant/quantity. Cần biết key; không phải endpoint tự liệt kê mọi loan. |
| Recommendation | Actor-scoped key + fingerprint đầy đủ; authorize stored record trước mọi replay, kể cả unique-conflict path. |
| Verification | `borrow-probes.log`; cần deployed role/warehouse integration cho managerA/B. |

### PRA-05 — Retry thanh toán phạt một phần ghi trùng tiền

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-05 / **P1** / Financial, Idempotency |
| Description | Staff payment không dùng Idempotency-Key; transaction_reference không unique. |
| Evidence | `services/borrow-service/src/controllers/fine.controller.js:173–249`, insert`:228–233`; `prisma/schema.prisma:265–280` |
| Root cause | Lock fine bảo vệ remaining nhưng không nhận diện một payment request bị retry. |
| Reproduction | Fine100.000, gửi hai lần amount20.000, cùng key và transaction_reference. |
| Expected | Một payment20.000 và replay đúng response. |
| Actual | PostgreSQL actual controller HTTP200/200, hai payment tổng40.000. |
| Impact | Sổ thu tiền và nghĩa vụ sai dù chỉ một chuyển khoản/thao tác thực. |
| Recommendation | Payment request ledger + key/fingerprint unique trong transaction; xử lý reference theo provider/method để không chặn các khoản tiền hợp lệ khác. |
| Verification | `money-db-probes.log`, cả fake và PG; thêm response-lost/concurrent/reused-key-different-amount cases. |

### PRA-06 — Hai fine khác nhau thanh toán đồng thời để tổng nợ cache sai

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-06 / **P1** / Financial, Concurrency |
| Description | Recompute đọc tổng fine trước khi serialize customer update. |
| Evidence | `services/borrow-service/src/services/fine.service.js:98–117`; `controllers/fine.controller.js:195,249`; `loan.controller.js:239–244,917–922` dùng cache để chặn mượn |
| Root cause | Fine-level locks khác nhau không bảo vệ aggregate theo customer; UPDATE cuối chỉ serialize ghi snapshot đã stale. |
| Reproduction | Hai fine50.000 cùng khách; hai actual controller trả đủ đồng thời; barrier chỉ điều khiển lịch sau query thật `fines.findMany`, trước update customer. PostgreSQL READ COMMITTED thật. |
| Expected | Hai fine PAID và total_fine_balance0. |
| Actual | HTTP200/200; open_fines0 nhưng cached balance **50.000**. |
| Impact | Từ chối mượn/đặt trước sai, dashboard và debt collection sai. |
| Recommendation | Lock customer trước đọc/ghi fine aggregate theo thứ tự nhất quán; reconciliation độc lập phát hiện cache lệch. |
| Verification | PG race đã tái hiện trong `money-db-probes.log`; không còn chỉ là suy đoán tĩnh. |

### PRA-07 — Remote mutation có cửa sổ không có durable operation intent

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-07 / **P1** / Distributed transaction, Recovery |
| Description | Direct consume trước local commit; compensation record tạo sau lỗi. Cancel reservation commit trước release; retry CANCELLED bỏ qua release. |
| Evidence | `services/borrow-service/src/controllers/loan.controller.js:322,334,459`; `reservation.controller.js:514–558`; `services/reconciliation.service.js:18–31` |
| Root cause | Intent không persist trước side effect; queue insert failure bị swallow và log-only. |
| Reproduction | Thiết kế fault test: kill sau remote consume trước local transaction/catch; hoặc sau cancel commit trước release; làm DB mất kết nối khi queue insert. **Các crash probe này NOT EXECUTED**. |
| Expected | Sau restart luôn có operation record để retry/đối soát mọi side effect chưa kết thúc. |
| Actual | Code có cửa sổ không có loan/intent; queue create có thể thất bại mà caller tiếp tục báo queued. Không có sweep đầy đủ so local terminal reservation với remote ACTIVE holds. |
| Impact | Stock borrowed/reserved bị kẹt, cần truy vết thủ công; retry đơn thuần không bảo đảm phục hồi. |
| Recommendation | Durable saga/operation intent trước call; state transitions atomic local; reconciler so trạng thái thực hai bên; phân biệt queued thực với queue failure. |
| Verification | Static control-flow confirmed; existing catch/retry tests PASS chỉ bao phủ đường có DB. Phải chạy crash/restart/fault test riêng trước release. |

### PRA-08 — Manual outbox chặn vĩnh viễn automatic releases

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-08 / **P1** / Reconciliation, Job scheduling |
| Description | Job lấy oldest50 PENDING, manual event không đổi status; lặp lại batch đó mãi. |
| Evidence | `services/borrow-service/src/jobs/reservation-reconciliation.job.js:25–40` |
| Root cause | Filter auto-retryable sau LIMIT thay vì trước, không có manual-review queue/status/cursor. |
| Reproduction | 50 manual unresolved record cũ, một RELEASE_RESERVATION mới; chạy ba sweep actual job với repository giả lập. |
| Expected | Release vẫn được lấy/retry trong bounded time. |
| Actual | Mỗi sweep scanned50, releaseCalls0, release vẫn PENDING. |
| Impact | Giữ tồn vô thời hạn sau một giai đoạn sự cố; queue retry10 lần không giúp vì record chưa bao giờ được chọn. |
| Recommendation | Tách manual và automatic queue hoặc lọc event_type trước limit; metric tuổi oldest theo loại và công cụ xử lý có audit. |
| Verification | `borrow-probes.log`; cần real-DB backlog/restart và alert test sau sửa. |

### PRA-09 — Backup/restore bỏ tệp chứng từ và thiếu recovery boundary

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-09 / **P1** / Data recovery |
| Description | DB có storage_ref/hash nhưng volume chứng từ procurement không được backup/restore; file restore xảy ra trước khi dừng writers. |
| Evidence | `compose.prod.yml:134–138`; `deploy/scripts/backup.sh:34–45`; `restore.sh:23,44,51` |
| Root cause | Script chỉ biết packing_evidence; DB dumps tuần tự snapshot riêng, không manifest/quiescence liên service. |
| Reproduction | Review manifest script: tìm procurement_document_data trong backup/restore không có; restore all chỉ liệt kê4DB+packing. Không chạy restore production. |
| Expected | Recovery set gồm đủ tệp chứng từ, DB, config/release metadata cùng boundary; dừng writers trước restore. |
| Actual | File procurement không nằm archive; tài liệu sẽ trỏ tới file không còn khi mất VPS/volume. |
| Impact | Mất chứng từ lịch sử và phục hồi dữ liệu liên service không nhất quán. |
| Recommendation | Full recovery manifest; archive mọi durable upload; version/checksum; write quiescence hoặc recovery protocol và restore đồng bộ trên host riêng. |
| Verification | Static confirmed; full independent restore **NOT EXECUTED**, U-01. |

### PRA-10 — Backup offsite lỗi vẫn có thể ghi freshness thành công

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-10 / **P1** / Backup monitoring |
| Description | Offsite là optional; rclone lỗi hoặc thiếu công cụ không làm daily job fail. |
| Evidence | `deploy/scripts/backup.sh:60–68`; `healthcheck.sh:49–60` kiểm tuổi last_daily_backup |
| Root cause | `rclone copy ... && log ...` không fail closed trong AND-list; missing rclone chỉ WARNING; freshness vẫn được cập nhật. |
| Reproduction | Thiết kế: stub rclone exit1 trên sandbox script không retention/deletion; kiểm exit và timestamp. **Không chạy script gốc vì có retention xóa file**. |
| Expected | Trạng thái local và offsite riêng; offsite bắt buộc thất bại phải báo lỗi và không ghi verified freshness. |
| Actual | Control-flow tiếp tục tới update timestamp rồi exit0; monitoring tuổi backup có thể xanh dù không có bản ngoài VPS. |
| Impact | Mất VPS có thể mất luôn mọi backup trong khi vận hành tưởng đã an toàn. |
| Recommendation | Required encrypted offsite, kiểm object/checksum và tuổi bản remote; cập nhật freshness chỉ sau verify; alert lỗi copy. |
| Verification | Static shell control-flow confirmed; offsite upload/retrieval thực NOT EXECUTED. |

### PRA-11 — Endpoint AI trả phí được proxy cho người gọi anonymous

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-11 / **P1** / Authentication, Resource abuse |
| Description | Summary/OCR/packing legacy routes không yêu cầu identity/capability trước gọi inference. |
| Evidence | `apps/api-gateway/src/index.js:609–617`; `services/ai-service/main.py:497,565,3148`; `llm_provider.py:342` |
| Root cause | Proxy `/ai` tổng quát; route không có guard như Action Center; global per-IP600/15m không phải ngân sách tiền theo tính năng/user. |
| Reproduction | Trace anonymous route đến provider call; không gọi paid endpoint thật trong audit. QA đã xác minh không paid keys. |
| Expected | Guard theo quyền và ngân sách/rate/concurrency phù hợp trước khi tiêu tiền. |
| Actual | Không có guard tại các route đã nêu; khi production đặt key, anonymous caller đi vào inference. |
| Impact | Hết ngân sách/giới hạn provider, làm gián đoạn AI cho người dùng hợp lệ. |
| Recommendation | Bảo vệ từng capability có billable inference; budget bền vững, per-user quota và circuit breaker; vẫn cho phép public feature nếu được thiết kế quota rõ ràng. |
| Verification | Static trust-boundary confirmed; live billing/exhaustion NOT EXECUTED, không khẳng định đã bị lạm dụng. |

### PRA-12 — Access logger giữ supplier portal bearer token

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-12 / **P1** / Sensitive data exposure |
| Description | Supplier token nằm trong route và logger ghi nguyên originalUrl. |
| Evidence | `packages/shared/runtime/index.cjs:75`; `services/inventory-service/src/routes/supplier-portal.routes.js:20–25`; `controllers/supplier-portal.controller.js:17–23`; `deploy/Caddyfile:13` |
| Root cause | Không redact path secrets trước access logging; token là thông tin ủy quyền đọc/ghi tới khi hết hạn. |
| Reproduction | Gọi createRequestLogger trong bộ nhớ với marker giả không bí mật ở vị trí token; phát sự kiện finish. |
| Expected | Route template/redacted path, không có marker token trong log. |
| Actual | JSON log giữ marker. Không dùng token thật; chưa truy cập log production. |
| Impact | Người/công cụ có quyền đọc log có thể sử dụng magic link đang hiệu lực. |
| Recommendation | Redact tại app/proxy; giảm token trong URL khi khả thi; policy rotation/revocation cho link có khả năng đã lọt log. |
| Verification | Pure logger reproduction confirmed; không kết luận đã có token production bị lộ. |

### PRA-13 — Deploy gate không bắt buộc DB/integration/E2E cho release SHA

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-13 / **P1** / CI/CD |
| Description | Production workflow build sau ordinary suites và validate schema; PostgreSQL tests opt-in sẽ skip khi thiếu URL. |
| Evidence | `.github/workflows/deploy-production.yml:65–82`; `.github/workflows/ci.yml:5–7,180–239`; Borrow/Inventory `*.db.test.js` opt-in env |
| Root cause | DB/integration/E2E job thuộc workflow khác, branch triggers không gồm production, deploy không yêu cầu kết quả các job đó cùng SHA. |
| Reproduction | Trace needs/test env trong production workflow; không dispatch deployment. |
| Expected | Cùng artifact SHA có migration+DB+critical E2E checks không skip trước release. |
| Actual | Deployment có thể đi tiếp dù các DB tests không được thực thi trong deploy gate. |
| Impact | Migration hoặc concurrency regression được build/publish tự động. |
| Recommendation | Required reusable verification workflow trên exact SHA và artifact digest; fail khi mandatory suites skip. |
| Verification | Static workflow DAG confirmed; actual GitHub branch protections/Actions run quyền ngoài repo NOT_VERIFIABLE. |

### PRA-14 — Auto app rollback không kiểm tương thích schema/nghiệp vụ

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-14 / **P1** / Migration, Release recovery |
| Description | App migrate lúc start; rollout fail tự chạy previous images với DB mới, không có compatibility gate. |
| Evidence | `compose.prod.yml:111,149,187`; `deploy/scripts/deploy.sh:55–56,99–107`; `docs/reports/SMARTBOOK_APPROVED_POLICIES_IMPLEMENTATION_REPORT.md`, phần Migration và vận hành |
| Root cause | Additive schema bị coi như backward-compatible về nghiệp vụ; code cũ không biết fine periods, return ledger và count sessions. |
| Reproduction | Thiết kế stage: migrate policies, tạo một kỳ phạt/return request/session mới, làm app mới fail readiness; deploy script sẽ rollout PREV_TAG. Chưa chạy failure deployment. |
| Expected | Chỉ rollback image khi đã kiểm compatibility; nếu không, maintenance/read-only và forward-fix. |
| Actual | Script quyết định rollback chỉ theo tag/health; không kiểm state mới hoặc compatibility matrix. |
| Impact | Backend cũ tiếp tục ghi dữ liệu theo semantics cũ hoặc readiness xanh nhưng nghiệp vụ sai. |
| Recommendation | Tách migration job; pin known-compatible fallback; block auto fallback qua semantic migration, ưu tiên forward-fix và recovery checkpoint. |
| Verification | Static contradiction confirmed; old-image/new-schema drill NOT EXECUTED, U-03. |

### PRA-15 — Migration end state chưa đồng bộ hoàn toàn Prisma schema

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-15 / **P2** / Schema drift, Performance |
| Description | Read-only migrate diff còn chênh FK/index dù migration history17/17 và9/9 finished. |
| Evidence | `services/inventory-service/prisma/schema.prisma:36,139–147,582,721,1484`; metadata-reconciliation/duplicate-intelligence migrations; Borrow `loan_return_requests` relation và migration `20261117150000` |
| Root cause | Một số SQL FK/indices không được mô tả trong datamodel; hai composite normalized_alias/status index khai trong schema chưa có migration tương ứng; books work_group index tồn tại chỉ trong SQL. |
| Reproduction | `prisma migrate diff --from-url <audit-url> --to-schema-datamodel <schema>` read-only; không apply output. |
| Expected | Mọi mismatch được giải thích/ghi nhận, index cần dùng có migration; future diff không vô ý xóa FK custom. |
| Actual | Borrow thay action loan_return_requests FK; Inventory đề xuất thêm2 indexes, bỏ work_group index, thay FK, bỏ các FK của transfer/session không khai quan hệ. |
| Impact | Query/index assumption sai; future db push/generated migration có thể làm yếu integrity. Các FK custom đang có thật, không phải chúng đang thiếu trong DB. |
| Recommendation | Reconcile datamodel và DDL có chủ đích; giữ trigger/check/partial index ngoài khả năng Prisma bằng migration tests. Không chạy db push như cách chữa drift. |
| Verification | `borrow-schema-diff.log`, `inventory-schema-diff.log`, exit0 có diff; xác nhận mismatch, chưa đo production query plan/latency. |

### PRA-16 — Legacy AI upload đọc body không giới hạn thực

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-16 / **P2** / Input validation, Availability |
| Description | MIME image/* được tin, `.file.read()` toàn bộ; gateway chỉ kiểm Content-Length. |
| Evidence | `services/ai-service/main.py:434–441`; `apps/api-gateway/src/index.js:285–288`; `deploy/Caddyfile` không cấu hình request_body max_size |
| Root cause | Thiếu streaming byte cap/magic-byte validation; missing/chunked length xem như0. |
| Reproduction | Thiết kế request chunked vượt limit vào scan/packing; chưa gửi payload lớn để tránh làm cạn RAM. |
| Expected | Hard limit ở proxy/parser/stream, kiểm ảnh thực và dimensions trước decode/provider. |
| Actual | Route đọc hết bytes trước kiểm rỗng, không có cap ở helper legacy này. BOOK_OCR cap riêng không bảo vệ mọi endpoint. |
| Impact | Cạn RAM/disk, container restart, tăng chi phí provider; kết hợp PRA-11. |
| Recommendation | Hard body cap độc lập Content-Length, image validation và concurrency cap theo endpoint. |
| Verification | Static confirmed; load/exhaustion probe NOT EXECUTED. |

### PRA-17 — Shutdown không drain requests/transactions/jobs

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-17 / **P2** / Service lifecycle |
| Description | SIGTERM đóng Redis rồi process.exit; không giữ HTTP server để stop accepting/drain; Gateway không có handler tương đương. |
| Evidence | Auth `src/index.js:46–49`; Inventory`:614–616`; Borrow`:140–142`; `apps/api-gateway/src/index.js`; `compose.prod.yml:111,149,187` command qua shell/npm |
| Root cause | Lifecycle không phối hợp HTTP, worker, pool và signal forwarding. |
| Reproduction | Thiết kế restart trong lúc request đang remote mutation/transaction. Chưa kill container đang xử lý trong lượt này. |
| Expected | Unready→stop accepting→drain bounded→stop jobs/consumers→close pools→exit. |
| Actual | Exit ngay sau disconnect Redis, có thể cắt response/request. |
| Impact | Tăng unknown outcome/retry và cửa sổ PRA-07 trong deployment/restart. |
| Recommendation | Signal forwarding/exec hoặc init, graceful timeout, drain server/jobs, phối hợp pool shutdown. |
| Verification | Static lifecycle confirmed; crash/restart drain test NOT EXECUTED. |

### PRA-18 — Health/monitoring không bao phủ backlog và financial failures

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-18 / **P2** / Observability |
| Description | Container health dùng liveness; production Compose không bật collector/dashboard, cron không theo outbox/payment failures. |
| Evidence | `compose.prod.yml:140,178,213,239,377`; `deploy/scripts/healthcheck.sh`; `services/inventory-service/src/jobs/outbox-publisher.job.js:48`; `observability/` |
| Root cause | Có instrumentation/config tham khảo nhưng chưa thành hệ thống alert production; outbox gauge chỉ batch length tối đa200, không phải total backlog. |
| Reproduction | Review health/alert checks. Gateway /ready thực sự kiểm core DB và trả200 ở QA; không suy ra mọi dependency/job khỏe. |
| Expected | Alerts cho backlog age/count, FAILED/DLQ, reconciliation/manual, provider settlement, disk/RAM/restarts; gửi tới owner có nhận xác nhận. |
| Actual | Healthcheck.sh có webhook optional và syslog; không metric/alert các lớp trên, webhook failure còn bị swallow và stamp alert vẫn ghi. |
| Impact | Sự cố dữ liệu kéo dài trước khi phát hiện dù HTTP200. |
| Recommendation | Kết nối metrics/error tracking, dùng readiness dependency phù hợp; alert theo SLO/invariant với owner và delivery test. |
| Verification | Config confirmed; kênh/người nhận thực NOT_VERIFIABLE, U-05. |

### PRA-19 — Quyền container và DB vượt nhu cầu ứng dụng

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-19 / **P2** / Least privilege |
| Description | Backend Dockerfiles không đặt USER; phần lớn app DB URL dùng POSTGRES_USER khởi tạo cluster. |
| Evidence | `services/{auth,inventory,borrow,analytics,ai}-service/Dockerfile`, `apps/api-gateway/Dockerfile`; `compose.prod.yml:49,115,153,191,252`; `db-init/03-create-analytics-reader.sh` |
| Root cause | Chưa tách migration/admin identity khỏi app runtime theo database; container default root. Analytics reader riêng là điểm tốt, không áp cho các writer khác. |
| Reproduction | Static image/Compose review, không đọc/in giá trị password hay secret. |
| Expected | Non-root app, writer role theo DB, migrator riêng, filesystem quyền tối thiểu. |
| Actual | Config runtime có quyền vượt nhu cầu; chưa xác minh effective VPS grants. |
| Impact | Nếu một service bị compromise, blast radius sang DB/service khác lớn hơn. |
| Recommendation | Roles và users riêng, owner/migrator separation, non-root và upload/cache permissions phù hợp. |
| Verification | Source/config confirmed; actual production pg_roles/container effective UID NOT_VERIFIABLE. |

### PRA-20 — Payload binding còn thiếu ở reserve, GRN, wallet credit/debit

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-20 / **P2** / Idempotency contracts |
| Description | Một số replay chỉ kiểm identity hẹp, không reject key reused với payload khác theo yêu cầu audit. |
| Evidence | I `borrow-integration.controller.js:284–313` reserve active reference; `supplier-delivery.controller.js:427–447` GRN replay không so items; B `account.service.js:118–132,208–223` debit/credit replay |
| Root cause | Không lưu/so normalized fingerprint; mỗi endpoint tự định nghĩa replay khác nhau. |
| Reproduction | Thiết kế reserve cùng reference đổi variant/qty/kho; GRN cùng key đổi count; wallet same customer/key/type đổi amount/reference. Chưa chạy mọi tổ hợp này trên deployed stack. |
| Expected | Replay cùng normalized payload; khác payload409, không silent replay request cũ. |
| Actual | Nhánh code return existing trước so các trường đó. HOLD có conflict check riêng, không suy ra CREDIT/DEBIT cũng có. |
| Impact | Caller hiểu nhầm nghiệp vụ mới đã được thực hiện; khó phát hiện integration mismatch. Không khẳng định tự trừ/cộng tiền hai lần từ riêng nhánh replay này. |
| Recommendation | Fingerprint actor/resource/payload thống nhất trong transaction; legacy replay policy rõ ràng. |
| Verification | Static branch confirmed; dynamic binding matrix cho ba nhóm NOT EXECUTED. SB-22 gốc chỉ release/consume/return vẫn được xác minh. |

### PRA-21 — Dependency advisories chưa được triage theo reachability

| Trường | Nội dung |
|---|---|
| ID / Severity / Category | PRA-21 / **P2** / Supply chain, Release assurance |
| Description | Native pnpm audit trên lockfile hiện tại trả99 advisory entries, có critical/high; chưa có triage/chấp nhận rủi ro theo đường sử dụng. |
| Evidence | `pnpm-lock.yaml`; `test-results/production-readiness/dependency-audit.json`, `dependency-summary.json`; root `package.json` pin pnpm10.6.2 |
| Root cause | Advisory baseline đã thay đổi; override/package pin không tự chứng minh an toàn mọi dependency path. |
| Reproduction | `pnpm audit --prod --json`, chạy read-only, không audit fix/update. |
| Expected | Các advisory reachable high/critical có xử lý hoặc mitigation/review date rõ ràng cho exact release artifact. |
| Actual | **2 critical,37 high,46 moderate,14 low**. Critical proxy-addr2.0.7 và shell-quote1.10.0. Paths có cả Express runtime và Expo/React Native tooling. |
| Impact | Chưa thể kết luận dependency release an toàn; mức advisory không đồng nghĩa hệ thống có2 lỗi P0. Proxy trust configuration và input path phải được xét. |
| Recommendation | Triage runtime/build/test reachability và affected options; ưu tiên reachable paths; cập nhật riêng và verify, không `audit fix --force`. |
| Verification | Advisory presence CONFIRMED; exploitability toàn bộ99 entries **NOT_VERIFIABLE** trong lượt audit. Python/image CVE scan chưa chạy. |

## C. Database & Migration Readiness — Phase 1

### Kiểm chứng đã thực hiện

- **29 migration SQL**: Auth3, Borrow9, Inventory17. Chạy theo thứ tự tên trên PostgreSQL audit, mỗi service trong schema transaction riêng rồi **ROLLBACK**; không reset/drop schema/database, không thay migration. Có SHA256 từng file và thời gian thực thi trong `migration-replay.json`.
- SQL replay ban đầu Inventory thất bại `gin_trgm_ops` do target audit Borrow chưa có extension. Chạy lại với `pg_trgm` trong chính transaction kiểm thử thì đủ17/17. Đây là bằng chứng bootstrap dependency, không phải lỗi SQL của migration. Production bootstrap phải tạo extension trước.
- Database audit đang dùng có `_prisma_migrations`: Borrow9 finished, Inventory verified17 finished; không failed/rolled-back ở hai target test. Database `inventory_audit` khác có initial migration failed từ lịch sử; **không dùng database đó và không tự resolve/sửa**. Không suy ra production có cùng lịch sử.
- Read-only `migrate diff` cho hai target so HEAD schema có mismatch PRA-15. Fresh generated clients v5.21.0 dùng đúng HEAD; không chạy generate đè client ứng dụng hay apply diff.
- SQL replay có transaction bao ngoài để không giữ schema kiểm thử. Nó **không** chứng minh Prisma CLI deploy bị ngắt giữa chừng luôn atomic; không đo lock duration trên bảng lịch sử lớn; không chạy `migrate deploy` production.

### Inventory từng migration

Trong bảng: `Q1` kiểm `_prisma_migrations`+checksum; `Q2` kiểm columns/defaults/nullability; `Q3` kiểm pg_indexes; `Q4` kiểm pg_constraint; `Q5` kiểm trigger/function. SQL cụ thể ở D. `F` = ưu tiên forward-fix khi đã có dữ liệu; `A` = có thể ngừng dùng field/table additive nếu chưa phát sinh dữ liệu, giữ schema lại an toàn hơn down DDL. “Rollback schema” luôn cần review riêng, không có lệnh down tự động.

| Service / Tên migration | Dependencies | Data compatibility / execution risk | Rollback strategy | Verification SQL |
|---|---|---|---|---|
| Auth `20260728150127_init` | DB auth, citext/pgcrypto bootstrap | Initial tables/FK/unique; cần baseline nếu DB đã có schema | F; restore độc lập khi cần | Q1,Q3,Q4 users/roles |
| Auth `20260808164900_add_email_verification` | users | Nullable verified_at, token table additive; ALTER lock | A trước token mới; F sau đó | Q2 users.email_verified_at; Q4 token FK |
| Auth `20261029090000_add_email_otp` | users | enabled=false; existing users không tự bật2FA; OTP history mới | A/F | Q2 users.email_otp_2fa_enabled; Q3 challenge index |
| Borrow `20260728150154_init` | DB borrow, citext/pgcrypto | Wallet/fines/loans/outbox/inbox; initial index/FK | F | Q1,Q3,Q4 |
| Borrow `20260909000000_add_analytics_read_indexes` | loan tables | Index thường, có thể chặn writes khi build trên bảng lớn | Có thể giữ index; down không cần cho app rollback | Q3 idx_loan_transactions_borrow_date, idx_loan_items_due_return |
| Borrow `20260912120000_add_fine_payment_intents` | fines | New table; FK CASCADE lịch sử cần cẩn trọng khi delete fine | F sau payment intent | Q2,Q3 uq_fine_payment_intents_txn_ref |
| Borrow `20261006090000_add_membership_plan_terms` | membership plans/memberships | Defaults0/365/false; backfill một default theo active holdings, không theo tên; cần review chọn đúng plan | F nếu terms đã dùng | Q2; SELECT code,is_default FROM membership_plans |
| Borrow `20261111090000_add_loan_item_deposits` | wallet ledger, account, loan item, intent | plan deposit0 giữ loan cũ không tự có cọc; SERIAL entry_seq trên lịch sử có thể rewrite/lock; append-only trigger; widened response20 | **F sau bất kỳ hold/payment; down gây orphan held balance/lịch sử** | Q2 entry_seq/deposit; Q3; Q4; Q5 |
| Borrow `20261112090000_add_wallet_topup_intents` | customers | Additive intents, RESTRICT history, unique txn_ref | F sau money movement | Q3,Q4 |
| Borrow `20261117140000_overdue_fine_periods` | fines, loan_items | Backfill ep baseline theo ngày UTC rollout; UPDATE toàn bộ OVERDUE, không đổi amount/payment; có CHECK validate và locks | **F; không xóa coverage sau khi kỳ mới phát sinh** | Q2; Q4 fines_accrual_days_order; D-H2 |
| Borrow `20261117141000_overdue_fine_due_dates` | previous episodes migration | Nullable due-date snapshot được backfill từ current loan item; không phục dựng các lần renewal cũ | F sau kỳ mới; không chạy backend cũ | Q2; D-H2 |
| Borrow `20261117150000_mixed_return_requests` | loan_transactions | Empty ledger lúc deploy; historical returns không được giả lập keys; FK action khác schema PRA-15 | F sau remote operation; **không xóa ledger để retry** | Q2; Q3 key; Q4; D-H3 |
| Inventory `20260728160000_init` | DB inventory, pgcrypto/pg_trgm | Initial tables/enum/trigram; clean replay cần extensions | F / baseline có kiểm chứng | Q1,Q3,Q4 |
| Inventory `20260728170000_add_packing_evidence_ai_verification` | packing_camera_evidence | Nullable AI columns additive | A/F, giữ evidence | Q2 ai_verification_result/status |
| Inventory `20260809010000_fix_packing_evidence_ai_columns_drift` | evidence table | IF NOT EXISTS; no-op nếu đúng, không sửa dữ liệu AI cũ | Giữ columns; F | Q2 |
| Inventory `20260809010100_fix_stock_audits_assignment_columns_drift` | stock_audits | IF NOT EXISTS assignment fields | Giữ fields; F | Q2 assigned_* |
| Inventory `20260809020000_add_location_coordinates_and_pick_sequence` | history metadata | **No-op recovery file**, comment nói không dùng để repair production history cũ; phải đối chiếu checksum/baseline thực | Không coi no-op là restore cột cũ | Q1 checksum, Q2 locations |
| Inventory `20260813090000_add_metadata_reconciliation` | authors/publishers | New alias/draft tables+FK; missing composite indexes so schema PRA-15 | F sau review history | Q2,Q3,Q4 |
| Inventory `20260813100000_add_duplicate_intelligence` | books | Nullable work_group, review drafts; work_group index SQL-only | A/F, giữ review history | Q2,Q3,Q4 |
| Inventory `20260906140000_add_exception_report_evidence_photo` | warehouse_exception_reports | Nullable URL; actual binary recoverability cần kiểm nơi lưu | A/F | Q2 evidence_photo_url |
| Inventory `20260915120000_add_supplier_email_unique_and_dispatch_expiry` | suppliers, dispatches | **Duplicate supplier email làm UNIQUE fail**; expires_at legacy NULL cần review semantics; ALTER+unique lock | F; không bỏ uniqueness để lách lỗi | Q3,Q4; D-H4 |
| Inventory `20261006100000_add_branch_contact_metadata` | warehouses | Nullable phone/email/hours/description | A/F | Q2 warehouses |
| Inventory `20261113090000_add_procurement_document_workflow` | PO, delivery, GRN, shortage | Defaults damaged/rejected0; delivered nullable historical fallback; new docs empty; partial unique case-insensitive invoices; default NULL idempotency | F sau chứng từ/GRN mới; down mất liên kết/tệp/history | Q2,Q3,Q4; D-H4/H5 |
| Inventory `20261114100000_add_purchase_order_revisions` | purchase_orders | New snapshots/revision table, unique PO/revision | F sau revisions | Q3,Q4 |
| Inventory `20261114110000_add_po_line_close_remaining` | purchase_order_items | Default OPEN cho line cũ, không tự suy ra closed historical | F sau closure decision | Q2 closure_status; D-H5 |
| Inventory `20261114120000_add_supplier_returns` | PO/GRN/items/supplier/warehouse | New return history, nullable links cho item legacy; FK action differs datamodel | F sau return stock, không xóa return để hoàn tồn | Q2,Q3,Q4 |
| Inventory `20261117090000_stock_audit_count_cutoff` | audits/lines/locations/balances | Historical baseline/counted_at NULL yêu cầu recount; active session partial unique; BEFORE quantity-write trigger | **F khi có session/count mới**; chỉ bỏ freeze khi nghiệp vụ kết thúc/hủy hợp lệ | Q2,Q3 uq_stock_audit_location_active; Q5; D-H6 |
| Inventory `20261117092000_transfer_discrepancy_workflow` | transfer/GRN/warehouse/variant | New tables/checks, không backfill discrepancy cũ; historical shipped/accepted cần review riêng | **F sau custody resolution, down mất ledger trách nhiệm** | Q2,Q3,Q4; D-H7 |
| Inventory `20261117160000_stock_audit_start_count` | count cutoff sessions+function | started_at nullable/no default; new code explicitly start; existing non-null sessions vẫn active; trigger predicate đổi | **F; phối hợp app version**, không tự set started_at NULL trên session đang đếm | Q2 started_at; Q5 function; D-H6 |

Auth/Borrow/Inventory dùng **database khác nhau** trên cùng PostgreSQL nên tên table/migration index giống nhau không tự xung đột. Không có cross-database FK đảm bảo customer/user/warehouse identity; internal HTTP và reconciliation chịu trách nhiệm. AI DDL chạy ở startup qua `services/ai-service/db.py:52–65`, CREATE IF NOT EXISTS không có version history/ALTER backfill cho bảng đã tồn tại. Không chứng nhận mọi schema AI lịch sử sẽ tự nâng cấp được. Analytics chỉ reader; role grants/default privileges phải kiểm sau migration.

Không phát hiện narrowing datatype gây truncate trong29 SQL đã đọc; widen fine response10→20 là mở rộng. Không có destructive DDL cần chạy trong migration chain. Điều này **không chứng minh an toàn dữ liệu lịch sử hoặc zero downtime**: UNIQUE/CHECK/index/ALTER và backfill có thể chờ lock. Nguồn PostgreSQL15 mô tả ALTER có ACCESS EXCLUSIVE trừ trường hợp nêu khác: [ALTER TABLE](https://www.postgresql.org/docs/15/sql-altertable.html). Đo lock/backfill trên restored copy cùng quy mô trước triển khai.

### Execution safety và interrupted migration

Preflight phải so checksum migration đã apply, extensions, role grants, duplicate/email/invoice, null/cutoff, table sizes, active transactions, disk, backup restore evidence. Không sửa file migration đã deploy để lách checksum. No-op recovery `20260809020000` đặc biệt cần người vận hành xác nhận lịch sử thật.

Nếu interrupted: giữ maintenance; kiểm `_prisma_migrations.finished_at/rolled_back_at/logs`, catalog thực và lock; không chỉ restart container liên tục. Chọn reviewed forward-fix hoặc hoàn tác phần **chưa có business writes** bằng kế hoạch riêng; chỉ dùng `migrate resolve` sau khi chứng minh catalog và dữ liệu tương ứng trạng thái đánh dấu. `resolve` chỉ thay history state, không tự undo SQL: [Prisma resolve](https://docs.prisma.io/docs/cli/migrate/resolve), [patching/hotfixing](https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing). Repository dùng Prisma5.21; không thay CLI bằng hướng dẫn API migration của major mới.

## D. Historical Data Risks và SQL read-only

**Không có dữ liệu lịch sử production để chạy các kiểm tra này. Tất cả kết luận về độ sạch production: NOT_VERIFIABLE.** SQL dưới đây chỉ SELECT trong transaction READ ONLY, trả ID/số lượng thay vì tên/email/token. Chạy từng nhóm ở đúng database bằng account audit read-only, timeout ngắn, không export PII. Không chạy SQL thiếu table trước migration; dùng Q2 trước. Nếu SQL phát hiện lệch, không tự UPDATE/backfill.

### Catalog checks Q1–Q5

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
-- Q1: history; checksum so với SHA256 file, không xuất cột logs có thể chứa dữ liệu nhạy cảm.
SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
FROM _prisma_migrations ORDER BY migration_name;
-- Q2: thay table/column filter theo từng dòng migration.
SELECT table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns WHERE table_schema='public'
ORDER BY table_name,ordinal_position;
-- Q3: bao gồm partial unique indexes mà Prisma datamodel không mô tả hết.
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public';
-- Q4
SELECT conrelid::regclass AS table_name,conname,contype,convalidated,pg_get_constraintdef(oid)
FROM pg_constraint WHERE connamespace='public'::regnamespace;
-- Q5
SELECT tgrelid::regclass AS table_name,tgname,pg_get_triggerdef(oid)
FROM pg_trigger WHERE NOT tgisinternal;
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname IN ('enforce_stock_audit_location_freeze','smartbook_reject_ledger_mutation','smartbook_guard_loan_item_deposit');
ROLLBACK;
```

### D-H1 — Wallet, ledger, deposits (borrow_db)

Historical wallet opening balance phải có chứng từ; entry_seq được backfill bằng thứ tự table không chứng minh đúng chronology cũ. Reconciler có thật (`account.service.js:389–433`) kiểm held sum, chain và last available; trường hợp account không có entry được xem available_matches=true, nên phải rà account balance≠0/zero ledger riêng.

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
WITH totals AS (
 SELECT account_id,count(*) AS entries,
 sum(CASE WHEN entry_type='HOLD' THEN amount
          WHEN entry_type IN ('RELEASE','CAPTURE') THEN -amount ELSE 0 END) AS held
 FROM account_ledger GROUP BY account_id
), last_entry AS (
 SELECT DISTINCT ON (account_id) account_id,balance_after
 FROM account_ledger ORDER BY account_id,entry_seq DESC
)
SELECT a.id,a.available_balance,a.held_balance,coalesce(t.entries,0) AS entries,
       coalesce(t.held,0) AS ledger_held,l.balance_after
FROM customer_accounts a LEFT JOIN totals t ON t.account_id=a.id
LEFT JOIN last_entry l ON l.account_id=a.id
WHERE a.available_balance<0 OR a.held_balance<0
   OR a.held_balance<>coalesce(t.held,0)
   OR (l.account_id IS NOT NULL AND a.available_balance<>l.balance_after)
   OR (coalesce(t.entries,0)=0 AND (a.available_balance<>0 OR a.held_balance<>0));
WITH chain AS (
 SELECT id,account_id,balance_before,
 lag(balance_after) OVER(PARTITION BY account_id ORDER BY entry_seq) AS previous_after
 FROM account_ledger
)
SELECT id,account_id FROM chain WHERE previous_after IS NOT NULL AND balance_before<>previous_after;
SELECT id,loan_item_id,status,amount,captured_amount,refunded_amount
FROM loan_item_deposits
WHERE amount<=0 OR captured_amount<0 OR refunded_amount<0
 OR (status<>'HELD' AND captured_amount+refunded_amount<>amount)
 OR (status='HELD' AND (captured_amount<>0 OR refunded_amount<>0 OR settled_at IS NOT NULL));
SELECT loan_item_id,count(*) FROM loan_item_deposits GROUP BY loan_item_id HAVING count(*)>1;
ROLLBACK;
```

Không giả định loan cũ không có deposit row là lỗi: migration cố ý không thu cọc hồi tố. Đối soát held balance với **toàn bộ** HOLD/RELEASE/CAPTURE và các loại hold khác trước khi kết luận tổng deposit bằng mọi held funds.

### D-H2 — Fines/episodes/payments và cached debt (borrow_db)

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
WITH paid AS (SELECT fine_id,sum(amount) AS amount FROM fine_payments GROUP BY fine_id),
debt AS (
 SELECT f.customer_id,sum(CASE WHEN f.status IN ('PAID','WAIVED') THEN 0
  ELSE greatest(0,f.amount-coalesce(f.waived_amount,0)-coalesce(p.amount,0)) END) AS balance
 FROM fines f LEFT JOIN paid p ON p.fine_id=f.id GROUP BY f.customer_id
)
SELECT c.id,c.total_fine_balance,coalesce(d.balance,0) AS computed_balance
FROM customers c LEFT JOIN debt d ON d.customer_id=c.id
WHERE c.total_fine_balance<>coalesce(d.balance,0);
SELECT f.id,f.amount,f.waived_amount,coalesce(sum(p.amount),0) AS paid
FROM fines f LEFT JOIN fine_payments p ON p.fine_id=f.id
GROUP BY f.id HAVING coalesce(sum(p.amount),0)>f.amount-coalesce(f.waived_amount,0);
SELECT fine_id,payment_method,transaction_reference,count(*)
FROM fine_payments WHERE transaction_reference IS NOT NULL
GROUP BY fine_id,payment_method,transaction_reference HAVING count(*)>1;
SELECT id,status,vnp_response_code FROM fine_payment_intents
WHERE status IN ('FAILED','EXPIRED','PROCESSING');
-- Provider amount/settlement phải đối soát nguồn riêng; FAILED không đủ chứng minh chưa thu tiền.
SELECT f.id FROM fines f LEFT JOIN overdue_fine_episodes e ON e.loan_item_id=f.loan_item_id
WHERE f.fine_type='OVERDUE' AND f.loan_item_id IS NOT NULL AND e.loan_item_id IS NULL;
SELECT id,loan_item_id,accrual_due_date,accrual_from_days,accrual_through_days
FROM fines WHERE fine_type='OVERDUE' AND
 (accrual_from_days<0 OR accrual_through_days<coalesce(accrual_from_days,0));
SELECT a.id,b.id,a.loan_item_id FROM fines a JOIN fines b
 ON a.loan_item_id=b.loan_item_id AND a.id<b.id AND a.fine_type='OVERDUE'
 AND b.fine_type='OVERDUE' AND a.accrual_due_date=b.accrual_due_date
WHERE a.accrual_from_days IS NOT NULL AND b.accrual_from_days IS NOT NULL
 AND greatest(a.accrual_from_days,b.accrual_from_days)<least(a.accrual_through_days,b.accrual_through_days);
ROLLBACK;
```

Legacy fines có through_days nhưng from/rate NULL là policy adoption, không tự coi sai. Due-date migration chỉ biết **ngày đến hạn hiện tại**, không phục dựng chronology các lần gia hạn. Baseline dùng UTC, cần business owner chấp nhận cutoff nếu ngày nghiệp vụ hiển thị Asia/Saigon. Phương án backfill riêng: snapshot bảng/amount/payment hashes; dry-run SELECT xác định records; business signoff về cutoff; transaction có checkpoint và audit; không truy thu suy đoán; rollback backfill chỉ trước kỳ mới, sau đó forward adjustment bất biến.

### D-H3 — Loans/returns/outbox (borrow_db)

```sql
BEGIN TRANSACTION READ ONLY;
SELECT id,loan_id,status,started_at,updated_at FROM loan_return_requests
WHERE status<>'COMPLETED' AND started_at<now()-interval '30 minutes';
SELECT l.id,l.status,count(*) FILTER(WHERE i.status IN ('BORROWED','OVERDUE')) AS active,
 count(*) FILTER(WHERE i.status='LOST') AS lost
FROM loan_transactions l JOIN loan_items i ON i.loan_id=l.id
GROUP BY l.id HAVING
 (l.status='RETURNED' AND count(*) FILTER(WHERE i.status='LOST')>0)
 OR (l.status IN ('RETURNED','LOST') AND count(*) FILTER(WHERE i.status IN ('BORROWED','OVERDUE'))>0);
SELECT status,event_type,count(*),min(occurred_at) AS oldest,max(retry_count) AS max_retry
FROM integration_outbox GROUP BY status,event_type;
SELECT id,event_type,status,retry_count,occurred_at FROM integration_outbox
WHERE status IN ('PENDING','FAILED') ORDER BY occurred_at LIMIT 200;
ROLLBACK;
```

Local data không đủ phát hiện mọi consume-committed/no-loan; cần inventory movement/reservation export chỉ IDs và compare với Borrow bằng internal read API hoặc analyst job, không cross-DB join giả định. Return request cũ không có ledger mới là hợp lệ; không tạo keys lịch sử giả để đánh dấu completed.

### D-H4/H5 — Supplier identity, documents, PO/GRN (inventory_db)

```sql
BEGIN TRANSACTION READ ONLY;
-- Không xuất địa chỉ email: hash chỉ dùng nhóm trùng trong phạm vi DB.
SELECT md5(email::text) AS email_group,count(*) FROM suppliers
WHERE email IS NOT NULL GROUP BY email HAVING count(*)>1;
SELECT supplier_id,coalesce(invoice_series,''),md5(lower(external_number)),count(*)
FROM procurement_documents WHERE document_type IN ('VAT_INVOICE','SALES_INVOICE','PROFORMA_INVOICE')
 AND external_number IS NOT NULL AND status<>'CANCELLED'
GROUP BY supplier_id,coalesce(invoice_series,''),lower(external_number) HAVING count(*)>1;
SELECT supplier_delivery_invoice_id,count(*) FROM goods_receipts
WHERE supplier_delivery_invoice_id IS NOT NULL AND status<>'CANCELLED'
GROUP BY supplier_delivery_invoice_id HAVING count(*)>1;
SELECT id,ordered_qty,received_qty,closure_status FROM purchase_order_items
WHERE received_qty<0 OR received_qty>ordered_qty;
SELECT id,quantity,delivered_qty,damaged_qty,rejected_qty FROM goods_receipt_items
WHERE quantity<0 OR damaged_qty<0 OR rejected_qty<0
 OR (delivered_qty IS NOT NULL AND delivered_qty<>quantity+damaged_qty+rejected_qty);
SELECT g.id FROM goods_receipts g WHERE g.status='POSTED' AND g.supplier_delivery_invoice_id IS NOT NULL
AND EXISTS (SELECT 1 FROM supplier_delivery_invoice_items n
 WHERE n.invoice_id=g.supplier_delivery_invoice_id AND NOT EXISTS
 (SELECT 1 FROM goods_receipt_items i WHERE i.goods_receipt_id=g.id AND i.variant_id=n.variant_id));
SELECT id,document_id,storage_ref,size_bytes,sha256 FROM procurement_document_files;
ROLLBACK;
```

Storage_ref cuối cần kiểm file tồn tại/hash trên bản restore, không cho rằng SELECT metadata là đủ. `delivered_qty NULL` trên GRN cũ dùng fallback quantity+damaged+rejected; review dữ liệu gốc để tránh diễn giải accepted thành delivered. PO cũ default OPEN không có nghĩa nhà cung cấp còn nghĩa vụ sau một quyết định đóng chưa lưu trong hệ thống.

### D-H6/H7 — Stock audits, custody, discrepancy (inventory_db)

```sql
BEGIN TRANSACTION READ ONLY;
SELECT a.id,a.status,count(*) AS missing_cutoff FROM stock_audits a
JOIN stock_audit_lines l ON l.stock_audit_id=a.id
WHERE a.status NOT IN ('APPROVED','CANCELLED') AND
 (l.counted_at IS NULL OR l.baseline_on_hand_qty IS NULL OR l.baseline_borrowed_qty IS NULL)
GROUP BY a.id;
SELECT location_id,count(*) FROM stock_audit_location_sessions
WHERE released_at IS NULL GROUP BY location_id HAVING count(*)>1;
SELECT s.id,s.stock_audit_id,s.started_at,s.counting_completed_at,a.status
FROM stock_audit_location_sessions s JOIN stock_audits a ON a.id=s.stock_audit_id
WHERE s.released_at IS NULL AND (a.status IN ('APPROVED','CANCELLED') OR s.started_at<now()-interval '1 day');
SELECT id,warehouse_id,variant_id,location_id FROM stock_balances
WHERE least(on_hand_qty,available_qty,reserved_qty,borrowed_qty,damaged_qty,in_transit_qty)<0
 OR available_qty+reserved_qty+borrowed_qty+damaged_qty>on_hand_qty;
SELECT id FROM transfer_discrepancy_items WHERE
 delivered_qty<>accepted_qty+damaged_qty+rejected_qty
 OR least(remaining_missing_qty,remaining_damaged_qty,remaining_rejected_qty)<0
 OR remaining_missing_qty>missing_qty OR remaining_damaged_qty>damaged_qty OR remaining_rejected_qty>rejected_qty;
SELECT t.id,t.status,g.id AS receipt_id,g.status AS receipt_status FROM transfer_orders t
JOIN goods_receipts g ON g.source_type='TRANSFER' AND g.source_reference_id=t.id
WHERE (g.status='POSTED' AND t.status='IN_TRANSIT') OR (g.status='CANCELLED' AND t.status='RECEIVED');
SELECT d.id,d.status FROM transfer_discrepancies d WHERE d.status='RESOLVED'
AND EXISTS (SELECT 1 FROM transfer_discrepancy_items i WHERE i.discrepancy_id=d.id
 AND i.remaining_missing_qty+i.remaining_damaged_qty+i.remaining_rejected_qty>0);
ROLLBACK;
```

Stock predicate trên là **screening**, không phải phương trình bao trùm mọi bucket. Receiving/staging/quarantine có quantity không pickable và không nằm available; `on_hand` đang gồm borrowed theo audit policy, nên “physical on-site” là on_hand−borrowed trong phạm vi policy. Không cộng movement quantity thô: loại movement có from/to, bucket, reverted và stock-borrow semantics khác nhau. Đối soát cần theo variant+warehouse+location/bucket, tính OUTBOUND/INBOUND/TRANSFER/borrow/return/write-off đúng dấu và điểm ownership; unitized variant phải so inventory_units trạng thái/location, bulk variant không buộc mọi cuốn có unit. Chưa có bằng chứng chạy reconciliation toàn bộ production movement/balance/unit.

Legacy transfer đã RECEIVED trước workflow discrepancy không tự sinh hồ sơ mới; không nhập thiếu/hỏng hồi tố vào stock. Backfill riêng phải dựa chứng từ gốc và kiểm physical custody, có ledger điều chỉnh, người chịu trách nhiệm, approval và idempotency. Legacy stock audits thiếu cutoff phải recount; không backfill counted_at bằng created_at để ép approve.

## E. Cross-Service Consistency — Phases 2–4

### Outbox, inbox và recovery thực tế

| Luồng | Bảo vệ hiện có | Đường còn thất bại / reconciliation |
|---|---|---|
| Inventory domain mutation→broker | Nhiều flow insert integration_outbox cùng local transaction; publisher có allowlist, persistent exchange/queue, retry10 và FAILED | Publish xong trước mark PUBLISHED có thể gửi trùng; nhiều process không có SKIP LOCKED/claim, không được tuyên bố exactly-once. Cần consumer idempotency; backlog gauge chỉ batch |
| Broker→Gateway | Durable consumer/DLQ và manual ack; UI event phục vụ cập nhật trạng thái | Client reconnect cần fetch state; event trùng/sai thứ tự không được dùng như stock/financial source of truth |
| Broker→Borrow availability alert | `lib/rabbitmq-consumer.js` prefetch10, requeue một lần rồi DLQ; service có per-alert idempotency | Không phải cơ chế reconcile Borrow loans với Inventory stock. DLQ triage/alert thực chưa xác minh |
| Borrow reservation create→stock reserve | Caller idempotency và local limit lock; compensation release retry/outbox khi lỗi được catch | Crash trước persist compensation vẫn có hold không có local reservation; PRA-07 |
| Direct borrow consume→loan/cọc | Inventory consume key; local wallet/deposit transaction; catch ghi manual unresolved | Không có atomic transaction xuyên DB; manual intent best-effort; PRA-07/08; không tự undo khi thiếu unit identifiers |
| Convert/cancel reservation | State advisory locks và Inventory ACTIVE conditional claim | Cancel commit rồi process chết trước release có thể kẹt; retry terminal state không nhất thiết release |
| Return mixed | Parent operation ledger trước remote calls; child keys theo item; deadlines; local settlement atomic; retry cùng key hoàn tất marker | Có lease30 phút; worker không tự hoàn tất mọi unresolved return; cần UI giữ key và manual review/alert; local DB failure sau remote vẫn cần durable detection |
| Wallet/deposit | Lock account row, ledger cùng transaction, append-only/settled immutable triggers | Key payload binding thiếu CREDIT/DEBIT; reconcile chạy theo yêu cầu, chưa có toàn bộ scheduled production reconciliation |
| Payment | Atomic intent PENDING→PROCESSING và fine row lock chống callback double-apply | Stale/expired successful settlement vẫn PRA-01; payment quầy PRA-05, customer aggregate PRA-06 |
| Auth→services | JWT/internal key, scope resolver; Analytics reader isolation | Direct replay PRA-04; token URL logging PRA-12; credential rotation/revocation incident drill chưa xác minh |
| AI→catalog/analytics/actions | Action Center có guard/confirmation và idempotent execution tests; nguồn LLM được validate theo feature | Legacy inference/upload routes PRA-11/16; AI PG concurrent action tests skip trong lượt này |

Không có bằng chứng một reconciler production tự động so **mọi** reservation/loan/unit/movement/cọc/provider settlement; retry queue chỉ chữa một tập action. Notification gửi qua socket bằng setImmediate trong một số transaction cũng không chứng minh notification chỉ xuất hiện sau commit; không dùng event UI thay việc đọc lại DB.

### Ma trận idempotency

| Operation | Cùng key/cùng payload | Key khác payload | Hai request đồng thời / giới hạn |
|---|---|---|---|
| Borrow reservation | DB replay test PASS, actor scoped và legacy creator check | DB conflict test PASS | Một reservation/hold trong existing DB test |
| Inventory reserve | Replay existing source reference | Chưa so đủ payload, PRA-20 | Existing concurrency tests không đủ chứng nhận mọi key/reference combination |
| Consume / release | Replay ledger; binding checks PASS |409 trong tests PASS | ACTIVE claim chỉ một transition thắng |
| Return borrowed stock | Per-loan-item movement và payload binding |409 trong tests PASS | Hai keys cho item đã trả không thêm movement |
| Direct loan | Replay tồn tại | Không bind actor/full payload, PRA-04 | Loan membership lock không thay thế request identity |
| GRN specialized | Key unique, stored kho/PO/delivery scope | Không so item counts, PRA-20 | Delivery route guard PASS; generic route bypass PRA-02 |
| POST GRN | Conditional claim DRAFT→POSTED | State claim không bind mọi caller payload | Cùng GRN posting test PASS; hai GRN cùng delivery vẫn sai |
| Fine quầy | Không có replay payment identity | Không áp dụng, PRA-05 | Fine lock chỉ giới hạn remaining |
| VNPay callback | Atomic intent claim, repeated success không double-payment ở cases đã test | Signature/amount check | Stale success không được hạch toán, PRA-01 |
| Wallet credit/debit | Ledger key và account lock | Replay amount/reference khác chưa reject, PRA-20 | Wallet PG tests PASS, không suy ra mọi payload conflict an toàn |
| Deposit settlement | Lock/unique deposit, trigger immutable | Settlement một lần | Existing PG concurrent settlement PASS |
| Transfer receipt/discrepancy resolution | Dedicated state/ledger/key và locks | Resolution fingerprint kiểm conflict | Dedicated concurrency PASS; alternate route custody sai PRA-03 |

### 10 tình huống concurrency bắt buộc

| Tình huống | Kiểm chứng / actual | Đánh giá |
|---|---|---|
|1 Hai người mượn cuốn cuối| Inventory PG reserve/consume concurrency và membership limit tests PASS | Bảo vệ local claim được kiểm; deployed simultaneous final-copy soak chưa chạy |
|2 Hai người POST một GRN| Existing DB claim/cancel/receipt tests PASS | Cùng GRN được bảo vệ; hai GRN chung delivery PRA-02 vẫn tái hiện |
|3 Hai người xác nhận return| Borrow+Inventory DB tests PASS với item/state locks | Không lặp item movement ở cases kiểm |
|4 Hai payment callbacks| vnpay-topup/deposit PG cases PASS | Chống double-apply cùng intent; khác intent/stale success còn PRA-01 |
|5 Hai lần refund cọc| deposit.db.test.js concurrency PASS | Trigger + account/deposit locks bảo toàn trong test |
|6 Hai resolution transfer discrepancy| transfer-discrepancy DB tests PASS | Không lặp dedicated resolution; route chung khác PRA-03 |
|7 Audit cùng nhập/xuất| stock-audit-cutoff DB trigger và browser10→8→xuất2→6 PASS | Kiểm freeze/cutoff; chưa stress nhiều kho/thứ tự lock |
|8 Hai request reservation| reservation-idempotency DB/Inventory ACTIVE claim PASS | Cùng key và competing transitions có test; reserve changed payload còn PRA-20 |
|9 Hai cập nhật phạt| Cùng fine lock existing PASS; **khác fine cùng khách PG tái hiện cached50.000 thay0** | PRA-06 CONFIRMED |
|10 Timeout/retry đồng thời| inventory-consume-timeout và mixed-return DB PASS; response-lost tests hiện có | Chưa chứng nhận kill-process/DB outage windows, PRA-07 |

Không dùng sự hiện diện `FOR UPDATE` làm kết luận đủ: PRA-06 đã có fine row locks nhưng thiếu customer aggregate lock **trước query**. Stock freeze trigger khóa location theo thứ tự; cần stress writers chạm nhiều balance/location và audit lifecycle trên restored DB để đánh giá deadlock/timeout thật; chưa khẳng định không có deadlock.

## F. Infrastructure, Security, Observability — Phases 5–7

### Cấu hình vận hành đã đọc

Production Compose riêng dev, image tag theo SHA; Caddy chỉ publish80/443; DB/Redis/RabbitMQ ở internal data network; volume DB/broker/uploads/cache, log rotation và resource limits có cấu hình. DB max_connections200, Prisma singleton mỗi writer, Analytics pool mặc định5 mỗi DB. Đây là cấu hình, không phải số connection thực dưới tải.

Các điểm chưa đủ: runtime pool/statement/transaction timeout không được điều chỉnh thống nhất theo capacity VPS; Analytics Pool không đặt statement_timeout/query timeout; Prisma interactive transaction default không bảo đảm SLA qua remote calls. Cần đo peak connections của mọi service+jobs+migrators, giữ headroom, query p95/p99 và slow-query log; không kết luận exhaustion chỉ từ CPU hoặc singleton. Không có PgBouncer/PITR WAL archiving được chứng minh trong Compose; chưa đo query plans/index selectivity trên lịch sử thực.

Secret review không in giá trị `.env`, DB URL có credentials, JWT/API/SMTP/payment token vào báo cáo. Các `${...:?}` buộc nhiều critical vars, OTP_HMAC_SECRET production bắt buộc; VNPay/SMTP/OpenRouter có default rỗng nên service có thể healthy trong khi chức năng chưa hoạt động. VNPay URL production còn default sandbox: cần xác minh môi trường provider, return/IPN URLs, merchant registration và thử giao dịch thật có kiểm soát trước enable. Không coi template defaults là secret thật hoặc kết luận credential đã leak. `.env` hiện hữu không được dùng cho test.

Browser token/client storage, CORS/cookie, JWT/role/warehouse middleware, internal key, upload và user-controlled URLs được đọc ở các boundary liên quan. Unit warehouse/RBAC/auth tests đạt không thay thế full deployed actor matrix. Không thay đổi RBAC. SQL interpolation `$queryRawUnsafe` phải xem caller-controlled identifiers/parameters từng trường hợp, không quy mọi raw SQL thành SQL injection. Không phát hiện/khẳng định XSS/CSRF/SSRF khai thác được chỉ từ keyword scan.

| Actor / boundary | Evidence có | Còn cần trước GO |
|---|---|---|
| Super Admin/Admin | Auth/gateway unit, admin route guard | Deployed admin lifecycle, revoke/rotate, audit logs không secret |
| Manager | Inventory/borrow scope tests; browser procurement/count/discrepancy | Cross-warehouse direct-loan replay phải reject PRA-04 |
| Warehouse Staff | Assigned-task middleware; browser receiving/transfer | Ma trận assigned/unassigned, kho nguồn/đích, write vs read với session thật |
| Librarian | Borrow permissions và fine policy tests | Không dùng tên role để bỏ warehouse/object authorization; fine payment idempotency |
| Customer | Reservation browser, self-service unit | IDOR mọi resource UUID, concurrent wallet/provider, revoked session |
| Supplier token/internal caller | Token validation và internal key guards ở chuyên biệt | Token logs PRA-12; least privilege; legacy AI anonymous PRA-11 |

### Incident response đề xuất — chưa xác nhận owner/kênh thật

| Tín hiệu | Alert/owner đề xuất | Hành động đầu |
|---|---|---|
| DB disconnect/readiness503/connection cap | On-call vận hành + DB owner, paging channel | Dừng writes admission; kiểm connections/locks/disk; giữ DB/volumes, không reset |
| Inventory unavailable hoặc compensation tăng | Backend on-call, alert oldest unresolved | Tạm dừng mutation mượn/trả liên service; giữ key; reconcile holds/movements/loans |
| Borrow unavailable | Backend on-call | Không vận hành stock-side return thay thế bằng tay; restore service và đọc lại state |
| Outbox PENDING oldest>5m/FAILED>0/DLQ>0 | Backend+ops | Kiểm broker/consumer/manual backlog; requeue có kiểm duyệt, không publish/xóa hàng loạt |
| Provider success thiếu settlement hoặc callback lỗi | Finance owner + payment on-call, paging | Bảo toàn txn_ref/provider result, reconcile tiền dư/refund; không sửa PAID bằng tay |
| AI429/402/budget gần cạn | AI owner, budget alert | Circuit-break billable routes; fallback/manual catalog, không ảnh hưởng nghiệp vụ kho |
| Disk>80/90%, RAM/OOM/restart loop | VPS on-call | Giảm tải, kiểm log/volume growth, tăng capacity; không xóa DB/evidence |
| Backup local/offsite trễ/checksum sai | Backup owner + incident lead | Khắc phục và diễn tập restore copy mới; không chỉ cập nhật timestamp |

Ngưỡng trên là **đề xuất**, cần đo SLO/load và chốt tên người/kênh trực thật. `ALERT_WEBHOOK_URL` có trong template nhưng không có bằng chứng đã cấu hình/gửi thành công. Repository có metrics/correlation IDs/logs nhưng chưa chứng minh dashboard/collector hoạt động trên VPS.

## G. Scenario Testing và Evidence Ledger — Phase 8

### Kết quả thực thi mới

| Kiểm tra | Loại | Actual | Artifact local |
|---|---|---|---|
| Borrow toàn suite | Unit + DB integration với remote mocks theo test |258 PASS,0 FAIL,0 SKIP| `current-client/borrow.log` |
| Inventory toàn suite | Unit + DB integration |419 PASS,0 FAIL,0 SKIP| `current-client/inventory.log` |
| Analytics toàn suite | Unit + PostgreSQL query integration |162 PASS,0 FAIL,0 SKIP| `current-client/analytics.log` |
| Shared/Gateway/Auth | Unit |31/15/89 PASS,0 SKIP| `current-client/{shared,gateway,auth}.log` |
| Web | Unit |80 PASS,0 SKIP| `web-unit.log` |
| Workspace config | Unit/config |84 PASS,0 SKIP| `workspace-tests.log` |
| Mobile | Jest unit |216 PASS,33 suites,0 FAIL| `mobile-tests.log` |
| Inventory / Analytics contracts | HTTP integration trên QA services thật |12+7 PASS,0 FAIL,0 SKIP| `contracts-isolated.log` |
| AI | Offline Python unit/integration with fakes |1612 PASS; **12 SKIPPED = NOT EXECUTED**;153 subtests PASS, không cộng vào test count| `ai-tests.log`, `ai-tests.xml` |
| Migration SQL replay | Database DDL integration trong transaction rollback |29/29 SQL_REPLAY_PASS trên clean schemas với extensions| `migration-replay.json/log` |
| Additional financial probes | Actual controller + real PG, callback provider mocked, aggregate scheduling barrier |3 lỗi tái hiện theo expected failing behavior| `money-db-probes.log` |
| Additional inventory probes | Actual controller + real PG |Duplicate DN→stock20/10; transfer custody12/10| `inventory-db-probes.log` |
| Borrow isolated probes | Actual controller/job, mocked persistence |IDOR replay, partial payment duplicate, queue starvation tái hiện| `borrow-probes.log` |
| Browser E2E | Edge, running QA services/PostgreSQL, retries0 |**8 PASS,0 FAIL,0 SKIP**,3.1phút| `browser-e2e.log`; Playwright JSON/JUnit dưới `apps/web/test-results/` |
| Lint, typecheck, build | Static/build | pnpm lint/typecheck/build exit0 | `lint.log`, `typecheck.log`, `build.log` |
| Dependency advisory | Lockfile analysis |99 entries; không remediate tự động| `dependency-audit.json`, `dependency-summary.json` |

Không cộng unit suite focused của reviewer vào full suite vì trùng test. Test tổng backend Node **974** (258+419+162+31+15+89); đây không phải974 E2E. Log paths ở bảng nằm dưới `test-results/production-readiness/`, bị ignore; báo cáo giữ kết quả và cách tái hiện để review không cần tin báo cáo cũ. Lượt contract gọi trực tiếp ban đầu thiếu environment QA (`INTERNAL_SERVICE_KEY`/BASE_URL), không được coi PASS; chạy lại bằng `pnpm test:stack contracts` nạp đúng môi trường isolated mới đạt12+7/19.

Sáu block SQL read-only trong D đã được chạy kiểm tra cú pháp/cột trên đúng hai database audit, tất cả `SQL_VALID_READ_ONLY`; artifact `readonly-sql-validation.json`. Kết quả này xác nhận SQL dùng được với schema audit hiện tại, không chứng nhận dữ liệu lịch sử production sạch. Logger probe dùng marker không bí mật được lưu ở `logger-probe.log`.

AI12 test skipped gồm6 action/reconciliation concurrency PostgreSQL và6 vector/catalog PostgreSQL do `TEST_PG_DSN` không set. Không tính chúng là PASS. `.venv` local thiếu pytest; đã dùng Python host có pytest9.0.3 chạy suite thành công. Không cài/đổi dependencies.

Lượt kiểm đầu dùng audit clients cũ dưới `.git/borrow-audit-client`/inventory audit client; thiếu model mới gây TypeError và mixed-return barrier treo. Đã dừng đúng process test audit, giữ log ban đầu, sinh clients mới từ HEAD vào `.git/production-readiness-*-client` rồi chạy lại đầy đủ với `--test-timeout=45000 --test-concurrency=1`; lượt cuối0fail/0skip. Không gán lỗi client kiểm thử cũ thành defect ứng dụng. Generate đầu tiên không resolve được @prisma/client ngoài workspace, đã chuyển vào build directory `.git` có module junction; git status source giữ nguyên. Một exploratory fake redelivery hypothesis trả201/400 thay vì201/201, **loại bỏ giả thuyết vượt cap này**, không tính finding; không bỏ assertion app để làm suite xanh.

QA stack được kiểm isolated, khởi động lại các container test có sẵn. So hash code các core Inventory/Borrow files với workspace; Borrow loan controller image cũ khác indentation nên đã build/recreate **chỉ Borrow service trong QA** rồi chạy browser; không build/deploy VPS. Các E2E fixture tạo dữ liệu độc lập và một số stage được thiết lập trực tiếp bằng SQL, do đó không diễn giải mọi stage fixture là được người dùng thao tác qua UI.

### 10 kịch bản theo yêu cầu

| # / Input | Expected | Actual / state before-after | Events, retry, recovery và giới hạn |
|---|---|---|---|
|1 AI nhập sách→review→catalog| Nhận diện có provenance, review có quyền, lưu catalog hợp lệ | **Live AI E2E NOT EXECUTED**; offline AI/catalog/validation tests PASS | Paid keys cố ý không có; chưa xác minh OCR thật/provider budget/outage tới save. Không gọi mock là live AI |
|2 PO→delivery→GRN→POST→putaway| Stock tăng đúng5, available chỉ tăng sau putaway | Browser PASS; on_hand trướcN→N+5 khi POST; putaway vẫnN+5 và available tăng | Auth supplier/staff/manager thực qua API/UI; dedicated path PASS. Retry alternate generic route còn PRA-02 |
|3 Transfer→receive→discrepancy| shipped10, delivered9=accepted7+damaged1+rejected1, missing1 | Browser PASS; FOUND missing1, WRITE_OFF damaged1, RETURN_TO_SOURCE rejected1; final destination8/source1, available0, discrepancy RESOLVED | Stage IN_TRANSIT là fixture SQL; UI nhận và resolve thực. Dedicated DB replay tests PASS; alternate generic PRA-03 |
|4 Customer reserve→consume→loan| Một reservation, pickup code, một loan | Browser PASS qua customer+staff login, reservation confirm/ready/convert, trả thành RETURNED | Browser assert state/UI/API, không đối soát toàn ledger ở riêng test này; DB tests bổ sung concurrency/key |
|5 GOOD return/refund| Hoàn đúng cọc cuốn GOOD, movement một lần | Mixed browser+PG PASS;3cuốn/cọc30.000 mỗi cuốn; GOOD refunded30.000 | Mixed test dùng dedicated plan/stock fixture; full PG deposit tests kiểm chain/balance/idempotency |
|6 DAMAGED return| Fine/capture riêng, không available hàng hỏng | Mixed browser PASS, DAMAGED refunded0, notes/condition giữ; DB fine/deposit cases PASS | Không khẳng định every damaged tariff ở production đã đúng; rate/policy configuration cần xác nhận |
|7 LOST return| Không nhập lại vật lý, settle cọc, loan kết thúc LOST | Mixed browser/PG PASS; LOST refunded0, trạng thái loan LOST | DB validates status/payments/deposits; actual physical loss responsibility ngoài hệ thống chưa kiểm |
|8 Overdue→accrue→partial→full| Kỳ mới chỉ ngày chưa covered, paid history immutable | Fine-policy/deposit/VNPay **DB integration PASS**, browser future-waive PASS; **full xuyên provider E2E NOT EXECUTED** | Thêm probes PRA-01/05/06 tái hiện lỗi thực; không tuyên bố financial GO |
|9 Audit→count→submit→approve| 10 baseline, count8, xuất2 sau chốt, final6; không overwrite8 | Browser+PG PASS; row count6, approval movement một lần trong DB tests | Browser outbound2 dùng SQL fixture để kiểm cutoff, không phải full shipping action; trigger tests kiểm freeze; kill/restart chưa chạy |
|10 Reorder→budget→PO| Funded quantities đi vào PO, incoming shortage còn tính | Browser PASS; Analytics query PG PASS incoming6 và cap14 | Không stress duplicate PO tạo từ double-click/network retry ngoài case tested; không kiểm budget production thực |

Không có test nào trong8 browser scenarios chứng minh đầy đủ đồng thời input/output, mọi database snapshot, financial balance, event ordering và network/crash recovery của cả10 business journeys. Coverage thiếu được nêu rõ; các stage/event/ledger còn lại phải thêm bằng chứng trước GO, không điền PASS suy đoán.

### Cách tái lập artifact audit tại máy này

Đã kiểm target isolation trước khi chạy; không copy URL/secret vào command hay báo cáo. Scripts local đọc audit URL từ file riêng `.git/borrow-audit-env.json`, assert loopback/port/database; fresh Prisma output riêng. Chạy chỉ khi database audit tương ứng đã được xác nhận:

```text
node .git/production-readiness-tests.cjs
node .git/production-readiness-money-db.cjs
node .git/production-readiness-inventory-db.cjs
node .git/production-readiness-borrow-repro.cjs
node .git/production-readiness-inventory-repro.cjs
node .git/production-readiness-migrations.cjs
pnpm test:stack contracts
PLAYWRIGHT_CHANNEL=msedge pnpm test:stack e2e <8 spec files> --retries=0
```

Dòng PLAYWRIGHT_CHANNEL ở trên mô tả env invocation, trên PowerShell dùng `$env:PLAYWRIGHT_CHANNEL='msedge'`. Không chạy `test:stack down` vì script hiện có `down -v`; không chạy seed/reset/restore/verify-backup scripts trong audit. Probe mong đợi nhận **kết quả lỗi nghiệp vụ** và assert đúng kết quả tái hiện: exit0 của probe không có nghĩa ứng dụng đúng.

## H. Backup/Restore Plan — Phase 5.4

**Trạng thái hiện tại: chưa chứng minh backup có thể restore khi mất VPS.** Kế hoạch dưới đây là đề xuất triển khai sau khi sửa PRA-09/10, không phải cấu hình đã áp dụng.

| Thành phần | Bản sao bắt buộc | Kiểm restore |
|---|---|---|
| auth_db/inventory_db/borrow_db/ai_db | Encrypted consistent recovery set, schema/history/checksums, roles/grants cần thiết | Restore trên PostgreSQL15+extensions host riêng, validate migrations và invariant |
| Packing/procurement uploads | Mọi durable volumes và storage_ref/hash manifest | Hash/size match, sample download quyền hợp lệ; không chỉ archive list |
| Cover/upload khác | Inventory vị trí lưu thực tế; backup binary nếu app sở hữu, remote URL cần dependency policy | Khôi phục file/reference; cache có thể regenerate nhưng không đánh đồng cache với source |
| Config/release | `.env`/secrets qua kho mã hóa có ACL, compose/Caddy/deploy scripts, image digest, release.env và recovery metadata | Restore env đủ; không đưa plaintext vào report/log/source |
| RabbitMQ/outbox | Durable broker state hoặc khả năng rebuild từ outbox/inbox đã kiểm; reconcile PUBLISHED chưa consumed | Xác nhận event replay/inbox dedup và backlog; không xóa outbox để làm xanh |
| Redis | Quyết định sessions/revocation/cache nào critical; backup hoặc invalidate/reconstruct có quy trình | Sau restore session/token policy fail closed, không phục hồi revocation sai |

Đề xuất RPO **≤1giờ** cho dữ liệu nghiệp vụ khi mất VPS, RTO **≤4giờ**; đây là mục tiêu cần business/ops chốt và đo, **RPO/RTO thực tế chưa biết**. Nếu chỉ daily pg_dump local theo script hiện tại, khoảng mất dữ liệu danh nghĩa có thể tới24giờ, còn khi mất VPS mà không có offsite thì không có giới hạn khôi phục được chứng minh. Để đạt1giờ, cần offsite backup thường hơn hoặc base backup+WAL/PITR được cấu hình/giám sát; không tuyên bố Compose đang có PITR.

Retention đề xuất: hourly48giờ, daily30ngày, weekly12tuần, monthly12tháng theo yêu cầu dữ liệu/chi phí; tối thiểu một bản offsite bất biến/khác tài khoản, mã hóa trước upload, tách key và cấp quyền restore có kiểm toán. Daily verify remote checksums, weekly restore subset trên host riêng, monthly full disaster drill; record thời điểm backup, restored counts, business sums, missing files, achieved RPO/RTO và người ký.

Restore drill an toàn: provision **instance độc lập**, verify target identity và no production routing; fetch/decrypt/checksum backup; restore globals cần thiết theo least privilege; restore4DB vào empty targets theo manifest; restore uploads trước mở writers; apply đúng release migrations nếu được phê duyệt; chạy D-H1–H7, so custody/ledger/provider/outbox và smoke; chỉ ghi kết quả PASS khi thực sự đạt. Không dùng `verify-backup.sh` hiện tại như chứng nhận vì nó tạo/drop scratch DB trên cùng instance và chỉ so table count. Không thực thi script đó trong lượt audit.

## I. Deployment Runbook và Release Checklist — Phase 9

**Runbook đề xuất; không được thực thi production trong audit này. NO-GO phải được gỡ bằng bằng chứng ở J trước.**

### Pre-deployment checklist

- [ ] Fix/review lại PRA-01–14; mọi P2 có owner, mitigation và ngày review; audit independent các bản sửa theo exact SHA.
- [ ] Required checks cho release SHA không skip DB/migration/critical E2E; image digest/SBOM/advisory triage, Node20 container tests.
- [ ] Verify branch/release/tag, git cleanliness, no secret trong tracked assets/image/build args/log; env validation không echo giá trị.
- [ ] Chốt current/next schema compatibility và fallback image **đã thử**; không tự fallback qua fine-period/return/audit semantic change.
- [ ] Verify VPS CPU/RAM/disk/ports/TLS/NTP, DB extensions, per-service roles, SMTP/provider/AI quotas, max_connections và pools.
- [ ] Chạy Q1–Q5 và D-H1–H7 trên read-only connection production; lưu số liệu ẩn danh; giải quyết/backfill riêng sau phê duyệt nếu có lỗi.
- [ ] Independent encrypted offsite full recovery set + restore drill đạt, RPO/RTO đo được; image/config/release artifacts có sẵn ngoài VPS.
- [ ] Chốt maintenance/read-only window, owner incident/DB/finance và alert channel; tạm dừng writers/schedulers/consumers theo recovery boundary.

### Trình tự triển khai

1. **Inventory trạng thái trước deploy**: schema history/checksum, row counts/financial totals/stock summaries/outbox age, active sessions/returns/provider intents. Không in secret/PII. Chốt snapshot thời gian và release ID.
2. **Giữ maintenance, dừng writes có điều phối**: finish/cancel audit sessions theo nghiệp vụ khi cần, không sửa session timestamps; drain pending requests, dừng mọi writers/schedulers/consumers và khóa admission. Xác nhận không còn mutation in-flight trước snapshot. Không để old app xử lý fine/return semantics mới.
3. **Backup**: tạo full recovery set gồm4DB+uploads/config metadata; verify checksum/offsite retrieval; không chỉ `--db-only` nếu release thay đổi file/reference. Xác nhận restore evidence vẫn tương thích recovery set.
4. **Migration job duy nhất**: bootstrap extensions/roles đúng từng DB; Auth nếu pending, Inventory theo thứ tự, Borrow theo thứ tự; AI DDL/version compatibility kiểm riêng. Migrate bằng **CLI5.21 trong image đúng release** với target xác minh; timeout/lock budget theo rehearsal. Không chạy concurrent startup migrations tự phát để thay kế hoạch.
5. **Post-migration verification trước app**: Q1–Q5, D-H queries, no failed migration, indexes/triggers đúng, default/null/backfill như dự kiến; ghi duration/locks và stop nếu sai. Không tự mark resolve để bỏ qua.
6. **App order**: data dependencies healthy→Auth/Inventory/Borrow compatible new versions→Analytics reader grants/queries→AI→Gateway→Web. Chờ `/ready` có dependency checks; liveness200 riêng không đủ.
7. **Smoke**: TLS/auth/OTP, role/warehouse negative access; catalog read; một procurement/borrow/return workflow bằng account smoke được kiểm soát và có chứng từ; replay same key; wallet/deposit/fine sums; outbox consume. Không tạo giao dịch tiền thật không có kế hoạch finance.
8. **Mở traffic có kiểm soát**: chỉ khi smoke/invariants đạt; bật schedulers/consumers đúng một lần, kiểm oldest backlog/DLQ; theo dõi5xx/p95/connections/locks/disk/RAM/provider budgets/financial exceptions.
9. **Post-deploy**: 30–60phút theo dõi tích cực, review lại24giờ và sau overnight jobs/backup đầu; lưu release evidence, backup mới, owner ký.

### Khi DB đã migrate nhưng application thất bại

| Lựa chọn | Điều kiện / hành động |
|---|---|
| Rollback application | Chỉ dùng image cũ đã chứng minh tương thích schema **và semantics/state mới**; giữ DB schema. Không dùng auto fallback hiện tại như chứng nhận an toàn |
| Forward-fix application/migration | Lựa chọn mặc định khi fine periods/return ledger/audit sessions/discrepancy đã phát sinh; giữ maintenance, sửa tối thiểu, test restored copy và invariant trước mở |
| Rollback database DDL | Chỉ có kế hoạch reviewed chứng minh chưa có writes phụ thuộc và không mất history; ngừng mọi writers trước; additive fields có thể giữ lại thay down |
| Restore database từ backup | Disaster recovery có lựa chọn mất writes sau snapshot; restore **toàn recovery set trên target riêng**, đối soát provider/remote side effects/outbox sau snapshot trước cutover; không restore một DB tùy tiện |

Nếu không có compatible fallback: giữ maintenance/read-only, thu thập logs đã redact, không chạy seed/reset/drop/truncate, không xóa `_prisma_migrations` hoặc return ledger. Restore DB không hoàn tiền ngoài ngân hàng và không đảo side effects service khác; phải reconciliation. Không chạy lại app cũ chỉ vì SQL additive và `/health` xanh.

## J. Final Release Decision — Phase 10

**NO-GO tại commit324f8d1.** Các suite xanh và8 browser happy paths chưa loại bỏ các đường mất tiền, tăng tồn, sai scope và không phục hồi đã có bằng chứng.

| Nhóm chưa xác minh | Điều kiện trước GO |
|---|---|
| U-01 Backup/restore | Full offsite encrypted recovery + độc lập restore cảDB/files/roles, business invariants và RPO/RTO đo được |
| U-02 Historical production data | Read-only checks trên restored production copy/production account audit, checksum history/baseline, query plans và backfill plan nếu cần |
| U-03 Upgrade/fallback | Interrupted migration, old-image/new-schema semantics, app-fail-after-migration rehearsal, forward-fix path |
| U-04 Distributed failure recovery | Kill-process đúng windows PRA-07; lost response, broker/down/restart, DB outage queue insert, queue starvation và reconciliation full state |
| U-05 Monitoring/incident ownership | Kênh nhận alert thật, names/rota, delivery test, backlog/DLQ/payment/DB/disk/RAM/OOM alerts |
| U-06 Real external integrations | VNPay settlement/late callback/refund, SMTP/OTP delivery, live AI budget/provider failure; không dùng simulator thay bằng chứng provider |
| U-07 Full security actor matrix | Deployed role/warehouse/object scope, revoked sessions, internal boundaries, negative input/upload/SSRF/XSS/CSRF cases cần thiết |
| U-08 Load/capacity | Sustained/concurrent traffic theo dự báo; pool exhaustion, deadlock, long-query, outbox lag và recovery SLO trên VPS-equivalent |
| U-09 AI DB/mobile/runtime supply chain |12 AI PostgreSQL tests chưa chạy; mobile thiết bị thật; exact production images/Node20, Python/image advisories và dependency reachability triage |

GO chỉ được đưa ra trong **báo cáo kiểm chứng tiếp theo** khi P0/P1 được đóng bằng regression+DB/contract/E2E/failure evidence phù hợp, recovery gates đạt và không còn mandatory NOT EXECUTED. Báo cáo hiện tại hoàn tất audit và đề xuất phương án, không tự sửa bất kỳ lỗi nào.

### Trạng thái bàn giao

Đã dừng toàn bộ container audit/QA do lượt này khởi động sau kiểm chứng; giữ nguyên container, volume và dữ liệu kiểm thử, không `down -v`. Không dừng/chỉnh các container developer khác. HEAD vẫn324f8d1; chỉ thêm báo cáo này vào working tree tracked scope, file untracked của người dùng và trạng thái repository ngoài được giữ nguyên. Artifact dừng: `test-results/production-readiness/stop-test-containers.log`. Báo cáo đã được đối chiếu độc lập lần cuối về tài chính, số liệu và thứ tự runbook; chưa sửa code ứng dụng.
