# SmartBook — triển khai bốn chính sách đã được chốt

> Cập nhật bàn giao Git: sau khi hoàn tất báo cáo này, người dùng đã yêu cầu commit và push lên `hungg`. Các ghi chú “chưa/không commit, push” bên dưới mô tả trạng thái tại thời điểm kiểm toán và kiểm chứng, trước yêu cầu bàn giao. Production chưa được triển khai.

Ngày: 2026-11-17 (Asia/Saigon). Người dùng đã đồng ý thực hiện cả bốn đề xuất trong cuộc trò chuyện này. Phần triển khai tiếp nối giải quyết SB-03, SB-07, SB-12 và SB-20; giữ nguyên phân loại lịch sử:19 lỗi baseline đã sửa,1 đã sửa trước đó,4 quyết định chính sách nay được triển khai. Không commit/push, không triển khai production.

Đặc tả: [business-decisions-implementation.md](../tasks/business-decisions-implementation.md). Báo cáo audit ban đầu và bằng chứng RED/GREEN vẫn được giữ nguyên để truy vết.

## SB-03 — tiền phạt phát sinh theo kỳ

- Thanh toán hoặc miễn thông thường chỉ chốt khoản phát sinh đến ngày xử lý. Nếu chưa trả sách, các ngày quá hạn sau đó tạo kỳ phạt mới; không mở lại hoặc tăng số tiền của khoản PAID/WAIVED.
- Lưu ranh giới ngày quá hạn, đơn giá, ngày đến hạn cho từng kỳ và hồ sơ theo loan_item. Sweep, thanh toán tại quầy, VNPay và quyết toán cọc dùng khóa thống nhất để tránh vừa chốt vừa cộng trùng một ngày. Đổi ngày đến hạn khi gia hạn tạo mốc kỳ phù hợp.
- Miễn cả thời gian tiếp theo là tùy chọn rõ ràng, cần quyền borrow.fines.manage/superuser và lý do. Miễn này không miễn trách nhiệm hỏng/mất sách.
- Dữ liệu cũ được tiếp nhận từ mốc triển khai: giữ nguyên amount, payment, trạng thái và ngày thanh toán; không truy thu suy đoán lịch sử. Migration có kiểm chứng replay trên schema riêng trong transaction rollback.
- Preview/cọc tính tổng các kỳ còn nợ và khoản mới dự kiến. Audit/thông báo ghi kỳ và số tiền tăng thêm. Giao diện phạt hiện có bổ sung thông tin kỳ và lựa chọn miễn tương lai.

Code chính: overdue-accrual.service.js, fine.service.js, fine.controller.js, deposit.service.js, vnpay-payment.service.js trong borrow-service; trang borrow-fines.tsx và API borrow.ts.

## SB-07 — mốc đếm thực tế và biến động sau kiểm kê

- Phiếu DRAFT giữ phạm vi để ngăn kiểm kê chồng lấn nhưng chưa khóa giao dịch kho. Giao việc lần đầu hoặc chọn bắt đầu/đếm lại sẽ chụp lại số tồn hiện tại và khóa các vị trí đang đếm. Giao lại người phụ trách khi IN_PROGRESS không xóa số đếm.
- Trigger PostgreSQL chặn INSERT/UPDATE/DELETE làm thay đổi lượng tồn tại vị trí đang đếm, bao phủ cả tích hợp mượn/trả và các đường ghi khác. API chuẩn hóa lỗi khóa thành409 có mã STOCK_AUDIT_LOCATION_FROZEN.
- Số cần đếm là on_hand trừ borrowed đang ở ngoài kho; không coi sách bạn đọc đang giữ là mất trên kệ. Mỗi vị trí chỉ mở lại giao dịch sau khi tất cả biến thể đã được đếm và chốt, hoặc hủy phiếu. Phiếu vẫn giữ phạm vi đến khi duyệt/hủy.
- Duyệt áp dụng chênh lệch counted−baseline đúng một lần lên tồn hiện tại. Ví dụ tồn10, đếm8, xuất2 sau chốt, duyệt cho tồn6. Không ghi đè về8. Không làm âm available hoặc tiêu hao sách đang giữ/mượn/cách ly; vị trí receiving/staging/quarantine không tự sinh available.
- Phiếu cũ thiếu baseline/cutoff phải đếm lại. Recount giữ ID dòng, bổ sung biến thể mới, không sửa lịch sử điều chỉnh đã duyệt.

Chi tiết: [SMARTBOOK_SB07_POLICY_IMPLEMENTATION.md](SMARTBOOK_SB07_POLICY_IMPLEMENTATION.md). Bài kiểm thử DRAFT đã tái hiện lỗi khóa quá sớm trước khi sửa, rồi đạt16/16 ở bộ focused sau sửa.

## SB-12 — xử lý chênh lệch điều chuyển có quản lý tồn thực tế

- Hàng chấp nhận đi vào receiving bình thường và có thể cất ngay. Hàng hỏng/từ chối thực sự đã giao được giữ tại TRANSFER-QUARANTINE, không pickable, available=0. Hàng thiếu là nghĩa vụ cần xử lý, không phải tồn kho.
- Hồ sơ giữ số shipped/delivered/accepted/damaged/rejected/missing ban đầu, các phần còn chưa xử lý, người nhận và lịch sử quyết định. Xác nhận nhận hàng vẫn giữ trạng thái RECEIVED tương thích; hồ sơ chênh lệch có vòng đời riêng.
- Manager có WRITE tại kho đích, lý do và bằng chứng mới được xử lý. FOUND chỉ nhận hàng thiếu nay thực sự tìm được vào receiving; WRITE_OFF không tạo tồn cho hàng thiếu và giảm custody khi loại bỏ hàng cách ly.
- RETURN_TO_SOURCE yêu cầu thêm WRITE tại kho nguồn và xác nhận hàng thực sự về nguồn: chuyển custody cách ly về nguồn, không tăng available. REDELIVERED liên kết chuyến giao bù đã RECEIVED đúng nguồn/đích và chuyến gốc; giới hạn lượng phân bổ, không nhập tồn lần hai.
- Khóa dòng/advisory và ledger idempotency ràng buộc payload ngăn nhận/xử lý trùng. Movement, outbox và audit nằm cùng transaction. GRN điều chuyển đã có hồ sơ chênh lệch không được hủy qua đường hủy GRN chung làm sai custody.
- API danh sách/chi tiết/xử lý được kiểm quyền kho. Panel bổ sung vào trang nhận điều chuyển hiện có; không thay bố cục toàn bộ.

Code chính: transfer-discrepancy.service.js/controller.js, transfer-receiving.controller.js/routes.js, TransferDiscrepancyPanel.tsx. PostgreSQL kiểm cả replay, write-off, nguồn/đích và phân bổ giao bù.

## SB-20 — trả nhiều bản sách với kết quả riêng

Thêm items[] vào return và POST return-preview. Mỗi phần tử có loan_item_id, item_condition_on_return, mark_lost, notes, settlement_reason, returned_to_location_id. Payload single/all cũ và GET preview được giữ tương thích; không trộn items[] với trường toàn batch.

- Kiểm toàn bộ ID, trùng/ngoại lai/trạng thái, điều kiện, vị trí và lý do dùng cọc trước khi ghi tồn. GOOD/DAMAGED/LOST có trạng thái, ghi chú, phạt, xử lý cọc và kết quả riêng. Phiếu có sách mất vẫn kết thúc LOST.
- Request ledger giữ parent Idempotency-Key trước mọi remote mutation, ràng buộc loan+payload. Batch dùng child key ổn định theo item ID, không phụ thuộc thứ tự payload. Replay không ghi lại tồn/phạt/cọc; key dùng cho nội dung khác trả409.
- Mỗi remote call có deadline10 giây. Nếu chỉ một phần được xác nhận, trả trạng thái RECONCILIATION_REQUIRED/UNKNOWN/NOT_PROCESSED theo bản và ghi outbox bền vững; không quyết toán local một phần. Retry cùng key hoàn tất rồi đóng marker đối soát. Ledger PROCESSING có lease30 phút cho trường hợp tiến trình bị dừng.
- Giao diện trả hiện có thêm các hàng nhập điều kiện/ghi chú/lý do, preview từng bản và kết quả chưa chắc chắn. Giữ key khi thử lại, khóa sửa payload sau lỗi có thể đã tác động kho.

Code chính: return-request.service.js, return-operation.service.js, loan.controller.js/routes.js, inventory-integration.service.js, trang borrow-loan-detail.tsx và borrow.ts.

## Migration và vận hành

Sáu migration additive đã được áp dụng thành công vào database audit/QA riêng:

1. Inventory20261117090000_stock_audit_count_cutoff.
2. Inventory20261117092000_transfer_discrepancy_workflow.
3. Borrow20261117140000_overdue_fine_periods.
4. Borrow20261117141000_overdue_fine_due_dates.
5. Borrow20261117150000_mixed_return_requests.
6. Inventory20261117160000_stock_audit_start_count.

Migration cuối tách giữ phạm vi DRAFT khỏi khóa vật lý; không sửa migration đã áp dụng trước. Session đã bắt đầu vẫn giữ timestamp. Không xóa/reset database, không dùng down -v; test credentials và client Prisma riêng nằm dưới .git, không ghi vào báo cáo. File __tmp_enrich.json của người dùng và staging ở repository ngoài được giữ nguyên.

Triển khai thật cần chạy migrate deploy cho inventory/borrow trước backend và web tương ứng. Kiểm kê cũ phải đếm lại; không tự duyệt bằng số đếm thiếu cutoff. Nếu hạ phiên bản, cần hoàn tất/hủy các phiên kiểm kê và phối hợp dữ liệu kỳ phạt/ledger; không chạy lại backend cũ để xử lý cấu trúc nghiệp vụ mới. Đây là hướng dẫn rollout; phiên này chỉ triển khai và xác minh trên môi trường riêng.

## Kiểm chứng thực sự đã chạy

| Kiểm tra | Kết quả cuối | Log |
|---|---|---|
| Toàn bộ borrow, gồm PostgreSQL/phạt/trả mixed/concurrency |258 pass,0 fail,0 skip|test-results/policies-borrow-complete.log|
| Toàn bộ inventory, gồm PostgreSQL/đếm/chênh lệch điều chuyển |419 pass,0 fail,0 skip|test-results/policies-inventory-complete.log|
| Web unit |80 pass,0 fail,0 skip|test-results/policies-web-unit.log|
| Contract inventory + analytics |12+7 pass,0 fail,0 skip|test-results/policies-contracts.log|
| Lint web/mobile |PASS|test-results/policies-lint.log|
| Typecheck web/mobile |PASS|test-results/policies-typecheck.log|
| Build web và các service qua QA Compose |PASS|test-results/policies-stack-start-up.log|
|31 luồng tích hợp |27 pass lượt chung +4 pass sau sửa fixture/test và chạy lại riêng|test-results/policies-integration.log; policies-*-recheck.log|
|8 luồng trình duyệt thực tế |7 pass ở lượt chung + kiểm kê pass sau sửa bài test|test-results/policies-e2e-complete.log; policies-stock-edge-e2e.log|

Tám luồng browser: miễn phạt tương lai; trả mixed GOOD/DAMAGED/LOST với cọc riêng; purchase→putaway; reorder budget; reservation→pickup→loan→return; kiểm kê bảo toàn movement sau đếm; xử lý chênh lệch điều chuyển; warehouse transfer lifecycle. Kết quả kiểm kê cuối1/1 không retry, chạy bằng Edge qua tùy chọn PLAYWRIGHT_CHANNEL hiện có. Chromium tải mới bị timeout mạng, không được coi là PASS.

Lượt8 luồng ban đầu có1 lỗi do toast che nút duyệt. Trace cho thấy lỗi tương tác bài test, không lỗi số tồn; bài test nay di chuyển chuột khỏi toast và chờ thông báo tự đóng trước thao tác duyệt. Các lần thử trước còn phát hiện fixture dùng kế hoạch không có cọc, thiếu sách và timeout quá ngắn cho nhiều quyết định; đã dùng customer/plan/book riêng và hạn thời gian hợp lý, không bỏ assertion nghiệp vụ.

Các file test PostgreSQL chạy tuần tự để tránh xung đột SSI giữa fixture không liên quan; từng tình huống Promise.all vẫn kiểm tra cạnh tranh thực sự. Tổng số đếm ở trên đã bao gồm test policy, không cộng focused suite lần nữa. Analytics162/162 của audit trước được giữ là bằng chứng trước đó; không báo là vừa chạy lại trong lượt chính sách này.

## Giới hạn và bàn giao

Chưa triển khai production, chưa commit/push. Thay đổi nằm trong working tree để review. Các quy trình đối soát bất định được kiểm chứng bằng lỗi giả lập ở ranh giới dịch vụ và bằng browser end-to-end với inventory thật; không tuyên bố đã diễn tập mọi tình huống đứt mạng production. Luồng mobile giữ payload cũ và đã typecheck, chưa có lượt thao tác thiết bị thật cho UI mobile trong phần này.

### Chi tiết lượt tích hợp và sửa bài kiểm thử

Lượt manifest đầu đạt27/31. Bốn lỗi và kiểm chứng sau sửa:

- reservation-pickup-loan-return: catalog có quantity nhưng kho mặc định hết available. Bài test nay probe đúng endpoint availability trước khi chọn. Chạy lại11/11 checks đạt (policies-reservation-recheck.log).
- borrow-warehouse-scope: cùng nguyên nhân dữ liệu chọn sai kho/tồn. Chạy lại16/16 checks đạt (policies-borrow-scope-recheck.log), giữ đủ các assertion403 và customer self-service.
- reservation-concurrency-race: fixture cũ đếm ngay ở DRAFT; nay gọi start/recount và cleanup hủy phiếu chưa kết thúc. Chạy lại7/7 checks đạt,5 approvals chỉ có1 movement (policies-concurrency-recheck.log).
- return-loan-partial-failure-audit: fixture lấy item thứ hai theo thứ tự DB không ổn định, trong khi return đã ổn định theo ID để bảo đảm retry. Nay sort cùng thứ tự trước khi tiêm lỗi. Chạy lại đạt cả đối soát sau partial failure và phục hồi cùng key; restore variant bị tiêm lỗi trong finally (policies-partial-return-recheck.log).

Không ghi đè báo cáo27/31 của lượt chung thành31/31. Artifact policies-integration-resolved.json giữ nguồn lượt chung và log chạy lại từng failure;31/31 là coverage kết quả cuối qua các lượt này. Lượt outbox durability thực sự đã đạt7/7, gồm restart service và broker ngừng/hoạt động lại.

### Môi trường sau kiểm chứng

Đã phục hồi variant bị tiêm lỗi của lượt kiểm thử thất bại trước đó và trả hoàn tất phiếu bằng cùng key (HTTP200). Đã hủy DRAFT kiểm kê do bài test cũ để lại qua API (HTTP200). Outbox durability đạt7/7 nhưng cleanup một reservation fixture trả502 cả lần thử lại; giữ nguyên bản ghi QA này để kiểm tra thay vì sửa/xóa số tồn bằng tay. Không diễn giải lỗi cleanup là dữ liệu production. Các container audit/QA của phiên được dừng sau kiểm chứng để giải phóng tài nguyên, giữ nguyên container/volume/database. Xem policies-stop-stacks.log.
