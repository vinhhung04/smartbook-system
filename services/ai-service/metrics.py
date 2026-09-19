from prometheus_client import Counter, Histogram

ai_request_duration = Histogram(
    "ai_request_duration_seconds",
    "LLM chat/assistant call duration",
    ["endpoint"],
)
ocr_request_duration = Histogram(
    "ocr_request_duration_seconds",
    "OCR scan-receipt duration",
)

isbn_lookup_duration = Histogram(
    "isbn_lookup_duration_seconds",
    "ISBN metadata lookup duration",
    ["mode"],
)
isbn_provider_calls = Counter(
    "isbn_provider_calls_total",
    "ISBN lookup provider calls by phase and outcome",
    ["provider", "phase", "status"],
)
