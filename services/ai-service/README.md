# AI Service

README này được tối giản để tránh trùng lặp tài liệu.

## Tài liệu chính

- Chi tiết service-level: ../../docs/SERVICES/AI_SERVICE.md
- Tổng quan hệ thống: ../../README.md
- Docker runbook: ../../docs/RUN_WITH_DOCKER.md
- AI Copilot hiểu câu hỏi (Phase 1, cờ `COPILOT_SEMANTIC_PLANNER`): ../../docs/ANALYSIS/AI_COPILOT_SEMANTIC_UNDERSTANDING.md

## Chạy nhanh local

```bash
cd services/ai-service
pip install -r requirements.txt
python main.py
```

## Endpoint cần nhớ

- Health check: GET /health
- ISBN metadata lookup: POST /lookup-book-by-isbn
- Nhập sách bằng 1–3 ảnh (OCR): POST /book-metadata/scan-images — xem ../../docs/ANALYSIS/BOOK_OCR_IMPORT.md
  (đánh giá: ../../docs/ANALYSIS/BOOK_OCR_EVALUATION.md)

