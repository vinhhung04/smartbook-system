# Sơ đồ thiết kế lại bằng Diagram Design (06/11/2026)

Rà soát 56 sơ đồ kỹ thuật trong `NHD82_KLTN_2026_..._demo5.docx` ở kích thước in thực tế (Word 100%, rộng 15,5 cm). Các hình dưới đây được vẽ lại theo profile `smartbook` (CLAUDE.md mục 7), chế độ **faithful**. **DOCX chưa được sửa** — thay ảnh trong Word theo bảng dưới.

Tái tạo toàn bộ: `bash scripts/diagrams/diagram-design/build.sh` (sinh HTML → kiểm tra → xuất `exports/{svg,png}/<loại>/<tên>-dd*`).

## Hình cần thay trong báo cáo

| Hình trong demo5 | Vấn đề | Tệp mới (PNG chèn Word: `exports/png/…`, SVG: `exports/svg/…`) |
|---|---|---|
| 4.1 Kiến trúc tổng thể | Chữ ~3 pt khi in, dày đặc | `architecture/architecture-system-overview-dd` |
| 4.2 Triển khai production | Chữ ~3 pt, 26 thành phần chen trong một khung | `architecture/deployment-production-dd` |
| 4.5 Đăng nhập, OTP hai lớp | Mermaid 7 participant rộng 2352 px → không đọc được | `sequence/auth-login-email-otp-dd-p1`, `-p2`, `-p3` (4.5a–c) |
| 4.6 Đăng ký, OTP email | Như trên | `sequence/auth-register-email-otp-dd-p1`, `-p2`, `-p3` (4.6a–c) |
| 4.15 OCR nhiều ảnh | Như trên | `sequence/ai-book-ocr-multi-image-dd-p1`, `-p2` |
| 4.17 Đề xuất nhập hàng | Như trên (cao 6,2 cm, chữ < 3 pt) | `sequence/analytics-reorder-budget-dd-p1`, `-p2` |
| 4.18 Trợ lý AI | Như trên | `sequence/ai-copilot-query-verification-dd-p1`, `-p2`, `-p3` |
| 4.22 ERD auth_db | 13 bảng rộng 2352 px, cao 6,8 cm → không đọc được | `erd/auth-service-iam-dd-p1`, `-p2` |
| 5.1 Pipeline Trợ lý AI | Ảnh 2352×4026 co về 12,3 cm, chữ nhỏ, ngắt chữ giữa cụm từ | `architecture/ai-copilot-pipeline-dd` |
| 6.1 CI/CD | Chữ nhỏ, hộp nhỏ giữa khoảng trắng lớn | `architecture/deploy-ci-cd-pipeline-dd` |
| **Mới** – mục 4.4 "Thanh toán phí phạt qua VNPay" | Mục duy nhất của phần thiết kế tương tác chưa có sơ đồ | Nguồn mới `source/sequence/borrow-vnpay-fine-payment.mmd` (+ bản Mermaid); thiết kế `sequence/borrow-vnpay-fine-payment-dd-p1`, `-p2` |

Các hình còn lại được vẽ lại ở đợt 2 (đồng bộ cách vẽ toàn báo cáo, demo7) — xem mục cuối.

Mọi tệp đều cao ≤ 1200 đơn vị trên khung rộng 800 (≤ 24 cm khi chèn rộng 16 cm, vừa một trang A4) và đã qua: `self_check.py --offline` (skill), `verify-geometry.py` (repo diagram-design), `check-text-fit.py`, xuất SVG/PNG ×3 bằng script chính thức, xem ảnh ở kích thước Word.

## Vì sao tách hình

Kiểu Sequence của Diagram Design đọc tốt tối đa ~5–6 lifeline trên khung 800; các nguồn có 7 participant và 18–31 bước. Mỗi hình được tách theo ranh giới nghiệp vụ, **giữ nguyên số bước của nguồn** (ví dụ 4.5a bước 1–11, 4.5b bước 12–23, 4.5c bước 24–29) và nối các phần bằng ghi chú "Tiếp tục ở Phần …".

## Bảng đối chiếu nội dung

Kiểm tra tự động: `python scripts/diagrams/check-fidelity.py <nguồn.mmd> <các svg>`.

| Nguồn | Nhãn nguồn còn nguyên văn | Khác biệt có chủ đích |
|---|---|---|
| `auth-login-email-otp.mmd` | 33/36 | Tên participant tách "tên + nhãn kỹ thuật" (`Web App` + `React · apps/web`, `PostgreSQL` + `auth_db`); bước 25 `(user:tokens-valid-after)` đặt ở ghi chú cạnh mũi tên; điều kiện `opt` dài đặt ở ghi chú đầu khung |
| `auth-register-email-otp.mmd` | 31/34 | Tên participant như trên; payload bước 11 đặt ở ghi chú; bước 17 nguồn vẽ thẳng Auth → Web, ở đây ghi "(qua API Gateway)" cho đúng đường đi thật |
| `ai-book-ocr-multi-image.mmd` | 24/27 | Tên participant (`Web App` + `AI Import`, `Inventory` + `inventory-service`, `OpenRouter` + `Qwen VL`); tham số bước 9 đặt ở ghi chú |
| `analytics-reorder-budget.mmd` | 14/19 | Tên participant (4); điều kiện trạng thái PO của bước 8 đặt ở ghi chú |
| `ai-copilot-query-verification.mmd` | 21/25 | Tên participant (4); `alt` 3 nhánh giữ đủ (skill khuyến nghị ≤ 2) |
| `borrow-vnpay-fine-payment.mmd` (mới) | 25/29 | Tên participant (4); URL Return đặt ở ghi chú |
| `erd/auth-service-iam.mmd` | 19/19 | Tách 2 hình (10 bảng > 8 của kiểu ER). Bổ sung đúng theo `schema.prisma`: khóa duy nhất ghép của `user_roles`, `role_permissions`, `user_warehouse_scopes`, cột `used_at` của `email_verification_tokens`; cột không vẽ ghi "+ n cột khác"; bội số `1` / `0..*` thay ký hiệu chân quạ |
| `architecture/ai-copilot-pipeline.mmd` | 23/23 | — |
| `architecture/deploy-ci-cd-pipeline.mmd` | 23/23 | Tiêu đề zone 2 xuống dòng |
| `drawio/architecture-system-overview.drawio` | đối chiếu tay: 16/16 thành phần, 4/4 zone, 6/6 kết nối, ghi chú | Tiêu đề chuyển thành chú thích hình; nhãn dài xuống dòng |
| `drawio/deployment-production.drawio` | đối chiếu tay: 26/26 thành phần, 6/6 vùng, 7/7 kết nối | 6 volume và 4 dịch vụ ngoài trình bày dạng lưới ô trong zone; tiêu đề VPS 3 dòng |

Không có actor, bước, nhánh điều kiện, mã lỗi, bảng, khóa hay kết nối nào bị lược bỏ hoặc gộp.

Đối chiếu mã trong đợt này: các con số then chốt của từng nguồn được kiểm lại với mã hiện tại (OTP 6 số/5 phút/5 lần/60 giây/10 lần mỗi giờ; giới hạn đăng nhập 10 lần/15 phút; ảnh 2048/1600 px; EWMA α = 0,35, z = 1,645, Kaplan–Meier ≥ 30; `ASSISTANT_ROLES`; TTL hành động 600 giây; VNPay HMAC-SHA512, intent 15 phút, RspCode; workflow, `deploy.sh`, `backup.sh`). Sơ đồ VNPay được dựng mới từ `vnpay-payment.controller.js`, `vnpay-webhook.controller.js`, `vnpay-payment.service.js`, `vnpay.service.js`, `customer-borrow.ts`, `fine-item.tsx` và cấu hình proxy của Gateway.

> **Sơ đồ tuần tự (từ demo8):** `seqauto.py` mặc định dùng skin `mono` – trắng đen kiểu PlantUML của demo6 (Times, tác nhân hình người, CSDL hình trụ, không thanh kích hoạt, không chú giải). Bản màu SmartBook: chạy generator với `SEQ_SKIN=color`.

## Đợt 2 – đồng bộ cách vẽ toàn báo cáo (demo7)

Các hình còn ở dạng ảnh PlantUML/Mermaid trong demo6 được chép **nguyên văn** từ ảnh gốc của báo cáo (`figures.json` ánh xạ chú thích → ảnh) và vẽ lại theo profile `smartbook`. Số hình giữ nguyên; hình tách được đánh nhãn (a)/(b)/(c) và các phần được liệt kê trong chú thích.

| Hình (demo6) | Loại | Tệp mới | Generator |
|---|---|---|---|
| 1.1 | Kiến trúc tổng quan | `architecture/overview-subsystems-actors-dd` | `fig_ch2.py` |
| 2.1, 2.3 | Kiến trúc / thành phần | `architecture/microservices-gateway-pattern-dd`, `architecture/dss-components-mapping-dd` | `fig_ch2.py` |
| 2.2, 2.4 | Tuần tự | `sequence/transactional-outbox-pattern-dd`, `sequence/ai-tool-calling-loop-dd` | `fig_ch2.py` (seqauto) |
| 2.5, 2.6 | Hoạt động (không làn) | `activity/hybrid-retrieval-confidence-dd`, `activity/metadata-evidence-fusion-dd` | `fig_ch2.py` (fig_activity) |
| 3.1–3.4 | Hoạt động có làn bơi | `activity/activity-borrow-reservation-dd`, `-purchase-receiving-dd`, `-ai-cataloging-dd`, `-ai-decision-support-dd` | `fig_activity.py` |
| 3.5–3.12 | Use case (UML) | `use-case/usecase-{overview,customer,librarian,warehouse-staff,warehouse-manager,ai,admin-scheduler,supplier}-dd` | `fig_usecase.py` |
| 4.3, 4.4 | Mô hình miền | `architecture/domain-catalog-warehouse-dd-p1..p3`, `domain-users-circulation-ai-dd-p1..p2` | `fig_domain.py` |
| 4.7–4.9, 4.11–4.15, 4.17, 4.20–4.22 | Tuần tự | `sequence/borrow-*`, `inventory-*`, `ai-metadata-cataloging-*`, `ai-find-book-by-cover-dd`, `ai-action-confirm-dd`, `ai-nightly-briefing-dd`, `borrow-due-reminder-dd` | `fig_seq_legacy.py` |
| 4.24–4.36 | ERD | `erd/auth-token-audit-dd`, `inventory-*-dd(-pN)`, `borrow-*-dd`, `ai-db-dd` | `fig_erd_legacy.py` (đọc trực tiếp `schema.prisma` / `schema.sql`) |

Use case và hoạt động không có kiểu sẵn trong Diagram Design (giới hạn ghi ở CLAUDE.md 7.1), nên được vẽ bằng generator riêng trong `scripts/diagrams/diagram-design/`, dùng chung token màu, font, lưới 4px, đường vuông góc bo góc 8, cầu vượt tại điểm giao, và vẫn chạy đủ bộ kiểm tra của mục 7.6.

### Đối chiếu nội dung đợt 2

| Hình | Đối chiếu | Khác biệt có chủ đích |
|---|---|---|
| 1.1 | 6/6 tác nhân, 11/11 thành phần, 21/21 kết nối, nhãn "chỉ đọc" | Sáu tác nhân và năm service nối qua đường trục chung thay cho mũi tên chéo; "chỉ đọc" gắn với Analytics → PostgreSQL (Analytics chỉ đọc `inventory_db`, `borrow_db` – `services/analytics-service/src/lib/db.js`) |
| 2.1 | 9/9 thành phần, 10/10 kết nối, 7/7 nhãn | Bố cục chuyển sang ngang cho vừa trang |
| 2.2 | 5/5 lifeline, 10/10 thông điệp, 1 ghi chú, `loop` lồng `alt` 2 nhánh | Tên lifeline xuống dòng như bản gốc |
| 2.3 | 1 tác nhân, 8/8 thành phần, 3/3 nhóm, 11/11 quan hệ | — |
| 2.4 | 4/4 lifeline, 11/11 thông điệp, `loop` + `alt` | — |
| 2.5, 2.6 | Toàn bộ hành động, fork/join, quyết định, nhãn nhánh | Văn bản dài tự xuống dòng |
| 3.1–3.4 | Toàn bộ hành động, quyết định, nút hợp nhất, nhãn có/không, làn | Nhánh chính đi xuống, nhánh phụ đi ngang (bản gốc có chỗ ngược lại) – không đổi ngữ nghĩa; 3.4 vòng lặp "có" vẽ bên trái làn AI Service để tránh cắt các đường khác |
| 3.5–3.12 | Toàn bộ tác nhân, use case, «include»/«extend», gói, khái quát hóa, tác nhân phụ | Nhiều đường của một tác nhân đi qua một đường trục; mũi tên tới tác nhân phụ gộp qua đường trục có điểm nối |
| 4.3, 4.4 | Toàn bộ khái niệm và quan hệ, chia 3 + 2 phần | Mỗi phần lặp lại khái niệm nối giữa các phần |
| 4.7–4.22 (tuần tự) | Giữ nguyên số bước của ảnh gốc | Tên participant tách tên + nhãn kỹ thuật; payload dài đặt ở ghi chú |
| 4.24–4.36 (ERD) | Bảng, PK, FK, UK lấy từ schema hiện tại | Bảng tham chiếu vẽ nét đứt chỉ có `# id`; tối đa 8 cột hiển thị, còn lại ghi "+ n cột khác" |
