"""Benchmark the multi-image book OCR on a labelled dataset, for one or more
OpenRouter models. Runs the real pipeline (book_ocr.service: preprocessing,
one multimodal call, validation, proposals) with the ISBN lookup OFF, so the
numbers describe OCR alone. The response cache is cleared before every scan.

  python eval/book_ocr_eval/run_benchmark.py --dataset eval/book_ocr_eval/dataset.example.json \\
      --images-root <folder> --models qwen/qwen3.7-flash,other/model --runs 3

--dry-run swaps the model for a "perfect reader" built from the ground truth:
it exercises the dataset, pipeline and scoring without an API key or cost,
and must score 1.0 - it is a harness check, never a result to report.
Reports go to eval/reports/book_ocr_<timestamp>.{json,md}.
"""
from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from book_ocr import service  # noqa: E402
from book_ocr.config import IMAGE_KINDS, load_settings  # noqa: E402
from book_ocr.errors import BookOcrError  # noqa: E402
from llm_provider import ChatUsage  # noqa: E402
from ocr_scoring import FIELDS, aggregate  # noqa: E402


def read_dataset(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    books = data["books"] if isinstance(data, dict) else data
    seen = set()
    for book in books:
        if not book.get("bookId") or book["bookId"] in seen:
            raise ValueError(f"missing or duplicate bookId: {book.get('bookId')!r}")
        seen.add(book["bookId"])
        if not any(book.get("images", {}).get(kind) for kind in IMAGE_KINDS):
            raise ValueError(f"{book['bookId']}: needs at least one image")
        unknown = set(book.get("groundTruth", {})) - set(FIELDS)
        if unknown:
            raise ValueError(f"{book['bookId']}: unknown ground-truth fields {sorted(unknown)}")
    return books


class PerfectReader:
    """--dry-run only: answers with the ground truth, as observations from the first image."""

    def __init__(self, model: str, truth: dict, source: str):
        self.model, self.truth, self.source = model, truth, source

    async def analyze_images(self, images, prompt, **_):
        names = {"publishedYear": "publicationYear", "isbn13": "isbn"}
        observations = {}
        for field, value in self.truth.items():
            if value not in (None, "", []):
                text = ", ".join(value) if isinstance(value, list) else str(value)
                if field == "translators":
                    text += " dịch"
                elif field == "publishedYear":
                    text = f"Xuất bản năm {value}"
                elif field == "isbn13":
                    text = f"ISBN {value}"
                observations[names.get(field, field)] = [{"source": self.source, "value": value, "observedText": text}]
        usage = ChatUsage(provider="dry-run", model=self.model, latency_ms=0, prompt_tokens=0, completion_tokens=0,
                          tool_call_count=0, cost_usd=0.0, feature="book_ocr")
        return {"observations": observations}, usage


async def run(books: list[dict], images_root: Path, model: str, runs: int, dry_run: bool) -> list[dict]:
    settings = dataclasses.replace(load_settings(), enabled=True, model=model, fallback_model=None, max_concurrency=1)
    results = []
    for book in books:
        uploads = {kind: (images_root / rel).read_bytes() for kind, rel in book["images"].items() if rel}
        for repetition in range(runs):
            service.extraction_cache.clear()
            factory = None
            if dry_run:
                first = next(kind for kind in IMAGE_KINDS if kind in uploads)
                factory = lambda m, b=book, s=first: PerfectReader(m, b["groundTruth"], s)  # noqa: E731
            try:
                response = await service.scan_book_images(uploads, settings=settings, provider_factory=factory)
                results.append({"bookId": book["bookId"], "run": repetition, "truth": book["groundTruth"], "response": response})
            except BookOcrError as error:
                results.append({"bookId": book["bookId"], "run": repetition, "truth": book["groundTruth"], "error": error.code})
            print(f"  {model} {book['bookId']} #{repetition + 1}: {results[-1].get('error') or results[-1]['response']['status']}",
                  file=sys.stderr)
    return results


def _fmt(value, pct=True):
    if value is None:
        return "–"
    return f"{value * 100:.1f}%" if pct else f"{value:.0f}" if value >= 10 else f"{value:.6f}"


def markdown(reports: dict, meta: dict) -> str:
    lines = [f"# Book OCR benchmark - {meta['createdAt']}", "",
             f"Dataset `{meta['dataset']}` · {meta['books']} books · {meta['runs']} run(s) per book · "
             f"ISBN lookup off · prompt {meta['promptVersion']}" + (" · **DRY RUN (harness check, not a result)**" if meta["dryRun"] else ""), ""]
    lines += ["| Model | Scans ok | JSON valid | ISBN exact | Title exact | Title normalized | Authors | Publisher | Year |"
              " Reading F1 | Hallucination | Coverage | Autofill precision | Manual correction | Invalid ISBN | Latency mean / p95 (ms) | Cost / book |",
              "|---" * 17 + "|"]
    for model, r in reports.items():
        a = r["accuracy"]
        lines.append(" | ".join([
            f"| {model}", f"{r['succeeded']}/{r['scans']}", _fmt(r["jsonValidityRate"]), _fmt(a["isbnExact"]), _fmt(a["titleExact"]),
            _fmt(a["titleNormalized"]), _fmt(a["authors"]), _fmt(a["publisher"]), _fmt(a["publishedYear"]),
            _fmt(r["reading"]["micro"]["f1"]), _fmt(r["reading"]["hallucinationRate"]), _fmt(r["reading"]["fieldCoverage"]),
            _fmt(r["autofill"]["micro"]["precision"]), _fmt(r["manualCorrectionRate"]), _fmt(r["invalidIsbnRate"]),
            f"{_fmt(r['latencyMs']['mean'], False)} / {_fmt(r['latencyMs']['p95'], False)}",
            f"${r['costUsd']['meanPerBook']:.6f}" if r["costUsd"]["meanPerBook"] is not None else "–"]) + " |")
    lines += ["", "Per-field (reading) precision / recall:", ""]
    for model, r in reports.items():
        cells = ", ".join(f"{f} {_fmt(v['precision'])}/{_fmt(v['recall'])}" for f, v in r["reading"]["fields"].items())
        lines.append(f"- {model}: {cells}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--images-root", type=Path, help="Folder the dataset's image paths are relative to (default: the dataset's folder)")
    parser.add_argument("--models", default=load_settings().model)
    parser.add_argument("--runs", type=int, default=1, help="Repetitions per book (model answers vary between calls)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "eval" / "reports")
    args = parser.parse_args()

    books = read_dataset(args.dataset)
    images_root = args.images_root or args.dataset.parent
    reports, raw = {}, {}
    for model in [m.strip() for m in args.models.split(",") if m.strip()]:
        results = asyncio.run(run(books, images_root, model, args.runs, args.dry_run))
        raw[model] = results
        reports[model] = aggregate(results)
    meta = {"createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "dataset": str(args.dataset),
            "books": len(books), "runs": args.runs, "dryRun": args.dry_run, "promptVersion": service.PROMPT_VERSION}
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S") + ("_dryrun" if args.dry_run else "")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / f"book_ocr_{stamp}.json").write_text(
        json.dumps({"meta": meta, "reports": reports, "results": raw}, ensure_ascii=False, indent=1), encoding="utf-8")
    text = markdown(reports, meta)
    (args.out_dir / f"book_ocr_{stamp}.md").write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
