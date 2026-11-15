"""Assemble manifest/annotations.csv (input of build_dataset.py) from
(1) the bibliographic metadata gathered at selection time (selection.csv:
    Wikidata label / author / year, or the seed record), and
(2) the annotator's visual-review decisions (manifest/manual_annotations.csv:
    one row per asset that needed a decision or override — exclusion, role,
    identity for Vietnamese/Track-A files, legibility, condition).

A manual row always wins over selection metadata. Assets without a manual
row keep the selection role and default attributes (scan / title visible).
"""
from __future__ import annotations

from common import DATASET_DIR
from dataset_loader import read_csv, write_csv

FIELDS = ["asset_id", "decision", "book_key", "edition_key", "relation_to_gallery", "title", "author", "publisher",
          "edition_year", "work_year", "language", "language_group", "script", "category", "isbn13", "isbn_status",
          "image_condition", "title_visible", "exclusion_reason", "evidence_note", "wikidata_qid", "seed_record_id"]


def main() -> None:
    selection = {r["asset_id"]: r for r in read_csv(DATASET_DIR / "manifest" / "selection.csv")}
    manual = {r["asset_id"]: r for r in read_csv(DATASET_DIR / "manifest" / "manual_annotations.csv")}
    manifest = {r["asset_id"]: r for r in read_csv(DATASET_DIR / "manifest" / "dataset_manifest.csv")}
    rows = []
    for asset_id, sel in selection.items():
        if asset_id not in manifest:
            continue
        m = manual.get(asset_id, {})
        role = sel["role"]
        decision = m.get("decision") or {"gallery": "gallery", "out_of_catalog": "out_of_catalog"}.get(role, "exclude")
        default_key = sel.get("wikidata_qid") or asset_id
        row = {
            "asset_id": asset_id, "decision": decision,
            "book_key": m.get("book_key") or default_key, "edition_key": m.get("edition_key") or "E1",
            "relation_to_gallery": m.get("relation_to_gallery", ""),
            "title": m.get("title") or sel.get("candidate_title", ""), "author": m.get("author") or sel.get("candidate_author", ""),
            "publisher": m.get("publisher", ""), "edition_year": m.get("edition_year") or sel.get("candidate_year", ""),
            "work_year": m.get("work_year") or sel.get("candidate_year", ""),
            "language": m.get("language") or ("vi" if sel["language_group"] == "VIETNAMESE" else "en"),
            "language_group": ("INTERNATIONAL" if (m.get("language") or "vi") != "vi" else sel["language_group"]),
            "script": m.get("script") or "Latin", "category": "",
            "isbn13": m.get("isbn13", ""), "isbn_status": m.get("isbn_status") or "NOT_ASSIGNED_PRE_ISBN",
            "image_condition": m.get("image_condition") or "scan", "title_visible": m.get("title_visible") or "yes",
            "exclusion_reason": m.get("exclusion_reason", "") if decision == "exclude" else "",
            "evidence_note": "; ".join(filter(None, [
                f"Wikidata {sel['wikidata_qid']} (label/P50/P577)" if sel.get("wikidata_qid") else "",
                f"seed {sel['seed_record_id']}" if sel.get("seed_record_id") else "",
                m.get("note", "")])),
            "wikidata_qid": sel.get("wikidata_qid", ""), "seed_record_id": sel.get("seed_record_id", ""),
        }
        if manifest[asset_id].get("status") == "EXCLUDED" and decision != "exclude":
            row["decision"], row["exclusion_reason"] = "exclude", manifest[asset_id].get("exclusion_reason", "")
        rows.append(row)
    write_csv(DATASET_DIR / "manifest" / "annotations.csv", rows, FIELDS)
    print(f"annotations={len(rows)} manual={len(manual)}")


if __name__ == "__main__":
    main()
