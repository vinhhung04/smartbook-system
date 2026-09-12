"""Autonomous nightly agent: reviews the system while nobody's asking and leaves a
morning briefing behind. It only ever creates a CREATE_REPORT_DRAFT pending action
(agent_actions.py) — the exact same human-confirm-before-anything-happens state
machine the reactive chat assistant already uses (agent_store.create_pending_action).
No new action type, no new DB table: this module is purely an unattended caller of
that existing machinery.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx

from agent_actions import CREATE_REPORT_DRAFT, RISK_LOW
from agent_store import create_pending_action
from assistant_tools import _truncate
from socket_emitter import push_ai_action_event

logger = logging.getLogger("uvicorn.error")

GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY", "smartbook_internal_key").strip()
NIGHTLY_BRIEFING_TIMEOUT_SECONDS = float(os.getenv("NIGHTLY_BRIEFING_TIMEOUT_SECONDS", "15"))
# Deliberately NOT reusing _chat_with_ollama/_chat_with_anthropic's own timeout
# (CHAT_LLM_TIMEOUT_SECONDS, 12s default) — that's tuned for a live chat UI where a
# person is waiting. Nobody is waiting on this background job, and its prompt (6
# analytics sections of JSON, up to 800 output tokens) is larger than a normal chat
# turn — verified live: even Anthropic (normally fast) exceeded 12s on this prompt
# and silently fell through to Ollama every time until this was split out.
NIGHTLY_BRIEFING_ANTHROPIC_TIMEOUT_SECONDS = float(os.getenv("NIGHTLY_BRIEFING_ANTHROPIC_TIMEOUT_SECONDS", "60"))
NIGHTLY_BRIEFING_OLLAMA_TIMEOUT_SECONDS = float(os.getenv("NIGHTLY_BRIEFING_OLLAMA_TIMEOUT_SECONDS", "180"))
# A staff member reads this "this morning", not within minutes like a chat action —
# the store's DEFAULT_TTL_SECONDS (600s) would expire it long before anyone looks.
NIGHTLY_BRIEFING_TTL_SECONDS = int(os.getenv("NIGHTLY_BRIEFING_TTL_SECONDS", str(24 * 3600)))
VN_TZ = timezone(timedelta(hours=7))

_ANALYTICS_SECTIONS: dict[str, str] = {
    "overdue_summary": "/analytics/overdue-summary",
    "fine_summary": "/analytics/fine-summary",
    "warehouse_stock_risk": "/analytics/warehouse-stock-risk",
    "reorder_suggestions": "/analytics/reorder-suggestions",
    "reservation_funnel": "/analytics/reservation-funnel",
    "weeding_suggestions": "/analytics/weeding-suggestions",
}


async def _get_internal(endpoint: str) -> dict:
    """Same read-only analytics endpoints assistant_tools.py's tools call, but
    authenticated via the internal service key instead of a forwarded user JWT —
    there is no logged-in user behind a nightly cron. Mirrors
    analytics.routes.js's authenticateInternalOrUser convention."""
    headers = {"X-Internal-Service-Key": INTERNAL_SERVICE_KEY}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(NIGHTLY_BRIEFING_TIMEOUT_SECONDS)) as client:
            response = await client.get(f"{GATEWAY_URL}{endpoint}", headers=headers)
        if response.status_code >= 400:
            return {"error": f"{endpoint} tra ve HTTP {response.status_code}"}
        payload = response.json()
        data = payload.get("data", payload) if isinstance(payload, dict) else payload
        return _truncate(data)
    except Exception as exc:
        return {"error": f"{endpoint} that bai: {type(exc).__name__}"}


def _build_prompt(today: str, sections: dict) -> str:
    return (
        "Bạn là trợ lý AI của thư viện SmartBook. Dữ liệu JSON dưới đây được thu thập "
        f"tự động lúc nửa đêm, phản ánh tình trạng hệ thống cho sáng {today}.\n\n"
        "Hãy viết một \"Báo cáo thủ thư AI\" BẰNG TIẾNG VIỆT (bắt buộc, không dùng "
        "tiếng Anh), định dạng markdown, không quá 300 từ. Chỉ nêu số liệu và kết "
        "luận cụ thể rút ra từ dữ liệu thật bên dưới (ví dụ: số phiếu quá hạn, tên "
        "sách/đầu sách cần nhập gấp, mức tồn kho rủi ro) — TUYỆT ĐỐI KHÔNG mô tả cấu "
        "trúc JSON hay giải thích ý nghĩa các trường dữ liệu, không liệt kê tên "
        "trường. Bỏ qua hoàn toàn mục nào không có gì bất thường thay vì nhắc tới nó. "
        "Nếu toàn bộ dữ liệu đều bình thường, chỉ cần viết 1-2 câu xác nhận điều đó.\n\n"
        f"Dữ liệu:\n{json.dumps(sections, ensure_ascii=False, indent=2)}"
    )


async def _generate_with_anthropic(prompt: str) -> str | None:
    """Same Anthropic call _chat_with_anthropic makes, but with
    NIGHTLY_BRIEFING_ANTHROPIC_TIMEOUT_SECONDS instead of that function's own
    chat-tuned timeout — see the constant's comment."""
    try:
        # Lazy import: main.py imports this module to schedule the startup task, so a
        # top-of-file import here would be circular (main -> nightly_briefing -> main).
        from main import ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL, _anthropic_extract_text

        if not ANTHROPIC_API_KEY:
            return None
        async with httpx.AsyncClient(timeout=httpx.Timeout(NIGHTLY_BRIEFING_ANTHROPIC_TIMEOUT_SECONDS)) as client:
            response = await client.post(
                f"{ANTHROPIC_BASE_URL}/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": ANTHROPIC_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.4,
                    "max_tokens": 800,
                },
            )
            response.raise_for_status()
            reply = _anthropic_extract_text(response.json())
            return reply or None
    except Exception as exc:
        logger.warning("[nightly-briefing] Anthropic generate failed: %s", exc)
        return None


async def _generate_with_ollama(prompt: str) -> str | None:
    """Calls the same Ollama generation path _chat_with_ollama uses (SUMMARY_MODEL,
    with its OLLAMA_MODEL fallback), but with NIGHTLY_BRIEFING_OLLAMA_TIMEOUT_SECONDS
    instead of that function's own chat-tuned timeout — see the constant's comment."""
    try:
        import ollama as ollama_lib
        from main import OLLAMA_HOST, _ollama_generate_with_summary_fallback

        client = ollama_lib.Client(host=OLLAMA_HOST)
        # _chat_with_ollama wraps every prompt as "User: ...\nAssistant:" before
        # calling this same generate helper — matching that framing here too, since
        # the raw generate() API (no chat template) otherwise tends to answer by
        # describing the input's structure instead of following the instruction.
        response = await asyncio.wait_for(
            asyncio.to_thread(
                _ollama_generate_with_summary_fallback,
                client,
                f"User: {prompt}\nAssistant:",
                {"temperature": 0.4, "num_predict": 800},
            ),
            timeout=NIGHTLY_BRIEFING_OLLAMA_TIMEOUT_SECONDS,
        )
        reply = (response.get("response") or "").strip()
        return reply or None
    except Exception as exc:
        logger.warning("[nightly-briefing] Ollama generate failed: %s", exc)
        return None


async def run_nightly_briefing() -> None:
    sections = {key: await _get_internal(endpoint) for key, endpoint in _ANALYTICS_SECTIONS.items()}

    today = datetime.now(VN_TZ).strftime("%d/%m/%Y")
    prompt = _build_prompt(today, sections)

    reply = await _generate_with_anthropic(prompt)
    if not reply:
        reply = await _generate_with_ollama(prompt)
    if not reply:
        reply = (
            "Khong the tao bao cao tu dong dem nay (AI khong phan hoi tu Anthropic "
            "lan Ollama). Vui long xem truc tiep cac trang phan tich."
        )

    report_title = f"Bao cao thu thu AI - {today}"
    action = await create_pending_action(
        action_type=CREATE_REPORT_DRAFT,
        summary=report_title,
        payload={"report_markdown": reply, "report_title": report_title, "sections": sections},
        risk=RISK_LOW,
        sources=[{"name": key, "endpoint": endpoint} for key, endpoint in _ANALYTICS_SECTIONS.items()],
        intent="nightly_briefing",
        created_from_message="",
        requires_review=False,
        user_context=None,
        conversation_id=None,
        ttl_seconds=NIGHTLY_BRIEFING_TTL_SECONDS,
    )
    await push_ai_action_event(
        "ai_action:created",
        action.id,
        action.type,
        None,
        {"summary": action.summary, "risk": action.risk},
    )
    logger.info("[nightly-briefing] created %s (%s)", action.id, report_title)


def _next_run_at(now_vn: datetime, hour: int) -> datetime:
    """Pure scheduling math, split out from the loop below so it's unit-testable
    without waiting on real time. `now_vn` must already be in Vietnam time."""
    next_run = now_vn.replace(hour=hour, minute=0, second=0, microsecond=0)
    if next_run <= now_vn:
        next_run += timedelta(days=1)
    return next_run


async def nightly_briefing_loop() -> None:
    """Sleeps until the next configured Vietnam-time hour, runs the briefing, repeats.
    Vietnam time is computed via an explicit UTC+7 offset rather than the server's own
    clock — containers default to UTC, and using local time directly would run this
    7 hours off from what NIGHTLY_BRIEFING_HOUR_VN actually means (same lesson learned
    building VNPay's formatVnpDate in services/borrow-service)."""
    hour = int(os.getenv("NIGHTLY_BRIEFING_HOUR_VN", "2"))
    while True:
        now_vn = datetime.now(VN_TZ)
        next_run = _next_run_at(now_vn, hour)
        await asyncio.sleep((next_run - now_vn).total_seconds())
        try:
            await run_nightly_briefing()
        except Exception:
            logger.exception("[nightly-briefing] run failed")
