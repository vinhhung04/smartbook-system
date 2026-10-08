"""Human annotation helper for the metadata-extraction evaluation dataset.

The 120-edition dataset in ai_labeled_dataset/ was labeled by an LLM
(labelProvenance = ai_generated_claude_not_human_annotated) and must not be
reported as a human-annotated gold set. This tool turns it into worksheets a
person can fill in (CSV, opens in Excel/LibreOffice), then builds a dataset
from the HUMAN answers only, in the format run_experiments.py reads.

    # 1. worksheet for annotator A (all editions) and an independent, stratified
    #    subset for annotator B (protocol: >= 24 double-annotated editions)
    python eval/metadata_intelligence/human_review.py export --out review_A.csv
    python eval/metadata_intelligence/human_review.py export --sample 24 --out review_B.csv
    # 2. each annotator fills human_status / human_value / annotator per row,
    #    following HUONG_DAN_GAN_NHAN.md (status: known | absent | not_applicable | unknown)
    # 3. build the dataset + agreement report. Disagreements between A and B are
    #    listed; a third person writes the final answers in an adjudication CSV
    #    (same columns) and the import is run again with --adjudication.
    python eval/metadata_intelligence/human_review.py import review_A.csv review_B.csv --adjudication adjudication.csv --out eval/metadata_intelligence/human_dataset.json
    # 4. B1-B5 on human labels
    python eval/metadata_intelligence/run_experiments.py --dataset eval/metadata_intelligence/human_dataset.json

Rows left without human_status are skipped (not counted as agreement).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATASET = os.path.join(HERE, "ai_labeled_dataset", "dataset.json")
FIELDS = ("title", "subtitle", "authors", "translator", "publisher", "publishedDate",
          "pageCount", "categories", "description", "isbn", "language")
LIST_FIELDS = {"authors", "translator", "categories"}
STATUSES = {"known", "absent", "not_applicable", "unknown"}
COLUMNS = ["editionId", "split", "languageGroup", "targetIsbn", "field", "ai_status", "ai_value",
           "source_values", "human_status", "human_value", "annotator", "notes"]
_SOURCE_KEYS = {"title": "title", "subtitle": "subtitle", "authors": "authors", "publisher": "publisher",
                "publishedDate": "publishedDate", "pageCount": "pageCount", "categories": "categories",
                "description": "description", "language": "language"}


def _norm(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " | ".join(_norm(item) for item in value)
    text = unicodedata.normalize("NFC", str(value)).strip().casefold()
    return " ".join(text.split())


def _cell(value) -> str:
    if value is None:
        return ""
    return " | ".join(str(v) for v in value) if isinstance(value, list) else str(value)


def _parse_value(field: str, raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    if field in LIST_FIELDS:
        return [part.strip() for part in raw.split("|") if part.strip()]
    if field == "pageCount":
        try:
            return int(raw)
        except ValueError:
            return raw
    return raw


def _source_values(edition: dict, field: str) -> str:
    """What each frozen source document says for this field - so the annotator
    sees the evidence next to the AI label instead of re-searching the web."""
    shown = []
    for doc in edition.get("documents") or []:
        payload = doc.get("payload")
        info = payload.get("volumeInfo") if isinstance(payload, dict) else None
        if not isinstance(info, dict):
            continue
        if field == "isbn":
            value = [i.get("identifier") for i in info.get("industryIdentifiers") or [] if i.get("type") == "ISBN_13"]
        else:
            value = info.get(_SOURCE_KEYS.get(field, ""))
        if value not in (None, "", []):
            shown.append(f"{doc.get('provider', '?')}: {_cell(value)[:300]}")
    return " || ".join(shown)


def stratified_sample(editions: list[dict], size: int) -> list[dict]:
    """Deterministic sample spread evenly over (split, languageGroup) strata,
    for the second annotator - the same editions every time it is run."""
    strata: dict[tuple, list[dict]] = {}
    for edition in editions:
        strata.setdefault((edition.get("split"), edition.get("languageGroup")), []).append(edition)
    for members in strata.values():
        members.sort(key=lambda e: hashlib.sha256(str(e.get("editionId")).encode("utf-8")).hexdigest())
    picked: list[dict] = []
    keys = sorted(strata, key=str)
    while len(picked) < min(size, len(editions)):
        for key in keys:
            if strata[key] and len(picked) < size:
                picked.append(strata[key].pop(0))
    return picked


def export_rows(dataset: dict, sample: int | None = None) -> list[dict]:
    editions = dataset.get("editions") or []
    if sample:
        editions = stratified_sample(list(editions), sample)
    rows = []
    for edition in editions:
        gold = (edition.get("editionGold") or {}).get("fields") or {}
        for field in FIELDS:
            label = gold.get(field) or {"status": "unknown"}
            rows.append({
                "editionId": edition.get("editionId"), "split": edition.get("split"),
                "languageGroup": edition.get("languageGroup"), "targetIsbn": edition.get("targetIsbn"),
                "field": field, "ai_status": label.get("status"), "ai_value": _cell(label.get("value")),
                "source_values": _source_values(edition, field),
                "human_status": "", "human_value": "", "annotator": "", "notes": "",
            })
    return rows


def write_csv(rows: list[dict], path: str) -> None:
    # utf-8-sig: Excel on Windows opens it with Vietnamese diacritics intact.
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _reviewed(rows: list[dict]) -> dict[tuple[str, str], dict]:
    out = {}
    for row in rows:
        status = (row.get("human_status") or "").strip()
        if not status:
            continue
        if status not in STATUSES:
            raise ValueError(f"{row.get('editionId')}/{row.get('field')}: human_status '{status}' "
                             f"must be one of {sorted(STATUSES)}")
        if status == "known" and not (row.get("human_value") or "").strip():
            raise ValueError(f"{row.get('editionId')}/{row.get('field')}: status known needs human_value")
        out[(row["editionId"], row["field"])] = row
    return out


def _same(a: dict, b_status: str, b_value: str) -> bool:
    if a["human_status"].strip() != b_status:
        return False
    return b_status != "known" or _norm(a["human_value"]) == _norm(b_value)


def build(dataset: dict, worksheets: list[list[dict]], adjudication: list[dict] | None = None) -> tuple[dict, dict]:
    first = _reviewed(worksheets[0])
    second = _reviewed(worksheets[1]) if len(worksheets) > 1 else {}
    adjudicated = _reviewed(adjudication or [])
    # The third person's decision replaces annotator A's answer where given.
    final = {**first, **adjudicated}

    by_edition: dict[str, dict] = {}
    ai_total = ai_agree = 0
    per_field: dict[str, list[int]] = {}
    for edition in dataset.get("editions") or []:
        gold = (edition.get("editionGold") or {}).get("fields") or {}
        fields = {}
        for field in FIELDS:
            row = final.get((edition["editionId"], field))
            if row is None:
                continue
            status = row["human_status"].strip()
            fields[field] = {"status": status}
            if status == "known":
                fields[field]["value"] = _parse_value(field, row["human_value"])
            ai = gold.get(field) or {"status": "unknown"}
            if ai.get("status") in ("known", "absent", "not_applicable"):
                agree = _same(row, ai["status"], _cell(ai.get("value")))
                ai_total += 1
                ai_agree += agree
                per_field.setdefault(field, [0, 0])
                per_field[field][0] += agree
                per_field[field][1] += 1
        if not fields:
            continue
        entry = {
            **{k: edition[k] for k in ("editionId", "workGroup", "split", "languageGroup", "targetIsbn") if k in edition},
            "documents": edition.get("documents") or [],
            "editionGold": {"fields": fields},
            "annotators": sorted({final[(edition["editionId"], f)].get("annotator", "").strip() for f in fields} - {""}),
        }
        seconds = {second[(edition["editionId"], f)].get("annotator", "").strip()
                   for f in FIELDS if (edition["editionId"], f) in second} - {""}
        if seconds:
            # run_experiments.py --strict-protocol counts editions carrying this.
            entry["secondAnnotator"] = sorted(seconds)[0]
        by_edition[edition["editionId"]] = entry

    report = {
        "reviewed_fields": len(final),
        "reviewed_editions": len(by_edition),
        "ai_label_agreement": {
            "comparable_fields": ai_total,
            "agreement_rate": round(ai_agree / ai_total, 4) if ai_total else None,
            "by_field": {f: {"agree": a, "total": t, "rate": round(a / t, 4)} for f, (a, t) in sorted(per_field.items())},
        },
    }
    if second:
        shared = sorted(set(first) & set(second))
        disagreements = [
            {"editionId": e, "field": f,
             "a": [first[(e, f)]["human_status"], first[(e, f)]["human_value"]],
             "b": [second[(e, f)]["human_status"], second[(e, f)]["human_value"]],
             "adjudicated": (e, f) in adjudicated}
            for e, f in shared
            if not _same(first[(e, f)], second[(e, f)]["human_status"].strip(), second[(e, f)]["human_value"])
        ]
        report["inter_annotator"] = {
            "double_annotated_fields": len(shared),
            "double_annotated_editions": len({e for e, _ in shared}),
            "percent_agreement": round(1 - len(disagreements) / len(shared), 4) if shared else None,
            "disagreements": disagreements,
            "unresolved_disagreements": sum(1 for d in disagreements if not d["adjudicated"]),
        }

    human = {
        "labelProvenance": "human_annotated",
        "labelProvenanceNote": ("Built by human_review.py from annotator worksheets; only rows with a "
                                "human_status are included. Annotators saw the AI label as a suggestion, so "
                                "report this as AI-assisted human annotation."),
        "editions": list(by_edition.values()),
    }
    return human, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    exp = sub.add_parser("export")
    exp.add_argument("--dataset", default=DEFAULT_DATASET)
    exp.add_argument("--out", required=True)
    exp.add_argument("--sample", type=int, default=None, help="stratified subset of N editions (second annotator)")
    imp = sub.add_parser("import")
    imp.add_argument("worksheets", nargs="+")
    imp.add_argument("--dataset", default=DEFAULT_DATASET)
    imp.add_argument("--adjudication", default=None, help="CSV with the third person's final answers")
    imp.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    with open(args.dataset, "r", encoding="utf-8") as handle:
        dataset = json.load(handle)
    if args.command == "export":
        rows = export_rows(dataset, args.sample)
        write_csv(rows, args.out)
        print(f"Wrote {len(rows)} rows ({len(rows) // len(FIELDS)} editions x {len(FIELDS)} fields) to {args.out}")
        return 0

    adjudication = read_csv(args.adjudication) if args.adjudication else None
    human, report = build(dataset, [read_csv(path) for path in args.worksheets[:2]], adjudication)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(human, handle, ensure_ascii=False, indent=2)
    report_path = os.path.splitext(args.out)[0] + "_agreement.json"
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k != "inter_annotator"}, ensure_ascii=False, indent=2))
    if "inter_annotator" in report:
        ia = report["inter_annotator"]
        print(f"inter-annotator: {ia['percent_agreement']} on {ia['double_annotated_fields']} fields "
              f"({ia['double_annotated_editions']} editions), {ia['unresolved_disagreements']} disagreements still to adjudicate")
    print(f"Dataset: {args.out}\nReport: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
