## Quy trình từ đề xuất nhập sách đến khi sách lên kệ gồm những bước nào?

1. Nhân viên (hoặc trợ lý AI, sau khi người dùng xác nhận) tạo đề xuất nhập sách (purchase request) khi tồn kho thấp.
2. Quản lý kho duyệt hoặc từ chối đề xuất; đề xuất được duyệt chuyển thành đơn mua hàng (purchase order).
3. Đơn mua hàng được gửi duyệt, duyệt rồi gửi cho nhà cung cấp; nhà cung cấp xác nhận và gửi chứng từ giao hàng qua cổng nhà cung cấp.
4. Khi hàng về, kho tạo phiếu nhận hàng (goods receipt) ở trạng thái nháp, kiểm đếm và đối chiếu với đơn mua hàng.
5. Nhân viên cất hàng lên kệ (putaway) bằng cách quét mã vị trí và mã sách, rồi xác nhận phiếu cất hàng. Tồn kho chỉ tăng khi phiếu được xác nhận, không cộng ngầm.

## Nhân viên kho nhận việc như thế nào?

Công việc kho (cất hàng, lấy hàng, đóng gói, xuất kho, nhận hàng điều chuyển, kiểm kê) có thể được quản lý giao cho một nhân viên, hoặc nhân viên tự nhận (claim) những việc đang chờ trong kho mình phụ trách. Trang Việc của tôi (/my-warehouse-tasks) và tab Nhiệm vụ trên ứng dụng di động liệt kê việc được giao và việc có thể nhận ngay. Quản lý kho còn có thể tạo công việc chung (staff task) và theo dõi khối lượng việc của từng nhân viên.

## Quy trình xuất sách khỏi kho (picking, đóng gói, xuất kho) diễn ra thế nào?

Khi có đơn xuất kho (ví dụ điều chuyển sách tới chi nhánh hoặc kho khác), hệ thống tạo nhiệm vụ lấy hàng (picking): nhân viên đi tới vị trí và quét mã để lấy đúng sách. Nếu lấy thiếu hoặc sai, có thể phát sinh nhiệm vụ lấy lại (repick). Tiếp theo là đóng gói (packing): quét hóa đơn/phiếu, quét từng cuốn và chụp ảnh bằng chứng đóng gói. Cuối cùng nhân viên xác nhận xuất kho (outbound) để trừ tồn kho.

## Điều chuyển sách giữa các kho được nhận như thế nào?

Sách chuyển từ kho này sang kho khác tạo một phiếu nhận hàng điều chuyển ở kho đích. Nhân viên kho đích được giao hoặc tự nhận phiếu, kiểm đếm sách nhận được và xác nhận. Sau khi xác nhận, tồn kho được ghi nhận ở kho đích.

## Kiểm kê kho (stock audit) thực hiện ra sao?

Quản lý tạo đợt kiểm kê cho một kho và giao cho nhân viên. Nhân viên đếm thực tế từng dòng hàng và nhập số lượng, sau đó gửi kết quả (submit). Quản lý xem chênh lệch giữa số đếm và số trên hệ thống rồi duyệt (approve) hoặc hủy đợt kiểm kê. Ứng dụng di động hỗ trợ kiểm kê bằng quét mã.

## Khi phát hiện thiếu, thừa hoặc hư hỏng hàng trong kho thì làm gì?

Nhân viên tạo báo cáo ngoại lệ (exception report) mô tả vấn đề thiếu hàng, thừa hàng hoặc hàng hư hỏng, có thể tạo ngay trên ứng dụng di động. Quản lý kho xem xét, giao người xử lý và đánh dấu đã giải quyết. Báo cáo ngoại lệ không tự động điều chỉnh tồn kho; mọi điều chỉnh phải qua nghiệp vụ chính thức.

## Cảnh báo tồn kho thấp là gì và ai tạo được?

Cảnh báo tồn kho (stock alert) ghi nhận một đầu sách đang thấp hoặc hết hàng tại một kho, kèm mức ưu tiên. Chỉ quản lý kho và quản trị viên có quyền ra quyết định nghiệp vụ mới tạo được cảnh báo; nếu đã có cảnh báo trùng thì hệ thống bỏ qua. Trợ lý AI có thể chuẩn bị cảnh báo từ dữ liệu rủi ro tồn kho, nhưng chỉ tạo thật khi người có quyền xác nhận.
