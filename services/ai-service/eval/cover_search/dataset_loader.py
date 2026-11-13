"""Load the cover-search research dataset (CSV files under
research-inputs/cover-search-dataset/) into plain dicts.

Files (see docs/research/cover-search/DATA_DICTIONARY.md):
- metadata/catalog_books.csv      one row per catalog edition (= gallery entry)
- manifest/dataset_manifest.csv   one row per image asset (originals + derived)
- ground_truth/ground_truth.csv   one row per evaluation query
- rights/rights_audit.csv         one row per original image asset
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path

from common import DATASET_DIR


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        fieldnames = list(dict.fromkeys(key for row in rows for key in row.keys()))
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


@dataclass
class Dataset:
    root: Path
    catalog: list[dict] = field(default_factory=list)
    assets: list[dict] = field(default_factory=list)
    queries: list[dict] = field(default_factory=list)
    rights: list[dict] = field(default_factory=list)

    @property
    def assets_by_id(self) -> dict[str, dict]:
        return {row["asset_id"]: row for row in self.assets}

    @property
    def catalog_by_edition(self) -> dict[str, dict]:
        return {row["edition_id"]: row for row in self.catalog}

    def asset_path(self, asset_id: str) -> Path:
        return self.root / self.assets_by_id[asset_id]["local_path"]

    def included_catalog(self) -> list[dict]:
        return [row for row in self.catalog if row.get("status") == "INCLUDED"]

    def included_queries(self, track: str | None = None) -> list[dict]:
        rows = [row for row in self.queries if row.get("status") == "INCLUDED"]
        if track:
            rows = [row for row in rows if row["query_track"] == track]
        return rows


def load_dataset(root: Path = DATASET_DIR) -> Dataset:
    return Dataset(
        root=root,
        catalog=read_csv(root / "metadata" / "catalog_books.csv"),
        assets=read_csv(root / "manifest" / "dataset_manifest.csv"),
        queries=read_csv(root / "ground_truth" / "ground_truth.csv"),
        rights=read_csv(root / "rights" / "rights_audit.csv"),
    )


def catalog_as_api_books(catalog_rows: list[dict]) -> list[dict]:
    """Shape catalog rows like GET /api/books items, the input
    find_book_by_cover() and _score_and_rank_books() expect: one dict per
    BOOK (work-level catalog entry) with a default variant id. Several
    editions of one book collapse to one entry, as in production."""
    books: dict[str, dict] = {}
    for row in catalog_rows:
        book_id = row["book_id"]
        if book_id in books:
            continue
        books[book_id] = {
            "id": book_id,
            "variant_id": row["edition_id"],
            "title": row["title"],
            "author": row["author"],
            "category": row.get("category", ""),
            "isbn": row.get("isbn13", "") if row.get("isbn_status") == "VALID" else "",
            "publisher": row.get("publisher", ""),
            "quantity": 1,
            "description": "",
            "summary_vi": "",
        }
    return list(books.values())
