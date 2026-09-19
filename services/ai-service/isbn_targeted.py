"""Targeted (field-level) provider planning for ISBN lookup.

Pure module (no import of main.py). Decides *which not-yet-called provider* is
worth calling for the field gaps that remain after the initial lookup, never
calling a provider twice and never spending an expensive call on a gap the
provider's parser cannot fill.
"""
from __future__ import annotations

# What each targeted provider's parser in main.py can actually return.
# (Google Books / Open Library / WorldCat only run in the initial round and are
# already exhausted by it, so they are not listed here.)
PROVIDER_CAPABILITY: dict[str, frozenset[str]] = {
    # _fetch_tiki_by_isbn_api: pageCount / publishedDate / categories are always empty.
    "tiki": frozenset({"title", "authors", "publisher", "description", "thumbnail"}),
    # _fetch_vinabook_by_isbn_api: no categories.
    "vinabook": frozenset({"title", "authors", "publisher", "publishedDate", "description", "pageCount", "thumbnail"}),
    # Fahasa JSON-LD/DOM: no categories.
    "fahasa": frozenset({"title", "authors", "publisher", "publishedDate", "description", "pageCount", "thumbnail", "language"}),
    # _parse_web_search_metadata: only labelled title | author | publisher | year snippets.
    "webSearch": frozenset({"title", "authors", "publisher", "publishedDate"}),
}
PROVIDER_COST: dict[str, str] = {
    "tiki": "cheap", "vinabook": "cheap", "fahasa": "expensive", "webSearch": "last_resort",
}
# Below this much remaining budget a provider is not worth starting (Fahasa's
# CloakBrowser path was measured at ~26s end to end).
PROVIDER_MIN_SECONDS: dict[str, float] = {"tiki": 3.0, "vinabook": 3.0, "fahasa": 20.0, "webSearch": 5.0}

ROUND_COSTS = ("cheap", "expensive", "last_resort")
MAX_ROUNDS = len(ROUND_COSTS)
_PROVIDER_ORDER = ("tiki", "vinabook", "fahasa", "webSearch")


class ProviderLedger:
    """Which providers were called this request, in which phase, and why."""

    def __init__(self):
        self._entries: dict[str, dict] = {}

    def record(self, provider: str, status: str, phase: str, reasons: list[str], duration_ms: int) -> None:
        self._entries[provider] = {
            "status": status, "phase": phase, "reasons": list(reasons), "durationMs": int(duration_ms),
        }

    def called(self, provider: str) -> bool:
        return provider in self._entries

    def get(self, provider: str) -> dict | None:
        return self._entries.get(provider)

    def export(self) -> dict[str, dict]:
        return {provider: dict(entry) for provider, entry in self._entries.items()}

    @property
    def provider_call_count(self) -> int:
        return len(self._entries)


def plan_targeted_retrieval(
    gaps: list[dict],
    ledger: ProviderLedger,
    enabled: set[str] | frozenset[str],
    round_index: int,
    remaining_seconds: float,
) -> list[dict]:
    """One entry per provider (all its fillable gaps batched into a single call)."""
    if not gaps or round_index < 0 or round_index >= MAX_ROUNDS:
        return []
    round_cost = ROUND_COSTS[round_index]
    plan = []
    for provider in _PROVIDER_ORDER:
        if PROVIDER_COST[provider] != round_cost or provider not in enabled or ledger.called(provider):
            continue
        if remaining_seconds < PROVIDER_MIN_SECONDS[provider]:
            continue
        fillable = [gap for gap in gaps if gap["field"] in PROVIDER_CAPABILITY[provider]]
        if not fillable:
            continue
        plan.append({"provider": provider, "reasons": [f"{gap['status']}:{gap['field']}" for gap in fillable]})
    return plan
