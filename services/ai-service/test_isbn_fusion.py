from __future__ import annotations

import unittest

import isbn_fusion as fusion


def ev(source: str, value, **extra) -> dict:
    return {"source": source, "value": value, **extra}


class NormalizationTest(unittest.TestCase):
    def test_publisher_prefix_variants_collapse_to_the_same_key(self):
        self.assertEqual(fusion._publisher_key("NXB Trẻ"), fusion._publisher_key("Nhà Xuất Bản Trẻ"))
        self.assertEqual(fusion._publisher_key("NXB Trẻ"), fusion._publisher_key("nxb tre"))

    def test_different_publishers_do_not_collapse(self):
        self.assertNotEqual(fusion._publisher_key("NXB Trẻ"), fusion._publisher_key("NXB Kim Đồng"))

    def test_author_set_ignores_accent_and_case(self):
        self.assertEqual(fusion._author_set("Nguyễn Nhật Ánh"), fusion._author_set("nguyen nhat anh"))

    def test_author_subset_is_compatible(self):
        self.assertTrue(fusion._compatible("authors", ["Nguyen Nhat Anh"], ["Nguyen Nhat Anh", "Bien tap: X"]))

    def test_pagecount_within_tolerance_is_compatible(self):
        self.assertTrue(fusion._compatible("pageCount", 320, 321))

    def test_pagecount_outside_tolerance_is_not_compatible(self):
        self.assertFalse(fusion._compatible("pageCount", 320, 400))

    def test_date_same_year_different_precision_is_compatible(self):
        self.assertTrue(fusion._compatible("publishedDate", "2008", "2008-08-01"))

    def test_date_different_year_is_not_compatible(self):
        self.assertFalse(fusion._compatible("publishedDate", "2008", "2010"))


class FuseFieldPublisherTest(unittest.TestCase):
    def test_same_normalized_publisher_from_two_sources_is_agreement(self):
        result = fusion.fuse_field("publisher", [ev("tiki", "NXB Trẻ"), ev("vinabook", "Nhà Xuất Bản Trẻ")])
        self.assertEqual(result["conflictCount"], 0)
        self.assertEqual(result["agreementCount"], 2)
        self.assertIn("MULTI_SOURCE_AGREEMENT", result["reasonCodes"])
        self.assertEqual(result["alternatives"], [])

    def test_multi_source_agreement_yields_higher_confidence_than_either_alone(self):
        two_sources = fusion.fuse_field("publisher", [ev("tiki", "NXB Tre"), ev("vinabook", "NXB Tre")])
        one_source = fusion.fuse_field("publisher", [ev("tiki", "NXB Tre")])
        self.assertGreater(two_sources["confidence"], one_source["confidence"])

    def test_different_publisher_is_a_conflict(self):
        result = fusion.fuse_field("publisher", [ev("googleBooks", "NXB Trẻ"), ev("fahasa", "NXB Kim Đồng")])
        self.assertGreater(result["conflictCount"], 0)
        self.assertIn("SOURCE_CONFLICT", result["reasonCodes"])
        self.assertEqual(result["alternatives"], [{"source": "googleBooks", "value": "NXB Trẻ"}])
        self.assertEqual(result["value"], "NXB Kim Đồng")  # fahasa (0.84) outranks googleBooks (0.82) for publisher

    def test_low_reliability_lone_source_still_yields_a_value_with_modest_confidence(self):
        result = fusion.fuse_field("publisher", [ev("webSearch", "NXB Trẻ")])
        self.assertEqual(result["value"], "NXB Trẻ")
        self.assertGreater(result["confidence"], 0.0)
        self.assertLess(result["confidence"], 0.5)


class FuseFieldPageCountTest(unittest.TestCase):
    def test_pagecount_agreement_within_tolerance(self):
        result = fusion.fuse_field("pageCount", [ev("googleBooks", 320), ev("fahasa", 321)])
        self.assertEqual(result["conflictCount"], 0)
        self.assertEqual(result["agreementCount"], 2)

    def test_pagecount_conflict_outside_tolerance(self):
        result = fusion.fuse_field("pageCount", [ev("googleBooks", 320), ev("fahasa", 500)])
        self.assertGreater(result["conflictCount"], 0)
        self.assertIn("SOURCE_CONFLICT", result["reasonCodes"])


class FuseFieldMissingTest(unittest.TestCase):
    def test_no_source_responded_is_missing(self):
        result = fusion.fuse_field("publisher", [])
        self.assertIsNone(result["value"])
        self.assertIsNone(result["selectedSource"])
        self.assertEqual(result["confidence"], 0.0)
        self.assertIn("NO_SOURCE_RESPONDED", result["reasonCodes"])

    def test_empty_values_are_ignored_as_missing(self):
        result = fusion.fuse_field("publisher", [ev("googleBooks", None), ev("tiki", "")])
        self.assertIn("NO_SOURCE_RESPONDED", result["reasonCodes"])

    def test_llm_only_evidence_for_a_factual_field_counts_as_missing(self):
        result = fusion.fuse_field("title", [ev("webSearch", "Đoán từ văn bản", extractionMethod="llm_derived")])
        self.assertIsNone(result["value"])
        self.assertIn("LLM_ONLY_EVIDENCE_REJECTED", result["reasonCodes"])

    def test_llm_evidence_does_not_block_a_real_source_on_the_same_field(self):
        result = fusion.fuse_field("title", [
            ev("googleBooks", "Clean Code"), ev("webSearch", "Đoán từ văn bản", extractionMethod="llm_derived"),
        ])
        self.assertEqual(result["value"], "Clean Code")


class FuseFieldDescriptionTest(unittest.TestCase):
    def test_two_different_descriptions_are_not_a_conflict(self):
        result = fusion.fuse_field("description", [
            ev("googleBooks", "Mo ta ngan."), ev("fahasa", "Mo ta rat dai va chi tiet ve cuon sach nay hon nhieu."),
        ])
        self.assertEqual(result["conflictCount"], 0)
        self.assertNotIn("SOURCE_CONFLICT", result["reasonCodes"])

    def test_richest_description_is_selected(self):
        result = fusion.fuse_field("description", [
            ev("googleBooks", "Mo ta ngan."), ev("fahasa", "Mo ta rat dai va chi tiet ve cuon sach nay hon nhieu."),
        ])
        self.assertEqual(result["selectedSource"], "fahasa")
        self.assertEqual(len(result["evidence"]), 2)  # both sources' provenance is kept


class FuseFieldCategoryTest(unittest.TestCase):
    def test_categories_from_different_sources_are_merged_not_conflicted(self):
        result = fusion.fuse_field("categories", [ev("googleBooks", ["Fiction"]), ev("tiki", ["Van hoc"])])
        self.assertEqual(result["conflictCount"], 0)
        self.assertEqual(set(result["value"]), {"Fiction", "Van hoc"})

    def test_duplicate_category_across_sources_is_not_repeated(self):
        result = fusion.fuse_field("categories", [ev("googleBooks", ["Fiction"]), ev("tiki", ["fiction"])])
        self.assertEqual(len(result["value"]), 1)


class FuseFieldMultipleEvidenceTest(unittest.TestCase):
    def test_three_agreeing_sources_yield_strong_confidence(self):
        result = fusion.fuse_field("title", [
            ev("googleBooks", "Clean Code"), ev("openLibrary", "Clean Code"), ev("worldCat", "Clean Code"),
        ])
        self.assertEqual(result["agreementCount"], 3)
        self.assertGreater(result["confidence"], 0.9)

    def test_confidence_is_capped_below_certainty(self):
        result = fusion.fuse_field("title", [
            ev("googleBooks", "Clean Code"), ev("openLibrary", "Clean Code"), ev("worldCat", "Clean Code"),
            ev("fahasa", "Clean Code"), ev("tiki", "Clean Code"), ev("vinabook", "Clean Code"),
        ])
        self.assertLessEqual(result["confidence"], fusion.MAX_SUPPORT)


if __name__ == "__main__":
    unittest.main()
