# AI Inventory Rebalancing & Procurement Decision — Phase 0 Audit

Ngày audit: **20/11/2026**. Phạm vi: chỉ đọc code và dữ liệu dev cục bộ (truy vấn `SELECT`), **không sửa file code nào**.

## 0. Trạng thái Git khi audit

| Mục | Giá trị |
|---|---|
| Branch | `hungg` |
| HEAD | `12e79ccf05d38f84a8057e44f798c84c053166fb` — `fix(ai): resolve the remaining audit findings E-3..E-18, S-1..S-4, D-1, D-2` |
| Thay đổi chưa commit | Không có file đã theo dõi bị sửa. Hai file chưa theo dõi: `apps/web/public/__tmp_enrich.json`, `docs/tasks/SMARTBOOK_CLAUDE_HANDOFF.md` (không đụng tới) |
| Stash | `stash@{0}: WIP on khoa: def77d4` (không đụng tới) |
| Commit gần nhất | `12e79cc`, `f872262`, `48b3540`, `364bdbf`, `640b2db`, `e613a34`, `b95c149`, `1c3def4`… |

Không reset/revert/checkout gì. File này là file duy nhất được tạo.

---

## 1. Kiến trúc hiện tại (luồng liên quan)

```
Web Chatbox (apps/web/src/components/ai-chatbot.tsx, services/ai.ts)
   │  POST /assistant/stream (SSE: token, status{stage:"verifying"}, done)
   ▼
API Gateway ──► ai-service (FastAPI, main.py)
                 ├─ _start_assistant_turn: xác thực user (agent_permissions.get_user_context),
                 │   cache partition = user + quyền + warehouse scope hiện tại
                 ├─ copilot_plan.build_plan (luật, tiếng Việt bỏ dấu, sửa chính tả)
                 │   └─ copilot_semantic_planner.plan_turn (LLM → JSON → validate → reconcile)
                 ├─ tool loop: copilot_tools.py (9 tool) + assistant_tools.py
                 │   └─ gọi analytics/inventory qua gateway bằng token của user
                 ├─ copilot_verification / copilot_claims / number_grounding (đối chiếu số liệu)
                 ├─ copilot_decision.build (decision object cho reorder/what-if)
                 └─ _build_assistant_pending_action → CREATE_REORDER_DRAFT
                       └─ /actions/confirm → agent_executor → POST /api/purchase-requests
analytics-service (Node, SQL thẳng tới inventory_db + borrow_db, chỉ đọc)
inventory-service (Prisma, inventory_db) — transfer, PR, PO, stock
auth-service — user_warehouse_scopes, GET /internal/users/:id/warehouse-scopes
```

Nguyên tắc đã có và phải giữ: LLM không chọn endpoint/SQL; số liệu do analytics tính; tool gọi API bằng token người dùng nên phạm vi kho được áp ở service đích; hành động ghi luôn qua pending action + xác nhận.

## 2. Nghiệp vụ đã có

### 2.1. Quyền kho (Warehouse Scope)

| Thành phần | Hiện trạng |
|---|---|
| Nguồn sự thật | `auth_db.user_warehouse_scopes(user_id, warehouse_id, access_level)`; `access_level` ∈ `READ, READ_ONLY, WRITE, OPERATOR, FULL` (`services/auth-service/src/lib/warehouse-assignment.js:17`). |
| Mức đọc / ghi | `READ_LEVELS = READ, READ_ONLY, WRITE, OPERATOR, FULL`; `WRITE_LEVELS = WRITE, OPERATOR, FULL` — giống nhau ở `packages/shared/runtime/warehouse-scope.cjs`, `services/ai-service/warehouse_scope.py`. |
| SUPERUSER | **Không phải access_level**: là claim `is_superuser` (JWT hoặc body nội bộ) → mọi kho. |
| Fail-closed | Không có dòng scope / user không ACTIVE / 404 → không kho nào; auth-service lỗi/thiếu `INTERNAL_SERVICE_KEY` → `WarehouseScopeUnavailableError` (503) ở Node, `ScopeUnavailable` ở Python. |
| Cache | 30 s theo user ở cả ba nơi. Tùy chọn `fresh: true` (Node) cho bước xác nhận (approve transfer, claim, confirm…). |
| Invalidation | auth-service gọi `POST /internal/warehouse-scopes/invalidate` **chỉ tới inventory-service** (`services/auth-service/src/lib/warehouse-directory.js:52`). analytics-service và ai-service chỉ dựa vào TTL 30 s. |
| Inventory | `enforceRequestedWarehouseScope`: GET cần read cho mọi `warehouse_id` khách gửi; ghi cần **write** cho `warehouse_id / from_warehouse_id / source_warehouse_id`, chỉ cần **read** cho `to_warehouse_id / destination_warehouse_id`. `requireRecordWarehouse` lấy kho từ bản ghi, không từ client. |
| Analytics | `attachWarehouseScope` → `req.warehouseScope` (Set read) cho route `WAREHOUSE_SCOPED`; route `SYSTEM` không lọc. |
| AI | Live data: scope do service đích áp. Dữ liệu lưu (lịch sử, snapshot, cache câu trả lời) bị che khi kho không còn đọc được (`warehouse_scope.can_view`). Cache tool partition theo scope (`copilot_tools.CACHE_PARTITION`). Confirm: kiểm tra chủ sở hữu action, quyền role/permission theo config hiện tại, và write scope (`action_guard.require_write_scope`). |

### 2.2. Tồn kho & điều chuyển

- `stock_balances` theo (variant, location): `on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point`.
- Vòng đời transfer (`transfer_orders`, push từ kho nguồn):

| Bước | Endpoint | Quyền chức năng | Quyền kho |
|---|---|---|---|
| Tạo yêu cầu → `REQUESTED` | `POST /api/order-requests/transfer` | `authorizeManagerDecision(['inventory.operation.decide'])` (WAREHOUSE_MANAGER/ADMIN) | **WRITE kho nguồn**, READ kho đích |
| Duyệt/Từ chối → `APPROVED` / `CANCELLED` | `POST /api/order-requests/transfer/:id/approve|reject` | `inventory.operation.decide` hoặc `inventory.purchase.approve` | WRITE kho nguồn, đọc **fresh** |
| Picking → `PICKING` | picking routes | task progress | WRITE kho nguồn (theo bản ghi) |
| Xuất kho → `IN_TRANSIT` | `POST /api/outbound/orders/transfer/:id/confirm` | task progress | WRITE kho nguồn |
| Nhận hàng → `RECEIVED/COMPLETED` (+ discrepancy) | `POST /api/transfer-receiving/:id/confirm`, `/discrepancies/resolve` | `inventory.task.progress` / `inventory.operation.decide` | WRITE kho đích |

  Mỗi bước ghi `inventory_audit_logs`. Tạo yêu cầu kiểm tra tồn khả dụng của kho nguồn (`INSUFFICIENT_STOCK` 409), kho/location `is_active`. Tồn bị trừ ở bước **picking** (`picking.controller.js:2519`), không phải lúc tạo/duyệt.
- Mua mới: `purchase_requests` (một PR = một variant, một kho) → duyệt → `convert-to-po` → PO → nhận hàng. AI đã có `CREATE_REORDER_DRAFT` tạo PR thật sau khi xác nhận; `APPROVE_PURCHASE_ORDER`, `POST_GOODS_RECEIPT`, `UPDATE_STOCK_DIRECTLY` nằm trong denylist.

### 2.3. Analytics & procurement

| Module | File | Phạm vi dữ liệu |
|---|---|---|
| `getReorderSuggestions` (EWMA, xu hướng, mùa vụ, safety stock z=1.645, lead time lịch sử, priority) | `analytics.controller.js:895`, `utils/reorder-suggestion.js` | **SYSTEM**: tồn `SUM` mọi kho theo variant; nhu cầu mượn `COUNT` mọi kho |
| Budget mode `?budgetVnd=` — inventory position = available + incoming PO + expected returns (Kaplan-Meier), `allocateMarginal` | `utils/budget-allocation.js`, `utils/expected-returns.js` | SYSTEM; `priorityWarehouseId` chỉ ưu tiên dòng thiếu tại kho đó |
| What-if có sẵn | `leadTimeDelayDays`, `leadTimeDays`, `priority`, `priorityWarehouseId`, `budget_change_pct`, `keep_service` (ai-service `simulate_reorder_budget`) | SYSTEM |
| `getWarehouseVariantStock`, `/warehouse-stock-risk`, `/warehouse-stock-items` | `analytics.controller.js:450` | **WAREHOUSE_SCOPED** theo (kho, variant), chỉ kho `is_active` |
| Incoming PO | `getIncomingQtyByVariant` (`:853`) | Theo variant, **không theo kho** |
| Lead time | `utils/lead-time.js` từ goods receipt ↔ PO | Theo variant |
| Weeding (có tín hiệu REDISTRIBUTE) | `analytics.controller.js:1653` | WAREHOUSE_SCOPED |

### 2.4. AI Copilot & Chatbox

- Planner: capability cố định (`kpi, borrow_trend, top_borrowed, overdue, fines, reservation, warehouse_risk, low_stock_items, reorder, aging, weeding, book_search, priority`) + analysis (`lookup, causal, comparison, decision, what_if, ranking`). Semantic planner LLM chỉ được gọi khi plan luật trông thiếu; kết quả được validate theo từ vựng cố định và danh sách kho người dùng thấy.
- State hội thoại (`copilot_plan.next_state`): capabilities, intent, analysis, warehouses, recent/focus warehouse, time range, **budgets của lượt gần nhất**, priority, last_items (variant_id), tool_calls, viz.
- Decision object (`copilot_decision.py`) chỉ cho reorder budget; frontend có `apps/web/src/components/ai/decision-card.tsx` (155 dòng) và e2e `ai-copilot-decision.spec.ts`, `reorder-budget.spec.ts`, `warehouse-transfer-lifecycle.spec.ts`.
- Test Python hiện có: `test_copilot_*`, `test_phase_f_planner.py`, `test_action_permissions.py`, `test_action_lifecycle.py`, `test_warehouse_scope.py`, `test_copilot_security.py`.

### 2.5. Dữ liệu dev cục bộ (đã truy vấn `SELECT`, 20/11/2026)

- 10 kho active: `WH-HCM-01`, `WH-HN-01`, `WH-DN-01`, `WH-CT-01` (WAREHOUSE) và 6 BRANCH (`BR-HCM-01..03`, `BR-HN-01..02`, `BR-DN-01`). Seed gốc (`services/inventory-service/prisma/seed.js`) chỉ có `WH-HCM-01`, `WH-HN-01`, `BR-HCM-01`, `BR-HCM-02`; các kho còn lại đến từ bước demo upgrade.
- `loan_transactions.warehouse_id` có giá trị cho cả WAREHOUSE lẫn BRANCH (vd. WH-HCM-01: 5.496, WH-HN-01: 4.218 phiếu) → **nhu cầu theo kho tính được**.
- `safety_stock_qty > 0` chỉ ở 8 dòng (WH-HCM-01, BR-HCM-02); còn lại 0.
- 113/137 variant active có `unit_cost > 0`.
- `transfer_orders`: 1 đơn `IN_TRANSIT`.
- Chỉ một WAREHOUSE_MANAGER có scope: `manager01` FULL trên WH-HN-01, BR-HCM-01, WH-HCM-01. **Không có tài khoản nào khớp kịch bản demo** (HCM FULL + HN READ + ĐN FULL).

## 3. Nghiệp vụ còn thiếu

1. **Chẩn đoán theo kho × variant có nhu cầu**: chưa có endpoint kết hợp tồn theo kho với nhu cầu theo kho (loan/reservation theo `warehouse_id`), incoming theo kho, safety stock theo kho.
2. **Phát hiện dư** (surplus) và **ghép nguồn–đích** với số lượng điều chuyển an toàn: chưa có. Weeding REDISTRIBUTE chỉ là tín hiệu "sách nằm im", không tính lượng.
3. **Hàng đang điều chuyển**: `stock_balances.in_transit_qty` không được code nào ghi (grep `src/` của inventory-service: 0 chỗ dùng). Incoming/outgoing transfer phải tính từ `transfer_orders` (`REQUESTED, APPROVED, PICKING, IN_TRANSIT`).
4. **Incoming PO theo kho**: `purchase_orders.warehouse_id` có, nhưng `getIncomingQtyByVariant` gộp theo variant.
5. **So sánh Transfer-only / Procurement-only / Hybrid**: chưa có. Decision engine hiện chỉ so sánh các mức ngân sách mua.
6. **Thời gian điều chuyển**: không có cấu hình, nhưng có lịch sử `requested_at / shipped_at / received_at` để ước lượng; **chi phí điều chuyển: không có dữ liệu** → phải hiển thị "không có dữ liệu", không giả định.
7. **What-if mới**: nhu cầu ±%, loại trừ kho nguồn, chỉ cho phép một cặp kho, kho ngừng hoạt động (giả lập), đổi safety stock.
8. **Lịch sử kịch bản trong hội thoại**: state chỉ giữ budgets của lượt trước → không khôi phục được "phương án 15 triệu ban đầu", "quay lại phương án trước".
9. **Action tạo yêu cầu điều chuyển** từ AI: chưa có action type (chỉ có reorder/report/reservation/stock alert/staff task).
10. **Execution timeline thật**: SSE chỉ có `status{stage:"verifying"}`.
11. **Decision cards** cho chẩn đoán, cơ hội điều chuyển, so sánh 3 phương án, what-if diff, preview đa hành động, execution summary.
12. **Fixture demo** (tài khoản HCM FULL + HN READ + ĐN FULL, dữ liệu thiếu/dư có kiểm soát, reset, lệnh e2e).

## 4. Lỗi / khoảng trống ảnh hưởng tới tính năng

| # | Vấn đề | Bằng chứng | Ảnh hưởng |
|---|---|---|---|
| B1 | Reorder suggestions là **SYSTEM**: tồn gộp mọi kho, kể cả kho người dùng không có quyền | `analytics.routes.js:54` (`declareDataScope('SYSTEM')`, không `attachWarehouseScope`); `getInventorySnapshot` `SUM(sb.available_qty)` không lọc kho | Manager một kho nhận số liệu toàn hệ thống; không thể dùng làm "lượng cần mua cho TP.HCM". Vi phạm yêu cầu 2.4 của prompt nếu tái sử dụng nguyên trạng. |
| B2 | Router từ khóa "điều chuyển" đang map vào **WEEDING** | `copilot_semantic_planner.py` `CAPABILITIES[cp.WEEDING] = "đề xuất thanh lý, điều chuyển sách"` | Câu "điều chuyển sách về TP.HCM" sẽ trả lời thanh lý. |
| B3 | `in_transit_qty` luôn 0 | Không có chỗ ghi trong `services/inventory-service/src` | Không được dùng cột này làm incoming. |
| B4 | Yêu cầu transfer `REQUESTED/APPROVED` **không giữ tồn** | Trừ `available_qty` chỉ ở picking | Hai yêu cầu đồng thời đều qua kiểm tra 409; engine phải tự trừ outgoing đang mở khỏi tồn kho nguồn. |
| B5 | Transfer & purchase request **không có idempotency key** | `createTransferRequest`, `createPurchaseRequest`: không đọc header/khóa; `transfer_orders` không có cột idempotency | Retry sau timeout có thể tạo trùng. AI hiện xử lý PR bằng `RECONCILE_REQUIRED` (không tự retry). |
| B6 | Không tách nhiệm vụ khi duyệt transfer: người tạo có thể tự duyệt | `approveRequest` chỉ kiểm tra quyền + WRITE kho nguồn | Không phải lỗi của tính năng này, nhưng AI **không được** gọi approve; ghi rõ trong tài liệu. |
| B7 | Invalidation scope chỉ tới inventory-service | `warehouse-directory.js:52` | analytics/ai-service dùng quyền cũ tối đa 30 s. Confirm trong ai-service dùng `writable_warehouses` có cache (không fresh). Service đích vẫn chặn (inventory được invalidation), nên rủi ro thấp nhưng phải kiểm thử. |
| B8 | Scope rows trỏ tới kho `is_active = false` vẫn được coi là đọc/ghi được ở tầng scope | `scopeFromRows` không biết trạng thái kho | Analytics lọc `w.is_active` nên không lộ số liệu; engine mới phải lọc kho inactive. |

## 5. Rủi ro phân quyền

1. **Collaborative action là bắt buộc theo workflow hiện tại**: transfer là mô hình *push* — chỉ người có WRITE ở **kho nguồn** tạo được yêu cầu. Manager có READ ở Hà Nội **không thể** tạo yêu cầu "kéo hàng từ Hà Nội về TP.HCM". Không có workflow "đề nghị kho khác chuyển hàng" (pull request). → Hành động liên quan kho nguồn READ chỉ có thể là *đề xuất + nội dung bàn giao cho Manager kho nguồn*; không tạo gì trong DB (xem câu hỏi Q1).
2. Không được tin `warehouse_id` từ LLM/frontend: engine phải lấy scope từ auth-service (đã có `attachWarehouseScope`), và action guard phải coi `from_warehouse_id` là kho **ghi** (hiện `action_guard.target_warehouses` chỉ đọc `warehouse_id` và `items[].warehouse_id` → phải mở rộng cho action transfer).
3. Confirm phải đọc scope **fresh**; ai-service hiện chưa có tùy chọn fresh trong `warehouse_scope.py`.
4. Cache tool (`_cached_get`, TTL 60 s) đã partition theo scope — giữ nguyên, endpoint mới đi qua cùng cơ chế.
5. Lịch sử hội thoại: decision/scenario lưu trong state phải mang `warehouse_id` của các kho trong đó để `can_view` che khi bị thu hồi (đã có cơ chế `warehouse_ids_in` — chỉ cần dùng đúng khóa `warehouse_id / from_warehouse_id / to_warehouse_id`).
6. Pending action đa phần (transfer + PR): mỗi phần phải được kiểm tra lại quyền riêng lúc confirm; phần không đủ quyền giữ ở trạng thái đề xuất, không làm hỏng phần còn lại.

## 6. Rủi ro dữ liệu

- Nhu cầu theo kho mỏng ở một số kho (WH-CT-01: 6 phiếu, BR-DN-01: 4) → dự báo kém tin cậy; phải gắn nhãn độ tin cậy như `data_confidence` đang làm.
- Safety stock gần như không được nhập → cần quy tắc: dùng `safety_stock_qty` khi > 0, nếu không thì safety stock thống kê (cùng công thức `reorder-suggestion.js`) tính trên chuỗi nhu cầu **của kho đó**; ghi rõ nguồn.
- 24/137 variant không có giá → không được đưa vào phân bổ ngân sách, phải báo "chưa có đơn giá" (đã có tiền lệ `unpriced_qty`).
- Lead time điều chuyển suy từ lịch sử rất ít (1 đơn). Nếu không đủ mẫu → "không có dữ liệu", không bịa.
- Tham chiếu chéo: nhu cầu ở `borrow_db`, tồn ở `inventory_db` — join theo `variant_id` + `warehouse_id` (không theo title).

## 7. API có thể tái sử dụng

- `GET /analytics/warehouse-stock-items`, `/warehouse-stock-risk` (đã scoped) — nguồn tồn theo kho.
- Hàm thuần: `forecast.js`, `reorder-suggestion.js` (`calculateSuggestion`, safety stock, priority), `lead-time.js`, `expected-returns.js`, `budget-allocation.js` (`allocateMarginal`, `serviceCurve`), `warehouse-stock.js` (`stockStatus`).
- `GET /api/warehouses` (danh sách kho người dùng thấy), `POST /api/order-requests/transfer` (nhận `variant_id` trực tiếp trên dòng), `POST /api/purchase-requests`.
- ai-service: `match_warehouse`, `_resolve_or_error`, `_cached_get`, `data_confidence`, pending action store + `/actions/confirm` + reconcile, `copilot_verification`, `copilot_decision` (khung).

## 8. API cần điều chỉnh / bổ sung (đề xuất, chờ duyệt)

| Đề xuất | Lý do | Ghi chú |
|---|---|---|
| **Mới**: `GET /analytics/rebalancing-plan` (WAREHOUSE_SCOPED, `attachWarehouseScope`) | Một endpoint tính chẩn đoán theo kho × variant, ghép nguồn–đích, lượng an toàn, nhu cầu mua phần còn thiếu, 3 phương án, ngân sách — **toàn bộ trong analytics** | Tham số: `destinationWarehouseId?`, `budgetVnd?`, `demandChangePct?`, `excludeSourceIds?`, `onlySourceIds?`, `safetyStockMultiplier?`, `priority?`, `leadTimeDelayDays?`, `inactiveWarehouseIds?` (giả lập). Mọi warehouse id tham số phải nằm trong `req.warehouseScope` → 403. Mỗi dòng transfer gắn `permission: EXECUTABLE | COLLABORATIVE` dựa trên WRITE ở kho nguồn (đọc scope fresh qua shared resolver). |
| Util thuần mới `utils/rebalancing.js` | Tách số học để test đơn vị + backtest như các util khác | Dùng lại `calculateSuggestion` cho phần mua |
| `getIncomingQtyByVariant` → thêm biến thể theo kho | Incoming PO của kho đích | Không đổi hành vi endpoint cũ |
| Không đổi `/reorder-suggestions` | Giữ hợp đồng cũ; tính năng mới không dùng nó cho manager một kho | |
| (Tùy chọn) idempotency cho transfer | B5 | **Không đổi schema** nếu chưa được duyệt — xem Q4 |

## 9. AI Tools cần phát triển (theo convention `copilot_tools.py`)

| Tool (read) | Gọi | Mục đích |
|---|---|---|
| `analyze_inventory_rebalancing` | `/analytics/rebalancing-plan` | Chẩn đoán thiếu/dư, nhu cầu, cơ hội điều chuyển, trạng thái quyền |
| `compare_supply_options` | cùng endpoint với `budgetVnd`, what-if params | Transfer-only / Procurement-only / Hybrid + ngân sách + what-if, so với kịch bản trước (diff do code tính) |

| Action (write) | Thực thi | Policy |
|---|---|---|
| `CREATE_TRANSFER_DRAFT` (mới) | `POST /api/order-requests/transfer` (→ `REQUESTED`, chưa duyệt) | `_MANAGER_DECISION`; write scope **fresh** trên `from_warehouse_id`, read trên `to_warehouse_id` |
| `CREATE_REORDER_DRAFT` (có sẵn) | `POST /api/purchase-requests` | giữ nguyên |
| Gói "kế hoạch" | Một pending action chứa nhiều phần hoặc nhiều action liên kết | quyết định ở Q3 |

Planner: thêm capability `rebalance` (+ mô tả trong `CAPABILITIES`), bỏ chữ "điều chuyển" khỏi WEEDING; tham số trích từ câu (kho đích, ngân sách, % thay đổi, kho loại trừ…) theo cách `parse_budgets/parse_budget_change_pct` đang làm; state thêm `scenarios: [{id, label, params, summary, warehouse_ids}]` + `selected_scenario_id` để khôi phục ("15 triệu ban đầu", "phương án trước", "giảm tiếp 20%" = giảm từ kịch bản đang chọn).

## 10. Thiết kế Chatbox (đề xuất)

- **Timeline thật**: backend phát `_sse("status", {"stage": ..., "state": "done"})` *sau khi* bước đó trả về (permission → inventory → demand → shortage/surplus → transfer → procurement → scenario → verification → result). Client cũ bỏ qua event lạ (đã có tiền lệ). Bước không chạy thì không hiển thị.
- **Cards** mở rộng từ `decision-card.tsx`: Diagnosis, Transfer Opportunity (nguồn, đích, SL, tồn sau điều chuyển, badge quyền Executable/Collaborative), Comparison 3 cột, Budget, What-if diff, Pending Action Preview (nhiều phần, phần không đủ quyền hiển thị "chỉ đề xuất"), Execution Summary (mã TO/PR thật, việc cần Manager khác).
- Trạng thái: loading/skeleton, empty, error + retry, 403 (Permission Denied), 503 (Data Unavailable). Không nút giả, không số giả.

## 11. Kế hoạch kiểm thử

| Lớp | Nội dung | Lệnh dự kiến |
|---|---|---|
| Unit (Node) | `utils/rebalancing.js`: không vượt tồn an toàn nguồn, không vượt thiếu hụt đích, không tính trùng đơn vị, trừ outgoing mở, cộng incoming PO/transfer, nhiều nguồn→1 đích, 1 nguồn→nhiều đích, ngân sách 0/không đủ, thiếu giá, thiếu lead time | `pnpm --filter analytics-service test` |
| API (Node) | `rebalancing-plan`: scope filter, 403 id ngoài scope/giả mạo, 503 auth lỗi, kho inactive/không tồn tại | như trên |
| Unit/integration (Python) | planner: ≥5 biến thể × 14 intent; state/scenario recovery; tool schema validate; action guard transfer (from_warehouse = write, fresh); multi-part confirm; thu hồi quyền giữa phiên; cache partition | `pnpm test:ai` |
| Security | IDOR action id, warehouse id injection, cross-user cache, history masking, stale pending action, duplicate confirm, direct API bypass | Python + Node |
| Semantic | Bộ câu ≥ 70 (14 intent × 5) chạy qua planner thật (rule + semantic khi có provider); báo cáo intent dự kiến/thực tế/tool | script eval mới trong `services/ai-service/eval/` |
| Chatbox E2E | 7 câu demo đúng thứ tự qua UI thật + 3 hội thoại A/B/C | Playwright `apps/web/e2e/ai-rebalancing-demo.spec.ts`, script `test:e2e:ai-rebalancing-demo` |
| Regression | Bộ hiện có: `test:node`, `test:ai`, e2e `ai-copilot-decision`, `reorder-budget`, `warehouse-transfer-lifecycle` | |
| Demo reset | Fixture + reset idempotent, chạy 2 lần liên tiếp | |

## 12. Rủi ro triển khai

- Kích thước: thay đổi chạm 4 lớp (analytics, ai-service planner/tools/actions, web chatbox, fixture). Đề xuất làm theo thứ tự Phase 1→2 (engine + test) trước khi đụng planner/UI.
- Semantic planner có cờ `COPILOT_SEMANTIC_PLANNER`; test semantic phụ thuộc LLM provider và ngân sách OpenRouter — kết quả phải ghi rõ chạy với provider nào; phần rule-based chạy offline được.
- Ai-service image phải build lại để kiểm thử trong container (theo quy trình hiện có).
- Dữ liệu dev đã có WH-DN-01; fixture demo cần tài khoản riêng (không sửa `manager01`) và chỉ chạy ở môi trường dev/test.
- Không đổi schema trừ khi Q4 được duyệt.

## 13. Bảng tổng hợp

| Module | Hiện trạng | Vấn đề | Giải pháp | File dự kiến chỉnh sửa | Mức độ |
|---|---|---|---|---|---|
| Warehouse scope (shared/Node) | Chuẩn, fail-closed, cache 30 s, `fresh` | Invalidation chỉ tới inventory | Giữ nguyên; endpoint mới dùng `attachWarehouseScope` + `canWrite(..., {fresh})` | `services/analytics-service/src/middlewares/warehouse-scope.middleware.js` (export thêm canWrite) | Thấp |
| Warehouse scope (AI) | Đọc/ghi, cache 30 s, che lịch sử | Không có đọc fresh cho confirm | Thêm tham số `fresh` | `services/ai-service/warehouse_scope.py`, `action_guard.py` | Trung bình |
| Analytics — reorder | Thuật toán tốt, SYSTEM scope | B1: không theo kho | Không sửa; engine mới tái dùng hàm thuần theo kho | — | Cao (nếu dùng sai) |
| Analytics — rebalancing | Chưa có | Thiếu toàn bộ | Endpoint + util mới, WAREHOUSE_SCOPED | `src/utils/rebalancing.js` (mới), `analytics.controller.js`, `analytics.routes.js`, test mới | Cao |
| Inventory — transfer | Đủ vòng đời, audit log | B4 không giữ tồn, B5 không idempotency, B6 tự duyệt | Engine trừ outgoing mở; AI chống trùng (Q4); AI không gọi approve | (không đổi, trừ khi Q4) | Trung bình |
| Inventory — incoming | PO theo variant; `in_transit_qty` không dùng | B3 | Tính từ `transfer_orders` + `purchase_orders.warehouse_id` trong analytics | `analytics.controller.js` | Trung bình |
| AI planner | Rule + semantic, state 1 lượt | B2 "điều chuyển"→weeding; không có lịch sử kịch bản | Capability `rebalance`, parser tham số, `scenarios` trong state | `copilot_plan.py`, `copilot_semantic_planner.py` | Cao |
| AI tools | 9 tool reorder/kho | Chưa có rebalancing | 2 tool đọc mới | `copilot_tools.py`, `assistant_tools.py` (đăng ký) | Cao |
| AI decision | Chỉ reorder budget | Không có 3 phương án | Mở rộng `build` cho rebalancing | `copilot_decision.py`, `copilot_verification.py` (claims) | Trung bình |
| AI actions | Reorder/report/reservation/alert/task | Không có transfer; guard không biết `from_warehouse_id` | `CREATE_TRANSFER_DRAFT` + executor + guard | `agent_actions.py`, `agent_executor.py`, `action_guard.py`, `main.py` | Cao |
| SSE / timeline | `token`, `status: verifying`, `done` | Không có tiến trình thật | Phát status sau từng bước thật | `main.py`, `apps/web/src/services/ai.ts` | Trung bình |
| Chatbox UI | Decision card reorder | Thiếu 7 loại card | Mở rộng card, preview đa phần | `apps/web/src/components/ai-chatbot.tsx`, `components/ai/decision-card.tsx` (+ card mới) | Trung bình |
| Demo fixture | Không có tài khoản HCM FULL/HN READ/ĐN FULL | Không tái lập được demo | Seed/reset riêng cho dev/test + e2e script | `scripts/` (mới), `apps/web/e2e/` (mới), `package.json` | Trung bình |
| Docs | — | — | 6 tài liệu Phase 10 | `docs/AI_INVENTORY_REBALANCING_*.md` | Thấp |

## 14. Câu hỏi cần xác nhận trước Phase 1

**Quyết định của người dùng (20/11/2026):** Q1 = chỉ đề xuất (Collaborative Action, không ghi DB); Q2 = nhu cầu theo chính kho đó; Q3 = một gói, xác nhận một lần, từng phần kiểm tra quyền và báo kết quả riêng; Q4 = không đổi schema (mã action AI trong note + kiểm tra transfer đang mở + `RECONCILE_REQUIRED`). Q5 chưa chốt.

- **Q1 — Hành động với kho nguồn chỉ có READ** (vd. Hà Nội): workflow hiện tại không cho tạo yêu cầu từ kho nguồn không có WRITE. Đề xuất: AI chỉ hiển thị "Collaborative Action" + nội dung bàn giao để Manager kho nguồn tự tạo; **không** thêm workflow "pull request" mới (sẽ cần schema/route mới).
- **Q2 — Nguồn nhu cầu theo kho**: dùng `loan_transactions.warehouse_id` + reservation theo kho của chính kho đó (WAREHOUSE và BRANCH đều có dữ liệu), không phân bổ nhu cầu chi nhánh về kho tổng. Đồng ý?
- **Q3 — Bản nháp nhiều phần**: một pending action "kế hoạch" chứa cả transfer và PR (xác nhận một lần, từng phần kiểm tra quyền riêng), hay nhiều pending action liên kết, mỗi cái xác nhận riêng? Đề xuất: một action gói nhiều phần, kết quả từng phần riêng (phần lỗi → `RECONCILE_REQUIRED`/FAILED riêng).
- **Q4 — Chống tạo trùng transfer**: không đổi schema; trước khi tạo, executor kiểm tra transfer đang mở cùng nguồn/đích/variant có ghi chú mang mã action AI; kết quả không rõ → `RECONCILE_REQUIRED`. Hay chấp nhận thêm cột `idempotency_key` cho `transfer_orders` (migration)?
- **Q5 — Tài khoản demo**: tạo tài khoản mới (vd. `rebalance.manager`) trong fixture dev/test với HCM FULL + HN READ + ĐN FULL (`WH-HCM-01`, `WH-HN-01`, `WH-DN-01`), không sửa `manager01`.
