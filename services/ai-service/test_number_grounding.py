"""Unit tests for number_grounding.py - the value-and-tolerance number
matching shared by rag.verify_numeric_grounding (production) and
eval/scoring.py's hallucinated_numbers (the stricter thesis measurement)."""
import unittest

from number_grounding import display_number, numbers_match, parse_number_candidates, parse_numbers


class ParseNumbersTests(unittest.TestCase):
    def test_plain_integer(self):
        self.assertIn(27.0, parse_numbers("Có 27 phiếu quá hạn"))

    def test_vietnamese_thousands_separator(self):
        # "50.000" in VN convention is fifty thousand.
        self.assertIn(50000.0, parse_numbers("Phạt 50.000đ"))

    def test_english_decimal_point(self):
        self.assertIn(163.4, parse_numbers("average 163.4 days"))

    def test_vietnamese_decimal_comma(self):
        self.assertIn(5.2, parse_numbers("trung bình 5,2 ngày"))

    def test_none_text_yields_empty_list(self):
        self.assertEqual(parse_numbers(None), [])

    def test_no_digits_yields_empty_list(self):
        self.assertEqual(parse_numbers("không có số liệu nào"), [])

    def test_ambiguous_token_yields_both_interpretations(self):
        # "1.234" could be 1234 (VN thousands) or 1.234 (EN decimal) - both
        # are kept so a comparison only needs one to match.
        numbers = parse_numbers("1.234")
        self.assertIn(1234.0, numbers)
        self.assertIn(1.234, numbers)


class ParseNumberCandidatesTests(unittest.TestCase):
    """Regression coverage for a false-positive found via a live Claude
    smoke test while building the grounding retry: "500.000" (VN: 500000)
    also parses as 500.0 under the EN convention, and a naive flat check
    flagged that unintended second reading as ungrounded even though the
    intended one matched the real data exactly."""

    def test_groups_both_interpretations_of_one_token_together(self):
        groups = parse_number_candidates("500.000")
        self.assertEqual(len(groups), 1)
        self.assertIn(500000.0, groups[0])
        self.assertIn(500.0, groups[0])

    def test_parse_numbers_still_returns_the_flattened_form(self):
        flat = parse_numbers("500.000")
        self.assertIn(500000.0, flat)
        self.assertIn(500.0, flat)

    def test_simple_integer_yields_a_single_candidate_group(self):
        groups = parse_number_candidates("27 phiếu")
        self.assertEqual(groups, [[27.0]])

    def test_a_token_whose_intended_reading_matches_is_not_ambiguous_after_grouping(self):
        # This is the actual bug: checking "500.000"'s two interpretations
        # (500000.0, 500.0) independently against grounded=[500000.0] used to
        # flag 500.0 as unverified even though the token's OTHER reading -
        # the one a Vietnamese reader actually meant - matched exactly.
        groups = parse_number_candidates("Tổng cộng 500.000 ₫")
        grounded = [500000.0]
        unverified = [g[0] for g in groups if not any(numbers_match(v, grounded) for v in g)]
        self.assertEqual(unverified, [])


class NumbersMatchTests(unittest.TestCase):
    def test_exact_match(self):
        self.assertTrue(numbers_match(27.0, [10.0, 27.0]))

    def test_no_match(self):
        self.assertFalse(numbers_match(9999.0, [10.0, 27.0]))

    def test_relative_tolerance_default(self):
        # default tolerance 0.01 (1%) - 1000 vs 1005 is within 1%.
        self.assertTrue(numbers_match(1000.0, [1005.0]))
        self.assertFalse(numbers_match(1000.0, [1200.0]))

    def test_absolute_tolerance_when_out_of_0_1_range(self):
        self.assertTrue(numbers_match(100.0, [105.0], tolerance=10))
        self.assertFalse(numbers_match(100.0, [120.0], tolerance=10))

    def test_empty_candidates_never_matches(self):
        self.assertFalse(numbers_match(27.0, []))


class DisplayNumberTests(unittest.TestCase):
    def test_whole_float_drops_decimal_point(self):
        self.assertEqual(display_number(27.0), "27")

    def test_fractional_float_is_kept(self):
        self.assertEqual(display_number(5.2), "5.2")

    def test_int_is_unaffected(self):
        self.assertEqual(display_number(27), "27")


if __name__ == "__main__":
    unittest.main()
