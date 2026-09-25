"""Offline, fixture-based eval for Field-level Metadata Evidence Fusion
(isbn_fusion.py, main._build_isbn_intelligence()).

Unlike eval/eval_isbn_extraction.py (real network calls to Google Books/Open
Library/marketplaces), this eval supplies already-parsed provider metadata
directly from dataset.json and calls main._build_isbn_intelligence() in
process - no network, no ISBN retrieval timing/budget, deterministic. That
isolates exactly what Evidence Fusion is meant to improve: given the same set
of (possibly conflicting, possibly partial) provider evidence, how good is the
fused result - not whether retrieval found the providers in the first place
(see test_isbn_field_level_retrieval.py for that).

Scoring is done with a normalizer INDEPENDENT of isbn_fusion.py's own
(eval/scoring.py's accent/case-insensitive fuzzy matcher, already used by
eval_isbn_extraction.py) so the eval cannot mark isbn_fusion.py correct simply
because both sides normalize the same string the same way.

Runs both ISBN_FUSION_MODE values ("prior": the original single-highest-
reliability-source rule; "evidence": the new fusion) over the same dataset,
so the report shows the before/after this task is meant to demonstrate.

Usage (from services/ai-service/):
    python eval/metadata_fusion/run_eval.py
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # ai-service root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # eval/, for `import scoring`

import scoring  # noqa: E402
import main as ai_main  # noqa: E402

DATASET_PATH = os.path.join(os.path.dirname(__file__), "dataset.json")
REPORTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")

PAGE_COUNT_TOLERANCE = 2
MODES = ("prior", "evidence")


def _is_present(value) -> bool:
    return bool(value) if isinstance(value, list) else value not in (None, "")


def _field_correct(field_name: str, expected_value, actual_value) -> bool:
    """Independent of isbn_fusion.py's own normalization - reuses
    eval/scoring.py's accent/case-insensitive fuzzy string matcher instead."""
    if field_name == "authors":
        actual_list = actual_value if isinstance(actual_value, list) else []
        return bool(expected_value) and all(
            any(scoring.field_matches(expected_author, actual_author) for actual_author in actual_list)
            for expected_author in expected_value
        )
    if field_name == "pageCount":
        try:
            return actual_value is not None and abs(int(actual_value) - int(expected_value)) <= PAGE_COUNT_TOLERANCE
        except (TypeError, ValueError):
            return False
    return scoring.field_matches(str(expected_value), str(actual_value) if actual_value is not None else None)


@dataclass
class FieldTally:
    tp: int = 0
    fn: int = 0
    fp: int = 0
    tn: int = 0
    coverage_hits: int = 0
    coverage_total: int = 0

    @property
    def accuracy(self) -> float:
        total = self.tp + self.fn + self.fp + self.tn
        return round((self.tp + self.tn) / total, 3) if total else 0.0

    @property
    def precision(self) -> float:
        return round(self.tp / (self.tp + self.fp), 3) if (self.tp + self.fp) else 1.0

    @property
    def recall(self) -> float:
        return round(self.tp / (self.tp + self.fn), 3) if (self.tp + self.fn) else 1.0

    @property
    def coverage(self) -> float:
        return round(self.coverage_hits / self.coverage_total, 3) if self.coverage_total else 0.0

    @property
    def missing_detection_accuracy(self) -> float:
        return round(self.tn / (self.tn + self.fp), 3) if (self.tn + self.fp) else 1.0


@dataclass
class ConflictTally:
    exact_match_cases: int = 0
    total_cases: int = 0
    tp: int = 0
    fn: int = 0
    fp: int = 0

    @property
    def case_accuracy(self) -> float:
        return round(self.exact_match_cases / self.total_cases, 3) if self.total_cases else 0.0

    @property
    def precision(self) -> float:
        return round(self.tp / (self.tp + self.fp), 3) if (self.tp + self.fp) else 1.0

    @property
    def recall(self) -> float:
        return round(self.tp / (self.tp + self.fn), 3) if (self.tp + self.fn) else 1.0


def run_case(case: dict) -> dict:
    return ai_main._build_isbn_intelligence(case["providers"], {})


def score_dataset(cases: list[dict]) -> tuple[dict[str, FieldTally], ConflictTally, list[dict]]:
    field_tallies: dict[str, FieldTally] = {}
    conflict_tally = ConflictTally()
    per_case_rows = []

    for case in cases:
        result = run_case(case)
        metadata = result.get("metadata") or {}
        expected = case.get("expected") or {}
        expected_missing = case.get("expectedMissing") or []
        expected_conflicts = set(case.get("expectedConflicts") or [])
        actual_conflicts = {c["field"] for c in (result.get("conflicts") or [])}

        for field_name, expected_value in expected.items():
            tally = field_tallies.setdefault(field_name, FieldTally())
            actual_value = metadata.get(field_name)
            present = _is_present(actual_value)
            tally.coverage_total += 1
            if present:
                tally.coverage_hits += 1
            if present and _field_correct(field_name, expected_value, actual_value):
                tally.tp += 1
            else:
                tally.fn += 1

        for field_name in expected_missing:
            tally = field_tallies.setdefault(field_name, FieldTally())
            if _is_present(metadata.get(field_name)):
                tally.fp += 1
            else:
                tally.tn += 1

        conflict_tally.total_cases += 1
        if actual_conflicts == expected_conflicts:
            conflict_tally.exact_match_cases += 1
        conflict_tally.tp += len(actual_conflicts & expected_conflicts)
        conflict_tally.fn += len(expected_conflicts - actual_conflicts)
        conflict_tally.fp += len(actual_conflicts - expected_conflicts)

        per_case_rows.append({
            "id": case["id"], "conflicts_expected": sorted(expected_conflicts),
            "conflicts_actual": sorted(actual_conflicts), "conflicts_match": actual_conflicts == expected_conflicts,
        })

    return field_tallies, conflict_tally, per_case_rows


def _overall(field_tallies: dict[str, FieldTally]) -> FieldTally:
    overall = FieldTally()
    for tally in field_tallies.values():
        overall.tp += tally.tp
        overall.fn += tally.fn
        overall.fp += tally.fp
        overall.tn += tally.tn
        overall.coverage_hits += tally.coverage_hits
        overall.coverage_total += tally.coverage_total
    return overall


def render_report(by_mode: dict[str, tuple], timestamp: str) -> str:
    lines = [f"# Metadata Evidence Fusion eval — {timestamp}", ""]
    dataset_note = (
        "Fixture-based, offline (no network) - provider metadata is supplied directly by "
        "eval/metadata_fusion/dataset.json. Scored with eval/scoring.py's independent fuzzy "
        "matcher, not isbn_fusion.py's own normalizer."
    )
    lines += [dataset_note, ""]

    for mode in MODES:
        field_tallies, conflict_tally, case_rows = by_mode[mode]
        overall = _overall(field_tallies)
        lines.append(f"## Mode: `{mode}`")
        lines.append("")
        lines.append(f"- Field Accuracy: **{overall.accuracy}**")
        lines.append(f"- Field Precision: **{overall.precision}**")
        lines.append(f"- Field Recall: **{overall.recall}**")
        lines.append(f"- Coverage: **{overall.coverage}**")
        lines.append(f"- Missing-field Detection Accuracy: **{overall.missing_detection_accuracy}**")
        lines.append(f"- Conflict Detection Accuracy (exact set match, case-level): **{conflict_tally.case_accuracy}**"
                      f" ({conflict_tally.exact_match_cases}/{conflict_tally.total_cases})")
        lines.append(f"- Conflict Detection Precision/Recall (field-level): "
                      f"**{conflict_tally.precision}** / **{conflict_tally.recall}**")
        lines.append("")
        lines.append("| Field | Accuracy | Precision | Recall | Coverage |")
        lines.append("|---|---|---|---|---|")
        for field_name in sorted(field_tallies):
            tally = field_tallies[field_name]
            lines.append(f"| {field_name} | {tally.accuracy} | {tally.precision} | {tally.recall} | {tally.coverage} |")
        lines.append("")
        mismatches = [row for row in case_rows if not row["conflicts_match"]]
        if mismatches:
            lines.append("Cases where detected conflicts didn't match expected:")
            for row in mismatches:
                lines.append(f"- `{row['id']}`: expected {row['conflicts_expected']}, got {row['conflicts_actual']}")
            lines.append("")

    prior_overall = _overall(by_mode["prior"][0])
    evidence_overall = _overall(by_mode["evidence"][0])
    lines.append("## Delta (evidence − prior)")
    lines.append("")
    lines.append(f"- Field Accuracy: {prior_overall.accuracy} → {evidence_overall.accuracy}")
    lines.append(f"- Conflict Detection Accuracy: {by_mode['prior'][1].case_accuracy} → {by_mode['evidence'][1].case_accuracy}")
    lines.append(f"- Missing-field Detection Accuracy: {prior_overall.missing_detection_accuracy} → {evidence_overall.missing_detection_accuracy}")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    with open(DATASET_PATH, "r", encoding="utf-8") as fh:
        cases = json.load(fh)["cases"]

    by_mode = {}
    for mode in MODES:
        with mock.patch.object(ai_main, "ISBN_FUSION_MODE", mode):
            by_mode[mode] = score_dataset(cases)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report = render_report(by_mode, timestamp)
    print(report)

    os.makedirs(REPORTS_DIR, exist_ok=True)
    out_path = os.path.join(REPORTS_DIR, f"metadata_fusion_{timestamp}.md")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(report)
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
