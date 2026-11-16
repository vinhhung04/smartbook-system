"""Phase 0 benchmark integrity: offline, deterministic (no DB, no network)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "eval"))
import rag_integrity  # noqa: E402
import scoring  # noqa: E402

BOOKS = [
    {"id": "b1", "title": "Mắt Biếc (Tái Bản 2022)", "author": "Nguyễn Nhật Ánh", "isbn": "8934974163442"},
    {"id": "b2", "title": "Atomic Habits", "author": "James Clear", "isbn": "9780735211292"},
    {"id": "b3", "title": "Project Hail Mary", "author": "Andy Weir", "isbn": "9780593135204"},
]


def case(case_id, question, expected, corpus="BOOK_METADATA"):
    return {"id": case_id, "corpus": corpus, "question": question, "expected_ids": expected,
            "expected_facts": [], "note": ""}


class CommittedDatasetTests(unittest.TestCase):
    """Guards the files the published benchmark numbers come from."""

    def test_rag_dataset_is_structurally_valid(self):
        dataset = rag_integrity.load_json(rag_integrity.DATASET_PATH)
        errors = rag_integrity.validate_structure(
            dataset, rag_integrity.corpus_doc_ids(), set(rag_integrity.label_snapshot_books()))
        self.assertEqual(errors, [])

    def test_both_corpora_keep_answerable_and_no_answer_cases(self):
        dataset = rag_integrity.load_json(rag_integrity.DATASET_PATH)
        for corpus in rag_integrity.CORPORA:
            rows = [e for e in dataset if e["corpus"] == corpus]
            self.assertGreaterEqual(sum(1 for e in rows if e["expected_ids"]), 50, corpus)
            self.assertGreaterEqual(sum(1 for e in rows if not e["expected_ids"]), 20, corpus)

    def test_review_file_only_names_existing_cases(self):
        ids = {e["id"] for e in rag_integrity.load_json(rag_integrity.DATASET_PATH)}
        review = rag_integrity.load_json(rag_integrity.REVIEW_PATH)
        self.assertLessEqual(set(review["cases"]), ids)
        for entry in review["cases"].values():
            self.assertTrue(entry["flag"] and entry["reason"])

    def test_supplement_is_valid_reachable_and_its_mechanical_labels_rederive(self):
        path = os.path.join(rag_integrity.EVAL_DIR, "rag_dataset_supplement.json")
        supplement = rag_integrity.load_dataset(path)
        catalog = rag_integrity.load_json(os.path.join(rag_integrity.EVAL_DIR, "rag_catalog_snapshot_20261115.json"))
        by_id = {b["id"]: b for b in catalog}
        self.assertEqual(rag_integrity.validate_structure(
            supplement, rag_integrity.corpus_doc_ids(), set(rag_integrity.label_snapshot_books())), [])
        cases = rag_integrity.audit(supplement, catalog, review=None)["cases"]
        for entry in supplement:
            info = cases[entry["id"]]
            self.assertIn(info["status"], ("REACHABLE", "NO_ANSWER"), entry["id"])
            self.assertEqual(info["trusted"], entry["verification"] == "mechanical", entry["id"])
            if entry["group"] == "isbn_exact":
                digits = "".join(ch for ch in entry["question"] if ch.isdigit())
                self.assertEqual([by_id[i]["isbn"] for i in entry["expected_ids"]], [digits])

    def test_audit_against_committed_snapshot_finds_known_drift(self):
        dataset = rag_integrity.load_json(rag_integrity.DATASET_PATH)
        catalog = rag_integrity.load_json(os.path.join(rag_integrity.EVAL_DIR, "rag_catalog_snapshot_20261115.json"))
        cases = rag_integrity.audit(dataset, catalog, review=None)["cases"]
        self.assertEqual(cases["bm-001"]["status"], "UNREACHABLE")      # seed book removed from the catalog
        self.assertEqual(cases["bm-096"]["status"], "STALE_NO_ANSWER")  # Atomic Habits added later
        self.assertIn("LABEL_AUTHOR_MISMATCH", cases["bm-038"]["flags"])
        self.assertTrue(all(info["status"] in ("REACHABLE", "NO_ANSWER")
                            for info in cases.values() if info["corpus"] == "INTERNAL_DOC"))


class StructureTests(unittest.TestCase):
    def test_reports_duplicates_unknown_ids_and_bad_fields(self):
        dataset = [
            case("a", "Tìm sách ISBN 1", ["b1"]),
            case("a", "Câu khác", []),
            case("c", "tim sach isbn 1", []),                       # same question after normalization
            case("d", "Phạt bao nhiêu?", ["no-such-doc"], "INTERNAL_DOC"),
            case("e", "x", ["b9"]),
            {"id": "f", "corpus": "BOOK_METADATA", "question": "x"},
        ]
        errors = "\n".join(rag_integrity.validate_structure(dataset, {"fine-calculation"}, {"b1"}))
        for needle in ("a: duplicate id", "c: same question as a", "no-such-doc", "'b9'", "f: missing"):
            self.assertIn(needle, errors)


class ClassifyTests(unittest.TestCase):
    catalog = {b["id"]: b for b in BOOKS}

    def test_reachability(self):
        available = set(self.catalog)
        self.assertEqual(rag_integrity.classify(case("x", "q", ["b1", "b2"]), available)["status"], "REACHABLE")
        partial = rag_integrity.classify(case("x", "q", ["b1", "gone"]), available)
        self.assertEqual((partial["status"], partial["reachable_ids"]), ("PARTIALLY_REACHABLE", ["b1"]))
        self.assertEqual(rag_integrity.classify(case("x", "q", ["gone"]), available)["status"], "UNREACHABLE")

    def test_no_answer_that_names_a_catalog_title_is_stale(self):
        stale = rag_integrity.classify(case("x", "Có sách Atomic Habits không?", []), set(self.catalog), self.catalog)
        self.assertEqual(stale["status"], "STALE_NO_ANSWER")
        fine = rag_integrity.classify(case("x", "Có sách dạy nấu ăn không?", []), set(self.catalog), self.catalog)
        self.assertEqual(fine["status"], "NO_ANSWER")

    def test_author_case_expecting_another_authors_book_is_flagged(self):
        bad = rag_integrity.classify(case("x", "Sách nào của nhà văn Tô Hoài?", ["b3"]), set(self.catalog), self.catalog)
        self.assertIn("LABEL_AUTHOR_MISMATCH", bad["flags"])
        good = rag_integrity.classify(case("x", "Sách nào của nhà văn Nguyễn Nhật Ánh?", ["b1"]),
                                      set(self.catalog), self.catalog)
        self.assertEqual(good["flags"], [])

    def test_remap_candidates_match_isbn_or_edition_free_title_only(self):
        label_books = {"old": {"id": "old", "title": "Mat biec", "isbn": "000"}}
        found = rag_integrity.remap_candidates(case("x", "q", ["old"]), set(self.catalog), self.catalog, label_books)
        self.assertEqual([c["candidate"] for c in found], ["b1"])


class TrustedSubsetTests(unittest.TestCase):
    def test_manual_flag_untrusts_and_partial_is_scored_on_reachable_ids(self):
        dataset = [case("p", "q1", ["b1", "gone"]), case("n", "q2", []), case("u", "q3", ["gone"])]
        review = {"cases": {"n": {"flag": "QUESTIONABLE_LABEL", "reason": "r"}}}
        cases = rag_integrity.audit(dataset, BOOKS, doc_ids=set(), review=review, label_books={})["cases"]
        self.assertEqual([cid for cid, info in cases.items() if info["trusted"]], ["p"])
        results = [{"id": e["id"], "expected_ids": e["expected_ids"], "retrieved_ids": ["b1"]} for e in dataset]
        trusted = rag_integrity.trusted_results(results, cases)
        self.assertEqual(trusted[0]["expected_ids"], ["b1"])
        self.assertEqual(scoring.recall_at_k(trusted[0]["retrieved_ids"], trusted[0]["expected_ids"], 1), 1.0)


class ManifestTests(unittest.TestCase):
    def test_manifest_identifies_dataset_catalog_corpus_and_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ds.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump([case("a", "q", [])], handle)
            manifest = rag_integrity.build_manifest(path, BOOKS, "qwen/qwen3-embedding-8b@768", {"split": "all"})
        self.assertEqual(manifest["dataset"]["cases"], 1)
        self.assertEqual(manifest["embedding"], {"model": "qwen/qwen3-embedding-8b", "dimensions": 768})
        self.assertEqual(manifest["catalog"]["books"], 3)
        self.assertGreater(manifest["corpus"]["documents"], 0)
        self.assertEqual(manifest["config"], {"split": "all"})
        self.assertIn("commit", manifest["git"])

    def test_catalog_identity_changes_with_indexed_text_not_order(self):
        same = rag_integrity.catalog_identity(list(reversed(BOOKS)))["sha256"]
        self.assertEqual(rag_integrity.catalog_identity(BOOKS)["sha256"], same)
        edited = [{**BOOKS[0], "description": "new"}, *BOOKS[1:]]
        self.assertNotEqual(rag_integrity.catalog_identity(edited)["sha256"], same)


class NormalizeTests(unittest.TestCase):
    def test_d_with_stroke_is_folded_not_dropped(self):
        self.assertEqual(scoring.normalize_for_match("Đi Qua Hoa Cúc"), "di qua hoa cuc")


if __name__ == "__main__":
    unittest.main()
