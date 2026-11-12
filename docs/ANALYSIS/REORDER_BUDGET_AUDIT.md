# SmartBook — Audit chức năng phân bổ ngân sách nhập sách (`/reorder-suggestions`)

Ngày: 2026-11-12 · Nhánh: `hungg` (HEAD `33c41c7`) · Trạng thái: **đã sửa trong working tree, chưa commit, chưa deploy**.

Ký hiệu: **[ĐO]** đã chạy và đo thực tế · **[SỬA]** lỗi đã tái hiện bằng test và đã sửa · **[CHƯA]** chưa kiểm tra được · **[CẦN]** cần dữ liệu/môi trường bổ sung.

## 0. Môi trường và phiên bản

| Hạng mục | Kết quả |
|---|---|
| Branch / SHA local | `hungg` / `33c41c7` |
| Thay đổi local có sẵn của người dùng | `.claude/settings.json`, `CLAUDE.md`, `docs/diagrams/**`, `skills-lock.json`, các skill ponytail bị xóa (staged), file `.docx` — **không chạm tới** |
| `https://smartbook.io.vn/version.json` | `decd0d9` = `origin/production` (merge PR #98) [ĐO] |
| Code production so với HEAD (các file của chức năng) | `git diff decd0d9 HEAD -- services/analytics-service apps/web/src/components/reorder-intelligence apps/web/src/lib apps/web/src/components/pages/reorder-suggestions.tsx apps/web/src/services/analytics.ts` → **rỗng**: production chạy đúng code đã audit [ĐO] |
| Docker image trên VPS (web / gateway / analytics) | [CHƯA] không truy cập VPS trong phiên này |
| Dữ liệu production | Không đọc, không ghi. Mọi phép đo dùng stack Docker cục bộ (`localhost:3000`, dữ liệu seed). Không tạo/duyệt PO, không đổi tồn kho. |

## 1. Kiến trúc và luồng thực tế

```
ReorderSuggestionsPage (state days/limit/budgetVnd, loadData)
  └─ analyticsService.getReorderSuggestions → GET /analytics/reorder-suggestions?days&priority=ALL&limit[&budgetVnd]
      API Gateway (pathFilter /analytics, proxy) → analytics-service
        routes: authenticateInternalOrUser(readAnalytics) — JWT + 1 trong analytics.reports.view / dashboard.read / forecast.view / analytics.read / reports.read
        controller getReorderSuggestions:
          inventory_db: book_variants + stock_balances (tồn toàn hệ thống, declareDataScope('SYSTEM')), lead time, PO đang về
          borrow_db: lượt mượn/đặt chỗ/wishlist/alert, chuỗi mượn theo ngày, khoản vay mở + lượt trả 365 ngày
          calculateSuggestion → candidates (sắp theo ưu tiên) → summary (toàn bộ candidates)
          nếu có budgetVnd: plan theo tồn quy đổi (khả dụng + đang về + dự kiến trả, sàn IF_SHORTFALL)
                            → allocateMarginal (Poisson, giá trị biên/đồng) → funded_qty, budget{…}, service_curve
  └─ ReorderWorkspace → buildPlanLine/systemQty/fundingStatus (lib/reorder-intelligence.ts)
      → BudgetPlanner, ReorderTable, SelectionActionBar → navigate('/purchase-orders/new', {prefill}) (chỉ nháp)
Tạo PO thật: POST /api/purchase-orders (inventory-service, cần inventory.purchase.write).
```

## 2. Chức năng đã kiểm tra

Kiểm thử trình duyệt thật: Vite dev `5174` → gateway → analytics (đã rebuild với bản sửa) → Postgres, Edge qua Playwright, tài khoản test `hung` (ADMIN) [ĐO].

| # | Chức năng | Kết quả |
|---|---|---|
| 1 | Tải danh sách | `?days=30&priority=ALL&limit=20` → 20 dòng / 105 đầu sách [ĐO] |
| 2 | Lọc 7/30/90 ngày | bấm 90 ngày → `days=90` [ĐO] |
| 3 | Top 20/50/100 | chọn Top 50 → `limit=50`, 50 dòng [ĐO] |
| 4–5 | Nhập ngân sách, nhấn Enter | `budgetVnd=500000` được gửi; backend trả `budget` [ĐO] |
| 8–9 | Enter / click ra ngoài | cả hai đều gửi đúng một yêu cầu [ĐO] |
| 6/10 | Xóa ngân sách | request không còn `budgetVnd`, `budget: null` [ĐO] |
| 7 | Hiển thị kết quả | "Đã phân bổ 440.000 đ · 2 bản · 1 dòng · Còn lại 60.000 đ · Cấp một phần 1 dòng" khớp response [ĐO] |
| 13–15 | Lọc trạng thái cấp | Cấp đủ 0 · Cấp một phần 1 · Chưa được cấp 0 · Không cần nhập 19 · Chưa có đơn giá 0 (khớp dữ liệu) [ĐO] |
| 9 | Chỉnh số lượng | 2 → 3: "Đã chỉnh · gốc 2 · Cấp 2/4 · +1 ngoài phần được cấp" [ĐO] |
| 10–12 | Chọn dòng, tổng chi phí, vượt ngân sách | "1 đầu sách · 3 bản · 660.000 đ · Vượt ngân sách 160.000 đ · 1 bản ngoài phần được cấp" [ĐO] |
| 13 | Tạo PO nháp | hộp xác nhận vượt kế hoạch → `/purchase-orders/new` với `ordered_qty: 3, unit_cost: 220000`; **không lưu** [ĐO] |
| 14 | Làm mới / race | hai lần Enter liên tiếp (10.000 rồi 5.000.000) → chỉ kết quả 5.000.000 được áp dụng [ĐO] |
| 15 | Lỗi API | đường lỗi giữ kết quả cũ + thông báo (đọc code, không đổi) |
| — | Responsive | desktop 1440 và mobile 375: không tràn ngang; tablet 768: tràn 136 px do bảng `min-w-[960px]` (xem §10) [ĐO] |
| — | Console | không có lỗi [ĐO] |

## 3. Lỗi phát hiện

| ID | Mức độ | Lỗi | Trạng thái |
|---|---|---|---|
| B1 | **Cao** | `funded_qty = 0` bị thay bằng `suggested_reorder_qty` (`systemQty`), nên dòng **không được cấp / không cần nhập** vẫn hiện số lượng đặt, được "Chọn tất cả" và đưa vào PO nháp. Test cũ còn khẳng định hành vi sai (`systemQty(funded 0) === 4`). | [SỬA] |
| B2 | **Cao** | Bản đang mượn dự kiến trả không bị giới hạn bởi `stock_balances.borrowed_qty`. Dữ liệu dev: borrow_db có **578** khoản vay mở, inventory_db chỉ ghi **2** bản đang cho mượn → 54/100 dòng được cộng thêm tổng **124** bản vốn đã nằm trong `available_qty`. Hệ quả: **mọi mức ngân sách cấp 0 bản**, `capped_need_cost = 0` ("Không cần nhập" toàn bộ). Đây rất có thể chính là hiện tượng người dùng gặp. | [SỬA] |
| B3 | **Cao** | Đơn giá 0 bị coi là miễn phí: `allocateMarginal` cấp đủ trần cho dòng `unit_cost = 0` với 0 đ, kể cả khi ngân sách = 0. Trong DB `unit_cost` là `NOT NULL DEFAULT 0` → 0 nghĩa là **chưa nhập giá**, không có khái niệm "miễn phí". Frontend lại coi 0 là "chưa có giá" → hai tầng mâu thuẫn. | [SỬA] |
| B4 | Trung bình | Phân bổ chạy trên toàn bộ candidates nhưng chỉ trả `items.slice(0, limit)` theo thứ tự ưu tiên → dòng được cấp ngân sách xếp ngoài top N **không nhìn thấy, không chọn được**; tổng `funded_cost` công bố lớn hơn phần có thể đặt. | [SỬA] |
| B5 | Trung bình | Race condition: `loadData` không bỏ phản hồi cũ; đổi ngân sách/kỳ/limit khi đang tải có thể để kết quả cũ ghi đè kết quả mới. | [SỬA] |
| B6 | Thấp | Tạo PO vượt số bản được cấp / vượt ngân sách chỉ có cảnh báo chữ, không có bước xác nhận. | [SỬA] |
| B7 | Thấp | Dòng không có số lượng hiển thị "Không cần nhập" kể cả khi thực ra là "Chưa được cấp ngân sách". | [SỬA] |

Kiểm tra và **đúng**, không sửa: `parseOptionalBudget` (thiếu → không giới hạn, 0 → không cấp, âm/chữ → 400); PO đang về chỉ tính APPROVED / SENT_TO_SUPPLIER / SUPPLIER_CONFIRMED / PARTIALLY_RECEIVED và `GREATEST(ordered − received, 0)` (DRAFT, PENDING_APPROVAL, SHORTAGE_REPORTED, đã nhận đủ không tính); Kaplan–Meier (< 30 lượt trả → không tính bản trả, có ghi giả định; khoản vay mở là dữ liệu kiểm duyệt phải); `allocateMarginal` không vượt ngân sách, không vượt trần, không âm, ổn định (vòng lặp tất định, hòa giữ chỉ số nhỏ hơn); `summary` tính trên toàn bộ candidates; quyền (§6).

## 4. Root cause và cách khắc phục

| ID | Root cause | Khắc phục | File |
|---|---|---|---|
| B1 | `hasBudget && item.funded_qty ? … : suggested` — 0 là falsy | `hasBudget ? item.funded_qty ?? 0 : suggested_reorder_qty`; `QtyNote` hiển thị đúng trạng thái khi không có số lượng | `apps/web/src/lib/reorder-intelligence.ts`, `reorder-table.tsx` |
| B2 | `expectedReturns` dùng khoản vay mở của borrow_db, không đối chiếu số bản kho ghi nhận đang cho mượn (luồng cho mượn chuyển `reserved → borrowed`, nên chỉ `borrowed_qty` bản nằm ngoài `available_qty`) | `expectedReturns: Math.min(returns, borrowed_qty)`; câu giả định cập nhật | `analytics.controller.js` |
| B3 | Controller truyền `unit_cost = 0` vào `allocateMarginal`, hàm coi giá 0 là miễn phí | Dòng `unit_cost ≤ 0` có trần 0 khi phân bổ (không đổi `allocateMarginal` vì backtest dùng chung); `budget_plan.cap_qty` vẫn báo nhu cầu thật; thêm `budget.unpriced_lines`, `budget.unpriced_qty` + câu giả định; frontend thêm trạng thái `NO_PRICE` ("Chưa có đơn giá", bộ lọc riêng, ghi chú "Cần bổ sung đơn giá để được cấp") | `analytics.controller.js`, `reorder-intelligence.ts`, `reorder-workspace.tsx`, `reorder-detail.tsx`, `budget-planner.tsx`, `services/analytics.ts` |
| B4 | `items: resultItems.slice(0, limit)` | Có ngân sách: trả top `limit` **cộng** mọi dòng được cấp xếp sau đó (giữ thứ tự ưu tiên); thêm `budget.funded_lines_outside_limit`; gợi ý "top N theo ưu tiên + K dòng được cấp ngân sách". Không ngân sách: giữ nguyên `slice(0, limit)`. `summary` không đổi. | `analytics.controller.js`, `reorder-workspace.tsx` |
| B5 | Không có cơ chế huỷ/bỏ phản hồi cũ | `latestRequest` ref: chỉ yêu cầu mới nhất được `setData/setError/setLoading` | `pages/reorder-suggestions.tsx` |
| B6 | — | `overFundedQty(lines)`; thanh chọn hiển thị "N bản ngoài phần được cấp ngân sách"; nếu vượt số bản được cấp hoặc vượt ngân sách → `ConfirmDialog` có sẵn ("Vẫn tạo đơn nháp") | `selection-action-bar.tsx`, `reorder-workspace.tsx`, `reorder-intelligence.ts` |

Hợp đồng API: **chỉ thêm trường** (`unpriced_lines`, `unpriced_qty`, `funded_lines_outside_limit`); thay đổi ngữ nghĩa: có ngân sách thì `items` có thể dài hơn `limit` đúng bằng `funded_lines_outside_limit`. Schema `packages/shared/contracts/ai-analytics/reorder-suggestions.response.json` không ràng buộc các trường này nên không cần sửa. Copilot (`services/ai-service/copilot_tools.py`) đếm `funded_lines` từ `items`, nên từ nay khớp `budget.funded_lines` (trước đây thiếu các dòng ngoài top N).

## 5. Kiểm thử ngân sách trên dữ liệu thật (stack dev cục bộ) [ĐO]

`limit=20` và `limit=100` cho cùng kết quả ở mọi mức (mọi dòng được cấp đều nằm trong top 20 ở dữ liệu này).

| Ngân sách | Trước sửa: bản / chi / dòng cấp | Sau sửa: bản / chi / còn lại | Dòng cấp (đủ / một phần / chưa / không cần) |
|---:|---|---|---|
| không truyền | `budget: null` | `budget: null` | — |
| 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 1 / 99 |
| 10.000 | 0 / 0 / 0 | 0 / 0 / 10.000 | 0 / 0 / 1 / 99 |
| 500.000 | 0 / 0 / 0 | 2 / 440.000 / 60.000 | 0 / 1 / 0 / 99 |
| 5.000.000 | 0 / 0 / 0 | 4 / 880.000 / 4.120.000 | 1 / 0 / 0 / 99 |
| 15.000.000 | 0 / 0 / 0 | 4 / 880.000 / 14.120.000 | 1 / 0 / 0 / 99 |
| 50.000.000 | 0 / 0 / 0 | 4 / 880.000 / 49.120.000 | 1 / 0 / 0 / 99 |
| = toàn bộ kế hoạch | `capped_need_cost` = 0 | 880.000 → 4 / 880.000 / 0 | 1 / 0 / 0 / 99 |

Mọi trường hợp: `funded_cost ≤ budget`, `funded_cost = Σ funded_cost` các dòng, `remaining = budget − funded_cost`, 0 dòng chưa có giá được cấp. `expected_service_pct = null` trên dữ liệu này vì dự báo nhu cầu trong thời gian chờ hàng = 0 ở mọi dòng (dữ liệu seed gần đây ít lượt mượn) — UI hiện "—, kế hoạch không có nhu cầu cần đáp ứng". Dữ liệu seed có 0 dòng chưa có giá và không có dòng được cấp ngoài top 20, nên B3/B4 được chứng minh bằng test controller với fixture (§7), không bằng dữ liệu live.

## 6. Quyền và phạm vi kho [ĐO]

| Tài khoản (vai trò) | GET reorder (có ngân sách) | POST `/api/purchase-orders` (body rỗng) |
|---|---|---|
| `hung` (ADMIN) | 200 | — (đã kiểm trên UI tới form nháp) |
| `manager01` (WAREHOUSE_MANAGER) | 200 | 400 — qua cổng quyền, bị từ chối do dữ liệu, không tạo gì |
| `staff01` (WAREHOUSE_STAFF) | 403 | 403 |
| `librarian01` (LIBRARIAN) | 403 | 403 |
| không đăng nhập | 401 | — |

- Seed không có vai trò `INVENTORY_MANAGER`; quyền tạo PO là `inventory.purchase.write` (frontend: `ROUTE_ACCESS.purchaseWrite`, backend: `authorizePurchaseManager`). Người không có quyền không tạo được PO qua API dù gọi trực tiếp.
- **Hạn chế nghiệp vụ:** phân bổ dùng tồn **toàn hệ thống** (`declareDataScope('SYSTEM')`, SUM `stock_balances` mọi kho). Backend hỗ trợ `priorityWarehouseId` (kiểm UUID + quyền đọc kho), nhưng **frontend không gửi** (chỉ Copilot dùng). Không triển khai chọn kho trong lần này — xem §9-B.

## 7. Test đã thêm/sửa và kết quả thực tế [ĐO]

| Test | Nội dung | Kết quả |
|---|---|---|
| `services/analytics-service/test/reorder-budget-endpoint.test.js` (mới, 9) | controller thật, DB thay bằng fixture: không ngân sách; dòng chưa có giá không được cấp ở 0/10k/500k/50M; tổng khớp + không vượt ngân sách + không vượt trần ở 0/10k/500k/530k/50M; dòng được cấp ngoài `limit` được trả về (`limit=1`); không ngân sách giữ `limit`; PO đang về giảm trần + truy vấn đúng trạng thái và `ordered − received`; < 30 lượt trả → không tính bản trả; bản trả không vượt `borrowed_qty`; ngân sách âm/chữ → lỗi | 9/9 pass. Trước khi sửa, 3 test fail đúng lỗi: cấp 2 bản cho dòng chưa có giá với ngân sách 0; dòng được cấp bị ẩn; tính 4 bản trả khi kho ghi 1 (một fail khác ở lần chạy đầu là kỳ vọng do tôi tính sai — nhu cầu 530.000 đ > 500.000 đ — đã sửa test) |
| `services/analytics-service/test/expected-returns.test.js` (mới, 5) | ngưỡng 30 lượt; trả đúng hạn; trả trễ (hai nhóm 14/60 ngày); khoản vay quá hạn lâu hơn mọi lượt từng trả; khoản vay mở làm giảm xác suất trả (censoring) | 5/5 pass |
| `apps/web/tests/reorder-intelligence.test.mjs` (sửa + 3 mới) | `systemQty(funded 0) = 0` (sửa test cũ sai); `cap_qty = 0` → không có số lượng; `NO_PRICE`; dòng chưa được cấp không có số lượng mặc định, gõ tay → `overFunded`; tổng bản vượt phần cấp | 4 fail trước sửa → pass |
| `apps/web/e2e/reorder-budget.spec.ts` (mới) | stack thật: nhập 5.000.000 + Enter → request có `budgetVnd` → kiểm tổng/trần/giá → mọi ô số lượng = `funded_qty` (0 → trống) → chọn dòng được cấp → form PO nháp nhận đúng `ordered_qty`; không lưu | 1 passed (Edge, `BASE_URL` 5174, cấu hình tạm đã xóa) |
| Kịch bản Playwright thủ công (§2) | toàn bộ 20 bước người dùng + race + responsive | xem §2 |

## 8. Trạng thái build / lint / test [ĐO]

| Lệnh | Kết quả |
|---|---|
| `pnpm --filter web test:unit` (= `pnpm test:web`) | 49/49 pass |
| `pnpm --filter analytics-service test` | 151 test: 148 pass, 3 skip (có sẵn), 0 fail |
| `pnpm test:node` (shared, gateway, auth, inventory, borrow, analytics) | exit 0, 0 fail (log có cảnh báo Redis/RabbitMQ giả lập là bình thường của test) |
| `pnpm --filter web exec tsc --noEmit` | 0 lỗi |
| `pnpm --filter web build` | thành công |
| `pnpm lint` | exit 0 |
| Playwright E2E | spec mới pass; **chưa chạy toàn bộ bộ E2E** của repo |
| `services/ai-service` (pytest) | [CHƯA] không chạy — Python không đổi; Copilot chỉ nhận thêm dòng được cấp |

## 9. Đề xuất chức năng mở rộng (Phase 7)

| Hướng | Phân loại | Lý do |
|---|---|---|
| E. Đường chi phí – mức phục vụ (`service_curve` đã có) | **Nên làm tiếp theo** | Backend đã trả `cost_for_service_pct` 90/95/99/100 và `full_plan_cost`; chỉ cần hiển thị. Phải ghi rõ đây là mức phục vụ **theo mô hình Poisson**, không phải fill rate thực tế. |
| G. Cảnh báo độ tin cậy dự báo | **Cần thiết ngay** (mức tối thiểu) | Trên dữ liệu dev mọi dòng có nhu cầu thời gian chờ = 0 → `expected_service_pct = null` và phân bổ chỉ còn dựa trên tồn an toàn; tài liệu §4.1 ghi nhận 67/68 bản dồn vào một đầu sách vì gần như chỉ dòng đó có dự báo > 0. Nên báo số dòng có dự báo > 0 và cờ "ít dữ liệu". |
| A. Mô phỏng nhiều mức ngân sách | Nên làm tiếp theo | Copilot đã làm (`simulate_reorder_budget`); có thể đưa lên UI bằng nhiều lời gọi hoặc đọc từ `service_curve` thay vì gọi lại. |
| D. Giới hạn tỷ trọng một đầu sách | **Có rủi ro nếu triển khai vội** | Tài liệu đánh giá yêu cầu backtest bằng đúng giao thức trước khi đặt mặc định; không hardcode tỷ lệ. |
| B. Phân bổ theo kho | Nên làm tiếp theo, sau khi chốt quy tắc | Backend sẵn `priorityWarehouseId` + kiểm quyền kho; cần quyết định: ai được chọn kho nào, PO nháp có gán kho nhận không, tồn của kho khác có được tính hay không. |
| C. Ràng buộc nhà cung cấp (MOQ, lô, chiết khấu, giá theo NCC) | Chưa cần thiết | Chưa có dữ liệu MOQ/bậc giá trong schema; thay đổi lớn cả thuật toán lẫn dữ liệu. |
| F. Lưu/duyệt kế hoạch, đối chiếu chi tiêu thực | Chưa cần thiết cho khóa luận | Cần bảng mới, luồng duyệt và quyền mới; hiện PO nháp + quy trình duyệt PO đã đóng vai trò kiểm soát. |

## 10. Chưa xác minh / hạn chế còn lại

1. [CHƯA] Không đăng nhập production để đo; không kiểm image Docker trên VPS. Kết luận về nguyên nhân dựa trên việc code production trùng HEAD và dữ liệu dev; nếu dữ liệu production cũng có khoản vay mở trong borrow_db không khớp `borrowed_qty` (bộ dữ liệu demo được nạp cả production), B2 xảy ra y hệt.
2. [CẦN] B2 sửa triệu chứng ở tầng phân tích; **nguyên nhân gốc là dữ liệu lệch giữa borrow_db và inventory_db** (khoản vay seed không đi qua luồng `reserved → borrowed`). Nên đối soát dữ liệu demo hoặc seed lại cho nhất quán.
3. [CẦN] Dữ liệu seed không có dòng chưa có giá và không có dòng được cấp ngoài top 20 → UI trạng thái "Chưa có đơn giá" và gợi ý "+K dòng được cấp ngân sách" chỉ được kiểm bằng unit/controller test và type-check, chưa thấy trên dữ liệu thật.
4. Tablet 768 px: trang tràn ngang 136 px do bảng `min-w-[960px]` (ẩn vùng bảng → hết tràn). Bảng không nằm trong thay đổi này nên không sửa; ghi nhận để xử lý riêng.
5. `allocateMarginal` vẫn coi giá 0 là miễn phí (giữ nguyên vì backtest `eval/reorder-policies.js` dùng chung); production loại dòng chưa có giá ở controller.
6. Hệ thống không có khái niệm "sách miễn phí đã xác nhận"; nếu cần, phải thêm trường dữ liệu riêng thay vì dùng `unit_cost = 0`.
7. Ngân sách vẫn áp dụng trên tồn toàn hệ thống (§6).

## 11. File đã thay đổi

- `services/analytics-service/src/controllers/analytics.controller.js`
- `services/analytics-service/test/reorder-budget-endpoint.test.js` (mới), `services/analytics-service/test/expected-returns.test.js` (mới)
- `apps/web/src/lib/reorder-intelligence.ts`, `apps/web/src/services/analytics.ts`
- `apps/web/src/components/pages/reorder-suggestions.tsx`
- `apps/web/src/components/reorder-intelligence/{budget-planner,reorder-detail,reorder-table,reorder-workspace,selection-action-bar}.tsx`
- `apps/web/tests/reorder-intelligence.test.mjs`, `apps/web/e2e/reorder-budget.spec.ts` (mới)
- `docs/ANALYSIS/REORDER_BUDGET_AUDIT.md` (báo cáo này)

Môi trường cục bộ: container `analytics-service` đã được rebuild từ working tree để kiểm thử.
