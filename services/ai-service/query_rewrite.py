"""Selective query rewriting for document retrieval (RAG Phase 3).

Only a context-dependent follow-up is rewritten ("Còn hạng Bạc Sĩ thì sao?" after a
question about loan limits), only when there is history, and only on the NLU paths whose
`query` is the raw message (policy fast path, rule-based, LLM-failure fallback) - the LLM
NLU path already writes its own `query` from the history. Retrieval never depends on the
rewrite: a timeout, provider error or a rewrite that drops the user's words or adds a
number falls back to the original message.
"""
from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass

import vector_store
from intent import normalize_text

logger = logging.getLogger("uvicorn.error")

QUERY_REWRITE_ENABLED = os.getenv("RAG_QUERY_REWRITE_ENABLED", "true").lower() != "false"
QUERY_REWRITE_TIMEOUT = float(os.getenv("RAG_QUERY_REWRITE_TIMEOUT_SECONDS", "3"))
MAX_REWRITE_CHARS = 300

# Normalized text has no accents: "thế"/"thẻ" and "vậy"/"vay" collide, so bare "the"/"vay" are not cues.
_CONTINUATION_PREFIX = re.compile(r"^(?:the con|vay con|con neu|neu vay|vay thi|the thi)\b")
_CONTINUATION_SUFFIX = re.compile(r"\b(?:thi sao|thi the nao|thi sao a|thi sao nhi)$")
_ANAPHORA = re.compile(r"\b(?:cuon|quyen|sach|hang|goi|the|muc|truong hop|cai|viec|dieu) (?:do|kia)\b"
                       r"|\b(?:nhu vay|khi do|luc do)\b")
_ISBN_LIKE = re.compile(r"\d{10,13}")
# words that only carry the "continuing" role and may disappear in a standalone question
_CUE_TERMS = frozenset("con vay the neu thi sao nao do nay kia cai viec dieu".split())

_SYSTEM_PROMPT = (
    "Bạn viết lại câu hỏi tiếp nối thành MỘT câu hỏi độc lập bằng tiếng Việt để tra cứu tài liệu "
    "của thư viện SmartBook. Chỉ dùng thông tin có trong lịch sử và câu hiện tại; không thêm tên, "
    "con số hay điều kiện mới; giữ nguyên mọi từ quan trọng của câu hiện tại. "
    "Nếu câu hiện tại hỏi cùng chủ đề với câu trước nhưng thiếu đối tượng, chỉ bổ sung đúng phần "
    "còn thiếu từ câu trước (ví dụ sau câu về giữ chỗ đặt trước: 'Còn hạng nào giữ lâu nhất?' -> "
    "'Hạng thành viên nào được giữ chỗ sách đặt trước lâu nhất?'). "
    "Nếu câu hiện tại chuyển sang chủ đề khác, KHÔNG ghép chủ đề cũ vào; chỉ bỏ các từ nối như "
    "'còn', 'thì sao' và viết thành câu hỏi về chủ đề mới. Nếu câu hiện tại đã đủ nghĩa, trả lại "
    "nguyên văn. Chỉ trả về câu hỏi, không giải thích."
)


@dataclass(frozen=True)
class RewriteResult:
    query: str
    original: str
    status: str  # not_eligible | disabled | rewritten | unchanged | invalid | failed
    latency_ms: int = 0


def is_eligible(message: str, history: str) -> bool:
    """Deterministic: a follow-up that cannot be searched on its own. Identifiers (ISBN,
    quoted titles) and complete questions are never eligible."""
    if not history.strip() or not message.strip():
        return False
    if any(q in message for q in ("'", '"', "“", "”", "‘", "’")):
        return False
    text = " ".join(re.findall(r"[a-z0-9]+", normalize_text(message)))
    if not text or _ISBN_LIKE.search(text.replace(" ", "")):
        return False
    words = text.split()
    return bool(_CONTINUATION_PREFIX.search(text) or _CONTINUATION_SUFFIX.search(text)
                or _ANAPHORA.search(text) or len(words) <= 3 or (words[0] == "con" and len(words) <= 7))


def validate(rewritten: str, message: str, history: str) -> str | None:
    """The cleaned rewrite, or None when it cannot be trusted."""
    line = (rewritten or "").strip().splitlines()[0].strip().strip('"“”\'') if (rewritten or "").strip() else ""
    if not (5 <= len(line) <= MAX_REWRITE_CHARS):
        return None
    new_numbers = set(re.findall(r"\d+", line)) - set(re.findall(r"\d+", f"{message} {history}"))
    if new_numbers:
        return None
    kept = set(re.findall(r"[a-z0-9]+", normalize_text(line)))
    if any(term not in kept for term in vector_store.keyword_terms(message) if term not in _CUE_TERMS):
        return None
    return line


def _provider():
    from llm_provider import TEXT_MODEL, get_openrouter_provider
    return get_openrouter_provider(TEXT_MODEL)


async def rewrite(message: str, history: str) -> RewriteResult:
    original = (message or "").strip()
    if not is_eligible(original, history or ""):
        return RewriteResult(original, original, "not_eligible")
    if not QUERY_REWRITE_ENABLED:
        return RewriteResult(original, original, "disabled")
    started = time.monotonic()
    try:
        result = await _provider().chat(
            messages=[{"role": "system", "content": _SYSTEM_PROMPT},
                      {"role": "user", "content": f"Lịch sử:\n{history}\n\nCâu hiện tại: {original}"}],
            tools=[], num_predict=120, timeout=QUERY_REWRITE_TIMEOUT, temperature=0.0, feature="query_rewrite",
        )
        text = result.text
    except Exception as exc:  # retrieval must never depend on the rewrite
        logger.warning("query_rewrite failed: %s", type(exc).__name__)
        return RewriteResult(original, original, "failed", int((time.monotonic() - started) * 1000))
    latency = int((time.monotonic() - started) * 1000)
    cleaned = validate(text, original, history)
    if cleaned is None:
        return RewriteResult(original, original, "invalid", latency)
    if normalize_text(cleaned) == normalize_text(original):
        return RewriteResult(original, original, "unchanged", latency)
    return RewriteResult(cleaned, original, "rewritten", latency)
