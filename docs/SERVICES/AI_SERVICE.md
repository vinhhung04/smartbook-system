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
| POST | /assistant/stream | Bản streaming (SSE) của /assistant |
| POST | /actions/confirm | Xác nhận (hoặc hủy, nếu `confirm: false`) một pending action |
| POST | /actions/cancel | Hủy một pending action |
| GET | /actions/pending/{action_id} | Xem chi tiết một pending action (chủ sở hữu hoặc superuser) |
| GET | /actions/stats | Thống kê tổng số action pending/executed/total (admin) |
| GET | /assistant/actions | Action Center — danh sách action, filter theo `status`/`conversation_id`/`mine` |
| GET | /assistant/actions/{action_id} | Chi tiết action + audit log đầy đủ (CREATED→CONFIRMED→EXECUTED/...) |
| GET | /assistant/conversations | Danh sách hội thoại của user hiện tại |
| GET | /assistant/conversations/{conversation_id} | Chi tiết hội thoại + toàn bộ message |
| PATCH | /assistant/conversations/{conversation_id} | Đổi tên hội thoại (`{ "title": "..." }`) |
| DELETE | /assistant/conversations/{conversation_id} | Archive hội thoại (soft delete) |

Ghi chú quan trọng:

- Có endpoint alias /api/ai/generate-book-summary để tương thích khi đi qua gateway.
- /generate-summary-vi nhận thêm field `publisher` (optional). Output 180–280 từ, 3–5 đoạn tự nhiên, không ép format 4 section cứng. Cache key tính cả description + categories (sha256) để tránh trả kết quả cũ khi metadata thay đổi.
- /lookup-book-by-isbn hỗ trợ normalize ISBN-10/ISBN-13 và trả payload ổn định cho frontend.
- `/isbn-intelligence` là hợp đồng tra cứu chuẩn; `/lookup-book-by-isbn` và `lookup` của `/enrich-book-after-isbn` được mở rộng tương thích bằng `fieldEvidence`, `fieldConfidence`, `sources`, `conflicts`, `metadataQualityScore`, và `processingTimeMs`. Confidence được tính xác định từ độ tin cậy và đồng thuận dữ liệu nguồn, không dùng điểm do LLM sinh ra. Kết quả chỉ là đề xuất để nhân viên duyệt, không ghi catalog.
- Khi ENABLE_MARKETPLACE_LOOKUP=true, /lookup-book-by-isbn tra cứu thêm Fahasa, Tiki, Vinabook song song với Google Books và Open Library.
- Với mã quét EAN-13 không phải ISBN chuẩn, hệ thống thử marketplace lookup trước thay vì bỏ ngay; response có trường `reason` để frontend phân biệt.
- `/assistant` là chatbot hỗ trợ ra quyết định dành riêng cho ADMIN/WAREHOUSE_MANAGER (hoặc superuser) — role/permission khác (kể cả CUSTOMER) bị chặn 403. Request: `{ "message": "string", "conversation_id": "string (optional)" }`. Model dùng Ollama tool-calling thật (`ASSISTANT_MODEL`) để tự chọn gọi các endpoint `/analytics/*` (định nghĩa trong `assistant_tools.py`) thay vì hard-code theo intent như `/chat`. Response: `{ "answer", "tools_used": [{ "name", "arguments" }], "data": { "<tool_name>": <raw tool result> }, "conversation_id", "grounding_warning", "pending_action", "evidence": [{ "label", "tool_name", "metric", "value", "unit", "description" }], "retrieval_warnings": [] }`. Không có fallback Anthropic cho endpoint này.
- **Trí nhớ hội thoại**: `conversation_id` không còn chỉ được echo lại — nếu thiếu hoặc không tồn tại, service tạo một hội thoại mới (bảng `ai_conversations`) và trả về `conversation_id` thật; nếu đã tồn tại, service nạp tối đa 10 message gần nhất (bảng `ai_messages`) làm ngữ cảnh cho lượt hỏi tiếp theo. Mỗi lượt hỏi/trả lời được lưu lại (kèm tool_calls, tool_results, pending_action_id, grounding_warning) để có thể tải lại toàn bộ hội thoại sau khi refresh trang qua `GET /assistant/conversations/{id}`.
- **Semantic FAQ retrieval cho `/chat`**: khi câu hỏi không khớp intent nào trong 11 intent cố định (`intent.py`), nó rơi vào `GENERAL_QUERY`. Trước đây nhánh này không truy xuất gì cả; nay `retrieval.py` gọi `faq_retrieval.find_relevant()` để tìm các mục FAQ tĩnh (`faq_data.FAQ_ENTRIES`) gần nghĩa nhất bằng cosine similarity trên embedding Ollama, rồi trả về đúng envelope `{summary, raw, sources, warnings, retrieved_at}` như mọi intent khác — nên `verify_numeric_grounding()` và `ensure_source_line()` hoạt động không đổi. Vector được cache ra `.faq_embeddings_cache.json` (khóa theo hash nội dung FAQ, tự dựng lại khi FAQ đổi). Ollama lỗi hoặc không match nào vượt ngưỡng → giữ nguyên hành vi fallback cũ, không bao giờ trả 500. `GENERAL_QUERY` nằm trong `intent.ANALYTICS_BLOCK_EXEMPT_INTENTS` nên CUSTOMER/SUPPLIER cũng dùng được — đây chính là nhóm hay hỏi về chính sách mượn/trả và phí phạt nhất.
- **Hybrid book search**: tool `search_books` của `/assistant` chấm điểm mỗi cuốn sách theo hai tín hiệu rồi lấy trung bình — trùng từ khóa (đảm bảo ISBN/tên sách khớp chính xác vẫn thắng) và cosine similarity trên embedding của `title + author + category + description + summary_vi` (`book_index.py`). Nhờ vậy câu hỏi theo chủ đề tìm được sách dù diễn đạt khác từ ngữ trong mô tả. Index được cache ra `.book_index_cache.json`, khóa theo hash gồm cả nội dung catalog lẫn tên model embedding — catalog đổi hoặc đổi model thì index tự dựng lại. Ollama lỗi → chỉ còn phần từ khóa, đúng bằng hành vi trước đây.
- **Evidence-first**: `evidence` được sinh best-effort từ kết quả tool (xem `evidence.py`) — nếu tool trả `{"error": ...}` hoặc hình dạng dữ liệu không khớp, extractor tương ứng chỉ trả `[]`, không lỗi.
- **AI Action Center + audit log**: `agent_store.py` không còn lưu action trong RAM — mỗi pending action được lưu trong bảng `ai_pending_actions` (Postgres, DB `ai_db`), và mọi bước trong vòng đời (CREATED/CONFIRMED/EXECUTED/CANCELLED/FAILED/EXPIRED) được ghi vào `ai_action_audit_logs`. Danh sách/chi tiết xem qua `GET /assistant/actions` và `GET /assistant/actions/{id}`. Denylist hành động nguy hiểm (`agent_actions.DANGEROUS_ACTION_DENYLIST`) không đổi.

## Database

Từ bản nâng cấp Action Center + trí nhớ hội thoại, `ai-service` có DB Postgres riêng (`ai_db`, tách biệt với `auth_db`/`inventory_db`/`borrow_db`, theo đúng quy ước mỗi service một DB của repo):

- **Truy cập DB**: SQLAlchemy (async, driver `asyncpg`) — xem `db.py`/`db_models.py`. Không dùng Prisma (đó là quy ước riêng của các service Node).
- **Migration**: không dùng Alembic — `schema.sql` chứa các câu lệnh `CREATE TABLE IF NOT EXISTS` idempotent, được áp dụng tự động lúc service khởi động (`@app.on_event("startup")` trong `main.py` gọi `db.init_db()`). An toàn khi chạy lại nhiều lần.
- **Bảng**: `ai_pending_actions`, `ai_action_audit_logs`, `ai_conversations`, `ai_messages` — chi tiết cột xem `schema.sql`/`db_models.py`.
- **Biến môi trường**: `DATABASE_URL=postgresql+asyncpg://<user>:<pass>@db:5432/ai_db` (xem `docker-compose.yml`), `AI_DB_NAME` (mặc định `ai_db`, khai báo trong `.env`).
- **Test**: `test_agent_store.py`/`test_conversation_store.py` chạy trên SQLite in-memory (`aiosqlite`), không cần Postgres thật để test đơn vị.

## Biến môi trường đặc thù

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| OLLAMA_HOST | http://ollama:11434 | Địa chỉ Ollama trong Docker network |
| OLLAMA_MODEL | llava | Model xử lý ảnh (OCR hóa đơn, xác minh ảnh đóng gói) |
| SUMMARY_MODEL | llama3.1:8b-instruct-q4_0 | Model tóm tắt văn bản / `/chat` |
| ASSISTANT_MODEL | llama3.1:8b-instruct-q4_0 | Model dùng cho `/assistant` (cần hỗ trợ Ollama tool-calling) |
| FAQ_EMBED_MODEL | nomic-embed-text | Model embedding cho semantic FAQ search của `/chat` (cần `ollama pull nomic-embed-text`) |
| FAQ_MATCH_THRESHOLD | 0.75 | Ngưỡng cosine similarity tối thiểu để coi một mục FAQ là khớp |
| FAQ_TOP_K | 3 | Số mục FAQ tối đa đưa vào context mỗi lượt hỏi |
| BOOK_SEMANTIC_THRESHOLD | 0.6 | Ngưỡng cosine tối thiểu để một cuốn sách được coi là khớp ngữ nghĩa trong `search_books` |
| EMBED_TIMEOUT_SECONDS | 30 | Timeout tối đa cho một lần gọi embedding; quá hạn thì coi như không có tín hiệu ngữ nghĩa |

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

## Demo: Action Center + trí nhớ hội thoại + Evidence-first

1. Chạy Docker Compose đầy đủ (xem `RUN_WITH_DOCKER.md`), đăng nhập với tài khoản ADMIN hoặc WAREHOUSE_MANAGER, mở trang **Trợ lý AI**.
2. Tab "Hội thoại": hỏi "Sách nào cần nhập thêm gấp trong 30 ngày tới?" — câu trả lời hiển thị kèm 3 khối có thể mở/đóng: "Bằng chứng AI đã dùng", "Công cụ đã gọi", "Dữ liệu gốc"; nếu có `grounding_warning`/`retrieval_warnings` sẽ thấy banner cảnh báo màu vàng.
3. Hỏi tiếp "Tạo đề xuất nhập hàng cho các sách đó" — action card xuất hiện với trạng thái "Chờ xác nhận". Bấm **Xác nhận**.
4. Chuyển sang tab "Trung tâm hành động AI" — action vừa xác nhận xuất hiện với badge trạng thái/risk; bấm vào dòng để xem payload, kết quả, và lịch sử audit log (CREATED → CONFIRMED → EXECUTED).
5. Refresh trang — hội thoại vẫn còn (danh sách hội thoại nạp lại từ `GET /assistant/conversations`, tự động mở lại hội thoại đang hoạt động).
6. Mở lại hội thoại cũ trong sidebar, hỏi câu tiếp theo tham chiếu ngữ cảnh trước ("So với kết quả trên thì ưu tiên kho nào?") — trợ lý dùng 10 message gần nhất của hội thoại đó làm ngữ cảnh.

## Tích hợp với hệ thống

- Gateway định tuyến vào AI qua /ai và /api/ai.
- Frontend gọi qua VITE_AI_BASE_URL.
- Khi chạy Docker, cần đảm bảo OLLAMA_HOST trỏ tới http://ollama:11434.

## Tài liệu liên quan

- README root: ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../PROJECT_OVERVIEW.md
