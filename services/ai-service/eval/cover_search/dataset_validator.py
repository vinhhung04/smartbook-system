"""E0 — dataset and ground-truth validation. Writes
research-inputs/cover-search-dataset/reports/validation_results.json and
docs/research/cover-search/DATASET_VALIDATION_REPORT.md, plus
dataset_hashes.sha256. Exit code 1 if any BLOCKING check fails.

    python dataset_validator.py [--check-urls]

--check-urls re-queries the Commons API for every source page (polite, batched)
to detect sources that disappeared since collection.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import sys
import time

from common import DATASET_DIR, DOCS_DIR
from dataset_loader import load_dataset


def isbn13_valid(value: str) -> bool:
    digits = value.replace("-", "").replace(" ", "")
    if len(digits) != 13 or not digits.isdigit():
        return False
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(digits[:12]))
    return (10 - total % 10) % 10 == int(digits[12])


ISBN_STATUSES = {"VALID", "NOT_ASSIGNED_PRE_ISBN", "NOT_FOUND", "UNKNOWN", "UNVERIFIED"}
PERMISSION_STATUSES = {"VERIFIED_OPEN_LICENSE", "VERIFIED_PUBLIC_DOMAIN", "SOURCE_CLAIM_ONLY",
                       "RESTRICTED", "UNKNOWN", "EXCLUDED"}
MIN_SIDE_PX = 200


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def validate(check_urls: bool = False) -> dict:
    from PIL import Image

    ds = load_dataset()
    issues: list[dict] = []

    def issue(check: str, severity: str, item: str, detail: str) -> None:
        issues.append({"check": check, "severity": severity, "item": item, "detail": detail})

    assets = ds.assets
    by_id = {a["asset_id"]: a for a in assets}
    originals = [a for a in assets if a["role"] != "query_perturbation"]
    included_originals = [a for a in originals if a["status"] == "INCLUDED"]

    # duplicate records
    for kind, rows, key in (("catalog edition", ds.catalog, "edition_id"), ("asset", assets, "asset_id"),
                            ("query", ds.queries, "query_id")):
        counts = collections.Counter(row[key] for row in rows)
        for value, count in counts.items():
            if count > 1:
                issue("duplicate_record", "BLOCKING", value, f"{kind} id appears {count} times")

    # files: exist, decodable, hash matches, resolution
    for asset in [a for a in assets if a["status"] == "INCLUDED"]:
        path = DATASET_DIR / asset["local_path"]
        if not asset.get("local_path") or not path.exists():
            issue("invalid_image_file", "BLOCKING", asset["asset_id"], "file missing")
            continue
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != asset["sha256"]:
            issue("hash_mismatch", "BLOCKING", asset["asset_id"], "sha256 differs from manifest (file changed)")
        try:
            with Image.open(io.BytesIO(data)) as image:
                image.load()
                width, height = image.size
        except Exception as exc:  # noqa: BLE001
            issue("invalid_image_file", "BLOCKING", asset["asset_id"], f"cannot decode: {type(exc).__name__}")
            continue
        if min(width, height) < MIN_SIDE_PX and asset["role"] != "query_perturbation":
            issue("low_resolution", "WARNING", asset["asset_id"], f"{width}x{height} (< {MIN_SIDE_PX}px short side)")

    # duplicate images among included originals: exact (sha256) and near (pHash)
    by_sha = collections.defaultdict(list)
    for asset in included_originals:
        by_sha[asset["sha256"]].append(asset["asset_id"])
    for sha, ids in by_sha.items():
        if len(ids) > 1:
            issue("duplicate_image_exact", "BLOCKING", ",".join(ids), f"identical bytes sha256={sha[:12]}")
    near_pairs = []
    for i, a in enumerate(included_originals):
        for b in included_originals[i + 1:]:
            if a.get("phash") and b.get("phash") and hamming(a["phash"], b["phash"]) <= 6:
                same_book = a.get("book_id") and a.get("book_id") == b.get("book_id")
                near_pairs.append((a["asset_id"], b["asset_id"], hamming(a["phash"], b["phash"]), same_book))
                if not same_book:
                    issue("near_duplicate_image_cross_book", "BLOCKING", f"{a['asset_id']},{b['asset_id']}",
                          f"pHash distance {hamming(a['phash'], b['phash'])} but different books")
                elif {a["role"], b["role"]} == {"gallery", "query_independent"}:
                    issue("near_duplicate_query_gallery", "WARNING", f"{a['asset_id']},{b['asset_id']}",
                          f"pHash distance {hamming(a['phash'], b['phash'])}: 'independent' query may be a re-encode of the gallery scan")

    # catalog / ground truth fields
    for row in ds.catalog:
        if not row.get("title", "").strip():
            issue("missing_title", "BLOCKING", row["edition_id"], "empty title")
        if row.get("isbn_status") not in ISBN_STATUSES:
            issue("isbn_status", "BLOCKING", row["edition_id"], f"unknown isbn_status {row.get('isbn_status')!r}")
        if row.get("isbn_status") == "VALID" and not isbn13_valid(row.get("isbn13", "")):
            issue("invalid_isbn_checksum", "BLOCKING", row["edition_id"], row.get("isbn13", ""))
        if row.get("isbn13") and row.get("isbn_status") != "VALID":
            issue("isbn_value_without_valid_status", "WARNING", row["edition_id"], row["isbn13"])
        gallery = by_id.get(row.get("gallery_asset_id", ""))
        if row["status"] == "INCLUDED" and (gallery is None or gallery["status"] != "INCLUDED"):
            issue("catalog_without_gallery_image", "BLOCKING", row["edition_id"], "no included gallery asset")
    editions_per_book = collections.defaultdict(set)
    for row in ds.catalog:
        editions_per_book[row["book_id"]].add((row["title"], row["author"]))
    for book_id, variants in editions_per_book.items():
        if len(variants) > 1:
            issue("edition_conflict", "WARNING", book_id, f"editions disagree on title/author: {sorted(variants)}")

    catalog_editions = {row["edition_id"]: row for row in ds.catalog if row["status"] == "INCLUDED"}
    for query in ds.included_queries():
        asset = by_id.get(query["query_asset_id"])
        if asset is None or asset["status"] != "INCLUDED":
            issue("query_asset_missing", "BLOCKING", query["query_id"], query["query_asset_id"])
        if query["expected_outcome"] == "MATCH":
            edition = catalog_editions.get(query["ground_truth_edition_id"])
            if edition is None and query.get("relation_to_gallery") != "different_cover_same_work":
                issue("missing_ground_truth", "BLOCKING", query["query_id"], "GT edition not in included catalog")
            if not any(r["book_id"] == query["ground_truth_book_id"] for r in catalog_editions.values()):
                issue("missing_ground_truth", "BLOCKING", query["query_id"], "GT book not in included catalog")
        elif query["ground_truth_book_id"] and any(r["book_id"] == query["ground_truth_book_id"] for r in catalog_editions.values()):
            issue("ooc_leak", "BLOCKING", query["query_id"], "out-of-catalog query's book IS in the catalog")
        if query.get("title_visible") == "no" and query["expected_outcome"] == "MATCH":
            issue("unreadable_cover", "INFO", query["query_id"], "title not visible; excluded from OCR-accuracy metrics")

    # rights
    rights = {r["asset_id"]: r for r in ds.rights}
    for asset in included_originals:
        r = rights.get(asset["asset_id"])
        if r is None:
            issue("missing_rights", "BLOCKING", asset["asset_id"], "no rights_audit row")
            continue
        if r.get("permission_status") not in PERMISSION_STATUSES:
            issue("missing_rights", "BLOCKING", asset["asset_id"], f"permission_status {r.get('permission_status')!r}")
        for field in ("source_page_url", "direct_image_url", "license_name", "retrieval_timestamp_utc"):
            if not r.get(field):
                issue("missing_rights_field", "BLOCKING", asset["asset_id"], field)

    if check_urls:
        import collect
        titles = [a["commons_file"] for a in included_originals if a.get("commons_file")]
        infos = collect.file_info(titles)
        for asset in included_originals:
            page = infos.get(asset.get("commons_file", ""))
            if not page or page.get("missing"):
                issue("broken_source_url", "BLOCKING", asset["asset_id"], asset.get("source_page_url", ""))

    # balance & summary
    included_catalog = [r for r in ds.catalog if r["status"] == "INCLUDED"]
    language = collections.Counter(r["language_group"] for r in included_catalog)
    tracks = collections.Counter(q["query_track"] for q in ds.included_queries())
    statuses = collections.Counter(r.get("permission_status") for r in ds.rights)
    excluded = [a for a in originals if a["status"] != "INCLUDED"]
    summary = {
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "catalog_books_included": len({r["book_id"] for r in included_catalog}),
        "catalog_editions_included": len(included_catalog),
        "language_groups": dict(language),
        "original_assets_total": len(originals),
        "original_assets_included": len(included_originals),
        "original_assets_excluded": len(excluded),
        "exclusion_reasons": dict(collections.Counter(a.get("exclusion_reason", "") for a in excluded)),
        "derived_assets": sum(1 for a in assets if a["role"] == "query_perturbation"),
        "queries_by_track": dict(tracks),
        "isbn_status": dict(collections.Counter(r["isbn_status"] for r in included_catalog)),
        "valid_isbn13": sum(1 for r in included_catalog if r["isbn_status"] == "VALID" and isbn13_valid(r["isbn13"])),
        "rights_permission_status": dict(statuses),
        "near_duplicate_pairs": [list(p) for p in near_pairs],
        "issues_by_severity": dict(collections.Counter(i["severity"] for i in issues)),
        "checks_run": ["duplicate_record", "invalid_image_file", "hash_mismatch", "low_resolution",
                       "duplicate_image_exact", "near_duplicate (pHash<=6)", "missing_title", "isbn_status",
                       "invalid_isbn_checksum", "catalog_without_gallery_image", "edition_conflict",
                       "missing_ground_truth", "ooc_leak", "unreadable_cover", "missing_rights",
                       "missing_rights_field"] + (["broken_source_url"] if check_urls else []),
    }
    return {"summary": summary, "issues": issues}


def write_hashes() -> int:
    ds = load_dataset()
    lines = [f"{a['sha256']}  {a['local_path']}" for a in ds.assets if a["status"] == "INCLUDED" and a.get("local_path")]
    for name in ("metadata/catalog_books.csv", "manifest/dataset_manifest.csv", "ground_truth/ground_truth.csv",
                 "rights/rights_audit.csv"):
        lines.append(f"{hashlib.sha256((DATASET_DIR / name).read_bytes()).hexdigest()}  {name}")
    (DATASET_DIR / "dataset_hashes.sha256").write_text("\n".join(sorted(lines)) + "\n", encoding="utf-8")
    return len(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-urls", action="store_true")
    args = parser.parse_args()
    result = validate(args.check_urls)
    result["summary"]["hash_lines"] = write_hashes()
    (DATASET_DIR / "reports").mkdir(exist_ok=True)
    (DATASET_DIR / "reports" / "validation_results.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    blocking = [i for i in result["issues"] if i["severity"] == "BLOCKING"]
    print(json.dumps(result["summary"], indent=2, ensure_ascii=False))
    print(f"BLOCKING issues: {len(blocking)}")
    for item in blocking[:50]:
        print("  ", item)
    sys.exit(1 if blocking else 0)


if __name__ == "__main__":
    main()
