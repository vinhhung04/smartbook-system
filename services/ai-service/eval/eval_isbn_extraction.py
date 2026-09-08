"""Labeled accuracy eval for ISBN metadata extraction (/lookup-book-by-isbn).

Calls lookup_book_by_isbn() from main.py in-process (real network calls to
Google Books / Open Library / marketplace scraping - no mocking), scores each
result against isbn_dataset.json field-by-field, and prints/saves a report.

Requires the same environment as running the ai-service itself (its
requirements.txt installed - this imports main.py the same way
test_enrich_book_after_isbn.py already does) and outbound network access.

Usage (from services/ai-service/):
    python eval/eval_isbn_extraction.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # ai-service root, for `import main`
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # this dir, for `import scoring`

import scoring  # noqa: E402
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
    verdict["title_expected"] = entry.get("title")
    verdict["title_actual"] = actual.get("title")
    verdict["publisher_expected"] = entry.get("publisher")
    verdict["publisher_actual"] = actual.get("publisher")
    verdict["sources_used"] = [name for name, used in (actual.get("source") or {}).items() if used]
    return verdict


def render_report(results: list[dict], summary: dict) -> str:
    lines = [
        "# ISBN extraction eval",
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
        "",
        "## Per-item results",
        "",
        "| ISBN | Found | Title | Authors | Publisher | Year | Sources |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in results:
        mark = lambda ok: "✅" if ok else "❌"  # noqa: E731
        lines.append(
            f"| {r['isbn']} | {mark(r['found'])} | {mark(r['title_match'])} | "
            f"{mark(r['authors_match'])} | {mark(r['publisher_match'])} | {mark(r['year_match'])} | "
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


async def main() -> None:
    with open(DATASET_PATH, encoding="utf-8") as f:
        dataset = json.load(f)

    print(f"Running ISBN extraction eval on {len(dataset)} entries...")
    results = []
    for index, entry in enumerate(dataset, start=1):
        verdict = await run_one(entry)
        status = "OK" if verdict["found"] else "NOT FOUND"
        print(f"  [{index}/{len(dataset)}] {entry['isbn13']} - {status}")
        results.append(verdict)

    summary = scoring.aggregate_extraction_scores(results)
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    os.makedirs(REPORTS_DIR, exist_ok=True)
    report_path = os.path.join(REPORTS_DIR, f"isbn_extraction_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(render_report(results, summary))
    print(f"\nReport written to {report_path}")


if __name__ == "__main__":
    asyncio.run(main())
