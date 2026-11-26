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


    def test_the_plan_book_is_one_exact_catalog_title(self):
        import asyncio
        from unittest.mock import AsyncMock, patch
        import copilot_tools
        books = [{"id": "b1", "title": "Sứ Mệnh Hail Mary - Project Hail Mary"}, {"id": "b2", "title": "Project Hail Mary"},
                 {"id": "b3", "title": "Số đỏ"}, {"id": "b4", "title": "Số đỏ"}]
        with patch.object(copilot_tools, "_cached_get", AsyncMock(return_value=books)):
            book, err = asyncio.run(copilot_tools._resolve_book("Bearer x", "sứ mệnh hail mary - project hail mary"))
            self.assertEqual((book["id"], err), ("b1", None))  # not the English "Project Hail Mary"
            book, err = asyncio.run(copilot_tools._resolve_book("Bearer x", "Số đỏ"))
            self.assertIsNone(book)  # two books share it: ask, never plan the wrong one
            self.assertIn("2 kết quả", err["error"])

    def test_a_one_book_plan_says_so_in_its_conclusion(self):
        import copilot_rebalance_decision as rd
        opt = {"label": "Kết hợp", "shortage_covered_pct": 100, "covered_qty": 16, "total_shortage_qty": 16,
               "purchase_cost_vnd": 1e6, "risk_level": "LOW"}
        d = rd.build(None, {"analyze_inventory_rebalancing": {
            "book": {"id": "b1", "title": "Sứ Mệnh Hail Mary"}, "scope": [{"warehouse": "Kho HCM"}], "diagnosis": [],
            "options": {"HYBRID": opt}, "recommendation": {"best_business_option": "HYBRID"}}})
        self.assertTrue(d["conclusion"].startswith('Riêng cuốn "Sứ Mệnh Hail Mary"'))
        self.assertEqual(d["book"]["id"], "b1")


    def test_forecast_demand_is_not_given_as_what_the_plan_covers(self):
        import copilot_rebalance_decision as rd
        collected = {"analyze_inventory_rebalancing": {
            "diagnosis": [{"forecast_demand_qty": 6.2, "shortage_qty": 11, "surplus_qty": 0},
                          {"forecast_demand_qty": 0, "shortage_qty": 0, "surplus_qty": 10}],
            "options": {"HYBRID": {"total_shortage_qty": 11, "covered_qty": 11, "transfer_qty": 10, "purchase_qty": 1,
                                   "remaining_shortage_qty": 0}},
            "recommendation": {"best_business_option": "HYBRID"}}}
        wrong = "Phương án này đáp ứng 100% nhu cầu dự kiến (6 bản) mà không để sót bản nào."
        self.assertEqual(rd.demand_issues(wrong, collected), [wrong])
        self.assertIn("SỐ THIẾU (11 bản", rd.answer_instruction([wrong], collected))
        for fine in ("Phương án này đáp ứng 100% số thiếu (11/11 bản).",
                     "Nhu cầu dự kiến tại HCM là 6 bản trong thời gian chờ hàng.",  # demand alone is a fact
                     "Chuyển 10 bản từ Đà Nẵng để đáp ứng nhu cầu."):
            self.assertEqual(rd.demand_issues(fine, collected), [], fine)


    def test_transfer_totals_per_source_cover_every_line(self):
        import copilot_response
        import copilot_tools
        names = {"dn": "Kho Đà Nẵng", "hn": "Kho Ha Noi"}
        transfers = [{"from_warehouse_id": "dn", "to_warehouse_id": "hcm", "quantity": 3, "permission": "EXECUTABLE", "title": f"S{i}"}
                     for i in range(15)] + [{"from_warehouse_id": "hn", "to_warehouse_id": "hcm", "quantity": 4,
                                             "permission": "COLLABORATIVE", "title": "H"}]
        o = copilot_tools._rebalance_option({"code": "HYBRID", "transfers": transfers, "purchases": [],
                                             "covered_qty": 49, "total_shortage_qty": 60, "shortage_covered_pct": 81.7}, names)
        self.assertEqual(len(o["transfers"]), copilot_tools._REBALANCE_LINES)  # rows are capped...
        self.assertEqual([(s["warehouse"], s["quantity"], s["lines"]) for s in o["transfers_by_source"]],
                         [("Kho Đà Nẵng", 45, 15), ("Kho Ha Noi", 4, 1)])  # ...the totals are not
        text = copilot_response._render_rebalancing({"options": {"HYBRID": o}, "recommendation": {}, "diagnosis": []})
        self.assertIn("Kho Đà Nẵng 45 bản / 15 đầu sách", text)
        self.assertIn("đáp ứng 81.7% số thiếu (49/60 bản)", text)
        self.assertIn("và 11 dòng điều chuyển khác", text)


if __name__ == "__main__":
    unittest.main()
