from prometheus_client import Counter, Histogram

ai_request_duration = Histogram(
    "ai_request_duration_seconds",
    "LLM chat/assistant call duration",
    ["endpoint"],
)
ai_llm_tokens_total = Counter(
    "ai_llm_tokens_total",
    "OpenRouter prompt/completion tokens by feature and model",
    ["feature", "model", "kind"],
)
ai_llm_cost_usd_total = Counter(
    "ai_llm_cost_usd_total",
    "OpenRouter cost in USD by feature and model, as reported by OpenRouter's usage.cost",
    ["feature", "model"],
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

# retrieval_confidence.py's three-way decision, by corpus - lets a dashboard
# show the no-answer rate (NO_EVIDENCE / total) directly instead of only
# learning about it from an eval report.
ai_retrieval_decisions_total = Counter(
    "ai_retrieval_decisions_total",
    "RAG retrieval_confidence.py decisions by corpus and decision",
    ["corpus", "decision"],
)

# isbn_fusion.py's per-field outcome - lets a dashboard show which fields most
# often end up CONFLICTED/LOW_CONFIDENCE/MISSING across real lookups.
ai_isbn_field_status_total = Counter(
    "ai_isbn_field_status_total",
    "ISBN Intelligence field-level status by field and status",
    ["field", "status"],
)
