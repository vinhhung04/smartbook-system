import unittest

from main import _check_book_quality

AD = ("How is the Earn2Trade Discount Code BONUS99 one of the best offers? It provides a 60% discount on eligible "
      "programs. Customers should check that the discount is reflected in the final checkout price.")
EN = ("Even bad code can function. But if code isn't clean, it can bring a development organization to its knees. "
      "Robert C. Martin presents a revolutionary paradigm with Clean Code.")


def check(description: str, language: str | None = None) -> list[str]:
    return _check_book_quality("Clean Code", ["Robert C. Martin"], "Prentice Hall", description, ["Lập trình"], language)


class BookQualityTest(unittest.TestCase):
    def test_promotional_description_is_flagged(self):
        self.assertTrue(any("quảng cáo" in warning for warning in check(AD, "en")))

    def test_english_description_of_an_english_book_is_not_flagged_as_not_vietnamese(self):
        self.assertEqual(check(EN, "en"), [])

    def test_english_description_of_a_vietnamese_or_unknown_book_still_is(self):
        self.assertTrue(any("tiếng Việt" in warning for warning in check(EN, "vi")))
        self.assertTrue(any("tiếng Việt" in warning for warning in check(EN)))


if __name__ == "__main__":
    unittest.main()
