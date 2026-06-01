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
from rag import build_rag_context
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


if __name__ == "__main__":
    unittest.main()
