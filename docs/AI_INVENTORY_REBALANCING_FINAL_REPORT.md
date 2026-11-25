# AI Inventory Rebalancing & Procurement Decision — Báo cáo cuối

Nhánh `hungg`, HEAD `12e79cc` + thay đổi chưa commit. Ngày 20/11/2026. Tài liệu liên quan: [Audit](AI_INVENTORY_REBALANCING_IMPLEMENTATION_AUDIT.md), [Kiến trúc](AI_INVENTORY_REBALANCING_ARCHITECTURE.md), [Logic nghiệp vụ](AI_INVENTORY_REBALANCING_BUSINESS_LOGIC.md), [Ma trận quyền](AI_INVENTORY_REBALANCING_PERMISSION_MATRIX.md), [Kịch bản demo](AI_INVENTORY_REBALANCING_DEMO_SCRIPT.md), [Chatbox test](AI_INVENTORY_REBALANCING_CHATBOX_TEST_REPORT.md), [Semantic test](AI_INVENTORY_REBALANCING_SEMANTIC_TEST_REPORT.md).

## 1. Nghiệp vụ đã triển khai

Chẩn đoán tồn kho theo kho × đầu sách; phát hiện thiếu / dư; phân tích nhu cầu theo kho; cơ hội điều chuyển; số lượng điều chuyển an toàn (kho nguồn giữ mức cần giữ, không tính trùng, trừ hàng đã hứa đi, cộng hàng đang về); tối ưu mua mới; so sánh 4 phương án (chỉ điều chuyển / chỉ mua / kết hợp / kết hợp tự thực hiện được) theo quy tắc cố định; tối ưu ngân sách; what-if (ngân sách ±%, ±số tiền, nhu cầu ±%, loại kho nguồn, chỉ cho phép một kho nguồn, kho ngừng hoạt động, tồn an toàn, chỉ HIGH, nhà cung cấp chậm N ngày); giải thích quyết định; bản nháp yêu cầu điều chuyển + phiếu nhập cho phần người dùng tự làm được; xác nhận trong chat đi qua đúng đường xác nhận hiện có; phân biệt phương án tốt nhất về nghiệp vụ / tự thực hiện được / cần phối hợp.

## 2–3. File đã thêm và chỉnh sửa

Thêm (17): `analytics-service/src/utils/{warehouse-access,rebalancing}.js`, `src/controllers/rebalancing.controller.js`, `test/{warehouse-access,rebalancing,rebalancing-endpoint}.test.js`; `ai-service/{rebalance_actions,copilot_rebalance_decision}.py`, `test_rebalance_{planner,actions}.py`, `eval/rebalancing_semantic_{dataset.json,report.py}`; `apps/web/src/components/ai-copilot-rebalance.tsx`, `apps/web/e2e/ai-rebalancing-demo.spec.ts`; `scripts/demo/rebalancing-demo.mjs`; 7 tài liệu `docs/AI_INVENTORY_REBALANCING_*.md`.

Sửa (24 file, +1085 / −28 dòng): analytics (`analytics.controller.js`, `warehouse-scope.middleware.js`, `analytics.routes.js`, `reorder-suggestion.js`); ai-service (`action_guard.py`, `agent_actions.py`, `agent_executor.py`, `agent_store.py`, `copilot_plan.py`, `copilot_response.py`, `copilot_semantic_planner.py`, `copilot_tools.py`, `main.py`, `warehouse_scope.py`, và 3 test cũ được cập nhật theo chữ ký / action mới — không xóa test nào); web (`ai-action-card.tsx`, `assistant-message.tsx`, `model.ts`, `ai-copilot-decision.tsx`, `pages/ai-assistant.tsx`, `services/ai.ts`); `package.json` (4 lệnh). Không đổi schema cơ sở dữ liệu.

## 4. API và AI tools bổ sung

- `GET /analytics/rebalancing-plan` (WAREHOUSE_SCOPED, cần người dùng đăng nhập): `destinationWarehouseId(s)`, `budgetVnd`, `demandChangePct`, `excludeSourceIds`, `onlySourceIds`, `closedWarehouseIds`, `safetyStockMultiplier`, `priority`, `leadTimeDelayDays`, `days`, `limit`.
- Tool đọc `analyze_inventory_rebalancing` (Copilot).
- Action `CREATE_REBALANCE_DRAFT` (bản nháp → xác nhận → `POST /api/order-requests/transfer` REQUESTED + `POST /api/purchase-requests`).
- Denylist thêm `APPROVE_TRANSFER_REQUEST`, `SHIP_TRANSFER`, `RECEIVE_TRANSFER`.

## 5. Kiến trúc trước / sau

Trước: Copilot chỉ có đề xuất nhập **toàn hệ thống** (`/reorder-suggestions`, SYSTEM scope) và rủi ro tồn kho theo kho; "điều chuyển" bị hiểu là thanh lý; không có điều chuyển, không có kịch bản. Sau: xem [Kiến trúc](AI_INVENTORY_REBALANCING_ARCHITECTURE.md) — engine theo kho trong analytics, capability `rebalance` trong planner hiện có, bộ nhớ kịch bản, action bản nháp, thẻ quyết định.

## 6. Ma trận quyền

Xem [Ma trận quyền](AI_INVENTORY_REBALANCING_PERMISSION_MATRIX.md).

## 7. Kết quả tính toán nghiệp vụ (fixture demo, dữ liệu dev)

| Phương án (kho đích TP.HCM, 15 tr) | Đáp ứng | Chuyển / mua | Chi phí mua | Cần phối hợp |
|---|---|---|---|---|
| Chỉ điều chuyển | 58,1% | 36 / 0 | 0 ₫ | 2 dòng |
| Chỉ mua mới | 100% | 0 / 62 | 12.025.000 ₫ | 0 |
| **Kết hợp (tốt nhất)** | 100% | 36 / 26 | 4.473.000 ₫ | 2 dòng |
| Kết hợp, tự thực hiện được | 100% | 16 / 46 | 8.689.000 ₫ | 0 |

Ở 12 tr: chỉ mua mới còn 98,4%; hai phương án kết hợp không đổi.

## 8–14. Kết quả kiểm thử

| Test | Lệnh | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| Analytics unit + endpoint (toàn bộ) | `node --test test/*.test.js` (analytics-service) | 0 fail | 197 tests: 193 pass, 4 skip (skip có từ trước) | PASS |
| — trong đó engine | `node --test test/rebalancing.test.js` | quy tắc nghiệp vụ, what-if | 13/13 | PASS |
| — trong đó endpoint / quyền | `node --test test/rebalancing-endpoint.test.js test/warehouse-access.test.js` | 403/409/400/401/503, phạm vi SQL | 18/18 | PASS |
| AI service (toàn bộ) | `.venv/Scripts/python -m pytest` (ai-service) | 0 fail | 1787 pass, 19 skip ở 5 lần chạy; **1 lần chạy khác có 1 fail không lặp lại được** (không xác định được test, 5 lần chạy sau đều xanh) | PASS (có ghi chú) |
| — semantic planner | `pytest test_rebalance_planner.py` | 14 intent × ≥ 5 câu, 3 hội thoại | 82/82 câu, 18/18 lượt, 5/5 an toàn | PASS |
| — semantic held-out | `python eval/rebalancing_semantic_report.py` | câu chưa dùng chỉnh luật | lần đầu **7/12**, hiện tại 12/12 | PASS (hiện tại) |
| — actions / bảo mật | `pytest test_rebalance_actions.py test_warehouse_scope.py test_permission_matrix.py` | quyền fresh, chống trùng, IDOR, đối soát, che lịch sử | PASS | PASS |
| Web typecheck / lint / unit / build | `npx tsc --noEmit -p .`, `npx eslint <files>`, `npm run -s test:unit`, `npm run -s build` | sạch | sạch | PASS |
| Demo validate (backend thật) | `pnpm demo:rebalancing:validate` | 9 kiểm tra | 9/9 | PASS |
| API 7 bước (Copilot thật) | script `POST /ai/assistant` | 7 bước đúng nghiệp vụ | lần 1 phát hiện 4 lỗi → đã sửa; lần 2 đúng | PASS |
| Chatbox E2E | `pnpm test:e2e:ai-rebalancing-demo` | 7 bước qua UI thật | 2 lần liên tiếp, 1,3–1,4 phút | PASS |
| Hồi quy e2e | `npx playwright test ai-chat-streaming ai-copilot-decision ai-copilot-visualization reorder-budget` | không vỡ | 16/16 | PASS |
| Vòng đời điều chuyển e2e | `warehouse-transfer-lifecycle.spec.ts` | — | không chạy (chỉ chạy trên stack cô lập) | Chưa chạy |
| Inventory / auth / gateway / borrow tests | — | — | không chạy (không sửa các service này) | Chưa chạy |

## 15. Vấn đề còn tồn tại

- Thời gian và chi phí điều chuyển: không có dữ liệu trên dev; hiển thị "Không có dữ liệu", phương án có điều chuyển không có "thời gian đáp ứng".
- Nhánh semantic planner LLM chưa có bộ đo riêng cho tính năng này; luật có thể trượt với cách nói hoàn toàn mới (held-out lần đầu 7/12).
- Thu hồi quyền chỉ được báo tức thì cho inventory-service; analytics / ai-service đọc cache 30 s (bước ghi luôn đọc fresh).
- Không tách nhiệm vụ khi duyệt transfer (người tạo có thể tự duyệt) — có từ trước, AI không duyệt.
- Widget chat nổi và app di động chưa hiển thị thẻ rebalancing.
- Ảnh Docker analytics-service / ai-service trên máy dev đã build lại từ cây làm việc chưa commit; quay lại: `docker tag …:pre-rebalancing …:latest` rồi `docker compose up -d --no-deps --no-build <service>`.
- Dữ liệu demo `DEMO-REB` và các yêu cầu TO/PR do lần chạy e2e cuối tạo vẫn còn trên dev; `pnpm demo:rebalancing:reset` xóa.

## 16. Hướng phát triển

Lưu lịch sử thời gian điều chuyển để có "thời gian đáp ứng"; đo nhánh semantic LLM trên bộ held-out lớn hơn; luồng "đề nghị kho khác chuyển hàng" (cần schema) nếu muốn biến việc cần phối hợp thành yêu cầu trong hệ thống; đưa thẻ rebalancing vào widget chat nổi.
