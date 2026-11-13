# Phase F — Ma trận năng lực AI theo vai trò

> Nguồn sự thật: `services/ai-service/ai_core/capabilities.py` (registry), `agent_actions.ACTION_CONFIG` (chính sách xác nhận),
> `routes_conversations.can_use_assistant` (cổng Decision Assistant). Quyền theo seed `services/auth-service/prisma/seed.js`.
> Kiểm thử: `test_phase_f_role_aware.py`, E2E `eval/phase_f_e2e.py`.

## 1. Nguyên tắc

1. Năng lực = **role AND permission** (một trong các phương án của `policy`), kiểm bằng `agent_actions.policy_allows` — cùng hàm với lớp action; superuser qua.
2. **Hợp của mọi role** người dùng có, không dùng `get_primary_role()` để quyết định quyền. Primary role chỉ dùng cho persona/lời chào.
3. Role cũ (MANAGER, STAFF…) **không** được ánh xạ trong registry — để registry không bao giờ rộng hơn cổng backend (auth-service trả role chuẩn).
4. Registry chỉ **thu hẹp**: có năng lực nghĩa là AI được thử đọc bằng token của người dùng; service đích vẫn kiểm tra lại.
5. Không mở `/assistant` cho mọi người: năng lực `decision.assistant` trùng đúng `can_use_assistant` (có test so sánh).
6. Thao tác ghi vẫn `DRAFT → VALIDATE → CONFIRM → EXECUTE → AUDIT`; registry chỉ tham chiếu tên action trong `ACTION_CONFIG`.

## 2. Registry

| Capability | Policy (role AND permission) | Phạm vi dữ liệu | Endpoint / tool | Nhạy cảm | Cá nhân | Action (cần xác nhận) |
|---|---|---|---|---|---|---|
| library.policy | mọi người (cả ẩn danh) | public | FAQ corpus | LOW | – | – |
| catalog.search | mọi người | public | catalog | LOW | – | – |
| catalog.availability | mọi người | public | `/public/catalog/books` | LOW | – | – |
| book.identify_image | quyền `inventory.catalog.read|write` | public | `/vision/identify` (OCR+CLIP+catalog) | LOW | – | – |
| reader.loans / reservations / fines / membership | CUSTOMER + `customer.self.read` | self | `/borrow/my/*` | MEDIUM | ✓ | – |
| reader.wallet | CUSTOMER + `customer.self.read` | self | `/borrow/my/account` (chỉ khi hỏi) | HIGH | ✓ | – |
| reader.reserve | CUSTOMER + `customer.self.read|write` | self | – | MEDIUM | ✓ | CREATE_RESERVATION_DRAFT |
| warehouse.my_tasks | STAFF/MANAGER/ADMIN + `inventory.task.read` | self | `/api/my-warehouse-tasks` | LOW | ✓ | – |
| warehouse.picking | WAREHOUSE_STAFF + `inventory.task.read` | warehouse_scope | `/api/picking/tasks` | LOW | ✓ | – |
| warehouse.putaway | WAREHOUSE_STAFF + `inventory.task.progress` | warehouse_scope | `/api/putaway/receipts` | LOW | ✓ | – |
| warehouse.exceptions | WAREHOUSE_STAFF + `inventory.exception.report` | self | `/api/exception-reports/my` (sửa từ đường dẫn không tồn tại `/api/my-exception-reports`) | LOW | ✓ | – |
| warehouse.purchase_request | quyền `inventory.purchase.request` | warehouse_scope | – | MEDIUM | – | CREATE_REORDER_DRAFT |
| library.circulation | LIBRARIAN/ADMIN + `borrow.read|loans.read|customers.read|write|loans.write` | library | `/borrow/loans`, `/borrow/reservations`, `/borrow/fines` | MEDIUM | ✓ | – |
| library.reserve_for_customer | LIBRARIAN/ADMIN + quyền borrow ghi | library | – | MEDIUM | ✓ | CREATE_RESERVATION_DRAFT |
| analytics.chat | role nội bộ (ADMIN/WM/WS/LIB) | target kiểm | analytics qua token | MEDIUM | – | – |
| ops.overview | ADMIN/WM + quyền analytics | warehouse_scope | KPI, rủi ro tồn kho | MEDIUM | – | – |
| ops.decide | ADMIN/WM + `inventory.operation.decide` | warehouse_scope | – | MEDIUM | – | CREATE_STOCK_ALERT, CREATE_STAFF_TASK_DRAFT |
| report.draft | theo `ACTION_CONFIG` | – | – | LOW | – | CREATE_REPORT_DRAFT |
| decision.assistant | ADMIN/WM + `analytics.reports.view|analytics.read|reports.read` | warehouse_scope | mọi READ tool (`*`) | MEDIUM | – | – |
| admin.action_audit | ADMIN | system | `/actions/stats`, `/actions/reconcile` | MEDIUM | – | – |
| supplier.orders | SUPPLIER + `supplier.portal.read|write` | supplier_self | `/api/supplier-account/orders` (inventory lọc theo nhà cung cấp gắn với email tài khoản) | MEDIUM | ✓ | – |

## 3. Trải nghiệm theo vai trò (seed hiện tại)

| Role | Trải nghiệm (`experience`) | Nơi dùng | Đọc được | Không được |
|---|---|---|---|---|
| ADMIN | decision_assistant | trang `/ai-assistant` (+ ảnh) | toàn bộ theo quyền; đối chiếu action | vượt phê duyệt hiện có |
| WAREHOUSE_MANAGER | decision_assistant | `/ai-assistant` (+ ảnh) | kho trong phạm vi, KPI, đề xuất nhập | dữ liệu mượn trả (không có quyền borrow) |
| WAREHOUSE_STAFF | warehouse_work | chatbot nổi (+ ảnh) | nhiệm vụ, picking, putaway, ngoại lệ | Decision Assistant, báo cáo quản lý |
| LIBRARIAN | library_operations | chatbot nổi (+ ảnh) | phiếu mượn, đặt trước, phạt | báo cáo kho nội bộ |
| CUSTOMER | reader | chatbot cổng độc giả (+ ảnh), app mobile (quét bìa) | dữ liệu của chính mình, tồn công khai | dữ liệu người khác, analytics |
| SUPPLIER | supplier | chatbot trên `/supplier` (**không** có ảnh — không có quyền đọc catalog) | đơn hàng của chính nhà cung cấp | tồn kho, analytics, nhà cung cấp khác |

Câu hỏi gợi ý ban đầu được sinh từ năng lực thực có (`GET /ai/capabilities` → `starter_questions`).

## 4. Kiểm thử bảo mật (đã chạy)

| Kịch bản | Bằng chứng |
|---|---|
| Đúng role + đúng permission; role thiếu permission; permission thiếu role | `CapabilityMatrixTest.test_role_without_permission_and_permission_without_role` |
| Multi-role (thủ thư kiêm độc giả đọc được phiếu mượn của chính mình) | `test_multi_role_is_the_union_not_the_primary_role`, `test_librarian_who_is_also_a_reader_gets_their_own_loans` |
| Superuser / ẩn danh | `test_superuser_and_anonymous` |
| Permission bị thu hồi (lượt sau mất năng lực) | `test_revoked_permission_takes_effect_on_the_next_request` |
| Token bị thu hồi | `test_revoked_token_is_refused`; E2E `revoked_token:*` (logout thật → 401) |
| Cổng assistant không đổi | `test_assistant_capability_is_exactly_the_assistant_gate`; E2E 4 role → 403 |
| Tool ngoài năng lực bị từ chối | `ToolAllowlistTest` |
| Supplier chỉ đọc đơn của mình, không chạm endpoint nội bộ | `test_supplier_*`; E2E `supplier:*` |
| Ảnh/ngữ cảnh ảnh của người khác | `ChatWithPhotoTest.test_another_users_photo_is_gone`; E2E `vision_chat:other_user_410` |
| Phạm vi kho thay đổi | giữ nguyên cơ chế hiện có (`test_warehouse_scope`, planner `_still_visible`), chạy lại trong bộ pytest |
