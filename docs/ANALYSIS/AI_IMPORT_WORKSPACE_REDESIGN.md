# AI Import — Workspace kiểm duyệt metadata (redesign 2026-11)

Trang `/ai-import` (`apps/web/src/components/pages/ai-import/`) được tổ chức lại thành workspace nhập và kiểm duyệt metadata sách. Nghiệp vụ không đổi: hai vòng tra ISBN, thứ tự nguồn, xác minh mã, Evidence Fusion, OCR, chuẩn hóa, kiểm tra trùng và luồng lưu vẫn như trên `main`.

## 1. Tham chiếu mã nguồn mở

| Dự án | License | Đã xem | Học được | Áp dụng | Không áp dụng |
|---|---|---|---|---|---|
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | GPL-3.0 | `document-detail.component.html` (form trái + preview phải, tab Details/Content/Metadata), `suggestions-dropdown`, `input/text` (dòng "Suggestion:" dưới ô nhập), `upload-status-tray` (trạng thái xử lý từ server qua websocket) | Split view: bản ghi đang sửa đặt cạnh bằng chứng; gợi ý nằm ngay dưới trường và chỉ áp dụng khi người dùng bấm; tiến trình đến từ sự kiện của server | Metadata bên trái, panel rộng bên phải (Nguồn / OCR / Kiểm duyệt); provenance và lựa chọn đặt ngay dưới từng trường; tiến trình lấy từ sự kiện backend | Thanh tiến trình phần trăm (backend không có tổng số bước để tính %); khay trạng thái nổi |
| [OpenRefine](https://github.com/OpenRefine/OpenRefine) | BSD-3-Clause | `cell-renderers/recon-renderer.js` (judgment matched/new, danh sách candidate kèm score, "see more", nút match) | Đối chiếu có người duyệt: mọi ứng viên hiện kèm điểm, người dùng chọn; "match" là quyết định rõ ràng, có thể hoàn tác | "So sánh N giá trị": từng giá trị ứng viên, các nguồn ủng hộ, mức ủng hộ (`candidates[].support`), nút "Dùng giá trị này" / "Dùng lại giá trị hệ thống chọn" | Match hàng loạt cho các ô tương tự (mỗi lần chỉ nhập một sách) |
| [Zotero](https://github.com/zotero/zotero) | AGPL-3.0 | `chrome/content/zotero/lookup.js` (Add Item by Identifier: `extractIdentifiers`, thử lần lượt translator, progress không xác định), [tài liệu Adding Items](https://www.zotero.org/support/adding_items_to_zotero) | Một ô nhập cho mọi loại mã; thử nguồn tuần tự; tiến trình trung thực (indeterminate); nhắc người dùng kiểm tra lại metadata sau khi thêm | Ô ISBN/EAN duy nhất có kiểm tra checksum ngay khi gõ; khi không có kênh tiến trình chỉ báo "đang chạy", không vẽ % giả | Tự lưu ngay sau khi tra (SmartBook bắt buộc kiểm duyệt rồi mới lưu) |

Không sao chép mã nguồn hay thêm dependency nào từ các dự án trên.

## 2. Bố cục thông tin

- **A — Dữ liệu đầu vào**: thanh 4 giai đoạn (Nhập dữ liệu → Tra cứu và trích xuất → Kiểm duyệt metadata → Lưu vào catalog). Ô ISBN/EAN và quét camera đặt bên trái, OCR 3 ảnh bên phải. Văn bản/HTML chỉ hiện khi pipeline v2 bật.
- **B — Live Processing Timeline** (`processing-timeline.tsx`): 5 giai đoạn (kiểm tra mã, vòng 1, vòng 2, tổng hợp, chuẩn bị kiểm duyệt). Từng nguồn có trạng thái chờ lượt / đang truy vấn / kết quả. Sau khi tra xong, timeline vẫn xem được trong tab Nguồn.
- **C — Kết quả & so sánh nguồn** (`source-comparison.tsx`): nguồn đã xác định sách; các số đếm do backend tính (`verification.*`); lọc theo trạng thái; nhóm Vòng 1 / Vòng 2; nguồn không truy vấn (DISABLED/SKIPPED) để riêng.
- **D — Kiểm duyệt metadata** (`metadata-review.tsx`, `field-provenance.tsx`, `field-review-model.ts`): ba nhóm (Thông tin định danh, Mô tả và phân loại, Ảnh bìa). Mỗi trường có trạng thái, nguồn, vòng, phương thức xác minh, các giá trị khác và link nguồn. Có bộ lọc: Khớp mã, Nhiều nguồn, Xung đột, Tin cậy thấp, Còn trống, Đề xuất AI.
- **E — OCR**: tab riêng, dùng nguyên `OcrReviewPanel` (chính sách `safeToApply`/trạng thái OCR không đổi).
- **F — Kiểm duyệt & lưu** (`review-checklist.tsx`): mục bắt buộc và mục khuyến nghị. Thanh lưu dùng chung danh sách này nên không thể hứa lưu khi `handleSave` sẽ từ chối.

Responsive: ≥1280px chia hai pane; dưới mức đó dùng 4 tab (Metadata / Nguồn / OCR / Kiểm duyệt). Tab Metadata được giữ mounted để mọi trường focus được.

## 3. Tiến trình thật (SSE)

- `services/ai-service/isbn_progress.py`: sink nằm trong `ContextVar`, chỉ tồn tại cho task của một request. asyncio sao chép context sang các task con (gather vòng 2, làn AI web search), nên sự kiện không lẫn giữa các request. `emit()` không làm gì khi không có kênh và không bao giờ raise.
- Điểm phát sự kiện, chỉ quan sát: `isbn_rounds.run_round1/run_round2` (stage + bắt đầu/kết thúc từng nguồn); `main.py` (validate, cache, fusion, authority, ai, pipeline).
- Endpoint mới, tương thích ngược: `POST /enrich-book-after-isbn/stream` và `POST /metadata-intelligence/extract/stream`. Hai endpoint này đi qua API Gateway (`/ai/...`) và có kiểm tra quyền catalog (`catalog_access_error`). Body SSE gồm các sự kiện `progress`, kết thúc bằng đúng một `result` (JSON giống hệt endpoint cũ) hoặc một `error` đã lọc. Endpoint cũ giữ nguyên.
- Sự kiện chỉ mang trạng thái, số đếm, thời gian và mã lý do; lỗi chỉ hiện dạng `HTTP 403` hoặc ghi chú tạm dừng, không bao giờ là exception thô.
- Client ngắt kết nối thì lookup vẫn chạy tới cùng và được cache như request thường. Có heartbeat 10s.
- Frontend (`services/lookup-progress-stream.ts`, `lookup-progress.ts`): bỏ sự kiện trùng hoặc trễ theo `seq`; mỗi lần tra có số thứ tự riêng để bỏ kết quả của lần tra cũ; dùng AbortController, timeout 180s, hủy khi unmount và có nút "Hủy tra cứu". Khi kênh SSE không dùng được thì tự gọi endpoint JSON cũ và ghi rõ trên timeline rằng chỉ biết request đang chạy. Sau khi xong, timeline được tái hiện từ `verification.round1.attempts` và `sources[]`, kèm nhãn "Tái hiện từ kết quả cuối cùng".

## 4. Giới hạn còn lại

- Chế độ `ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL=true` không phát sự kiện theo từng nguồn; timeline báo rõ điều này.
- Pipeline v2 (`legacy_projection`) liệt kê mọi nguồn có tài liệu là SUCCESS với `durationMs: 0`; tab Nguồn ghi chú là không có trạng thái theo vòng.
- Khi trả từ cache, các dòng nguồn là diễn biến của lần tra đã lưu (timeline ghi rõ).
- Trường "Nhà phát hành", "Năm in", "Lần tái bản" không có trong form/schema lưu sách. Chúng chỉ xuất hiện trong kết quả OCR ("Thông tin khác đọc được"), không được thêm vào form.
- Hủy tra cứu chỉ dừng chờ phía trình duyệt; máy chủ vẫn hoàn tất để cache.
