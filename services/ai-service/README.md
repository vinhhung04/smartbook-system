# AI Service

README này được tối giản để tránh trùng lặp tài liệu.

## Tài liệu chính

- Chi tiết service-level: ../../docs/SERVICES/AI_SERVICE.md
- Tổng quan hệ thống: ../../README.md
- Docker runbook: ../../docs/RUN_WITH_DOCKER.md

## Chạy nhanh local

```bash
cd services/ai-service
pip install -r requirements.txt
python main.py
```

## Endpoint cần nhớ

- Health check: GET /health
- ISBN metadata lookup: POST /lookup-book-by-isbn

