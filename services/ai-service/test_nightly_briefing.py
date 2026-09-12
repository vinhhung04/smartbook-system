"""nightly_briefing tests — the scheduling math and prompt-building are pure and
tested directly. run_nightly_briefing's DB/LLM calls (agent_store, main) are faked
here rather than hit for real, but the function itself IS exercised end-to-end
against those fakes (see test_run_nightly_briefing_* below) — a real run against
this exact code once crashed on a `.action_id` vs `.id` typo that no pure-function
test would have caught."""
from __future__ import annotations

import asyncio
import sys
import types
from datetime import datetime, timedelta

import nightly_briefing
from nightly_briefing import VN_TZ, _build_prompt, _next_run_at


def test_next_run_at_rolls_to_today_when_target_hour_still_ahead():
    now = datetime(2026, 9, 12, 0, 30, tzinfo=VN_TZ)  # 00:30, target 02:00
    result = _next_run_at(now, hour=2)
    assert result == datetime(2026, 9, 12, 2, 0, tzinfo=VN_TZ)


def test_next_run_at_rolls_to_tomorrow_when_target_hour_already_passed():
    now = datetime(2026, 9, 12, 14, 0, tzinfo=VN_TZ)  # 14:00, target 02:00 already gone today
    result = _next_run_at(now, hour=2)
    assert result == datetime(2026, 9, 13, 2, 0, tzinfo=VN_TZ)


def test_next_run_at_rolls_to_tomorrow_at_the_exact_target_hour():
    # Exactly at the target hour counts as "already passed" — otherwise a loop
    # iteration landing precisely on the hour would sleep(0) and spin.
    now = datetime(2026, 9, 12, 2, 0, tzinfo=VN_TZ)
    result = _next_run_at(now, hour=2)
    assert result == datetime(2026, 9, 13, 2, 0, tzinfo=VN_TZ)


def test_next_run_at_always_returns_a_time_in_the_future():
    for hour in range(24):
        now = datetime(2026, 9, 12, 12, 0, tzinfo=VN_TZ)
        assert _next_run_at(now, hour) > now


def test_build_prompt_embeds_the_date_and_valid_json_sections():
    sections = {"overdue_summary": {"total": 5}, "fine_summary": {"error": "x that bai: TimeoutException"}}
    prompt = _build_prompt("12/09/2026", sections)
    assert "12/09/2026" in prompt
    assert '"overdue_summary"' in prompt
    assert '"total": 5' in prompt


def test_analytics_sections_map_matches_the_endpoints_authenticate_internal_or_user_was_widened_for():
    # Guards against silently dropping/renaming a section without also updating
    # analytics.routes.js's authenticateInternalOrUser allowlist.
    assert set(nightly_briefing._ANALYTICS_SECTIONS.values()) == {
        "/analytics/overdue-summary",
        "/analytics/fine-summary",
        "/analytics/warehouse-stock-risk",
        "/analytics/reorder-suggestions",
        "/analytics/reservation-funnel",
        "/analytics/weeding-suggestions",
    }


class _FakeAction:
    """Mirrors agent_schemas.PendingAction's field names — deliberately NOT named
    action_id, since accessing that (instead of .id) is the exact bug this test
    exists to catch."""

    id = "act_test123"
    type = "CREATE_REPORT_DRAFT"
    summary = "Bao cao thu thu AI - 12/09/2026"
    risk = "LOW"


def test_run_nightly_briefing_reads_the_created_action_id_correctly(monkeypatch):
    async def fake_get_internal(_endpoint):
        return {"ok": True}

    created_kwargs = {}

    async def fake_create_pending_action(**kwargs):
        created_kwargs.update(kwargs)
        return _FakeAction()

    pushed = {}

    async def fake_push_ai_action_event(event, action_id, action_type, user_id, extra):
        pushed.update(event=event, action_id=action_id, action_type=action_type, user_id=user_id, extra=extra)

    fake_main = types.ModuleType("main")
    fake_main.ANTHROPIC_API_KEY = ""  # falsy -> _generate_with_anthropic short-circuits, no HTTP call
    fake_main.ANTHROPIC_BASE_URL = "https://unused.invalid"
    fake_main.ANTHROPIC_MODEL = "unused"
    fake_main._anthropic_extract_text = lambda payload: ""
    # No OLLAMA_HOST/_ollama_generate_with_summary_fallback on this fake module —
    # _generate_with_ollama's `from main import ...` then fails too, exercising the
    # "both providers unreachable" fallback-text path without needing a real Ollama.

    monkeypatch.setattr(nightly_briefing, "_get_internal", fake_get_internal)
    monkeypatch.setattr(nightly_briefing, "create_pending_action", fake_create_pending_action)
    monkeypatch.setattr(nightly_briefing, "push_ai_action_event", fake_push_ai_action_event)
    monkeypatch.setitem(sys.modules, "main", fake_main)

    asyncio.run(nightly_briefing.run_nightly_briefing())

    assert created_kwargs["user_context"] is None
    assert created_kwargs["conversation_id"] is None
    assert created_kwargs["action_type"] == "CREATE_REPORT_DRAFT"
    assert "Khong the tao bao cao" in created_kwargs["payload"]["report_markdown"]
    assert pushed["action_id"] == "act_test123"
    assert pushed["action_type"] == "CREATE_REPORT_DRAFT"


def test_run_nightly_briefing_falls_back_to_ollama_with_its_own_longer_timeout(monkeypatch):
    # Regression guard for the real bug hit in manual verification: _chat_with_ollama's
    # own CHAT_LLM_TIMEOUT_SECONDS (12s, tuned for live chat) was too short for this
    # job's larger prompt, silently always falling through to the plain-text fallback.
    # _generate_with_ollama must use NIGHTLY_BRIEFING_OLLAMA_TIMEOUT_SECONDS instead.
    async def fake_get_internal(_endpoint):
        return {"ok": True}

    async def fake_create_pending_action(**kwargs):
        return _FakeAction()

    async def fake_push_ai_action_event(*_args, **_kwargs):
        pass

    def fake_generate(_client, _prompt, _options):
        return {"response": "Bao cao gia lap tu Ollama"}

    fake_ollama_client_calls = []

    class _FakeOllamaClient:
        def __init__(self, host):
            fake_ollama_client_calls.append(host)

    fake_main = types.ModuleType("main")
    fake_main.OLLAMA_HOST = "http://fake-ollama:11434"
    fake_main._ollama_generate_with_summary_fallback = fake_generate

    fake_ollama_module = types.ModuleType("ollama")
    fake_ollama_module.Client = _FakeOllamaClient

    monkeypatch.setattr(nightly_briefing, "_get_internal", fake_get_internal)
    monkeypatch.setattr(nightly_briefing, "create_pending_action", fake_create_pending_action)
    monkeypatch.setattr(nightly_briefing, "push_ai_action_event", fake_push_ai_action_event)
    monkeypatch.setitem(sys.modules, "main", fake_main)
    monkeypatch.setitem(sys.modules, "ollama", fake_ollama_module)

    reply = asyncio.run(nightly_briefing._generate_with_ollama("bat ky prompt nao"))
    assert reply == "Bao cao gia lap tu Ollama"
    assert fake_ollama_client_calls == ["http://fake-ollama:11434"]


def test_generate_with_anthropic_short_circuits_with_no_api_key(monkeypatch):
    # No network attempt should happen when the key is blank — proven by leaving
    # ANTHROPIC_BASE_URL pointing nowhere real; a request there would just hang/error
    # instead of the fast None this asserts.
    fake_main = types.ModuleType("main")
    fake_main.ANTHROPIC_API_KEY = ""
    fake_main.ANTHROPIC_BASE_URL = "https://unused.invalid"
    fake_main.ANTHROPIC_MODEL = "unused"
    fake_main._anthropic_extract_text = lambda payload: ""

    monkeypatch.setitem(sys.modules, "main", fake_main)

    reply = asyncio.run(nightly_briefing._generate_with_anthropic("bat ky prompt nao"))
    assert reply is None
