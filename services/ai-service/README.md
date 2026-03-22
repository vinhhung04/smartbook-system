# ai-service

Python-based AI helper service (OCR / Ollama integration).

- Language: Python
- Entrypoint: `main.py`
- Dependencies: `requirements.txt`
- Communicates with `ollama` (see root `docker-compose.yml`).

## New endpoint: ISBN-first metadata lookup

`POST /lookup-book-by-isbn`

Purpose:
- Normalize and validate ISBN-10 / ISBN-13 input.
- Lookup metadata from Google Books (primary) and Open Library (secondary).
- Merge provider results into one stable response payload.
- Optionally generate Vietnamese summary + keywords using Ollama (no OCR involved).

Request example:

```json
{
	"isbn": "978-604-123-456-7",
	"generateVietnameseSummary": true
}
```

Response example:

```json
{
	"success": true,
	"found": true,
	"isbn": "9786041234567",
	"isbn13": "9786041234567",
	"isbn10": null,
	"title": "...",
	"subtitle": "...",
	"authors": ["..."],
	"publisher": "...",
	"publishedDate": "...",
	"description": "...",
	"categories": ["..."],
	"language": "...",
	"pageCount": 320,
	"thumbnail": "...",
	"source": {
		"googleBooks": true,
		"openLibrary": false,
		"ollamaSummary": true
	},
	"confidence": {
		"overall": 0.91,
		"googleBooks": 0.91,
		"openLibrary": 0.0
	},
	"summaryVi": "...",
	"keywords": ["...", "..."],
	"manualEntryRequired": false
}
```

Not found or invalid ISBN returns a safe, frontend-friendly response with:
- `found: false`
- `manualEntryRequired: true`
- `reason` describing why manual entry is needed.

How to run locally:

```
cd ai-service
pip install -r requirements.txt
python main.py
```

