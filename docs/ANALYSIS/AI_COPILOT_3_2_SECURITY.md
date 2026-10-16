# SmartBook AI Copilot 3.2 — Phase 2: Security hardening (2026-10-16)

Chỉ sửa các lỗ hổng mà audit ([AI_COPILOT_3_2_AUDIT.md](AI_COPILOT_3_2_AUDIT.md) mục 3) **xác nhận bằng mã hoặc bằng lần gọi
thật**; không dựng lại RBAC. Ký hiệu: **[ĐO]** chạy thật hôm nay · **[UNIT]** test đơn vị · **[CHƯA ĐO]**.

---

## 1. Lỗ hổng đã xác nhận và cách sửa

| # | Lỗ hổng (bằng chứng) | Sửa | File |
|---|---|---|---|
| S1 | **Danh sách inventory không lọc theo kho**: [ĐO] `curator01` (chỉ HCM) nhận 330/500 stock movements và 40/50 phiếu đề xuất nhập của kho khác; `warehouse01` (chỉ HN) thấy picking task của HCM; `curator01` thấy phiếu nhận chuyển kho vào HN | `scopedWarehouseWhere()` (fail-closed: scope rỗng → `in: []`, không bao giờ "tất cả"; `warehouse_id` client gửi chỉ thu hẹp) áp dụng cho stock movements, purchase requests (list + total + phân trang), picking (list, hierarchy, children, detail outbound/transfer), packing (list, detail, history), transfer receiving (theo kho **đích**), outbound queue + detail. Lỗi đọc scope → 503 | `inventory-service/src/utils/warehouse-scope.utils.js`, các controller tương ứng |
| S2 | **Duyệt/từ chối/chuyển PO cho phiếu đề xuất của kho khác**: [ĐỌC MÃ] chỉ kiểm vai trò manager; middleware chỉ xét `warehouse_id` trong body | `requireWarehouseWriteAccess(request.warehouse_id)` trước khi quyết định; chi tiết phiếu của người khác cần quyền **đọc** kho | `purchase-request.controller.js` |
| S3 | **Token đã thu hồi vẫn đọc analytics**: [ĐO] sau `POST /auth/logout`, `/analytics/dashboard/kpis`, `/reorder-suggestions`, `/warehouse-stock-risk` trả **200** (các dịch vụ khác 401) | `authenticateToken` của analytics kiểm `blacklist:token:<jti>` và `user:tokens-valid-after:<sub>` (cùng Redis, cùng khóa); thêm `redis` dependency và `REDIS_URL` | `analytics-service/src/lib/token-revocation.js`, `middlewares/auth.middleware.js`, `docker-compose.yml` |
| S4 | **ai-service fail-open khi `/auth/me` lỗi mạng/timeout**: [ĐỌC MÃ] giải mã JWT **không kiểm chữ ký** và tin `roles/is_superuser/sub` tự khai → token giả mạo đọc lịch sử hội thoại của người khác (claim superuser), hủy action của người khác | `/auth/me` không phản hồi, 5xx hoặc 429 → **503**; xóa hoàn toàn đường giải mã không kiểm chữ ký; tài khoản không `ACTIVE` → 401 | `ai-service/agent_permissions.py` |
| S5 | **Đổi vai trò không thu hồi token**: [ĐỌC MÃ] JWT mang roles/permissions; inventory/analytics/borrow đọc từ JWT → quyền cũ còn hiệu lực tới khi hết hạn (2 giờ) | đổi `role_ids/role_codes` của người dùng, hoặc đổi quyền của một vai trò → `revokeUserTokensIssuedBefore` cho người dùng đó / mọi người giữ vai trò | `auth-service/src/controllers/iam.controller.js` |
| S6 | **Cache kết quả tool của AI không phân vùng theo quyền/scope**: [ĐỌC MÃ] khóa = (endpoint, Authorization, params), TTL 60 s → cùng token sau khi bị thu hồi quyền kho vẫn nhận dữ liệu cũ | khóa thêm **fingerprint** = sha256(user, roles, permissions, superuser, kho đọc được hiện tại); scope không đọc được → không cache | `copilot_tools.CACHE_PARTITION`, `main._access_fingerprint` |
| S7 | **Cache câu trả lời không xét quyền chức năng**: khóa theo hội thoại; chỉ kiểm lại scope kho | khóa thêm cùng fingerprint; không có fingerprint → không dùng cache | `main._assistant_cache_key`, `_start_assistant_turn` |
| S8 | **Lịch sử hội thoại**: (a) lượt bị che vẫn trả `extras.verification` (chứa tên kho và số liệu) — bắt được nhờ test 3.1 `test_history_is_masked…` khi thêm 3.2; (b) người đã mất quyền dùng trợ lý vẫn đọc lại số liệu toàn thư viện đã lưu | (a) extras của lượt bị che dựng lại từ **allow-list**; (b) mọi câu trả lời được che khi người đọc không còn qua cổng trợ lý; câu hỏi của chính họ vẫn hiện | `routes_conversations.py` |
| S9 | **AI Action `override_payload` merge mọi khóa** (thay được `items`, cờ `warehouse_resolution_status`…) và không kiểm lại scope lúc xác nhận | allow-list khóa theo loại action; `items` chỉ được giữ/bỏ **dòng đã đề xuất** và đổi số lượng (1–1000); dòng giữ nguyên mọi trường khác của đề xuất; kiểm **quyền ghi** của mọi kho đích lúc xác nhận (scope không đọc được → 503, action vẫn chờ) | `ai-service/action_guard.py`, `main.confirm_action` |
| S10 | **Pending action tạo cả khi câu trả lời bị thay thế** | không tạo khi verification BLOCKED | `main._finalize_assistant_turn` |

## 2. Phạm vi kho (warehouse scope)

```mermaid
flowchart TD
  R[GET danh sách] --> W{warehouse_id trong query?}
  W -- có --> G[enforceRequestedWarehouseScope: không đọc được → 403]
  G --> N[where = {warehouse_id}]
  W -- không --> S[scopedWarehouseWhere]
  S --> SU{superuser?}
  SU -- có --> ALL["where = {} (chính sách superuser)"]
  SU -- không --> RD[auth /internal/users/:id/warehouse-scopes, TTL 30 s]
  RD -- lỗi --> E503[503, không có dòng nào]
  RD -- ok --> IN["where = {warehouse_id: {in: kho đọc được}}<br/>rỗng → không có dòng"]
  N & IN & ALL --> Q[findMany + count + skip/take trên CÙNG where]
```

- Đếm, phân trang, sắp xếp đều chạy trên dữ liệu đã lọc (total của purchase requests = số dòng trong scope).
- Chuyển kho hợp lệ vẫn chạy: picking/outbound của transfer theo kho **nguồn**, nhận chuyển kho theo kho **đích**
  (test `transfer receiving: only transfers INTO…`). Ghi vẫn do middleware 3.1 kiểm (`from` cần quyền ghi, `to` cần quyền đọc).
- Định danh kho luôn là id, không phải tên.
- Analytics: endpoint có dòng theo kho dùng `attachWarehouseScope` (3.1). KPI tổng quan, đề xuất nhập, top sách, xu hướng mượn
  là **tổng toàn thư viện theo chính sách** (không có trường kho) — được kiểm soát bằng quyền chức năng; AI 3.2 gắn nhãn
  "toàn hệ thống" và bắt lỗi nhầm toàn hệ thống ↔ một kho (Phase 1).

## 3. Xác thực, thu hồi, cache

| Tình huống | Trước | Sau |
|---|---|---|
| Token đã logout gọi `/analytics/*` | 200 + dữ liệu [ĐO] | 401 (unit; chạy thật: mục 6) |
| Đổi vai trò / đổi quyền vai trò | token cũ giữ quyền cũ ≤ 2 giờ | token cũ 401 ở mọi dịch vụ kiểm `tokens-valid-after` |
| auth/gateway không phản hồi khi AI gọi `/auth/me` | giải mã JWT không kiểm chữ ký | 503 |
| `/auth/me` trả 502/504/429 | 401 | 503 (không phải "token sai") |
| Tài khoản LOCKED/INACTIVE | bị chặn nhờ thu hồi token (nếu Redis hoạt động) | thêm: `/auth/me` trả status ≠ ACTIVE → 401 |
| Cache tool AI sau khi thu hồi quyền kho | ≤ 60 s dữ liệu cũ | key đổi khi scope đổi (scope đọc lại tối đa mỗi 30 s) |
| Cache câu trả lời sau khi đổi quyền chức năng | phục vụ lại | trả lời lại |

Độ trễ hiệu lực sau khi thu hồi: token (logout/khóa/đổi vai trò) — ngay lập tức với các dịch vụ kiểm Redis; scope kho — tối đa
30 s (TTL resolver, không đổi).

## 4. AI Actions

| Kiểm tra | Nơi | Trạng thái |
|---|---|---|
| Xác thực (`/auth/me`, fail-closed) | `get_user_context` | [UNIT] |
| Chủ sở hữu action (superuser được phép theo chính sách) | `confirm_action` (có từ trước) | [UNIT] |
| Quyền xác nhận theo loại action (vai trò/quyền đọc mới từ auth) | `require_can_confirm_action` | có từ trước |
| Human-in-the-loop | action chỉ là đề xuất; thực thi khi người dùng xác nhận | có từ trước |
| Idempotency + giao dịch | claim nguyên tử `mark_action_confirmed`; `Idempotency-Key` cho reservation | có từ trước |
| Override chỉ ở trường được phép, dòng đã đề xuất, số lượng 1–1000 | `action_guard.validated_override` | [UNIT] mới |
| Quyền **ghi** mọi kho đích lúc xác nhận; scope không đọc được → 503, action vẫn chờ | `action_guard.require_write_scope` | [UNIT] mới |
| Dịch vụ đích kiểm lại quyền + scope bằng token người dùng | inventory/borrow | có từ trước |
| Audit trail (confirmed/executed/failed/cancelled + actor) | `agent_store` | có từ trước |
| Bộ kiểm tra không bao giờ thực thi action; câu trả lời BLOCKED không có action | `_finalize_assistant_turn` | [UNIT] mới |

## 5. Test hồi quy bảo mật (mỗi test khẳng định **không có dữ liệu rò**, không chỉ mã trạng thái)

| Kịch bản yêu cầu | Test |
|---|---|
| Manager có kho A, không có B | `warehouse-scope-lists.test.js` (stock movements, purchase requests, packing, transfer receiving); `copilot-3-2-security-integration.mjs` #1–#3 |
| Id kho ngoài phạm vi | `…lists.test.js` "naming another warehouse…"; integration #4 |
| Không truyền id kho | `…lists.test.js` "no warehouse given never widens"; integration #1 |
| Output tool nhiều kho / tổng hợp ngoài phạm vi | integration #1, #3 (total), #8 (AI) ; `test_warehouse_scope.py` (3.1) |
| Người dùng bị thu hồi | `test_copilot_security.py::test_a_revoked_user_reaches_no_tool`, `test_revoked_or_inactive_user_is_refused`; analytics `auth-middleware.test.js`; integration #6, #7 |
| Cache từ trước khi thu hồi | `test_tool_cache_is_not_shared_across_access`, `test_cached_answer_is_not_served_after_a_permission_change`, `test_cached_answer_is_not_served_after_revocation` (3.1) |
| Hội thoại của người khác | `test_another_users_conversation_is_refused_without_content`; integration #9 |
| Snapshot mất scope | `test_masked_turns_carry_no_check_details`, `test_history_is_masked…` (3.1), `test_a_reader_who_lost_the_assistant_sees_no_old_figures` |
| Auth service down | `test_auth_unreachable_never_trusts_a_forged_token`, `test_auth_errors_are_unavailable_not_valid`, `…lists.test.js` 503 |
| Permission/scope service lỗi | `test_scope_service_down_disables_the_cache`, `test_scope_unreadable_keeps_the_action_pending`, `scopedWarehouseWhere: fail-closed shapes` |
| AI action vượt quyền | `ActionConfirmationTests` (khóa lạ, dòng mới, số lượng 0/50000, kho ngoài scope, action của người khác) |
| Superuser hợp lệ | `test_superuser_reads_history_under_the_superuser_policy`, `test_superuser_may_confirm_any_warehouse`, `…lists.test.js` (admin thấy mọi kho) |
| Đổi vai trò → thu hồi | `auth-service/test/iam-token-revocation.test.js`; integration #7 |

## 6. Kết quả chạy (2026-10-16, Windows + stack Docker)

| Nhóm | Kết quả |
|---|---|
| `scripts/copilot-3-2-security-integration.mjs --ai` (mới) | **10/10** [ĐO]. Lần chạy đầu 9/10: kiểm tra #6 bắt được analytics vẫn trả 200 cho token đã logout ngay sau khởi động — client Redis kết nối lười nên các request đầu bỏ qua kiểm tra; đã sửa (kết nối khi khởi động + chờ kết nối có giới hạn 2 s) và chạy lại |
| `warehouse-scope-integration.mjs --ai` | 8/8 |
| `rbac-role-access-integration.mjs` | 98/98 |
| `analytics-integration.mjs` | 7/7 (+1/1 access) |
| `purchase-supplier-receiving-integration.mjs` | 13/13 |
| `admin-user-management-integration.mjs` | 14/14 |
| `ai-assistant-integration.mjs` | 8/8 (1 WARN "best-effort", phụ thuộc LLM, không tính) |
| Playwright E2E (Chromium cục bộ) | 28/28 (27 cũ + 1 mới) — gồm luồng nhân viên purchase → putaway và reservation → pickup → return chạy dưới lọc phạm vi kho mới |
| inventory unit | 185/185 (thêm `warehouse-scope-lists.test.js` 8) |
| analytics unit | 125 pass, 3 skip (cần Postgres) |
| auth unit | 8/8 (thêm `iam-token-revocation.test.js` 3) |
| ai-service `pytest` | 992 passed, 8 skipped (thêm `test_copilot_security.py` 20) |
| `pnpm verify` | **exit 0** |
| GitHub Actions | **chưa chạy** (không push theo yêu cầu) |

## 7. Ảnh hưởng độ trễ của cache phân vùng [ĐO]

Fingerprint (`_access_fingerprint`) đo trong container ai-service, người dùng không phải superuser, 20 lần:
lần đầu (gọi auth `/internal/users/:id/warehouse-scopes`) p50 **16,4 ms**, p95 24,4 ms — tối đa một lần mỗi 30 s mỗi người dùng
(TTL resolver); khi đã cache p50 0,01 ms. Superuser: không gọi auth. Cache tool vẫn gộp các lệnh đọc trùng trong cùng lượt.
Đổi lại: sau khi quyền/scope đổi, lượt kế tiếp đọc lại dữ liệu (cache miss) thay vì nhận bản cũ.

## 8. Rủi ro còn lại

1. **Redis không khả dụng → kiểm tra thu hồi bị bỏ qua** ở mọi dịch vụ (wrapper trả `null`). Chuyển sang fail-closed sẽ khóa toàn hệ
   thống khi Redis lỗi — cần quyết định vận hành, ghi vào Future Work.
2. Các endpoint chi tiết khác của inventory (stock-audit, staff-task, exception-report, putaway, receiving-smart, order-request…)
   chưa được rà theo kho trong đợt này; chỉ các nhóm audit xác nhận đã được sửa.
3. Tổng toàn thư viện (KPI, đề xuất nhập, top sách, xu hướng mượn) vẫn hiện cho người có quyền chức năng nhưng chỉ có một phần kho —
   đúng chính sách hiện tại, nhưng là thông tin tổng hợp vượt phạm vi kho.
4. Superuser đọc được hội thoại của người khác (chính sách sẵn có, chỉ đọc).
5. Thu hồi scope kho có độ trễ ≤ 30 s (TTL resolver).
6. Thay đổi quyền của một vai trò thu hồi token của **mọi** người giữ vai trò đó (họ phải đăng nhập lại) — chủ đích, nhưng ảnh hưởng
   trải nghiệm.
7. `/chat` (trợ lý hội thoại cũ, khác `/assistant`) không thuộc phạm vi 3.2; action do `/chat` đề xuất vẫn qua cùng `action_guard`
   lúc xác nhận, nhưng không có bước verification câu trả lời.

## 9. Tái lập

```bash
set -a; . ./.env; set +a
node scripts/copilot-3-2-security-integration.mjs --ai
node scripts/warehouse-scope-integration.mjs --ai
node scripts/rbac-role-access-integration.mjs
python -m pytest services/ai-service/test_copilot_security.py -q
node --test services/inventory-service/test/warehouse-scope-lists.test.js
```
Lưu ý môi trường: chạy nhiều lần liên tiếp chạm giới hạn 600 request/15 phút của gateway → `docker restart smartbook-system-api-gateway-1`.
Kiểm tra #7 gán lại **cùng** vai trò cho `curator01` (không đổi dữ liệu) để kích hoạt mốc thu hồi; phiên cũ của `curator01` bị đăng xuất.

## 10. Future Work (ngoài phạm vi 3.2)

Redis fail-closed có phương án dự phòng; rà soát theo kho cho các endpoint inventory còn lại; tách KPI/đề xuất nhập theo kho (đổi mô
hình/thuật toán — ngoài phạm vi); giới hạn tần suất theo người dùng thay vì theo IP cho các lệnh gọi nội bộ ai-service → gateway.
