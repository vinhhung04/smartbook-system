"""RAG benchmark integrity (Phase 0): is each eval case still a fair test?

Pure functions, no network. `eval_rag.py` calls `audit()` against the catalog
it actually evaluated and reports metrics on the *trusted* subset next to the
unchanged all-cases metrics; `python eval/rag_integrity.py` runs the same audit
standalone (CI-safe with the committed snapshots, or `--catalog <file.json>`).

Ground-truth labels in rag_dataset.json are never rewritten here. A case is
classified, and the classification decides only which report column it lands in:

- REACHABLE / PARTIALLY_REACHABLE / UNREACHABLE - how many expected ids exist in
  the evaluated catalog (BOOK_METADATA) or corpus/ (INTERNAL_DOC). A retriever
  cannot return a book that is no longer in the catalog: that is catalog drift,
  not a ranking error.
- NO_ANSWER / STALE_NO_ANSWER - a no-answer book case whose question now names
  a title that the catalog does contain (the catalog grew after the label).
- flags: LABEL_AUTHOR_MISMATCH (an AUTHOR case expects a book whose catalog
  author is not the author named in the question), plus the manual flags in
  rag_dataset_review.json (human-review queue; `needs_human: true`).

Trusted = REACHABLE, PARTIALLY_REACHABLE (scored on its reachable ids only) or
NO_ANSWER, with no flag.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scoring  # noqa: E402

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_DIR = os.path.dirname(EVAL_DIR)
DATASET_PATH = os.path.join(EVAL_DIR, "rag_dataset.json")
REVIEW_PATH = os.path.join(EVAL_DIR, "rag_dataset_review.json")
CORPUS_DIR = os.path.join(SERVICE_DIR, "corpus")
# Every book id a label may point to must be traceable to one of these.
LABEL_SNAPSHOTS = ("rag_dataset_books_snapshot.json", "rag_catalog_snapshot_20261008.json",
                   "rag_catalog_snapshot_20261115.json")

CORPORA = ("BOOK_METADATA", "INTERNAL_DOC")
REQUIRED_FIELDS = {"id": str, "corpus": str, "question": str, "expected_ids": list}
TRUSTED_STATUSES = ("REACHABLE", "PARTIALLY_REACHABLE", "NO_ANSWER")
# Title mentions shorter than this (after normalization) are too ambiguous ("Dune", "Pi").
_MIN_TITLE_MENTION_CHARS = 8


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_dataset(path: str) -> list[dict]:
    """rag_dataset.json is a bare list; a supplement set is {"version", ..., "cases": [...]}."""
    data = load_json(path)
    return data["cases"] if isinstance(data, dict) else data


def corpus_doc_ids(corpus_dir: str = CORPUS_DIR) -> set[str]:
    return {os.path.splitext(name)[0] for name in os.listdir(corpus_dir) if name.endswith(".md")}


def label_snapshot_books() -> dict[str, dict]:
    books: dict[str, dict] = {}
    for name in LABEL_SNAPSHOTS:
        path = os.path.join(EVAL_DIR, name)
        if os.path.exists(path):
            for book in load_json(path):
                books.setdefault(str(book["id"]), book)
    return books


def edition_free_title(title: str | None) -> str:
    """'Mắt Biếc (Tái Bản 2022)' and 'Mat biec' are the same work for labelling."""
    return scoring.normalize_for_match(re.sub(r"\([^)]*\)", " ", str(title or "")))


def _mentions(text: str, phrase: str) -> bool:
    return bool(phrase) and re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", text) is not None


def validate_structure(dataset: list, doc_ids: set[str], label_book_ids: set[str]) -> list[str]:
    """Hard errors: a broken dataset must fail CI, not produce a quiet report."""
    errors: list[str] = []
    seen_ids: set[str] = set()
    seen_questions: dict[str, str] = {}
    for index, entry in enumerate(dataset):
        where = entry.get("id") or f"#{index}"
        bad_fields = [field for field, kind in REQUIRED_FIELDS.items() if not isinstance(entry.get(field), kind)]
        if bad_fields:
            errors.append(f"{where}: missing or wrongly typed field(s) {bad_fields}")
            continue
        if entry["id"] in seen_ids:
            errors.append(f"{where}: duplicate id")
        seen_ids.add(entry["id"])
        question_key = scoring.normalize_for_match(entry["question"])
        if question_key in seen_questions:
            errors.append(f"{where}: same question as {seen_questions[question_key]}")
        seen_questions.setdefault(question_key, entry["id"])
        if entry["corpus"] not in CORPORA:
            errors.append(f"{where}: unknown corpus {entry['corpus']!r}")
        if len(set(entry["expected_ids"])) != len(entry["expected_ids"]):
            errors.append(f"{where}: duplicate expected id")
        known = doc_ids if entry["corpus"] == "INTERNAL_DOC" else label_book_ids
        for expected in entry["expected_ids"]:
            if expected not in known:
                errors.append(f"{where}: expected id {expected!r} is not in "
                              f"{'corpus/' if entry['corpus'] == 'INTERNAL_DOC' else 'any label snapshot'}")
    return errors


def _author_flag(entry: dict, catalog: dict[str, dict]) -> str | None:
    """AUTHOR case: every reachable expected book's catalog author must be named in the question."""
    question = scoring.normalize_for_match(entry["question"])
    for book_id in entry["expected_ids"]:
        book = catalog.get(book_id)
        if book is None:
            continue
        names = [name for name in re.split(r"\s*(?:[,;&/]|\bva\b|\band\b)\s*",
                                            scoring.normalize_for_match(book.get("author"))) if name]
        if not any(_mentions(question, name) for name in names):
            return f"expects `{book.get('title')}` by {book.get('author')!r}, author not named in the question"
    return None


def classify(entry: dict, available: set[str], catalog: dict[str, dict] | None = None) -> dict:
    expected = list(entry["expected_ids"])
    out: dict = {"status": "", "reachable_ids": [i for i in expected if i in available], "flags": [], "detail": ""}
    if not expected:
        out["status"] = "NO_ANSWER"
        if entry["corpus"] == "BOOK_METADATA" and catalog:
            question = scoring.normalize_for_match(entry["question"])
            named = [book for book in catalog.values()
                     if len(title := edition_free_title(book.get("title"))) >= _MIN_TITLE_MENTION_CHARS
                     and _mentions(question, title)]
            if named:
                out["status"] = "STALE_NO_ANSWER"
                out["detail"] = "catalog now has " + ", ".join(f"{b['id']} `{b.get('title')}`" for b in named)
        return out
    reachable = len(out["reachable_ids"])
    out["status"] = ("REACHABLE" if reachable == len(expected) else
                     "PARTIALLY_REACHABLE" if reachable else "UNREACHABLE")
    if entry["corpus"] == "BOOK_METADATA" and catalog and scoring.classify_book_query(entry["question"]) == "AUTHOR":
        reason = _author_flag(entry, catalog)
        if reason:
            out["flags"].append("LABEL_AUTHOR_MISMATCH")
            out["detail"] = reason
    return out


def remap_candidates(entry: dict, available: set[str], catalog: dict[str, dict],
                     label_books: dict[str, dict]) -> list[dict]:
    """For a missing expected book: catalog books with the same ISBN or edition-free
    title. Suggestions for a human - never applied automatically."""
    out = []
    for missing in (i for i in entry["expected_ids"] if i not in available):
        old = label_books.get(missing)
        if not old:
            continue
        for book in catalog.values():
            same_isbn = old.get("isbn") and book.get("isbn") == old.get("isbn")
            same_title = edition_free_title(book.get("title")) == edition_free_title(old.get("title"))
            if same_isbn or same_title:
                out.append({"missing": missing, "missing_title": old.get("title"), "candidate": book["id"],
                            "candidate_title": book.get("title"), "candidate_author": book.get("author"),
                            "match": "isbn" if same_isbn else "edition-free title"})
    return out


def audit(dataset: list, catalog_books: list[dict], doc_ids: set[str] | None = None,
          review: dict | None = None, label_books: dict[str, dict] | None = None) -> dict:
    """Per-case classification against the catalog/corpus being evaluated."""
    doc_ids = corpus_doc_ids() if doc_ids is None else doc_ids
    catalog = {str(b["id"]): b for b in catalog_books if isinstance(b, dict) and b.get("id")}
    label_books = label_snapshot_books() if label_books is None else label_books
    manual = (review or {}).get("cases", {})
    cases = {}
    for entry in dataset:
        available = doc_ids if entry["corpus"] == "INTERNAL_DOC" else set(catalog)
        info = classify(entry, available, catalog if entry["corpus"] == "BOOK_METADATA" else None)
        if entry.get("verification") == "needs_human":
            info["flags"].append("UNVERIFIED_LABEL")
        if entry["id"] in manual:
            info["flags"].append(manual[entry["id"]]["flag"])
            info["review"] = manual[entry["id"]]
        if entry["corpus"] == "BOOK_METADATA" and info["status"] in ("UNREACHABLE", "PARTIALLY_REACHABLE"):
            info["remap_candidates"] = remap_candidates(entry, available, catalog, label_books)
        info["trusted"] = info["status"] in TRUSTED_STATUSES and not info["flags"]
        info["corpus"] = entry["corpus"]
        info["query_type"] = entry.get("group") or (scoring.classify_book_query(entry["question"])
                                                    if entry["corpus"] == "BOOK_METADATA" else "INTERNAL_DOC")
        cases[entry["id"]] = info
    return {"cases": cases, "summary": summarize(cases)}


def summarize(cases: dict) -> dict:
    summary: dict = {}
    for info in cases.values():
        bucket = summary.setdefault(info["corpus"], {"total": 0, "trusted": 0, "by_status": {}, "by_flag": {},
                                                     "by_query_type": {}})
        bucket["total"] += 1
        bucket["trusted"] += int(info["trusted"])
        bucket["by_status"][info["status"]] = bucket["by_status"].get(info["status"], 0) + 1
        for flag in info["flags"]:
            bucket["by_flag"][flag] = bucket["by_flag"].get(flag, 0) + 1
        kind = "no_answer" if info["status"] in ("NO_ANSWER", "STALE_NO_ANSWER") else "answerable"
        qtype = bucket["by_query_type"].setdefault(info["query_type"], {"answerable": 0, "no_answer": 0, "trusted": 0})
        qtype[kind] += 1
        qtype["trusted"] += int(info["trusted"])
    return summary


def trusted_results(results: list[dict], cases: dict) -> list[dict]:
    """Eval results restricted to trusted cases; a partially reachable case keeps only
    its reachable expected ids (the missing book cannot be retrieved by any method)."""
    out = []
    for result in results:
        info = cases.get(result["id"])
        if info and info["trusted"]:
            out.append({**result, "expected_ids": info["reachable_ids"]} if result["expected_ids"] else result)
    return out


# ── Benchmark manifest ───────────────────────────────────────────────────────

def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: str) -> str:
    with open(path, "rb") as handle:
        return _sha256_bytes(handle.read())


def corpus_version(corpus_dir: str = CORPUS_DIR) -> dict:
    files = sorted(name for name in os.listdir(corpus_dir) if name.endswith(".md"))
    digest = hashlib.sha256()
    for name in files:
        digest.update(name.encode("utf-8") + b"\0")
        with open(os.path.join(corpus_dir, name), "rb") as handle:
            digest.update(handle.read() + b"\0")
    return {"documents": len(files), "sha256": digest.hexdigest()}


def catalog_identity(books: list[dict]) -> dict:
    """Identity of the evaluated catalog: same ids + same indexed text = same hash."""
    keyed = sorted((str(b.get("id")), str(b.get("updated_at") or ""), str(b.get("title") or ""),
                    str(b.get("author") or ""), str(b.get("isbn") or ""), str(b.get("description") or ""),
                    str(b.get("summary_vi") or "")) for b in books if isinstance(b, dict))
    return {"books": len(keyed),
            "sha256": _sha256_bytes(json.dumps(keyed, ensure_ascii=False).encode("utf-8"))}


def git_state(repo_dir: str = SERVICE_DIR) -> dict:
    def run(*args: str) -> str:
        try:
            return subprocess.run(["git", *args], cwd=repo_dir, capture_output=True, text=True,
                                  timeout=10).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return ""
    sha = run("rev-parse", "HEAD") or os.getenv("GIT_SHA", "")
    dirty = run("status", "--porcelain", "--", ".")
    return {"commit": sha or None, "ai_service_dirty": bool(dirty) if sha else None}


def build_manifest(dataset_path: str, books: list[dict], embedding_identity: str, config: dict,
                   corpus_dir: str = CORPUS_DIR) -> dict:
    model, _, dims = str(embedding_identity).rpartition("@")
    dataset = load_dataset(dataset_path)
    return {
        "manifest_version": 1,
        "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset": {"file": os.path.basename(dataset_path), "cases": len(dataset),
                    "sha256": file_sha256(dataset_path)},
        "review_file_sha256": file_sha256(REVIEW_PATH) if os.path.exists(REVIEW_PATH) else None,
        "catalog": catalog_identity(books),
        "corpus": corpus_version(corpus_dir),
        "embedding": {"model": model or embedding_identity, "dimensions": int(dims) if dims.isdigit() else None},
        "git": git_state(),
        "config": config,
    }


# ── CLI ──────────────────────────────────────────────────────────────────────

def render_report(dataset_name: str, catalog_label: str, result: dict, structural_errors: list[str]) -> str:
    lines = [f"# RAG dataset integrity — {dataset_name} vs {catalog_label}", "",
             f"Structural errors: {len(structural_errors)}", *[f"- {e}" for e in structural_errors], ""]
    for corpus, s in result["summary"].items():
        lines += [f"## {corpus}: {s['total']} case, trusted {s['trusted']}", "",
                  "| status | case |", "|---|---|", *[f"| {k} | {v} |" for k, v in sorted(s["by_status"].items())], "",
                  "Flags: " + (", ".join(f"{k} {v}" for k, v in sorted(s["by_flag"].items())) or "none"), "",
                  "| query type | answerable | no-answer | trusted |", "|---|---|---|---|",
                  *[f"| {k} | {v['answerable']} | {v['no_answer']} | {v['trusted']} |"
                    for k, v in sorted(s["by_query_type"].items())], ""]
    lines += ["## Untrusted cases", "", "| case | status | flags | detail / remap candidates (need human review) |",
              "|---|---|---|---|"]
    for case_id, info in result["cases"].items():
        if info["trusted"]:
            continue
        detail = info.get("detail") or (info.get("review") or {}).get("reason", "")
        remaps = "; ".join(f"{c['missing'][:8]} `{c['missing_title']}` -> {c['candidate']} `{c['candidate_title']}` "
                           f"({c['match']})" for c in info.get("remap_candidates", []))
        lines.append(f"| `{case_id}` | {info['status']} | {', '.join(info['flags']) or '-'} | "
                     f"{' / '.join(p for p in (detail, remaps) if p) or '-'} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dataset", default=DATASET_PATH)
    parser.add_argument("--catalog", help="catalog JSON (list of books) to check reachability against; "
                                          "default: rag_catalog_snapshot_20261115.json")
    parser.add_argument("--report", action="store_true", help="also write reports/rag_integrity_<ts>.md/json")
    args = parser.parse_args()

    dataset = load_dataset(args.dataset)
    catalog_path = args.catalog or os.path.join(EVAL_DIR, "rag_catalog_snapshot_20261115.json")
    catalog = load_json(catalog_path)
    label_books = label_snapshot_books()
    errors = validate_structure(dataset, corpus_doc_ids(), set(label_books))
    review = load_json(REVIEW_PATH) if os.path.exists(REVIEW_PATH) else None
    result = audit(dataset, catalog, review=review, label_books=label_books)
    report = render_report(os.path.basename(args.dataset), os.path.basename(catalog_path), result, errors)
    print(report)
    if args.report:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        base = os.path.join(EVAL_DIR, "reports", f"rag_integrity_{stamp}")
        with open(base + ".md", "w", encoding="utf-8") as handle:
            handle.write(report)
        with open(base + ".json", "w", encoding="utf-8") as handle:
            json.dump({"dataset": os.path.basename(args.dataset), "catalog": catalog_identity(catalog),
                       "structural_errors": errors, **result}, handle, ensure_ascii=False, indent=1)
        print(f"Report: {base}.md")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
