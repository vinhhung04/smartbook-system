# Mermaid IR — ai-copilot-pipeline.mmd

1 diagram(s): [0] flowchart (20n/15e)

## Diagram 0 — flowchart

- source layout: none (Mermaid is layout-free); direction: TB
- nodes: 20 total / 16 drawable / 4 containers, depth 1
- edges: 15 (3 labeled, 0 dangling), cycle: False
- shapes: {'rect': 13, 'container': 4, 'rhombus': 2, 'cylinder': 1}
- type candidates: flowchart, architecture
- budget: nodes OVER (max 9), edges OVER (max 12)
- discarded: 0 style directives, 0 click handlers, 1 config directives
- hubs (focal candidates): Kiểm chứng · Layer 1 tất định(3), Dữ liệu có cấu trúc · \+ bảng bằng chứng(3), Văn bản \+ biểu đồ \+ bằng chứng · \+ rủi ro và giới hạn(2), Lập kế hoạch luật · copilot\_plan\.build\_plan(2), Hành động chờ xác nhận · \(5 loại, hết hạn 10 phút\)(2)
- entry points: Câu hỏi tiếng Việt · \+ trạng thái hội thoại, 20 công cụ chỉ đọc · gọi API bằng JWT người dùng, LLM viết câu trả lời · \(OpenRouter, Qwen\), Văn bản \+ biểu đồ \+ bằng chứng · \+ rủi ro và giới hạn
- terminals: Semantic Planner: · LLM chỉ đọc nghĩa, · backend kiểm tra, luật thắng, Giải thích: FACT · INFERENCE · · ASSUMPTION · UNKNOWN, Đặc tả biểu đồ line · bar · area · · pie · kpi · table \(Pydantic\), Layer 2–3: LLM trích claim, · backend phán quyết, PASSED / REPAIRED · WARNING \(lược câu sai\) · · BLOCKED \(sinh lại ≤ 1 lần vẫn lỗi\), Web: sanitize đặc tả, · chỉ vẽ bằng component whitelist
- collapsible groups (simplify here first):
  - 4\. Phản hồi và hành động có kiểm soát — 5 children: Văn bản \+ biểu đồ \+ bằng chứng · \+ rủi ro và giới hạn, Web: sanitize đặc tả, · chỉ vẽ bằng component whitelist, safe\_to\_act?, Hành động chờ xác nhận · \(5 loại, hết hạn 10 phút\), Con người xác nhận hoặc hủy
  - 2\. Thu thập bằng chứng — 4 children: 20 công cụ chỉ đọc · gọi API bằng JWT người dùng, Dữ liệu có cấu trúc · \+ bảng bằng chứng, Giải thích: FACT · INFERENCE · · ASSUMPTION · UNKNOWN, Đặc tả biểu đồ line · bar · area · · pie · kpi · table \(Pydantic\)
  - 3\. Sinh và kiểm chứng câu trả lời — 4 children: LLM viết câu trả lời · \(OpenRouter, Qwen\), Kiểm chứng · Layer 1 tất định, Layer 2–3: LLM trích claim, · backend phán quyết, PASSED / REPAIRED · WARNING \(lược câu sai\) · · BLOCKED \(sinh lại ≤ 1 lần vẫn lỗi\)
  - 1\. Hiểu câu hỏi và lập kế hoạch — 3 children: Câu hỏi tiếng Việt · \+ trạng thái hội thoại, Lập kế hoạch luật · copilot\_plan\.build\_plan, Semantic Planner: · LLM chỉ đọc nghĩa, · backend kiểm tra, luật thắng

### Nodes

| id | label | shape | depth | parent | deg | fields |
|---|---|---|---|---|---|---|
| s1 | 1\. Hiểu câu hỏi và lập kế hoạch | container | 0 | - | 0/1 | - |
| q | Câu hỏi tiếng Việt ⏎ \+ trạng thái hội thoại | rect | 1 | s1 | 0/1 | - |
| plan | Lập kế hoạch luật ⏎ copilot\_plan\.build\_plan | rect | 1 | s1 | 1/1 | - |
| sem | Semantic Planner: ⏎ LLM chỉ đọc nghĩa, ⏎ backend kiểm tra, luật thắng | rect | 1 | s1 | 1/0 | - |
| s2 | 2\. Thu thập bằng chứng | container | 0 | - | 1/1 | - |
| tools | 20 công cụ chỉ đọc ⏎ gọi API bằng JWT người dùng | rect | 1 | s2 | 0/1 | - |
| data | Dữ liệu có cấu trúc ⏎ \+ bảng bằng chứng | cylinder | 1 | s2 | 1/2 | - |
| xai | Giải thích: FACT · INFERENCE · ⏎ ASSUMPTION · UNKNOWN | rect | 1 | s2 | 1/0 | - |
| viz | Đặc tả biểu đồ line · bar · area · ⏎ pie · kpi · table \(Pydantic\) | rect | 1 | s2 | 1/0 | - |
| s3 | 3\. Sinh và kiểm chứng câu trả lời | container | 0 | - | 1/1 | - |
| llm | LLM viết câu trả lời ⏎ \(OpenRouter, Qwen\) | rect | 1 | s3 | 0/1 | - |
| ver | Kiểm chứng ⏎ Layer 1 tất định | rhombus | 1 | s3 | 1/2 | - |
| claims | Layer 2–3: LLM trích claim, ⏎ backend phán quyết | rect | 1 | s3 | 1/0 | - |
| st | PASSED / REPAIRED · WARNING \(lược câu sai\) · ⏎ BLOCKED \(sinh lại ≤ 1 lần vẫn lỗi\) | rect | 1 | s3 | 1/0 | - |
| s4 | 4\. Phản hồi và hành động có kiểm soát | container | 0 | - | 1/0 | - |
| resp | Văn bản \+ biểu đồ \+ bằng chứng ⏎ \+ rủi ro và giới hạn | rect | 1 | s4 | 0/2 | - |
| ui | Web: sanitize đặc tả, ⏎ chỉ vẽ bằng component whitelist | rect | 1 | s4 | 1/0 | - |
| act | safe\_to\_act? | rhombus | 1 | s4 | 1/1 | - |
| pa | Hành động chờ xác nhận ⏎ \(5 loại, hết hạn 10 phút\) | rect | 1 | s4 | 1/1 | - |
| human | Con người xác nhận hoặc hủy | rect | 1 | s4 | 1/0 | - |

### Edges

| source | target | label | style |
|---|---|---|---|
| Câu hỏi tiếng Việt | Lập kế hoạch luật | - | solid arrow |
| Lập kế hoạch luật | Semantic Planner: | cờ COPILOT\_SEMANTIC\_PLANNER ⏎ \(mặc định off\) | dashed arrow |
| 20 công cụ chỉ đọc | Dữ liệu có cấu trúc | - | solid arrow |
| Dữ liệu có cấu trúc | Giải thích: FACT · INFERENCE · | - | solid arrow |
| Dữ liệu có cấu trúc | Đặc tả biểu đồ line · bar · area · | - | solid arrow |
| LLM viết câu trả lời | Kiểm chứng | - | solid arrow |
| Kiểm chứng | Layer 2–3: LLM trích claim, | cờ COPILOT\_SEMANTIC\_CLAIMS ⏎ \(mặc định off\) | dashed arrow |
| Kiểm chứng | PASSED / REPAIRED · WARNING \(lược câu sai\) · | - | solid arrow |
| Văn bản \+ biểu đồ \+ bằng chứng | Web: sanitize đặc tả, | - | solid arrow |
| Văn bản \+ biểu đồ \+ bằng chứng | safe\_to\_act? | - | solid arrow |
| safe\_to\_act? | Hành động chờ xác nhận | Có | solid arrow |
| Hành động chờ xác nhận | Con người xác nhận hoặc hủy | - | solid arrow |
| 1\. Hiểu câu hỏi và lập kế hoạch | 2\. Thu thập bằng chứng | - | solid arrow |
| 2\. Thu thập bằng chứng | 3\. Sinh và kiểm chứng câu trả lời | - | solid arrow |
| 3\. Sinh và kiểm chứng câu trả lời | 4\. Phản hồi và hành động có kiểm soát | - | solid arrow |
