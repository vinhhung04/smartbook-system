# AI Inventory Rebalancing — Semantic Test Report

Ngày chạy: 20/11/2026. Nhánh `hungg` (chưa commit).

## Cách kiểm thử

- Dữ liệu: [`services/ai-service/eval/rebalancing_semantic_dataset.json`](../services/ai-service/eval/rebalancing_semantic_dataset.json) — 14 intent nghiệp vụ, mỗi intent ≥ 5 cách diễn đạt (chuẩn, tự nhiên, ngắn, đồng nghĩa, lỗi chính tả / không dấu, phụ thuộc ngữ cảnh, nhiều yêu cầu), cộng các ca hỏi lại, tách intent và hồi quy (câu không thuộc tính năng).
- Mỗi câu được lập kế hoạch bằng **planner thật** (`copilot_plan.build_plan`, phần luật — không gọi LLM) sau các lượt ngữ cảnh của nó; trạng thái hội thoại được mang qua bằng `next_state` như khi chạy thật.
- "Intent thực tế" là danh sách `focus` planner đọc được (ý chính đứng đầu); một câu có thể mang nhiều intent. Không bắt buộc mọi câu gọi cùng một tool: câu chẩn đoán / thiếu sách có thể dùng tool tồn kho theo kho đã có.
- Lệnh: `pytest services/ai-service/test_rebalance_planner.py` (assert) và `python services/ai-service/eval/rebalancing_semantic_report.py` (bảng dưới).
- Nhánh semantic planner dùng LLM (`COPILOT_SEMANTIC_PLANNER=on`) chỉ được gọi khi luật trông chưa đủ; bảng này **không** đo nhánh đó. Hành vi end-to-end có LLM được đo trong Chatbox Test Report.

## Lịch sử kết quả (trung thực)

| Lần | Bộ câu | Kết quả | Ghi chú |
|---|---|---|---|
| 1 | 82 câu + 18 lượt | 85/100 | Sai chủ yếu: câu chẩn đoán "phân tích tồn kho các kho" đi route cũ nên các lượt sau mất ngữ cảnh; "giảm tiếp 20%", "chuyển hàng hay nhập", "tiền phạt" giữa hội thoại bị hiểu nhầm |
| 2 | sau khi sửa planner | 100/100 | Sửa ở planner (từ vựng, ngữ cảnh), không hardcode câu |
| 3 | 12 câu held-out viết sau, chưa dùng chỉnh luật | **7/12** | Sai: "san sẻ", "ôm nhiều sách", "cân đối hàng", "mua … hay chuyển", "nhu cầu tăng 20%" |
| 4 | held-out sau khi bổ sung | 11/12 | "nhu cầu tăng 20%" cần tham số what-if nhu cầu (Phase 4) |
| 5 | toàn bộ, sau Phase 4 | 82/82, 18/18, 12/12 | Bảng dưới là lần chạy này |

Kết luận đúng mức: luật bao phủ tốt các cách nói đã gặp; held-out lần đầu chỉ 7/12 cho thấy cách nói hoàn toàn mới vẫn có thể trượt và cần nhánh LLM (semantic planner) hoặc bổ sung từ vựng.

### Bộ biến thể (82/82 PASS)

| ID | Kiểu | Câu hỏi | Intent dự kiến | Intent thực tế (focus) | Tool được gọi | Kết quả |
|---|---|---|---|---|---|---|
| diag-1 | standard | Phân tích tồn kho và nhu cầu của các kho giúp tôi. | INVENTORY_DIAGNOSIS | DEMAND_ANALYSIS, INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {} | PASS |
| diag-2 | natural | Tình hình nguồn sách hiện tại thế nào? | INVENTORY_DIAGNOSIS | TRANSFER_OPPORTUNITY, INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {} | PASS |
| diag-3 | synonym | Kiểm tra tình trạng hàng hóa toàn hệ thống. | INVENTORY_DIAGNOSIS | INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {} | PASS |
| diag-4 | short | Tồn kho các kho sao rồi? | INVENTORY_DIAGNOSIS | - | get_warehouse_stock_risk {} | PASS |
| diag-5 | typo | phan tich ton kho va nhu cau tung kho giup minh | INVENTORY_DIAGNOSIS | DEMAND_ANALYSIS, INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {} | PASS |
| diag-6 | natural | Xem giúp tôi kho nào cần bổ sung hàng. | INVENTORY_DIAGNOSIS | SHORTAGE_DETECTION, INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {} | PASS |
| short-1 | standard | Hiện tại kho nào đang thiếu sách? | SHORTAGE_DETECTION | - | get_warehouse_stock_risk {} | PASS |
| short-2 | natural | Kho TP.HCM đang thiếu những sách nào? | SHORTAGE_DETECTION | - | get_warehouse_low_stock_items {"warehouse": "Kho HCM Chinh"}; get_warehouse_stock_risk {} | PASS |
| short-3 | multi | Kho nào thiếu, kho nào dư sách? | SHORTAGE_DETECTION | SURPLUS_DETECTION, SHORTAGE_DETECTION | analyze_inventory_rebalancing {} | PASS |
| short-4 | typo | thieu sach o kho hcm ko | SHORTAGE_DETECTION | - | get_warehouse_low_stock_items {"warehouse": "Kho HCM Chinh"}; get_warehouse_stock_risk {} | PASS |
| short-5 | context | Tìm sách thiếu tại TP.HCM. | SHORTAGE_DETECTION | SHORTAGE_DETECTION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| surplus-1 | standard | Có kho nào đang tồn quá nhiều sách không? | SURPLUS_DETECTION | SURPLUS_DETECTION | analyze_inventory_rebalancing {} | PASS |
| surplus-2 | short | Kho nào đang dư sách? | SURPLUS_DETECTION | SURPLUS_DETECTION | analyze_inventory_rebalancing {} | PASS |
| surplus-3 | synonym | Sách nào đang dư thừa ở các kho? | SURPLUS_DETECTION | SURPLUS_DETECTION | analyze_inventory_rebalancing {} | PASS |
| surplus-4 | typo | kho nao du thua sach | SURPLUS_DETECTION | SURPLUS_DETECTION | analyze_inventory_rebalancing {} | PASS |
| surplus-5 | natural | Kho Hà Nội có thừa sách gì không? | SURPLUS_DETECTION | SURPLUS_DETECTION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho Ha Noi"]} | PASS |
| demand-1 | standard | Phân tích nhu cầu của từng kho. | DEMAND_ANALYSIS | DEMAND_ANALYSIS, INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {} | PASS |
| demand-2 | natural | Nhu cầu dự kiến ở kho Đà Nẵng thế nào? | DEMAND_ANALYSIS | DEMAND_ANALYSIS | analyze_inventory_rebalancing {} | PASS |
| demand-3 | synonym | Dự báo nhu cầu các kho trong thời gian tới. | DEMAND_ANALYSIS | DEMAND_ANALYSIS | analyze_inventory_rebalancing {} | PASS |
| demand-4 | typo | nhu cau tung kho the nao | DEMAND_ANALYSIS | DEMAND_ANALYSIS | analyze_inventory_rebalancing {} | PASS |
| demand-5 | context | Còn nhu cầu thì sao? | DEMAND_ANALYSIS | DEMAND_ANALYSIS | analyze_inventory_rebalancing {} | PASS |
| transfer-1 | standard | Tìm sách có thể chuyển về TP.HCM. | TRANSFER_OPPORTUNITY | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| transfer-2 | natural | Kho nào dư sách để hỗ trợ TP.HCM? | TRANSFER_OPPORTUNITY | TRANSFER_OPPORTUNITY, SURPLUS_DETECTION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| transfer-3 | context | Có thể lấy sách từ kho khác bù cho kho TP.HCM không? | TRANSFER_OPPORTUNITY | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| transfer-4 | synonym | Tận dụng hàng tồn ở các kho để giảm tiền nhập mới. | TRANSFER_OPPORTUNITY | PROCUREMENT_OPTIMIZATION, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {} | PASS |
| transfer-5 | synonym | Tìm nguồn hàng nội bộ thay vì đặt mua. | TRANSFER_OPPORTUNITY | PROCUREMENT_OPTIMIZATION, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {} | PASS |
| transfer-6 | typo | tim sach co the chuyn ve tp hcm | TRANSFER_OPPORTUNITY | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| transfer-7 | natural | Tìm phương án điều phối sách giữa các kho. | TRANSFER_OPPORTUNITY | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {} | PASS |
| qty-1 | standard | Tính số lượng điều chuyển an toàn cho kho TP.HCM. | TRANSFER_QUANTITY | TRANSFER_QUANTITY, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| qty-2 | natural | Nên chuyển bao nhiêu cuốn về kho HCM cho an toàn? | TRANSFER_QUANTITY | TRANSFER_QUANTITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| qty-3 | synonym | Mỗi kho nguồn chuyển được tối đa bao nhiêu mà không bị thiếu? | TRANSFER_QUANTITY | TRANSFER_QUANTITY, SHORTAGE_DETECTION | analyze_inventory_rebalancing {} | PASS |
| qty-4 | typo | sl dieu chuyen an toan ve kho hcm | TRANSFER_QUANTITY | TRANSFER_QUANTITY, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| qty-5 | context | Vậy chuyển bao nhiêu là an toàn? | TRANSFER_QUANTITY | TRANSFER_QUANTITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| proc-1 | context | Nếu không đủ thì mua thêm bao nhiêu? | PROCUREMENT_OPTIMIZATION | WHAT_IF, HYBRID_DECISION, PROCUREMENT_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| proc-2 | standard | Sau khi điều chuyển, cần mua thêm bao nhiêu sách cho kho HCM? | PROCUREMENT_OPTIMIZATION | PROCUREMENT_OPTIMIZATION, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| proc-3 | short | Phần còn thiếu thì phải nhập bao nhiêu? | PROCUREMENT_OPTIMIZATION | HYBRID_DECISION, PROCUREMENT_OPTIMIZATION, SHORTAGE_DETECTION | analyze_inventory_rebalancing {} | PASS |
| proc-4 | multi | TP.HCM đang thiếu sách, xem thử kho nào có thể hỗ trợ và nếu không đủ thì cần mua thêm bao nhiêu. | PROCUREMENT_OPTIMIZATION | WHAT_IF, HYBRID_DECISION, PROCUREMENT_OPTIMIZATION, TRANSFER_OPPORTUNITY, SHORTAGE_DETECTION, INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {} | PASS |
| proc-5 | synonym | Mua bổ sung bao nhiêu sau khi tận dụng tồn các kho? | PROCUREMENT_OPTIMIZATION | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {} | PASS |
| hybrid-1 | short | Nên chuyển hàng hay nhập thêm? | HYBRID_DECISION | HYBRID_DECISION, PROCUREMENT_OPTIMIZATION, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {} | PASS |
| hybrid-2 | natural | Có cách nào kết hợp hàng tồn và mua mới không? | HYBRID_DECISION | DECISION_COMPARISON, HYBRID_DECISION, PROCUREMENT_OPTIMIZATION | analyze_inventory_rebalancing {} | PASS |
| hybrid-3 | synonym | Tận dụng nguồn hàng hiện có rồi mua phần còn thiếu. | HYBRID_DECISION | HYBRID_DECISION, TRANSFER_OPPORTUNITY, SHORTAGE_DETECTION | analyze_inventory_rebalancing {} | PASS |
| hybrid-4 | standard | So sánh điều chuyển với đặt hàng nhà cung cấp. | HYBRID_DECISION | DECISION_COMPARISON, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {} | PASS |
| hybrid-5 | typo | nen chuyn hang hay nhap them | HYBRID_DECISION | HYBRID_DECISION, PROCUREMENT_OPTIMIZATION, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {} | PASS |
| budget-1 | context | Tôi có 15 triệu, hãy phân bổ hợp lý. | BUDGET_OPTIMIZATION | BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| budget-2 | standard | Với 15 triệu thì nên nhập những sách nào? | BUDGET_OPTIMIZATION | - | simulate_reorder_budget {"budgets_vnd": [15000000]} | PASS |
| budget-3 | context | Tối ưu chi phí mua sách trong giới hạn 10 triệu. | BUDGET_OPTIMIZATION | BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 10000000} | PASS |
| budget-4 | context | Nếu chỉ còn 12 triệu thì sao? | BUDGET_OPTIMIZATION | WHAT_IF, BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000}; analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 12000000} | PASS |
| budget-5 | typo | dieu chuyen ve kho hcm voi ngansach 15tr | BUDGET_OPTIMIZATION | BUDGET_OPTIMIZATION, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| whatif-1 | context | Nếu ngân sách giảm 20%, mức đáp ứng thay đổi thế nào? | WHAT_IF | WHAT_IF, BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000}; analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 12000000} | PASS |
| whatif-2 | context | Giảm tiếp 20% nhé. | WHAT_IF | WHAT_IF | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 12000000}; analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 9600000} | PASS |
| whatif-3 | context | Tăng ngân sách thêm 30% thì sao? | WHAT_IF | WHAT_IF, BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000}; analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 19500000} | PASS |
| whatif-4 | context | Giữ nguyên mọi thứ, chỉ tăng ngân sách lên 20 triệu. | WHAT_IF | BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 20000000} | PASS |
| whatif-5 | context | giam them 5 trieu thi sao | WHAT_IF | WHAT_IF, BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000}; analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 10000000} | PASS |
| cmp-1 | context | So sánh ba phương án: chỉ điều chuyển, chỉ mua mới và kết hợp. | DECISION_COMPARISON | DECISION_COMPARISON, HYBRID_DECISION, PROCUREMENT_OPTIMIZATION, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| cmp-2 | context | Vậy phương án nào tốt hơn? | DECISION_COMPARISON | DECISION_COMPARISON | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 12000000} | PASS |
| cmp-3 | context | So sánh với phương án lúc nãy. | DECISION_COMPARISON | DECISION_COMPARISON | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000}; analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 12000000} | PASS |
| cmp-4 | short | Phương án nào hiệu quả nhất? | DECISION_COMPARISON | DECISION_COMPARISON | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| cmp-5 | typo | so sanh 3 phuong an giup toi | DECISION_COMPARISON | DECISION_COMPARISON | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| why-1 | context | Tại sao không chọn Hà Nội? | DECISION_EXPLANATION | DECISION_EXPLANATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| why-2 | context | Vì sao lại đề xuất mua thay vì chuyển? | DECISION_EXPLANATION | DECISION_EXPLANATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| why-3 | context | Giải thích căn cứ của phương án này. | DECISION_EXPLANATION | DECISION_EXPLANATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| why-4 | context | Tôi cần Manager khác phối hợp như thế nào? | DECISION_EXPLANATION | DECISION_EXPLANATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| why-5 | short | vi sao vay | DECISION_EXPLANATION | DECISION_EXPLANATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| draft-1 | context | Tạo bản nháp cho phương án đó. | CREATE_DRAFT | CREATE_DRAFT | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 12000000} | PASS |
| draft-2 | context | Tôi đồng ý với phương án 15 triệu ban đầu. Hãy tạo bản nháp yêu cầu điều chuyển và mua mới. | CREATE_DRAFT | CREATE_DRAFT, BUDGET_OPTIMIZATION, PROCUREMENT_OPTIMIZATION, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| draft-3 | context | Lập phiếu điều chuyển theo phương án vừa chọn. | CREATE_DRAFT | CREATE_DRAFT, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| draft-4 | typo | tao ban nhap giup toi | CREATE_DRAFT | CREATE_DRAFT | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| draft-5 | standard | Soạn yêu cầu điều chuyển sách về kho HCM. | CREATE_DRAFT | CREATE_DRAFT, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| confirm-1 | context | Tôi xác nhận. | CONFIRM_ACTION | CONFIRM_ACTION | (không gọi tool) | PASS |
| confirm-2 | standard | Tôi xác nhận. Hãy kiểm tra lại quyền và tồn kho rồi thực hiện các yêu cầu hợp lệ. | CONFIRM_ACTION | CONFIRM_ACTION, INVENTORY_DIAGNOSIS | (không gọi tool) | PASS |
| confirm-3 | natural | OK, thực hiện phương án này đi. | CONFIRM_ACTION | CONFIRM_ACTION | (không gọi tool) | PASS |
| confirm-4 | typo | xac nhan nhe | CONFIRM_ACTION | CONFIRM_ACTION | (không gọi tool) | PASS |
| confirm-5 | synonym | Tôi đồng ý, thực hiện bản nháp. | CONFIRM_ACTION | CONFIRM_ACTION, CREATE_DRAFT | (không gọi tool) | PASS |
| clarify-1 | short | Điều chuyển sách giúp tôi. | CLARIFICATION | - | (hỏi lại) Bạn muốn bổ sung sách cho kho nào? Hoặc tôi có thể phân tích | PASS |
| clarify-2 | context | Giảm 20% ngân sách thì sao? | CLARIFICATION | - | (hỏi lại) Bạn muốn giảm 20% so với ngân sách mua nào? Kịch bản hiện tạ | PASS |
| clarify-3 | context | Điều chuyển sách giúp tôi. | CLARIFICATION | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| sep-1 | context | Phê duyệt luôn giúp tôi. | APPROVAL_REFUSED | - | (hỏi lại) Tôi không phê duyệt giao dịch thay bạn. Tôi có thể tạo bản n | PASS |
| neg-1 | regression | Tỷ lệ đặt chỗ chuyển thành mượn là bao nhiêu? | OTHER | - | get_reservation_funnel {} | PASS |
| neg-2 | regression | Đề xuất thanh lý sách cũ. | OTHER | - | get_weeding_suggestions {} | PASS |
| neg-3 | regression | Kho có đủ sách Dế Mèn không? | OTHER | - | (không gọi tool) | PASS |
| neg-4 | regression | Lượt mượn tháng này so với tháng trước? | OTHER | - | compare_borrow_periods {"from_date": "2026-11-01T00:00:00+07:00", "to_date": "2026-11-20T09:00:00+07:00", "compare_from_date": "2026-10-01T00:00:00+07:00", "compare_to_date": "2026-10-31T23:59:59+07:00"} | PASS |
| neg-5 | regression | Tiền phạt chưa thu là bao nhiêu? | OTHER | - | get_fine_summary {} | PASS |

### Hội thoại nhiều lượt

| Hội thoại | Lượt | Câu hỏi | Focus | Tool | Kết quả |
|---|---|---|---|---|---|
| A | 1 | Phân tích tồn kho các kho giúp tôi. | INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {} | PASS |
| A | 2 | Tìm nguồn điều chuyển cho kho TP.HCM. | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| A | 3 | So sánh với mua mới. | DECISION_COMPARISON, PROCUREMENT_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| A | 4 | Ngân sách 15 triệu thôi. | BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| A | 5 | Giảm 20% ngân sách. | WHAT_IF, BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000}; analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 12000000} | PASS |
| A | 6 | Chọn phương án ban đầu. | INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| A | 7 | Tạo bản nháp. | CREATE_DRAFT | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| B | 1 | Phân tích các kho. | - | get_warehouse_stock_risk {} | PASS |
| B | 2 | Kho nào dư sách? | SURPLUS_DETECTION | analyze_inventory_rebalancing {} | PASS |
| B | 3 | Tìm sách thiếu tại TP.HCM. | SHORTAGE_DETECTION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| B | 4 | Nếu không đủ thì mua thêm. | WHAT_IF, HYBRID_DECISION, PROCUREMENT_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| B | 5 | Ngân sách chỉ còn 10 triệu. | BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 10000000} | PASS |
| B | 6 | So sánh với phương án trước. | DECISION_COMPARISON | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]}; analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 10000000} | PASS |
| C | 1 | Phân tích tồn kho các kho. | INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {} | PASS |
| C | 2 | Tìm nguồn điều chuyển về kho TP.HCM. | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| C | 3 | Tại sao không chọn Hà Nội? | DECISION_EXPLANATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| C | 4 | Tôi cần Manager khác phối hợp như thế nào? | DECISION_EXPLANATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| C | 5 | Tạo bản nháp cho phương án có thể thực hiện. | CREATE_DRAFT | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |

18/18 lượt PASS.

### Câu held-out (không dùng để chỉnh luật ở lần chạy đầu)

| Câu hỏi | Ngữ cảnh | Intent dự kiến | Focus thực tế | Tool | Kết quả |
|---|---|---|---|---|---|
| Kho Đà Nẵng có thể san sẻ sách cho HCM không? | - | TRANSFER_OPPORTUNITY | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| Muốn giảm tiền nhập hàng, tận dụng sách đang dư ở các kho khác | - | TRANSFER_OPPORTUNITY | TRANSFER_OPPORTUNITY, SURPLUS_DETECTION | analyze_inventory_rebalancing {}; get_borrow_trends {} | PASS |
| Ngân sách còn 10 triệu thôi, tính lại phương án giúp tôi | transfer | BUDGET_OPTIMIZATION | BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 10000000} | PASS |
| Chuyển sách từ Hà Nội về kho HCM được không? | - | TRANSFER_OPPORTUNITY | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]} | PASS |
| Dùng lại ngân sách ban đầu | whatif12 | BUDGET_OPTIMIZATION | BUDGET_OPTIMIZATION | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| Quay lại phương án trước | whatif12 | (khôi phục kịch bản) | INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |
| Chỉ thay đổi kho đích sang Đà Nẵng | budget15 | (khôi phục kịch bản) | INVENTORY_DIAGNOSIS | analyze_inventory_rebalancing {"destination_warehouses": ["Kho Da Nang"], "budget_vnd": 15000000} | PASS |
| Có nên mua mới hết không hay chuyển từ kho khác? | - | HYBRID_DECISION | HYBRID_DECISION, PROCUREMENT_OPTIMIZATION, TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {} | PASS |
| Kho nào đang ôm nhiều sách quá? | - | SURPLUS_DETECTION | SURPLUS_DETECTION | analyze_inventory_rebalancing {} | PASS |
| Cân đối hàng giữa ba kho giúp tôi | - | TRANSFER_OPPORTUNITY | TRANSFER_OPPORTUNITY | analyze_inventory_rebalancing {} | PASS |
| Nhu cầu tăng 20% thì cần chuyển thêm bao nhiêu? | transfer | WHAT_IF | WHAT_IF, DEMAND_ANALYSIS | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"]}; analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "demand_change_pct": 20.0} | PASS |
| Lên bản nháp yêu cầu nhé | budget15 | CREATE_DRAFT | CREATE_DRAFT | analyze_inventory_rebalancing {"destination_warehouses": ["Kho HCM Chinh"], "budget_vnd": 15000000} | PASS |

12/12 câu held-out PASS (chạy hiện tại).

## Trường hợp cần cải thiện

- Cách nói chưa gặp vẫn có thể không được nhận ra bằng luật (held-out lần đầu 7/12); nhánh semantic planner LLM là lớp bù nhưng chưa có bộ đo riêng cho tính năng này.
- Nhận diện "dư" dựa trên chữ có dấu; gõ không dấu "du" bị mơ hồ với "đủ" nên chỉ nhận các dạng không nhầm ("dư thừa", "tồn quá nhiều", "ôm nhiều sách").
- Tên kho không có tiền tố "kho" chỉ được nhận sau các giới từ "về / cho / sang / tại / hỗ trợ"; câu nêu tên kho trần ở vị trí khác có thể cần hỏi lại.
