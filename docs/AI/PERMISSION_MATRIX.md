# Ma trận quyền AI, phạm vi kho và giới hạn tốc độ

> Cập nhật 2026-11-12. Quyền của từng role lấy từ `auth_db` đang chạy (bảng `role_permissions`). Code: `agent_actions.py` (`policy`), `agent_permissions.py`, `routes_conversations.can_use_assistant`, `action_guard.py`, `warehouse_scope.py`, `ai_core/policy.py`, `apps/web/src/lib/rbac.ts`. Test: `test_permission_matrix.py`.

## Nguyên tắc

1. **Backend quyết định cuối cùng.** Web chỉ ẩn/hiện giao diện; ai-service và service đích đều tự kiểm tra.
2. **Role AND Permission.** Web (`canAccess = hasAnyRole && hasAnyPermission`) và các service đích (inventory `authorizeManagerDecision`, borrow `authorizeBorrowAdminWrite`, `authorizeCustomerSelf`) đều yêu cầu đồng thời một role và một permission. ai-service dùng đúng ngữ nghĩa đó. Superuser qua mọi kiểm tra.
3. **Quyền xác nhận action = quyền service đích nhận lệnh ghi.** Không đề xuất thẻ hành động cho người mà service đích sẽ từ chối.
4. **Kiểm tra lại lúc xác nhận**, theo cấu hình hiện hành, không theo bản sao lưu trên action lúc tạo.
5. Client và model không thể tự cấp quyền qua payload: danh tính lấy từ token, override bị giới hạn trường, tool đọc dùng token của người hỏi.

## Quyền hiện có của từng role (liên quan tới AI)

| Role | Quyền liên quan |
|---|---|
| ADMIN (superuser trong seed) | analytics.reports.view, reports.read, inventory.operation.decide, inventory.purchase.request, borrow.write + các quyền borrow ghi, customer.self.* |
| WAREHOUSE_MANAGER | analytics.reports.view, reports.read, inventory.operation.decide, inventory.purchase.request |
| WAREHOUSE_STAFF | inventory.purchase.request, inventory.task.read |
| LIBRARIAN | borrow.write, borrow.customers.write, borrow.loans.write, borrow.fine.write, borrow.membership.write, … |
| CUSTOMER | customer.self.read, customer.self.write |
| SUPPLIER | supplier.portal.read, supplier.portal.write |

## Ma trận

| Khả năng | ADMIN | WAREHOUSE_MANAGER | WAREHOUSE_STAFF | LIBRARIAN | CUSTOMER | SUPPLIER |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Chatbot nổi (`/chat`) | – (dùng trang trợ lý) | – (dùng trang trợ lý) | ✓ | ✓ | ✓ | – (cổng riêng) |
| Trang Decision Assistant (`/assistant`, lịch sử hội thoại) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Xem dữ liệu analytics toàn hệ thống qua AI | ✓ | ✓ (theo phạm vi kho) | theo quyền service đích | theo quyền service đích | ✗ (chỉ dữ liệu của mình) | ✗ |
| Xác nhận `CREATE_REORDER_DRAFT` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Xác nhận `CREATE_STOCK_ALERT` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Xác nhận `CREATE_STAFF_TASK_DRAFT` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Xác nhận `CREATE_RESERVATION_DRAFT` | ✓ (cho khách) | ✗ | ✗ | ✓ (cho khách) | ✓ (cho chính mình) | ✗ |
| Xác nhận `CREATE_REPORT_DRAFT` | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Đối chiếu action (`/actions/reconcile`), thống kê action | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

Chatbot nổi bị ẩn với người có quyền vào trang trợ lý (`layout.tsx`: `hasDedicatedAssistant`). Người chỉ có role mà thiếu permission (hoặc ngược lại) không qua cổng nào ở cả web lẫn backend.

### Chính sách xác nhận và guard của service đích

| Loại action | Chính sách trong ai-service | Guard của service đích (đã đối chiếu code) |
|---|---|---|
| `CREATE_REORDER_DRAFT` | permission `inventory.purchase.request` | inventory `authorizeAnyPermission(['inventory.purchase.request'])` |
| `CREATE_STOCK_ALERT`, `CREATE_STAFF_TASK_DRAFT` | role WAREHOUSE_MANAGER/ADMIN **và** `inventory.operation.decide` | inventory `authorizeManagerDecision` |
| `CREATE_RESERVATION_DRAFT` (bạn đọc) | role CUSTOMER **và** `customer.self.read/write` | borrow `authorizeCustomerSelf` trên `/borrow/my` |
| `CREATE_RESERVATION_DRAFT` (quầy) | role LIBRARIAN/ADMIN **và** một quyền borrow ghi | borrow `authorizeBorrowAdminWrite` trên `/borrow/reservations` |
| `CREATE_REPORT_DRAFT` | role ADMIN/WAREHOUSE_MANAGER/LIBRARIAN, hoặc quyền đọc báo cáo | không ghi vào service nào |

## Đặt chỗ sách của bạn đọc

- Bạn đọc đặt cho **chính mình** qua `/my/reservations`: body không có `customer_id`, borrow-service lấy khách hàng từ token. Ghi `customer_id` vào payload hay override đều không có tác dụng (override bị từ chối 400).
- Thủ thư đặt cho khách qua `/borrow/reservations` với `customer_id` trong bản nháp; thiếu `customer_id` thì chỉ trả bản nháp, không gọi đích.
- Đặt chỗ **không yêu cầu phạm vi ghi kho**: bạn đọc và thủ thư không có phạm vi kho nào (đã kiểm tra `user_warehouse_scopes`: `customer01` 0, `librarian01` 0). Trước đây yêu cầu này khiến mọi đặt chỗ bạn đọc xác nhận đều bị 403. Tồn kho, biến thể, chi nhánh và điều kiện thẻ thành viên do borrow-service kiểm tra (hết hàng → 4xx → `FAILED`).
- Bấm hai lần hoặc thử lại sau lỗi mạng không tạo đặt chỗ trùng: claim nguyên tử + `Idempotency-Key`.

## Phạm vi kho

| Dữ liệu | Cơ chế | Thất bại khi không đọc được phạm vi |
|---|---|---|
| Dữ liệu trực tiếp (tool, analytics) | Service đích lọc theo token của người dùng | do service đích |
| Dữ liệu AI đã lưu (lịch sử, ảnh chụp biểu đồ, cache) | `warehouse_scope.can_view`: chỉ hiện khi mọi kho trong dữ liệu vẫn còn trong phạm vi đọc hiện tại | ẩn (fail-closed) |
| Cache assistant | Khóa gồm dấu vân tay user + role + permission + phạm vi kho | không cache |
| Ghi vào kho khi xác nhận | `action_guard.require_write_scope`: mọi kho đích phải nằm trong phạm vi WRITE/OPERATOR/FULL | 503, action giữ nguyên |

Phạm vi lấy từ auth-service `GET /internal/users/{id}/warehouse-scopes` (khóa nội bộ), cache 30 giây.

## Giới hạn tốc độ

| Người gọi | Khóa bucket | Nguồn |
|---|---|---|
| Đã đăng nhập | `user:<user_id>` | `/auth/me` |
| Ẩn danh | `ip:<IP client>` | header `x-smartbook-client-ip` do gateway đặt |

- Gateway xác định IP client **một lần, trước mọi proxy**, bằng `resolveClientIp(req, GATEWAY_TRUSTED_PROXY_HOPS)` — cùng cách bộ giới hạn của chính gateway làm — rồi ghi đè header gửi xuống ai-service. Header client tự gửi bị thay thế; `X-Forwarded-For` client tự ghi không bao giờ được ai-service đọc.
- ai-service chỉ tin header đó vì không có cổng publish (chỉ gateway gọi tới được); `TRUST_GATEWAY_CLIENT_IP=false` tắt việc tin.
- Mức: 15 yêu cầu/phút, 100/giờ mỗi bucket, dùng chung cho `/chat` và `/assistant`.
- Giới hạn: bộ đếm nằm trong bộ nhớ một process (đủ cho một instance hiện tại). Ở môi trường dev không có proxy biên, `GATEWAY_TRUSTED_PROXY_HOPS=1` khiến `X-Forwarded-For` client tự gửi được tin (giống bộ giới hạn hiện có của gateway); đặt `0` nếu gateway nhận kết nối trực tiếp từ Internet.

## Kiểm thử bảo mật (tóm tắt)

| Kịch bản | Test |
|---|---|
| User A xác nhận/hủy/xem action của B | `test_action_lifecycle.test_another_users_action_cannot_be_confirmed`, `test_copilot_security` |
| User A xem hội thoại của B | `test_assistant_conversation_access` |
| Nhân viên kho A ghi vào kho B; phạm vi bị thu hồi sau khi tạo bản nháp | `test_copilot_security` (write scope), `test_warehouse_scope` |
| Token bị thu hồi / không xác minh được | `test_copilot_security` (locked/401), `test_action_lifecycle.test_unverified_token_revocation_refuses_the_write` |
| Quyền bị thu hồi sau khi tạo bản nháp; danh sách role cũ trên action | `test_permission_matrix.test_the_role_list_stored_on_an_old_action_is_not_trusted` |
| Sửa payload/warehouse/customer qua override | `test_action_lifecycle.test_payload_tampering_through_override_is_rejected`, `test_reservation_actions.test_customer_cannot_retarget_the_reservation_through_override`, `test_copilot_security` |
| Hai người cùng xác nhận | `test_action_lifecycle.test_two_concurrent_confirms_execute_once` |
| Action hết hạn vẫn gửi xác nhận | `test_action_lifecycle.test_expired_action_cannot_be_confirmed` |
| Tool injection (tool lạ, tham số lạ) | `test_ai_core.RunReadToolTest` |
| Chèn system prompt qua lịch sử | `test_chat_pipeline.test_history_accepts_only_conversational_roles` |
| Giả mạo IP | `test_ai_core.RateLimitKeyTest`, `gateway-contract.test.js` |
