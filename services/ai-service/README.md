# AI Service

README nay duoc toi gian de tranh trung lap tai lieu.

## Tai lieu chinh

- Chi tiet service-level: ../../docs/SERVICES/AI_SERVICE.md
- Tong quan he thong: ../../README.md
- Docker runbook: ../../docs/RUN_WITH_DOCKER.md

## Chay nhanh local

```bash
cd services/ai-service
pip install -r requirements.txt
python main.py
```

## Endpoint can nho

- Health check: GET /health
- ISBN metadata lookup: POST /lookup-book-by-isbn

