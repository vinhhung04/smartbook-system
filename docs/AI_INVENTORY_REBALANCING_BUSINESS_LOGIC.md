# AI Inventory Rebalancing & Procurement Decision — Logic nghiệp vụ

Nguồn: `services/analytics-service/src/utils/rebalancing.js`, `src/controllers/rebalancing.controller.js`, `src/utils/reorder-suggestion.js`.

## 1. Đơn vị tính

Một **dòng** = (kho, variant) trong các kho người dùng **được đọc** và đang hoạt động. Nối theo `variant_id` + `warehouse_id`, không theo tên sách. Một dòng tồn tại khi có tồn kho, có nhu cầu, hoặc có hàng đang về.

## 2. Số liệu của một dòng

| Đại lượng | Cách tính |
|---|---|
| Tồn khả dụng | `SUM(stock_balances.available_qty)` của kho đó |
| Hàng mua đang về | `SUM(ordered_qty − received_qty)` các PO của kho, trạng thái APPROVED / SENT_TO_SUPPLIER / SUPPLIER_CONFIRMED / PARTIALLY_RECEIVED / SHORTAGE_REPORTED, trừ dòng đã đóng |
| Hàng điều chuyển đang về | `SUM(quantity − received_qty)` các transfer tới kho, trạng thái REQUESTED / APPROVED / PICKING / IN_TRANSIT |
| Đã hứa chuyển đi | `SUM(quantity − shipped_qty)` các transfer đi từ kho, trạng thái REQUESTED / APPROVED / PICKING (tồn chỉ bị trừ ở bước picking) |
| Bản dự kiến được trả | Kaplan-Meier trên lịch sử trả (như budget mode), giới hạn bởi `borrowed_qty` |
| Nhu cầu | Phiếu mượn + đặt chỗ **tại chính kho đó**; dự báo EWMA + xu hướng + mùa vụ qua thời gian chờ hàng học từ lịch sử (`calculateSuggestion`) |
| Tồn an toàn | max(reorder_point, safety_stock_qty, 1,645·σ·√lead time, 2 nếu có nhu cầu) |
| Vị thế tồn | tồn khả dụng + mua đang về + điều chuyển đang về − đã hứa đi + bản dự kiến trả |
| Mức cần giữ | nhu cầu trong thời gian chờ + tồn an toàn |

Dòng mà số phiếu mượn mở > số bản kho ghi đang cho mượn được đánh dấu `BORROW_INVENTORY_MISMATCH`: không tính thiếu, không tính dư, không đề xuất (đếm trong `totals.unreliable_lines`).

## 3. Thiếu, dư, số lượng điều chuyển an toàn

- **Thiếu** = ⌈mức cần giữ − vị thế⌉ nếu dương.
- **Dư** = min(tồn khả dụng − đã hứa đi, ⌊vị thế − mức cần giữ⌋) nếu dương. Hàng đang về không chuyển được vì chưa có trên kệ; kho nguồn không bao giờ bị đưa xuống dưới mức cần giữ.
- **Ghép**: theo từng variant, kho đích xếp theo ưu tiên (HIGH trước) rồi theo số thiếu; kho nguồn theo số dư giảm dần, nếu bằng nhau thì kho người dùng tự làm được đứng trước. Một nguồn phục vụ nhiều đích từ cùng một quỹ dư → không tính trùng một bản. Mỗi dòng điều chuyển ghi tồn kho nguồn còn lại và mức cần giữ.

## 4. Bốn phương án (không mặc định Hybrid tốt nhất)

| Mã | Nội dung |
|---|---|
| TRANSFER_ONLY | Mọi điều chuyển an toàn, không mua |
| PROCUREMENT_ONLY | Mua toàn bộ thiếu hụt |
| HYBRID | Điều chuyển trước, mua phần còn thiếu |
| HYBRID_EXECUTABLE | Như HYBRID nhưng chỉ gồm việc người dùng tự làm được (chỉ xuất hiện khi HYBRID có việc cần người khác) |

Chỉ số mỗi phương án: tổng thiếu, bản điều chuyển, bản mua, đã đáp ứng, còn thiếu (và phần HIGH), % đáp ứng thiếu hụt, chi phí mua, **chi phí điều chuyển = không có dữ liệu**, ngân sách còn, số dòng cần phối hợp, sách chưa có giá, thời gian điều chuyển (trung vị lịch sử, cần ≥ 3 mẫu, nếu không thì `null`), thời gian mua (lead time dài nhất), thời gian đáp ứng (chậm nhất; `null` khi thiếu dữ liệu của chặng nào), mức rủi ro (HIGH nếu còn thiếu HIGH; MEDIUM nếu còn thiếu, cần phối hợp, có sách chưa giá, hoặc thời gian điều chuyển không rõ).

**Xếp hạng cố định**: ít thiếu còn lại → ít thiếu HIGH còn lại → chi phí mua thấp → ít dòng cần phối hợp → ít thao tác → thứ tự cố định. Kết quả: `best_business_option` (tốt nhất về nghiệp vụ) và `executable_option` (tốt nhất trong các phương án mà mọi hành động đều do người dùng làm được).

## 5. Ngân sách

Chỉ áp cho mua mới. Phân bổ bằng `allocateMarginal` (từng bản, theo mức tăng phục vụ kỳ vọng trên mỗi đồng, mô hình Poisson) như reorder budget mode. Sách `unit_cost = 0` không được mua (báo trong `unpriced_lines`). Không bao giờ vượt ngân sách (đã kiểm thử với 0, thiếu, đủ).

## 6. What-if (chỉ thay đổi tham số được nêu)

| Tham số endpoint | Ý nghĩa |
|---|---|
| `budgetVnd` | Ngân sách mua; "giảm 20%" / "giảm thêm 5 triệu" do planner tính từ ngân sách kịch bản hiện tại |
| `demandChangePct` | Nhu cầu × (1 + %), áp cho kho đích (hoặc mọi kho khi không nêu đích) |
| `excludeSourceIds` | Kho nguồn không thể điều chuyển |
| `onlySourceIds` | Chỉ cho phép điều chuyển từ các kho này |
| `closedWarehouseIds` | Giả lập kho ngừng hoạt động: bỏ tồn và nhu cầu của kho đó |
| `safetyStockMultiplier` | Tồn an toàn × hệ số |
| `priority=HIGH` | Chỉ phục vụ dòng thiếu ưu tiên HIGH |
| `leadTimeDelayDays` | Nhà cung cấp giao chậm thêm N ngày |

Planner giữ điều kiện cũ của kịch bản và chỉ đổi tham số mới; lượt what-if gọi engine hai lần (kịch bản cũ, kịch bản mới), code tính chênh lệch và chiều tăng / giảm.

## 7. Giới hạn dữ liệu (nói rõ trong mọi câu trả lời)

- Chi phí điều chuyển không có trong SmartBook.
- Thời gian điều chuyển chỉ có khi đủ lịch sử; dev hiện không có mẫu.
- Hệ số mùa vụ là theo variant toàn thư viện (một tỷ lệ), nhu cầu là theo kho.
- Yêu cầu điều chuyển REQUESTED chưa duyệt vẫn được tính là hàng đang về / đã hứa đi (thận trọng, tránh đề xuất trùng).
- Đơn repick (REPICKING) không được tách riêng.
