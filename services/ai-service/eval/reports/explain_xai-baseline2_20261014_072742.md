# Explainable AI eval - xai-baseline2

Generated: 2026-10-14T07:27:42.575235+00:00  
Code dir: `/code`  
Model: qwen/qwen3.7-flash  
Turns: 50

## Overall

| Metric | Value |
|---|---|
| turns | 50 |
| http_ok_rate | 1.0 |
| answer_relevance | 0.9375 |
| evidence_coverage | 0.9612 |
| numeric_fact_recall | 0.9254 |
| answers_with_unverified_numbers | 0.0667 |
| faithfulness_no_overclaim | 0.8462 |
| causal_hedged | 0.8571 |
| faithfulness | 0.8205 |
| actionability | 0.6667 |
| style_adherence | 0.6667 |
| no_access_handled | 1.0 |
| not_found_handled | 0.5 |
| clarification_handled | 1.0 |
| median_chars_by_mode | {"-": 112, "analysis": 135, "causal": 1063, "comparison": 362, "decision": 1692, "lookup": 81, "ranking": 918, "what_if": 1012} |
| median_chars_lookup | 81 |
| words_per_sentence | 15.747 |
| repeated_number_rate | 0.1272 |
| filler_rate | 0.08 |
| technical_field_rate | 0.06 |
| card_duplication | 0.3562 |
| explanation_present | None |
| explanation_evidence_backed | None |
| explanation_mode_accuracy | None |
| explanation_language_flags_left | None |
| stream_tools_equal | 0.9 |
| stream_schema_equal | 1.0 |
| stream_coverage_equal | 0.9 |
| stream_explanation_equal | None |
| latency_p50_s | 10.18 |
| latency_p90_s | 25.27 |
| avg_llm_calls | 1.32 |

## By category

| Category | turns | relevance | coverage | unverified | no overclaim | actionable | style | p50 chars |
|---|---|---|---|---|---|---|---|---|
| ambiguous | 3 | None | None | 0.0 | None | None | None | 112 |
| analysis | 5 | 1.0 | 1.0 | 0.0 | 1.0 | None | None | 135 |
| causal | 5 | None | 1.0 | 0.0 | 1.0 | None | None | 792 |
| comparison | 5 | 1.0 | 0.9333 | 0.0 | 1.0 | None | None | 689 |
| decision | 5 | 1.0 | 0.8 | 0.0 | 0.8 | 1.0 | None | 1357 |
| incomplete_simulation | 2 | None | 1.0 | 0.5 | 0.0 | 0.5 | None | 1519 |
| lookup | 5 | 1.0 | 1.0 | 0.0 | None | None | None | 77 |
| missing_data | 2 | None | None | 0.5 | 1.0 | None | None | 862 |
| multi_turn | 11 | 0.6667 | 1.0 | 0.1 | 0.9091 | 0.3333 | 0.6667 | 1682 |
| no_access | 3 | None | 1.0 | 0.0 | 1.0 | 1.0 | None | 136 |
| what_if | 4 | 1.0 | 0.9167 | 0.0 | 0.5 | 0.5 | None | 910 |

## Streaming vs non-streaming

| Case | tools | schema | coverage | explanation |
|---|---|---|---|---|
| an-01 | True | True | [1.0, 1.0] | None |
| cp-01 | True | True | [1.0, 1.0] | None |
| cp-02 | True | True | [1.0, 1.0] | None |
| ca-01 | True | True | [1.0, 1.0] | None |
| de-01 | False | True | [1.0, 1.0] | None |
| de-02 | True | True | [0.5, 0.5] | None |
| wi-01 | True | True | [0.667, 1.0] | None |
| wi-03 | True | True | [1.0, 1.0] | None |
| lk-02 | True | True | [1.0, 1.0] | None |
| na-01 | True | True | [None, None] | None |

## Turns

### lk-01#0 — Có bao nhiêu đầu sách trong thư viện?

tools: get_dashboard_kpis · 30 ký tự · coverage 1.0 · ok

> Thư viện hiện có 116 đầu sách.

### lk-02#0 — Có bao nhiêu phiếu mượn quá hạn?

tools: get_overdue_summary · 77 ký tự · coverage 1.0 · ok

> Hiện có 380 phiếu mượn quá hạn, với số ngày quá hạn trung bình là 234,2 ngày.

### lk-03#0 — Sách nào được mượn nhiều nhất 30 ngày qua?

tools: get_top_books · 81 ký tự · coverage 1.0 · ok

> Sách được mượn nhiều nhất trong 30 ngày qua là "Norwegian Wood" với 68 lượt mượn.

### lk-04#0 — Tổng tiền phạt chưa thu là bao nhiêu?

tools: get_fine_summary · 41 ký tự · coverage 1.0 · ok

> Tổng tiền phạt chưa thu là 497.133.500 ₫.

### lk-05#0 — Danh sách sách hết hàng ở Kho HCM Chinh

tools: get_warehouse_low_stock_items, get_warehouse_stock_risk · 107 ký tự · coverage 1.0 · ok

> Danh sách 3 đầu sách đang hết hàng tại Kho HCM Chinh gồm:
> 
> - Thuyen bac nho
> - Dế Mèn Phiêu Lưu Ký
> - Tam Cam

### an-01#0 — Tình hình quá hạn thế nào?

tools: get_overdue_summary · 77 ký tự · coverage 1.0 · ok

> Hiện có 380 phiếu mượn quá hạn, với số ngày quá hạn trung bình là 234,2 ngày.

### an-02#0 — Đánh giá tình hình tồn kho giữa các kho

tools: get_warehouse_stock_risk, compare_warehouses · 342 ký tự · coverage 1.0 · ok

> Kho HCM Chinh đang có rủi ro tồn kho cao nhất với 3 đầu sách hết hàng và 7 đầu sách dưới ngưỡng, trong khi Chi Nhanh District 3 là kho an toàn nhất với 0 hết hàng và 0 dưới ngưỡng. Kho Ha Noi và Chi Nhanh District 1 có mức độ rủi ro trung gian, với District 1 có 1 đầu sách hết hàng và 1 dưới ngưỡng, còn Ha Noi chỉ có 1 đầu sách dưới ngưỡng.

### an-03#0 — Tình hình đặt chỗ ra sao?

tools: get_reservation_funnel · 101 ký tự · coverage 1.0 · ok

> Hiện có 8.210 phiếu đặt chỗ, trong đó 5.206 đã chuyển thành phiếu mượn với tỷ lệ chuyển đổi là 63,4%.

### an-04#0 — Tình hình tiền phạt thế nào?

tools: get_fine_summary · 180 ký tự · coverage 1.0 · ok

> Tổng tiền phạt chưa thu hiện là 497.133.500 ₫, trong khi tổng đã thu là 96.617.000 ₫. Loại phạt chiếm tỷ trọng lớn nhất là OVERDUE (quá hạn) với 589.136.000 ₫ trên 7656 khoản phạt.

### an-05#0 — Phân tích tình hình thư viện hôm nay

tools: get_dashboard_kpis · 135 ký tự · coverage 1.0 · ok

> Hôm nay thư viện có 116 đầu sách với 576 phiếu mượn đang mở, trong đó 380 phiếu đã quá hạn và tổng tiền phạt chưa thu là 497.133.500 ₫.

### cp-01#0 — Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?

tools: compare_warehouses · 362 ký tự · coverage 0.6666666666666666 · ok

> Kho HCM Chinh rủi ro hơn Kho Ha Noi.
> 
> **Căn cứ**
> - Hết hàng: 3 đầu sách (nhiều hơn 3 so với Kho Ha Noi).
> - Dưới ngưỡng tồn tối thiểu: 7 đầu sách (nhiều hơn 6 so với Kho Ha Noi).
> - Tồn khả dụng: 120 bản tại Kho HCM Chinh, 8 bản tại Kho Ha Noi.
> 
> **Lưu ý**
> - Tiêu chí xếp hạng ưu tiên số đầu sách hết hàng, sau đó đến số đầu sách dưới ngưỡng, rồi tổng tồn khả dụng.

### cp-02#0 — Lượt mượn tháng này so với tháng trước thế nào?

tools: compare_borrow_periods · 867 ký tự · coverage 1.0 · ok

> Lượt mượn tháng 10/2026 (tính đến ngày 14/10) thấp hơn đáng kể so với tháng 9/2026, đặc biệt khi xét theo trung bình mỗi ngày.
> 
> **Căn cứ**
> - Trung bình lượt mượn/ngày: 5,14 lượt trong kỳ hiện tại (14 ngày) so với 30,7 lượt/ngày trong kỳ trước — giảm 83,3%.
> - Tổng lượt mượn: 72 lượt so với 921 lượt — chênh lệch -849 lượt (-92,2%).
> - Tổng lượt trả: 75 lượt so với 1.113 lượt — chênh lệch -1.038 lượt (-93,3%), trung bình/ngày giảm từ 37,1 xuống 5,36 lượt (-85,6%).
> - Tổng lượt đặt chỗ: 90 lượt so với 334 lượt — chênh lệch -244 lượt (-73,1%), trung bình/ngày giảm từ 11,13 xuống 6,43 lượt (-42,2%).
> - Ngày cao điểm của kỳ hiện tại là 06/10/2026 với 33 lượt mượn.
> 
> **Lưu ý**
> Hai kỳ có số ngày khác nhau (14 ngày so với 30 ngày), nên việc so sánh tổng số dễ gây hiểu nhầm; con số thực tế phản ánh xu hướng hoạt động được thể hiện rõ nhất qua chỉ số trung bình mỗi ngày.

### cp-03#0 — Top sách tháng này khác gì tháng trước?

tools: compare_top_books · 975 ký tự · coverage 1.0 · ok

> Top sách tháng 10 (đến ngày 14/10) khác biệt đáng kể so với tháng 9:
> 
> **Kết luận:** Hai đầu sách mới nổi bật là "Dế mèn phiêu lưu ký" và "Luy-Xiêng Và Chú Người Tuyết Cô Độc", trong khi "Norwegian Wood" giảm mạnh về lượt mượn và tụt hạng. Nhiều tựa từng dẫn đầu tháng 9 đã rơi khỏi top.
> 
> **Căn cứ:**
> - "Dế mèn phiêu lưu ký" đạt 29 lượt mượn, lần đầu xuất hiện trong top; "Luy-Xiêng Và Chú Người Tuyết Cô Độc" có 8 lượt, cũng là lần đầu vào top.
> - "Norwegian Wood" chỉ còn 20 lượt, tụt từ hạng 1 (103 lượt) xuống hạng 2.
> - "Dac trung tam ly hoc cua nguoi Viet" tăng hạng, đạt 15 lượt so với 49 lượt ở hạng 5 kỳ trước.
> - Các sách rơi khỏi top gồm: "Tư Duy Phản Biện", "Kafka on the Shore", "Project Hail Mary", "Babel Hay Sự Cần Thiết Của Bạo Lực", "One Hundred Years of Solitude", "Cuộc Đời Của Pi", "Toi thay hoa vang tren co xanh", và "Nghệ Thuật Giao Tiếp Đỉnh Cao".
> 
> **Lưu ý:** Số liệu tháng 10 mới chỉ tính đến ngày 14/10, nên xu hướng có thể thay đổi khi kết thúc tháng.

### cp-04#0 — Lượt mượn tuần này so với tuần trước

tools: compare_borrow_periods · 689 ký tự · coverage 1.0 · ok

> Lượt mượn trung bình mỗi ngày của tuần này (4 lượt) thấp hơn tuần trước (4,71 lượt), giảm 15,1%.
> 
> **Căn cứ**
> - Tổng lượt mượn: 12 trong 3 ngày (tuần này) so với 33 trong 7 ngày (tuần trước); chênh lệch -21 lượt (-63,6%).
> - Tổng lượt trả: 10 so với 35; chênh lệch -25 lượt (-71,4%).
> - Tổng lượt đặt chỗ: 15 so với 48; chênh lệch -33 lượt (-68,8%).
> - Trung bình mỗi ngày: mượn giảm từ 4,71 xuống 4 (-15,1%); trả giảm từ 5 xuống 3,33 (-33,4%); đặt chỗ giảm từ 6,86 xuống 5 (-27,1%).
> - Ngày cao điểm của tuần này là 13/10/2026 với 12 lượt mượn.
> 
> **Lưu ý**
> - Hai kỳ có số ngày khác nhau (3 ngày so với 7 ngày); chỉ tiêu nên được đánh giá qua trung bình mỗi ngày để tránh hiểu nhầm do độ dài kỳ.

### cp-05#0 — Kho nào đang rủi ro thiếu sách nhất?

tools: get_warehouse_stock_risk · 494 ký tự · coverage 1.0 · ok

> Kho HCM Chinh đang rủi ro thiếu sách nhất với 3 đầu sách hết hàng và 7 đầu sách dưới ngưỡng tồn tối thiểu.
> 
> **Căn cứ**
> - Kho HCM Chinh: 3 đầu sách hết hàng, 7 đầu sách dưới ngưỡng; tồn khả dụng 120 bản, đang giữ 6 bản, đang cho mượn 4 bản
> - Chi Nhanh District 1: 1 đầu sách hết hàng, 1 đầu sách dưới ngưỡng; tồn khả dụng 19 bản
> - Kho Ha Noi: 0 đầu sách hết hàng, 1 đầu sách dưới ngưỡng; tồn khả dụng 8 bản
> - Chi Nhanh District 3: 0 đầu sách hết hàng, 0 đầu sách dưới ngưỡng; tồn khả dụng 96 bản

### ca-01#0 — Tại sao Kho HCM Chinh thiếu sách?

tools: explain_warehouse_shortage · 1063 ký tự · coverage 1.0 · ok

> Kho HCM Chinh đang thiếu sách do 7 đầu sách nằm dưới ngưỡng tồn (trong đó có 3 đầu sách đã hết hàng), đi kèm với các yếu tố sau:
> 
> **Căn cứ**
> - Quy mô tồn kho hiện tại của kho: 120 bản tồn khả dụng, 6 bản đang giữ cho đặt chỗ và 4 bản đang cho mượn.
> - Có 5 đầu sách trong nhóm thiếu vẫn đang có nhu cầu mượn cao trên toàn hệ thống, ví dụ như "Norwegian Wood" với 65 lượt mượn, "Project Hail Mary" với 15 lượt mượn và "One Hundred Years of Solitude" với 14 lượt mượn.
> - Một số đầu sách gặp tình trạng thời gian chờ hàng dài (từ 21 ngày trở lên), điển hình là "Norwegian Wood" với thời gian chờ 30 ngày theo cam kết của nhà cung cấp.
> - Các đầu sách còn lại như "Tam Cam", "Dế Mèn Phiêu Lưu Ký" hay "Thuyen bac nho" đều đã hết hàng hoàn toàn nhưng xu hướng mượn gần đây giảm mạnh (giảm 71,4% đến 96%).
> 
> **Lưu ý**
> - Dữ liệu nhu cầu mượn được tính toán dựa trên mô hình đề xuất nhập cho toàn hệ thống, chưa tách biệt riêng hoạt động mượn tại Kho HCM Chinh.
> - Các yếu tố trên phản ánh mối tương quan quan sát được trong dữ liệu và không khẳng định nguyên nhân trực tiếp.

### ca-02#0 — Vì sao Kho Ha Noi có sách dưới ngưỡng?

tools: explain_warehouse_shortage · 770 ký tự · coverage 1.0 · ok

> Kho Ha Noi hiện có 1 đầu sách đang trong tình trạng dưới ngưỡng tồn kho, nhưng không có dấu hiệu nhu cầu mượn tăng hoặc xuất hiện lượt mượn gần đây.
> 
> **Căn cứ:**
> *   **Quy mô thiếu hàng:** Kho có 0 đầu sách hết hàng và 1 đầu sách dưới ngưỡng; tổng tồn khả dụng là 8 bản, 2 bản đang giữ cho đặt chỗ và 0 bản đang cho mượn.
> *   **Tín hiệu nhu cầu:** Số lượng đầu sách dưới ngưỡng nhưng không có tín hiệu nhu cầu (lượt mượn/xu hướng) là 1. Cụ thể, đầu sách này ở mức DƯỚI NGƯỠNG với 8 bản tồn khả dụng nhưng chưa ghi nhận lượt mượn hay xu hướng thay đổi.
> 
> **Lưu ý:**
> *   Dữ liệu nhu cầu được tính trên toàn hệ thống, chưa tách biệt riêng theo từng kho.
> *   Các yếu tố trên chỉ phản ánh tương quan quan sát được trong dữ liệu hiện tại, chưa khẳng định nguyên nhân trực tiếp.

### ca-03#0 — Tại sao lượt mượn tháng này giảm?

tools: compare_borrow_periods · 792 ký tự · coverage 1.0 · ok

> Lượt mượn tháng 10/2026 (tính đến hôm nay) giảm mạnh so với tháng 9/2026, trung bình mỗi ngày chỉ đạt 5,14 lượt mượn so với 30,7 lượt của tháng trước.
> 
> **Căn cứ:**
> - Lượt mượn kỳ hiện tại: 72 lượt (trung bình/ngày 5,14), thấp hơn kỳ so sánh là 849 lượt (-92,2%).
> - Lượt trả cũng giảm tương ứng: 75 lượt (trung bình/ngày 5,36) so với 1.113 lượt (trung bình/ngày 37,1).
> - Lượt đặt chỗ giảm nhẹ hơn nhưng vẫn rõ rệt: 90 lượt (trung bình/ngày 6,43) so với 334 lượt (trung bình/ngày 11,13).
> - Ngày cao điểm duy nhất trong giai đoạn này là 06/10/2026 với 33 lượt mượn.
> 
> **Lưu ý:** Đây là dữ liệu tương quan giữa hai kỳ có độ dài khác nhau (14 ngày so với 30 ngày); các yếu tố cụ thể như thay đổi chính sách, sự kiện, hoặc biến động nguồn cung cần được xem xét thêm để giải thích đầy đủ nguyên nhân.

### ca-04#0 — Tại sao cuốn Norwegian Wood được đề xuất nhập?

tools: explain_reorder_item · 784 ký tự · coverage 1.0 · hedged=False

> Cuốn *Norwegian Wood* được đề xuất nhập vì tồn kho hiện tại chỉ còn 5 bản, thấp hơn ngưỡng an toàn là 10 bản, trong khi nhu cầu mượn vẫn đang diễn ra với 65 lượt trong 30 ngày gần đây.
> 
> **Căn cứ:**
> - Tồn khả dụng: 5 bản (ngưỡng an toàn: 10 bản).
> - Nhu cầu thực tế: 65 lượt mượn trong 30 ngày qua.
> - Dự báo hết hàng: Sau khoảng 110,6 ngày nếu không bổ sung.
> - Đề xuất nhập: 28 bản để đảm bảo nguồn cung trong thời gian chờ hàng 30 ngày.
> - Mức độ ưu tiên: HIGH (cao nhất) do tồn kho thấp và nhu cầu vẫn còn.
> 
> **Lưu ý:**
> - Thời gian chờ hàng 30 ngày dựa trên cam kết của nhà cung cấp, chưa có lịch sử giao hàng thực tế để xác nhận chính xác.
> - Độ tin cậy dữ liệu ở mức TRUNG BÌNH — cần theo dõi sát xu hướng mượn trong thời gian tới để điều chỉnh kế hoạch nhập nếu nhu cầu thay đổi mạnh.

### ca-05#0 — Nguyên nhân tỷ lệ chuyển đổi đặt chỗ thấp?

tools: get_reservation_funnel, get_overdue_summary, get_fine_summary, get_warehouse_stock_risk · 1245 ký tự · coverage 1.0 · ok

> Tỷ lệ chuyển đổi đặt chỗ hiện tại là 63,4% (5.206 trên tổng số 8.210 reservation). Các yếu tố liên quan đến tỷ lệ này bao gồm:
> 
> **Căn cứ**
> - **Trạng thái tồn kho:** Có sự chênh lệch lớn về nguồn lực giữa các kho. Kho HCM Chinh có 3 đầu sách hết hàng và 7 đầu sách dưới ngưỡng; Chi Nhanh District 1 có 1 đầu sách hết hàng. Trong khi đó, các kho khác vẫn còn tồn khả dụng. Việc thiếu hụt vật lý có thể khiến một phần lượng đặt chỗ không thể hoàn tất.
> - **Áp lực quá hạn và phạt:** Số phiếu quá hạn lên tới 380 với trung bình 234,2 ngày, cùng tổng tiền phạt chưa thu rất lớn (497.133.500 ₫, chủ yếu là phạt OVERDUE). Điều này cho thấy nhiều bạn đọc đang gặp khó khăn trong việc trả sách đúng hạn hoặc thanh toán phí, có thể ảnh hưởng gián tiếp đến hành vi đặt chỗ hoặc khả năng nhận sách của họ.
> - **Lượng giữ sách:** Tồn tại tình trạng sách đang được giữ nhưng chưa được chuyển đổi ngay lập tức (ví dụ: Kho HCM Chinh có 6 bản đang giữ, Kho Ha Noi có 2 bản).
> 
> **Lưu ý**
> - Dữ liệu hiện tại chỉ cho thấy tương quan giữa tỷ lệ chuyển đổi thấp với tình trạng tồn kho và lịch sử phạt/quá hạn. Không có dữ liệu cụ thể về lý do từ chối đặt chỗ (ví dụ: người dùng hủy, hệ thống lỗi, hay sách bị hỏng) nên chưa thể khẳng định chính xác nguyên nhân duy nhất.

### de-01#0 — Tôi nên nhập sách nào trước?

tools: get_reorder_suggestions · 1357 ký tự · coverage 0.5 · ok

> **Đề xuất**: Nhập trước **Norwegian Wood**, sau đó ưu tiên các đầu sách đang hết hàng có nhu cầu mượn cao như **Sắc Lời Đắc Thế**, **Babel Hay Sự Cần Thiết Của Bạo Lực**, **Cuộc Đời Của Pi**, và **Đi Tìm Lẽ Sống (Tái Bản 2022)**.
> 
> **Lý do**:
> *   **Norwegian Wood**: Có số lượng đề xuất nhập lớn nhất (28 bản) với tổng chi phí ước tính khoảng 5.040.000 ₫, phản ánh nhu cầu duy trì nguồn cung ổn định cho tựa sách từng có lượt mượn rất cao (65 lượt trong kỳ gần nhất).
> *   **Các đầu sách hết hàng**: Nhiều tựa sách khác (như *Sắc Lời Đắc Thế*, *Babel...*, *Cuộc Đời của Pi*) hiện tại tồn kho khả dụng là 0 nhưng vẫn ghi nhận lượt mượn đáng kể trong tháng qua. Việc thiếu hụt ngay lập tức khiến thư viện không thể đáp ứng nhu cầu đặt chỗ hoặc mượn trực tiếp.
> 
> **Rủi ro**:
> *   Nếu chỉ tập trung vào *Norwegian Wood* mà bỏ qua các đầu sách đã hết hàng, bạn đọc sẽ không thể tiếp cận các tựa sách này ngay lập tức.
> *   Thời gian chờ hàng (lead time) của một số sách được hệ thống mặc định là 14 ngày; nếu thực tế giao hàng chậm hơn, tình trạng hết hàng sẽ kéo dài.
> 
> **Bước tiếp theo**:
> *   Xác nhận ngân sách nhập hàng cụ thể (nếu có) để hệ thống sắp xếp lại thứ tự ưu tiên dựa trên hiệu quả chi phí.
> *   Kiểm tra kỹ thời gian chờ hàng thực tế từ nhà cung cấp đối với các đầu sách có `lead_time_source` là "mặc định" để điều chỉnh kế hoạch đặt hàng chính xác hơn.

### de-02#0 — Sách nào được mượn nhiều nhưng tồn kho thấp và cần nhập thêm?

tools: analyze_demand_vs_stock · 1692 ký tự · coverage 0.5 · ok

> Dưới đây là các đầu sách được mượn nhiều nhưng tồn kho thấp và cần nhập thêm:
> 
> - **Norwegian Wood**: Hạng 1 về lượt mượn (65 lượt); tồn khả dụng 5 bản (ngưỡng 10); ưu tiên HIGH; đề xuất nhập 28 bản ≈ 5.040.000 ₫
> - **Kafka on the Shore**: Hạng 4 về lượt mượn (22 lượt); tồn khả dụng 3 bản (ngưỡng 1); ưu tiên HIGH; đề xuất nhập 9 bản ≈ 1.800.000 ₫
> - **Babel Hay Sự Cần Thiết Của Bạo Lực**: Hạng 5 về lượt mượn (20 lượt); tồn khả dụng 0 bản (ngưỡng 0); ưu tiên HIGH; đề xuất nhập 8 bản ≈ 2.152.000 ₫
> - **Dac trung tam ly hoc cua nguoi Viet**: Hạng 6 về lượt mượn (19 lượt); tồn khả dụng 2 bản (ngưỡng 1); ưu tiên HIGH; đề xuất nhập 52 bản ≈ 4.628.000 ₫
> - **Project Hail Mary**: Hạng 7 về lượt mượn (15 lượt); tồn khả dụng 6 bản (ngưỡng 6); ưu tiên MEDIUM; đề xuất nhập 3 bản ≈ 630.000 ₫
> - **Nghệ Thuật Giao Tiếp Đỉnh Cao**: Hạng 8 về lượt mượn (14 lượt); tồn khả dụng 0 bản (ngưỡng 0); ưu tiên HIGH; đề xuất nhập 5 bản ≈ 415.000 ₫
> - **One Hundred Years of Solitude**: Hạng 9 về lượt mượn (14 lượt); tồn khả dụng 3 bản (ngưỡng 15); ưu tiên HIGH; đề xuất nhập 12 bản ≈ 2.640.000 ₫
> - **Sắc Lời Đắc Thế**: Hạng 10 về lượt mượn (13 lượt); tồn khả dụng 0 bản (ngưỡng 0); ưu tiên HIGH; đề xuất nhập 5 bản ≈ 450.000 ₫
> - **48 Nguyên Tắc Chủ Chốt Của Quyền Lực (Tái Bản)**: Hạng 11 về lượt mượn (13 lượt); tồn khả dụng 0 bản (ngưỡng 0); ưu tiên HIGH; đề xuất nhập 6 bản ≈ 924.000 ₫
> - **Đi Tìm Lẽ Sống (Tái Bản 2022)**: Hạng 12 về lượt mượn (11 lượt); tồn khả dụng 0 bản (ngưỡng 0); ưu tiên HIGH; đề xuất nhập 5 bản ≈ 320.000 ₫
> 
> **Lưu ý**: Dữ liệu tin cậy ở mức THẤP đối với một số đầu sách do ít mẫu hoặc thời gian chờ hàng mặc định, nên bạn nên cân nhắc kiểm tra lại nhu cầu thực tế trước khi nhập hàng.

### de-03#0 — Nên ưu tiên xử lý việc gì hôm nay?

tools: rank_priority_tasks · 824 ký tự · coverage 1.0 · ok

> Theo thứ tự ưu tiên hôm nay:
> 
> 1. **Bổ sung sách đã hết hàng nhưng vẫn có nhu cầu**: 90 đầu sách đang không thể cho mượn dù bạn đọc cần. Bước tiếp theo: Lập phiếu đề xuất nhập (cần xác nhận trước khi tạo).
> 2. **Thu hồi khoản phạt chưa thu**: 497.133.500 ₫ tồn đọng. Bước tiếp theo: Rà soát các khoản phạt lớn nhất và gửi nhắc thanh toán.
> 3. **Xử lý phiếu mượn quá hạn**: 380 phiếu, trung bình quá hạn 234.2 ngày, lâu nhất 955 ngày. Bước tiếp theo: Liên hệ các phiếu quá hạn lâu nhất trước.
> 4. **Xem xét đề xuất nhập ưu tiên cao**: 96 đầu sách có dự báo nhu cầu vượt tồn khả dụng trong thời gian chờ hàng. Bước tiếp theo: Duyệt danh sách đề xuất nhập ưu tiên HIGH.
> 5. **Kiểm tra kho dưới ngưỡng**: 9 đầu sách tại Kho HCM Chinh đang ở mức rủi ro thấp. Bước tiếp theo: Đối chiếu tồn thực tế và cân nhắc điều chuyển giữa các kho.

### de-04#0 — Nên nhập gì cho Kho HCM Chinh?

tools: get_warehouse_low_stock_items, get_warehouse_stock_risk, get_reorder_suggestions, get_reorder_suggestions, get_reorder_suggestions, get_reorder_suggestions · 1543 ký tự · coverage 1.0 · overclaim=toi uu

> **Đề xuất**
> Nên nhập ngay 579 bản sách với tổng chi phí ước tính **70.408.750 ₫**, tập trung vào các đầu sách đang hết hàng hoặc dưới ngưỡng an toàn tại Kho HCM Chinh.
> 
> **Lý do**
> *   **Căn cứ**: Kho HCM Chinh hiện có **3 đầu sách hết hàng** (Thuyen bac nho, Dế Mèn Phiêu Lưu Ký, Tam Cam) và **7 đầu sách dưới ngưỡng** tồn kho.
> *   **Căn cứ**: Danh sách ưu tiên cao (HIGH) gồm 96 đầu sách, chiếm phần lớn nhu cầu bổ sung, với tổng số lượng đề xuất là 185 bản trong top 20 đầu sách quan trọng nhất (chi phí khoảng 23.843.000 ₫).
> *   **Căn cứ**: Các đầu sách như *Norwegian Wood*, *One Hundred Years of Solitude* đang ở mức thấp so với ngưỡng (tồn khả dụng lần lượt là 5/10 và 3/15), dù lưu chuyển mượn vẫn còn diễn ra (65 và 14 lượt trong kỳ trước).
> *   **Căn cứ**: Nhiều đầu sách khác (*Sắc Lời Đắc Thế*, *Babel Hay Sự Cần Thiết Của Bạo Lực*, v.v.) đã hết hàng hoàn toàn nhưng vẫn có lượt mượn trong kỳ gần đây, cho thấy nhu cầu thực tế chưa được đáp ứng.
> 
> **Rủi ro**
> *   **Chờ hàng**: Một số đầu sách có thời gian chờ hàng mặc định là 14 ngày hoặc cam kết NCC 30 ngày, có thể gây gián đoạn cung ứng nếu không đặt sớm.
> *   **Giảm lưu chuyển**: Một số đầu sách ưu tiên cao ghi nhận giảm mạnh lượt mượn so với kỳ trước (ví dụ: *Norwegian Wood* giảm 47,2%, *Kafka on the Shore* giảm 63,9%), cần theo dõi sát để điều chỉnh số lượng nhập sau đợt này.
> 
> **Bước tiếp theo**
> Xác nhận đơn nhập hàng cho danh sách 96 đầu sách ưu tiên cao (570 bản, 69.778.750 ₫) và xem xét thêm 9 bản từ nhóm ưu tiên trung bình/thấp để đạt tổng 579 bản như đề xuất tối ưu.

### de-05#0 — Có nên thanh lý bớt sách tồn lâu không?

tools: get_aging_inventory, get_weeding_suggestions · 402 ký tự · coverage 1.0 · ok

> Hiện tại không có sách nào tồn kho lâu ngày (trên 90 ngày không hoạt động), nên chưa cần thanh lý bớt.
> 
> **Căn cứ:**
> - Số đầu sách tồn lâu không hoạt động: 0
> - Tổng giá trị tồn đọng: 0 ₫
> 
> **Lưu ý:** Dữ liệu dựa trên ngưỡng 90 ngày không xuất/nhập. Nếu bạn muốn xem xét các sách tồn lâu hơn (ví dụ 180 ngày trở lên) hoặc cần gợi ý thanh lý/chuyển kho cụ thể, tôi có thể truy xuất thêm thông tin chi tiết.

### wi-01#0 — Với ngân sách 10 triệu nên nhập sách gì?

tools: simulate_reorder_budget · 910 ký tự · coverage 0.6666666666666666 · overclaim=dap ung 100%

> Với ngân sách 10.000.000 ₫, hệ thống duyệt chi phí 9.988.000 ₫ (dư 12.000 ₫) cho **6 đầu sách / 91 bản**, đáp ứng 100% thiếu hụt dự kiến của các dòng được chọn.
> 
> **Đề xuất nhập:**
> *   **Dac trung tam ly hoc cua nguoi Viet**: 52 bản
> *   **Norwegian Wood**: 28 bản
> *   **Đi Tìm Lẽ Sống (Tái Bản 22)**: 5 bản
> *   **Dế mèn phiêu lưu ký**: 3 bản
> *   **Luy-Xiêng Và Chú Người Tuyết Cô Độc**: 3 bản
> 
> **Ưu tiên cao bị bỏ lại do hết ngân sách:**
> Sắc Lời Đắc Thế, Kafka on the Shore, One Hundred Years of Solitude, Babel Hay Sự Cần Thiết Của Bạo Lực, Cây Cam Ngọt Của Tôi (Tái Bản 2026).
> 
> **Rủi ro:**
> Ngân sách hiện tại chỉ đủ để giải quyết nhu cầu của 6 đầu sách trong top ưu tiên nhất. Các tựa sách còn lại có nhu cầu dự báo cao nhưng chưa được duyệt nhập.
> 
> **Bước tiếp theo:**
> Bạn có thể xác nhận nhập ngay 6 đầu sách trên, hoặc điều chỉnh ngân sách nếu muốn bao phủ thêm các đầu sách ưu tiên cao khác đang bị bỏ lại.

### wi-02#0 — Nếu giảm ngân sách nhập hàng còn 5 triệu thì sao?

tools: simulate_reorder_budget · 852 ký tự · coverage 1.0 · overclaim=dap ung du; actionable=False

> **Kết quả mô phỏng**
> Với ngân sách 5.000.000 ₫, hệ thống sẽ duyệt chi 4.948.000 ₫ (dư 52.000 ₫) để nhập 63 bản thuộc 5 đầu sách: "Đi Tìm Lẽ Sống (Tái Bản 2022)" (5 bản), "Dac trung tam ly hoc cua nguoi Viet" (52 bản), "Dế mèn phiêu lưu ký" (3 bản), "Luy-Xiêng Và Chú Người Tuyết Cô Độc" (3 bản) và "Tư Duy Phản Biện" (0 bản). Kết quả là đáp ứng được 100% thiếu hụt dự kiến.
> 
> **Đánh đổi**
> Việc cắt giảm mạnh so với nhu cầu thực tế (70.408.750 ₫ cho 579 bản) khiến 94 trong số 96 đầu sách ưu tiên cao bị bỏ lại, bao gồm các tựa quan trọng như "Norwegian Wood", "Sắc Lời Đắc Thế", "Kafka on the Shore", "One Hundred Years of Solitude" và "Babel Hay Sự Cần Thiết Của Bạo Lực".
> 
> **Giới hạn**
> Số liệu này chỉ phản ánh 100 dòng đề xuất đầu tiên; có thể còn 16 đầu sách khác nằm ngoài danh sách này chưa được tính toán cụ thể về số lượng hoặc tình trạng duyệt.

### wi-03#0 — So sánh ngân sách 10 triệu và 20 triệu

tools: simulate_reorder_budget · 1834 ký tự · coverage 1.0 · actionable=False

> **Kết quả mô phỏng**
> 
> *   **Ngân sách 10.000.000 ₫:**
>     *   Duyệt chi phí: 9.988.000 ₫ (dư 12.000 ₫).
>     *   Số lượng: 6 đầu sách, 91 bản.
>     *   Ưu tiên cao: 3 đầu được duyệt, 93 đầu bị bỏ lại.
>     *   Sách được duyệt: Norwegian Wood (28 bản), Đi Tìm Lẽ Sống (Tái Bản 2022) (5 bản), Dac trung tam ly hoc cua nguoi Viet (52 bản), Dế mèn phiêu lưu ký (3 bản), Luy-Xiêng Và Chú Người Tuyết Cô Độc (3 bản).
>     *   Ưu tiên cao bị bỏ lại: Sắc Lời Đắc Thế, Kafka on the Shore, One Hundred Years of Solitude, Babel Hay Sự Cần Thiết Của Bạo Lực, Cây Cam Ngọt Của Tôi (Tái Bản 2026).
>     *   Đáp ứng thiếu hụt dự kiến: 100%.
> 
> *   **Ngân sách 20.000.000 ₫:**
>     *   Duyệt chi phí: 19.861.000 ₫ (dư 139.000 ₫).
>     *   Số lượng: 16 đầu sách, 156 bản.
>     *   Ưu tiên cao: 13 đầu được duyệt, 83 đầu bị bỏ lại.
>     *   So với phương án 10 triệu: thêm 10 đầu sách ưu tiên cao được duyệt.
>     *   Sách được duyệt thêm: Sắc Lời Đắc Thế (5 bản), Kafka on the Shore (9 bản), One Hundred Years of Solitude (12 bản), Babel Hay Sự Cần Thiết Của Bạo Lực (8 bản).
>     *   Ưu tiên cao bị bỏ lại: Nghệ Thuật Tư Duy Chiến Lược, Cá Voi Tỷ Đô (Tái Bản 2022), Những Kẻ Xuất Chúng (Tái Bản 2021), Tư Duy Ngược, Người Đàn Ông Mang Tên OVE (Tái Bản).
>     *   Đáp ứng thiếu hụt dự kiến: 100%.
> 
> **Đánh đổi**
> Với mức ngân sách 10 triệu, hệ thống chỉ có thể duyệt 6 đầu sách và để lại 93 đầu ưu tiên cao chưa được nhập. Khi tăng ngân sách lên 20 triệu, số đầu sách được duyệt tăng lên 16 (thêm 10 đầu), trong đó có các tựa sách quan trọng như "Sắc Lời Đắc Thế" hay "Kafka on the Shore". Tuy nhiên, ngay cả ở mức 20 triệu, vẫn còn 83 đầu sách ưu tiên cao bị bỏ lại do giới hạn tổng nhu cầu (116 đầu sách ưu tiên cao cần nhập).
> 
> **Giới hạn**
> *   Tổng nhu cầu nhập đầy đủ là 116 đầu sách (ưu tiên cao 96), tương đương 579 bản với tổng giá trị ước tính 70.408.750 ₫.
> *

### wi-04#0 — Nếu cắt 30% ngân sách nhập hàng thì sao?

tools: simulate_reorder_budget · 900 ký tự · coverage 1.0 · ok

> **Kết quả mô phỏng**
> - Ngân sách sau khi cắt 30%: 49.283.100 ₫ (còn dư 3.025 ₫).
> - Số lượng được duyệt: 67 đầu sách / 415 bản (trong đó ưu tiên cao được duyệt 64, bị bỏ lại 32).
> - Mức đáp ứng thiếu hụt dự kiến: 100%.
> 
> **Đánh đổi**
> - So với phương án duyệt đầy đủ nhu cầu (70.408.750 ₫ cho 100 đầu sách/579 bản), việc cắt giảm này làm giảm chi phí duyệt đi 21.125.650 ₫ và giảm số lượng nhập đi 33 đầu sách cùng 164 bản.
> - Các đầu sách ưu tiên cao bị loại khỏi danh sách duyệt bao gồm: *Cố Định Một Đám Mây (Tái Bản 2023)*, *Giao Thừa (Tái Bản 2019)*, *Mẹ Làm Gì Có Ước Mơ*, *Chuyện ICU - Lá Gan Hạnh Phúc* và *Totto-Chan Bên Cửa Sổ - Những Chuyện Tiếp Theo*.
> 
> **Giới hạn**
> - Kết quả dựa trên quy tắc phân bổ tối ưu hóa việc giảm thiểu thiếu hụt dự kiến trên mỗi đồng chi tiêu.
> - Dữ liệu không tính toán cụ thể số dòng/số lượng của 16 đầu sách nằm ngoài nhóm 100 dòng đầu tiên trong danh sách đề xuất.

### wi-05#0 — Nếu giảm ngân sách nhập hàng thì sao?

tools: simulate_reorder_budget · 1519 ký tự · coverage 1.0 · overclaim=dap ung 100%/dap ung 100%/dap ung 100%/dap ung 100%; unverified=2; actionable=False

> **Kết quả mô phỏng**
> 
> - **100% nhu cầu (70.408.750 ₫):** duyệt 70.408.750 ₫, còn dư 0 ₫; 100 đầu sách / 579 bản (ưu tiên cao được duyệt 96, bị bỏ lại 0); đáp ứng 100% thiếu hụt dự kiến.
> - **75% nhu cầu (52.806.562 ₫):** duyệt 52.711.850 ₫, còn dư 94.712 ₫; 73 đầu sách / 445 bản (ưu tiên cao được duyệt 70, bị bỏ lại 26); đáp ứng 100% thiếu hụt dự kiến. So với phương án 100%: ngân sách -17.602.188 ₫, chi phí duyệt -17.696.900 ₫, số đầu sách -27, số bản -134.
> - **50% nhu cầu (35.204.375 ₫):** duyệt 35.157.100 ₫, còn dư 47.275 ₫; 42 đầu sách / 290 bản (ưu tiên cao được duyệt 39, bị bỏ lại 57); đáp ứng 100% thiếu hụt dự kiến. So với phương án 100%: ngân sách -35.204.375 ₫, chi phí duyệt -35.251.650 ₫, số đầu sách -58, số bản -289.
> - **25% nhu cầu (17.602.187 ₫):** duyệt 17.530.000 ₫, còn dư 72.188 ₫; 11 đầu sách / 130 bản (ưu tiên cao được duyệt 8, bị bỏ lại 88); đáp ứng 100% thiếu hụt dự kiến. So với phương án 100%: ngân sách -52.806.562 ₫, chi phí duyệt -52.878.750 ₫, số đầu sách -89, số bản -449.
> 
> **Đánh đổi**
> - Giảm từ 100% xuống 75%: tiết kiệm ~17,6 triệu ₫ nhưng phải chấp nhận 26 đầu sách ưu tiên cao không được nhập, làm giảm khả năng phục vụ bạn đọc cho các tựa như *Được Học (Tái Bản 2022)*, *Nhật Ký Đặng Thùy Trâm (Tái Bản 2026)*, *Nếu Biết Trăm Năm Là Hữu Hạn (Tái Bản 2024)*...
> - Giảm xuống 50%: tiết kiệm thêm ~17,6 triệu ₫ nữa, nhưng số đầu sách ưu tiên cao bị bỏ lại tăng lên 57, bao gồm cả những tựa có nhu cầu cao như *Thiên Cơ - Secret*, *Phương Pháp Đầu Tư Warren Buffett (Tái Bản 2025)*

### wi-06#0 — Với ngân sách 100 tỷ thì nhập được những gì?

tools: simulate_reorder_budget · 619 ký tự · coverage 1.0 · overclaim=dap ung 100%

> Với ngân sách 100.000.000.000 ₫, hệ thống duyệt chi phí **70.408.750 ₫** (dư **99.929.591.250 ₫**) để nhập đủ nhu cầu dự báo cho **100 đầu sách** (tổng cộng **579 bản**), đáp ứng **100%** thiếu hụt dự kiến.
> 
> Các đầu sách ưu tiên cao được duyệt bao gồm:
> *   **Norwegian Wood**: 28 bản
> *   **Sắc Lời Đắc Thế**: 5 bản
> *   **Kafka on the Shore**: 9 bản
> *   **One Hundred Years of Solitude**: 12 bản
> *   **Babel Hay Sự Cần Thiết Của Bạo Lực**: 8 bản
> 
> *Lưu ý: Danh sách này tập trung vào các dòng giúp giảm thiểu thiếu hụt dự kiến nhất trên mỗi đồng chi phí. Có thể có thêm 16 đầu sách khác nằm ngoài nhóm 100 dòng đầu tiên.*

### mt-01#0 — Tôi nên nhập sách nào trước?

tools: get_reorder_suggestions, get_reorder_suggestions, get_reorder_suggestions, get_reorder_suggestions · 2220 ký tự · coverage 1.0 · lead_ok=False

> Bạn nên ưu tiên nhập các đầu sách có **tồn khả dụng bằng 0** và **chờ hàng ngắn (14 ngày)** trước, vì đây là nhóm đang bị thiếu hụt hoàn toàn và có thể nhanh chóng đáp ứng nhu cầu. Cụ thể, hãy xử lý theo thứ tự sau:
> 
> **Đề xuất**
> 1. **Nhóm khẩn cấp nhất (Tồn 0 - Chờ 14 ngày):** Nhập ngay *Sắc Lời Đắc Thế*, *Babel Hay Sự Cần Thiết Của Bạo Lực*, *Cây Cam Ngọt Của Tôi (Tái Bản 2026)*, *Cuộc Đời Của Pi* và *Đi Tìm Lẽ Sống (Tái Bản 2022)*. Đây là những đầu sách đã hết sạch kho nhưng thời gian chờ từ nhà cung cấp chỉ 14 ngày, giúp giảm thiểu tình trạng không phục vụ được bạn đọc.
> 2. **Nhóm cần bổ sung sớm (Tồn thấp - Chờ 30 ngày):** Sau khi đặt nhóm trên, hãy xem xét *Norwegian Wood* (tồn 5/10) và *Kafka on the Shore* (tồn 3/1). Dù chờ hàng lâu hơn (30 ngày), nhưng lượng mượn của *Norwegian Wood* rất cao (65 lượt/kỳ), nên việc đảm bảo nguồn cung cho tựa này là quan trọng để tránh gián đoạn trong tương lai gần.
> 
> **Lý do**
> - **Nguy cơ mất dịch vụ:** Các sách như *Sắc Lời Đắc Thế*, *Babel Hay Sự Cần Thiết Của Bạo Lực*... hiện tại tồn khả dụng là 0 bản. Nếu không đặt ngay, thư viện sẽ không thể cho mượn hoặc nhận đặt chỗ cho những đầu sách này cho đến khi hàng về.
> - **Hiệu quả vốn lưu động:** Nhóm sách chờ 14 ngày thường có chi phí đơn vị thấp hơn (ví dụ: *Sắc Lời Đắc Thế* chỉ khoảng 90.000 ₫/bản, tổng 5 bản ≈ 450.000 ₫), giúp giải quyết nhanh vấn đề thiếu hụt với ngân sách nhỏ.
> - **Mức độ phổ biến:** *Norwegian Wood* dù chờ 30 ngày nhưng có lượng mượn cao nhất danh sách (65 lượt), gấp đôi các tựa khác trong nhóm top đầu. Việc giữ mức tồn an toàn cho tựa này ngăn ngừa tình trạng hết hàng đột ngột sau khi hàng về.
> 
> **Rủi ro**
> - **Thiếu dữ liệu chi tiết NCC:** Dữ liệu hiện tại chỉ hiển thị "chờ hàng mặc định" hoặc "cam kết NCC" chung chung. Không rõ chính xác nhà cung cấp nào sẽ giao nhanh nhất cho nhóm 14 ngày, có thể dẫn đến chậm trễ thực tế nếu nhà cung cấp mặc định không uy tín.
> - **Giảm lượng mượn:** Tất cả các đầu sách trong danh sách đều ghi nhận sự sụt giảm lượt mượn so với kỳ trước (từ -21,4% đến -63,9%). Có thể nhu cầu thực tế đang thấp hơn dự báo, dẫn đến nguy cơ tồn kho dư thừa nếu nhập đúng số lượng đề xuất.
> 
> **Bước tiếp theo**
> - Xác nhận đơn đặt hàng cho 5 đầu sách thuộc nhóm "Tồn

### mt-01#1 — Giải thích kỹ hơn

tools: — · 2295 ký tự · coverage 1.0 · unverified=1

> Dưới đây là phân tích chi tiết về các đầu sách được đề xuất nhập, dựa trên mức độ ưu tiên và lý do nghiệp vụ:
> 
> **1. Nhóm ưu tiên cao nhất (Tồn kho bằng 0 - Chờ hàng nhanh)**
> Đây là nhóm cần xử lý ngay lập tức vì hiện tại không có bản nào trong kho để phục vụ bạn đọc. Tuy nhiên, thời gian chờ hàng ngắn (14 ngày) giúp giảm thiểu rủi ro "chết vốn" hoặc tồn kho lâu ngày.
> 
> *   **Sắc Lời Đắc Thế:**
>     *   **Lý do:** Đây là đầu sách được đề xuất số 1. Tồn kho hiện tại là 0 bản, nhưng nhu cầu mượn vẫn duy trì ở mức khá cao (trung bình 25 lượt/tháng). Thời gian chờ hàng chỉ 14 ngày, cho phép thư viện nhanh chóng khôi phục khả năng phục vụ.
>     *   **Rủi ro:** Lượng mượn đang có xu hướng giảm nhẹ (-21,4%) so với tháng trước. Cần theo dõi sát xem sau khi nhập hàng, lượng mượn có tăng trở lại hay tiếp tục giảm.
> *   **Babel Hay Sự Cần Thiết Của Bạo Lực:**
>     *   **Lý do:** Tương tự như trên, sách đã hết sạch (tồn 0) nhưng vẫn nằm trong top 10 sách được đặt nhiều nhất. Việc thiếu hụt nguồn cung trực tiếp làm giảm tỷ lệ chuyển đổi từ "đặt chỗ" sang "mượn".
> *   **Cây Cam Ngọt Của Tôi (Tái Bản 2026):**
>     *   **Lý do:** Sách thuộc thể loại kỹ năng sống/sức khỏe tâm thần, luôn có nhu cầu ổn định. Tồn kho bằng 0 khiến thư viện mất đi một đầu sách quan trọng cho đối tượng độc giả trẻ.
> *   **Cuộc Đời Của Pi & Đi Tìm Lẽ Sống (Tái Bản 2022):**
>     *   **Lý do:** Hai tựa kinh điển này đều đã hết hàng hoàn toàn. Dù lượng mượn trung bình thấp hơn nhóm đầu (khoảng 10-15 lượt/tháng), nhưng chúng là những đầu sách "nền tảng" mà mọi thư viện văn hóa nên có sẵn.
> 
> **2. Nhóm ưu tiên thứ hai (Tồn kho thấp - Chờ hàng trung bình)**
> Nhóm này chưa bị "hết hàng" hoàn toàn nhưng số lượng còn lại rất ít, dễ dẫn đến tình trạng thiếu hụt nếu có đợt mượn tăng đột biến.
> 
> *   **Norwegian Wood:**
>     *   **Lý do:** Đây là đầu sách có lượng mượn cao nhất danh sách (65 lượt/tháng), gấp đôi các đầu sách khác. Hiện tại chỉ còn 5 bản trong kho, trong khi ngưỡng an toàn thường là 10 bản. Nếu không bổ sung sớm, nguy cơ hết hàng là rất cao trong vòng 1-2 tuần tới.
>     *   **Đặc biệt:** Dù thời gian chờ hàng dài hơn (30 ngày), nhưng mức độ phổ biến của sách justify (thỏa đáng) việc phải đặt trước để đảm bảo nguồn cung liên tục.
> *   **Kafka on the Shore:**
>     *   **Lý do:** Cũng là tác phẩm của Haruki Murak

### mt-01#2 — Vì sao không chọn phương án khác?

tools: get_reorder_suggestions · 2294 ký tự · coverage 1.0 · ok

> Việc chọn phương án ưu tiên các đầu sách **tồn kho bằng 0** và **chờ hàng ngắn (14 ngày)** trước dựa trên nguyên tắc tối ưu hóa dịch vụ và vốn lưu động. Dưới đây là lý do chi tiết vì sao không chọn các phương án khác:
> 
> **Đề xuất**
> Phương án hiện tại tập trung vào nhóm "hết sạch - về nhanh" để khôi phục khả năng phục vụ ngay lập tức với chi phí thấp. Các phương án thay thế (như nhập sách tồn thấp nhưng chờ lâu, hoặc tập trung vào sách có lượng mượn cao nhất) bị loại trừ vì những lý do sau:
> 
> **Lý do**
> *   **Không chọn nhóm "Tồn thấp - Chờ dài" (ví dụ: *Norwegian Wood*):**
>     *   **Rủi ro gián đoạn:** Dù *Norwegian Wood* có lượng mượn cao nhất (65 lượt), nhưng hiện vẫn còn 5 bản trong kho. Với tốc độ mượn hiện tại, số lượng này chỉ đủ dùng cho khoảng **110 ngày**. Việc chờ hàng mất **30 ngày** khiến rủi ro thiếu hụt cấp bách rất thấp trong ngắn hạn.
>     *   **Hiệu quả vốn:** Chi phí đặt 28 bản *Norwegian Wood* lên tới **5.040.000 ₫**, gấp hơn 10 lần tổng chi phí của nhóm sách hết hàng (khoảng 450.000 - 500.000 ₫/sách). Nếu ngân sách có hạn, việc bỏ ra số tiền lớn này để giải quyết một vấn đề chưa cấp bách là kém hiệu quả.
> *   **Không chọn nhóm "Tồn thấp - Chờ ngắn" (ví dụ: *One Hundred Years of Solitude*):**
>     *   **Mức độ khẩn cấp:** *One Hundred Years of Solitude* hiện còn 3 bản (ngưỡng an toàn là 15). Dù chờ hàng chỉ 14 ngày, nhưng việc còn lại 3 bản nghĩa là thư viện vẫn đang hoạt động bình thường. So với các sách đã **hết sạch (0 bản)**, mức độ ưu tiên thấp hơn rõ rệt.
>     *   **Chi phí cơ hội:** Nhập 12 bản *One Hundred Years of Solitude* tốn **2.640.000 ₫**. Số tiền này nếu chuyển sang nhập các sách hết sạch (như *Sắc Lời Đắc Thế*, *Babel...*) sẽ giúp khôi phục được 5-6 đầu sách hoàn toàn mất khả năng phục vụ, mang lại lợi ích dịch vụ lớn hơn.
> *   **Không chọn nhóm "Ưu tiên thấp" (LOW):**
>     *   **Thiếu nhu cầu thực tế:** Các sách thuộc nhóm ưu tiên LOW thường có lượng mượn rất thấp hoặc xu hướng giảm mạnh. Việc nhập thêm chúng vào kho sẽ làm tăng rủi ro tồn kho "chết" (dead stock), chiếm dụng vốn mà không sinh ra doanh thu hoặc giá trị sử dụng.
> 
> **Rủi ro**
> *   **Giảm lượng mượn chung:** Dữ liệu cho thấy tất cả các đầu sách đều ghi nhận sự sụt giảm lượt mượn đáng kể so với kỳ trước (từ -21,4% đến -63,9%). Có thể nhu cầu thực tế đang suy giảm, dẫn

### mt-02#0 — Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?

tools: compare_warehouses · 248 ký tự · coverage 1.0 · ok

> Kho HCM Chinh rủi ro hơn Kho Ha Noi.
> 
> **Căn cứ**
> - Hết hàng: 3 đầu sách (nhiều hơn 3 so với Kho Ha Noi).
> - Dưới ngưỡng tồn tối thiểu: 7 đầu sách (nhiều hơn 6 so với Kho Ha Noi).
> - Tồn khả dụng: 120 bản tại Kho HCM Chinh so với 8 bản tại Kho Ha Noi.

### mt-02#1 — Nói ngắn gọn thôi

tools: — · 36 ký tự · coverage 1.0 · ok

> Kho HCM Chinh rủi ro hơn Kho Ha Noi.

### mt-03#0 — Với ngân sách 10 triệu nên nhập sách gì?

tools: simulate_reorder_budget · 709 ký tự · coverage 1.0 · overclaim=dap ung du; actionable=False

> Với ngân sách 10.000.000 ₫, hệ thống duyệt chi **9.988.000 ₫** (còn dư 12.000 ₫) để nhập các đầu sách sau:
> 
> *   **Dac trung tam ly hoc cua nguoi Viet**: 52 bản
> *   **Norwegian Wood**: 28 bản
> *   **Đi Tìm Lẽ Sống (Tái Bản 2022)**: 5 bản
> *   **Dế mèn phiêu lưu ký**: 3 bản
> *   **Luy-Xiêng Và Chú Người Tuyết Cô Độc**: 3 bản
> 
> Tổng cộng được duyệt 6 đầu sách với 91 bản. Với mức ngân sách này, hệ thống đáp ứng được 100% nhu cầu thiếu hụt dự kiến của nhóm sách được chọn. Tuy nhiên, có 5 đầu sách ưu tiên cao khác bị bỏ lại do không còn đủ ngân sách, bao gồm: *Sắc Lời Đắc Thế*, *Kafka on the Shore*, *One Hundred Years of Solitude*, *Babel Hay Sự Cần Thiết Của Bạo Lực*, và *Cây Cam Ngọt Của Tôi (Tái Bản 2026)*.

### mt-03#1 — Giải thích dễ hiểu hơn

tools: — · 1012 ký tự · coverage 1.0 · style_ok=False

> Với ngân sách 10 triệu, hệ thống ưu tiên chi vào các đầu sách đang có nhu cầu mượn cao nhất để giảm thiểu tình trạng thiếu hụt. Cụ thể:
> 
> *   **Nhóm sách được duyệt (Chi phí: 9.988.000 ₫):**
>     *   **Dac trung tam ly hoc cua nguoi Viet** và **Norwegian Wood**: Đây là hai đầu sách được nhập nhiều nhất (lần lượt 52 và 28 bản) vì nhu cầu dự kiến trong thời gian tới rất lớn.
>     *   **Đi Tìm Lẽ Sống**, **Dế mèn phiêu lưu ký**, và **Luy-Xiêng Và Chú Người Tuyết Cô Độc**: Các đầu sách này cũng được bổ sung với số lượng ít hơn (từ 3 đến 5 bản) để đáp ứng nhu cầu ngay lập tức.
> 
> *   **Nhóm sách bị bỏ lại:**
>     *   Có 5 đầu sách khác cũng thuộc nhóm ưu tiên cao nhưng không được duyệt do hết ngân sách, bao gồm: *Sắc Lời Đắc Thế*, *Kafka on the Shore*, *One Hundred Years of Solitude*, *Babel Hay Sự Cần Thiết Của Bạo Lực*, và *Cây Cam Ngọt Của Tôi*.
> 
> Tóm lại, với mức ngân sách này, bạn nên tập trung nhập trước các đầu sách trong danh sách đã duyệt để đảm bảo nguồn cung cho những tựa sách "nóng" nhất hiện nay.

### mt-04#0 — Tại sao Kho HCM Chinh thiếu sách?

tools: explain_warehouse_shortage · 1682 ký tự · coverage 1.0 · ok

> Kho HCM Chinh đang thiếu sách do 7 đầu sách nằm dưới ngưỡng tồn (trong đó có 3 bản hết hàng), và 5 trong số đó vẫn có nhu cầu mượn thực tế trên toàn hệ thống.
> 
> **Căn cứ**
> - Quy mô thiếu hàng tại kho: 3 đầu sách hết hàng, 7 đầu sách dưới ngưỡng; tồn khả dụng 120 bản, đang giữ đặt chỗ cho 6 bản, đang cho mượn 4 bản.
> - Sách thiếu vẫn có lượt mượn gần đây (toàn hệ thống): Norwegian Wood (65 lượt), Project Hail Mary (15 lượt), One Hundred Years of Solitude (14 lượt).
> - Thời gian chờ hàng dài (≥ 21 ngày) ảnh hưởng đến việc bù đắp nhanh: ví dụ Norwegian Wood có lead_time_days = 30 ngày (SUPPLIER_DECLARED).
> - Các đầu sách hết hàng/dưới ngưỡng kèm nhu cầu:
>   • Tam Cam: HẾT HÀNG, tồn khả dụng 0, 8 lượt mượn, xu hướng -71,4%, ưu tiên nhập HIGH.
>   • Dế Mèn Phiêu Lưu Ký: HẾT HÀNG, tồn khả dụng 0, 1 lượt mượn, xu hướng -96%, ưu tiên nhập HIGH.
>   • Thuyen bac nho: HẾT HÀNG, tồn khả dụng 0, không có dữ liệu lượt mượn/xu hướng, ưu tiên nhập —.
>   • Norwegian Wood: DƯỚI NGƯỠNG, tồn khả dụng 2, 65 lượt mượn, xu hướng -47,2%, ưu tiên nhập HIGH.
>   • Project Hail Mary: DƯỚI NGƯỠNG, tồn khả dụng 6, 15 lượt mượn, xu hướng -83,3%, ưu tiên nhập MEDIUM.
>   • One Hundred Years of Solitude: DƯỚI NGƯỠNG, tồn khả dụng 1, 14 lượt mượn, xu hướng -58,8%, ưu tiên nhập HIGH.
>   • Tư Duy Như Kinh Tế Gia: DƯỚI NGƯỠNG, tồn khả dụng 4, không có dữ liệu lượt mượn/xu hướng, ưu tiên nhập —.
> - Số lượng thiếu hàng nhưng không có tín hiệu nhu cầu gần đây (ưu tiên thấp hơn): 2 đầu sách.
> 
> **Lưu ý**
> - Nhu cầu mượn được lấy từ mô hình đề xuất nhập tính trên toàn hệ thống, không tách riêng theo từng kho.
> - Các yếu tố trên là tương quan quan sát được trong dữ liệu; chưa kiểm chứng quan hệ nhân quả trực tiếp.

### mt-04#1 — Giải thích kỹ hơn

tools: — · 1171 ký tự · coverage 1.0 · style_ok=False

> Kho HCM Chinh thiếu sách do sự kết hợp của tồn kho thấp, nhu cầu mượn thực tế và thời gian chờ hàng dài.
> 
> **Căn cứ**
> - **Tồn kho thấp:** 7 đầu sách dưới ngưỡng (3 hết hàng, 4 dưới ngưỡng). Tồn khả dụng chỉ 120 bản, trong đó 6 bản đang giữ cho đặt chỗ và 4 bản đang cho mượn.
> - **Nhu cầu mượn cao:** Các đầu sách hết hàng/dưới ngưỡng vẫn có lượt mượn gần đây trên toàn hệ thống: Norwegian Wood (65 lượt), Project Hail Mary (15 lượt), One Hundred Years of Solitude (14 lượt).
> - **Xu hướng giảm mạnh:** Nhiều đầu sách có xu hướng mượn giảm nhanh (ví dụ: Project Hail Mary -83,3%, Norwegian Wood -47,2%), khiến lượng tồn hiện tại không đủ bù đắp.
> - **Thời gian chờ hàng dài:** Một số đầu sách có lead_time_days từ 21 đến 30 ngày (ví dụ: Norwegian Wood 30 ngày), làm chậm việc bổ sung hàng mới.
> - **Đề xuất nhập ưu tiên cao:** 3 đầu sách hết hàng/dưới ngưỡng được hệ thống đánh giá là cần nhập gấp (HIGH): Tam Cam, Dế Mèn Phiêu Lưu Ký, One Hundred Years of Solitude.
> 
> **Lưu ý**
> - Dữ liệu nhu cầu mượn được tính trên toàn hệ thống, chưa tách riêng theo từng kho.
> - Thời gian chờ hàng dựa trên lịch sử giao hàng hoặc cam kết nhà cung cấp, có thể thay đổi tùy tình huống thực tế.

### mt-05#0 — So sánh ngân sách 10 triệu và 20 triệu

tools: simulate_reorder_budget · 1802 ký tự · coverage 1.0 · actionable=False

> **Kết quả mô phỏng**
> 
> *   **Ngân sách 10.000.000 ₫:**
>     *   Duyệt chi phí: 9.988.000 ₫ (dư 12.000 ₫).
>     *   Số lượng: 6 đầu sách / 91 bản.
>     *   Ưu tiên cao: 3 được duyệt, 93 bị bỏ lại.
>     *   Sách được duyệt: *Norwegian Wood* (28 bản), *Đi Tìm Lẽ Sống (Tái Bản 2022)* (5 bản), *Dac trung tam ly hoc cua nguoi Viet* (52 bản), *Dế mèn phiêu lưu ký* (3 bản), *Luy-Xiêng Và Chú Người Tuyết Cô Độc* (3 bản).
>     *   Sách ưu tiên cao bị bỏ lại: *Sắc Lời Đắc Thế*, *Kafka on the Shore*, *One Hundred Years of Solitude*, *Babel Hay Sự Cần Thiết Của Bạo Lực*, *Cây Cam Ngọt Của Tôi (Tái Bản 2026)*.
> 
> *   **Ngân sách 20.000.000 ₫:**
>     *   Duyệt chi phí: 19.861.000 ₫ (dư 139.000 ₫).
>     *   Số lượng: 16 đầu sách / 156 bản.
>     *   Ưu tiên cao: 13 được duyệt, 83 bị bỏ lại.
>     *   So với phương án 10 triệu: thêm 10 đầu sách, tăng 65 bản, giảm 10 sách ưu tiên cao bị bỏ lại.
>     *   Sách được duyệt thêm: *Sắc Lời Đắc Thế* (5 bản), *Kafka on the Shore* (9 bản), *One Hundred Years of Solitude* (12 bản), *Babel Hay Sự Cần Thiết Của Bạo Lực* (8 bản).
>     *   Sách ưu tiên cao bị bỏ lại: *Nghệ Thuật Tư Duy Chiến Lược*, *Cá Voi Tỷ Đô (Tái Bản 2022)*, *Những Kẻ Xuất Chúng (Tái Bản 2021)*, *Tư Duy Ngược*, *Người Đàn Ông Mang Tên OVE (Tái Bản)*.
> 
> **Đánh đổi**
> Khi ngân sách tăng từ 10 triệu lên 20 triệu, số đầu sách được duyệt tăng từ 6 lên 16 (thêm 10 tựa) và số bản tăng từ 91 lên 156 (thêm 65 bản). Mức ngân sách 20 triệu giúp đưa vào danh sách duyệt thêm các đầu sách quan trọng như *Sắc Lời Đắc Thế*, *Kafka on the Shore*, *One Hundred Years of Solitude* và *Babel Hay Sự Cần Thiết Của Bạo Lực*. Tuy nhiên, ngay cả ở mức 20 triệu, vẫn còn 83 đầu sách ưu tiên cao chưa được duyệt do giới hạn tổng vốn.
> 
> **Giới hạn**
> Mô phỏng dựa trên quy tắc phân bổ tối ưu hóa việc giảm thiểu thiếu hụt dự kiến trên

### mt-05#1 — Vì sao không chọn phương án khác?

tools: get_reorder_suggestions · 1817 ký tự · coverage 1.0 · ok

> Tôi xin lỗi về sự thiếu chính xác trong câu trả lời trước. Dưới đây là kết quả đối chiếu lại **CHỈ** dựa trên dữ liệu từ công cụ `simulate_reorder_budget` đã được truy xuất:
> 
> **Kết quả mô phỏng**
> 
> *   **Ngân sách 10.000.000 ₫:**
>     *   Duyệt chi phí: 9.988.000 ₫ (dư 12.000 ₫).
>     *   Số lượng: 6 đầu sách / 91 bản.
>     *   Ưu tiên cao: 3 được duyệt, 93 bị bỏ lại.
>     *   Sách được duyệt: *Norwegian Wood* (28 bản), *Đi Tìm Lẽ Sống (Tái Bản 2022)* (5 bản), *Dac trung tam ly hoc cua nguoi Viet* (52 bản), *Dế mèn phiêu lưu ký* (3 bản), *Luy-Xiêng Và Chú Người Tuyết Cô Độc* (3 bản).
>     *   Sách ưu tiên cao bị bỏ lại: *Sắc Lời Đắc Thế*, *Kafka on the Shore*, *One Hundred Years of Solitude*, *Babel Hay Sự Cần Thiết Của Bạo Lực*, *Cây Cam Ngọt Của Tôi (Tái Bản 2026)*.
> 
> *   **Ngân sách 20.000.000 ₫:**
>     *   Duyệt chi phí: 19.861.000 ₫ (dư 139.000 ₫).
>     *   Số lượng: 16 đầu sách / 156 bản.
>     *   Ưu tiên cao: 13 được duyệt, 83 bị bỏ lại.
>     *   So với phương án 10 triệu: thêm 10 đầu sách, tăng 65 bản, giảm 10 sách ưu tiên cao bị bỏ lại.
>     *   Sách được duyệt thêm: *Sắc Lời Đắc Thế* (5 bản), *Kafka on the Shore* (9 bản), *One Hundred Years of Solitude* (12 bản), *Babel Hay Sự Cần Thiết Của Bạo Lực* (8 bản).
>     *   Sách ưu tiên cao bị bỏ lại: *Nghệ Thuật Tư Duy Chiến Lược*, *Cá Voi Tỷ Đô (Tái Bản 2022)*, *Những Kẻ Xuất Chúng (Tái Bản 2021)*, *Tư Duy Ngược*, *Người Đàn Ông Mang Tên OVE (Tái Bản)*.
> 
> **Đánh đổi**
> Khi ngân sách tăng từ 10 triệu lên 20 triệu, số đầu sách được duyệt tăng từ 6 lên 16 (thêm 10 tựa) và số bản tăng từ 91 lên 156 (thêm 65 bản). Mức ngân sách 20 triệu giúp đưa vào danh sách duyệt thêm các đầu sách quan trọng như *Sắc Lời Đắc Thế*, *Kafka on the Shore*, *One Hundred Years of Solitude* và *Babel Hay Sự Cần Thiết Của Bạo Lực*. Tuy nhiên, ngay cả ở mức 20 triệu, vẫn còn

### na-01#0 — Tình hình quá hạn thế nào?

tools: get_overdue_summary · 116 ký tự · coverage None · ok

> Tài khoản hiện tại không có quyền xem dữ liệu quá hạn. Bạn cần được cấp quyền để truy cập thông tin này từ hệ thống.

### na-02#0 — Lượt mượn tháng này so với tháng trước thế nào?

tools: compare_borrow_periods · 136 ký tự · coverage None · ok

> Tài khoản hiện tại không có quyền xem dữ liệu so sánh lượt mượn giữa các kỳ. Bạn cần được cấp quyền tương ứng để truy cập thông tin này.

### na-03#0 — Nên ưu tiên xử lý việc gì hôm nay?

tools: rank_priority_tasks · 918 ký tự · coverage 1.0 · ok

> Danh sách việc cần ưu tiên xử lý hôm nay, xếp theo mức độ ảnh hưởng:
> 
> 1. **Bổ sung sách đã hết hàng nhưng vẫn có nhu cầu**: 90 đầu sách. Bạn đọc đang không thể mượn được các tựa này.
>    - *Bước tiếp theo*: Lập phiếu đề xuất nhập cho các đầu sách này (cần xác nhận trước khi tạo).
> 
> 2. **Thu hồi khoản phạt chưa thu**: Tổng cộng 497.133.500 ₫ tồn đọng.
>    - *Bước tiếp theo*: Rà soát các khoản phạt lớn nhất và tiến hành nhắc thanh toán.
> 
> 3. **Xét duyệt đề xuất nhập ưu tiên cao**: 96 đầu sách có dự báo nhu cầu vượt quá tồn khả dụng hiện tại.
>    - *Bước tiếp theo*: Duyệt danh sách đề xuất nhập ưu tiên HIGH.
> 
> 4. **Kiểm tra kho dưới ngưỡng**: Có 9 đầu sách cảnh báo, trong đó **Kho HCM Chinh** là kho rủi ro nhất.
>    - *Bước tiếp theo*: Đối chiếu tồn thực tế và cân nhắc điều chuyển sách giữa các kho.
> 
> *Lưu ý*: Hệ thống không truy xuất được số liệu chi tiết về tình trạng quá hạn của phiếu mượn do lỗi kết nối dữ liệu.

### md-01#0 — Tại sao cuốn "Lập Trình Lượng Tử Cho Mèo" được đề xuất nhập?

tools: explain_reorder_item · 862 ký tự · coverage None · not_found_ok=False

> Cuốn "Lập Trình Lượng Tử Cho Mèo" được đề xuất nhập vì tồn kho hiện chỉ còn 5 bản, thấp hơn ngưỡng an toàn là 10 bản, trong khi nhu cầu mượn vẫn đang ở mức cao với 65 lượt mượn trong 30 ngày gần đây.
> 
> **Căn cứ:**
> - Tồn kho hiện tại: 5 bản (ngưỡng an toàn: 10 bản).
> - Nhu cầu thực tế: 65 lượt mượn trong 30 ngày qua.
> - Dự báo thiếu hụt: Với tốc độ mượn hiện tại, sách có nguy cơ hết hàng sau khoảng 110,6 ngày nếu không bổ sung.
> - Đề xuất nhập: 28 bản để đáp ứng nhu cầu trong thời gian chờ hàng 30 ngày (theo cam kết nhà cung cấp).
> - Yếu tố hỗ trợ: Có thêm 88 yêu thích (wishlist) và 5 cảnh báo chờ hàng từ người dùng.
> 
> **Lưu ý:**
> - Độ tin cậy dữ liệu ở mức TRUNG BÌNH do thời gian chờ hàng dựa trên cam kết nhà cung cấp thay vì lịch sử giao hàng thực tế.
> - Xu hướng mượn đang giảm nhẹ (~0,159 bản/ngày) so với kỳ trước, nhưng vẫn đủ lớn để cần bổ sung kịp thời.

### md-02#0 — Có sách Lập Trình Lượng Tử Cho Mèo không?

tools: search_books · 320 ký tự · coverage None · unverified=1

> Catalog hiện không có sách chính xác tên "Lập Trình Lượng Tử Cho Mèo". Kết quả tìm kiếm chỉ ra một số tựa gần đúng nhưng độ tin cậy thấp (0,29), bao gồm:
> 
> - **Phương Pháp Đặt Câu Hỏi Của Socrates** (Thinknetic): 0 bản
> - **Project Hail Mary** (To Hoai): 6 bản
> - **Phương Pháp Học Tập Feynman** (Âm Hồng Tín, Lý Vĩ): 0 bản

### am-01#0 — Tại sao kho này thiếu sách?

tools: — · 112 ký tự · coverage None · ok

> Bạn đang hỏi về kho nào? Các kho hiện có: Chi Nhanh District 3, Kho HCM Chinh, Chi Nhanh District 1, Kho Ha Noi.

### am-02#0 — Giải thích kỹ hơn

tools: — · 347 ký tự · coverage None · ok

> Bạn đang muốn giải thích kỹ hơn về nội dung nào? Ví dụ:
> - Tại sao một đầu sách được đề xuất nhập hoặc không được đề xuất?
> - Nguyên nhân một kho thiếu sách?
> - Kết quả so sánh hai kỳ mượn/trả/đặt chỗ?
> - Phân tích tồn kho thấp, rủi ro kho, hay thanh lý sách?
> 
> Vui lòng cho biết cụ thể chủ đề hoặc tên sách/kho bạn quan tâm để mình phân tích chi tiết.

### am-03#0 — So sánh với kỳ trước

tools: — · 102 ký tự · coverage None · ok

> Bạn muốn so sánh chỉ số nào với kỳ trước? Ví dụ: lượt mượn, top sách được mượn, hay tình hình quá hạn.

