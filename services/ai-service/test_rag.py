import unittest

from intent import (
    BOOK_SEARCH_QUERY,
    FINE_SUMMARY_QUERY,
    LOW_STOCK_QUERY,
    OVERDUE_LOAN_QUERY,
    REORDER_SUGGESTION_QUERY,
    TOP_BORROWED_BOOKS_QUERY,
    detect_intent,
    normalize_text,
)
from rag import build_rag_context, merge_grounding_context, unverified_numbers, verify_numeric_grounding
from agent_planner import _wants_action, _is_all_warehouses_intent


class IntentDetectionTests(unittest.TestCase):
    def test_required_vietnamese_examples(self):
        examples = [
            ("Tình hình tồn kho hôm nay?", LOW_STOCK_QUERY),
            ("Sách nào đang quá hạn?", OVERDUE_LOAN_QUERY),
            ("Top sách được mượn nhiều trong 30 ngày?", TOP_BORROWED_BOOKS_QUERY),
            ("Tổng hợp phạt chưa thu?", FINE_SUMMARY_QUERY),
            ("Gợi ý nhập thêm sách gì?", REORDER_SUGGESTION_QUERY),
            ("Có sách Clean Code không?", BOOK_SEARCH_QUERY),
        ]
        for message, expected_intent in examples:
            with self.subTest(message=message):
                self.assertEqual(detect_intent(message)["intent"], expected_intent)

    def test_top_books_defaults_to_time_range(self):
        info = detect_intent("Top sách được mượn nhiều nhất")
        self.assertEqual(info["intent"], TOP_BORROWED_BOOKS_QUERY)
        self.assertIsNotNone(info["time_range"])

    def test_reorder_forecasting_keywords(self):
        for message in ["demand forecasting", "reorder suggestion", "sach nao can bo sung"]:
            with self.subTest(message=message):
                self.assertEqual(detect_intent(message)["intent"], REORDER_SUGGESTION_QUERY)


class IntentNewKeywordsTests(unittest.TestCase):
    """Test new LOW_STOCK_QUERY keywords added for under-threshold patterns."""

    def test_duoi_nguong_ton_is_low_stock(self):
        self.assertEqual(
            detect_intent("Kho nào đang có sách dưới ngưỡng tồn?")["intent"],
            LOW_STOCK_QUERY,
        )

    def test_ton_thap_is_low_stock(self):
        self.assertEqual(
            detect_intent("Tình trạng tồn thấp của từng kho")["intent"],
            LOW_STOCK_QUERY,
        )

    def test_sach_thieu_is_low_stock(self):
        self.assertEqual(
            detect_intent("Kho Hà Nội đang thiếu sách gì?")["intent"],
            LOW_STOCK_QUERY,
        )

    def test_reorder_phrase_is_reorder_query(self):
        self.assertEqual(
            detect_intent("Sách nào cần nhập thêm theo từng kho?")["intent"],
            REORDER_SUGGESTION_QUERY,
        )

    def test_create_phieu_nhap_is_reorder(self):
        self.assertEqual(
            detect_intent("Tạo phiếu nhập cho kho Hà Nội")["intent"],
            REORDER_SUGGESTION_QUERY,
        )

    def test_lap_phieu_yeu_cau_is_reorder(self):
        self.assertEqual(
            detect_intent("Lập phiếu yêu cầu nhập kho HCM")["intent"],
            REORDER_SUGGESTION_QUERY,
        )


class WantsActionTests(unittest.TestCase):
    """Test that _wants_action correctly distinguishes info queries from action requests."""

    def _n(self, msg: str) -> str:
        return normalize_text(msg)

    # --- Should NOT trigger action (pure info queries) ---
    def test_info_query_no_action(self):
        queries = [
            "Sách nào cần nhập thêm theo từng kho?",
            "Kho Hà Nội đang thiếu sách gì?",
            "Kho nào có sách dưới ngưỡng tồn?",
            "Liệt kê sách tồn kho thấp theo từng kho",
            "Gợi ý nhập thêm sách gì?",  # "gợi ý" alone should not trigger
        ]
        for q in queries:
            with self.subTest(q=q):
                self.assertFalse(_wants_action(self._n(q)), msg=f"Should NOT trigger action: {q}")

    # --- Should trigger action (explicit create verbs) ---
    def test_create_phieu_triggers_action(self):
        queries = [
            "Tạo phiếu nhập cho kho Hà Nội",
            "Lập phiếu yêu cầu nhập kho HCM",
            "Sinh phiếu nhập cho kho Đà Nẵng",
            "Tạo purchase request cho các sách tồn thấp",
            "Tạo phiếu yêu cầu nhập cho từng kho",
        ]
        for q in queries:
            with self.subTest(q=q):
                self.assertTrue(_wants_action(self._n(q)), msg=f"Should trigger action: {q}")


class AllWarehousesIntentTests(unittest.TestCase):
    """Test _is_all_warehouses_intent detects multi-warehouse scope correctly."""

    def _n(self, msg: str) -> str:
        return normalize_text(msg)

    def test_tung_kho_is_all(self):
        self.assertTrue(_is_all_warehouses_intent(self._n("Tạo phiếu nhập cho từng kho đang thiếu sách")))

    def test_tat_ca_kho_is_all(self):
        self.assertTrue(_is_all_warehouses_intent(self._n("Tạo phiếu nhập cho tất cả kho")))

    def test_moi_kho_is_all(self):
        self.assertTrue(_is_all_warehouses_intent(self._n("Tạo phiếu cho mỗi kho có sách dưới ngưỡng")))

    def test_specific_warehouse_is_not_all(self):
        self.assertFalse(_is_all_warehouses_intent(self._n("Tạo phiếu nhập cho kho Hà Nội")))

    def test_specific_code_is_not_all(self):
        self.assertFalse(_is_all_warehouses_intent(self._n("Tạo phiếu nhập cho WH-HCM")))


class RagContextTests(unittest.TestCase):
    def test_rag_context_handles_empty_and_error_sources(self):
        context = build_rag_context(
            {"intent": LOW_STOCK_QUERY, "confidence": 0.9},
            {
                "summary": "",
                "raw": {},
                "sources": [{"name": "Catalog Books", "endpoint": "/api/books", "status": "error:500"}],
                "warnings": ["Catalog Books returned HTTP 500"],
                "retrieved_at": "2026-05-22T00:00:00Z",
            },
        )
        self.assertIn("[RAG CONTEXT]", context)
        self.assertIn("Catalog Books", context)
        self.assertIn("error:500", context)


class MergeGroundingContextTests(unittest.TestCase):
    """merge_grounding_context is what lets a CUSTOMER/SUPPLIER reply get a
    real numeric-grounding check: ANALYTICS_BLOCKED_ROLES zeroes out
    `retrieval` for them, but their own loans/fines/tasks still reach the
    prompt via `personal` (build_user_personal_context) - without merging,
    verify_numeric_grounding never sees that data at all."""

    def test_retrieval_with_no_ok_source_plus_personal_with_one_is_no_longer_ungroundable(self):
        retrieval = {"summary": "", "raw": {}, "sources": [], "warnings": []}
        personal = {"summary": "Bạn có 2 khoản vay đang mở.", "sources": [{"name": "my-loans", "status": "ok"}]}

        # Before merging: no "ok" source anywhere, so grounding gives up early.
        self.assertIsNone(verify_numeric_grounding("Bạn có 2 khoản vay.", retrieval))

        merged = merge_grounding_context(retrieval, personal)
        # After merging: an "ok" source exists, so the check actually runs -
        # and the number 2 is present in personal's summary, so it is NOT flagged.
        self.assertIsNone(verify_numeric_grounding("Bạn có 2 khoản vay.", merged))

    def test_a_number_present_only_in_personal_summary_is_not_flagged(self):
        retrieval = {"summary": "", "raw": {}, "sources": [{"name": "sys", "status": "ok"}]}
        personal = {"summary": "Tổng tiền phạt của bạn là 50000 đồng.", "sources": [{"name": "my-fines", "status": "ok"}]}
        merged = merge_grounding_context(retrieval, personal)
        self.assertIsNone(verify_numeric_grounding("Bạn còn nợ 50000 đồng tiền phạt.", merged))

    def test_a_number_in_neither_source_is_still_flagged(self):
        retrieval = {"summary": "", "raw": {}, "sources": [{"name": "sys", "status": "ok"}]}
        personal = {"summary": "Bạn có 2 khoản vay.", "sources": [{"name": "my-loans", "status": "ok"}]}
        merged = merge_grounding_context(retrieval, personal)
        warning = verify_numeric_grounding("Bạn có 999 khoản vay.", merged)
        self.assertIsNotNone(warning)

    def test_no_personal_context_leaves_retrieval_unchanged(self):
        retrieval = {"summary": "s", "raw": {}, "sources": [{"name": "sys", "status": "ok"}]}
        self.assertEqual(merge_grounding_context(retrieval, None), retrieval)
        self.assertEqual(merge_grounding_context(retrieval, {"summary": "", "sources": []}), retrieval)


class VerifyNumericGroundingTests(unittest.TestCase):
    """verify_numeric_grounding used to do digit-substring matching over a
    9000-char-truncated JSON dump; it now does value-and-tolerance matching
    over the full raw payload (number_grounding.py), shared with
    eval/scoring.py's stricter hallucinated_numbers check."""

    def test_a_value_present_in_raw_json_is_not_flagged_even_reformatted(self):
        retrieval = {"summary": "", "raw": {"total_overdue_loans": 27}, "sources": [{"status": "ok"}]}
        # "27" in the reply vs 27 (int) in raw JSON - value match, not string match.
        self.assertIsNone(verify_numeric_grounding("Có 27 phiếu quá hạn.", retrieval))

    def test_a_decimal_value_within_tolerance_is_not_flagged(self):
        retrieval = {"summary": "", "raw": {"average_overdue_days": 5.2}, "sources": [{"status": "ok"}]}
        self.assertIsNone(verify_numeric_grounding("Trung bình quá hạn 5,2 ngày.", retrieval))

    def test_a_value_absent_from_raw_json_is_flagged(self):
        retrieval = {"summary": "", "raw": {"total_overdue_loans": 27}, "sources": [{"status": "ok"}]}
        warning = verify_numeric_grounding("Có 9999 phiếu quá hạn.", retrieval)
        self.assertIsNotNone(warning)
        self.assertIn("9999", warning)

    def test_a_number_echoed_from_the_question_is_not_flagged(self):
        # Regression: assistant_answers_20260908_180847.md flagged "30" and "7"
        # purely because the model repeated the time window the user asked
        # about ("30 ngày qua") - not a fabrication.
        retrieval = {"summary": "", "raw": {"trend": "tăng nhẹ"}, "sources": [{"status": "ok"}]}
        question = "Xu hướng mượn trả sách 30 ngày qua như thế nào?"
        self.assertIsNone(
            verify_numeric_grounding("Trong 30 ngày qua, xu hướng mượn trả tăng nhẹ.", retrieval, question)
        )

    def test_question_echo_exclusion_does_not_mask_other_bad_numbers(self):
        retrieval = {"summary": "", "raw": {"trend": "tăng nhẹ"}, "sources": [{"status": "ok"}]}
        question = "Xu hướng mượn trả sách 30 ngày qua như thế nào?"
        warning = verify_numeric_grounding("Trong 30 ngày qua, có 9999 lượt mượn mới.", retrieval, question)
        self.assertIsNotNone(warning)
        self.assertIn("9999", warning)

    def test_unverified_numbers_is_usable_directly_for_a_correction_message(self):
        retrieval = {"summary": "", "raw": {"total_paid": 500000}, "sources": [{"status": "ok"}]}
        unverified = unverified_numbers("Bạn đã trả 500000 và còn nợ 999999.", retrieval)
        self.assertEqual(unverified, [999999.0])

    def test_a_vietnamese_formatted_number_is_not_flagged_via_its_own_english_misreading(self):
        # Found live while testing the grounding retry: "500.000" (VN 500,000)
        # also parses as 500.0 under the EN convention. The corrected answer
        # after a retry wrote "500.000 VND" and was incorrectly re-flagged
        # because that second, unintended reading matched nothing.
        retrieval = {"summary": "", "raw": {"total_paid": 500000}, "sources": [{"status": "ok"}]}
        self.assertIsNone(
            verify_numeric_grounding("Tổng tiền phạt đã thu được là 500.000 VND.", retrieval)
        )


class AnalyticsBlockExemptionTests(unittest.TestCase):
    def test_general_query_and_book_search_are_exempt(self):
        from intent import ANALYTICS_BLOCK_EXEMPT_INTENTS, BOOK_SEARCH_QUERY, GENERAL_QUERY

        self.assertIn(GENERAL_QUERY, ANALYTICS_BLOCK_EXEMPT_INTENTS)
        self.assertIn(BOOK_SEARCH_QUERY, ANALYTICS_BLOCK_EXEMPT_INTENTS)

    def test_low_stock_query_is_not_exempt(self):
        from intent import ANALYTICS_BLOCK_EXEMPT_INTENTS, LOW_STOCK_QUERY

        self.assertNotIn(LOW_STOCK_QUERY, ANALYTICS_BLOCK_EXEMPT_INTENTS)


if __name__ == "__main__":
    unittest.main()
