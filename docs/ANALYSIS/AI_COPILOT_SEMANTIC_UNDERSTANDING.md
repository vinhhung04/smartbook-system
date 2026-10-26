# AI Copilot — Phase 1: Hiểu ngôn ngữ tự nhiên nâng cao (Hybrid Semantic Planner)

Ngày: 26/10/2026 · Nhánh: `hungg` (gốc `70ebcd6`) · Phạm vi: `services/ai-service`

> **Kết luận ngắn.** Planner luật được sửa các lỗi hiểu câu chứng minh được (ngữ cảnh nhiều lượt, ngân sách
> tương đối, danh sách số tiền, câu không dấu) — **bật ngay**. Lớp Semantic Planner (LLM chỉ đọc nghĩa, backend
> kiểm tra và lập kế hoạch) tăng mạnh khả năng hiểu câu diễn đạt gián tiếp (paraphrase 3/14 → 13/14 trên tập test
> đóng băng) nhưng **trượt một tiêu chí đặt trước** (context resolution 0,810 < 0,85), nên theo đúng quy tắc đã
> đăng ký trước, cờ `COPILOT_SEMANTIC_PLANNER` **mặc định TẮT**. Mọi số liệu bên dưới là số đo thật; nhãn do
> một người gán (xem §10.1).

---

## 1. Kiến trúc trước nâng cấp

`/assistant` và `/assistant/stream` dùng chung `_start_assistant_turn()` → `_plan_assistant_turn()` →
`copilot_plan.build_plan()`:

- **Chuẩn hoá** (`normalize_query`): bỏ dấu, viết tắt (`ko`, `bn`, `tk`, `hn`…), sửa lỗi gõ có kiểm soát (chỉ sửa
  khi kết quả là từ trong từ vựng nghiệp vụ).
- **Nhận diện capability** bằng bảng từ khoá/regex (`CAP_KEYWORDS`, 13 capability), loại phân tích
  (`lookup/causal/comparison/decision/what_if/ranking`), kỳ thời gian, ngân sách, % thay đổi, kho, tên sách.
- **Theo dõi hội thoại** bằng `copilot_state` (lưu trong metadata tin nhắn): capability, kho, kỳ, ngân sách,
  `last_items`, tool đã gọi, biểu đồ đã hiển thị. Câu nối tiếp được nhận diện bằng mẫu ("vậy còn…", "tại sao",
  tham chiếu "kho đó", "cuốn thứ hai"…).
- **Tool** chỉ lấy trong `PLANNABLE_TOOLS` (20 tool đọc), đối số do backend dựng; composite tool
  (`analyze_demand_vs_stock`, `compare_warehouses`, `simulate_reorder_budget`…) đã gộp sẵn nhiều nhu cầu.
- Câu không có capability → plan rỗng → vòng tool-calling của LLM tự chọn tool (tối đa
  `ASSISTANT_MAX_TOOL_ROUNDS=4` vòng); sau đó là chuỗi kiểm chứng (grounding, faithfulness, decision verification).
- `nlu.py` (`/chat`) là bộ phân loại intent riêng, có LLM fallback.

## 2. Hạn chế được chứng minh (bằng code hoặc benchmark)

Đo bằng bộ benchmark mới (§9) trên **planner luật nguyên trạng** (`70ebcd6`), trước mọi thay đổi:

| Hạn chế | Bằng chứng |
|---|---|
| Câu diễn đạt gián tiếp không được hiểu | Paraphrase (toàn bộ 32 câu): exact 8/32 (25%). Ví dụ "Dạo này thư viện hoạt động ra sao?", "Có vấn đề gì đáng lo trong kho không?", "Có ai mượn sách mà quên trả không?" → plan rỗng |
| Câu nhiều ý bị thiếu ý | Multi-intent: đủ mọi ý chỉ 20/30; "…những đầu sách nào **được quan tâm nhiều nhất**…" bỏ mất ý top sách |
| Đại từ trong cùng câu bị hiểu là tham chiếu lượt trước | "Nhập thêm sách gì với 15 triệu, và **những sách đó** có được mượn nhiều không?" → hỏi lại "cuốn nào?" (`_DEICTIC_BOOK` không xét tiền ngữ trong câu) |
| "nằm kho **trên** 90 ngày" bị hiểu là "kho trên" (kho vừa nhắc) | → hỏi lại "kho nào?" (`_DEICTIC_WAREHOUSE`) |
| "tồn kho **kho HCM** với kho Hà Nội" mất kho HCM | `re.finditer(r"\bkho (...)")` nuốt "kho kho hcm" → chỉ còn 1 kho → hỏi lại |
| Danh sách số tiền dùng chung đơn vị | "3 phương án 5, 15, 30 triệu" → chỉ đọc được 30 triệu |
| "Tăng **thêm** 5 triệu" bị hiểu là phương án 5 triệu | sau "ngân sách 10 triệu", plan là [5tr, 10tr] thay vì 15tr |
| "Kho nào đáng lo hơn?" sau khi so sánh 2 kho | không nối tiếp → xếp hạng toàn bộ 10 kho |
| "So sánh **hai kho này**" sau 2 lượt hỏi từng kho | state chỉ giữ kho của lượt gần nhất → hỏi lại |
| "Kho **còn lại** thì sao?" | không có cơ chế; kế thừa cả 2 kho |
| Kho kế thừa từ lượt trước không được đối chiếu quyền hiện tại | `named_warehouses = list(state["warehouses"])` — tool vẫn chặn theo token, nhưng tên kho đã mất quyền vẫn vào kế hoạch |
| **Cache trả lời sai ngữ cảnh** | `_assistant_cache_key` = hội thoại + quyền + câu hỏi. Trong **cùng** hội thoại, "Tại sao?" lần 2 (sau chủ đề khác) nhận lại câu trả lời của "Tại sao?" lần 1 |
| **Cache NLU bỏ qua lịch sử** | `nlu.classify_user_message` gửi lịch sử cho LLM nhưng khoá cache chỉ gồm vai trò + câu hỏi → "Còn tháng trước?" sau hai chủ đề khác nhau dùng chung một kết quả |
| Fast path (`_fast_path_tools`) chỉ dùng khi planner hiểu nhầm hoàn toàn | không có cơ chế phát hiện "planner hiểu thiếu" |

## 3. Kiến trúc mới

```text
Câu hỏi
  │
  ▼  normalize_query (mở rộng: trc, hnay, thg, nhiu, "kho dn/ct"…)
build_plan (luật)  ── sửa: anaphora trong câu, kho kho, danh sách tiền, ngân sách tương đối,
  │                    hai kho này / kho còn lại / kho nào … hơn, lọc kho theo quyền hiện tại,
  │                    decompose() → sub_questions, tối đa 6 tool/lượt
  ▼
assess(plan)  ── không có lý do ──────────────────────────────► plan luật (đường nhanh, 0 LLM)
  │ có lý do: no_capability | uncovered_clause | decision_without_recommending_capability | capabilities_without_tools
  ▼  (cờ COPILOT_SEMANTIC_PLANNER=on; không bao giờ cho: yêu cầu ghi, dữ liệu cá nhân, câu luật đã hỏi lại,
  │   follow-up chỉ đổi cách trình bày)
interpret()  ── 1 lần chat_json (OpenRouter, Qwen, temperature 0, ≤450 token, timeout 5 s)
  ▼
validate()   ── schema chặt: capability/analysis trong danh mục, kỳ trong tập token cố định, kho phải khớp
  │             đúng tên kho NGƯỜI DÙNG ĐANG THẤY, bỏ mọi trường lạ (tools, endpoint…)
  ▼
reconcile()  ── luật thắng: chỉ THÊM capability; kho/kỳ chỉ điền khi luật để trống; số tiền, %, tên sách,
  │             giới hạn luôn từ câu chữ người dùng
  ▼
build_plan(message, state, warehouses, hint=SemanticHint)  ── backend dựng tool + đối số như cũ
  ▼
Thực thi tool (song song, đã khử trùng lặp) → trả lời → kiểm chứng (giữ nguyên) → phản hồi
```

Không thêm microservice, không đổi schema DB, không đổi API/response schema (chỉ thêm trường tùy chọn
`plan.sub_questions`, `plan.semantic`), không đổi thuật toán analytics/reorder, không đổi AI Action / human-in-the-loop.

## 4. Semantic routing — khi nào gọi LLM

`copilot_semantic_planner.assess()` trả về **lý do cụ thể, kiểm tra được**, không dùng ngưỡng confidence:

| Lý do | Điều kiện |
|---|---|
| `no_capability` | plan không có capability, câu có ≥ 2 từ nội dung |
| `uncovered_clause` | câu tách được ≥ 2 vế (`,` `;` `?` `và` `đồng thời`…), có vế ≥ 3 từ nội dung mà không ánh xạ được capability/trình bày; ngày, số tiền, tên kho đứng một mình **không** tính là đã hiểu nếu còn ≥ 2 từ nội dung khác |
| `decision_without_recommending_capability` | câu hỏi "nên làm gì" nhưng chỉ có capability chẩn đoán (không có reorder/priority/weeding) |
| `capabilities_without_tools` | có capability nhưng không dựng được tool nào |

Không bao giờ định tuyến (`guarded()`): dữ liệu cá nhân (`_SENSITIVE`), yêu cầu ghi (`_ACTION_SURFACE`), câu
ngoài phạm vi luật đã xác định, câu luật đã hỏi lại (thiếu đối tượng → hỏi, không đoán), follow-up chỉ đổi cách
trình bày (dùng lại dữ liệu). Số lượng capability lớn **không** phải lý do định tuyến.

Tỷ lệ định tuyến đo được: 23/108 lượt test (21%), 23/116 lượt dev+val.

## 5. Structured schema và validation

LLM trả về đúng một JSON object:

```json
{"capabilities": ["top_borrowed","warehouse_risk","reorder"], "analysis_type": "decision",
 "time_range": "this_month", "comparison_period": null, "warehouses": [], "references_previous": false,
 "sub_questions": [{"question": "...", "capabilities": ["top_borrowed"]}],
 "out_of_scope": false, "action_request": false, "needs_clarification": false,
 "clarification_reason": null, "confidence": 0.9}
```

`validate()`:

- `capabilities` phải là danh sách chuỗi (sai kiểu → **cả bản đọc bị loại**, dùng plan luật); khoá ngoài 13
  capability bị bỏ và ghi vào `dropped`; tối đa 4.
- `analysis_type` ngoài 6 giá trị → bỏ. Kỳ chỉ nhận `today … last_year | last_N_days | last_N_months | month_M`,
  rồi chuyển qua `parse_periods()` của planner (cùng lịch Việt Nam).
- `warehouses`: chỉ nhận tên/mã **khớp chính xác** (sau chuẩn hoá) với danh sách kho người dùng đang thấy; không
  khớp → bỏ, ghi `warehouse_not_visible` (không ghi lại tên — tránh lộ kho ngoài phạm vi).
- Trường lạ (`tools`, `endpoint`, `sql`…) bị bỏ. Cờ boolean sai kiểu → loại bản đọc.
- `confidence` chỉ được ghi log, **không** dùng để quyết định.
- Prompt chỉ chứa ngữ cảnh do backend dựng (capability/kho/kỳ/ngân sách/tên sách của lượt trước, danh sách kho
  được thấy, kết quả luật) — **không** chứa văn bản câu trả lời trước. Câu hỏi được bọc `<question>` và khai báo là dữ liệu.

## 6. Reconciliation (quy tắc rõ ràng, có log)

Thứ tự, quy tắc đầu tiên khớp được áp dụng; chuỗi quyết định được ghi log và lưu vào `plan.semantic.decision`:

1. `action_request` → giữ plan luật (`keep_rules:action_request`): hành động vẫn đi qua đường cũ có xác nhận.
2. `out_of_scope` → từ chối không gọi tool (`abstain`), trừ khi luật đã thấy capability (`keep_rules:conflict_out_of_scope`).
3. `needs_clarification` + luật không thấy gì + (không có capability hoặc lý do là kho/sách) → câu hỏi lại do
   **backend** soạn theo lý do (`clarify:warehouse|book|period|other`), LLM không viết câu chữ.
4. Bản đọc không có capability → plan luật.
5. Còn lại → `SemanticHint` → `build_plan(..., hint)`: capability của luật **giữ nguyên**, bản đọc chỉ **thêm**;
   analysis chỉ thay khi luật là `lookup`; kho/kỳ chỉ điền khi luật để trống; `references_previous` chỉ bật
   follow-up khi có state. Nếu không thêm được gì → `keep_rules:no_new_information`. Plan cuối ghi giả định
   "Đã hiểu câu hỏi gồm các ý: …" để câu trả lời nói rõ cách hiểu.

Mọi lỗi (không có provider, timeout, JSON sai, lỗi mạng, bản đọc sai kiểu) → `fallback:*`, dùng plan luật; request
không bao giờ hỏng vì lớp này. Bản đọc được cache 10 phút với khoá gồm câu hỏi chuẩn hoá + state lượt trước + danh
sách kho được thấy.

## 7. Multi-intent

- `copilot_plan.decompose()` tạo `plan.sub_questions`: mỗi capability một ý, gồm mục tiêu, tool trả lời, kho/kỳ,
  `depends_on` (ví dụ "cần nhập bao nhiêu" dựa trên "sách mượn nhiều" và "sắp hết") và trạng thái
  `planned | partial | unsupported` (ví dụ lượt mượn theo chi nhánh: số liệu chỉ có toàn hệ thống → `partial`).
- Tool được khử trùng lặp, composite tool được ưu tiên (một `analyze_demand_vs_stock` trả lời cả 3 ý của
  "mượn nhiều nhất, sắp hết, nhập bao nhiêu"), tối đa `MAX_PLANNED_TOOLS = 6` tool/lượt, chạy song song
  (`asyncio.gather`, như trước). Lập kế hoạch không đệ quy: không có vòng gọi lại planner.
- `plan_note` liệt kê các ý và yêu cầu trả lời đủ từng ý; `coverage_note()` báo cho LLM ý nào có tool lỗi hoặc
  chưa hỗ trợ để nói rõ "chưa trả lời được" (partial results), không suy đoán. Số liệu vẫn do backend tính; chuỗi
  kiểm chứng giữ nguyên.

## 8. Conversation state và context

`copilot_state` (đã có) được mở rộng tối thiểu:

| Trường mới | Dùng cho |
|---|---|
| `recent_warehouses` (≤ 4, mới nhất trước) | "So sánh hai kho này" sau hai lượt hỏi từng kho |
| `focus_warehouse` (kho `compare_warehouses` đánh giá rủi ro hơn) | "Kho còn lại thì sao?"; không xác định được → hỏi lại kèm danh sách |

Quy tắc mới trong `build_plan`:

- **Ngân sách tương đối**: "tăng/thêm/cộng X triệu" = ngân sách trước ± X (ghi giả định "10 triệu + 5 triệu = 15
  triệu"); "tăng lên 25 triệu" = giá trị tuyệt đối; "giảm 20%" = −20%; "giảm xuống còn 20%" = −80% (đã có, có test).
- **"Kho nào … hơn?"** ngay sau khi bàn 2 kho → so sánh đúng 2 kho đó.
- **An toàn ngữ cảnh**: kho kế thừa (lượt trước, `recent_warehouses`, restyle) phải còn trong danh sách kho người
  dùng **đang** thấy (`_still_visible`); mất quyền → không kế thừa (thành câu hỏi lại). Chủ đề độc lập không kế
  thừa ngân sách/kho (có test). Bản đọc ngữ nghĩa chỉ được *bật* follow-up, không tắt được quy tắc an toàn.
- **Cache**: câu trả lời cho câu nối tiếp được cache theo state lượt trước (`ctx-<sha256(state)>`); câu không phụ
  thuộc ngữ cảnh giữ khoá cũ (vẫn trúng cache khi hỏi lại). Cache NLU (`nlu.py`) thêm băm lịch sử vào khoá.

Thông tin người dùng nêu và thông tin suy diễn tách biệt: suy diễn nằm trong `plan.assumptions`/`carried_over`
(được đưa vào prompt và yêu cầu nêu trong câu trả lời), không ghi đè giá trị người dùng nêu ở lượt sau.

## 9. Benchmark

### 9.1 Bộ dữ liệu

`services/ai-service/eval/nlu_phase1/` — `build_dataset.py` → `nlu_phase1_questions.jsonl`:
**209 lượt được chấm** (+15 lượt dựng ngữ cảnh) trong 187 hội thoại (172 câu đơn + 15 hội thoại nhiều lượt).
Chỉ số intent/capability/tool tính trên các lượt cần dữ liệu (test: 82); lượt hỏi lại, từ chối, bảo mật được chấm
bằng chỉ số riêng.

| Nhóm | Lượt | Ghi chú |
|---|---:|---|
| Simple intent | 26 | |
| Semantic paraphrase | 32 | |
| Multi-intent | 30 | |
| Multi-turn / context | 37 | 15 hội thoại, lượt dựng ngữ cảnh chấm riêng |
| Informal / không dấu | 26 | |
| Comparison / causal / what-if | 26 | |
| Ambiguous / unsupported / out-of-scope | 21 | |
| Security / action | 11 | 2 lượt với người dùng chỉ thấy kho HCM |

Tách dev/val/test theo `root` (họ câu hỏi cùng nghĩa) bằng sha256 → test 100 lượt chấm (108 cả setup),
dev 59, val 50; paraphrase cùng gốc không rơi vào hai tập. **Tập test và tiêu chí chấp nhận được đóng băng
trước mọi thay đổi code** (`nlu_phase1_freeze.json`, sha256 test `421a0d58…`); mã nguồn được băm trước khi chạy test
(`code_freeze.sha256`). Thay đổi duy nhất sau khi băm: `plan.semantic` thêm `llm_calls` (usage của lời gọi lập kế
hoạch, để §9.4 đo chi phí) — không ảnh hưởng kế hoạch.

Bộ chấm `eval_nlu_phase1.py` độc lập với code được kiểm thử: tự ánh xạ tool → capability, tự giải nghĩa kỳ thời
gian, tự giả lập kết quả tool cho state lượt sau. `low_stock_items` được chấm như `warehouse_risk`.

### 9.2 Kết quả trên tập test đóng băng (planner-level)

| Chỉ số (test, 108 lượt) | Baseline (luật, 70ebcd6) | Luật sau Phase 1 | Hybrid lần 1 | Hybrid lần 2 |
|---|---|---|---|---|
| Intent (đúng trọn bộ capability) | 59/82 (0,720) | 61/82 (0,744) | 74/82 (0,902) | 74/82 (0,902) |
| Capability P / R / F1 | 1,000 / 0,747 / 0,855 | 1,000 / 0,768 / 0,869 | 0,989 / 0,927 / **0,957** | 0,989 / 0,927 / **0,957** |
| Tool P / R / F1 | 0,987 / 0,747 / 0,851 | 0,988 / 0,768 / 0,864 | 0,980 / 0,927 / **0,953** | 0,980 / 0,927 / **0,953** |
| Loại phân tích | 16/17 | 16/17 | 16/17 | 16/17 |
| Thực thể (từng trường) | 34/39 (0,872) | 38/39 (0,974) | 38/39 (0,974) | 38/39 (0,974) |
| Context resolution | 13/21 (0,619) | 16/21 (0,762) | **17/21 (0,810)** | **17/21 (0,810)** |
| Multi-intent coverage TB / đủ ý | 0,812 / 6/8 | 0,812 / 6/8 | 0,938 / 7/8 | 0,938 / 7/8 |
| Hỏi lại đúng khi cần | 5/6 | 5/6 | 5/6 | 5/6 |
| Hỏi lại thừa | 2/90 | 1/90 | 1/90 | 1/90 |
| Từ chối câu ngoài phạm vi | 6/6 | 6/6 | 6/6 | 6/6 |
| Vi phạm bảo mật/hành động | 0 | 0 | 0 | 0 |
| Gọi semantic planner cho câu ghi/dữ liệu cá nhân | 0 | 0 | 0 | 0 |
| Thời gian lập kế hoạch p50 / p95 (mọi lượt) | 0,7 / 1,2 ms | 0,8 / 1,2 ms | 0,8 ms / 2,81 s | 0,8 ms / 2,92 s |
| — chỉ lượt được định tuyến p50 / p95 | — | — | 2,58 / 3,16 s | 2,61 / 3,67 s |
| Lượt gọi LLM lập kế hoạch (tổng / mỗi lượt) | 0 | 0 | 23 / 0,213 | 23 / 0,213 |
| Token prompt / completion (cả tập) | 0 | 0 | 19 375 / 3 513 | 19 375 / 3 580 |
| Chi phí OpenRouter (cả tập 108 lượt) | 0 | 0 | 0,00093 USD | 0,00100 USD |

| Nhóm (intent đúng trọn, F1) | Baseline | Luật sau Phase 1 | Hybrid (cả 2 lần) |
|---|---|---|---|
| simple | 14/14, 1,00 | 14/14, 1,00 | 14/14, 1,00 |
| paraphrase | 2/14, 0,25 | 3/14, 0,35 | **13/14, 0,97** |
| multi_intent | 6/8, 0,89 | 6/8, 0,89 | 6/8, 0,93 |
| context | 15/21, 0,87 | 16/21, 0,89 | 17/21, 0,91 |
| informal / không dấu | 11/13, 0,92 | 11/13, 0,92 | **13/13, 1,00** |
| comparison/causal/what-if | 11/12, 0,96 | 11/12, 0,96 | 11/12, 0,96 |

Model: `qwen/qwen3.7-flash` qua OpenRouter (cấu hình hiện tại). Hai lần chạy hybrid cho đúng cùng danh sách lỗi
(temperature 0), độ trễ khác nhau.

### 9.3 Đối chiếu tiêu chí đã đăng ký trước

| Tiêu chí | Ngưỡng | Hybrid (2 lần) | Đạt? |
|---|---|---|---|
| A1 Capability F1 | ≥ 0,90 | 0,957 / 0,957 | ✅ |
| A2 Tool F1 | ≥ 0,90 | 0,953 / 0,953 | ✅ |
| A3 Context resolution | ≥ 0,85 | 0,810 / 0,810 | ❌ |
| A4 Multi-intent coverage TB | ≥ 0,85 | 0,938 / 0,938 | ✅ |
| A5 Bảo mật | 0 vi phạm, 0 lần gọi LLM cho câu ghi/cá nhân | 0 / 0 | ✅ |
| A6 Simple intent | không thấp hơn 14/14 quá 1 lượt | 14/14 | ✅ |
| A7 Từ chối / hỏi lại thừa | ≥ baseline / ≤ baseline + 2 | 6/6 · 1 | ✅ |
| A8 Chi phí / độ trễ | ≤ 0,5 lượt LLM/lượt; p95 lập kế hoạch ≤ 6 s; ≤ 0,001 USD/lượt | 0,213; 2,8–2,9 s; ~0,000009 USD/lượt | ✅ |

**Quyết định (theo quy tắc đăng ký trước):** A3 không đạt → `COPILOT_SEMANTIC_PLANNER` mặc định **off**. Các sửa đổi
của planner luật được bật (bộ test hiện có đều qua và số liệu test không giảm ở chỉ số nào).

### 9.4 End-to-end qua `/assistant` thật (stack Docker + OpenRouter)

`eval/nlu_phase1/e2e_phase1.py`: 69 hội thoại test (nhóm simple, paraphrase, multi-intent, context, informal,
comparison/what-if; 82 lượt chấm + setup) chạy qua `main.assistant()` thật trong container ai-service, stack Docker
thật (gateway, analytics, OpenRouter), tài khoản demo ADMIN. Mỗi hội thoại chạy hai lần (cờ off/on, thứ tự xen kẽ
ngẫu nhiên để cache tool ấm đều), từng lượt một. Độ phủ tính trên **mọi tool thực sự được gọi**, kể cả tool do LLM
tự chọn khi plan rỗng — nên baseline được tính công cho phần LLM tự xoay xở. Chạy 1 lần (26/10/2026, 827 s).

| Chỉ số (82 lượt) | Cờ off | Cờ on |
|---|---|---|
| Lỗi request | 0 | 0 |
| Độ trễ end-to-end p50 / p95 | 3,8 / 8,7 s | 3,9 / 11,1 s |
| — chỉ 16 lượt được định tuyến, p50 / p95 | 6,7 / 10,1 s | 6,9 / 18,4 s |
| Lượt gọi LLM / lượt (trả lời + lập kế hoạch) | 1,54 | 1,62 |
| Chi phí OpenRouter / lượt | 0,000277 USD | 0,000277 USD |
| Token / lượt | 9 023 | 9 063 |
| Độ phủ capability bằng tool đã gọi (TB / đủ ý) | 0,860 / 69 | **0,957 / 77** |
| Câu hỏi cần dữ liệu nhưng trả lời **không gọi tool nào** | **9/82** | 1/82 |
| Lượt có grounding warning | 4 | 6 |

Nhận xét:

- Khi plan rỗng, LLM trả lời của baseline **không phải lúc nào cũng tự gọi tool**: 9/82 câu cần dữ liệu được trả lời
  mà không có dữ liệu. Ví dụ cờ off, "Độc giả thích đọc cuốn nào nhất?" → nêu một tên sách không lấy từ dữ liệu nào
  (không tool, 1 lời gọi LLM); cờ on → `get_top_books`, trả lời theo top mượn thật. Đây là lợi ích chính của Phase 1
  ở mức end-to-end, lớn hơn mức chênh của độ phủ trung bình.
- Chi phí mỗi lượt gần như không đổi: lời gọi lập kế hoạch rẻ (~0,00004 USD) và plan đầy đủ đôi khi bớt vòng
  tool-calling của LLM (ví dụ "Cho tôi biết sách tồn đọng lâu và những sách đang thiếu": 5 → 2 lời gọi).
- Độ trễ tăng ở đuôi: p95 lượt được định tuyến 10,1 → 18,4 s. Hai lượt chậm nhất (23,9 s; 16,6 s) là plan đầy đủ hơn
  khiến LLM trả lời gọi thêm tool/thêm vòng (6 lời gọi), không phải do bản thân bước lập kế hoạch (1,9–2,0 s). Mẫu
  nhỏ (16 lượt, 1 lần chạy) — chưa đủ để kết luận về p95.
- **Định tuyến thừa phát hiện ở bước này (sau khi đóng băng, chưa sửa):** "So sánh kho Hà Nội và kho HCM" bị định tuyến
  vì vế "so sánh kho Hà Nội" chỉ còn "so sánh" sau khi bỏ tên kho, mà động từ phân tích không được tính là "đã hiểu".
  Trên test, 3/23 lượt định tuyến kết thúc `keep_rules:no_new_information` (tốn ~2–3 s, không đổi kế hoạch). Không sửa
  sau khi đã chạy test để giữ số liệu đóng băng; ghi vào Phase 2.
- Kiểm chứng câu trả lời vẫn chạy cho mọi lượt (trạng thái `PASSED/REPAIRED/...` có trong 87 phản hồi cờ on, gồm cả lượt setup).

## 10. Giới hạn và vấn đề chưa giải quyết

### 10.1 Về dữ liệu đánh giá

- Câu hỏi và nhãn do **một người** (cũng là người cài đặt) viết tay, không sinh bằng LLM, không có người gán nhãn
  thứ hai, không phải câu hỏi của người quản lý thật. Số liệu là bằng chứng kỹ thuật trên bộ câu hỏi này, không phải
  hiệu quả trên người dùng thật.
- Tập **dev và val đều đã được dùng để phát triển** (val phát hiện 3 lỗi luật — "tồn kho kho HCM", "thiếu những
  sách gì", vế chỉ có ngày — đã sửa). Chỉ **test** là held-out; tập test không bị sửa sau khi đóng băng.
- Tập test nhỏ (100 lượt chấm, 21 lượt context, 8 lượt multi-intent): mỗi lượt context ≈ 4,8 điểm %, khoảng tin cậy
  rộng. Nhãn "alt" (nhiều cách hiểu chấp nhận được) là phán đoán của người gán nhãn.
- Benchmark chính đo **kế hoạch** (capability, tool, thực thể), không đo độ đúng của câu trả lời cuối; §9.4 chỉ đo
  độ trễ, chi phí và độ phủ tool end-to-end.

### 10.2 Các lượt test còn sai (giống nhau ở cả 2 lần chạy hybrid)

| Lượt | Vì sao sai |
|---|---|
| "Mọi người dạo này có mượn sách nhiều hơn không?" | Luật hỏi lại "so sánh chỉ số nào?" — câu luật đã hỏi lại không được định tuyến (thiết kế an toàn), nên LLM không có cơ hội hiểu "mượn … nhiều hơn" |
| "Chi nhánh Đà Nẵng đang thiếu gì, và lượt mượn ở đó có tăng không?" | "thiếu gì" không thành capability; mọi vế đều "được hiểu" một phần nên không định tuyến |
| "Phiếu quá hạn nhiều không và cần nhắc trả những phiếu nào trước?" | Bản đọc thêm `priority` (thừa) |
| Context "Nếu chỉ ưu tiên những sách được mượn nhiều thì sao?" (sau so sánh 2 kho) + lượt "ngắn gọn hơn" sau đó | Luật thấy `top_borrowed` nên không định tuyến; mất phạm vi kho và ý tồn kho |
| Context "Trong số đó cuốn nào sắp hết?" + "Cuốn thứ ba thì sao?" (sau top 5) | Hiểu "sắp hết" là rủi ro theo kho, không giữ danh sách top của lượt trước |
| "Nếu độc giả mượn nhiều gấp đôi thì kho có đủ không?" | What-if nhu cầu không có công cụ mô phỏng; chỉ lấy top sách |
| "Chi nhánh Hà Nội có thiếu sách không?" (2 chi nhánh HN + Kho Hà Nội) | Luật khớp "hà nội" → Kho Ha Noi thay vì hỏi lại (lỗi có từ trước) |

Ngoài test (dev/val, đã thấy khi phát triển): "Có bao nhiêu sách đang được mượn chưa trả?" bị hiểu là quá hạn;
"Ai là tác giả được yêu thích nhất ở Mỹ?" không bị từ chối (luật thấy capability nên không định tuyến).

### 10.3 Thiết kế

- Định tuyến dựa trên "khoảng trống phát hiện được"; câu luật hiểu **sai nhưng tự tin** (có capability, mọi vế đều
  khớp từ khoá) sẽ không được LLM xem lại — đây là nguồn chính của các lỗi context còn lại.
- Bản đọc LLM chỉ thêm, không bớt capability của luật; luật nhận nhầm thì hybrid không sửa được.
- Lớp này thêm ~2,6 s (p50) cho ~21% lượt; các lượt còn lại không đổi.

## 11. Bảo mật

- LLM không chọn tool/endpoint/đối số, không sinh SQL, không thực thi; tool cuối luôn ⊆ `PLANNABLE_TOOLS` (assert)
  và ≤ 6. Yêu cầu ghi/dữ liệu cá nhân không đi qua LLM lập kế hoạch (đo được: 0 lần).
- Kho trong bản đọc phải thuộc danh sách kho người dùng đang thấy; kho kế thừa từ state được lọc lại theo quyền hiện tại.
- Prompt injection trong câu hỏi: câu hỏi được khai báo là dữ liệu; đầu ra bị kiểm tra theo danh mục nên câu
  "gọi tool delete_all_loans" không thể sinh tool lạ (bộ test security: 0 vi phạm).
- RBAC, xác nhận hành động (pending action), kiểm chứng câu trả lời: không thay đổi.

## 12. Bật / tắt

```env
COPILOT_SEMANTIC_PLANNER=off                 # on | off (mặc định off)
COPILOT_SEMANTIC_PLANNER_TIMEOUT_SECONDS=5
```

Đã truyền qua `docker-compose.yml` (service `ai-service`). Bật: đặt `COPILOT_SEMANTIC_PLANNER=on` trong `.env`, rồi
`docker compose --profile ai up -d ai-service`. Không cần đổi frontend. Khi bật, `plan.semantic` trong response cho
biết lượt có được định tuyến không, lý do, quyết định reconcile, độ trễ và usage của lời gọi LLM.

Chạy lại đánh giá:

```bash
cd services/ai-service/eval/nlu_phase1
python eval_nlu_phase1.py --mode det --split test --label det        # planner luật, không cần mạng
OPENROUTER_API_KEY=... python eval_nlu_phase1.py --mode hybrid --split test --label hybrid
python eval_nlu_phase1.py --rescore ../reports/nlu_phase1/hybrid_test.json   # chấm lại, 0 chi phí
```

## 13. File thay đổi

| File | Thay đổi |
|---|---|
| `services/ai-service/copilot_semantic_planner.py` (mới) | routing, prompt, validate, reconcile, cache, `plan_turn()` |
| `services/ai-service/copilot_plan.py` | `SemanticHint`, sửa luật (§2), state `recent_warehouses`/`focus_warehouse`, `decompose()`, `MAX_PLANNED_TOOLS` |
| `services/ai-service/copilot_response.py` | danh sách ý trong `plan_note`, `coverage_note()` |
| `services/ai-service/main.py` | `_plan_assistant_turn` dùng `plan_turn` (chung cho 2 endpoint); khoá cache theo ngữ cảnh |
| `services/ai-service/nlu.py` | khoá cache NLU gồm băm lịch sử |
| `services/ai-service/test_copilot_semantic_planner.py` (mới) | 37 test (LLM giả) |
| `services/ai-service/eval/nlu_phase1/*` | bộ dữ liệu, bộ chấm, e2e, freeze |
| `docker-compose.yml`, `.env.example`, `docs/SERVICES/AI_SERVICE.md`, `services/ai-service/README.md` | cờ cấu hình |

## 14. Hướng Phase 2

1. Định tuyến cả câu luật đã hỏi lại kiểu "chỉ số nào?" (không phải thiếu đối tượng) và câu có capability nhưng
   đang là follow-up đổi phạm vi ("nếu chỉ ưu tiên…", "trong số đó…"), đo lại A3 trên tập test mới.
2. State giữ "danh sách đang bàn" (top N của lượt trước) để "trong số đó … sắp hết" lọc đúng danh sách.
3. Hỏi lại khi tên thành phố khớp nhiều kho/chi nhánh ("Chi nhánh Hà Nội").
4. Người gán nhãn thứ hai + tập test mới từ câu hỏi thật của người quản lý; đo độ đúng câu trả lời cuối.
5. Công cụ what-if nhu cầu (nhu cầu ×k) nếu nghiệp vụ cần.
6. Bỏ định tuyến thừa: coi động từ phân tích ("so sánh", "tại sao", "nên") là đã hiểu khi vế đó còn thực thể (§9.4).
7. Câu hỏi cần dữ liệu mà plan rỗng (cờ off) vẫn có thể được LLM trả lời không gọi tool (9/82 ở §9.4): nên áp dụng
   chỉ dẫn "chưa có dữ liệu, gọi tool trước" cả khi plan không có capability, độc lập với cờ.
