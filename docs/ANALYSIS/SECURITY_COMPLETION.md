# SmartBook — Hoàn thiện bảo mật (Phase 5, 2026-10-18)

Ký hiệu: **[ĐO]** đã chạy trên stack thật (docker compose, dữ liệu demo) · **[UNIT]** test tự động không cần stack ·
**[CÒN RỦI RO]** chưa giải quyết, ghi rõ ở mục 7.

Tài liệu trước: [AI_COPILOT_3_2_SECURITY.md](AI_COPILOT_3_2_SECURITY.md).

---

## 0. Tóm tắt

| Hạng mục | Trước Phase 5 (đo/đọc mã) | Sau Phase 5 |
|---|---|---|
| Redis không truy cập được | Token **đã đăng xuất** được mọi service chấp nhận, **kể cả thao tác ghi**; `/auth/me` treo 20 s; sau khi Redis khởi động lại, kiểm tra thu hồi **tắt vĩnh viễn** đến khi restart service [ĐO] | Thu hồi đã thấy được giữ; đọc tiếp tục (gắn cờ), **ghi bị từ chối 503**; Redis về là kiểm tra hoạt động lại ngay [ĐO] |
| Đăng xuất / đổi mật khẩu / khóa khi Redis hỏng | Ghi thu hồi bị mất im lặng | Xếp hàng và ghi lại khi Redis về; logout báo `token_revocation: PENDING` [ĐO] |
| Phạm vi kho — 6 module | stock-audit, staff-task, exception-report, putaway, receiving-smart, order-request **không gọi kiểm tra phạm vi** khi thao tác theo ID: quản lý kho A duyệt được kiểm kê kho B (ghi điều chỉnh tồn), duyệt yêu cầu xuất kho B, xác nhận putaway kho B… | Kho lấy từ bản ghi đã lưu; đọc cần quyền đọc, thay đổi cần quyền ghi, bước xác nhận đọc lại phạm vi **không qua cache** [ĐO 9/9] |
| Tin client | receiving-smart lấy `user_id` trong body làm người tạo/người nhận; sửa dòng của draft khác qua ID | Dùng người dùng đã xác thực; chỉ sửa dòng thuộc draft trong đường dẫn |
| Analytics | Không nói số liệu là toàn thư viện hay theo phạm vi kho | `meta.data_scope` + header `X-Data-Scope`; ý nghĩa số liệu giữ nguyên |
| `/chat` cũ | Nuốt lỗi xác thực → chạy như ẩn danh; **token đã đăng xuất hỏi lại câu cũ nhận câu trả lời từ cache** | Có header thì xác thực như `/assistant` (401/503); không header vẫn ẩn danh như cũ [ĐO] |

## 1. Thu hồi token khi Redis không sẵn sàng

### 1.1 Hiện trạng đo được (trước khi sửa) [ĐO]

`scripts` tạm `revocation_probe.py`: đăng nhập `hung` hai lần, đăng xuất token A, gọi 7 endpoint (đọc + ghi vô hại, body rỗng
→ token được chấp nhận sẽ nhận 400/404, không tạo bản ghi) với A (đã đăng xuất) và B (hợp lệ):

| Thời điểm | Token đã đăng xuất A | Nhận xét |
|---|---|---|
| Redis chạy | 401 ở cả 7 | đúng |
| Redis dừng 3 s | `/auth/me` treo 20 s; inventory/borrow/analytics/ai **200**; POST phiếu nhập **400** (đã qua xác thực) | fail-open, cả ghi |
| Redis dừng 45 s | 200 mọi nơi | |
| Redis chạy lại +15 s, +60 s | **vẫn 200**; log `[Redis] Get error: The client is closed` | client bỏ kết nối lại sau 10 lần thử (~30 s) → tắt kiểm tra vĩnh viễn |

Nguyên nhân: mỗi service đọc khóa thu hồi qua wrapper trả `null` khi có **bất kỳ** lỗi nào ("không kết nối được" = "không bị
thu hồi"); `reconnectStrategy` trả `Error` sau 10 lần; hàng đợi offline của node-redis làm lệnh treo khi mất kết nối.

### 1.2 Thiết kế

- `packages/shared/runtime/token-revocation.cjs` (dùng chung cho auth, inventory, borrow, analytics): kết quả ba trạng thái
  `REVOKED / VALID / UNKNOWN`. Lỗi hoặc quá 300 ms → UNKNOWN, không bao giờ là VALID.
- **Fallback có giới hạn:** một lần đã thấy bị thu hồi thì giữ mãi (đăng xuất không thể "bỏ"; mốc `tokens-valid-after` chỉ tăng
  nên mốc cũ vẫn thu hồi đúng những gì nó đã thu hồi); một câu trả lời VALID chỉ được dùng lại ≤ 60 s; sau đó UNKNOWN.
- **Chính sách khi UNKNOWN** (`revocationGuard`): GET/HEAD/OPTIONS đi tiếp với header `X-Token-Revocation-Check: unverified`;
  POST/PUT/PATCH/DELETE → **503** `REVOCATION_UNVERIFIED`. `REVOCATION_UNKNOWN_POLICY=deny-all` từ chối cả đọc. Riêng
  `/auth/logout` được phép (chỉ làm giảm quyền).
- auth-service tự ghi nhớ các thu hồi do chính nó tạo (logout, đổi mật khẩu, khóa, đổi vai trò) vào bộ nhớ đệm của checker.
- Ghi thu hồi thất bại → hàng đợi trong tiến trình, thử lại mỗi 5 s đến khi thành công hoặc token hết hạn.
- Redis client (auth/inventory/borrow/analytics): trước kết nối đầu tiên vẫn bỏ sau ~5 s (để `await connect()` không treo) rồi thử
  lại nền bằng timer `unref`; **sau khi đã kết nối thì thử lại mãi**; `disableOfflineQueue` để lệnh lỗi ngay.
- ai-service: `/auth/me` trả header `unverified` → `UserContext.revocation_verified = false` → **xác nhận AI Action bị từ chối
  503** (action vẫn PENDING). Ghi xuống service khác dùng token người dùng nên cũng bị 503 ở đó.

### 1.3 Sau khi sửa [ĐO]

| Thời điểm | Token A đã đăng xuất | Token B hợp lệ |
|---|---|---|
| Redis chạy | 401 ×7 | đọc 200, ghi 400 (qua xác thực) |
| Redis dừng 3 s | 401 ×7 | đọc 200, ghi 400/404 (VALID còn trong 60 s) |
| Redis dừng 75 s | **401 ×7** | đọc 200 (`unverified`), **ghi 503** |
| Redis chạy lại +10 s | 401 ×7 | đọc 200, ghi 400 — không treo, độ trễ 7–40 ms |

Đăng xuất **trong lúc** Redis dừng (`logout_outage.py`): `200, token_revocation: PENDING`; trong lúc dừng token đó đọc 200 /
ghi 503; **5 s sau khi Redis về**, log `queued revocation written` và token bị 401 ở inventory và `/auth/me`.

## 2. Phạm vi kho — 6 module inventory

Middleware `enforceRequestedWarehouseScope` chỉ kiểm tra ID kho **client tự nêu** ở cấp cao nhất (path/query/body). Các thao tác
theo ID bản ghi không có kiểm tra nào. Đã sửa (kho luôn lấy từ bản ghi đã lưu; `requireWarehouse{Read,Write}Access`,
`scopedWarehouseWhere`; `{ fresh: true }` đọc lại phạm vi bỏ qua cache 30 s ở bước xác nhận):

| Module | Lỗ hổng | Sửa |
|---|---|---|
| stock-audit | danh sách/chi tiết không lọc; gán, nhập số, nộp, **duyệt (ghi điều chỉnh tồn)**, hủy không kiểm tra | lọc danh sách; đọc để xem; ghi để thay đổi; duyệt = ghi + `fresh` |
| staff-task | quản lý thấy/sửa task mọi kho; `entity-options` liệt kê bản ghi mọi kho; người được giao và bản ghi liên kết không đối chiếu kho | lọc theo kho (task không kho: chỉ của mình); ghi để sửa; người được giao phải có quyền đọc kho; bản ghi liên kết phải thuộc kho đọc được |
| exception-report | danh sách/chi tiết/gán/**giải quyết** không lọc; `goods_receipt_id` có thể của kho khác | lọc; đọc/ghi; giải quyết = ghi + `fresh`; phiếu nhập phải cùng kho; người được giao phải có quyền |
| putaway | danh sách/chi tiết/vị trí/nhận/giao/**xác nhận (di chuyển tồn)** không kiểm tra (vị trí đã bị giới hạn theo kho — tốt) | lọc; đọc; ghi; xác nhận = ghi + `fresh`; người được giao phải có quyền |
| receiving-smart | danh sách/chi tiết/sửa/**chuyển thành phiếu nhập**/hủy không kiểm tra; `user_id` từ body làm người tạo & người nhận; sửa dòng của draft khác | lọc; đọc/ghi; chuyển = ghi + `fresh`; người tạo/nhận = người đã xác thực; `updateMany` theo `(id, draft_id)` |
| order-request | hàng chờ duyệt liệt kê mọi kho; **duyệt/từ chối** không kiểm tra (tạo mới thì đúng: vị trí xuất đã kiểm tra theo kho) | lọc hàng chờ; duyệt/từ chối = ghi kho nguồn + `fresh` |

## 3. Phạm vi dữ liệu analytics

Không đổi ý nghĩa số liệu nào. Mỗi route khai báo phạm vi (`src/middlewares/data-scope.middleware.js`):

- `WAREHOUSE_SCOPED` (đã lọc theo phạm vi kho từ 3.2): aging-inventory, warehouse-stock-risk, warehouse-stock-items,
  weeding-suggestions.
- `SYSTEM` (toàn thư viện, có chủ đích): dashboard/kpis, borrow-trends, top-books, book-turnover, catalog-signals,
  overdue/fine summary, reservation funnel/no-show, late-return-risk, forecast-accuracy, **reorder-suggestions** (danh sách mua
  hàng tập trung; lượt mượn không gắn với một kho). Các endpoint này chỉ trả tổng hợp toàn hệ thống, không có dòng theo từng kho
  ngoài phạm vi.

## 4. Endpoint `/chat` cũ

Giữ (UI `apps/web/src/services/ai.ts` vẫn gọi) nhưng thêm `_legacy_chat_user`: không header → ẩn danh như cũ (FAQ/danh mục);
có header → xác thực qua `/auth/me` như `/assistant` (401 phiên không hợp lệ/đã đăng xuất/bị khóa, 503 khi không xác minh
được) **trước** khi đọc cache, phân loại ý định hay truy xuất. Áp dụng cho cả `/chat` và `/chat/stream`.

## 5. Kiểm thử

### 5.1 Tự động [UNIT]

| Gói | Kết quả | Mới |
|---|---|---|
| `packages/shared` | 28 pass | 9 test thu hồi (VALID/REVOKED, lỗi = UNKNOWN, timeout, giữ thu hồi đã thấy, mốc cũ, VALID ≤ 60 s, Redis về, chính sách guard, logout), 1 test `fresh` |
| auth-service | 11 pass | hàng đợi ghi thu hồi (logout khi Redis hỏng, mốc chỉ tăng, hết hạn bị bỏ) |
| inventory-service | 185 pass | (tất cả test cũ; 2 file test trước bị treo vì Redis client — đã sửa) |
| borrow-service | 143 pass | |
| analytics-service | 133 pass | Redis hỏng: đọc qua (gắn cờ), ghi 503; khai báo data scope |
| ai-service | 1072 pass, 8 skip | `/auth/me` unverified → không xác nhận được action; `/chat` + `/chat/stream`: token thu hồi 401 trước cache, auth hỏng 503, không header ẩn danh |

### 5.2 Tích hợp trên stack thật [ĐO]

`node scripts/security-phase5-integration.mjs [--redis]` — kiểm tra **dữ liệu trả về**, không chỉ mã trạng thái; fixture do
superuser tạo trong BR-HCM-02 (gắn `PHASE5-TEST`) và được đóng lại ở cuối:

| # | Kiểm tra | Kết quả |
|---|---|---|
| 1 | Token giả (claim superuser, sai khóa) không lấy được dữ liệu ở 5 service | ok |
| 2 | manager01 (không có BR-HCM-02): danh sách kiểm kê không có BR-HCM-02; mở/duyệt/hủy 403; superuser mở được | ok |
| 3 | curator01 (READ HCM): mở được kiểm kê HCM, duyệt 403, trạng thái không đổi | ok |
| 4 | staff task BR-HCM-02 không hiện, sửa 403 | ok |
| 5 | exception report BR-HCM-02: không liệt kê, mở/gán/giải quyết 403; vẫn OPEN, chưa gán | ok |
| 6 | putaway BR-HCM-02: không liệt kê; chi tiết/vị trí/xác nhận 403 | ok |
| 7 | smart receiving: người tạo = người gọi (bỏ `user_id` trong body) | ok |
| 8 | smart receiving BR-HCM-02: liệt kê/mở/sửa/chuyển/hủy bị từ chối; vẫn DRAFT | ok |
| 9 | yêu cầu xuất BR-HCM-02 không có trong hàng chờ của manager01; duyệt 403; vẫn PENDING_APPROVAL | ok |
| 9b | `/ai/chat`: token đã đăng xuất hỏi lại câu cũ → 401, không có `reply` | ok |
| 9c | analytics khai báo `SYSTEM` / `WAREHOUSE_SCOPED`; stock-risk của curator01 chỉ có Kho HCM Chinh | ok |
| 10 | Redis dừng: token đăng xuất trước sự cố bị 401 ở auth, AI, inventory; service chưa từng thấy thu hồi trả đọc 200 (`unverified`), ghi 401 | ok (rủi ro còn lại, mục 7) |
| 11 | Redis dừng: token hợp lệ đọc 200 `unverified`, ghi 503 `REVOCATION_UNVERIFIED` | ok |
| 12 | Redis dừng: logout vẫn được, báo PENDING | ok |
| 13 | Redis về: logout trong sự cố được áp dụng (401) | ok |

Kết quả lần chạy cuối (2026-10-18): **11/11** không `--redis`, **15/15** với `--redis`.

Script có sẵn, chạy lại sau thay đổi: `warehouse-scope-integration.mjs` **7/7**, `copilot-3-2-security-integration.mjs` **8/8**
(token đã đăng xuất ở mọi nơi kể cả analytics; đổi vai trò kết thúc phiên cũ; lịch sử AI của người khác bị từ chối không lộ nội
dung; AI chỉ trả kho trong phạm vi).

Ánh xạ yêu cầu: người dùng một kho → `warehouse-scope-integration` #2/#3 + phase5 #3; quyền bị thu hồi → phase5 #3 (READ không
ghi) + test `fresh`; token đã đăng xuất → 3.2 #6, phase5 #10/#13; token giả → phase5 #1; đổi vai trò giữa lúc tạo và xác nhận AI
Action → 3.2 #7 (phiên cũ bị thu hồi) + unit `test_out_of_scope_warehouse_is_refused_at_confirm_time` (quyền ghi bị gỡ sau đề
xuất → 403, action vẫn PENDING); khác kho → phase5 #2–#9; Redis không sẵn sàng → phase5 #10–#13; cache sau khi đổi quyền →
unit `test_cached_answer_is_not_served_after_a_permission_change` + `fresh`; lịch sử AI người khác → 3.2 #9.

## 6. Đánh đổi

- **Đọc vẫn được khi chưa xác minh được thu hồi.** Chọn tính sẵn sàng cho thao tác chỉ đọc (thủ thư vẫn tra cứu được khi Redis
  hỏng); mọi thay đổi dữ liệu bị chặn. Môi trường cần chặt hơn đặt `REVOCATION_UNKNOWN_POLICY=deny-all`.
- Giữ lại câu trả lời VALID 60 s: một token bị thu hồi **ngay trước** sự cố mà service đó chưa thấy có thể đọc thêm ≤ 60 s rồi
  chuyển sang "đọc gắn cờ / ghi bị chặn".
- Bước xác nhận đọc lại phạm vi kho không qua cache: thêm một lời gọi nội bộ tới auth-service (~10–30 ms) cho mỗi lần duyệt.

## 7. Rủi ro còn lại (chưa giải quyết)

1. **[CÒN RỦI RO]** Khi Redis hỏng, một service **chưa từng** thấy token bị thu hồi vẫn phục vụ **đọc** cho token đó (đo:
   analytics trả 200 `unverified`). Ghi bị chặn; auth-service và ai-service từ chối.
2. **[CÒN RỦI RO]** Hàng đợi ghi thu hồi nằm trong bộ nhớ auth-service: nếu auth-service khởi động lại trong lúc Redis hỏng, các
   thu hồi chưa ghi bị mất (token vẫn hết hạn sau `JWT_EXPIRES_IN`, mặc định 2 giờ).
3. Gateway không kiểm tra thu hồi; mỗi service tự kiểm tra (đã đủ cho mọi route `/api`, `/borrow`, `/analytics`, `/ai`, `/auth`).
4. Phạm vi kho cache 30 s cho thao tác thường (không phải bước xác nhận): quyền bị gỡ có hiệu lực trong ≤ 30 s.
5. Các module inventory **ngoài** 6 module trên chưa được rà lại lần này (14 controller đã dùng helper từ 3.2).
6. staff-task không kho (`warehouse_id = null`) chỉ hiện cho người giao/người được giao — người quản lý khác không còn thấy
   (thay đổi hành vi có chủ đích).
7. Không có kiểm thử tải cho kiểm tra phạm vi `fresh`.

## 8. File

- Mới: `packages/shared/runtime/token-revocation.cjs`, `packages/shared/test/token-revocation.test.cjs`,
  `services/analytics-service/src/middlewares/data-scope.middleware.js`, `services/auth-service/test/token-revocation-queue.test.js`,
  `scripts/security-phase5-integration.mjs`.
- Sửa: `packages/shared/runtime/warehouse-scope.cjs` (`fresh`), `packages/shared/package.json` (export), Redis client và
  `auth.middleware.js` của auth/inventory/borrow, `analytics-service/src/lib/token-revocation.js`, `analytics.routes.js`,
  `auth-service/src/lib/token-revocation.js`, `auth.controller.js` (logout), `inventory-service/src/utils/warehouse-scope.utils.js`,
  6 controller inventory, ai-service `agent_schemas.py`, `agent_permissions.py`, `main.py` (`/actions/confirm`, `/chat`).
