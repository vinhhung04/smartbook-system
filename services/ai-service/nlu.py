"""
nlu.py — Hybrid NLU layer for SmartBook AI chatbot.

Stage 1: detect_intent() rule-based (fast, deterministic).
Stage 2: LLM classifier via Groq -> Ollama fallback (natural Vietnamese).

Security: Never sends auth tokens, user profiles, or business data to any LLM.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any

import httpx
import ollama

from cache import SummaryCache
from intent import (
    detect_intent,
    normalize_text,
    DASHBOARD_SUMMARY_QUERY,
    LOW_STOCK_QUERY,
    TOP_BORROWED_BOOKS_QUERY,
    OVERDUE_LOAN_QUERY,
    FINE_SUMMARY_QUERY,
    BORROW_TREND_QUERY,
    RESERVATION_QUERY,
    BOOK_SEARCH_QUERY,
    REORDER_SUGGESTION_QUERY,
    GENERAL_QUERY,
)
from agent_actions import (
    CREATE_REORDER_DRAFT,
    CREATE_REPORT_DRAFT,
    CREATE_RESERVATION_DRAFT,
    CREATE_STOCK_ALERT,
    CREATE_STAFF_TASK_DRAFT,
)

logger = logging.getLogger("uvicorn.error")

_GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
_GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
_GROQ_MODEL = os.getenv("GROQ_SUMMARY_MODEL", "llama-3.3-70b-versatile")
# Ollama model priority for NLU text classification: NLU_MODEL -> SUMMARY_MODEL -> OLLAMA_MODEL -> "llama3"
_NLU_OLLAMA_MODEL = os.getenv(
    "NLU_MODEL",
    os.getenv("SUMMARY_MODEL", os.getenv("OLLAMA_MODEL", "llama3")),
)
_OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
_NLU_TIMEOUT = float(os.getenv("NLU_LLM_TIMEOUT_SECONDS", "5"))

INTENT_ALLOWLIST: frozenset[str] = frozenset([
    DASHBOARD_SUMMARY_QUERY,
    LOW_STOCK_QUERY,
    TOP_BORROWED_BOOKS_QUERY,
    OVERDUE_LOAN_QUERY,
    FINE_SUMMARY_QUERY,
    BORROW_TREND_QUERY,
    RESERVATION_QUERY,
    BOOK_SEARCH_QUERY,
    REORDER_SUGGESTION_QUERY,
    GENERAL_QUERY,
])

ACTION_TYPE_ALLOWLIST: frozenset[str] = frozenset([
    CREATE_REORDER_DRAFT,
    CREATE_REPORT_DRAFT,
    CREATE_RESERVATION_DRAFT,
    CREATE_STOCK_ALERT,
    CREATE_STAFF_TASK_DRAFT,
])

# 5-min NLU cache keyed by (message + role)
_nlu_cache = SummaryCache(max_size=200, ttl_seconds=300)

_COMPLEXITY_CONJUNCTIONS = {
    "va", "hoac", "giup toi", "giup minh", "nhung", "dong thoi", "cung", "vua",
}

# Surface signals that an action is desired — used for fast-path bypass only.
# The LLM decides whether wants_action is truly True and extracts entities.
_ACTION_SURFACE_SIGNALS = {
    "tao", "lap", "lam giup", "dat giup", "xuat", "canh bao", "giao viec",
    "tao task", "tao nhiem vu", "create", "generate", "reserve", "assign",
    "nhap them", "dat sach", "giu sach", "dat cho", "dang ky muon", "nhac",
    "tao phieu", "lap phieu", "lap de xuat", "tao de xuat", "tao giup", "lap giup",
    "phieu nhap", "yeu cau nhap", "don nhap", "don dat hang",
}

# ── Vietnamese system prompt for LLM classifier ───────────────────────────────

_NLU_SYSTEM_PROMPT = """\
Bạn là bộ phân loại ý định (intent classifier) cho hệ thống thư viện SmartBook.
Nhiệm vụ: phân tích câu người dùng và trả về JSON phân loại. Không trả lời câu hỏi. Không tạo dữ liệu nghiệp vụ.

DANH SÁCH INTENT (chọn đúng tên hằng số, không thay đổi):
- DASHBOARD_SUMMARY_QUERY: tổng quan thư viện, tình hình hệ thống, số liệu chung.
- LOW_STOCK_QUERY: tồn kho thấp, sắp hết, hết hàng, kho đang thiếu sách.
- TOP_BORROWED_BOOKS_QUERY: sách hot, được mượn nhiều, phổ biến.
- OVERDUE_LOAN_QUERY: sách quá hạn, chưa trả, trễ hạn.
- FINE_SUMMARY_QUERY: phạt, tiền phạt, còn nợ, khoản phạt chưa thu.
- BORROW_TREND_QUERY: xu hướng mượn/trả theo thời gian, biểu đồ.
- RESERVATION_QUERY: đặt chỗ, giữ sách, đăng ký mượn (kể cả hỏi trạng thái reservation).
- BOOK_SEARCH_QUERY: tìm sách theo tên/tác giả/ISBN.
- REORDER_SUGGESTION_QUERY: nhập thêm, bổ sung, đề xuất nhập (kể cả chỉ hỏi nên nhập gì).
- GENERAL_QUERY: câu hỏi chung không thuộc nhóm trên.

DANH SÁCH ACTION_TYPE — chỉ set khi người dùng có ý định hành động rõ ràng (tạo, lập, đặt, giao, xuất...):
- CREATE_REORDER_DRAFT: "tạo phiếu nhập", "tạo phiếu nhập kho", "lập phiếu nhập", "lập đề xuất nhập", "tạo đề xuất nhập", "yêu cầu nhập", "đặt mua", "tôi muốn nhập", "tạo đơn nhập". KHÔNG dùng nếu chỉ hỏi "Nên nhập sách nào?".
- CREATE_REPORT_DRAFT: "làm báo cáo", "xuất report", "tổng hợp giúp tôi", "lập báo cáo".
- CREATE_RESERVATION_DRAFT: "giữ giúp tôi", "đặt giúp tôi", "đăng ký mượn cuốn [tên]". KHÔNG dùng nếu chỉ hỏi "Tình trạng đặt sách của tôi?".
- CREATE_STOCK_ALERT: "tạo cảnh báo", "nhắc nhở kho", "thông báo tồn kho".
- CREATE_STAFF_TASK_DRAFT: "giao việc", "tạo task", "cho nhân viên kiểm tra".
- null: chỉ hỏi thông tin, xem trạng thái, không tạo hành động.

QUY TẮC PHÂN LOẠI (ưu tiên cao — làm theo đúng các ví dụ):
- "Kho mình đang thiếu đầu sách nào vậy?" → LOW_STOCK_QUERY, wants_action=false, action_type=null.
- "Báo cáo tồn kho tháng này" → LOW_STOCK_QUERY, wants_action=false, action_type=null.
- "Báo cáo sách quá hạn" → OVERDUE_LOAN_QUERY, wants_action=false, action_type=null.
- "Nên nhập thêm sách nào?" → REORDER_SUGGESTION_QUERY, wants_action=false, action_type=null.
- "Tạo phiếu nhập cho sách cần bổ sung" → REORDER_SUGGESTION_QUERY, wants_action=true, action_type=CREATE_REORDER_DRAFT.
- "Đặt mua sách cho kho HCM" → REORDER_SUGGESTION_QUERY, wants_action=true, action_type=CREATE_REORDER_DRAFT, warehouse_hint="HCM".
- "Tình trạng đặt sách của tôi?" → RESERVATION_QUERY, wants_action=false, action_type=null.
- "Giữ giúp tôi cuốn Đắc Nhân Tâm" → RESERVATION_QUERY, wants_action=true, action_type=CREATE_RESERVATION_DRAFT, book_title="Đắc Nhân Tâm".
- "Mấy cuốn gần hết thì tạo nhắc nhở cho kho giúp tôi" → LOW_STOCK_QUERY, wants_action=true, action_type=CREATE_STOCK_ALERT.
- "Làm giúp tôi một bản tổng hợp về tiền phạt" → FINE_SUMMARY_QUERY, wants_action=true, action_type=CREATE_REPORT_DRAFT.
- "Tạo việc cho nhân viên kiểm tra mấy cuốn hết hàng" → LOW_STOCK_QUERY, wants_action=true, action_type=CREATE_STAFF_TASK_DRAFT.
- "Nhập thêm sách ở kho HCM giúp tôi" → REORDER_SUGGESTION_QUERY, wants_action=true, action_type=CREATE_REORDER_DRAFT, warehouse_hint="HCM".
- "Sách hot mà tồn ít?" → intent=LOW_STOCK_QUERY, secondary_intents=[TOP_BORROWED_BOOKS_QUERY].
- Câu có nhiều intent → intent chính vào "intent", phụ vào "secondary_intents".
- "báo cáo X" (không có "tạo", "lập") → dùng intent của X, wants_action=false.

THỰC THỂ (entities) — trích xuất nếu có trong câu, null nếu không:
- book_title: tên sách rõ ràng ("cuốn X", "quyển X", "sách X"). Giữ nguyên dấu tiếng Việt.
- author: tác giả.
- isbn: mã ISBN.
- warehouse_hint: tên hoặc mã kho ("kho HCM", "kho Hà Nội", "kho A", "HN"). Giữ nguyên như trong câu.
- assignee_hint: tên nhân viên được giao việc.
- customer_hint: tên hoặc ID khách hàng.
- quantity: số lượng (số nguyên).
- priority: HIGH/MEDIUM/LOW nếu người dùng nêu rõ độ ưu tiên.
- report_type: loại báo cáo nếu rõ ràng.

Chỉ trả về JSON hợp lệ duy nhất, không có markdown, không giải thích gì thêm:
{
  "intent": "...",
  "confidence": 0.0,
  "query": "...",
  "time_range": null,
  "granularity": "day",
  "wants_action": false,
  "action_type": null,
  "entities": {
    "book_title": null, "author": null, "isbn": null,
    "warehouse_hint": null, "assignee_hint": null, "customer_hint": null,
    "quantity": null, "priority": null, "report_type": null
  },
  "secondary_intents": [],
  "reason": "lý do ngắn tiếng Việt"
}
"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def _empty_entities() -> dict:
    return {
        "book_title": None,
        "author": None,
        "isbn": None,
        "warehouse_hint": None,
        "assignee_hint": None,
        "customer_hint": None,
        "quantity": None,
        "priority": None,
        "report_type": None,
    }


def _is_complex_message(message: str) -> bool:
    if len(message.split()) >= 10:
        return True
    normalized = normalize_text(message)
    return any(c in normalized for c in _COMPLEXITY_CONJUNCTIONS)


def _has_action_surface(normalized: str) -> bool:
    return any(kw in normalized for kw in _ACTION_SURFACE_SIGNALS)


def _validate_time_range(tr: Any) -> dict | None:
    """Accept LLM time_range only if it has non-empty {from, to} strings."""
    if not isinstance(tr, dict):
        return None
    f, t = tr.get("from"), tr.get("to")
    if isinstance(f, str) and isinstance(t, str) and f and t:
        return {"from": f, "to": t}
    return None


def _rule_to_nlu_shape(rule_result: dict, message: str) -> dict:
    """Convert detect_intent() output to stable NLU schema WITHOUT action inference.

    Rule-based path never infers action_type — actions need LLM for entity extraction.
    """
    return {
        "intent": rule_result.get("intent", GENERAL_QUERY),
        "confidence": rule_result.get("confidence", 0.35),
        "query": rule_result.get("query", message.strip()),
        "time_range": rule_result.get("time_range"),
        "granularity": rule_result.get("granularity", "day"),
        "wants_action": False,
        "action_type": None,
        "entities": _empty_entities(),
        "secondary_intents": [],
        "source": "rule_based",
        "reason": "Phan loai bang quy tac keyword, khong co dau hieu hanh dong.",
    }


def _fallback_shape(rule_result: dict, message: str) -> dict:
    shape = _rule_to_nlu_shape(rule_result, message)
    shape["source"] = "fallback"
    shape["reason"] = "LLM khong phan hoi hoac timeout; dung ket qua rule-based."
    return shape


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if block:
        try:
            return json.loads(block.group(1))
        except json.JSONDecodeError:
            pass
    obj = re.search(r"\{.*\}", raw, re.DOTALL)
    if obj:
        try:
            return json.loads(obj.group(0))
        except json.JSONDecodeError:
            pass
    return {}


def _validate(raw: dict, rule_result: dict, message: str) -> dict | None:
    """Validate + normalize LLM output. Returns None if intent is unknown."""
    if not isinstance(raw, dict) or "intent" not in raw:
        return None

    intent = raw.get("intent", "")
    if intent not in INTENT_ALLOWLIST:
        if str(intent).upper() in INTENT_ALLOWLIST:
            intent = str(intent).upper()
        else:
            return None  # Unknown intent — reject whole result

    action_type = raw.get("action_type")
    if action_type and action_type not in ACTION_TYPE_ALLOWLIST:
        action_type = None  # Unknown action_type — nullify, don't reject whole result

    raw_entities = raw.get("entities") or {}
    if not isinstance(raw_entities, dict):
        raw_entities = {}
    entities = _empty_entities()
    for k in entities:
        if raw_entities.get(k) is not None:
            entities[k] = raw_entities[k]

    secondary = [
        s for s in (raw.get("secondary_intents") or [])
        if s in INTENT_ALLOWLIST and s != intent
    ]

    confidence = float(raw.get("confidence") or 0.75)
    confidence = max(0.0, min(1.0, confidence))

    # Validate time_range from LLM; fall back to rule-based if invalid
    llm_tr = _validate_time_range(raw.get("time_range"))
    time_range = llm_tr if llm_tr is not None else rule_result.get("time_range")

    granularity = raw.get("granularity") or rule_result.get("granularity", "day")
    if granularity not in ("day", "month"):
        granularity = "day"

    return {
        "intent": intent,
        "confidence": confidence,
        "query": str(raw.get("query") or rule_result.get("query") or message).strip(),
        "time_range": time_range,
        "granularity": granularity,
        "wants_action": bool(raw.get("wants_action", False)),
        "action_type": action_type,
        "entities": entities,
        "secondary_intents": secondary,
        "source": "llm",
        "reason": str(raw.get("reason") or "Phan loai bang LLM."),
    }


def _history_snippet(conversation_history: list | None) -> str:
    """Last 2 turns truncated. Never includes auth/token/profile data."""
    if not conversation_history:
        return ""
    lines = []
    for m in conversation_history[-4:]:
        role = m.get("role", "user") if isinstance(m, dict) else getattr(m, "role", "user")
        content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
        # Truncate assistant replies — they may contain retrieved business data
        if role == "assistant":
            content = content[:80]
        lines.append(f"{role}: {str(content)[:200]}")
    return "\n".join(lines)


async def _call_groq(message: str, history: str) -> tuple[dict, bool]:
    if not _GROQ_API_KEY:
        return {}, False
    user_content = f"Cau nguoi dung: {message}"
    if history:
        user_content = f"Lich su:\n{history}\n\n{user_content}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(_NLU_TIMEOUT)) as client:
            resp = await client.post(
                f"{_GROQ_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {_GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": _NLU_SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 400,
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            return _parse_json(raw), True
    except Exception as exc:
        logger.warning("Groq NLU failed: %s", exc)
        return {}, False


async def _call_ollama(message: str, history: str) -> tuple[dict, bool]:
    user_content = f"Cau nguoi dung: {message}"
    if history:
        user_content = f"Lich su:\n{history}\n\n{user_content}"
    full_prompt = f"{_NLU_SYSTEM_PROMPT}\n\n{user_content}"
    try:
        client = ollama.Client(host=_OLLAMA_HOST)
        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.generate,
                model=_NLU_OLLAMA_MODEL,
                prompt=full_prompt,
                options={"temperature": 0.1, "num_predict": 400},
            ),
            timeout=_NLU_TIMEOUT,
        )
        raw = response.get("response", "")
        return _parse_json(raw), bool(raw)
    except Exception as exc:
        logger.warning("Ollama NLU failed: %s", exc)
        return {}, False


# ── Public API ────────────────────────────────────────────────────────────────

async def classify_user_message(
    message: str,
    conversation_history: list | None = None,
    user_context=None,
) -> dict:
    """
    Hybrid NLU entry point. Returns stable NLU schema dict.

    Fast path (rule_based): high-confidence + simple + NO action surface signal.
    If action signal detected -> always go to LLM for entity extraction.
    Security: user_context is only used for cache key (role hint), never sent to LLM.
    """
    role_hint = "anon"
    if user_context is not None:
        roles = getattr(user_context, "roles", [])
        if roles:
            role_hint = roles[0]
    cache_key = f"nlu:{role_hint}:{message[:200]}"

    cached = _nlu_cache.get(cache_key)
    if cached:
        return cached

    rule_result = detect_intent(message)
    rule_confidence = rule_result.get("confidence", 0.35)
    normalized = normalize_text(message)

    # Fast path: ONLY when confidence is high, message is simple, AND there is
    # no surface action signal (action messages need LLM for entity extraction).
    if (
        rule_confidence >= 0.85
        and not _is_complex_message(message)
        and not _has_action_surface(normalized)
    ):
        shape = _rule_to_nlu_shape(rule_result, message)
        _nlu_cache.set(cache_key, shape)
        return shape

    # LLM path
    history = _history_snippet(conversation_history)
    llm_raw, ok = await _call_groq(message, history)
    if not ok or not llm_raw:
        llm_raw, ok = await _call_ollama(message, history)

    if ok and llm_raw:
        validated = _validate(llm_raw, rule_result, message)
        if validated is not None:
            _nlu_cache.set(cache_key, validated)
            return validated

    # Fallback to rule-based
    shape = _fallback_shape(rule_result, message)
    _nlu_cache.set(cache_key, shape)
    return shape
