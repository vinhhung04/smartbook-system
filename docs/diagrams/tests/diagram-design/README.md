# Kiểm thử tích hợp Diagram Design (2026-11-06)

Sơ đồ trong thư mục này là **sơ đồ kiểm thử**, không phải hình chính thức của báo cáo và không thay thế file nào trong `source/`, `drawio/`, `exports/`.

- Plugin: `diagram-design@diagram-design` v2.6.141 (commit `f24d98b`), scope project.
- Profile: `smartbook` (`~/.diagram-design/profiles/smartbook.md`, bản sao trong `docs/diagrams/design-profile/`), chọn qua marker `.diagram-design`.
- Nguồn HTML tự chứa (không tải Google Fonts); SVG/PNG xuất bằng `export_svg.py --system-fonts` và `export_png.py … 3` của skill.

## Các bước kiểm tra đã chạy cho mỗi sơ đồ

| Kiểm tra | Công cụ | 01 phần 1 | 01 phần 2 | 02 | 03 |
|---|---|---|---|---|---|
| Hợp đồng SVG truy cập được, an toàn một file, offline | `self_check.py --offline` (skill) | Đạt | Đạt | Đạt | Đạt |
| Đường nối vuông góc, điểm gắn, mask bị node che | `verify-geometry.py` (repo diagram-design, bản clone tạm) | Đạt | Đạt | Đạt | Đạt |
| Chữ vừa khung, lề 40px, plate không chồng nhau | `scripts/diagrams/check-text-fit.py` | Đạt | Đạt | Đạt | Đạt |
| Nhãn nguồn còn nguyên văn | `scripts/diagrams/check-fidelity.py` | 21/24 (xem bảng) | ↑ | — (không có nguồn Mermaid) | 23/23 |
| Đọc được ở bề rộng Word 16cm (605px) | PNG thu nhỏ + xem trực quan | Đạt (nhỏ nhưng rõ) | Đạt | Đạt | Đạt |
| Đối chiếu codebase | đọc mã (liệt kê dưới) | Đạt | Đạt | Đạt | Một phần (xem bài 3) |

Lưu ý: `verify-geometry.py` chỉ nhận plate cao 8–14px là "mask"; plate ở thang khóa luận cao 18px nên phần kiểm tra mask–node của script không áp dụng — được bù bằng `check-text-fit.py` và xem ảnh.

---

## Bài 1 — Sequence: phân công nhân viên cho phiếu nhập kho

Luồng đã triển khai (có trên `main`): `PATCH /api/goods-receipts/:id/assign`.

Mã đã đối chiếu: `apps/web/src/services/goods-receipt.ts`, `apps/web/src/services/http-clients.ts`, `apps/api-gateway/src/index.js`, `services/inventory-service/src/index.js`, `.../middlewares/auth.middleware.js`, `.../middlewares/uuid-params.middleware.js`, `.../middlewares/warehouse-scope.middleware.js`, `.../routes/goods-receipt.routes.js`, `.../controllers/goods-receipt.controller.js` (`assignGoodsReceipt`), `packages/shared/runtime/warehouse-scope.cjs`, `packages/shared/runtime/token-revocation.cjs`.

| File | Vai trò |
|---|---|
| `01-sequence/inventory-goods-receipt-assign.mmd` | Nguồn Mermaid đầy đủ (7 participant, 17 thông điệp, 2 `alt` lồng) — nguồn sự thật |
| `01-sequence/inventory-goods-receipt-assign.mermaid.{svg,png}` | Bản render Mermaid "trước" |
| `01-sequence/inventory-goods-receipt-assign-p1-auth.{html,svg,png}` | Diagram Design phần 1: bước 1–7 |
| `01-sequence/inventory-goods-receipt-assign-p2-handler.{html,svg,png}` | Diagram Design phần 2: bước 8–17 |

Vì sao tách: kiểu Sequence của Diagram Design giới hạn 5 lifeline, 12 thông điệp, 1 fragment, không lồng `alt`. Nguồn có 7 participant và `alt` lồng nên tách theo ranh giới tự nhiên (middleware / controller), không lược bước nào.

### Bảng đối chiếu nội dung (Mermaid → Diagram Design)

| Nguồn | Sau thiết kế lại | Thay đổi | Lý do |
|---|---|---|---|
| 7 participant | P1: Quản lý kho, Web App, API Gateway, Inventory, Redis · P2: Web App, API Gateway, Inventory, PostgreSQL, Auth Service | Chia 2 phần | Giới hạn 5 lifeline |
| `Web App (React)`, `Inventory Service`, `PostgreSQL (inventory_db)` | Tên + nhãn kỹ thuật: `Web App` / `React · apps/web`, `Inventory` / `inventory-service`, `PostgreSQL` / `inventory_db` | Đổi cách trình bày tên | Vừa hộp 112px ở chữ 14px; thông tin giữ đủ |
| Thông điệp 1–17, đúng thứ tự | 1–7 ở P1, 8–17 ở P2, đánh số giữ nguyên | Không đổi thứ tự | — |
| Nhãn thông điệp 2 (`PATCH …/:id/assign {received_by_user_id} + Bearer JWT`) | Nhãn "2. Gửi yêu cầu phân công" + ghi chú chứa nguyên văn endpoint | Chuyển nội dung kỹ thuật sang ghi chú | Endpoint dài hơn khoảng giữa 2 lifeline |
| Nhãn thông điệp 6 (4 mã lỗi 401/403/400/503) | "6. Phản hồi lỗi" + ghi chú liệt kê nguyên văn 4 mã | Chuyển sang ghi chú | Như trên |
| Thông điệp 10–11 (GET /internal/…, phạm vi kho) | Nhãn ngắn + ghi chú nguyên văn endpoint, header, điều kiện cache | Chuyển sang ghi chú | Như trên |
| `alt` ngoài [không hợp lệ] / [hợp lệ] | P1 giữ `alt` 2 nhánh; nhánh "Hợp lệ" trỏ sang P2 | Nhánh hợp lệ mở rộng ở P2 | Không được lồng fragment |
| `alt` trong [không có quyền ghi] / [có quyền ghi] | P2 giữ `alt` 2 nhánh, đủ 4 thông điệp | Không đổi | — |
| Thông điệp 16 `G → W` | Giữ ở P2 | Không đổi | — |
| Thông điệp 17 `W → Quản lý kho` | Ghi chú "17. Thông báo kết quả (Web App → Quản lý kho)" | Từ mũi tên thành ghi chú | Quản lý kho không thuộc 5 lifeline của P2 |
| 4 Note của nguồn | Giữ nguyên văn trong ghi chú | Không đổi | — |
| `autonumber` | Số thứ tự viết trong nhãn | Không đổi nghĩa | Diagram Design không có autonumber |

Không có actor, thông điệp, nhánh điều kiện hay mã lỗi nào bị lược bỏ.

## Bài 2 — Architecture: kiểm soát truy cập kho

Phạm vi: đường đi của một yêu cầu nghiệp vụ kho. Ngoài phạm vi (cố ý, ghi trong sơ đồ): borrow/analytics/AI service, RabbitMQ, mobile, Mailpit, pgAdmin.

Mã đã đối chiếu: `docker-compose.yml` (service `db` = `pgvector/pgvector:pg15` chứa `auth_db` và `inventory_db`; `redis:7-alpine`), `apps/api-gateway/src/index.js` (proxy `/auth`, `/iam` → auth-service:3002; `/api` → inventory-service:3001; `createRateLimiter` 600 req/15 phút), `packages/shared/runtime/index.cjs` (rate limiter trong bộ nhớ), `packages/shared/runtime/warehouse-scope.cjs`, `services/auth-service/src/lib/token-revocation.js` (ghi thu hồi), `services/inventory-service/src/middlewares/auth.middleware.js` (đọc thu hồi), `services/auth-service/src/routes/internal.routes.js`.

File: `02-architecture/inventory-access-architecture.{html,svg,png}` — 7 nút, 8 kết nối, 1 điểm nhấn (kiểm tra phạm vi kho), trong ngân sách 9 nút / 12 cạnh.

## Bài 3 — Import Mermaid (faithful): kiến trúc xử lý Trợ lý AI

Nguồn: `docs/diagrams/source/architecture/ai-copilot-pipeline.mmd` (không sửa). IR: `03-import-mermaid/ai-copilot-pipeline.digest.md` (từ `mermaid_extract.py`).

Bốn dial: format `html` + SVG/PNG · size `fit` 800 × 1196 · detail **faithful** · audience `engineer`.

| Nguồn | Sau thiết kế lại | Thay đổi |
|---|---|---|
| 4 subgraph | 4 zone, cùng tên, cùng thứ tự | Không |
| 16 nút | 16 nút, nhãn nguyên văn (ngắt dòng lại) | Không |
| 12 cạnh giữa nút + 3 cạnh zone→zone | 15 cạnh, cùng hướng | Không |
| 2 cạnh nét đứt có nhãn cờ (`COPILOT_SEMANTIC_PLANNER`, `COPILOT_SEMANTIC_CLAIMS`, "mặc định off") | Nét đứt, nhãn đặt cạnh đoạn thẳng đứng | Không |
| Nhãn "Có" (`safe_to_act?` → hành động) | Giữ | Không |
| 2 hình thoi (`Kiểm chứng`, `safe_to_act?`) | Giữ hình thoi | Không |
| Hình trụ "Dữ liệu có cấu trúc" | Hộp kiểu Store (nền xám) | Đổi ký hiệu hình, giữ nghĩa lưu trữ — quy ước của skill |
| `title:` front matter | Tiêu đề HTML ngắn hơn; trong Word dùng chú thích hình | Tiêu đề không nằm trong SVG xuất |
| Bố cục ngang trong từng zone (`direction LR`) | Hai hàng trong zone 1, 2, 3, 4 | Đổi bố cục, không đổi quan hệ |
| Không có nút trọng tâm | "Kiểm chứng" và 2 cạnh của nó tô màu nhấn | Thêm nhấn mạnh trình bày (chọn theo hub của IR) |

`check-fidelity.py`: 23/23 nhãn nguồn có mặt nguyên văn. Đã đối chiếu nhanh với mã: cờ `COPILOT_SEMANTIC_PLANNER` có trong `services/ai-service/copilot_semantic_planner.py`. Chưa đối chiếu lại toàn bộ 16 nút với `services/ai-service` (nguồn `.mmd` ghi đã đối chiếu trên nhánh `hungg`).

### Trước / sau

| | Mermaid (trước) | Diagram Design (sau) |
|---|---|---|
| Tỉ lệ | 2352 × 4026 px (1 : 1.71) | 800 × 1196 (1 : 1.50) |
| Zone | Rộng không đều, lệch tâm | Cùng rộng 720, lưới 4px |
| Ngắt chữ | Ngắt giữa cụm từ ("sanitize đặc / tả", "hội / thoại") | Ngắt theo nghĩa, định danh kỹ thuật không bị cắt |
| Nhãn cờ | Đè lên đường nối, nền xám | Đặt cạnh đoạn thẳng đứng, cách 8–12px |
| Chú giải / nhấn mạnh | Không có | Dải chú giải dưới; 1 nút trọng tâm |
| Font | Arial toàn bộ | Arial cho tên/tiếng Việt, Consolas cho định danh kỹ thuật |

## Hạn chế phát hiện qua kiểm thử

1. Sequence: tối đa 5 lifeline / 12 thông điệp / 1 fragment; không có `break`, `par`, `critical`. Mọi sequence Mermaid hiện có (7 participant) phải tách nếu thiết kế lại.
2. Không có kiểu **Use Case**; UML class giới hạn 7 lớp; ER 8 thực thể; DB schema 5 bảng.
3. Faithful tối đa 24 nút (bắt buộc chia zone khi > 9); trên 24 phải tách tổng quan + chi tiết.
4. Ở thang khóa luận, sơ đồ cao ~1200 đã chiếm trọn trang A4.
5. `verify-geometry.py`, `verify-contrast.py` là script của repo diagram-design, không đi kèm plugin đã cài.
