"""Feature B - AI Metadata Anomaly Detection (book_ocr/anomaly_detection.py).

Rule-based only: every anomaly here traces to a FieldResult status/reason code
or a warning that validation.py / service.py already compute - this module
only packages them with severity and plain-language wording, so these tests
build fixtures directly instead of running a full scan.
"""
from __future__ import annotations

import unittest

from book_ocr.anomaly_detection import detect_anomalies
from book_ocr.schemas import FieldResult


def result(field, status, **kwargs):
    return FieldResult(field=field, status=status, **kwargs)


class FieldAnomalyTests(unittest.TestCase):
    def test_conflicted_isbn_is_critical_identity_anomaly(self):
        fields = {"isbn": result("isbn", "CONFLICTED", reasons=["SOURCES_DISAGREE"])}
        anomalies = detect_anomalies(fields, [])
        self.assertEqual(len(anomalies), 1)
        a = anomalies[0]
        self.assertEqual(a.anomalyType, "ISBN_ANOMALY")
        self.assertEqual(a.severity, "CRITICAL")
        self.assertTrue(a.requiresHumanReview)
        self.assertIn("isbn", a.affectedFields)

    def test_conflicted_title_is_also_critical(self):
        fields = {"title": result("title", "CONFLICTED", reasons=["SOURCES_DISAGREE"])}
        a = detect_anomalies(fields, [])[0]
        self.assertEqual(a.severity, "CRITICAL")

    def test_conflicted_publisher_is_high_not_critical(self):
        # Identity-critical fields (title/isbn) are CRITICAL; other conflicts are HIGH.
        fields = {"publisher": result("publisher", "CONFLICTED", reasons=["SOURCES_DISAGREE"])}
        a = detect_anomalies(fields, [])[0]
        self.assertEqual(a.anomalyType, "PUBLICATION_ANOMALY")
        self.assertEqual(a.severity, "HIGH")

    def test_role_mismatch_on_authors_is_author_translator_anomaly(self):
        fields = {"authors": result("authors", "INVALID", reasons=["ROLE_MISMATCH"])}
        a = detect_anomalies(fields, [])[0]
        self.assertEqual(a.anomalyType, "AUTHOR_TRANSLATOR_ANOMALY")
        self.assertTrue(a.explanation)

    def test_invalid_isbn_checksum_is_high_severity(self):
        fields = {"isbn": result("isbn", "INVALID", reasons=["INVALID_CHECKSUM"])}
        a = detect_anomalies(fields, [])[0]
        self.assertEqual(a.severity, "HIGH")
        self.assertTrue(a.requiresHumanReview)

    def test_invalid_page_count_is_medium_not_high(self):
        fields = {"pageCount": result("pageCount", "INVALID", reasons=["OUT_OF_RANGE"])}
        a = detect_anomalies(fields, [])[0]
        self.assertEqual(a.anomalyType, "PHYSICAL_METADATA_ANOMALY")
        self.assertEqual(a.severity, "MEDIUM")

    def test_review_required_diacritics_differ_is_medium(self):
        fields = {"publisher": result("publisher", "REVIEW_REQUIRED", value="NXB Trẻ", reasons=["DIACRITICS_DIFFER"])}
        a = detect_anomalies(fields, [])[0]
        self.assertEqual(a.severity, "MEDIUM")
        self.assertTrue(a.requiresHumanReview)

    def test_review_required_barcode_unconfirmed_is_low(self):
        fields = {"isbn": result("isbn", "REVIEW_REQUIRED", value="9786041234567", reasons=["BARCODE_UNCONFIRMED"])}
        a = detect_anomalies(fields, [])[0]
        self.assertEqual(a.severity, "LOW")

    def test_extracted_and_corroborated_and_missing_produce_no_anomaly(self):
        fields = {
            "title": result("title", "EXTRACTED", value="Mắt Biếc"),
            "authors": result("authors", "CORROBORATED", value=["Nguyễn Nhật Ánh"]),
            "subtitle": result("subtitle", "MISSING"),
            "language": result("language", "INFERRED", value="vi"),
        }
        self.assertEqual(detect_anomalies(fields, []), [])


class WarningAnomalyTests(unittest.TestCase):
    def test_images_may_show_different_books_is_critical_cross_source(self):
        a = detect_anomalies({}, ["IMAGES_MAY_SHOW_DIFFERENT_BOOKS"])[0]
        self.assertEqual(a.anomalyType, "CROSS_SOURCE_ANOMALY")
        self.assertEqual(a.severity, "CRITICAL")
        self.assertTrue(a.requiresHumanReview)

    def test_isbn_lookup_title_mismatch_is_informational_only(self):
        # The mismatched record is already not used (reconcile.py's lookup_mismatch) -
        # this is FYI, not something that still needs resolving.
        a = detect_anomalies({}, ["ISBN_LOOKUP_TITLE_MISMATCH"])[0]
        self.assertEqual(a.severity, "MEDIUM")
        self.assertFalse(a.requiresHumanReview)

    def test_unrecognized_warning_codes_are_ignored(self):
        self.assertEqual(detect_anomalies({}, ["ISBN_LOOKUP_NOT_FOUND", "SOME_UNKNOWN_CODE"]), [])


class OrderingTests(unittest.TestCase):
    def test_anomalies_are_sorted_most_severe_first(self):
        fields = {
            "pageCount": result("pageCount", "REVIEW_REQUIRED", value=10, reasons=["PARTIAL_AGREEMENT"]),  # MEDIUM
            "isbn": result("isbn", "CONFLICTED", reasons=["SOURCES_DISAGREE"]),  # CRITICAL
            "publisher": result("publisher", "CONFLICTED", reasons=["SOURCES_DISAGREE"]),  # HIGH
        }
        anomalies = detect_anomalies(fields, [])
        self.assertEqual([a.severity for a in anomalies], ["CRITICAL", "HIGH", "MEDIUM"])


if __name__ == "__main__":
    unittest.main()
