"""Benchmark the multi-image book OCR on a labelled dataset, for one or more
OpenRouter models. Runs the real pipeline (book_ocr.service: preprocessing,
one multimodal call, validation, proposals) with the ISBN lookup OFF, so the
numbers describe OCR alone. The response cache is cleared before every scan.

  python eval/book_ocr_eval/run_benchmark.py --dataset eval/book_ocr_eval/dataset.example.json \\
      --images-root <folder> --models qwen/qwen3.7-flash,other/model --runs 3

  # same models, two preprocessing sizes (production default stays BOOK_OCR_MAX_IMAGE_EDGE=1600)
  ... --max-edge 1600,2048

  # re-score the model answers stored in an earlier report with the CURRENT
  # validation / autofill code: no model call, no cost - isolates what the
  # post-processing changed on identical model output
  python eval/book_ocr_eval/run_benchmark.py --dataset <same dataset> --replay eval/reports/book_ocr_<stamp>.json

--dry-run swaps the model for a "perfect reader" built from the ground truth:
it exercises the dataset, pipeline and scoring without an API key or cost,
and must score 1.0 - it is a harness check, never a result to report.
Reports go to eval/reports/book_ocr_<timestamp>.{json,md}. Each result keeps
the model's answer (`modelAnswer`) so later code can be replayed on it.
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
from book_ocr.extractor import default_provider_factory  # noqa: E402
from llm_provider import ChatUsage  # noqa: E402
from ocr_scoring import FIELDS, aggregate, by_tag  # noqa: E402


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
                elif field == "publisher":
                    text = f"NXB {value}" if "xuất bản" not in value.casefold() else value
                observations[names.get(field, field)] = [{"source": self.source, "value": value, "observedText": text}]
        usage = ChatUsage(provider="dry-run", model=self.model, latency_ms=0, prompt_tokens=0, completion_tokens=0,
                          tool_call_count=0, cost_usd=0.0, feature="book_ocr")
        return {"observations": observations}, usage


class Recorder:
    """Wraps the real provider and keeps the model's parsed answer for replay."""

    def __init__(self, provider):
        self.provider, self.model, self.answer, self.usage = provider, provider.model, None, None

    async def analyze_images(self, images, prompt, **kwargs):
        parsed, usage = await self.provider.analyze_images(images, prompt, **kwargs)
        self.answer, self.usage = parsed, usage
        return parsed, usage


class Replay:
    """--replay: returns a stored model answer with its original usage numbers."""

    def __init__(self, model: str, answer: dict, usage: dict):
        self.model, self.answer, self.stored = model, answer, usage

    async def analyze_images(self, images, prompt, **_):
        u = self.stored or {}
        return self.answer, ChatUsage(provider="replay", model=self.model, latency_ms=u.get("latencyMs") or 0,
                                      prompt_tokens=u.get("promptTokens"), completion_tokens=u.get("completionTokens"),
                                      tool_call_count=0, cost_usd=u.get("costUsd"), feature="book_ocr")


def answer_from_response(response: dict) -> dict:
    """Rebuilds the model's observations from a stored scan response (reports made
    before `modelAnswer` was kept). Every image reading is in fields[*].observations
    with its source, raw value and observedText; barcode readings were not the model's."""
    observations = {}
    for field, result in (response.get("fields") or {}).items():
        items = [{"source": o["source"], "value": o["value"], "observedText": o.get("observedText")}
                 for o in result.get("observations", []) if o.get("source") != "barcode"]
        if items and field != "language":
            observations[field] = items
    other = [{k: c.get(k) for k in ("source", "label", "value", "observedText")}
             for c in response.get("otherCodes") or [] if c.get("source") != "barcode"]
    images = [{"source": w.split(":", 1)[1], "legible": False} for w in response.get("warnings") or []
              if w.startswith("IMAGE_ILLEGIBLE:")]
    return {"images": images, "observations": observations, "otherCodes": other}


async def run(books: list[dict], images_root: Path, model: str, runs: int, dry_run: bool, max_edge: int | None,
              replay: dict | None = None) -> list[dict]:
    settings = dataclasses.replace(load_settings(), enabled=True, model=model, fallback_model=None, max_concurrency=1)
    if max_edge:
        settings = dataclasses.replace(settings, max_image_edge=max_edge)
    results = []
    for book in books:
        uploads = {kind: (images_root / rel).read_bytes() for kind, rel in book["images"].items() if rel}
        for repetition in range(runs):
            service.extraction_cache.clear()
            recorder = None
            stored = (replay or {}).get((book["bookId"], repetition))
            if replay is not None and stored is None:
                continue  # the replayed report has no answer for this scan
            if stored is not None:
                factory = lambda m, s=stored: Replay(m, s["answer"], s["usage"])  # noqa: E731
            elif dry_run:
                first = next(kind for kind in IMAGE_KINDS if kind in uploads)
                factory = lambda m, b=book, s=first: PerfectReader(m, b["groundTruth"], s)  # noqa: E731
            else:
                def factory(m):
                    nonlocal recorder
                    recorder = Recorder(default_provider_factory(m))
                    return recorder
            base = {"bookId": book["bookId"], "run": repetition, "truth": book["groundTruth"], "tags": book.get("tags", [])}
            try:
                response = await service.scan_book_images(uploads, settings=settings, provider_factory=factory)
                if stored is not None and stored.get("processingTimeMs") is not None:
                    response["processingTimeMs"] = stored["processingTimeMs"]  # the live latency, not the replay's
                answer = stored["answer"] if stored is not None else recorder.answer if recorder else None
                results.append({**base, "response": response, "modelAnswer": answer})
            except BookOcrError as error:
                results.append({**base, "error": error.code})
            print(f"  {model} {book['bookId']} #{repetition + 1}: {results[-1].get('error') or results[-1]['response']['status']}",
                  file=sys.stderr)
    return results


def load_replay(path: Path) -> dict[str, dict]:
    """configuration ("model" or "model@2048px") -> {(bookId, run): {"answer", "usage",
    "processingTimeMs"}} from a report JSON."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for model, results in data["results"].items():
        for r in results:
            if not r.get("response"):
                continue
            answer = r.get("modelAnswer") or answer_from_response(r["response"])
            out.setdefault(model, {})[(r["bookId"], r["run"])] = {
                "answer": answer, "usage": r["response"].get("usage"), "processingTimeMs": r["response"].get("processingTimeMs")}
    return out


def _fmt(value, pct=True):
    if value is None:
        return "–"
    return f"{value * 100:.1f}%" if pct else f"{value:.0f}" if value >= 10 else f"{value:.6f}"


def markdown(reports: dict, tags: dict, meta: dict) -> str:
    mode = " · **DRY RUN (harness check, not a result)**" if meta["dryRun"] else \
        f" · **REPLAY** of `{meta['replayOf']}` (stored model answers, current code, no new model call)" if meta.get("replayOf") else ""
    lines = [f"# Book OCR benchmark - {meta['createdAt']}", "",
             f"Dataset `{meta['dataset']}` · {meta['books']} books · {meta['runs']} run(s) per book · "
             f"ISBN lookup off · prompt {meta['promptVersion']}{mode}", ""]
    lines += ["| Model | Scans ok | JSON valid | ISBN exact | Title exact | Title normalized | Authors | Publisher | Year |"
              " Manual correction (click / type) | Invalid ISBN | Latency mean / p50 / p95 (ms) | Tokens in / out | Cost / book |",
              "|---" * 14 + "|"]
    for model, r in reports.items():
        a = r["accuracy"]
        lines.append(" | ".join([
            f"| {model}", f"{r['succeeded']}/{r['scans']}", _fmt(r["jsonValidityRate"]), _fmt(a["isbnExact"]), _fmt(a["titleExact"]),
            _fmt(a["titleNormalized"]), _fmt(a["authors"]), _fmt(a["publisher"]), _fmt(a["publishedYear"]),
            f"{_fmt(r['manualCorrectionRate'])} ({_fmt(r['oneClickRate'])} / {_fmt(r['typingRate'])})", _fmt(r["invalidIsbnRate"]),
            f"{_fmt(r['latencyMs']['mean'], False)} / {_fmt(r['latencyMs']['p50'], False)} / {_fmt(r['latencyMs']['p95'], False)}",
            " / ".join("–" if t is None else f"{t:.0f}" for t in (r["tokens"]["meanInput"], r["tokens"]["meanOutput"])),
            f"${r['costUsd']['meanPerBook']:.6f}" if r["costUsd"]["meanPerBook"] is not None else "–"]) + " |")
    lines += ["", "Three layers (micro over scored fields): raw = model answer before validation, "
              "reading = after validation, autofill = filled without a click.", "",
              "| Model | Layer | Precision | Recall | F1 | Hallucination | Coverage |", "|---" * 7 + "|"]
    for model, r in reports.items():
        for layer in ("raw", "reading", "autofill"):
            m = r[layer]["micro"]
            lines.append(f"| {model} | {layer} | {_fmt(m['precision'])} | {_fmt(m['recall'])} | {_fmt(m['f1'])} | "
                         f"{_fmt(r[layer]['hallucinationRate'])} | {_fmt(r[layer]['fieldCoverage'])} |")
    lines += ["", "Per-field (reading) precision / recall:", ""]
    for model, r in reports.items():
        cells = ", ".join(f"{f} {_fmt(v['precision'])}/{_fmt(v['recall'])}" for f, v in r["reading"]["fields"].items())
        lines.append(f"- {model}: {cells}")
    for model, per_tag in tags.items():
        if per_tag:
            lines += ["", f"By tag ({model}): scans · title exact · ISBN exact · reading F1 · autofill precision · hallucination", ""]
            lines += [f"- {tag}: {t['scans']} · {_fmt(t['titleExact'])} · {_fmt(t['isbnExact'])} · {_fmt(t['readingF1'])} · "
                      f"{_fmt(t['autofillPrecision'])} · {_fmt(t['hallucinationRate'])}" for tag, t in per_tag.items()]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--images-root", type=Path, help="Folder the dataset's image paths are relative to (default: the dataset's folder)")
    parser.add_argument("--models", default=load_settings().model)
    parser.add_argument("--runs", type=int, default=1, help="Repetitions per book (model answers vary between calls)")
    parser.add_argument("--max-edge", default="", help="Comma list of preprocessing long-edge sizes to compare (default: BOOK_OCR_MAX_IMAGE_EDGE)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--replay", type=Path, help="Re-score the model answers stored in this report with the current code")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "eval" / "reports")
    args = parser.parse_args()

    books = read_dataset(args.dataset)
    images_root = args.images_root or args.dataset.parent
    edges = [int(e) for e in args.max_edge.split(",") if e.strip()] or [None]
    replay = load_replay(args.replay) if args.replay else None
    runs = max((key[1] for answers in replay.values() for key in answers), default=0) + 1 if replay else args.runs
    # (report name, model, image edge, stored answers); a replay keeps the stored configurations' names.
    configs = [(name, name.split("@")[0], None, answers) for name, answers in replay.items()] if replay else         [(f"{m}@{e}px" if e else m, m, e, None) for m in (m.strip() for m in args.models.split(",") if m.strip()) for e in edges]
    reports, tags, raw = {}, {}, {}
    for name, model, edge, answers in configs:
        results = asyncio.run(run(books, images_root, model, runs, args.dry_run, edge, answers))
        raw[name], reports[name], tags[name] = results, aggregate(results), by_tag(results)
    meta = {"createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "dataset": str(args.dataset),
            "books": len(books), "runs": runs, "dryRun": args.dry_run, "promptVersion": service.PROMPT_VERSION,
            "replayOf": str(args.replay) if args.replay else None,
            "maxImageEdge": edges if edges != [None] else load_settings().max_image_edge}
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S") + ("_dryrun" if args.dry_run else "_replay" if args.replay else "")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / f"book_ocr_{stamp}.json").write_text(
        json.dumps({"meta": meta, "reports": reports, "byTag": tags, "results": raw}, ensure_ascii=False, indent=1), encoding="utf-8")
    text = markdown(reports, tags, meta)
    (args.out_dir / f"book_ocr_{stamp}.md").write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
