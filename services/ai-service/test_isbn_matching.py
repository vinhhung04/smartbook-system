import unittest

import isbn_matching
from isbn_matching import (
    authors_match, code_namespace, compare_codes, normalize_code, normalize_title, same_work_confidence,
    title_similarity, titles_match, work_fields_only,
)


class CodeTests(unittest.TestCase):
    def test_hyphens_and_spaces_are_removed(self):
        self.assertEqual(normalize_code(" 978-0-13-235088 4 "), "9780132350884")
        self.assertEqual(normalize_code("0-306-40615-x"), "030640615X")

    def test_isbn_and_ean_namespaces(self):
        self.assertEqual(code_namespace("9780132350884"), "isbn")
        self.assertEqual(code_namespace("0132350882"), "isbn")
        self.assertEqual(code_namespace("8935235226272"), "ean")  # Vietnamese publisher EAN, not an ISBN

    def test_exact_code_matches(self):
        self.assertEqual(compare_codes(["978-0-13-235088-4"], {"9780132350884"}), "MATCH")

    def test_other_code_of_the_same_kind_is_a_mismatch(self):
        self.assertEqual(compare_codes(["9780132350891"], {"9780132350884"}), "MISMATCH")
        self.assertEqual(compare_codes(["8935235200524"], {"8935235226272"}), "MISMATCH")

    def test_isbn_cannot_disprove_an_ean(self):
        # A record showing only the book's ISBN neither confirms nor refutes its EAN barcode.
        self.assertEqual(compare_codes(["9786046948506"], {"8935235226272"}), "UNKNOWN")

    def test_record_without_codes_is_unknown(self):
        self.assertEqual(compare_codes([], {"9780132350884"}), "UNKNOWN")


class TitleTests(unittest.TestCase):
    def test_marketplace_noise_is_removed(self):
        self.assertEqual(normalize_title("Sách Nhà Giả Kim (Tái Bản)"), "nha gia kim")
        self.assertEqual(normalize_title("Nhà giả kim (TB 79.000)"), "nha gia kim")
        self.assertEqual(normalize_title("[ĐẶT TRƯỚC] Họ và tên"), "ho va ten")

    def test_same_title_different_listing(self):
        self.assertEqual(title_similarity("Nhà Giả Kim", "Sách Nhà giả kim (Tái Bản 2020)"), 1.0)

    def test_appended_subtitle_or_author(self):
        self.assertTrue(titles_match("Tự Đổ Tách Trà Trước Khi Tràn Ly", "Tự Đổ Tách Trà Trước Khi Tràn Ly - Yong Kang Chan"))

    def test_different_books_and_one_word_prefixes(self):
        self.assertFalse(titles_match("Nhà giả kim", "Nhà lãnh đạo không chức danh"))
        self.assertFalse(titles_match("Đắc", "Đắc nhân tâm"))


class AuthorAndWorkTests(unittest.TestCase):
    identity = {"title": "Nhà giả kim", "authors": ["Paulo Coelho"]}

    def test_author_forms(self):
        self.assertTrue(authors_match(["Paulo Coelho"], ["Coelho, Paulo"]))
        self.assertTrue(authors_match(["Nguyễn Nhật Ánh"], ["nguyen nhat anh"]))
        self.assertTrue(authors_match(["Biên soạn: Khánh Vân"], ["Khánh Vân"]))
        self.assertFalse(authors_match(["Paulo Coelho"], ["Dale Carnegie"]))
        self.assertIsNone(authors_match([], ["Paulo Coelho"]))

    def test_same_work(self):
        self.assertGreater(same_work_confidence(self.identity, {"title": "Sách Nhà Giả Kim", "authors": ["Paulo Coelho"]}), 0.8)

    def test_same_title_other_author_is_not_the_same_work(self):
        self.assertEqual(same_work_confidence(self.identity, {"title": "Nhà giả kim", "authors": ["Người khác"]}), 0.0)

    def test_without_authors_only_an_exact_title_counts(self):
        self.assertEqual(same_work_confidence(self.identity, {"title": "Nhà giả kim (Tái bản)", "authors": []}), 0.75)
        self.assertEqual(same_work_confidence(self.identity, {"title": "Nhà giả kim - The Alchemist", "authors": []}), 0.0)

    def test_title_match_keeps_only_work_fields(self):
        data = work_fields_only({"title": "T", "authors": ["A"], "publisher": "NXB", "pageCount": 100,
                                 "translator": ["D"], "thumbnail": "x", "sourceUrl": "u"})
        self.assertEqual((data["title"], data["authors"], data["sourceUrl"]), ("T", ["A"], "u"))
        for edition_field in ("publisher", "pageCount", "thumbnail", "publishedDate"):
            self.assertIsNone(data[edition_field])
        self.assertEqual(data["translator"], [])
        self.assertEqual(data["sourceFetchMode"], isbn_matching.TITLE_MATCH_MODE)


if __name__ == "__main__":
    unittest.main()
