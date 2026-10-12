import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import human_review  # noqa: E402

DATASET = {
    "labelProvenance": "ai_generated_claude_not_human_annotated",
    "editions": [
        {"editionId": "e1", "workGroup": "wg1", "split": "test", "languageGroup": "vi", "targetIsbn": "9786042125352",
         "editionGold": {"fields": {"title": {"status": "known", "value": "Dế mèn phiêu lưu ký"},
                                    "authors": {"status": "known", "value": ["Tô Hoài"]},
                                    "translator": {"status": "not_applicable"}}},
         "documents": [{"provider": "googleBooks", "payload": {"volumeInfo": {
             "title": "Dế mèn phiêu lưu ký", "authors": ["Tô Hoài"], "publishedDate": "2019",
             "industryIdentifiers": [{"type": "ISBN_13", "identifier": "9786042125352"}]}}}]},
    ],
}


def fill(rows, answers, annotator):
    for row in rows:
        if row["field"] in answers:
            row["human_status"], row["human_value"] = answers[row["field"]]
            row["annotator"] = annotator
    return rows


class HumanReviewTest(unittest.TestCase):
    def test_export_shows_ai_label_and_source_evidence_with_blank_human_columns(self):
        rows = human_review.export_rows(DATASET)
        self.assertEqual(len(rows), len(human_review.FIELDS))
        title = next(r for r in rows if r["field"] == "title")
        self.assertEqual(title["ai_value"], "Dế mèn phiêu lưu ký")
        self.assertIn("googleBooks: Dế mèn phiêu lưu ký", title["source_values"])
        self.assertEqual(title["human_status"], "")
        published = next(r for r in rows if r["field"] == "publishedDate")
        self.assertEqual(published["ai_status"], "unknown")  # AI had no verified value
        self.assertIn("2019", published["source_values"])

    def test_csv_roundtrip_keeps_vietnamese(self):
        rows = human_review.export_rows(DATASET)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "w.csv")
            human_review.write_csv(rows, path)
            self.assertEqual(human_review.read_csv(path)[0]["ai_value"], "Dế mèn phiêu lưu ký")

    def test_only_human_answers_enter_the_dataset_and_ai_agreement_is_reported(self):
        rows = fill(human_review.export_rows(DATASET), {
            "title": ("known", "Dế Mèn phiêu lưu ký"),  # same after case/space normalisation
            "authors": ("known", "Tô Hoài | Ngọc Anh"),  # human found an extra author -> disagree
            "publishedDate": ("known", "2019"),           # AI had no label: not counted in agreement
        }, "A")
        human, report = human_review.build(DATASET, [rows])
        fields = human["editions"][0]["editionGold"]["fields"]
        self.assertEqual(human["labelProvenance"], "human_annotated")
        self.assertEqual(set(fields), {"title", "authors", "publishedDate"})  # translator not reviewed -> absent
        self.assertEqual(fields["authors"]["value"], ["Tô Hoài", "Ngọc Anh"])
        self.assertEqual(report["ai_label_agreement"]["comparable_fields"], 2)
        self.assertEqual(report["ai_label_agreement"]["agreement_rate"], 0.5)

    def test_two_annotators_give_percent_agreement_and_a_disagreement_list(self):
        a = fill(human_review.export_rows(DATASET), {"title": ("known", "Dế mèn phiêu lưu ký"), "translator": ("not_applicable", "")}, "A")
        b = fill(human_review.export_rows(DATASET), {"title": ("known", "Dế mèn phiêu lưu ký"), "translator": ("unknown", "")}, "B")
        _, report = human_review.build(DATASET, [a, b])
        ia = report["inter_annotator"]
        self.assertEqual(ia["double_annotated_fields"], 2)
        self.assertEqual(ia["percent_agreement"], 0.5)
        self.assertEqual([d["field"] for d in ia["disagreements"]], ["translator"])
        self.assertEqual(ia["unresolved_disagreements"], 1)

    def test_adjudication_resolves_a_disagreement_and_marks_the_second_annotator(self):
        a = fill(human_review.export_rows(DATASET), {"translator": ("not_applicable", "")}, "A")
        b = fill(human_review.export_rows(DATASET), {"translator": ("unknown", "")}, "B")
        c = fill(human_review.export_rows(DATASET), {"translator": ("unknown", "")}, "C")
        human, report = human_review.build(DATASET, [a, b], c)
        edition = human["editions"][0]
        self.assertEqual(edition["editionGold"]["fields"]["translator"]["status"], "unknown")
        self.assertEqual(edition["secondAnnotator"], "B")
        self.assertEqual(report["inter_annotator"]["unresolved_disagreements"], 0)

    def test_output_is_accepted_by_run_experiments(self):
        import run_experiments

        rows = fill(human_review.export_rows(DATASET), {"title": ("known", "Dế mèn phiêu lưu ký"), "pageCount": ("absent", "")}, "A")
        human, _ = human_review.build(DATASET, [rows])
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "human.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(human, handle, ensure_ascii=False)
            entries = run_experiments.read_dataset(path)
        self.assertEqual(entries[0]["editionGold"]["fields"]["pageCount"], {"status": "absent"})

    def test_invalid_status_or_missing_value_is_rejected(self):
        bad = fill(human_review.export_rows(DATASET), {"title": ("maybe", "x")}, "A")
        with self.assertRaises(ValueError):
            human_review.build(DATASET, [bad])
        empty = fill(human_review.export_rows(DATASET), {"title": ("known", "")}, "A")
        with self.assertRaises(ValueError):
            human_review.build(DATASET, [empty])

    def test_real_dataset_exports_every_edition_and_a_stratified_second_sample(self):
        with open(human_review.DEFAULT_DATASET, encoding="utf-8") as handle:
            real = json.load(handle)
        rows = human_review.export_rows(real)
        self.assertEqual(len(rows), len(real["editions"]) * len(human_review.FIELDS))
        first = human_review.stratified_sample(list(real["editions"]), 24)
        again = human_review.stratified_sample(list(real["editions"]), 24)
        self.assertEqual([e["editionId"] for e in first], [e["editionId"] for e in again])
        self.assertEqual(len(first), 24)
        self.assertEqual({(e["split"], e["languageGroup"]) for e in first},
                         {(e["split"], e["languageGroup"]) for e in real["editions"]})


if __name__ == "__main__":
    unittest.main()
