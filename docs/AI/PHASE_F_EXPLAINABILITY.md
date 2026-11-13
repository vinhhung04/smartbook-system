# Phase F — Explainable AI: hợp đồng bằng chứng thống nhất

> Code: `services/ai-service/ai_core/explainability.py`. Dùng lại `number_grounding` (so số), `copilot_explain` /
> `copilot_verification` (assistant), `vision_context.explain` (ảnh). Không có bộ XAI thứ hai: phía assistant chỉ **định dạng lại**
> kết quả đã tính; phía chatbot là lớp kiểm chứng theo luật mới (trước đây chatbot không có claim-level evidence).

## 1. Hợp đồng (trường tùy chọn `explainability` trên `/chat`, `/chat/stream` done, `/assistant`, `/assistant/stream` done)

```json
{
  "version": "F1",
  "evidence": [{"id": "ev-1", "source_type": "API|DOCUMENT|IMAGE_RECOGNITION", "source": "…", "source_ref": "faq://… | /analytics/…",
                "field": null, "value": null, "unit": null, "scope": "public|permission|self", "retrieved_at": "ISO",
                "internal": true, "kind": "policy_document|dynamic_data|personal_data|image_match", "snippet": "đoạn tài liệu"}],
  "claims": [{"id": "c-1", "claim": "…", "kind": "FACT|INFERENCE|ASSUMPTION|UNKNOWN",
              "verdict": "SUPPORTED|CONTRADICTED|UNSUPPORTED|UNVERIFIABLE|null", "evidence_ids": ["ev-1"], "detail": "…"}],
  "explanation": {"facts": [], "inferences": [], "assumptions": [], "unknowns": [], "limitations": [], "method": "Trả lời từ: …"},
  "verification": {"status": "PASSED|PARTIAL|WARNING|FAILED|NO_FACTUAL_CLAIMS|NO_EVIDENCE", "supported_claims": 0,
                   "contradicted_claims": 0, "unsupported_claims": 0, "unverifiable_claims": 0, "checker": "…"}
}
```

Khác với ví dụ khái niệm trong yêu cầu: bằng chứng và nhận định là hai danh sách liên kết bằng `evidence_ids` (một bằng chứng có thể đỡ nhiều nhận định).
Các trường cũ (`context_sources`, `retrieval_warnings`, `explanation`, `verification` của assistant) giữ nguyên.

## 2. Chatbot: kiểm chứng từng câu (`rule_based_chat_v1`)

| Câu trong câu trả lời | Phân loại | Verdict |
|---|---|---|
| Có con số, mọi số khớp dữ liệu đã truy xuất (dung sai `number_grounding`; số do người dùng nêu được bỏ qua) | FACT | SUPPORTED |
| Có con số không khớp gì | FACT | UNSUPPORTED |
| Nêu "còn N bản" khác số bản thật của sách trong ảnh | FACT | CONTRADICTED |
| "Chưa có dữ liệu / không tìm thấy…" | UNKNOWN | – |
| Nhắc đúng sách đã nhận diện từ ảnh | FACT | SUPPORTED (nguồn: nhận diện ảnh) |
| "Có thể / nên / gợi ý / dự kiến…" | INFERENCE | UNVERIFIABLE |
| Câu chính sách, trùng ≥ 50% từ nội dung với đoạn tài liệu đã truy xuất | FACT | SUPPORTED (nguồn: tài liệu) |
| Câu chính sách không khớp đoạn nào | FACT | UNVERIFIABLE (trích dẫn có mặt không đủ) |

Trạng thái: có CONTRADICTED → FAILED; có UNSUPPORTED → WARNING (**không bao giờ PASSED**); toàn SUPPORTED → PASSED; còn lại PARTIAL;
từ chối do không có bằng chứng → NO_EVIDENCE. Không có điểm tin cậy dạng số nào được tạo.

## 3. Assistant

`for_assistant()` đổi `verification.claims` của `copilot_verification` sang `claims` (giữ verdict gốc), `evidence` từ `evidence` của tool,
FACT/INFERENCE/ASSUMPTION/UNKNOWN từ `copilot_explain`; trạng thái PASSED/REPAIRED → PASSED, WARNING → WARNING, BLOCKED → FAILED; giữ `safe_to_act`.
UI trang `/ai-assistant` tiếp tục dùng các panel sẵn có (cùng dữ liệu); hợp đồng mới giúp client dùng chung.

## 4. Ảnh

`vision_context.explain()`: dữ kiện = OCR đọc được gì, CLIP gần nhất là sách nào với độ tương đồng bao nhiêu, catalog khớp sách nào;
kết luận = luật quyết định nào được áp dụng; chưa xác định = tín hiệu nào lỗi/không đọc được; giới hạn = "điểm không phải xác suất",
"không ghi vào danh mục". LLM không viết phần này.

## 5. Không lộ chain-of-thought, quyền riêng tư

Chỉ phương pháp tóm tắt, dữ kiện, nguồn và giới hạn; không có suy nghĩ nội bộ của model. Bằng chứng chỉ gồm nguồn lượt này thực sự đọc
(dữ liệu cá nhân chỉ khi câu hỏi cần — data minimization của Phase E giữ nguyên); cache chatbot khóa theo token nên bằng chứng không lẫn người dùng.

## 6. Giới hạn

Kiểm chứng chatbot là luật (số + trùng từ), không phải kiểm chứng ngữ nghĩa: câu diễn đạt lại tài liệu bằng từ khác có thể bị
UNVERIFIABLE; số suy ra (tổng, phần trăm) có thể bị UNSUPPORTED. Không hiển thị confidence số vì chưa có dữ liệu hiệu chỉnh độc lập.
