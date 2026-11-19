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


EAN = "8935325011894"      # retail EAN-13 printed on "Đắc Nhân Tâm" (AZ Việt Nam)
EAN_ISBN = "9786043927436"  # the ISBN the same product page states
OTHER_ISBN = "9786043757903"
DNT = {"title": "Đắc Nhân Tâm", "authors": ["Dale Carnegie"], "publisher": "NXB Thế Giới", "publishedDate": "2023"}


def code_record(*codes, verification="CODE_MATCH", **fields):
    return {**DNT, **fields, "identifiers": list(codes), "sourceUrl": "https://store.test/p",
            "_provenance": {"verification": verification}}


class CrossIdentifyTests(unittest.TestCase):
    def test_ean13_check_digit(self):
        self.assertTrue(isbn_matching.ean13_valid(EAN))
        self.assertTrue(isbn_matching.ean13_valid("8935309501694"))
        self.assertFalse(isbn_matching.ean13_valid("8935309501695"))
        self.assertFalse(isbn_matching.ean13_valid("893530950169"))

    def test_no_record_states_an_isbn_is_not_found_and_no_isbn_is_made_up(self):
        out = isbn_matching.cross_identify(EAN, {"a": code_record(EAN)}, DNT)
        self.assertEqual((out["direction"], out["status"], out["value"]), ("EAN_TO_ISBN", "NOT_FOUND", None))

    def test_one_source_stating_both_codes_needs_review(self):
        out = isbn_matching.cross_identify(EAN, {"a": code_record(EAN, EAN_ISBN)}, DNT)
        self.assertEqual((out["status"], out["value"], out["reasons"]), ("REVIEW_REQUIRED", EAN_ISBN, ["SINGLE_SOURCE"]))
        self.assertEqual(out["evidence"][0]["codes"], [EAN_ISBN])
        self.assertEqual(out["evidence"][0]["sourceUrl"], "https://store.test/p")

    def test_two_sources_agreeing_verify_and_isbn10_follows_978(self):
        out = isbn_matching.cross_identify(EAN, {"a": code_record(EAN, EAN_ISBN), "b": code_record(EAN, EAN_ISBN)}, DNT)
        self.assertEqual((out["status"], out["value"], out["isbn10"]), ("VERIFIED", EAN_ISBN, "6043927438"))

    def test_the_librarys_catalog_alone_verifies(self):
        out = isbn_matching.cross_identify(EAN, {"catalog": code_record(EAN, EAN_ISBN)}, DNT)
        self.assertEqual((out["status"], out["reasons"]), ("VERIFIED", ["CATALOG_RECORD"]))

    def test_sources_stating_different_isbns_conflict(self):
        out = isbn_matching.cross_identify(EAN, {"a": code_record(EAN, EAN_ISBN), "b": code_record(EAN, OTHER_ISBN)}, DNT)
        self.assertEqual((out["status"], out["value"]), ("CONFLICTED", None))

    def test_a_record_about_another_book_conflicts(self):
        out = isbn_matching.cross_identify(EAN, {"a": code_record(EAN, EAN_ISBN, title="Hoàng Tử Bé"),
                                                 "b": code_record(EAN, EAN_ISBN)}, DNT)
        self.assertEqual(out["status"], "CONFLICTED")
        self.assertIn("TITLE_MISMATCH", out["reasons"])

    def test_publisher_or_year_difference_needs_review_even_with_two_sources(self):
        out = isbn_matching.cross_identify(EAN, {"a": code_record(EAN, EAN_ISBN, publishedDate="2016"),
                                                 "b": code_record(EAN, EAN_ISBN)}, DNT)
        self.assertEqual((out["status"], out["reasons"]), ("REVIEW_REQUIRED", ["YEAR_DIFFERS"]))

    def test_title_only_matches_and_records_without_the_scanned_code_are_no_evidence(self):
        records = {"a": code_record(EAN, EAN_ISBN, verification="TITLE_MATCH"),
                   "b": code_record(EAN_ISBN)}  # found by the ISBN alone: does not show the EAN
        self.assertEqual(isbn_matching.cross_identify(EAN, records, DNT)["status"], "NOT_FOUND")

    def test_isbn_scan_offers_the_retail_ean_a_record_states(self):
        out = isbn_matching.cross_identify(EAN_ISBN, {"a": code_record(EAN_ISBN, EAN)}, DNT)
        self.assertEqual((out["direction"], out["status"], out["value"]), ("ISBN_TO_EAN", "REVIEW_REQUIRED", EAN))
        self.assertIsNone(out["isbn10"])

    def test_isbn_scan_never_offers_a_bad_check_digit_or_another_isbn_as_ean(self):
        out = isbn_matching.cross_identify(EAN_ISBN, {"a": code_record(EAN_ISBN, "8935325011895", OTHER_ISBN)}, DNT)
        self.assertEqual(out["status"], "NOT_FOUND")


NVIDIA_EAN = "8936230471834"
NVIDIA = {"title": "[Phiên chợ sách cũ] NVIDIA - Cỗ Máy Tư Duy Vĩ Đại", "publisher": "Công Thương", "authors": ["Stephen Witt"]}


def register_row(isbn="9786326120363", **fields):
    return {"title": "NVIDIA: Cỗ máy tư duy vĩ đại: Jensen Huang và cuộc cách mạng chip AI toàn cầu",
            "publisher": "NXB Công Thương", "authors": ["Stephen Witt"], "identifiers": [isbn],
            "sourceUrl": "https://ppdvn.gov.vn/web/guest/tra-cuu-luu-chieu?query=x", **fields}


class RegistryLinkTests(unittest.TestCase):
    """EAN -> ISBN from the legal-deposit register: title + publisher (+ authors), REVIEW at best."""
    NOT_FOUND = isbn_matching.cross_identify(NVIDIA_EAN, {}, NVIDIA)

    def test_title_publisher_and_author_match_is_offered_for_review_only(self):
        out = isbn_matching.registry_link(self.NOT_FOUND, NVIDIA, [register_row()])
        self.assertEqual((out["status"], out["value"], out["isbn10"]), ("REVIEW_REQUIRED", "9786326120363", "6326120365"))
        self.assertEqual(out["reasons"], ["LEGAL_DEPOSIT_TITLE_MATCH", "PUBLISHER_MATCH", "AUTHOR_MATCH"])
        self.assertEqual((out["evidence"][0]["source"], out["evidence"][0]["basis"]), ("ppdvn", "TITLE_PUBLISHER_AUTHOR"))

    def test_the_title_alone_is_never_enough(self):
        other_publisher = isbn_matching.registry_link(self.NOT_FOUND, NVIDIA, [register_row(publisher="NXB Thế Giới")])
        self.assertEqual(other_publisher["status"], "NOT_FOUND")
        no_publisher = isbn_matching.registry_link(self.NOT_FOUND, {**NVIDIA, "publisher": None}, [register_row()])
        self.assertEqual(no_publisher["status"], "NOT_FOUND")
        other_author = isbn_matching.registry_link(self.NOT_FOUND, NVIDIA, [register_row(authors=["Nguyễn Văn A"])])
        self.assertEqual(other_author["status"], "NOT_FOUND")
        other_title = isbn_matching.registry_link(self.NOT_FOUND, NVIDIA, [register_row(title="Đắc Nhân Tâm")])
        self.assertEqual(other_title["status"], "NOT_FOUND")

    def test_an_author_name_spaced_differently_is_the_same_author(self):
        # Store "Renee Mc Gregor" vs register "Renee McGregor" (8935280905528 -> 978-604-9885-82-2).
        book = {"title": "Ám Ảnh Ăn Sạch", "publisher": "NXB Công Thương", "authors": ["Renee Mc Gregor"], "publishedDate": "2020"}
        row = register_row("9786049885822", title="Ám ảnh ăn sạch", publisher="NXB Công Thương", authors=["Renee McGregor"],
                           depositDates=["05/03/2020"])
        out = isbn_matching.registry_link(isbn_matching.cross_identify("8935280905528", {}, book), book, [row])
        self.assertEqual((out["status"], out["value"]), ("REVIEW_REQUIRED", "9786049885822"))
        self.assertIn("AUTHOR_MATCH", out["reasons"])
        self.assertTrue(authors_match(["Mc Gregor, Renee"], ["Renee McGregor"]))
        self.assertFalse(authors_match(["Renee McGregor"], ["Renee McGraw"]))

    def test_unknown_authors_still_need_title_and_publisher_and_say_so(self):
        out = isbn_matching.registry_link(self.NOT_FOUND, {**NVIDIA, "authors": []}, [register_row()])
        self.assertEqual(out["status"], "REVIEW_REQUIRED")
        self.assertIn("AUTHORS_UNCHECKED", out["reasons"])

    def test_several_isbns_for_the_same_title_and_publisher_conflict(self):
        out = isbn_matching.registry_link(self.NOT_FOUND, NVIDIA, [register_row(), register_row("9786326120370")])
        self.assertEqual((out["status"], out["value"], out["preferred"]), ("CONFLICTED", None, None))
        self.assertEqual(out["reasons"], ["LEGAL_DEPOSIT_SEVERAL_ISBNS", "PUBLISHER_MATCH", "AUTHOR_MATCH"])
        self.assertEqual({c["value"] for c in out["candidates"]}, {"9786326120363", "9786326120370"})

    def test_reprints_list_every_isbn_and_prefer_the_one_deposited_in_the_editions_year(self):
        # "Không Bao Giờ Là Thất Bại! (Tái Bản 2023)": one EAN, a new ISBN at each reprint.
        book = {"title": "Không Bao Giờ Là Thất Bại! Tất Cả Là Thử Thách (Tái Bản 2023)", "publisher": "NXB Dân Trí",
                "authors": ["Chung Ju Yung"], "publishedDate": "2023"}
        title = "Không bao giờ là thất bại! Tất cả là thử thách – Tự truyện"
        rows = [register_row("9786043444810", title=title, publisher="NXB Dân trí", authors=["Chung Ju-yung"],
                             depositDates=["08/12/2021"], partner="First News"),
                register_row("9786048863135", title=title, publisher="NXB Dân trí", authors=["Chung Ju-yung"],
                             depositDates=["17/03/2023"], partner="First News"),
                register_row("9786044041636", title=title, publisher="NXB Dân trí", authors=["Chung Ju-yung"],
                             depositDates=["20/08/2024", "02/04/2025"], partner="First News"),
                register_row("9786047778478", title=title, publisher="NXB Thế giới", authors=["Chung Ju-Yung"],
                             depositDates=["14/11/2023"])]  # another publisher: not this edition
        cross = isbn_matching.cross_identify("8935086857403", {}, book)
        out = isbn_matching.registry_link(cross, book, rows)
        self.assertEqual((out["status"], out["value"], out["preferred"]), ("CONFLICTED", None, "9786048863135"))
        self.assertIn("PREFERRED_BY_YEAR", out["reasons"])
        self.assertEqual([c["value"] for c in out["candidates"]], ["9786048863135", "9786044041636", "9786043444810"])
        self.assertEqual(out["candidates"][1]["depositDates"], ["20/08/2024", "02/04/2025"])
        self.assertEqual((out["candidates"][0]["partner"], out["candidates"][0]["isbn10"]), ("First News", "6048863136"))

    def test_no_preference_when_no_or_several_candidates_share_the_editions_year(self):
        rows = [register_row(depositDates=["01/01/2022"]), register_row("9786326120370", depositDates=["01/06/2022"])]
        out = isbn_matching.registry_link(self.NOT_FOUND, {**NVIDIA, "publishedDate": "2022"}, rows)
        self.assertIsNone(out["preferred"])
        out = isbn_matching.registry_link(self.NOT_FOUND, {**NVIDIA, "publishedDate": "2019"}, rows)
        self.assertIsNone(out["preferred"])


def store_record(ean, verification="TITLE_MATCH", **edition):
    edition = {"publisher": "NXB Phụ Nữ Việt Nam", "publishedDate": "2022", "authors": ["Antoine de Saint-Exupéry"], **edition}
    return {"title": "Hoàng Tử Bé", "authors": edition["authors"], "identifiers": [ean], "sourceUrl": f"https://store.test/{ean}",
            "publisher": None, "publishedDate": None, "_edition": edition, "_provenance": {"verification": verification}}


class StoreEanLinkTests(unittest.TestCase):
    """ISBN -> retail EAN-13 from stores found by title: same rules as the register."""
    BOOK = {"title": "Hoàng Tử Bé", "publisher": "Phụ Nữ Việt Nam", "authors": ["Antoine de Saint-Exupéry"], "publishedDate": "2022"}
    NOT_FOUND = isbn_matching.cross_identify("9786043757903", {}, BOOK)

    def test_a_title_publisher_author_match_offers_its_ean_for_review(self):
        out = isbn_matching.store_ean_link(self.NOT_FOUND, self.BOOK, {"tiki": store_record("8935325018732")})
        self.assertEqual((out["direction"], out["status"], out["value"]), ("ISBN_TO_EAN", "REVIEW_REQUIRED", "8935325018732"))
        self.assertEqual(out["reasons"], ["STORE_TITLE_MATCH", "PUBLISHER_MATCH", "AUTHOR_MATCH"])
        self.assertIsNone(out["isbn10"])

    def test_another_publisher_an_isbn_or_a_bad_check_digit_is_never_offered(self):
        records = {"a": store_record("8935325018732", publisher="NXB Kim Đồng"),
                   "b": store_record("9786043757903"), "c": store_record("8935325018733")}
        self.assertEqual(isbn_matching.store_ean_link(self.NOT_FOUND, self.BOOK, records)["status"], "NOT_FOUND")

    def test_several_eans_are_candidates_and_the_editions_year_is_preferred(self):
        records = {"a": store_record("8935325018732"), "b": store_record("8935235226272", publishedDate="2019")}
        out = isbn_matching.store_ean_link(self.NOT_FOUND, self.BOOK, records)
        self.assertEqual((out["status"], out["preferred"]), ("CONFLICTED", "8935325018732"))
        self.assertEqual([c["value"] for c in out["candidates"]], ["8935325018732", "8935235226272"])

    def test_an_ean_scan_or_an_already_linked_isbn_is_left_alone(self):
        ean_scan = isbn_matching.cross_identify("8935325018732", {}, self.BOOK)
        self.assertIs(isbn_matching.store_ean_link(ean_scan, self.BOOK, {"a": store_record("8935325018732")}), ean_scan)

    def test_a_link_found_from_store_records_or_an_isbn_scan_is_left_alone(self):
        found = isbn_matching.cross_identify(EAN, {"a": code_record(EAN, EAN_ISBN)}, DNT)
        self.assertIs(isbn_matching.registry_link(found, DNT, [register_row()]), found)
        isbn_scan = isbn_matching.cross_identify(EAN_ISBN, {}, DNT)
        self.assertIs(isbn_matching.registry_link(isbn_scan, DNT, [register_row()]), isbn_scan)


if __name__ == "__main__":
    unittest.main()
