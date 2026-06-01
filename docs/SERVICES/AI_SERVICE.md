# AI Service

## Mục tiêu

AI Service cung cấp năng lực tự động hóa nhập liệu sách bằng AI, tập trung vào OCR và chuẩn hóa metadata.

- Runtime: Python + FastAPI
- Entrypoint: services/ai-service/main.py
- Model runtime: Ollama local
- Vai trò: nhận diện sách, tra cứu ISBN, tạo tóm tắt tiếng Việt

## Endpoint chính

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | /health | Kiểm tra trạng thái service |
| POST | /scan-back-cover | OCR thông tin từ ảnh bìa sau |
| POST | /recognize-book | Nhận diện thông tin sách từ ảnh |
| POST | /analyze | Phân tích nội dung ảnh |
| POST | /extract-metadata | Trích xuất metadata từ input |
| GET | /recommendations | Gợi ý đọc sách |
| POST | /recommendations | Gợi ý đọc sách theo payload |
| POST | /lookup-book-by-isbn | Tra cứu metadata theo ISBN |
| POST | /generate-book-summary | Tạo tóm tắt sách |
| POST | /generate-summary-vi | Tạo tóm tắt tiếng Việt phong cách nhà sách (Fahasa/Tiki style) |
| POST | /chat | Hỏi đáp AI |
| POST | /reading-stats | Tổng hợp thống kê đọc |

Ghi chú quan trọng:

- Có endpoint alias /api/ai/generate-book-summary để tương thích khi đi qua gateway.
- /generate-summary-vi nhận thêm field `publisher` (optional). Output 180–280 từ, 3–5 đoạn tự nhiên, không ép format 4 section cứng. Cache key tính cả description + categories (sha256) để tránh trả kết quả cũ khi metadata thay đổi.
- /lookup-book-by-isbn hỗ trợ normalize ISBN-10/ISBN-13 và trả payload ổn định cho frontend.
- Khi ENABLE_MARKETPLACE_LOOKUP=true, /lookup-book-by-isbn tra cứu thêm Fahasa, Tiki, Vinabook song song với Google Books và Open Library.
- Với mã quét EAN-13 không phải ISBN chuẩn, hệ thống thử marketplace lookup trước thay vì bỏ ngay; response có trường `reason` để frontend phân biệt.

## Biến môi trường đặc thù

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| OLLAMA_HOST | http://ollama:11434 | Địa chỉ Ollama trong Docker network |
| OLLAMA_MODEL | llava | Model xử lý ảnh |
| SUMMARY_MODEL | llama3 | Model tóm tắt văn bản |
| GOOGLE_BOOKS_API_BASE_URL | https://www.googleapis.com/books/v1/volumes | Nguồn metadata chính |
| OPEN_LIBRARY_API_BASE_URL | https://openlibrary.org/api/books | Nguồn metadata bổ sung |
| GOOGLE_BOOKS_API_KEY | rỗng | API key tùy chọn |
| ANTHROPIC_API_KEY | rỗng | Cloud LLM key (nếu không set sẽ fallback Ollama) |
| ANTHROPIC_MODEL | claude-sonnet-4-6 | Model Anthropic dùng cho text |
| ENABLE_WORLDCAT_LOOKUP | false | Bật/tắt tra cứu WorldCat |
| ENABLE_MARKETPLACE_LOOKUP | false | Bật tra cứu Fahasa/Tiki/Vinabook |
| BOOK_MARKETPLACE_TIMEOUT_SECONDS | 6 | Timeout (giây) cho marketplace lookup |
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
