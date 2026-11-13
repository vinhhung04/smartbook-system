# Phase E — Final summary

Nhánh `hungg` (HEAD `7f8a111` + thay đổi chưa commit). Không commit, không push, không deploy production. Chi tiết: [pre-flight](PHASE_E_PRE_FLIGHT_AUDIT.md) · [implementation](PHASE_E_IMPLEMENTATION_REPORT.md) · [tests](PHASE_E_TEST_REPORT.md) · bằng chứng `phase-e-evidence/` · dataset changelog `services/ai-service/eval/chat_answer_dataset_CHANGELOG.md`.

**Migration report:** không có migration — không thay đổi schema ở service nào.

## Acceptance criteria

| ID | Điều kiện | Trạng thái | Bằng chứng |
|---|---|---|---|
| E01 | Reservation idempotency an toàn trước timeout và concurrent | **PASS** | PG test 10/10 (HEAD: 4/10); E2E 10/10 gồm 4 retry đồng thời và retry sau restart borrow-service |
| E02 | Action lifecycle không có transition bất hợp lệ | **PASS** | lifecycle + Phase E tests; PG: claim/confirm/resolve đồng thời đúng 1 bên thắng |
| E03 | Revocation verification thống nhất | **PASS** | 8 endpoint → 503 khi chưa xác minh; sửa thêm lỗ lộ kết quả EXECUTED |
| E04 | Phân luồng Customer/Staff đúng với multi-role | **PASS** | `ReservationRouteTest` 7 vai trò + 5 trường hợp từ chối |
| E05 | Admin quản lý RECONCILE_REQUIRED end-to-end | **PASS** | E2E API 13/13 + UI 8/8 trên stack thật |
| E06 | Reconciliation có audit log và chống xử lý trùng | **PASS** | audit RECONCILED đủ trường (DB + UI); lần 2 → 409; PG 6 admin đồng thời → 1 |
| E07 | Dynamic data kiểm tra theo expected facts | **PASS** | truth đọc live; HEAD trả "0 quá hạn" (thật 436) → FAIL đúng; Phase E 5/5 |
| E08 | Citation evaluation phản ánh đúng chất lượng bằng chứng | **PASS** (rule-based) | precision/relevance/recall/completeness/numeric support tách riêng; không có kiểm chứng ngữ nghĩa |
| E09 | Ground truth partial/near-miss được xác minh | **PASS** | 4 case sửa theo tài liệu nguồn, có changelog cũ → mới → lý do; v1 giữ nguyên |
| E10 | Không tự suy diễn chính sách không có bằng chứng | **PARTIAL** | Bộ chấm bắt được (near-02 "không thể qua SMS", part-03 "thủ thư kiểm kê"); **chatbot vẫn còn trượt** (lượt cuối: ans-part-04 về trả góp, ans-near-02 về SMS; partial_evidence dao động 1/4–3/4 giữa các lượt) — chưa sửa prompt/generation |
| E11 | Personal context tuân thủ data minimization | **PASS** | câu hỏi công khai: 0 endpoint, prompt không có dữ liệu cá nhân; câu hỏi phạt chỉ tải phạt |
| E12 | Retrieval đánh giá riêng từng loại truy vấn | **PASS** | bảng theo ISBN/TITLE/AUTHOR/CATEGORY/DESCRIPTION/INTERNAL_DOC + unreachable; route tác giả: P@5 0,48 → 0,52 |
| E13 | Reorder không khuyến nghị trên dữ liệu không đáng tin | **PASS** | dòng lệch borrow/inventory không được cấp + cảnh báo; dữ liệu demo: 98/100 dòng lệch |
| E14 | Unit/Integration/E2E chạy và báo cáo trung thực | **PASS** | test report; mọi lần chạy hỏng và lý do đều được ghi |
| E15 | Không regression ngoài phạm vi | **PASS** (trong phạm vi đã kiểm) | 2.233 unit test của các package (ai 1356, borrow 156, analytics 149, auth 86, inventory 206, gateway 15, web 49, mobile 216) đều pass; E2E chỉ phủ luồng Phase E |
| E16 | UI/UX được bảo toàn | **PASS** | chỉ bổ sung trong Action Center + 1 dòng cảnh báo ngân sách; ảnh chụp |

## Kết quả trước / sau (đo thật)

| Chỉ số | Trước (HEAD) | Sau (Phase E) |
|---|---|---|
| Test idempotency PG (controller) | 4/10 | 10/10 |
| Chat answers (33 câu, cùng scorer) PASS/FAIL/UNVERIFIABLE | 26 / 6 / 1 | 27 / 4 / 2 (lượt after) · 30 / 2 / 1 (image cuối) — n = 1 mỗi lượt, chỉ dynamic data có nguyên nhân cải thiện rõ |
| Dynamic data | 3/5 | 5/5 |
| AUTHOR retrieval (reachable) R@5 · P@5 | 0,569 · 0,48 | 0,597 · 0,52 |
| Reorder ở ngân sách 5 triệu (dữ liệu demo) | cấp 4 bản / 880.000 đ trên dữ liệu lệch | 0 bản, cảnh báo 98 dòng lệch |
| `pytest` ai-service toàn bộ | treo ngẫu nhiên (test race) | 1356 pass, 12 skip, ~1 phút |

## Rủi ro và việc còn lại

1. **Dữ liệu demo lệch** (578 khoản vay mở vs 2 bản đang cho mượn): kế hoạch ngân sách gần như không cấp gì cho tới khi đối soát/seed lại — cần người dùng quyết định cách đối soát; không tự sửa dữ liệu.
2. **Chất lượng câu trả lời partial-evidence/near-miss** còn thấp (bộ chấm nay đo đúng; chưa sửa prompt).
3. **Ground truth BOOK_METADATA drift**: 30/55 case trỏ tới sách không còn trong catalog — cần cập nhật dataset có xác minh, hoặc đánh giá trên catalog snapshot cố định.
4. **Rate limit ai-service trong bộ nhớ một process** — không phải distributed; nhiều instance cần chuyển sang Redis có sẵn.
5. Biểu mẫu đối chiếu hiện id người tạo (UUID rút gọn), chưa có tên hiển thị; 5 key i18n `topbar.event.ai_action_*` có sẵn vẫn thiếu bản dịch (toast hiện key thô); danh sách Action Center chỉ làm mới khi có sự kiện realtime.
6. Đánh giá chat n = 1 lượt/cấu hình, phụ thuộc OpenRouter; chỉ cải thiện dynamic_data có nguyên nhân gốc chắc chắn.
7. Production chưa đo; image cục bộ đã thay, rollback: `docker tag smartbook-system-<svc>:pre-phase-e smartbook-system-<svc>:latest` rồi `docker compose up -d --no-deps --no-build <svc>` (borrow-service không có tag `pre-phase-e` — image cũ đã bị build đè; rollback qua git).
