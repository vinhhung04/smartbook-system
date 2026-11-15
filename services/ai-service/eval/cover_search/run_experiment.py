"""Experiment runner (E1-E6). Resumable, append-only, one run directory per run id.

    python run_experiment.py --run-id E2_clip_test --methods clip_only --split test
    python run_experiment.py --run-id PILOT --methods ocr_only,hybrid --split dev \
        --ocr-mode live --max-live-ocr 5 --limit 5

Outputs (runs/<run_id>/):
    run_manifest.json   config, production parameters, git sha, dataset hashes,
                        versions, API usage totals, timestamps
    predictions.jsonl   one line per (query, method): full ranked response,
                        ground truth, rank, outcome, failure flags, timings
Existing lines are never rewritten; a rerun skips (query, method) pairs that
already have a line (resume after interruption).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import time

from common import RUNS_DIR, has_api_key
import harness  # noqa: E402  (sets up the environment on import)
from dataset_loader import catalog_as_api_books, load_dataset
from retrieval_metrics import rank_of

CACHE_DIR = RUNS_DIR / "_cache"


def _git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=harness.AI_SERVICE_DIR, capture_output=True, text=True, timeout=30).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def _file_sha(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ""


def classify(record: dict, query: dict) -> tuple[str, list[str]]:
    flags = []
    vision = record.get("vision")
    if vision:
        outcome = vision.get("outcome")
        if outcome == "timeout":
            flags.append("TIMEOUT")
        elif outcome == "invalid_json":
            flags.append("MODEL_FAILURE_OCR_INVALID_JSON")
        elif outcome in ("api_error", "budget_exhausted"):
            flags.append("API_FAILURE")
    if record.get("clip_failed"):
        flags.append("MODEL_FAILURE_CLIP")
    if record.get("endpoint_error"):
        flags.append("ENDPOINT_ERROR")
    response = record.get("response")
    answered = bool(response and response["match_found"])
    if query["expected_outcome"] == "NO_MATCH":
        return ("FALSE_ACCEPT" if answered else "CORRECT_REJECTION"), flags
    rank = record.get("rank")
    if rank == 1:
        return "CORRECT_TOP1", flags
    if rank is not None:
        return "CORRECT_TOP5", flags
    return ("INCORRECT" if answered else "NO_RESULT"), flags


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--methods", default="clip_only")
    parser.add_argument("--tracks", default="A,B,OOC")
    parser.add_argument("--split", default="test", choices=["dev", "test", "all"])
    parser.add_argument("--ocr-mode", default="replay", choices=["replay", "live"])
    parser.add_argument("--max-live-ocr", type=int, default=0,
                        help="hard cap on paid vision calls in this run (0 = none allowed)")
    parser.add_argument("--max-cost-usd", type=float, default=None,
                        help="hard cap on CUMULATIVE provider-reported vision cost across all runs (user-approved: 1.0)")
    parser.add_argument("--limit", type=int, default=0, help="first N queries only (pilot)")
    parser.add_argument("--query-ids", default="", help="comma-separated explicit query ids")
    parser.add_argument("--keyword-store", default="pg_emulation", choices=["pg_emulation", "inmemory_repo"],
                        help="keyword branch of the OCR text ranking (protocol v1.2: pg_emulation)")
    parser.add_argument("--clip-diagnostic", action="store_true", help="also store the un-gated CLIP ranking")
    args = parser.parse_args()

    methods = [m for m in args.methods.split(",") if m]
    tracks = set(args.tracks.split(","))
    needs_text = any(m in ("ocr_only", "hybrid") for m in methods)
    if needs_text and not has_api_key():
        sys.exit("OPENROUTER_API_KEY missing: OCR-based methods cannot run (no simulated responses are used).")

    run_dir = RUNS_DIR / args.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    predictions_path = run_dir / "predictions.jsonl"
    done = set()
    if predictions_path.exists():
        for line in predictions_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                done.add((row["query_id"], row["method"]))

    dataset = load_dataset()
    catalog_rows = dataset.included_catalog()
    books = catalog_as_api_books(catalog_rows)

    def load_image(asset_id: str) -> bytes:
        return dataset.asset_path(asset_id).read_bytes()

    gallery, gallery_info = harness.build_gallery(catalog_rows, load_image, CACHE_DIR / "gallery_clip_embeddings.json")

    embed_cache = None
    index_info = None
    if needs_text:
        embed_cache = harness._load_embed_cache(CACHE_DIR / "text_embeddings.json")
        embed_cache.install()
        index_info = harness.run_async(harness.index_catalog_text(books, embed_cache, args.keyword_store))
        embed_cache.save()

    ocr_cache = harness.OcrCache(CACHE_DIR / "ocr_responses.jsonl")
    spent_before = sum((e.get("usage") or {}).get("cost_usd") or 0.0 for e in ocr_cache.entries.values())
    vision = harness.RecordingVisionProvider(harness.llm_provider.VISION_MODEL, ocr_cache, args.ocr_mode,
                                             budget_calls=args.max_live_ocr, budget_usd=args.max_cost_usd,
                                             spent_usd_before=spent_before)
    runner = harness.Harness(books, gallery, vision)

    queries = [q for q in dataset.included_queries() if q["query_track"] in tracks]
    if args.split != "all":
        queries = [q for q in queries if q["split"] == args.split]
    if args.query_ids:
        wanted = args.query_ids.split(",")
        queries = [q for q in queries if q["query_id"] in wanted]
    if args.limit:
        queries = queries[: args.limit]

    manifest = {
        "run_id": args.run_id, "argv": sys.argv[1:],
        "started_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "git_head": _git("rev-parse", "HEAD"), "git_branch": _git("branch", "--show-current"),
        "production_files_dirty": _git("status", "--porcelain", "--", "routes_cover_search.py", "cover_embeddings.py",
                                       "cover_gallery.py", "assistant_tools.py", "llm_provider.py", "embeddings.py",
                                       "vector_store.py", "fusion.py", "ingestion.py", "book_index.py"),
        "python": sys.version, "platform": platform.platform(),
        "production_config": harness.production_config(), "keyword_store": args.keyword_store,
        "dataset_files_sha256": {name: _file_sha(dataset.root / name) for name in (
            "metadata/catalog_books.csv", "manifest/dataset_manifest.csv", "ground_truth/ground_truth.csv",
            "rights/rights_audit.csv")},
        "catalog_books": len(books), "catalog_editions": len(catalog_rows),
        "gallery": gallery_info, "text_index": index_info,
        "queries_selected": len(queries), "methods": methods, "ocr_mode": args.ocr_mode,
        "max_live_ocr": args.max_live_ocr,
    }
    try:
        import torch
        import transformers
        manifest["versions"] = {"torch": torch.__version__, "transformers": transformers.__version__}
    except Exception:  # noqa: BLE001
        pass

    skipped_not_run = 0
    with open(predictions_path, "a", encoding="utf-8") as out:
        for index, query in enumerate(queries, start=1):
            image = load_image(query["query_asset_id"])
            asset = dataset.assets_by_id[query["query_asset_id"]]
            for method in methods:
                if (query["query_id"], method) in done:
                    continue
                if method in ("ocr_only", "hybrid") and args.ocr_mode == "replay":
                    key = harness.OcrCache.key(image, harness.llm_provider.VISION_MODEL, harness.rcs.PROMPT_COVER_OCR)
                    if key not in ocr_cache.entries:
                        skipped_not_run += 1
                        continue
                record = harness.run_async(runner.run(method, image, asset["local_path"].rsplit("/", 1)[-1],
                                                      asset.get("mime") or "image/jpeg"))
                if vision.last and vision.last.get("outcome") == "budget_exhausted":
                    print("budget cap reached - stopping before any further paid call", file=sys.stderr)
                    break
                ids = [c["id"] for c in (record["response"] or {}).get("candidates", [])]
                record["rank"] = rank_of(ids, query["ground_truth_book_id"]) if query["expected_outcome"] == "MATCH" else None
                top = (record["response"] or {}).get("candidates") or [None]
                record["top1_edition_correct"] = bool(top[0] and top[0]["variant_id"] == query["ground_truth_edition_id"])
                if args.clip_diagnostic and method == "clip_only":
                    vector = harness.cover_embeddings.embed_image(image)
                    record["diagnostic_raw_clip"] = harness.raw_clip_ranking(vector, gallery)[:10] if vector else None
                outcome, flags = classify(record, query)
                record.update(outcome=outcome, failure_flags=flags, query_id=query["query_id"],
                              query_track=query["query_track"], ground_truth_book_id=query["ground_truth_book_id"],
                              ground_truth_edition_id=query["ground_truth_edition_id"],
                              expected_outcome=query["expected_outcome"], recorded_at_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()
            else:
                if index % 25 == 0:
                    print(f"{index}/{len(queries)}", file=sys.stderr)
                continue
            break

    if embed_cache is not None:
        embed_cache.save()
        manifest["text_embed_cache_stats"] = dict(embed_cache.stats)
    from metrics_cost import read_cost_counters
    manifest["api_usage_this_process"] = {"live_vision_calls": vision.live_calls, **read_cost_counters()}
    manifest["vision_cost_usd_cumulative_all_runs"] = vision.spent_usd
    manifest["max_cost_usd"] = args.max_cost_usd
    manifest["queries_skipped_ocr_not_recorded"] = skipped_not_run
    manifest["finished_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    (run_dir / f"run_manifest_{time.strftime('%Y%m%dT%H%M%S')}.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("run_id", "queries_selected", "gallery", "api_usage_this_process")}, default=str))


if __name__ == "__main__":
    main()
