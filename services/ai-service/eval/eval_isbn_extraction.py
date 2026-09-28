"""Labeled accuracy + completeness eval for ISBN metadata extraction (/lookup-book-by-isbn).

Calls lookup_book_by_isbn() from main.py in-process (real network calls to
Google Books / Open Library / marketplace scraping - no mocking), scores each
result against isbn_dataset.json field-by-field, and prints/saves a report.

Beyond accuracy it measures what field-level retrieval is meant to improve:
metadata coverage before/after, per-field fill rate, provider calls and latency
(see scoring.field_level_verdict). `--mode both` runs the whole dataset twice in
one session (flag off, then on) and writes a side-by-side comparison.

Requires the same environment as running the ai-service itself (its
requirements.txt installed - this imports main.py the same way
test_enrich_book_after_isbn.py already does) and outbound network access.

Usage (from services/ai-service/):
    python eval/eval_isbn_extraction.py                   # ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL as configured
    python eval/eval_isbn_extraction.py --mode both       # legacy vs field-level, with deltas
    python eval/eval_isbn_extraction.py --mode field-level
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # ai-service root, for `import main`
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # this dir, for `import scoring`

import main as ai_main  # noqa: E402
import scoring  # noqa: E402
from cache import isbn_lookup_cache  # noqa: E402
from main import IsbnLookupRequest, lookup_book_by_isbn  # noqa: E402

DATASET_PATH = os.path.join(os.path.dirname(__file__), "isbn_dataset.json")
REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")


async def run_one(entry: dict) -> dict:
    request = IsbnLookupRequest(isbn=entry["isbn13"])
    try:
        actual = await lookup_book_by_isbn(request)
    except Exception as exc:  # noqa: BLE001 - a single bad ISBN must not abort the whole eval
        actual = {"found": False, "error": f"{type(exc).__name__}: {exc}"}
    verdict = scoring.score_extraction_result(entry, actual)
    verdict["field_level"] = scoring.field_level_verdict(actual)
    verdict["title_expected"] = entry.get("title")
    verdict["title_actual"] = actual.get("title")
    verdict["publisher_expected"] = entry.get("publisher")
    verdict["publisher_actual"] = actual.get("publisher")
    verdict["sources_used"] = [name for name, used in (actual.get("source") or {}).items() if used]
    return verdict


def render_report(results: list[dict], summary: dict, field_level: dict | None = None, label: str = "") -> str:
    lines = [
        f"# ISBN extraction eval{f' ({label})' if label else ''}",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Total ISBNs: {summary['total']}",
        "",
        "## Summary",
        "",
        f"- Found rate: {summary['found_rate']:.1%}",
        f"- All-fields-correct rate: {summary['all_fields_correct_rate']:.1%}",
        f"- Title accuracy: {summary['field_accuracy']['title_match']:.1%}",
        f"- Authors accuracy: {summary['field_accuracy']['authors_match']:.1%}",
        f"- Publisher accuracy: {summary['field_accuracy']['publisher_match']:.1%}",
        f"- Year accuracy: {summary['field_accuracy']['year_match']:.1%}",
    ]
    if field_level and field_level.get("total"):
        lines += [
            f"- Metadata coverage before enrichment: {field_level['avg_coverage_before']:.1%}",
            f"- Metadata coverage after enrichment: {field_level['avg_coverage_after']:.1%}",
            "- Fill rate: " + ", ".join(f"{f} {r:.0%}" for f, r in field_level["fill_rate"].items()),
            f"- Avg provider calls: {field_level['avg_provider_calls']}",
            f"- Latency p50 / p95: {field_level['latency_ms']['p50']} ms / {field_level['latency_ms']['p95']} ms",
        ]
    lines += [
        "",
        "## Per-item results",
        "",
        "| ISBN | Found | Title | Authors | Publisher | Year | Coverage | Calls | Sources |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    mark = lambda ok: "✅" if ok else "❌"  # noqa: E731
    for r in results:
        fl = r["field_level"]
        lines.append(
            f"| {r['isbn']} | {mark(r['found'])} | {mark(r['title_match'])} | "
            f"{mark(r['authors_match'])} | {mark(r['publisher_match'])} | {mark(r['year_match'])} | "
            f"{fl['coverage_before']:.0%} -> {fl['coverage_after']:.0%} | {fl['provider_calls']} | "
            f"{', '.join(r['sources_used']) or '—'} |"
        )
    lines.append("")
    lines.append("## Mismatches (title/publisher)")
    lines.append("")
    for r in results:
        if r["title_match"] and r["publisher_match"]:
            continue
        lines.append(
            f"- `{r['isbn']}`: expected title=\"{r['title_expected']}\" publisher=\"{r['publisher_expected']}\" "
            f"-> got title=\"{r['title_actual']}\" publisher=\"{r['publisher_actual']}\""
        )
    return "\n".join(lines) + "\n"


def render_comparison(legacy: dict, new: dict, legacy_fl: dict, new_fl: dict) -> str:
    delta = scoring.compare_modes(legacy_fl, new_fl)
    lines = [
        "# ISBN field-level retrieval: legacy vs field-level",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        "| Metric | Legacy | Field-level | Delta |",
        "|---|---|---|---|",
        f"| Found rate | {legacy['found_rate']:.1%} | {new['found_rate']:.1%} | {new['found_rate'] - legacy['found_rate']:+.1%} |",
    ]
    for key in ("title_match", "authors_match", "publisher_match", "year_match"):
        old_value, new_value = legacy["field_accuracy"][key], new["field_accuracy"][key]
        lines.append(f"| {key} | {old_value:.1%} | {new_value:.1%} | {new_value - old_value:+.1%} |")
    lines.append(f"| Coverage after | {legacy_fl['avg_coverage_after']:.1%} | {new_fl['avg_coverage_after']:.1%} | {delta['coverage_after']:+.1%} |")
    for field, change in delta["fill_rate"].items():
        lines.append(f"| Fill rate: {field} | {legacy_fl['fill_rate'][field]:.0%} | {new_fl['fill_rate'][field]:.0%} | {change:+.0%} |")
    lines.append(f"| Avg provider calls | {legacy_fl['avg_provider_calls']} | {new_fl['avg_provider_calls']} | {delta['avg_provider_calls']:+} |")
    lines.append(f"| Latency p50 (ms) | {legacy_fl['latency_ms']['p50']} | {new_fl['latency_ms']['p50']} | {delta['latency_p50_ms']:+} |")
    lines.append(f"| Latency p95 (ms) | {legacy_fl['latency_ms']['p95']} | {new_fl['latency_ms']['p95']} | {delta['latency_p95_ms']:+} |")
    return "\n".join(lines) + "\n"


async def run_mode(dataset: list[dict], field_level_enabled: bool) -> tuple[list[dict], dict, dict]:
    """Runs the whole dataset with the flag set in-process (a module global read at call time)."""
    ai_main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL = field_level_enabled
    isbn_lookup_cache.clear()  # never let one mode serve the other mode's cached results
    label = "field-level" if field_level_enabled else "legacy"
    print(f"Running ISBN extraction eval ({label}) on {len(dataset)} entries...")
    results = []
    for index, entry in enumerate(dataset, start=1):
        verdict = await run_one(entry)
        print(f"  [{index}/{len(dataset)}] {entry['isbn13']} - {'OK' if verdict['found'] else 'NOT FOUND'}")
        results.append(verdict)
    summary = scoring.aggregate_extraction_scores(results)
    field_level = scoring.aggregate_field_level_scores([r["field_level"] for r in results])
    print(json.dumps({"mode": label, **summary, "field_level": field_level}, indent=2, ensure_ascii=False))
    return results, summary, field_level


def write_report(name: str, content: str) -> None:
    os.makedirs(REPORTS_DIR, exist_ok=True)
    path = os.path.join(REPORTS_DIR, f"{name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"\nReport written to {path}")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["legacy", "field-level", "both"], default=None,
                        help="default: whatever ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL is set to")
    args = parser.parse_args()
    with open(DATASET_PATH, encoding="utf-8") as f:
        dataset = json.load(f)

    if args.mode == "both":
        legacy_results, legacy_summary, legacy_fl = await run_mode(dataset, False)
        new_results, new_summary, new_fl = await run_mode(dataset, True)
        write_report("isbn_extraction_legacy", render_report(legacy_results, legacy_summary, legacy_fl, "legacy"))
        write_report("isbn_extraction_field_level", render_report(new_results, new_summary, new_fl, "field-level"))
        write_report("isbn_field_level_comparison", render_comparison(legacy_summary, new_summary, legacy_fl, new_fl))
        return

    enabled = ai_main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL if args.mode is None else args.mode == "field-level"
    results, summary, field_level = await run_mode(dataset, enabled)
    write_report("isbn_extraction", render_report(results, summary, field_level, "field-level" if enabled else "legacy"))


if __name__ == "__main__":
    asyncio.run(main())
