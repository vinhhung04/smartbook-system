# AI Service

## Mục tiêu

AI Service cung cấp năng lực tự động hóa nhập liệu sách bằng AI, tập trung vào OCR và chuẩn hóa metadata.

- Runtime: Python + FastAPI
- Entrypoint: services/ai-service/main.py
- Model runtime: Ollama local
- Vai trò: tra cứu ISBN, tạo tóm tắt tiếng Việt, OCR hóa đơn nhập kho, trợ lý ra quyết định

## Endpoint chính

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | /health | Kiểm tra trạng thái service |
| GET | /recommendations | Gợi ý đọc sách |
| POST | /recommendations | Gợi ý đọc sách theo payload |
| POST | /lookup-book-by-isbn | Tra cứu metadata theo ISBN |
| POST | /isbn-intelligence | Tra cứu ISBN có bằng chứng nguồn, confidence theo field và conflict |
| POST | /generate-book-summary | Tạo tóm tắt sách |
| POST | /generate-summary-vi | Tạo tóm tắt tiếng Việt phong cách nhà sách (Fahasa/Tiki style) |
| POST | /chat | Hỏi đáp AI |
| POST | /reading-stats | Tổng hợp thống kê đọc |
| POST | /assistant | Trợ lý hỗ trợ ra quyết định (Ollama tool-calling qua Analytics Service) |

Ghi chú quan trọng:

- Có endpoint alias /api/ai/generate-book-summary để tương thích khi đi qua gateway.
- /generate-summary-vi nhận thêm field `publisher` (optional). Output 180–280 từ, 3–5 đoạn tự nhiên, không ép format 4 section cứng. Cache key tính cả description + categories (sha256) để tránh trả kết quả cũ khi metadata thay đổi.
- /lookup-book-by-isbn hỗ trợ normalize ISBN-10/ISBN-13 và trả payload ổn định cho frontend.
- `/isbn-intelligence` là hợp đồng tra cứu chuẩn; `/lookup-book-by-isbn` và `lookup` của `/enrich-book-after-isbn` được mở rộng tương thích bằng `fieldEvidence`, `fieldConfidence`, `sources`, `conflicts`, `metadataQualityScore`, và `processingTimeMs`. Confidence được tính xác định từ độ tin cậy và đồng thuận dữ liệu nguồn, không dùng điểm do LLM sinh ra. Kết quả chỉ là đề xuất để nhân viên duyệt, không ghi catalog.
- Khi ENABLE_MARKETPLACE_LOOKUP=true, /lookup-book-by-isbn tra cứu thêm Fahasa, Tiki, Vinabook song song với Google Books và Open Library.
- Với mã quét EAN-13 không phải ISBN chuẩn, hệ thống thử marketplace lookup trước thay vì bỏ ngay; response có trường `reason` để frontend phân biệt.
- `/assistant` là chatbot hỗ trợ ra quyết định dành riêng cho ADMIN/WAREHOUSE_MANAGER (hoặc superuser) — role/permission khác (kể cả CUSTOMER) bị chặn 403. Request: `{ "message": "string", "conversation_id": "string (optional)" }`. Model dùng Ollama tool-calling thật (`ASSISTANT_MODEL`) để tự chọn gọi các endpoint `/analytics/*` (định nghĩa trong `assistant_tools.py`) thay vì hard-code theo intent như `/chat`. Response: `{ "answer": "string", "tools_used": [{ "name", "arguments" }], "data": { "<tool_name>": <raw tool result> }, "conversation_id" }`. Endpoint không nhận `conversation_history` — stateless theo từng request, `conversation_id` chỉ được echo lại để client tự quản lý lịch sử hiển thị. Không có fallback Anthropic cho endpoint này.

## Biến môi trường đặc thù

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| OLLAMA_HOST | http://ollama:11434 | Địa chỉ Ollama trong Docker network |
| OLLAMA_MODEL | llava | Model xử lý ảnh (OCR hóa đơn, xác minh ảnh đóng gói) |
| SUMMARY_MODEL | llama3.1:8b-instruct-q4_0 | Model tóm tắt văn bản / `/chat` |
| ASSISTANT_MODEL | llama3.1:8b-instruct-q4_0 | Model dùng cho `/assistant` (cần hỗ trợ Ollama tool-calling) |

> `SUMMARY_MODEL` và `ASSISTANT_MODEL` mặc định trỏ chung 1 model (`llama3.1:8b-instruct-q4_0`) để chỉ cần pull/giữ 1 model text thay vì 2 (`llama3` cũ đã bỏ vì không hỗ trợ tool-calling). Vẫn giữ 2 biến env riêng để có thể tách lại sau này nếu cần.
| GOOGLE_BOOKS_API_BASE_URL | https://www.googleapis.com/books/v1/volumes | Nguồn metadata chính |
| OPEN_LIBRARY_API_BASE_URL | https://openlibrary.org/api/books | Nguồn metadata bổ sung |
| GOOGLE_BOOKS_API_KEY | rỗng | API key tùy chọn |
| ANTHROPIC_API_KEY | rỗng | Cloud LLM key (nếu không set sẽ fallback Ollama) |
| ANTHROPIC_MODEL | claude-sonnet-4-6 | Model Anthropic dùng cho text |
| ENABLE_WORLDCAT_LOOKUP | false | Bật/tắt tra cứu WorldCat |
| ENABLE_MARKETPLACE_LOOKUP | false | Bật tra cứu Fahasa/Tiki/Vinabook |
| BOOK_MARKETPLACE_TIMEOUT_SECONDS | 20 | Timeout (giây) cho từng marketplace lookup |
| BOOK_LOOKUP_TIMEOUT_SECONDS | 15 | Timeout (giây) cho Google Books/Open Library/WorldCat |
| BOOK_LOOKUP_MAX_WEB_RESULTS | 5 | Số kết quả DuckDuckGo tối đa mỗi query |
| BOOK_LOOKUP_USER_AGENT | SmartBookBot/1.0 | User-Agent khi fetch trang nhà sách |

## Chạy nhanh

### Cách 1: Docker Compose

```bash
docker compose up -d --build ai-service ollama
```

### Cách 2: Chạy local

```bash
cd services/ai-service
pip install -r requirements.txt
python main.py
```

## Tích hợp với hệ thống

- Gateway định tuyến vào AI qua /ai và /api/ai.
- Frontend gọi qua VITE_AI_BASE_URL.
- Khi chạy Docker, cần đảm bảo OLLAMA_HOST trỏ tới http://ollama:11434.

## Tài liệu liên quan

- README root: ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../PROJECT_OVERVIEW.md
