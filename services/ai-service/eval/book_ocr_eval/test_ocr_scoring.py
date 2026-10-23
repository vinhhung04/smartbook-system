import json
import unittest
from pathlib import Path

from ocr_scoring import aggregate, autofill_metadata, by_tag, match, raw_metadata, score_fields

TRUTH = {"title": "Dế Mèn phiêu lưu ký", "subtitle": None, "authors": ["Tô Hoài"], "translators": [],
         "publisher": "Nhà xuất bản Kim Đồng", "publishedYear": None, "isbn13": None, "pageCount": None}


def response(metadata, proposals=None, isbn_obs=(), cost=0.0001, ms=9000, warnings=()):
    return {"metadata": metadata, "proposals": proposals or {}, "warnings": list(warnings), "processingTimeMs": ms,
            "usage": {"costUsd": cost}, "fields": {"isbn": {"observations": list(isbn_obs)}}}


class OcrScoringTests(unittest.TestCase):
    def test_tone_marks_count_case_and_punctuation_do_not(self):
        self.assertTrue(match("title", "DẾ MÈN PHIÊU LƯU KÝ", "Dế Mèn phiêu lưu ký"))
        self.assertTrue(match("title", "Frieren - Pháp sư tiễn táng", "Frieren Pháp sư tiễn táng"))
        self.assertFalse(match("title", "Frieren Pháp sư tiến táng", "Frieren Pháp sư tiễn táng"))
        self.assertTrue(match("title", "Frieren Pháp sư tiến táng", "Frieren Pháp sư tiễn táng", normalized=True))
        self.assertTrue(match("publisher", "NXB Kim Đồng", "Nhà xuất bản Kim Đồng"))
        self.assertTrue(match("authors", ["TÔ HOÀI"], ["Tô Hoài"]))

    def test_unprinted_field_is_a_hallucination(self):
        outcome = score_fields({**TRUTH, "isbn13": "9786041234567", "authors": ["Tô Hoài", "Tạ Huy Long"]}, TRUTH)
        self.assertEqual(outcome["isbn13"], "FP_HALLUCINATED")
        self.assertEqual(outcome["authors"], "FP_WRONG")
        self.assertEqual(outcome["title"], "TP")
        self.assertEqual(outcome["pageCount"], "TN")
        self.assertEqual(score_fields({**TRUTH, "title": None}, TRUTH)["title"], "FN")

    def test_autofill_uses_only_safe_proposals(self):
        proposals = {"title": {"value": "Dế Mèn phiêu lưu ký", "safeToApply": True},
                     "publisher": {"value": "NHA XUAT BAN KIM DONG", "safeToApply": False},
                     "authorsText": {"value": "Tô Hoài", "safeToApply": True}}
        self.assertEqual(autofill_metadata({"proposals": proposals})["publisher"], None)
        self.assertEqual(autofill_metadata({"proposals": proposals})["authors"], ["Tô Hoài"])

    def test_aggregate_metrics(self):
        good = response(dict(TRUTH), {"title": {"value": TRUTH["title"], "safeToApply": True},
                                      "authorsText": {"value": "Tô Hoài", "safeToApply": True}}, ms=8000)
        wrong = response({**TRUTH, "title": "De Men phieu luu ky", "isbn13": "9786041234567"},
                         isbn_obs=[{"source": "back_cover", "issues": []}, {"source": "back_cover", "issues": ["INVALID_CHECKSUM"]}],
                         ms=12000, cost=0.0003, warnings=["MALFORMED_OBSERVATION:title"])
        runs = [{"truth": TRUTH, "response": good}, {"truth": TRUTH, "response": wrong},
                {"truth": TRUTH, "response": None, "error": "AI_INVALID_SCHEMA"},
                {"truth": TRUTH, "response": None, "error": "AI_TIMEOUT"}]
        report = aggregate(runs)
        self.assertEqual(report["jsonValidityRate"], 2 / 3)  # the timeout produced no answer to judge
        self.assertEqual(report["accuracy"]["titleExact"], 0.5)
        self.assertEqual(report["accuracy"]["titleNormalized"], 1.0)
        self.assertEqual(report["reading"]["fields"]["title"]["precision"], 0.5)
        self.assertEqual(report["reading"]["hallucinationRate"], 1 / 7)  # isbn13 on a cover-only book
        self.assertEqual(report["invalidIsbnRate"], 0.5)
        self.assertEqual(report["latencyMs"], {"mean": 10000, "p50": 8000, "p95": 12000})
        self.assertAlmostEqual(report["costUsd"]["meanPerBook"], 0.0002)
        self.assertEqual(report["malformedObservationsPerScan"], 0.5)
        # good run: publisher not auto-filled (1 of 3 printed fields to fix); wrong run: nothing filled (3 of 3).
        self.assertEqual(report["manualCorrectionRate"], 4 / 6)
        # Nothing in these responses offers a value to click, so all of it is typing.
        self.assertEqual((report["oneClickRate"], report["typingRate"]), (0.0, 4 / 6))

    def test_one_click_versus_typing(self):
        proposals = {"title": {"value": TRUTH["title"], "safeToApply": False},          # offered, one click
                     "authorsText": {"value": None, "safeToApply": False,                # conflict: right option offered
                                     "options": [{"value": "Tô Hoài"}, {"value": "Tô Hoai"}]},
                     "publisher": {"value": "NXB Kim Dong", "safeToApply": False}}       # wrong marks: typing
        report = aggregate([{"truth": TRUTH, "response": response(dict(TRUTH), proposals)}])
        self.assertEqual(report["manualCorrectionRate"], 1.0)
        self.assertEqual((report["oneClickRate"], report["typingRate"]), (2 / 3, 1 / 3))

    def test_three_layers_separate_model_from_post_processing(self):
        # The model read an illustrator as author and an unprinted ISBN; validation dropped both.
        fields = {
            "title": {"observations": [{"source": "front_cover", "value": "Dế Mèn phiêu lưu ký", "normalizedValue": "Dế Mèn phiêu lưu ký"}]},
            "authors": {"observations": [{"source": "front_cover", "value": ["Tạ Huy Long"], "normalizedValue": ["Tạ Huy Long"]}]},
            "isbn": {"observations": [{"source": "barcode", "value": "9786041234567"},
                                      {"source": "front_cover", "value": "978-604-1-23456-7", "normalizedValue": None}]},
        }
        resp = {**response({**TRUTH, "authors": [], "isbn13": None}), "fields": fields,
                "usage": {"costUsd": 0.0001, "promptTokens": 2000, "completionTokens": 300}}
        raw = raw_metadata(resp)
        self.assertEqual((raw["authors"], raw["isbn13"]), (["Tạ Huy Long"], "9786041234567"))  # not the barcode reading
        report = aggregate([{"truth": TRUTH, "response": resp, "tags": ["children", "clear"]}])
        self.assertEqual(report["raw"]["hallucinationRate"], 1 / 3)       # the ISBN
        self.assertEqual(report["raw"]["fields"]["authors"]["FP_WRONG"], 1)
        self.assertEqual(report["reading"]["hallucinationRate"], 0.0)     # validation removed both
        self.assertEqual(report["tokens"], {"meanInput": 2000, "meanOutput": 300})
        tags = by_tag([{"truth": TRUTH, "response": resp, "tags": ["children", "clear"]},
                       {"truth": TRUTH, "response": None, "error": "AI_TIMEOUT", "tags": ["glare"]}])
        self.assertEqual(set(tags), {"children", "clear", "glare"})
        self.assertEqual(tags["glare"]["scans"], 1)

    def test_replay_rebuilds_only_the_models_own_readings(self):
        from run_benchmark import answer_from_response
        stored = {"fields": {
            "title": {"observations": [{"source": "front_cover", "value": "Số đỏ", "observedText": "SỐ ĐỎ", "valid": True}]},
            "isbn": {"observations": [{"source": "barcode", "value": "9786041234567", "observedText": "9786041234567"},
                                      {"source": "back_cover", "value": "978604123456X", "observedText": "ISBN 978604123456X"}]},
            "language": {"observations": []}},
            "otherCodes": [{"source": "barcode", "value": "8934974184027"}, {"source": "back_cover", "value": "8935", "label": "SKU"}],
            "warnings": ["IMAGE_ILLEGIBLE:back_cover"]}
        answer = answer_from_response(stored)
        self.assertEqual(answer["observations"]["title"], [{"source": "front_cover", "value": "Số đỏ", "observedText": "SỐ ĐỎ"}])
        self.assertEqual([o["source"] for o in answer["observations"]["isbn"]], ["back_cover"])  # invalid readings kept, barcode not
        self.assertEqual([c["value"] for c in answer["otherCodes"]], ["8935"])
        self.assertEqual(answer["images"], [{"source": "back_cover", "legible": False}])

    def test_shipped_datasets_follow_the_schema_rules(self):
        from run_benchmark import read_dataset
        for name in ("smoke_dataset.json", "dataset.example.json"):
            books = read_dataset(Path(__file__).with_name(name))
            for book in books:
                self.assertEqual(set(book["groundTruth"]), {"title", "subtitle", "authors", "translators", "publisher",
                                                            "publishedYear", "isbn13", "pageCount"})
        self.assertIn("SMOKE SET", json.loads(Path(__file__).with_name("smoke_dataset.json").read_text(encoding="utf-8"))["description"])


if __name__ == "__main__":
    unittest.main()
