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


def _whole_plan():
    """The live 2026-11-26 whole-warehouse plan, reduced to what the checks read."""
    t = lambda title, src, q, perm: {"title": title, "from_warehouse": src, "to_warehouse": "Kho HCM Chinh",
                                     "quantity": q, "permission": perm}
    hybrid_tr = [t("Project Hail Mary", "Kho Ha Noi", 1, "COLLABORATIVE"),
                 t("Chiến Lược Mua Bán Và Sáp Nhập Doanh Nghiệp", "Kho Ha Noi", 18, "COLLABORATIVE"),
                 t("Chiến Lược Mua Bán Và Sáp Nhập Doanh Nghiệp", "Kho Đà Nẵng", 3, "EXECUTABLE"),
                 t("Beartown 2 - Chúng Tôi Đấu Với Các Bạn", "Kho Ha Noi", 13, "COLLABORATIVE"),
                 t("7 Thói Quen Hiệu Quả - Bìa Cứng (Tái Bản 2022)", "Kho Đà Nẵng", 10, "EXECUTABLE")]
    src = [{"warehouse": "Kho Ha Noi", "quantity": 32}, {"warehouse": "Kho Đà Nẵng", "quantity": 15}]
    return {"analyze_inventory_rebalancing": {
        "scope": [{"warehouse": "Kho HCM Chinh"}, {"warehouse": "Kho Ha Noi"}, {"warehouse": "Kho Đà Nẵng"}],
        "destinations": [{"warehouse_name": "Kho HCM Chinh"}],
        "top_shortages": [{"title": "One Hundred Years of Solitude"}, {"title": "Babel Hay Sự Cần Thiết Của Bạo Lực"}],
        "options": {
            "HYBRID": {"label": "Kết hợp", "shortage_covered_pct": 100, "purchase_cost_vnd": 44464490,
                       "transfers": hybrid_tr, "transfers_by_source": src, "purchases": []},
            "TRANSFER_ONLY": {"label": "Chỉ điều chuyển", "shortage_covered_pct": 12.4, "purchase_cost_vnd": 0,
                              "transfers": hybrid_tr, "transfers_by_source": src, "purchases": []},
            "PROCUREMENT_ONLY": {"label": "Chỉ mua mới", "shortage_covered_pct": 100, "purchase_cost_vnd": 54194990,
                                 "covered_qty": 379, "total_shortage_qty": 379, "transfer_qty": 0, "purchase_qty": 379,
                                 "transfers": [], "purchases": []}},
        "recommendation": {"best_business_option": "HYBRID"}}}


class WholePlanAnswerChecks(unittest.TestCase):
    def test_invented_or_wrong_transfer_lines_are_caught(self):
        import copilot_rebalance_decision as rd
        c = _whole_plan()
        for wrong in ("- **Chiến Lược Mua Bán Và Sáp Nhập Doanh Nghiệp**: từ **Kho Đà Nẵng** → **Kho HCM Chinh**, số bản an toàn **10**.",
                      "- **One Hundred Years of Solitude**: từ **Kho Đà Nẵng** → **Kho HCM Chinh**, số bản an toàn **9**.",
                      "Kho Đà Nẵng dư 120 bản nhưng chưa có cơ sở nghiệp vụ để điều chuyển ngay các sách này về HCM Chinh."):
            self.assertEqual(rd.transfer_issues(wrong, c), [wrong], wrong)
        for fine in ("* **Chiến Lược Mua Bán Và Sáp Nhập Doanh Nghiệp:** Điều chuyển **18 bản** từ Kho Ha Noi về Kho HCM Chinh.",
                     "Chuyển 3 bản Chiến Lược Mua Bán từ Kho Đà Nẵng sang Kho HCM Chinh.",
                     "Bạn tự tạo phiếu điều chuyển cho các dòng từ Kho Đà Nẵng."):
            self.assertEqual(rd.transfer_issues(fine, c), [], fine)
        # a wrong bullet goes whole, even when its quantity sits in a later sentence
        bullet = ("* **Babel Hay Sự Cần Thiết Của Bạo Lực**: Điều chuyển từ **Kho Đà Nẵng** về **Kho HCM Chinh**. "
                  "Số bản an toàn: 7 (Kho Đà Nẵng còn 2).")
        self.assertEqual(rd.transfer_issues("Mở đầu.\n" + bullet, c), [bullet])
        ok_bullet = ("* **Beartown 2 - Chúng Tôi Đấu Với Các Bạn**: Điều chuyển từ **Kho Ha Noi** về **Kho HCM Chinh**. "
                     "Số bản an toàn: 13.")
        self.assertEqual(rd.transfer_issues(ok_bullet, c), [])
        # the surplus is not what can be moved
        self.assertEqual(rd.transfer_issues("* **Kho Ha Noi:** Có thể điều chuyển 126 bản dư thừa.", c),
                         ["* **Kho Ha Noi:** Có thể điều chuyển 126 bản dư thừa."])
        self.assertEqual(rd.transfer_issues("* **Kho Ha Noi:** có thể điều chuyển 32 bản về HCM.", c), [])
        # the plan's total given as one source's
        self.assertEqual(rd.transfer_issues("Tạo lệnh điều chuyển 47 bản từ Kho Đà Nẵng về Kho HCM Chinh.", c),
                         ["Tạo lệnh điều chuyển 47 bản từ Kho Đà Nẵng về Kho HCM Chinh."])
        self.assertEqual(rd.transfer_issues("Chuyển 15 bản từ Kho Đà Nẵng về Kho HCM Chinh.", c), [])
        self.assertEqual(rd.transfer_issues("Kho Đà Nẵng dư 120 bản, là nguồn cho việc điều chuyển.", c), [])
        self.assertIn("Chiến Lược Mua Bán Và Sáp Nhập Doanh Nghiệp — Kho Ha Noi — 18 bản",
                      rd.answer_instruction(["- **One Hundred Years of Solitude**: từ **Kho Đà Nẵng** → **Kho HCM Chinh**, 9 bản."], c))

    def test_one_options_figures_are_not_given_to_another(self):
        import copilot_rebalance_decision as rd
        c = _whole_plan()
        answer = ("* **Phương án 2: Chỉ mua mới**\n* **Hiệu quả:** Đáp ứng **100%** số thiếu.\n"
                  "* **Chi phí:** Ước tính khoảng **44.464.490 ₫**.\n\n"
                  "- **Chỉ điều chuyển**: chỉ tận dụng 120 bản, đáp ứng khoảng **31,66%** số thiếu.\n"
                  "- **Chỉ mua mới**: phải nhập toàn bộ 379 bản (chi phí ~54,2 triệu ₫).\n"
                  "* **Phương án 3: Kết hợp** — chi phí **44.464.490 ₫**, đáp ứng 100%.")
        self.assertEqual(rd.option_figure_issues(answer, c), [
            "* **Chi phí:** Ước tính khoảng **44.464.490 ₫**.",
            "- **Chỉ điều chuyển**: chỉ tận dụng 120 bản, đáp ứng khoảng **31,66%** số thiếu."])
        table = ("| Tiêu chí | Chỉ điều chuyển (TRANSFER_ONLY) | Kết hợp (HYBRID) | Chỉ mua mới |\n| :--- | :--- | :--- | :--- |\n"
                 "| **Mức đáp ứng** | **12.4%** | **100%** | **100%** |\n"
                 "| **Chi phí** | **0 ₫** | **44.464.490 ₫** | **44.464.490 ₫** |")
        self.assertEqual(rd.option_figure_issues(table, c), ["| **Chi phí** | **0 ₫** | **44.464.490 ₫** | **44.464.490 ₫** |"])
        # a wrong line is replaced by its own option's figures, so its section is not left empty
        fixes = rd.option_figure_replacements(answer, c)
        self.assertEqual(fixes["* **Chi phí:** Ước tính khoảng **44.464.490 ₫**."],
                         "* **Chỉ mua mới:** đáp ứng 100% số thiếu (379/379 bản), điều chuyển 0 bản, mua mới 379 bản, "
                         "chi phí mua mới 54.194.990 ₫.")
        self.assertNotIn(table.split("\n")[-1], rd.option_figure_replacements(table, c))  # table rows are dropped, not rewritten

    def test_a_wrong_transfer_only_reason_is_replaced(self):
        import copilot_rebalance_decision as rd
        c = _whole_plan()
        r = c["analyze_inventory_rebalancing"]
        r["diagnosis"] = [{"warehouse": "Kho HCM Chinh", "surplus_qty": 203}, {"warehouse": "Kho Ha Noi", "surplus_qty": 126},
                          {"warehouse": "Kho Đà Nẵng", "surplus_qty": 120}]
        r["diagnosis_totals"] = {"surplus_qty_surplus_warehouses": 120, "shortage_qty_all": 548}
        r["options"]["TRANSFER_ONLY"].update(transfer_qty=47, transfer_titles=5)
        answer = ("**2. Phương án Chỉ điều chuyển**\n* **Hiệu quả:** Chỉ đáp ứng 12% số thiếu (47/379 bản).\n"
                  "* **Lý do:** Tổng lượng sách dư tại các kho khác (chủ yếu là Kho Đà Nẵng với 120 bản) là hạn chế.\n"
                  "* **Kết quả:** Vẫn còn thiếu 332 bản.")
        wrong = "* **Lý do:** Tổng lượng sách dư tại các kho khác (chủ yếu là Kho Đà Nẵng với 120 bản) là hạn chế."
        self.assertEqual(rd.reason_issues(answer, c), [wrong])
        self.assertIn("chỉ chuyển được 47 bản thuộc 5 đầu sách", rd.reason_replacements(answer, c)[wrong])
        # the same wrong reason in other words (live audit, third run)
        other = ("* **Hiệu quả:** Không đáp ứng đủ nhu cầu. Tổng dư thừa tại các kho khác (chủ yếu là Kho Đà Nẵng "
                 "với 120 bản) thấp hơn nhiều so với mức thiếu của Kho HCM Chinh (380 bản).")
        self.assertEqual(rd.reason_issues("**2. Phương án Chỉ điều chuyển**\n" + other, c), [other])
        # the reason sentence the system writes itself passes
        self.assertEqual(rd.reason_issues(rd.reason_replacements(answer, c)[wrong], c), [])

    def test_the_system_writes_the_diagnosis_and_comparison_turns(self):
        from types import SimpleNamespace
        import copilot_rebalance_decision as rd
        c = _whole_plan()
        r = c["analyze_inventory_rebalancing"]
        r["recommendation"].update(ranking=["HYBRID", "PROCUREMENT_ONLY", "TRANSFER_ONLY"], executable_option="HYBRID")
        r["options"]["HYBRID"].update(covered_qty=379, total_shortage_qty=379, transfer_qty=47, purchase_qty=332)
        r["options"]["TRANSFER_ONLY"].update(covered_qty=47, total_shortage_qty=379, transfer_qty=47, purchase_qty=0,
                                             transfer_titles=5)
        r["options"]["HYBRID"]["transfers_by_source"] = [
            {"warehouse": "Kho Ha Noi", "quantity": 32, "permission": "COLLABORATIVE"},
            {"warehouse": "Kho Đà Nẵng", "quantity": 15, "permission": "EXECUTABLE"}]
        plan = lambda *focus: SimpleNamespace(entities={"rebalance": {"focus": list(focus)}})
        text = rd.system_answer(plan("INVENTORY_DIAGNOSIS", "TRANSFER_OPPORTUNITY"), c)
        self.assertIn("- Chiến Lược Mua Bán Và Sáp Nhập Doanh Nghiệp: 3 bản từ Kho Đà Nẵng", text)
        self.assertIn("Tổng theo kho nguồn: Kho Ha Noi 32 bản", text)
        self.assertEqual(rd.answer_issues(text, c), [])  # what the system writes passes its own checks
        text = rd.system_answer(plan("DECISION_COMPARISON"), c)
        self.assertIn("**Chỉ mua mới**: đáp ứng 100% số thiếu (379/379 bản)", text)
        self.assertIn("chi phí mua mới 54.194.990 ₫", text)
        self.assertEqual(text.count("Chi phí điều chuyển"), 1)
        self.assertEqual(rd.answer_issues(text, c), [])
        # budget, what-if, draft and explanation turns stay with the model
        for focus in ("BUDGET_OPTIMIZATION", "WHAT_IF", "CREATE_DRAFT", "DECISION_EXPLANATION"):
            self.assertIsNone(rd.system_answer(plan("DECISION_COMPARISON", focus), c), focus)

    def test_only_the_planner_scopes_a_plan_to_one_book(self):
        """The model never sees book_title (it re-ran the plan per short title once it did),
        yet the planner's own call still passes it through."""
        import copilot_tools
        from ai_core import tools as ai_tools
        schema = next(s for s in copilot_tools.COPILOT_TOOLS if s["function"]["name"] == "analyze_inventory_rebalancing")
        self.assertNotIn("book_title", schema["function"]["parameters"]["properties"])
        kept, dropped = ai_tools._valid_arguments("analyze_inventory_rebalancing", copilot_tools.analyze_inventory_rebalancing,
                                                  {"book_title": "Số đỏ", "destination_warehouses": ["Kho HCM Chinh"]})
        self.assertEqual((kept.get("book_title"), dropped), ("Số đỏ", []))

    def test_the_transfer_only_reason_is_given(self):
        import copilot_response
        o = {"code": "TRANSFER_ONLY", "label": "Chỉ điều chuyển", "shortage_covered_pct": 12.4, "transfer_qty": 47,
             "transfer_titles": 5, "covered_qty": 47, "total_shortage_qty": 379}
        text = copilot_response._render_rebalancing({
            "options": {"TRANSFER_ONLY": o}, "recommendation": {}, "destinations": [{"warehouse_name": "Kho HCM Chinh"}],
            "diagnosis": [{"warehouse": "Kho HCM Chinh", "shortage_variants": 77, "shortage_qty": 379}]})
        self.assertIn("chỉ chuyển được 47 bản thuộc 5 đầu sách", text)
        self.assertIn("Kho đích thiếu 77 đầu sách", text)


if __name__ == "__main__":
    unittest.main()
