import unittest

from intent import (
    BOOK_SEARCH_QUERY,
    FINE_SUMMARY_QUERY,
    LOW_STOCK_QUERY,
    OVERDUE_LOAN_QUERY,
    REORDER_SUGGESTION_QUERY,
    TOP_BORROWED_BOOKS_QUERY,
    detect_intent,
)
from rag import build_rag_context


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
