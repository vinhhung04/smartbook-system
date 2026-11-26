# Phụ lục B: các endpoint còn thiếu và số endpoint ở Chương 6

Đếm ngày 27/11/2026 trên nhánh hungg (sau commit b81a75f). Quy ước đếm: mỗi cặp phương thức HTTP + đường dẫn được khai báo trong mã định tuyến (tệp `routes` và các tuyến khai báo trực tiếp trong `index.js`/`main.py`) tính là một endpoint; **không** tính các tuyến `/internal/*` (chỉ dùng giữa các service), `/health`, `/ready`, `/metrics`. Danh sách được so tự động với các bảng B.1–B.6 của báo cáo bản demo26 (397 dòng).

## 1. Số endpoint theo service

| Service | Số endpoint (quy ước trên) | Đã có trong Phụ lục B | Còn thiếu |
|---|---|---|---|
| Auth Service | 25 | 25 | 0 |
| Inventory Service | 251 | 224 | 27 |
| Borrow Service | 78 | 74 | 4 |
| Analytics Service | 17 | 17 | 0 |
| Monitoring Service | 21 | 15 | 6 |
| AI Service | 37 | 32 | 5 |
| **Tổng** | **429** | **387** | **42** |

### Đoạn thay thế cho Chương 6, mục "Các service nghiệp vụ Node.js"

Câu hiện tại:
> Inventory Service là service lớn nhất với 195 endpoint thuộc 35 nhóm chức năng; Borrow Service có 69 endpoint; Auth Service có 18 endpoint. … Danh sách đầy đủ các endpoint được trình bày ở Phụ lục B.

Thay bằng:
> Inventory Service là service lớn nhất với 251 endpoint thuộc 32 nhóm đường dẫn; Borrow Service có 78 endpoint, Auth Service 25, Monitoring Service 21 và Analytics Service 17; AI Service có 37 endpoint. Số liệu đếm theo cặp phương thức và đường dẫn khai báo trong mã định tuyến, không tính các tuyến nội bộ `/internal` và các tuyến kiểm tra sức khỏe, sẵn sàng, chỉ số. Danh sách đầy đủ được trình bày ở Phụ lục B.

(Nếu không bổ sung 42 endpoint dưới đây vào Phụ lục B thì giữ cách nói của Phụ lục B: "Danh sách các endpoint chính được trình bày ở Phụ lục B".)

## 2. Các dòng bổ sung vào Phụ lục B

Ghi theo đúng cách trình bày của Phụ lục B: đường dẫn thật của service; endpoint của AI Service gọi qua tiền tố `/ai`; endpoint `/borrow/my/...` gọi qua `/my/...`.

### Bảng B.2 – Inventory Service

| Nhóm | PT | Đường dẫn | Mô tả |
|---|---|---|---|
| Liên thông lưu thông | GET | /api/borrow-integration/pick-options | Các kệ còn bản trống và bản đang giữ của một ấn bản, để thủ thư chọn kệ lấy sách |
| | POST | /api/borrow-integration/reservations/reallocate | Chuyển phần giữ tồn của phiếu đặt giữ về đúng các kệ thủ thư đã lấy sách |
| | GET | /api/borrow-integration/books/:bookId/public-availability | Tình trạng còn sách công khai của một đầu sách |
| | GET | /api/borrow-integration/variants/:variantId/public-availability | Tình trạng còn sách công khai của một ấn bản |
| | GET | /api/borrow-integration/books/:bookId/variant-ids | Danh sách mã ấn bản của một đầu sách |
| Đối soát metadata | GET | /api/metadata-reconciliations/capabilities/import | Kiểm tra quyền tạo bản nháp danh mục trước khi gọi đọc ảnh OCR |
| Đóng gói | GET | /api/packing/tasks/:taskId/evidence/videos | Danh sách video bằng chứng của công việc đóng gói |
| | GET | /api/packing/tasks/:taskId/evidence/:evidenceId/video | Phát lại một video bằng chứng |
| Đơn đặt hàng | POST | /api/purchase-orders/:id/revisions/:revisionId/cancel | Hủy bản sửa đổi đơn |
| | POST | /api/purchase-orders/:id/revisions/:revisionId/supplier-reject | Nhà cung cấp từ chối bản sửa đổi đơn |
| | POST | /api/purchase-orders/:id/returns/:returnId/cancel | Hủy phiếu trả hàng nhà cung cấp |
| | POST | /api/purchase-orders/:id/returns/:returnId/reject | Quản lý từ chối phiếu trả hàng |
| | POST | /api/purchase-orders/:id/returns/:returnId/supplier-reject | Nhà cung cấp từ chối phiếu trả hàng |
| Chứng từ mua hàng | GET | /api/procurement-documents/:docId/files/:fileId/download | Tải một phiên bản tệp chứng từ |
| | GET | /api/procurement-documents/purchase-orders/:poId/activity | Lịch sử chứng từ của một đơn đặt hàng |
| Cổng nhà cung cấp (tài khoản) | PATCH | /api/supplier-account/documents/:docId | Nhà cung cấp sửa chứng từ của mình |
| | POST | /api/supplier-account/documents/:docId/cancel | Nhà cung cấp hủy chứng từ |
| | GET | /api/supplier-account/documents/:docId/files/:fileId/download | Nhà cung cấp tải tệp chứng từ |
| Công việc kho | GET | /api/staff-tasks/open-summary | Tổng hợp công việc đang mở |
| | GET | /api/staff-tasks/workload | Khối lượng việc theo nhân viên |
| Nhận hàng chuyển kho | GET | /api/transfer-receiving/:id/lines | Các dòng của phiếu chuyển cần nhận |
| | GET | /api/transfer-receiving/:id/discrepancies | Chênh lệch của một phiếu chuyển |
| | GET | /api/transfer-receiving/discrepancies | Danh sách hồ sơ chênh lệch chuyển kho |
| | POST | /api/transfer-receiving/:id/discrepancies/resolve | Xử lý chênh lệch chuyển kho |
| Kiểm kê | PATCH | /api/stock-audits/:id/locations/:locationId/confirm-count | Xác nhận số đếm của một vị trí |
| | PATCH | /api/stock-audits/:id/recount | Yêu cầu đếm lại |
| Danh mục công khai | GET | /public/catalog/sitemap.xml | Sơ đồ trang danh mục cho máy tìm kiếm |

### Bảng B.3 – Borrow Service

| PT | Đường dẫn | Mô tả |
|---|---|---|
| GET | /borrow/loans/:id/return-preview | Xem trước phí phạt khi trả sách (tham số trên đường dẫn) |
| POST | /borrow/loans/:id/return-preview | Xem trước phí phạt theo từng cuốn, tình trạng trả và đánh dấu mất; không ghi dữ liệu |
| GET | /borrow/my/reservations/:id | Bạn đọc xem chi tiết phiếu đặt giữ của mình |
| GET | /borrow/my/notifications/unread-count | Số thông báo chưa đọc của bạn đọc |

### Bảng Monitoring Service

| PT | Đường dẫn | Mô tả |
|---|---|---|
| GET | /monitoring/me | Quyền giám sát của người dùng hiện tại (xem, xử lý, cấu hình) |
| GET | /monitoring/deliveries | Lịch sử gửi thông báo sự cố |
| DELETE | /monitoring/channels/:id | Xóa kênh gửi |
| DELETE | /monitoring/policies/:id | Xóa chính sách cảnh báo |
| POST | /monitoring/notifications/:id/read | Đánh dấu một thông báo hệ thống đã đọc |
| POST | /monitoring/notifications/read-all | Đánh dấu mọi thông báo hệ thống đã đọc |

### Bảng AI Service

| PT | Đường dẫn | Mô tả |
|---|---|---|
| GET | /capabilities | Các chức năng AI người dùng hiện tại được dùng (kể cả đọc ảnh) |
| POST | /vision/identify | Nhận diện sách từ một ảnh, trả kết quả dạng luồng |
| POST | /enrich-book-after-isbn/stream | Bổ sung thông tin sách sau tra cứu ISBN, trả tiến trình dạng luồng |
| POST | /actions/reconcile | Đối soát hành động AI có kết quả chưa xác định (RECONCILE_REQUIRED) |
| POST | /api/ai/generate-book-summary | Tuyến cũ sinh tóm tắt sách tiếng Việt (giữ để tương thích) |

Ghi chú: mô tả được viết từ tên tuyến và mã xử lý; nên đọc lại trước khi đưa vào báo cáo nếu cần mô tả chi tiết hơn.
