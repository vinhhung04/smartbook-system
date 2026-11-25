# AI Inventory Rebalancing & Procurement Decision — Kiến trúc

Trạng thái: đã triển khai trên nhánh `hungg` (chưa commit, chưa merge `main`). Ngày 20/11/2026.

## 1. Luồng tổng thể

```
Chatbox /ai-assistant (apps/web)
  │ POST /ai/assistant/stream  (SSE: status, token, done)
  ▼
API Gateway ──► ai-service (FastAPI)
                 ├─ copilot_plan.build_plan ──► _plan_rebalance  (luật: capability `rebalance`, 14 focus, kịch bản)
                 │    └─ copilot_semantic_planner (LLM, chỉ khi luật thiếu; validate theo từ vựng cố định)
                 ├─ tool đọc: copilot_tools.analyze_inventory_rebalancing
                 │    └─ fetch_rebalancing_plan ──► GET /analytics/rebalancing-plan (token của người dùng)
                 ├─ copilot_response: render kết quả + hướng dẫn trả lời theo focus
                 ├─ LLM viết câu trả lời ─► copilot_verification (đối chiếu số liệu)
                 ├─ copilot_rebalance_decision: decision object, so sánh kịch bản, timeline thật
                 ├─ rebalance_actions.plan_draft ─► pending action CREATE_REBALANCE_DRAFT (không ghi gì)
                 └─ "Tôi xác nhận" ─► confirm_action (đường của nút Xác nhận) ─► rebalance_actions.execute
                        ├─ POST /api/order-requests/transfer   (REQUESTED, chờ duyệt)
                        └─ POST /api/purchase-requests          (PENDING, chờ duyệt)
analytics-service (Node, chỉ đọc inventory_db + borrow_db)
  └─ rebalancing.controller ─► utils/warehouse-access (quyền) + utils/rebalancing (số học) + reorder-suggestion (dự báo)
auth-service ─ GET /internal/users/:id/warehouse-scopes (nguồn quyền kho duy nhất, fail-closed)
inventory-service ─ kiểm tra lại quyền ghi, tồn khả dụng (409), ghi audit log
```

## 2. Thành phần mới / thay đổi

| Lớp | File | Vai trò |
|---|---|---|
| Analytics | `src/utils/warehouse-access.js` (mới) | Kho đọc được + READ/WRITE, EXECUTABLE / COLLABORATIVE / PROPOSAL_ONLY, kiểm tra mã kho giả mạo / ngừng hoạt động |
| Analytics | `src/utils/rebalancing.js` (mới) | Thiếu / dư, số lượng điều chuyển an toàn, 4 phương án, phân bổ ngân sách, what-if, xếp hạng |
| Analytics | `src/controllers/rebalancing.controller.js` (mới) | `GET /analytics/rebalancing-plan`: SQL theo kho × variant, dùng lại mô hình dự báo, tham số what-if |
| Analytics | `warehouse-scope.middleware.js`, `analytics.controller.js`, `reorder-suggestion.js`, `analytics.routes.js` | Export `resolveWarehouseScope`, chia sẻ helper, trả thêm `safety_stock`, route mới |
| AI | `copilot_plan.py` | Capability `rebalance`, `_plan_rebalance`, what-if, bộ nhớ kịch bản (`_rebalance_state`) |
| AI | `copilot_semantic_planner.py` | Mô tả capability mới, kịch bản trước cho LLM |
| AI | `copilot_tools.py` | `fetch_rebalancing_plan`, tool `analyze_inventory_rebalancing` |
| AI | `copilot_response.py` | Renderer kết quả cho LLM, hướng dẫn theo focus |
| AI | `copilot_rebalance_decision.py` (mới) | Decision object, so sánh kịch bản (code tính chiều tăng/giảm), timeline |
| AI | `rebalance_actions.py` (mới) | Bản nháp, executor, câu trả lời từ bản nháp / kết quả |
| AI | `agent_actions.py`, `agent_executor.py`, `agent_store.py`, `warehouse_scope.py`, `action_guard.py`, `main.py` | Action mới, đọc quyền fresh khi xác nhận, `latest_pending_action`, lượt "Tôi xác nhận" |
| Web | `components/ai-copilot-rebalance.tsx` (mới) | Thẻ A–E, G, timeline |
| Web | `ai-action-card.tsx`, `assistant-message.tsx`, `model.ts`, `pages/ai-assistant.tsx`, `services/ai.ts`, `ai-copilot-decision.tsx` | Thẻ F (xem trước bản nháp), hiển thị thẻ, kiểu dữ liệu |
| Demo | `scripts/demo/rebalancing-demo.mjs` (mới), `package.json` | seed / reset / validate, lệnh e2e |

## 3. Nguyên tắc giữ nguyên

- Không có cơ chế phân quyền mới: mọi quyết định quyền đi từ `user_warehouse_scopes` qua resolver dùng chung; analytics, ai-service và inventory-service đều kiểm tra lại.
- LLM không tính số: mọi con số là của analytics; chênh lệch kịch bản và câu trả lời bản nháp do code dựng.
- LLM không chọn endpoint / SQL / mã kho: planner chỉ đưa tên kho, tool đối chiếu với danh sách kho người dùng thấy, analytics kiểm tra lại từng mã.
- Không tự phê duyệt: action chỉ tạo yêu cầu REQUESTED / PENDING; `APPROVE_TRANSFER_REQUEST`, `SHIP_TRANSFER`, `RECEIVE_TRANSFER` nằm trong denylist.
- Không đổi schema cơ sở dữ liệu.

## 4. Sơ đồ

Sơ đồ chính thức cho báo cáo khóa luận chưa vẽ trong phạm vi này (xem mục 6 CLAUDE.md về Mermaid / Draw.io). Luồng ở mục 1 là nguồn để vẽ sequence diagram.
