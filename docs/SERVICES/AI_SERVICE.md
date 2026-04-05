# AI Service

## Muc tieu

AI Service cung cap cac tinh nang nhan dien sach va tao metadata cho SmartBook, su dung FastAPI + Ollama.

- Runtime: Python + FastAPI
- Entrypoint: services/ai-service/main.py
- Model runtime: Ollama (mac dinh host http://ollama:11434)
- Vai tro: OCR/nhan dien thong tin sach, lookup metadata tu ISBN, sinh tom tat tieng Viet

## Endpoint chinh

| Method | Endpoint | Mo ta |
|---|---|---|
| GET | /health | Kiem tra tinh trang service |
| POST | /scan-back-cover | OCR thong tin tu anh bia sau |
| POST | /recognize-book | Nhan dien thong tin sach tu anh |
| POST | /analyze | Phan tich noi dung anh sach |
| POST | /extract-metadata | Trich xuat metadata tu input |
| GET | /recommendations | Lay goi y doc sach |
| POST | /recommendations | Tao goi y doc sach theo payload |
| POST | /lookup-book-by-isbn | Tra cuu metadata theo ISBN (Google Books/Open Library) |
| POST | /generate-book-summary | Sinh tom tat sach |
| POST | /generate-summary-vi | Sinh tom tat tieng Viet |
| POST | /chat | Tro ly hoi dap AI |
| POST | /reading-stats | Tong hop thong ke doc |

Ghi chu:
- Co endpoint alias /api/ai/generate-book-summary de tuong thich khi di qua gateway.
- /lookup-book-by-isbn ho tro normalize ISBN-10/13, tra ve payload on dinh cho frontend.

## Bien moi truong quan trong

| Bien | Mac dinh | Muc dich |
|---|---|---|
| OLLAMA_HOST | http://ollama:11434 | Dia chi model runtime |
| OLLAMA_MODEL | llava | Model xu ly anh |
| SUMMARY_MODEL | llava | Model tom tat |
| GOOGLE_BOOKS_API_BASE_URL | https://www.googleapis.com/books/v1/volumes | Nguon metadata chinh |
| OPEN_LIBRARY_API_BASE_URL | https://openlibrary.org/api/books | Nguon metadata bo sung |
| GOOGLE_BOOKS_API_KEY | (rong) | API key tuy chon |
| GROQ_API_KEY | (rong) | Fallback cloud LLM tuy chon |
| ENABLE_WORLDCAT_LOOKUP | false | Bat/tat tra cuu WorldCat |

## Chay nhanh

### Cach 1: Docker Compose (khuyen nghi)

Tu root repo:

```bash
docker compose up -d --build ai-service ollama
```

### Cach 2: Chay local service

Trong services/ai-service:

```bash
pip install -r requirements.txt
python main.py
```

## Tich hop voi he thong

- Gateway route den AI qua /ai va /api/ai.
- Frontend su dung VITE_AI_BASE_URL de goi service.
- Khi chay bang Docker, nen dung OLLAMA_HOST=http://ollama:11434.

## Tai lieu lien quan

- Root overview: README.md
- Docker runbook: docs/RUN_WITH_DOCKER.md
- Architecture: docs/PROJECT_OVERVIEW.md
