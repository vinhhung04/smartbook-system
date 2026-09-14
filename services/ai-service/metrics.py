from prometheus_client import Histogram

ai_request_duration = Histogram(
    "ai_request_duration_seconds",
    "LLM chat/assistant call duration",
    ["endpoint"],
)
ocr_request_duration = Histogram(
    "ocr_request_duration_seconds",
    "OCR scan-receipt duration",
)
