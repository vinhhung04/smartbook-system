# Thiết kế: Semantic FAQ Retrieval cho `/chat`

**Ngày:** 2026-08-28
**Trạng thái:** Đã duyệt, chờ implementation plan

## Bối cảnh

SmartBook có hai chatbot dùng chung nền `rag.py` / `retrieval.py` / `intent.py`:

- **`/chat`** (widget `apps/web/src/components/ai-chatbot.tsx`, load global trong `layout.tsx`) — dùng cho **mọi role**, kể cả CUSTOMER. Câu hỏi được phân loại vào 11 intent cố định (`services/ai-service/intent.py`) bằng keyword/regex; mỗi intent map cứng sang gọi 1-2 endpoint `/analytics/*` rồi format câu trả lời theo template viết sẵn.
- **`/assistant`** (trang `/ai-assistant`, chỉ ADMIN/WAREHOUSE_MANAGER) — dùng tool-calling thật qua Ollama, tự chọn gọi endpoint, không bị giới hạn bởi danh sách intent cố định.

**Vấn đề:** khi câu hỏi gửi tới `/chat` không khớp intent nào, nó rơi vào `GENERAL_QUERY` và **không truy xuất dữ liệu gì cả** (`retrieval.py:236-243`) — LLM trả lời "chay" hoặc không trả lời được, dù câu hỏi có thể hợp lệ về nghiệp vụ (vd hỏi về quy định phí phạt, quy trình mượn sách...).

Vì `/chat` phục vụ mọi role (bao gồm CUSTOMER), không thể tái dùng nguyên cơ chế tool-calling của `/assistant` (vốn cho phép gọi trực tiếp các endpoint `/analytics/*` nội bộ) mà không thiết kế lại phân quyền cẩn thận. Thay vào đó, thiết kế này bổ sung một tầng retrieval dựa trên nội dung tĩnh (FAQ/quy tắc nghiệp vụ), an toàn hơn cho đối tượng người dùng rộng.

## Mục tiêu

Khi `/chat` phân loại intent = `GENERAL_QUERY`, thử tìm các mục FAQ liên quan bằng semantic search (embedding + cosine similarity) thay vì bỏ trống, để trả lời được nhiều câu hỏi nghiệp vụ hơn mà vẫn giữ tính trung thực (không bịa khi không có dữ liệu liên quan).

**Ngoài phạm vi:** không đổi cách phân loại 11 intent hiện có (vẫn keyword/regex, fast path giữ nguyên), không đổi `/assistant`, không xây vector DB (pgvector/FAISS/Chroma) — quy mô dữ liệu (vài chục đến ~100 mục) không cần.

## Kiến trúc

### Thành phần mới

**`services/ai-service/faq_data.py`**
Danh sách tĩnh các mục FAQ, mỗi mục:
```python
{
  "id": "borrow-limit",
  "category": "borrow",
  "question": "Mỗi người được mượn tối đa bao nhiêu sách?",
  "answer": "...",  # câu trả lời chuẩn, do người soạn viết tay
}
```
Nội dung do người phát triển soạn (mượn sách, phí phạt, quy trình kho, chính sách chung...), review qua git như code — không có admin UI chỉnh sửa (ngoài phạm vi đồ án).

**`services/ai-service/faq_retrieval.py`**
- `embed_text(text: str) -> list[float]`: gọi Ollama `POST /api/embeddings` với model `nomic-embed-text` (model mới, cần `ollama pull nomic-embed-text`).
- `_load_faq_embeddings()`: lúc service khởi động (hoặc lazy ở lần gọi đầu tiên), embed toàn bộ `question` (và có thể alt phrasing nếu có) trong `faq_data.py`, giữ trong biến module-level dạng `list[(FAQEntry, np.ndarray)]`.
  - Cache ra file cục bộ `.faq_embeddings_cache.json` (khoá theo hash nội dung FAQ) để tránh gọi lại Ollama mỗi lần restart. Nếu hash lệch (FAQ đổi nội dung) → tính lại.
- `find_relevant(query: str, top_k: int = 3, threshold: float = 0.75) -> list[FAQMatch]`: embed câu hỏi, tính cosine similarity với toàn bộ FAQ đã cache, lọc theo `threshold`, trả về tối đa `top_k` kết quả, sắp theo similarity giảm dần.

### Tích hợp vào retrieval.py

Trong nhánh xử lý `GENERAL_QUERY` (hiện tại không làm gì, `retrieval.py:236-243`):

1. Gọi `faq_retrieval.find_relevant(user_message)`.
2. **Có kết quả** → build envelope `{summary, raw, sources}` cùng format các intent khác đang trả về, để tái dùng nguyên:
   - `verify_numeric_grounding()` (`rag.py:117-145`) — kiểm tra số liệu nếu có.
   - `ensure_source_line()` (dùng ở `main.py:3534, 3548`) — gắn nguồn.
   - `sources` là danh sách FAQ id/category đã match, để hiển thị "Nguồn: FAQ - borrow-limit" thay vì nguồn `/analytics/*`.
3. **Không có kết quả** (dưới threshold, hoặc Ollama lỗi) → giữ nguyên hành vi fallback hiện tại của `GENERAL_QUERY` — không thay đổi.

### Error handling

- Ollama embeddings timeout/exception → catch, log cảnh báo, coi như "không có kết quả" (rơi về fallback hiện tại). Không được làm `/chat` lỗi 500.
- Không match nào vượt threshold → trả lời trung thực kiểu "chưa có thông tin về câu hỏi này" thay vì để LLM tự bịa — giữ đúng triết lý chống ảo giác đã có trong hệ thống (`rag.py:121-124`).

## Data flow

```
User message → /chat
  → intent.py phân loại (không đổi)
  → intent == 1-trong-11-intent-cũ? → đường xử lý hiện tại (không đổi)
  → intent == GENERAL_QUERY?
      → faq_retrieval.find_relevant(message)
      → có match ≥ threshold?
          → có: build {summary, raw, sources} từ FAQ match → LLM tổng hợp câu trả lời → verify_numeric_grounding → reply
          → không: fallback hiện tại (không đổi)
```

## Testing

- **`test_faq_retrieval.py`** (mới):
  - Cosine ranking đúng thứ tự với FAQ mẫu cố định + Ollama embedding được mock.
  - Hành vi ngưỡng: câu hỏi liên quan rõ ràng → match; câu hỏi không liên quan → không match (dưới threshold).
  - Ollama lỗi/timeout → `find_relevant` trả về rỗng, không raise exception ra ngoài.
  - Cache: hash nội dung FAQ đổi → cache bị tính lại; không đổi → dùng cache, không gọi lại Ollama.
- **`test_rag.py`**: thêm case cho `GENERAL_QUERY` khi có FAQ match (grounding check chạy đúng trên nguồn FAQ) và khi không có match (giữ hành vi fallback cũ).

## Việc cần làm thêm ngoài code (không thuộc implementation plan)

- Soạn nội dung FAQ ban đầu (khoảng 30-100 mục) — người dùng tự viết, không phải việc của AI thực hiện thay.
- `ollama pull nomic-embed-text` trên môi trường chạy AI service (thêm vào README/docker profile AI nếu cần ghi chú lại).
