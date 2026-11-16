"""Real library loans (Mendeley 10.17632/6rd45bvxjy.1, CC BY 4.0) -> the events file
eval_recommendation_v2.py reads, also read by analytics-service eval/real-forecast.js.

    python eval/real_library_loans.py research-inputs/library-loans-mendeley/dataset_univLib.csv --library univ
    python eval/real_library_loans.py research-inputs/library-loans-mendeley/datasetPublicLib.csv --library public

Ibrahim, Heryadi, Qomariyah, Budiharto (2026), "University and Public Library Recommendation
Dataset for Sparse and Cold-Start Research", Mendeley Data. Research/education use only.

Only loan columns are read (member, copy, title, author, DDC, borrow/return dates); the
demographic columns (birth date/place, gender, GPA, ...) never leave the CSV. Output goes
next to the CSV under derived/ - git-ignored, it still holds per-reader histories.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

DOI = "10.17632/6rd45bvxjy.1"
LIBRARIES = {
    # title key: the public file has a bibliographic id; the university file's ISBNs were
    # mangled by a spreadsheet (9,78112E+12), so its key is normalized title + first author
    "univ": {"name": "Binus University library (Jakarta)", "formats": ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S")},
    "public": {"name": "Indonesian public library system", "formats": ("%d/%m/%y",)},
}
_SPACE = re.compile(r"\s+")
_ROLE = re.compile(r"\s*\([^)]*\)")
_DDC = re.compile(r"^\s*(\d{2})\d")


def _clean(value) -> str:
    return _SPACE.sub(" ", str(value or "")).strip()


def _key_text(value) -> str:
    return re.sub(r"[^0-9a-z]+", " ", _clean(value).lower()).strip()


def first_author(raw) -> str:
    return _clean(_ROLE.sub("", _clean(raw).split(";")[0])).strip(" ,.")


def ddc_division(raw) -> str:
    """'614.42 [23]' -> 'DDC 610' (one of ~100 divisions); unparseable -> 'DDC unknown'."""
    match = _DDC.match(str(raw or ""))
    return f"DDC {match.group(1)}0" if match else "DDC unknown"


def parse_date(raw, formats) -> datetime | None:
    text = _clean(raw)
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _iso(t: datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def title_key(row: dict, library: str) -> str:
    if library == "public" and _clean(row.get("BIBID")):
        return "b:" + _clean(row["BIBID"])
    return "t:" + _key_text(row.get("Book Title")) + "|" + _key_text(first_author(row.get("Author")))


def sampled_readers(rows: list[dict], n: int | None, salt: str = DOI) -> set[str] | None:
    """The n readers with the smallest sha256(salt + member id): a fixed, seed-free sample that keeps
    every sampled reader's full history (a branch/collection filter would cut histories apart)."""
    if not n:
        return None
    members = sorted({_clean(r.get("Membership Number")) for r in rows} - {""},
                     key=lambda m: hashlib.sha256((salt + m).encode()).hexdigest())
    return set(members[:n])


def convert(rows, library: str, source: dict, sample_readers: int | None = None) -> dict:
    formats = LIBRARIES[library]["formats"]
    rows = list(rows)
    keep = sampled_readers(rows, sample_readers)
    seen, events, books, skipped = set(), [], {}, {"no_borrow_date": 0, "duplicate": 0, "no_member_or_copy": 0}
    for row in rows:
        user, copy = _clean(row.get("Membership Number")), _clean(row.get("Book ID Number"))
        if not user or not copy:
            skipped["no_member_or_copy"] += 1
            continue
        if keep is not None and user not in keep:
            continue
        at = parse_date(row.get("Borrow Date"), formats)
        if at is None:
            skipped["no_borrow_date"] += 1
            continue
        if (user, copy, at) in seen:
            skipped["duplicate"] += 1
            continue
        seen.add((user, copy, at))
        until = parse_date(row.get("Return Date"), formats)
        key = title_key(row, library)
        book = books.setdefault(key, {"id": key, "title": _clean(row.get("Book Title")), "author": first_author(row.get("Author")),
                                      "category": ddc_division(row.get("DDC Number")), "variant_ids": set(), "is_active": True})
        book["variant_ids"].add("c:" + copy)
        events.append({"kind": "LOAN", "user": "u:" + user, "book_id": key, "variant_id": "c:" + copy,
                       "at": _iso(at), "until": _iso(until) if until and until >= at else None})
    events.sort(key=lambda e: (e["at"], e["user"], e["book_id"]))
    catalog = [{**b, "variant_ids": sorted(b["variant_ids"])} for _, b in sorted(books.items())]
    return {
        "synthetic": False,
        "real_source": {**source, "library": LIBRARIES[library]["name"], "doi": DOI, "license": "CC BY 4.0",
                        "use": "research and education only", "skipped_rows": skipped,
                        "reader_sample": {"readers": sample_readers, "rule": "smallest sha256(doi + member id)"} if keep is not None else None},
        "window_start": events[0]["at"] if events else None,
        "window_end": events[-1]["at"] if events else None,
        "customers": sorted({e["user"] for e in events}),
        "catalog": catalog,
        # every copy that ever appears is one physical item; copies never borrowed are unknown
        "copies": {vid: 1 for b in catalog for vid in b["variant_ids"]},
        "events": events,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("--library", choices=sorted(LIBRARIES), required=True)
    ap.add_argument("--out")
    ap.add_argument("--sample-readers", type=int, help="keep only N readers (full histories) to bound the eval's runtime")
    args = ap.parse_args(argv)
    with open(args.csv, "rb") as handle:
        sha = hashlib.sha256(handle.read()).hexdigest()
    with open(args.csv, encoding="utf-8-sig", newline="") as handle:
        data = convert(csv.DictReader(handle, delimiter=";"), args.library,
                       {"file": os.path.basename(args.csv), "sha256": sha}, args.sample_readers)
    name = args.library + (f"_sample{args.sample_readers}" if args.sample_readers else "")
    out = args.out or os.path.join(os.path.dirname(os.path.abspath(args.csv)), "derived", f"{name}_events.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)
    print(f"[real-loans] {args.library}: {len(data['events'])} loans, {len(data['customers'])} readers, "
          f"{len(data['catalog'])} titles, skipped {data['real_source']['skipped_rows']} -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
