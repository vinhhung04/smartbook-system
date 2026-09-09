from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "eval"))
import scoring  # noqa: E402


class FuzzyMatchTests(unittest.TestCase):
    def test_identical_strings_match(self):
        self.assertTrue(scoring.field_matches("Dế Mèn phiêu lưu ký", "Dế Mèn phiêu lưu ký"))

    def test_accent_and_case_differences_still_match(self):
        self.assertTrue(scoring.field_matches("Nguyễn Nhật Ánh", "nguyen nhat anh"))

    def test_unrelated_strings_do_not_match(self):
        self.assertFalse(scoring.field_matches("Dế Mèn phiêu lưu ký", "Harry Potter"))

    def test_empty_expected_is_always_considered_matched(self):
        self.assertTrue(scoring.field_matches(None, "anything"))
        self.assertTrue(scoring.field_matches("", "anything"))

    def test_empty_actual_against_real_expected_is_a_miss(self):
        self.assertFalse(scoring.field_matches("Dế Mèn phiêu lưu ký", None))
        self.assertFalse(scoring.field_matches("Dế Mèn phiêu lưu ký", ""))

    def test_minor_punctuation_difference_still_matches(self):
        self.assertTrue(scoring.field_matches("NXB Trẻ", "NXB Tre"))


class AuthorsMatchTests(unittest.TestCase):
    def test_all_expected_authors_found_regardless_of_order(self):
        self.assertTrue(scoring.authors_match(["Nguyễn Nhật Ánh"], ["J.K. Rowling", "Nguyen Nhat Anh"]))

    def test_missing_one_expected_author_fails(self):
        self.assertFalse(scoring.authors_match(["Nguyễn Nhật Ánh", "Tô Hoài"], ["Nguyen Nhat Anh"]))

    def test_no_expected_authors_always_matches(self):
        self.assertTrue(scoring.authors_match([], []))
        self.assertTrue(scoring.authors_match([], ["Someone"]))

    def test_expected_authors_with_no_actual_authors_fails(self):
        self.assertFalse(scoring.authors_match(["Nguyễn Nhật Ánh"], []))


class YearMatchTests(unittest.TestCase):
    def test_exact_year_string_matches(self):
        self.assertTrue(scoring.year_matches(2020, "2020"))

    def test_full_date_string_matches_on_year_only(self):
        self.assertTrue(scoring.year_matches(2020, "2020-03-15"))

    def test_wrong_year_fails(self):
        self.assertFalse(scoring.year_matches(2020, "2019-03-15"))

    def test_no_expected_year_always_matches(self):
        self.assertTrue(scoring.year_matches(None, None))

    def test_expected_year_with_missing_actual_fails(self):
        self.assertFalse(scoring.year_matches(2020, None))


class ExtractionAggregationTests(unittest.TestCase):
    def test_aggregates_field_accuracy_across_results(self):
        results = [
            {"title_match": True, "authors_match": True, "publisher_match": True, "year_match": True, "found": True},
            {"title_match": True, "authors_match": False, "publisher_match": True, "year_match": False, "found": True},
        ]
        summary = scoring.aggregate_extraction_scores(results)
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["found_rate"], 1.0)
        self.assertEqual(summary["field_accuracy"]["title_match"], 1.0)
        self.assertEqual(summary["field_accuracy"]["authors_match"], 0.5)
        self.assertEqual(summary["all_fields_correct_rate"], 0.5)

    def test_empty_results_do_not_divide_by_zero(self):
        self.assertEqual(scoring.aggregate_extraction_scores([]), {"total": 0})


class ToolSelectionVerdictTests(unittest.TestCase):
    def test_exact_match(self):
        verdict = scoring.tool_selection_verdict(["get_reorder_suggestions"], ["get_reorder_suggestions"])
        self.assertTrue(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 1.0)
        self.assertEqual(verdict["recall"], 1.0)

    def test_extra_unwanted_tool_call_hurts_precision_not_recall(self):
        verdict = scoring.tool_selection_verdict(["get_reorder_suggestions"], ["get_reorder_suggestions", "get_top_books"])
        self.assertFalse(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 0.5)
        self.assertEqual(verdict["recall"], 1.0)

    def test_missed_required_tool_hurts_recall_not_precision(self):
        verdict = scoring.tool_selection_verdict(["get_reorder_suggestions", "get_top_books"], ["get_reorder_suggestions"])
        self.assertFalse(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 1.0)
        self.assertEqual(verdict["recall"], 0.5)

    def test_no_tools_expected_and_none_called_is_a_perfect_match(self):
        verdict = scoring.tool_selection_verdict([], [])
        self.assertTrue(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 1.0)
        self.assertEqual(verdict["recall"], 1.0)

    def test_unexpected_tool_call_when_none_expected_is_zero_precision(self):
        verdict = scoring.tool_selection_verdict([], ["get_top_books"])
        self.assertFalse(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 0.0)


class ToolSelectionAggregationTests(unittest.TestCase):
    def test_aggregates_across_verdicts(self):
        verdicts = [
            {"exact_match": True, "precision": 1.0, "recall": 1.0},
            {"exact_match": False, "precision": 0.5, "recall": 1.0},
        ]
        summary = scoring.aggregate_tool_selection_scores(verdicts)
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["exact_match_rate"], 0.5)
        self.assertEqual(summary["avg_precision"], 0.75)
        self.assertEqual(summary["avg_recall"], 1.0)

    def test_empty_verdicts_do_not_divide_by_zero(self):
        self.assertEqual(scoring.aggregate_tool_selection_scores([]), {"total": 0})


class ParseNumbersTests(unittest.TestCase):
    def test_parses_a_plain_integer_and_a_decimal(self):
        numbers = scoring.parse_numbers("27 phiếu, trung bình 163.4 ngày")
        self.assertIn(27.0, numbers)
        self.assertIn(163.4, numbers)

    def test_both_thousands_conventions_are_offered_for_an_ambiguous_token(self):
        numbers = scoring.parse_numbers("Tổng cộng 50.000 đồng")
        # EN convention (',' thousands, '.' decimal) reads it as 50.0;
        # VN convention ('.' thousands) reads it as 50000 - both must be present
        # so a comparison against either the raw amount or its VND form matches.
        self.assertIn(50.0, numbers)
        self.assertIn(50000.0, numbers)

    def test_no_numbers_in_plain_text(self):
        self.assertEqual(scoring.parse_numbers("không có số liệu nào ở đây"), [])


class NumberRecallTests(unittest.TestCase):
    def test_matches_within_absolute_tolerance(self):
        required = [{"field": "x", "expected": 163.4, "tolerance": 0.05}]
        result = scoring.number_recall("Trung bình khoảng 163.4 ngày", required)
        self.assertEqual(result["matched"], ["x"])
        self.assertEqual(result["recall"], 1.0)

    def test_missing_number_is_reported(self):
        required = [{"field": "x", "expected": 999, "tolerance": 0}]
        result = scoring.number_recall("Có 27 phiếu quá hạn", required)
        self.assertEqual(result["missing"], ["x"])
        self.assertEqual(result["recall"], 0.0)

    def test_a_field_with_no_resolved_value_is_skipped_not_missed(self):
        required = [{"field": "x", "expected": None, "tolerance": 0}]
        result = scoring.number_recall("bất kỳ nội dung gì", required)
        self.assertEqual(result["matched"], [])
        self.assertEqual(result["missing"], [])
        self.assertIsNone(result["recall"])

    def test_relative_tolerance_scales_with_the_expected_value(self):
        required = [{"field": "x", "expected": 1000, "tolerance": 0.1}]  # 0<t<1 => relative
        result = scoring.number_recall("khoảng 1050", required)
        self.assertEqual(result["recall"], 1.0)


class FactRecallTests(unittest.TestCase):
    def test_any_accepted_surface_form_counts_as_matched(self):
        required = [["qua han", "tre han", "overdue"]]
        result = scoring.fact_recall("Sách này đang trễ hạn trả", required)
        self.assertEqual(result["recall"], 1.0)

    def test_accent_insensitive_matching(self):
        required = [["quá hạn"]]
        result = scoring.fact_recall("hien co 5 sach qua han", required)
        self.assertEqual(result["recall"], 1.0)

    def test_missing_fact_is_reported(self):
        required = [["ton kho thap"]]
        result = scoring.fact_recall("moi thu deu binh thuong", required)
        self.assertEqual(result["missing"], ["ton kho thap"])


class ForbiddenHitsTests(unittest.TestCase):
    def test_flags_a_forbidden_phrase_present_in_the_answer(self):
        hits = scoring.forbidden_hits("Kho Đà Nẵng còn 12 cuốn", ["Kho Đà Nẵng"])
        self.assertEqual(hits, ["Kho Đà Nẵng"])

    def test_no_hits_when_forbidden_phrase_absent(self):
        self.assertEqual(scoring.forbidden_hits("Kho Hà Nội còn 12 cuốn", ["Kho Đà Nẵng"]), [])


class RefusalVerdictTests(unittest.TestCase):
    def test_not_required_is_always_correct(self):
        self.assertTrue(scoring.refusal_verdict("27 phiếu quá hạn", [], must_refuse=False)["correct"])

    def test_clean_refusal_is_correct(self):
        verdict = scoring.refusal_verdict("Xin lỗi, câu hỏi này ngoài phạm vi dữ liệu thư viện.", [], must_refuse=True)
        self.assertTrue(verdict["correct"])

    def test_answering_instead_of_refusing_is_incorrect(self):
        verdict = scoring.refusal_verdict("Hôm nay trời nắng đẹp.", [], must_refuse=True)
        self.assertFalse(verdict["correct"])

    def test_a_refusal_that_still_calls_a_tool_is_not_clean(self):
        verdict = scoring.refusal_verdict("Ngoài phạm vi hỗ trợ của tôi.", ["get_dashboard_kpis"], must_refuse=True)
        self.assertFalse(verdict["correct"])

    def test_a_refusal_that_still_states_a_number_is_not_clean(self):
        verdict = scoring.refusal_verdict("Ngoài phạm vi, nhưng có khoảng 27 trường hợp.", [], must_refuse=True)
        self.assertFalse(verdict["correct"])


class CitationVerdictTests(unittest.TestCase):
    def test_not_required_is_always_correct(self):
        self.assertTrue(scoring.citation_verdict("bất kỳ nội dung gì", [], must_cite=False)["correct"])

    def test_non_empty_evidence_satisfies_citation(self):
        self.assertTrue(scoring.citation_verdict("27 phiếu quá hạn", [{"label": "x"}], must_cite=True)["correct"])

    def test_a_source_line_in_text_satisfies_citation_even_without_evidence(self):
        self.assertTrue(scoring.citation_verdict("27 phiếu. Nguồn dữ liệu: Overdue Summary", [], must_cite=True)["correct"])

    def test_missing_both_is_not_correct(self):
        self.assertFalse(scoring.citation_verdict("27 phiếu quá hạn", [], must_cite=True)["correct"])


class HallucinatedNumbersTests(unittest.TestCase):
    def test_a_number_present_in_the_tool_payload_is_not_flagged(self):
        payload = {"get_overdue_summary": {"total_overdue_loans": 27}}
        self.assertEqual(scoring.hallucinated_numbers("Có 27 phiếu quá hạn", payload), [])

    def test_a_number_absent_from_the_payload_is_flagged(self):
        payload = {"get_overdue_summary": {"total_overdue_loans": 27}}
        hallucinated = scoring.hallucinated_numbers("Có khoảng 9999 phiếu quá hạn", payload)
        self.assertIn(9999.0, hallucinated)

    def test_no_numbers_in_the_answer_flags_nothing(self):
        self.assertEqual(scoring.hallucinated_numbers("không có số liệu nào", {}), [])

    def test_a_number_echoed_from_the_question_is_not_flagged(self):
        # Regression: assistant_answers_20260908_180847.md flagged "30" and "7"
        # as hallucinated purely because the model repeated the time window
        # the user themselves asked about ("30 ngày qua", "7 ngày gần đây").
        question = "Xu hướng mượn trả sách 30 ngày qua như thế nào?"
        payload = {"get_borrow_trends": {"summary": "tăng nhẹ"}}
        hallucinated = scoring.hallucinated_numbers(
            "Trong 30 ngày qua, xu hướng mượn trả tăng nhẹ.", payload, question
        )
        self.assertEqual(hallucinated, [])

    def test_a_number_absent_from_both_question_and_payload_is_still_flagged(self):
        # Echoing the question only excuses numbers that were actually in the
        # question - it must not become a blanket pass for small numbers.
        question = "Xu hướng mượn trả sách 30 ngày qua như thế nào?"
        payload = {"get_borrow_trends": {"summary": "tăng nhẹ"}}
        hallucinated = scoring.hallucinated_numbers(
            "Trong 30 ngày qua, có 9999 lượt mượn mới.", payload, question
        )
        self.assertIn(9999.0, hallucinated)

    def test_without_a_question_argument_behaves_as_before(self):
        payload = {"get_overdue_summary": {"total_overdue_loans": 27}}
        self.assertEqual(scoring.hallucinated_numbers("Có 27 phiếu quá hạn", payload), [])


class ScoreAnswerTests(unittest.TestCase):
    def test_a_fully_correct_grounded_answer_passes_overall(self):
        entry = {
            "resolved_numbers": [{"field": "total_overdue_loans", "expected": 27, "tolerance": 0}],
            "required_facts": [["qua han"]],
        }
        verdict = scoring.score_answer(
            entry, "Có 27 phiếu quá hạn.", {"get_overdue_summary": {"total_overdue_loans": 27}},
            ["get_overdue_summary"], [{"label": "x"}],
        )
        self.assertTrue(verdict["overall_pass"])

    def test_a_missing_required_number_fails_overall(self):
        entry = {"resolved_numbers": [{"field": "total_overdue_loans", "expected": 27, "tolerance": 0}]}
        verdict = scoring.score_answer(entry, "Không rõ số liệu.", {}, [], [])
        self.assertFalse(verdict["overall_pass"])

    def test_a_forbidden_fact_fails_overall_even_if_numbers_and_facts_pass(self):
        entry = {"forbidden_facts": ["Kho Đà Nẵng"]}
        verdict = scoring.score_answer(entry, "Kho Đà Nẵng còn hàng.", {}, [], [])
        self.assertFalse(verdict["overall_pass"])


class AggregateAnswerScoresTests(unittest.TestCase):
    def test_empty_list_does_not_divide_by_zero(self):
        self.assertEqual(scoring.aggregate_answer_scores([]), {"total": 0})

    def test_aggregates_across_verdicts(self):
        verdicts = [
            {
                "numbers": {"recall": 1.0}, "facts": {"recall": 1.0},
                "citation": {"correct": True, "reason": "cited"},
                "refusal": {"correct": True, "reason": "no refusal required"},
                "hallucinated_numbers": [], "overall_pass": True,
            },
            {
                "numbers": {"recall": 0.0}, "facts": {"recall": None},
                "citation": {"correct": False, "reason": "missing citation/evidence"},
                "refusal": {"correct": True, "reason": "no refusal required"},
                "hallucinated_numbers": [42.0], "overall_pass": False,
            },
        ]
        summary = scoring.aggregate_answer_scores(verdicts)
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["number_recall"], 0.5)
        self.assertEqual(summary["fact_recall"], 1.0)  # only the non-None entry counts
        self.assertEqual(summary["citation_rate"], 0.5)
        self.assertIsNone(summary["refusal_accuracy"])  # neither entry required a refusal
        self.assertEqual(summary["hallucinated_number_rate"], 0.5)
        self.assertEqual(summary["overall_pass_rate"], 0.5)


if __name__ == "__main__":
    unittest.main()
