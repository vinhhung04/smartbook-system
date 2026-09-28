import unittest

from isbn_coverage import (
    FIELD_TIERS,
    ISBN_QUALITY_WEIGHTS,
    analyze_field_coverage,
    classify_field,
)


def _evidence(value, source="googleBooks", agreement=1, conflicts=0):
    return {
        "selectedValue": value,
        "selectedSource": source if value not in (None, "", []) else None,
        "confirmations": [],
        "selectionReason": {"sourceReliability": 0.9, "agreementCount": agreement, "conflictCount": conflicts},
    }


def _intel(fields: dict, confidence: dict | None = None) -> dict:
    """fields: {name: (value, confidence, conflictCount)} -> minimal intelligence dict."""
    evidence, conf = {}, {}
    for name, (value, c, conflicts) in fields.items():
        evidence[name] = _evidence(value, conflicts=conflicts)
        conf[name] = c
    return {"fieldEvidence": evidence, "fieldConfidence": conf}


LONG_DESC = "Mô tả đủ dài để vượt ngưỡng tám mươi ký tự của quy tắc chất lượng hiện có. " * 2


class ClassifyFieldTests(unittest.TestCase):
    def test_missing_when_no_value(self):
        self.assertEqual(classify_field("publisher", _evidence(None), 0.0)["status"], "MISSING")
        self.assertEqual(classify_field("categories", _evidence([]), 0.0)["status"], "MISSING")

    def test_conflicted_for_factual_field(self):
        result = classify_field("publisher", _evidence("NXB A", conflicts=1), 0.8)
        self.assertEqual(result["status"], "CONFLICTED")

    def test_description_differences_never_count_as_conflict(self):
        result = classify_field("description", _evidence(LONG_DESC, conflicts=2), 1.0)
        self.assertEqual(result["status"], "SUFFICIENT")

    def test_low_confidence_below_threshold(self):
        result = classify_field("publisher", _evidence("NXB A", source="webSearch"), 0.55)
        self.assertEqual(result["status"], "LOW_CONFIDENCE")
        self.assertEqual(result["reason"], "LOW_CONFIDENCE")

    def test_short_description_is_low_confidence(self):
        result = classify_field("description", _evidence("Ngắn"), 1.0)
        self.assertEqual(result["status"], "LOW_CONFIDENCE")
        self.assertEqual(result["reason"], "SHORT_DESCRIPTION")

    def test_sufficient(self):
        self.assertEqual(classify_field("publisher", _evidence("NXB A"), 0.82)["status"], "SUFFICIENT")

    def test_missing_takes_precedence_over_everything(self):
        self.assertEqual(classify_field("publisher", _evidence(None, conflicts=3), 0.0)["status"], "MISSING")


class AnalyzeCoverageTests(unittest.TestCase):
    def test_tiers_are_consistent_with_quality_weights(self):
        self.assertEqual(set(FIELD_TIERS), set(ISBN_QUALITY_WEIGHTS))
        for field, weight in ISBN_QUALITY_WEIGHTS.items():
            expected = "critical" if weight >= 2.0 else "high" if weight >= 1.0 else "supporting"
            self.assertEqual(FIELD_TIERS[field], expected, field)

    def test_partial_google_result_flags_high_value_gaps(self):
        intel = _intel({
            "title": ("Nhà Giả Kim", 0.95, 0),
            "authors": (["Paulo Coelho"], 0.9, 0),
            "publisher": (None, 0.0, 0),
            "publishedDate": (None, 0.0, 0),
            "description": (None, 0.0, 0),
            "categories": ([], 0.0, 0),
            "language": ("vi", 0.8, 0),
            "pageCount": (None, 0.0, 0),
            "thumbnail": ("http://x/y.jpg", 1.0, 0),
        })
        result = analyze_field_coverage(intel)

        self.assertEqual(result["coverage"]["foundFields"], 4)
        self.assertEqual(result["coverage"]["totalFields"], 9)
        self.assertEqual(result["missingFields"], ["publisher", "publishedDate", "description", "categories", "pageCount"])
        gap_fields = [gap["field"] for gap in result["worthCallingGaps"]]
        self.assertEqual(sorted(gap_fields), ["description", "pageCount", "publishedDate", "publisher"])
        self.assertTrue(result["needsEnrichment"])
        self.assertEqual(result["fieldStatus"]["categories"], "MISSING")
        self.assertEqual(result["coverage"]["byTier"]["critical"], {"found": 2, "total": 2})
        self.assertEqual(result["coverage"]["byTier"]["high"], {"found": 0, "total": 4})

    def test_missing_supporting_fields_alone_do_not_need_enrichment(self):
        intel = _intel({
            "title": ("T", 0.95, 0), "authors": (["A"], 0.9, 0), "publisher": ("P", 0.82, 0),
            "publishedDate": ("2020", 1.0, 0), "description": (LONG_DESC, 1.0, 0),
            "pageCount": (100, 1.0, 0), "categories": ([], 0.0, 0),
            "language": (None, 0.0, 0), "thumbnail": (None, 0.0, 0),
        })
        result = analyze_field_coverage(intel)

        self.assertEqual(result["worthCallingGaps"], [])
        self.assertFalse(result["needsEnrichment"])
        self.assertEqual(sorted(result["missingFields"]), ["categories", "language", "thumbnail"])

    def test_subtitle_is_never_counted_or_reported(self):
        intel = _intel({"title": ("T", 0.95, 0), "subtitle": (None, 0.0, 0)})
        result = analyze_field_coverage(intel)
        self.assertNotIn("subtitle", result["fieldStatus"])
        self.assertNotIn("subtitle", result["missingFields"])

    def test_conflicted_and_low_confidence_lists(self):
        intel = _intel({
            "title": ("T", 0.95, 0), "authors": (["A"], 0.9, 0),
            "publisher": ("P", 0.84, 1), "publishedDate": ("2020", 0.55, 0),
            "description": (LONG_DESC, 1.0, 0), "pageCount": (100, 1.0, 0),
        })
        result = analyze_field_coverage(intel)
        self.assertEqual(result["conflictedFields"], ["publisher"])
        self.assertEqual(result["lowConfidenceFields"], ["publishedDate"])
        self.assertEqual(sorted(g["field"] for g in result["worthCallingGaps"]), ["publishedDate", "publisher"])

    def test_full_metadata_has_full_coverage(self):
        intel = _intel({
            "title": ("T", 0.95, 0), "authors": (["A"], 0.9, 0), "publisher": ("P", 0.82, 0),
            "publishedDate": ("2020", 1.0, 0), "description": (LONG_DESC, 1.0, 0),
            "pageCount": (100, 1.0, 0), "categories": (["c"], 0.7, 0),
            "language": ("en", 1.0, 0), "thumbnail": ("u", 1.0, 0),
        })
        result = analyze_field_coverage(intel)
        self.assertEqual(result["coverage"]["ratio"], 1.0)
        self.assertEqual(result["coverage"]["weightedRatio"], 1.0)
        self.assertFalse(result["needsEnrichment"])


if __name__ == "__main__":
    unittest.main()
