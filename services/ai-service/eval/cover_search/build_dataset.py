"""Turn the annotator's decisions (manifest/annotations.csv) into the benchmark
files: metadata/catalog_books.csv, ground_truth/ground_truth.csv, and role /
status / identity columns of manifest/dataset_manifest.csv.

Run order:  collect.py -> (annotate) -> build_dataset.py -> perturb.py -> build_dataset.py
(the second build adds the Track B queries that perturb.py created).

Nothing is deleted: excluded assets stay in the manifest with their reason.
"""
from __future__ import annotations

import hashlib

from common import DATASET_DIR
from dataset_loader import read_csv, write_csv

DEV_FRACTION = 0.15


def _h(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main() -> None:
    annotations = {a["asset_id"]: a for a in read_csv(DATASET_DIR / "manifest" / "annotations.csv")}
    manifest_path = DATASET_DIR / "manifest" / "dataset_manifest.csv"
    assets = read_csv(manifest_path)
    by_id = {a["asset_id"]: a for a in assets}

    # ---- books: one per book_key that has an included gallery asset
    gallery = [a for a in annotations.values() if a["decision"] == "gallery"]
    # Stable ids: a book is named after its (first) gallery asset id, so adding
    # books later never renames existing ones; the dev/test split is a per-book
    # hash threshold, so it does not depend on how many books exist.
    prefix = {"G-EN": "SB-EN", "C-VN": "SB-VN", "C-EN": "SB-ENS", "C-MD": "SB-MD"}
    book_id_of: dict[str, str] = {}
    split_of: dict[str, str] = {}
    for a in sorted(gallery, key=lambda x: x["asset_id"]):
        if a["book_key"] in book_id_of:
            continue
        head = a["asset_id"][:4]
        book_id_of[a["book_key"]] = f"{prefix[head]}-{a['asset_id'][5:]}"
        split_of[a["book_key"]] = "dev" if int(_h("split|" + book_id_of[a["book_key"]])[:8], 16) / 0xFFFFFFFF < DEV_FRACTION else "test"

    edition_id_of: dict[tuple[str, str], str] = {}
    catalog = []
    for a in sorted(gallery, key=lambda x: (book_id_of[x["book_key"]], x["edition_key"])):
        book_id = book_id_of[a["book_key"]]
        ed_key = (a["book_key"], a["edition_key"])
        if ed_key in edition_id_of:
            raise SystemExit(f"two gallery images for one edition: {a['asset_id']}")
        edition_id_of[ed_key] = f"{book_id}-E{sum(1 for k in edition_id_of if k[0] == a['book_key']) + 1}"
        catalog.append({
            "book_id": book_id, "edition_id": edition_id_of[ed_key], "title": a["title"], "author": a["author"],
            "publisher": a["publisher"], "edition_year": a["edition_year"], "work_year": a["work_year"],
            "language": a["language"], "language_group": a["language_group"], "script": a["script"],
            "isbn13": a["isbn13"], "isbn_status": a["isbn_status"], "category": a["category"],
            "gallery_asset_id": a["asset_id"], "wikidata_qid": a.get("wikidata_qid", ""),
            "bibliographic_source": a["evidence_note"], "status": "INCLUDED", "split": split_of[a["book_key"]],
            "verification_status": "SINGLE_ANNOTATOR_SOURCE_AND_VISUAL", "seed_record_id": a.get("seed_record_id", ""),
        })
    catalog_by_edition = {(r["book_id"], r["edition_id"]): r for r in catalog}
    edition_of_key = {k: v for k, v in edition_id_of.items()}

    # ---- manifest identity / role / status for originals
    for asset_id, a in annotations.items():
        row = by_id.get(asset_id)
        if row is None:
            continue
        decision = a["decision"]
        role = {"gallery": "gallery", "query_independent": "query_independent",
                "out_of_catalog": "out_of_catalog"}.get(decision, row.get("role", ""))
        included = decision in ("gallery", "query_independent", "out_of_catalog") and row.get("status") != "EXCLUDED"
        book_id = book_id_of.get(a["book_key"], "") if decision in ("gallery", "query_independent") else ""
        edition_id = edition_of_key.get((a["book_key"], a["edition_key"]), "") if book_id else ""
        row.update({
            "role": role, "status": "INCLUDED" if included else ("EXCLUDED" if decision == "exclude" else row.get("status", "")),
            "exclusion_reason": a.get("exclusion_reason", "") if decision == "exclude" else row.get("exclusion_reason", ""),
            "book_id": book_id, "edition_id": edition_id,
            "relation_to_gallery": a.get("relation_to_gallery", "") if decision == "query_independent" else "",
            "image_condition": a.get("image_condition", ""), "title_visible": a.get("title_visible", ""),
            "query_type": {"gallery": "GALLERY_REFERENCE", "query_independent": "INDEPENDENT_ONLINE_IMAGE",
                           "out_of_catalog": "OUT_OF_CATALOG_ONLINE_IMAGE"}.get(decision, ""),
            "annotation_note": a.get("evidence_note", ""),
        })
    # derived rows inherit status from their parent
    for row in assets:
        if row.get("role") == "query_perturbation":
            parent = by_id.get(row["parent_asset_id"], {})
            row["status"] = "INCLUDED" if parent.get("status") == "INCLUDED" and parent.get("role") == "gallery" else "EXCLUDED"
            row["book_id"], row["edition_id"] = parent.get("book_id", ""), parent.get("edition_id", "")
            row["title_visible"] = parent.get("title_visible", "")
    write_csv(manifest_path, assets)

    # ---- ground truth
    rights = {r["asset_id"]: r for r in read_csv(DATASET_DIR / "rights" / "rights_audit.csv")}
    gallery_asset_of_edition = {r["edition_id"]: r["gallery_asset_id"] for r in catalog}
    first_edition_of_book = {}
    for r in catalog:
        first_edition_of_book.setdefault(r["book_id"], r)
    queries = []
    for row in assets:
        if row.get("status") != "INCLUDED" or row["role"] not in ("query_independent", "out_of_catalog", "query_perturbation"):
            continue
        track = {"query_independent": "A", "out_of_catalog": "OOC", "query_perturbation": "B"}[row["role"]]
        gt = None
        if track != "OOC":
            gt = next((r for r in catalog if r["edition_id"] == row["edition_id"]), None) or first_edition_of_book.get(row["book_id"])
        source = rights.get(row.get("parent_asset_id") or row["asset_id"], {})
        ann = annotations.get(row["asset_id"], {})
        queries.append({
            "query_id": f"q-{row['asset_id']}", "query_asset_id": row["asset_id"], "query_track": track,
            "expected_outcome": "NO_MATCH" if track == "OOC" else "MATCH",
            "ground_truth_book_id": gt["book_id"] if gt else "", "ground_truth_edition_id": row.get("edition_id", "") if gt else "",
            "gallery_image_id": gallery_asset_of_edition.get(row.get("edition_id", ""), ""),
            "title": gt["title"] if gt else ann.get("title", ""), "author": gt["author"] if gt else ann.get("author", ""),
            "publisher": gt["publisher"] if gt else "", "edition_year": gt["edition_year"] if gt else "",
            "isbn13": gt["isbn13"] if gt else "", "language": gt["language"] if gt else ann.get("language", ""),
            "language_group": gt["language_group"] if gt else ann.get("language_group", ""),
            "script": gt["script"] if gt else ann.get("script", ""),
            "relation_to_gallery": row.get("relation_to_gallery", "") or ("controlled_perturbation_of_gallery" if track == "B" else ""),
            "image_condition": row.get("image_condition", ""), "transform_name": row.get("transform_name", ""),
            "title_visible": row.get("title_visible", ""),
            "source_url": row.get("source_page_url", "") or source.get("source_page_url", ""),
            "image_source": row.get("source_platform", ""), "license": source.get("license_name", ""),
            "sha256": row.get("sha256", ""),
            "split": gt and next(r["split"] for r in catalog if r["book_id"] == gt["book_id"]) or "test",
            "verification_status": "SINGLE_ANNOTATOR_SOURCE_AND_VISUAL", "status": "INCLUDED",
        })
    # OOC split: deterministic hash so dev/test both have negatives
    for q in queries:
        if q["query_track"] == "OOC":
            q["split"] = "dev" if int(_h("split|" + q["query_asset_id"])[:8], 16) / 0xFFFFFFFF < DEV_FRACTION else "test"
    write_csv(DATASET_DIR / "metadata" / "catalog_books.csv", catalog)
    write_csv(DATASET_DIR / "ground_truth" / "ground_truth.csv", queries)
    print(f"books={len(book_id_of)} editions={len(catalog)} queries={len(queries)} "
          f"(A={sum(q['query_track']=='A' for q in queries)}, B={sum(q['query_track']=='B' for q in queries)}, "
          f"OOC={sum(q['query_track']=='OOC' for q in queries)})")


if __name__ == "__main__":
    main()
