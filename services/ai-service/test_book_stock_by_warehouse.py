"""A question about ONE book's copies per warehouse ("Cuốn "Số đỏ" còn ở kho nào?",
or "cuốn này" after a cover photo) is answered from that book's scoped locations,
never from whole-warehouse stock totals (live demo 2026-11-26)."""
import unittest

import assistant_tools
import copilot_plan as cp

WHS = [{"id": "a", "name": "Kho HCM Chinh", "code": "WH-HCM-01"}, {"id": "b", "name": "Kho Ha Noi", "code": "WH-HN-01"}]


class BookStockByWarehouseTests(unittest.TestCase):
    def test_a_named_book_with_kho_is_a_book_lookup(self):
        for q in ('Cuốn "Số đỏ" còn ở kho nào?',
                  'Đây là sách gì? Cuốn này còn ở những kho nào? Kho nào đang có nhiều nhất? (sách "Sứ Mệnh Hail Mary")',
                  'Cuốn này còn ở những kho nào? Kho nào đang có nhiều nhất? (sách "Số đỏ")'):
            self.assertEqual([t["name"] for t in cp.build_plan(q, {}, WHS).required_tools], ["search_books"], q)

    def test_the_semantic_hint_does_not_add_the_risk_tool_back(self):
        hint = cp.SemanticHint(capabilities=[cp.WAREHOUSE_RISK])
        q = 'Đây là sách gì? Cuốn này còn ở những kho nào? (sách "Sứ Mệnh Hail Mary")'
        self.assertEqual([t["name"] for t in cp.build_plan(q, {}, WHS, hint=hint).required_tools], ["search_books"])

    def test_warehouse_risk_without_a_book_is_unchanged(self):
        tools = [t["name"] for t in cp.build_plan("Kho nào đang có rủi ro thiếu sách?", {}, WHS).required_tools]
        self.assertEqual(tools, ["get_warehouse_stock_risk"])

    def test_compact_book_carries_stock_per_readable_warehouse(self):
        book = {"id": "x", "title": "Số đỏ", "quantity": 18, "locations": [
            {"warehouse_id": "a", "warehouse_name": "Kho HCM Chinh", "available_quantity": 10},
            {"warehouse_id": "a", "warehouse_name": "Kho HCM Chinh", "available_quantity": 5},
            {"warehouse_id": "b", "warehouse_name": "Kho Ha Noi", "available_quantity": 3},
            {"warehouse_id": "b", "warehouse_name": "Kho Ha Noi", "available_quantity": 7, "is_receiving": True}]}
        self.assertEqual(assistant_tools._compact_book_with_content(book)["by_warehouse"], [
            {"warehouse_id": "a", "warehouse_name": "Kho HCM Chinh", "available_quantity": 15},
            {"warehouse_id": "b", "warehouse_name": "Kho Ha Noi", "available_quantity": 3}])


    def test_copilot_renders_the_per_warehouse_lines(self):
        import copilot_response
        text = copilot_response.render("search_books", {"query": "Số đỏ", "retrievalStatus": "CONFIDENT", "results": [
            {"title": "Số đỏ", "quantity": 15, "by_warehouse": [{"warehouse_name": "Kho HCM Chinh", "available_quantity": 15}]}]})
        self.assertIn("Kho HCM Chinh: 15 bản", text)
        self.assertIn("ngoài các kho này thì không có", text)


    def test_an_exact_title_does_not_wait_on_the_embedding_call(self):
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        store = MagicMock(search_keyword=AsyncMock(return_value=[]), search_semantic=AsyncMock(return_value=[]))
        books = [{"id": "x", "title": "Số đỏ", "author": "Vũ Trọng Phụng"}]
        with patch.object(assistant_tools.vector_store, "get_store", return_value=store), \
                patch.object(assistant_tools.embeddings, "embed_text", side_effect=AssertionError("embedding called")):
            results, _ = asyncio.run(assistant_tools._score_and_rank_books_with_confidence(books, "Số đỏ", 5))
        self.assertEqual(results[0]["title"], "Số đỏ")


if __name__ == "__main__":
    unittest.main()
