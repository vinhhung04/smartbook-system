# Audit báo cáo KLTN SmartBook: demo4 → demo5

Ngày audit: 06/11/2026. Nguồn sự thật: mã nguồn tại HEAD `8b6ff3d` (nhánh `feature/email-otp-auth`). Phần mã ứng dụng ở commit này **trùng hoàn toàn với `origin/hungg` (`d6221e8`)**; ba commit thêm vào chỉ gồm tài liệu, công cụ sơ đồ và tệp `.claude`. Nhánh `hungg` cục bộ chậm 6 commit so với `origin/hungg`, nên audit đọc trực tiếp working tree hiện tại, không chuyển nhánh.

Bản gốc đã sao lưu: `thesis/report-update/backup/NHD82_..._demo4.ORIGINAL.docx` (SHA-256 `63214B5C…B120`, trùng file gốc).

Ký hiệu trạng thái: IMPLEMENTED (có trong code) · VERIFIED (có bằng chứng kiểm thử) · PARTIAL · FEATURE-FLAG OFF · EXPERIMENTAL · NOT VERIFIED · PLANNED.

## 1. Kiểm chứng chạy lại trong đợt audit (06/11/2026)

| Bộ kiểm thử | Lệnh | Kết quả |
|---|---|---|
| Cấu hình workspace | `pnpm test:workspace-config` | 74/74 đạt |
| packages/shared | `pnpm test:node` | 30/30 |
| API Gateway | ″ | 13/13 |
| Auth Service | ″ | 86/86 |
| Inventory Service | ″ | 206/206 |
| Borrow Service | ″ | 154/154 |
| Analytics Service | ″ | 134 đạt, 3 bỏ qua, 0 lỗi |
| Web (unit) | `pnpm test:web` | 46/46 |
| Mobile (Jest) | `pnpm test:mobile` | 33 suite, 216/216 |
| AI Service (pytest) | chạy trong image `smartbook-system-ai-service` với mã nguồn hiện tại | xem `test_ai` (mục 6) |
| Ảnh giao diện | Playwright (Edge) trên Vite 5174 + stack Docker dev, dữ liệu demo | 28 ảnh web + 7 ảnh mobile (Expo web 390 px) |
| OCR nhiều ảnh | chạy thật qua gateway → ai-service → OpenRouter với 2 ảnh thử nghiệm tự tạo | trả kết quả, phát hiện 3 trường cần quyết định |
| Trợ lý AI có biểu đồ | chạy thật (ADMIN), câu hỏi xu hướng 6 tháng | trả biểu đồ đường + bằng chứng, "Đã đối chiếu" |

Không chạy lại: kiểm thử tích hợp (`scripts/*.mjs`), E2E Playwright, k6, các benchmark AI có gọi LLM (để không làm thay đổi dữ liệu dev và không phát sinh chi phí); các bảng này được ghi rõ ngày đánh giá gốc trong báo cáo.

## 2. Bảng đối chiếu theo chương

| Chương/mục | Nội dung demo4 | Bằng chứng từ codebase | Tình trạng | Hành động trong demo5 |
|---|---|---|---|---|
| Tóm tắt / Abstract | 11 công cụ; số liệu 97,1 %, 80 %…; không nhắc OTP, OCR nhiều ảnh, Copilot 3.x, VPS | `tool_registry.py` (11 + 9 = 20 công cụ); `email-otp.js`; `routes_book_ocr.py`; `compose.prod.yml`, `deploy-production.yml` | Cũ | Viết lại phần nội dung và kết quả, giữ cấu trúc 4 đoạn |
| 1.4.2 Phạm vi | Auth "đặt lại mật khẩu qua email"; giám sát "OpenTelemetry – Prometheus – Grafana – Loki" | `auth.routes.js` (OTP, refresh); commit `ea9e761` bỏ Loki/Promtail/Tempo | Cũ/Sai | Cập nhật Auth, AI (OCR nhiều ảnh, Copilot), hạ tầng (Caddy, VPS) |
| 1.4.3 Giới hạn | "AI Service chưa gắn tracing như Node.js" | Không service nào còn tracing; chỉ metric | Sai | Thay bằng giới hạn đúng (chỉ metric, mobile chưa thử thiết bị thật, OCR chưa có benchmark) |
| 1.6 Kết quả | 11 công cụ, số liệu cũ | như trên | Cũ | Cập nhật |
| 2.2.4 Quan sát | Tempo, Loki như thành phần đang dùng | `docker-compose.yml` (profile `monitoring`), `packages/shared/telemetry` | Cũ | Giữ lý thuyết, nói rõ SmartBook hiện chỉ dùng metric |
| 2.3 Xác thực | Chỉ JWT | `email-otp.js` (HMAC-SHA256, 6 số, 5 phút, 5 lần thử), `refresh-tokens.js` (xoay vòng, phát hiện dùng lại) | Thiếu | Thêm mục OTP và refresh token |
| 2.7 Công nghệ, Bảng 2.2 | Quan sát: Tempo, Loki | như trên; `deploy/Caddyfile`, GHCR, EAS | Cũ | Sửa hàng Quan sát, Triển khai |
| 3.3 Bảng 3.2, 3.5, 3.6 | FR-02 "xác minh email" chung; FR-47 "11 công cụ" | auth, OCR, copilot | Cũ/Thiếu | Sửa FR-02, FR-44, FR-47; thêm FR-54…FR-60 |
| 3.4.4 NFR quan sát | "trace, metric, log tập trung" | chỉ metric + healthcheck | Sai | Sửa |
| 3.6.3 Bảng 3.8 | 62 use case | Thiếu OTP, 2FA, OCR, phân công kho | Thiếu | Thêm UC63–UC66 vào danh sách |
| 3.6.4 UC02 | Đăng ký + xác minh email | `register` → `PENDING_VERIFICATION` + OTP | Cũ | Sửa mô tả UC02 |
| 4.1.1 Kiến trúc, Hình 4.1 | Có lớp quan sát Tempo/Loki | compose dev/prod | Cũ | Vẽ lại bằng Draw.io; sửa đoạn văn |
| 4.1.4 Triển khai, Hình 4.2 | Docker Compose cục bộ, cổng 5173/3000, Tempo/Loki | `compose.prod.yml`, `deploy/Caddyfile`, `docs/DEPLOYMENT.md` | Cũ | Viết lại theo production VPS; Hình 4.2 mới (Draw.io) |
| 4.2.1 Xác thực, Hình 4.5 | Không có OTP, refresh token | `auth.controller.js` (`login`, `verifyLoginOtp`, `issueSession`) | Thiếu | Viết lại; dùng sơ đồ `auth-login-email-otp.mmd`; thêm sơ đồ đăng ký OTP |
| 4.2.2 Phân quyền, Bảng 4.3 | 66 quyền; "Inventory mặc định cho phép mọi kho" | seed: 65 quyền (CSDL dev: 64); `warehouse-scope.utils.js` fail-closed, `warehouse-scope.middleware.js` | Sai | Sửa số quyền; viết lại đoạn phạm vi kho (đã áp dụng, có kiểm thử) |
| 4.4 Thiết kế tương tác | 15 sơ đồ; mục VNPay trống | VNPay: `vnpay-payment.controller.js`, `vnpay-payment.service.js` | Thiếu | Điền mục VNPay; thêm sơ đồ OCR nhiều ảnh; thay Hình 4.15, 4.16 |
| 4.5 CSDL, Bảng 4.4, Hình 4.20 | auth_db 12 bảng | `schema.prisma`: 13 model (thêm `email_otp_challenges`) | Cũ | Sửa bảng; thay ERD auth |
| 4.6 Giao diện | Ảnh trước các đợt redesign 10/2026 | Ảnh chụp mới 06/11/2026 | Cũ | Thay toàn bộ ảnh web; thêm ảnh OTP, việc kho, giao việc, mobile |
| 5.2.3 Đề xuất nhập | Phân bổ tham lam theo ưu tiên | `budget-allocation.js` `allocateMarginal`, `expected-returns.js`; REORDER_OPTIMIZATION_EVALUATION §4 | Cũ | Bổ sung chế độ ngân sách (vị thế tồn, Kaplan–Meier, cấp từng bản) |
| 5.2.6 Trợ lý | 11 công cụ, vòng lặp 4 vòng | Copilot 3.0–3.3, planner, XAI, kiểm chứng, biểu đồ | Cũ | Viết lại; thêm Bảng công cụ tổng hợp, sơ đồ pipeline |
| 5.3 Trích xuất | Không có OCR sách | `book_ocr/*`, BOOK_OCR_IMPORT.md | Thiếu | Thêm mục OCR nhiều ảnh |
| 5.5 Gợi ý sách | Công thức V1 | `RECOMMENDATION_MODEL=v2` mặc định; `recommendation_v2.py` | Cũ | Mô tả V2 là mặc định, giữ V1 làm mốc so sánh |
| 6.2 Bảng 6.2 | Expo SDK 57, RN 0.86; Tempo, Loki | `apps/mobile/package.json` (Expo 58, RN 0.88) | Cũ | Sửa |
| 6.6 Quan sát | Trace qua Tempo, log qua Loki | commit `ea9e761` | Sai | Viết lại |
| 6.7 VNPay | Trống | borrow-service | Thiếu | Điền |
| 6.8 CI | Chỉ CI | `deploy-production.yml`, `mobile-release.yml` | Thiếu | Bổ sung CD, thêm mục triển khai production và phát hành mobile |
| 7.2 Bảng 7.1 | 1014 ca (05/10/2026) | chạy lại 06/11/2026 | Cũ | Thay bằng số mới |
| 7.3–7.5 | Tích hợp, E2E, k6 (05/10) | không chạy lại | Đúng tại thời điểm | Giữ, ghi rõ ngày |
| 7.6 AI | Đánh giá trợ lý 11 công cụ | AI_COPILOT_3_3_EVALUATION, SEMANTIC_UNDERSTANDING, 3_0_VISUALIZATION, BOOK_OCR_EVALUATION | Thiếu | Giữ bảng cũ (ghi là phiên bản trước Copilot), thêm 3 bảng mới + OCR |
| 7.7 Dự báo, Gợi ý | Bảng 7.11, 7.12 theo giao thức cũ | `thesis/tables/forecast_model_results.csv`; `recommendation_v2_report.md` | Cũ | Thay số liệu theo giao thức đã đăng ký; thêm backtest ngân sách |
| 7.8 VNPay | Trống | `vnpay.service.test.js`, `vnpay-payment.service.test.js` | Thiếu | Điền (unit test; sandbox chưa chạy lại) |
| 7.9.3 Vấn đề | Chỉ mục ngữ nghĩa; PrismaClient; phạm vi kho | `catalog_sync.py` (khóa nội bộ, đồng bộ 300 s); 40 lần `new PrismaClient` | Một phần đã sửa | Cập nhật trạng thái từng vấn đề |
| 8.1, 8.2 | Kết quả, hạn chế theo demo4 | toàn bộ trên | Cũ | Viết lại cho khớp chương 1–7 |
| 8.3 Hướng phát triển | Trống | — | Thiếu | Viết mới |
| Phụ lục A | Chỉ cài đặt cục bộ | DEPLOYMENT.md, MOBILE_DEPLOYMENT.md | Thiếu | Thêm A.9 production, A.10 mobile |
| Phụ lục B | Thiếu API OTP, refresh, phạm vi kho, OCR, VNPay | routes | Thiếu | Thêm dòng vào B.1, B.3, B.5 |

## 3. Trạng thái các tính năng đặc biệt

| Tính năng | Trạng thái | Bằng chứng |
|---|---|---|
| Xác minh email bằng OTP khi đăng ký | IMPLEMENTED, mặc định bật (`REGISTRATION_EMAIL_VERIFICATION=required`); unit test auth 86/86 | `auth.controller.js` register/verifyEmailOtp |
| OTP đăng nhập hai lớp cho nhân viên | FEATURE-FLAG OFF (`STAFF_EMAIL_OTP_MODE=off` ở dev và prod); bật được theo tài khoản (`email_otp_2fa_enabled`) chỉ khi chế độ khác `off` | `requiresEmailOtp` |
| Refresh token | IMPLEMENTED, chỉ cấp cho ứng dụng di động (`client: "mobile"`), lưu Redis, xoay vòng, phát hiện dùng lại | `refresh-tokens.js` |
| Phạm vi kho | IMPLEMENTED (Inventory, Analytics, AI; fail-closed 503), có unit test; ngoại lệ có chủ đích: `/api/borrow-integration`, `/api/books`, `/api/supplier-account` | `warehouse-scope.middleware.js`, `scripts/warehouse-scope-integration.mjs` |
| OCR nhiều ảnh | IMPLEMENTED; PARTIAL VERIFIED (smoke 3 ảnh + 27 lần quét live, chạy thật lại 06/11); chưa có benchmark ≥ 50 cuốn | BOOK_OCR_EVALUATION.md |
| Copilot 20 công cụ, kiểm chứng Layer 1, XAI, biểu đồ | IMPLEMENTED, VERIFIED trên tập test đóng băng (dữ liệu dev mô phỏng) | AI_COPILOT_3_3_EVALUATION.md, AI_COPILOT_3_0_VISUALIZATION.md |
| Semantic Planner | FEATURE-FLAG OFF (trượt tiêu chí context resolution 0,810 < 0,85) | AI_COPILOT_SEMANTIC_UNDERSTANDING.md §9.3 |
| Semantic Claims (Layer 2–3) | FEATURE-FLAG OFF (p95 7,0–8,3 s > 6 s) | AI_COPILOT_3_3_EVALUATION.md §4.4 |
| Recommendation V2 | IMPLEMENTED, mặc định (`RECOMMENDATION_MODEL=v2`); đánh giá offline trên dữ liệu tổng hợp | `main.py`, `compose.prod.yml`, recommendation_v2_report.md |
| Phân bổ ngân sách cận biên (IP_RETURNS+FLOOR+MARGINAL) | IMPLEMENTED khi truyền `budgetVnd`; backtest dữ liệu tổng hợp 24/24 lần chạy | REORDER_OPTIMIZATION_EVALUATION.md §3–4 |
| Các ứng viên không ngân sách (IP_RETURNS, FLOOR…) | Chỉ đánh giá offline, KHÔNG đưa vào production | như trên |
| Croston/SBA/TSB | Chỉ đánh giá offline; production dùng EWMA α = 0,35 + xu hướng | `forecast.js`, `reorder-suggestion.js` |
| Production VPS + CI/CD + rollback + backup | IMPLEMENTED, hoạt động từ 29/10/2026 theo DEPLOYMENT.md; audit này không SSH vào VPS | `deploy/`, `.github/workflows/` |
| Mobile | APK preview đã build trên EAS; **chưa kiểm chứng trên thiết bị thật**; iOS chưa build; chưa nộp store | MOBILE_DEPLOYMENT.md (29/10/2026) |
| VNPay | IMPLEMENTED (sandbox), unit test; luồng sandbox chưa chạy lại trong đợt này | borrow-service |
| Observability | Metric (OTel MeterProvider + Prometheus exporter); Prometheus/Grafana chỉ ở profile `monitoring` của dev; production: healthcheck Docker, `healthcheck.sh`, log Docker | commit `ea9e761`, compose files |

## 4. Phát hiện mới trong đợt audit (không sửa code)

1. Ứng dụng mobile (Expo web, chế độ dev) phát cảnh báo React "Received `false` for a non-boolean attribute" ở màn hình chủ của bạn đọc và nhân viên kho.
2. CSDL dev có 64 quyền, seed khai báo 65 (seed chưa chạy lại sau khi thêm quyền).
3. Inventory Service vẫn khởi tạo `new PrismaClient()` ở 40 vị trí (nguy cơ cạn kết nối nêu ở demo4 vẫn còn).
4. `.env` dev trỏ tới máy chủ SMTP thật (không phải mailpit): chạy kịch bản E2E OTP sẽ gửi email thật.
