# AI Inventory Rebalancing — Ma trận quyền

Nguồn quyền duy nhất: `auth_db.user_warehouse_scopes` qua `GET /internal/users/:id/warehouse-scopes` (resolver dùng chung `packages/shared/runtime/warehouse-scope.cjs`, bản Python `services/ai-service/warehouse_scope.py`). Không có cơ chế phân quyền mới.

## 1. Mức quyền kho

| access_level | Đọc | Ghi |
|---|---|---|
| READ, READ_ONLY | ✔ | ✘ |
| WRITE, OPERATOR, FULL | ✔ | ✔ |
| (không có dòng) | ✘ | ✘ |
| SUPERUSER (cờ `is_superuser`, không phải access_level) | mọi kho | mọi kho |

Fail-closed: user không ACTIVE / không tồn tại → không kho nào; auth-service lỗi → 503, không bao giờ "mọi kho". Cache 30 s; bước xác nhận đọc **fresh** (bỏ cache).

## 2. Hành động và quyền cần có

| Hành động | Quyền chức năng | Quyền kho | Ai kiểm tra |
|---|---|---|---|
| Xem phân tích rebalancing | `analytics.read` (hoặc nhóm analytics) | READ ở mọi kho được phân tích | analytics (route + SQL lọc theo kho) |
| Tạo yêu cầu điều chuyển | WAREHOUSE_MANAGER/ADMIN + `inventory.operation.decide` | **WRITE kho nguồn**, READ kho đích | analytics (nhãn), ai-service executor (fresh), inventory (middleware) |
| Tạo phiếu yêu cầu nhập | `inventory.purchase.request` | WRITE kho nhận | như trên |
| Duyệt / từ chối điều chuyển | `inventory.operation.decide` hoặc `inventory.purchase.approve` | WRITE kho nguồn (fresh) | inventory — **AI không làm** |
| Lấy hàng, xuất kho | task progress | WRITE kho nguồn | inventory — **AI không làm** |
| Nhận hàng | task progress | WRITE kho đích | inventory — **AI không làm** |

## 3. Trạng thái của từng dòng đề xuất

| Trạng thái | Điều kiện | Trong bản nháp |
|---|---|---|
| EXECUTABLE | đủ quyền chức năng + WRITE kho nguồn (điều chuyển) / WRITE kho nhận (mua) | Có |
| COLLABORATIVE | điều chuyển hợp lý nhưng kho nguồn chỉ READ hoặc thiếu quyền chức năng | Chỉ là đề xuất, nêu kho nguồn cần phối hợp |
| PROPOSAL_ONLY | mua cho kho chỉ READ hoặc thiếu quyền mua | Chỉ là đề xuất |
| (không đề xuất) | một đầu nằm ngoài phạm vi đọc | Không xuất hiện |

## 4. Kịch bản kiểm thử quyền

| Kịch bản | Kỳ vọng | Kết quả | Test |
|---|---|---|---|
| Manager một kho FULL | Chỉ phân tích kho đó, SQL không nhận mã kho khác | PASS | analytics `rebalancing-endpoint.test.js` |
| Manager nhiều kho FULL | Phân tích mọi kho, điều chuyển EXECUTABLE | PASS | `rebalancing.test.js`, `warehouse-access.test.js` |
| FULL + READ (demo) | Đọc cả ba; điều chuyển từ Hà Nội là COLLABORATIVE; HYBRID_EXECUTABLE | PASS | endpoint test + Chatbox E2E |
| READ toàn bộ | Chỉ phân tích, không có phương án thực thi | PASS | endpoint test |
| Không có quyền | Kết quả rỗng có thông báo, không đọc tồn kho | PASS | endpoint test |
| Thu hồi quyền khi bản nháp đang chờ | Phần đó bị bỏ qua lúc xác nhận, phần còn lại vẫn chạy | PASS | `test_rebalance_actions.py` |
| Thu hồi quyền giữa phiên (cache) | Xác nhận đọc fresh, không dùng quyền cũ | PASS | `test_warehouse_scope.py` |
| Auth-service lỗi | 503 khi phân tích; không ghi gì khi xác nhận | PASS | endpoint test, actions test |
| Mã kho giả mạo / không tồn tại / ngoài phạm vi | 403 (giống nhau, không lộ kho nào tồn tại) | PASS | endpoint test |
| Kho ngừng hoạt động trong phạm vi | 409 | PASS | `warehouse-access.test.js` |
| Mã kho sai định dạng / SQL injection | 400 | PASS | như trên |
| Xác nhận bản nháp của người khác | Không tìm thấy, không ghi gì | PASS | actions test |
| Gọi thẳng endpoint không có người dùng | 401 (không có đường service key) | PASS | endpoint test |
| Bản nháp xác nhận hai lần / thẻ trùng | Lần hai không tạo gì; thẻ `[AI-REB:<id>#Tn]` đã có → báo "đã tạo trước đó" | PASS | actions test |
| Kết quả không rõ (timeout / 5xx) | RECONCILE_REQUIRED, không tự chạy lại | PASS | actions test |
| Lịch sử hội thoại sau khi bị thu hồi | Kết quả lưu nêu đủ mã kho nguồn / đích / chẩn đoán nên bị che | PASS | actions test (`warehouse_ids_in`) |

## 5. Rủi ro còn lại

- Thu hồi quyền chỉ được báo tức thì cho inventory-service; analytics và ai-service dùng cache 30 s cho thao tác đọc (bước ghi luôn đọc fresh).
- Người tạo yêu cầu điều chuyển vẫn có thể tự duyệt theo workflow hiện tại (không tách nhiệm vụ); AI không bao giờ gọi duyệt.
