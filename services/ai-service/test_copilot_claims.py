"""Copilot 3.3: hybrid semantic verification (copilot_claims Layer 2 + 3), the
partial-withdrawal policy, the retry guard and the date-range check.

Layer 3 is tested with hand-written extractions: the backend - never the model -
decides each verdict, so the same extraction must give the same verdict, and a
wrong or hallucinated extraction must give nothing (never "wrong")."""
from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

import copilot_claims as cc
import copilot_verification as v
import main
from llm_provider import ChatUsage, JSONContentError
from main import AssistantRequest
from test_copilot_endpoints import SequenceProvider, _request
from test_copilot_verification import OVERDUE, PERIODS, REORDER, RISK, SIM, VerificationEndpointTests

FINES = {"total_unpaid": 499606500, "total_paid": 96619000, "total_waived": 6500, "unpaid_count": 1621,
         "by_type": [{"fine_type": "OVERDUE", "amount": 591212000, "count": 7656}]}
SHORTAGE_NULL = {"warehouse_id": "w-d1", "warehouse_name": "Chi Nhanh District 1",
                 "summary": {"low_stock_items": 1, "out_of_stock_items": 1, "items_with_recent_demand": 0},
                 "items": [{"title": "Nhà Giả Kim (Tái Bản 2025)", "available_qty": 0, "borrow_count": None}]}


def verdicts(answer, data, claims):
    sheet = v.build_sheet(data)
    return sorted({(c.category, c.verdict) for c in cc.validate(claims, answer, sheet, data)})


class LayerThreeTests(unittest.TestCase):
    def test_a_superlative_the_data_contradicts(self):
        answer = "Chi Nhanh District 3 an toàn nhất với 118 bản khả dụng — cao nhất trong hệ thống."
        risk = RISK + [{"warehouse_name": "Chi Nhanh District 3", "out_of_stock_variants": 0, "low_stock_variants": 0,
                        "total_available_qty": 118}]
        claims = [{"quote": "118 bản khả dụng — cao nhất trong hệ thống", "metric": "warehouse.available",
                   "entity": "Chi Nhanh District 3", "operator": "max", "value": 118}]
        self.assertEqual(verdicts(answer, {"get_warehouse_stock_risk": risk}, claims), [("RANKING", "CONTRADICTED")])

    def test_a_subtotal_larger_than_its_total(self):
        answer = "Tiền phạt chưa thu là 499.606.500 ₫, trong đó phạt quá hạn 591.212.000 ₫."
        claims = [{"quote": "trong đó phạt quá hạn 591.212.000 ₫", "metric": "fines.by_type", "entity": "OVERDUE",
                   "operator": "part_of", "value": 591212000, "total_metric": "fines.unpaid"}]
        self.assertEqual(verdicts(answer, {"get_fine_summary": FINES}, claims), [("MONEY", "CONTRADICTED")])

    def test_a_null_is_not_zero(self):
        answer = "Nhà Giả Kim hết hàng; dữ liệu ghi nhận 0 lượt mượn."
        claims = [{"quote": "dữ liệu ghi nhận 0 lượt mượn", "metric": "title.borrows",
                   "entity": "Nhà Giả Kim (Tái Bản 2025)", "operator": "eq", "value": 0}]
        self.assertEqual(verdicts(answer, {"explain_warehouse_shortage": SHORTAGE_NULL}, claims),
                         [("MISSING_DATA", "CONTRADICTED")])

    def test_stable_for_a_large_change(self):
        answer = "Nhu cầu đối với Norwegian Wood vẫn tương đối ổn định."
        claims = [{"quote": "vẫn tương đối ổn định", "metric": "title.trend", "entity": "Norwegian Wood",
                   "operator": "stable", "kind": "INFERENCE"}]
        self.assertEqual(verdicts(answer, {"get_reorder_suggestions": REORDER}, claims), [("TREND", "CONTRADICTED")])

    def test_a_correct_paraphrase_is_supported(self):
        answer = "Duyệt chi gần 10 triệu (9.987.000 ₫) cho chín đầu sách, tức 92 bản."
        claims = [{"quote": "9.987.000 ₫", "metric": "budget.approved_cost", "budget_vnd": 10000000, "value": 9987000},
                  {"quote": "92 bản", "metric": "budget.approved_copies", "budget_vnd": 10000000, "value": 92}]
        self.assertEqual(verdicts(answer, {"simulate_reorder_budget": SIM}, claims),
                         [("COUNT", "SUPPORTED"), ("MONEY", "SUPPORTED")])

    def test_titles_given_as_another_role_name_the_role(self):
        answer = "Với ngân sách 10 triệu, hệ thống duyệt 5 đầu sách."
        claims = [{"quote": "duyệt 5 đầu sách", "metric": "budget.approved_titles", "budget_vnd": 10000000, "value": 5}]
        sheet = v.build_sheet({"simulate_reorder_budget": SIM})
        out = cc.validate(claims, answer, sheet, {"simulate_reorder_budget": SIM})
        self.assertEqual([(c.category, c.verdict, c.basis) for c in out], [("COUNT", "CONTRADICTED", "semantic")])
        self.assertIn("ưu tiên cao", out[0].detail)

    def test_a_number_given_to_the_wrong_warehouse(self):
        answer = "Kho Ha Noi có 3 đầu sách hết hàng."
        claims = [{"quote": "Kho Ha Noi có 3 đầu sách hết hàng", "metric": "warehouse.out_of_stock",
                   "entity": "Kho Ha Noi", "value": 3}]
        self.assertEqual(verdicts(answer, {"get_warehouse_stock_risk": RISK}, claims), [("ENTITY", "CONTRADICTED")])

    def test_external_cause_stated_as_fact_but_not_when_hedged(self):
        data = {"compare_borrow_periods": PERIODS}
        fact = [{"quote": "Lượt mượn giảm do thiếu nhân viên", "metric": "cause", "operator": "cause",
                 "cause_factor": "staff", "kind": "FACT"}]
        self.assertEqual(verdicts("Lượt mượn giảm do thiếu nhân viên.", data, fact), [("CAUSALITY", "UNSUPPORTED")])
        hedged = [{**fact[0], "kind": "ASSUMPTION"}]
        self.assertEqual(verdicts("Lượt mượn giảm do thiếu nhân viên.", data, hedged), [])
        measured = [{**fact[0], "cause_factor": "stock_out"}]
        self.assertEqual(verdicts("Lượt mượn giảm do thiếu nhân viên.", data, measured), [])

    def test_a_quote_not_in_the_answer_gives_nothing(self):
        claims = [{"quote": "hệ thống duyệt 5 đầu sách", "metric": "budget.approved_titles", "budget_vnd": 10000000,
                   "value": 5}]
        self.assertEqual(verdicts("Với 10 triệu, hệ thống duyệt 9 đầu sách.", {"simulate_reorder_budget": SIM}, claims), [])

    def test_a_value_not_written_in_the_quote_gives_nothing(self):
        claims = [{"quote": "hệ thống duyệt chín đầu sách", "metric": "budget.approved_titles", "budget_vnd": 10000000,
                   "value": 5}]
        self.assertEqual(verdicts("Với 10 triệu, hệ thống duyệt chín đầu sách.", {"simulate_reorder_budget": SIM}, claims), [])

    def test_the_budget_amount_read_as_the_approved_cost_is_ignored(self):
        claims = [{"quote": "ngân sách 10.000.000 ₫", "metric": "budget.approved_cost", "value": 10000000}]
        self.assertEqual(verdicts("Với ngân sách 10.000.000 ₫, duyệt 9 đầu sách.", {"simulate_reorder_budget": SIM},
                                  claims), [])

    def test_unknown_metric_entity_or_scenario_is_unverifiable(self):
        data = {"simulate_reorder_budget": SIM, "get_warehouse_stock_risk": RISK}
        answer = "Với 30 triệu duyệt 25 đầu sách; Kho Đà Nẵng có 4 đầu sách hết hàng; doanh thu 9 tỷ."
        claims = [{"quote": "Với 30 triệu duyệt 25 đầu sách", "metric": "budget.approved_titles", "budget_vnd": 30000000, "value": 25},
                  {"quote": "Kho Đà Nẵng có 4 đầu sách hết hàng", "metric": "warehouse.out_of_stock", "entity": "Kho Đà Nẵng", "value": 4},
                  {"quote": "doanh thu 9 tỷ", "metric": "revenue", "value": 9e9}]
        self.assertEqual(verdicts(answer, data, claims), [])

    def test_alternative_first_title_of_the_same_priority_is_not_a_contradiction(self):
        answer = "Nên nhập Kafka on the Shore trước."
        claims = [{"quote": "Nên nhập Kafka on the Shore trước", "metric": "reorder.first", "entity": "Kafka on the Shore",
                   "operator": "first"}]
        self.assertEqual(verdicts(answer, {"get_reorder_suggestions": REORDER}, claims), [])
        lower = [{**claims[0], "entity": "Project Hail Mary", "quote": "Nên nhập Project Hail Mary trước"}]
        self.assertEqual(verdicts("Nên nhập Project Hail Mary trước.", {"get_reorder_suggestions": REORDER}, lower),
                         [("RECOMMENDATION", "CONTRADICTED")])

    def test_a_faulty_claim_never_raises(self):
        claims = [{"quote": None, "metric": "title.available"}, {"metric": "warehouse.risk", "operator": "max"}, "x", {}]
        self.assertEqual(cc.validate(claims, "Một câu.", v.build_sheet({}), {}), [])

    def test_overdue_tickets_vs_books(self):
        answer = "Có 675 phiếu mượn quá hạn."
        claims = [{"quote": "675 phiếu mượn quá hạn", "metric": "overdue.loans", "value": 675}]
        out = cc.validate(claims, answer, v.build_sheet({"get_overdue_summary": OVERDUE}), {"get_overdue_summary": OVERDUE})
        self.assertEqual([(c.category, c.verdict) for c in out], [("COUNT", "CONTRADICTED")])
        self.assertIn("số cuốn", out[0].detail)

    def test_a_title_called_out_of_stock_with_copies_left(self):
        answer = "Ba đầu sách đang hết hàng: Norwegian Wood (2 bản), Kafka on the Shore."
        claims = [{"quote": "Norwegian Wood (2 bản)", "metric": "title.stock_level", "entity": "Norwegian Wood",
                   "operator": "out_of_stock"}]
        self.assertEqual(verdicts(answer, {"get_reorder_suggestions": REORDER}, claims), [("ENTITY", "CONTRADICTED")])

    def test_funded_and_unfunded_titles_are_checked_against_the_scenario(self):
        sim = {**SIM, "scenarios": [{**SIM["scenarios"][0], "funded_items": [
            {"title": "Norwegian Wood"}, {"title": "Dế mèn phiêu lưu ký"}]}]}
        data = {"simulate_reorder_budget": sim}
        answer = "Dế mèn phiêu lưu ký bị bỏ lại; Norwegian Wood được duyệt."
        claims = [{"quote": "Dế mèn phiêu lưu ký bị bỏ lại", "metric": "budget.title_status", "entity": "Dế mèn phiêu lưu ký",
                   "operator": "unfunded"},
                  {"quote": "Norwegian Wood được duyệt", "metric": "budget.title_status", "entity": "Norwegian Wood",
                   "operator": "funded"}]
        self.assertEqual(verdicts(answer, data, claims), [("ENTITY", "CONTRADICTED"), ("ENTITY", "SUPPORTED")])

    def test_a_title_the_data_never_mentions_is_unsupported(self):
        answer = "Các tựa như Đắc Nhân Tâm chưa được nhập."
        claims = [{"quote": "Các tựa như Đắc Nhân Tâm chưa được nhập", "metric": "budget.title_status",
                   "entity": "Đắc Nhân Tâm", "operator": "unfunded"}]
        self.assertEqual(verdicts(answer, {"simulate_reorder_budget": SIM}, claims), [("ENTITY", "UNSUPPORTED")])

    def test_saying_data_is_missing_when_it_is_there(self):
        kpis = {"total_titles": 116, "total_copies": 472}
        claims = [{"quote": "Dữ liệu tổng số bản sao chưa được cung cấp", "metric": "kpi.total_copies", "operator": "absent"}]
        self.assertEqual(verdicts("Có 116 đầu sách. Dữ liệu tổng số bản sao chưa được cung cấp.",
                                  {"get_dashboard_kpis": kpis}, claims), [("MISSING_DATA", "CONTRADICTED")])
        # acknowledging that the data has no cause is not a causal claim
        cause = [{"quote": "Dữ liệu chưa cho biết lý do giảm", "metric": "cause", "operator": "absent"}]
        self.assertEqual(verdicts("Dữ liệu chưa cho biết lý do giảm.", {"compare_borrow_periods": PERIODS}, cause), [])

    def test_an_approved_cost_above_the_budget_in_the_same_sentence(self):
        answer = "Với mức giảm 20% (còn 8.000.000 ₫), hệ thống duyệt được 68.576.100 ₫ cho 74 đầu sách."
        claims = [{"quote": "còn 8.000.000 ₫", "metric": "budget.amount", "value": 8000000},
                  {"quote": "hệ thống duyệt được 68.576.100 ₫", "metric": "budget.approved_cost", "value": 68576100}]
        self.assertIn(("BUDGET", "CONTRADICTED"), verdicts(answer, {"simulate_reorder_budget": SIM}, claims))

    def test_a_difference_between_scenarios_is_not_read_as_a_total(self):
        answer = "Tăng lên 20 triệu giúp thêm 10 đầu sách."
        claims = [{"quote": "giúp thêm 10 đầu sách", "metric": "reorder.titles", "value": 10}]
        self.assertEqual(verdicts(answer, {"simulate_reorder_budget": SIM, "get_reorder_suggestions": REORDER}, claims),
                         [("COUNT", "SUPPORTED")])
        claims = [{"quote": "giúp thêm 3 đầu sách", "metric": "reorder.titles", "value": 3}]
        self.assertEqual(verdicts("Tăng lên 20 triệu giúp thêm 3 đầu sách.", {"simulate_reorder_budget": SIM,
                                                                             "get_reorder_suggestions": REORDER}, claims), [])

    def test_a_negated_coverage_sentence_is_not_a_coverage_claim(self):
        answer = "Ngân sách 10.000.000 ₫ chưa bù được phần thiếu hụt dự kiến nào, dù vẫn duyệt 9 đầu sách."
        claims = [{"quote": answer, "metric": "budget.coverage", "operator": "covers_all", "budget_vnd": 10000000}]
        self.assertEqual(verdicts(answer, {"simulate_reorder_budget": SIM}, claims), [])

    def test_the_full_need_exceeding_the_budget_is_not_a_compliance_claim(self):
        answer = "Tổng chi phí ước tính 68.375.250 ₫, chênh lệch với ngân sách 10 triệu là 58.375.250 ₫."
        claims = [{"quote": "chênh lệch với ngân sách 10 triệu là 58.375.250 ₫", "metric": "budget.compliance",
                   "operator": "exceeds", "value": 58375250}]
        self.assertEqual(verdicts(answer, {"simulate_reorder_budget": SIM}, claims), [])


class NoDataTests(unittest.TestCase):
    """A turn with no tool data at all: figures are not grounded anywhere
    (3 of 44 dev drafts invented figures and passed in 3.2)."""

    def test_invented_figures_without_any_tool_data_are_critical(self):
        report = v.verify("Lượt trả 30 ngày qua giảm khoảng 4,5%, trung bình mỗi ngày giảm 12 lượt.", v.build_sheet({}))
        self.assertEqual([(c.category, c.verdict, c.severity, c.basis) for c in report.problems],
                         [("NO_DATA", "UNSUPPORTED", "critical", "exact")])
        self.assertEqual(v.blocking_basis(report), "exact")
        self.assertIn("gọi tool", v.retry_instruction(report))
        self.assertIn("chưa truy xuất được dữ liệu", v.fallback_answer(None, report.sheet))

    def test_figures_from_the_question_or_earlier_turns_are_not_new(self):
        context = "Cần bao nhiêu bản và hết bao nhiêu tiền?\nĐề xuất nhập 250 bản, chi phí 22.250.000 ₫."
        report = v.verify("Cần đặt 250 bản với tổng chi phí 22.250.000 ₫.", v.build_sheet({}), context=context)
        self.assertEqual(report.problems, [])

    def test_saying_there_is_no_data_is_fine(self):
        report = v.verify("Hệ thống chưa có dữ liệu về doanh thu bán sách tháng này.", v.build_sheet({}))
        self.assertEqual(report.problems, [])

    def test_any_tool_data_turns_the_check_off(self):
        report = v.verify("Có 416 phiếu quá hạn.", v.build_sheet({"get_overdue_summary": OVERDUE}))
        self.assertNotIn("NO_DATA", {c.category for c in report.claims})


class LexiconFalseAlarmTests(unittest.TestCase):
    """Old lexicon rules that flagged correct dev drafts."""

    def test_a_threshold_definition_is_not_a_ranking(self):
        import copilot_faithfulness as cf
        data = {"get_warehouse_stock_risk": RISK}
        text = "Kho HCM Chinh: Có 3 đầu sách hết hàng và 7 đầu sách dưới ngưỡng (số lượng còn lại thấp hơn mức an toàn quy định)."
        ctx = cf.build_context(data, None, [])
        self.assertEqual([i for i in cf.validate(text, ctx) if i.type == cf.RANKING_INCONSISTENCY], [])

    def test_each_of_two_warehouses_is_not_their_sum(self):
        data = {"compare_warehouses": {"ranking": RISK[1:]}}
        self.assertEqual(v.verify("Cả hai kho đều có 1 đầu sách ở mức dưới ngưỡng.", v.build_sheet(data)).problems, [])

    def test_wanting_something_more_optimal_is_not_an_optimality_claim(self):
        self.assertEqual(v.verify("Phương án thay thế nếu cần tối ưu hơn: bỏ bớt Kafka.", v.build_sheet({
            "simulate_reorder_budget": SIM})).problems, [])


class ExtractionTests(unittest.IsolatedAsyncioTestCase):
    async def test_short_keys_are_expanded_and_the_model_never_sees_values(self):
        seen = {}

        class P:
            async def chat_json(self, messages, **kw):
                seen["prompt"] = messages[0]["content"]
                return {"c": [{"q": "duyệt 9 đầu sách", "m": "budget.approved_titles", "v": 9, "k": "F", "s": "sys"}]}, \
                    ChatUsage("openrouter", "m", 10.0, 100, 20, 0)

        claims, usage = await cc.extract("Với 10 triệu duyệt 9 đầu sách.", v.build_sheet({"simulate_reorder_budget": SIM}),
                                         {"simulate_reorder_budget": SIM}, P())
        self.assertEqual(claims[0]["metric"], "budget.approved_titles")
        self.assertEqual(claims[0]["kind"], "FACT")
        self.assertEqual(claims[0]["scope"], "system")
        self.assertEqual(usage["prompt_tokens"], 100)
        self.assertIn("10000000", seen["prompt"])           # the scenario's identity (its budget) ...
        self.assertNotIn("9987000", seen["prompt"])         # ... but none of its values
        self.assertNotIn("19944000", seen["prompt"])

    async def test_a_truncated_reply_is_salvaged(self):
        class P:
            async def chat_json(self, messages, **kw):
                raise JSONContentError("bad", '{"c": [{"q": "a 1", "m": "kpi.total_titles", "v": 1}, {"q": "b", "m"',
                                       ChatUsage("openrouter", "m", 1.0, 1, 1, 0))

        claims, _ = await cc.extract("Có 1 đầu sách trong hệ thống hiện nay.", v.build_sheet({}), {}, P())
        self.assertEqual([c["metric"] for c in claims], ["kpi.total_titles"])

    def test_nothing_to_extract_for_a_short_or_dataless_answer(self):
        self.assertFalse(cc.worth_extracting("Xin chào!", {"x": {}}))
        self.assertFalse(cc.worth_extracting("Hiện có 9 đầu sách được duyệt trong ngân sách này.", {}))
        self.assertTrue(cc.worth_extracting("Hiện có 9 đầu sách được duyệt trong ngân sách này.", {"x": {}}))


class PolicyTests(unittest.TestCase):
    def test_basis_of_a_claim_comes_from_its_category(self):
        self.assertEqual(v.Claim("x", "COUNT", v.CONTRADICTED).basis, "exact")
        self.assertEqual(v.Claim("x", "TREND", v.CONTRADICTED).basis, "heuristic")

    def test_blocking_basis(self):
        sheet = v.build_sheet({})
        exact = v.Claim("a", "COUNT", v.CONTRADICTED, severity=v.CRITICAL)
        heur = v.Claim("b", "TREND", v.CONTRADICTED, severity=v.CRITICAL)
        self.assertEqual(v.blocking_basis(v.Report([heur], sheet)), "partial")
        self.assertEqual(v.blocking_basis(v.Report([heur, exact], sheet)), "exact")
        self.assertIsNone(v.blocking_basis(v.Report([], sheet)))

    def test_withdraw_keeps_every_other_sentence(self):
        text = "Kho A có 3 đầu sách hết hàng.\nNhu cầu Norwegian Wood vẫn ổn định.\n- Dòng 1: 5 bản.\nKết luận: nên nhập."
        out = v.withdraw(text, [v.Claim("Nhu cầu Norwegian Wood vẫn ổn định.", "TREND", v.CONTRADICTED)])
        self.assertIsNotNone(out)
        self.assertNotIn("ổn định", out[0])
        for kept in ("3 đầu sách hết hàng", "Dòng 1: 5 bản", "Kết luận"):
            self.assertIn(kept, out[0])
        self.assertIn("Đã lược bỏ 1 nhận định", out[0])

    def test_withdraw_removes_the_whole_sentence_of_a_clause(self):
        text = ("Không đầu sách nào thỏa (1) lượt mượn tăng; và (2) tồn kho dưới 5 bản.\n"
                "Norwegian Wood còn 5 bản.\nKafka còn 3 bản.\nKết luận: chưa cần nhập.")
        out = v.withdraw(text, [v.Claim("Không đầu sách nào thỏa (1) lượt mượn tăng;", "TREND", v.CONTRADICTED)])
        self.assertIsNotNone(out)
        self.assertNotIn("và (2)", out[0])
        self.assertIn("Kafka còn 3 bản", out[0])

    def test_withdraw_refuses_when_too_little_is_left(self):
        self.assertIsNone(v.withdraw("Câu một sai. Câu hai.", [v.Claim("Câu một sai.", "TREND", v.CONTRADICTED)]))

    def test_retry_score_orders_exact_before_heuristic(self):
        sheet = v.build_sheet({})
        a = v.Report([v.Claim("a", "COUNT", v.CONTRADICTED, severity=v.CRITICAL)], sheet)
        b = v.Report([v.Claim("b", "TREND", v.CONTRADICTED, severity=v.CRITICAL)], sheet)
        self.assertGreater(v.score(a), v.score(b))

    def test_a_misstated_date_range_is_caught_and_the_right_one_supported(self):
        data = {"get_reorder_suggestions": {**REORDER, "range": {"from": "2026-09-16", "to": "2026-10-16"}}}
        self.assertIn(("PERIOD", "CONTRADICTED"), sorted({(c.category, c.verdict) for c in v.verify(
            "Trong kỳ 16/10/2025 – 16/10/2026, Norwegian Wood có 60 lượt mượn.", v.build_sheet(data)).problems}))
        ok = v.verify("Trong kỳ 16/09/2026 – 16/10/2026, Norwegian Wood có 60 lượt mượn.", v.build_sheet(data))
        self.assertIn(("PERIOD", "SUPPORTED"), {(c.category, c.verdict) for c in ok.claims})


class SemanticProvider(SequenceProvider):
    """The assistant model plus a Layer 2 extractor returning fixed claims."""

    def __init__(self, texts, claims_by_text):
        super().__init__(texts)
        self.claims_by_text, self.json_calls = claims_by_text, 0

    async def chat_json(self, messages, **kw):
        self.json_calls += 1
        answer = messages[-1]["content"].split("\n", 1)[1]
        return {"c": self.claims_by_text.get(answer, [])}, ChatUsage("openrouter", "m", 5.0, 50, 10, 0,
                                                                     feature="assistant_claims")


class PolicyEndpointTests(VerificationEndpointTests):
    """3.3 policy through the real endpoints (inherits the 3.2 endpoint tests,
    which must still pass unchanged)."""

    async def ask_with(self, provider, cid, stream=False):
        with patch("main._get_assistant_provider", return_value=provider):
            if stream:
                response = await main.assistant_stream(_request(), AssistantRequest(message=self.Q, conversation_id=cid))
                events = [chunk async for chunk in response.body_iterator]
                return json.loads([e for e in events if e.startswith("event: done")][0].split("data: ", 1)[1])
            return (await main.assistant(_request(), AssistantRequest(message=self.Q, conversation_id=cid))).model_dump()

    HEUR = ("Với 10 triệu, hệ thống duyệt 9 đầu sách (92 bản), chi phí 9.987.000 ₫.\n"
            "Norwegian Wood vẫn có sức hút ổn định.\nCòn lại 13.000 ₫ chưa dùng.")

    async def test_a_surviving_heuristic_contradiction_withdraws_its_sentence_not_the_answer(self):
        trends = {"get_reorder_suggestions": REORDER}

        async def reorder(auth_header=None, **_kw):
            return trends["get_reorder_suggestions"]

        with patch.dict(main.TOOL_FUNCTIONS, {"get_reorder_suggestions": reorder}), \
                patch("main.copilot_verification.build_sheet",
                      side_effect=lambda c, e=None, z=None, _b=v.build_sheet: _b({**c, **trends}, e, z)):
            body, provider, _ = await self.ask([self.HEUR], "p1")
        self.assertEqual(len(provider.calls), 2)
        ver = body["verification"]
        self.assertEqual(ver["status"], "WARNING")
        self.assertFalse(ver["safe_to_act"])
        self.assertEqual([w["category"] for w in ver["withdrawn"]], ["TREND"])
        self.assertNotIn("ổn định", body["answer"])
        self.assertIn("9 đầu sách", body["answer"])
        self.assertIn("Đã lược bỏ 1 nhận định", body["answer"])
        self.assertIsNone(body["pending_action"])
        self.action.assert_not_awaited()

    async def test_a_retry_that_adds_a_contradiction_is_discarded(self):
        draft = "Với 10 triệu, hệ thống duyệt 9 đầu sách, chi phí khoảng 10 triệu, có thể là phương án tối ưu nhất."
        worse = "Với 10 triệu, hệ thống đề xuất nhập 5 đầu sách sau:\n* Norwegian Wood\n* Tam Cam"
        body, provider, _ = await self.ask([draft, worse], "p2")
        self.assertEqual(len(provider.calls), 2)
        self.assertTrue(body["verification"]["retry_discarded"])
        self.assertNotIn("5 đầu sách", body["answer"])
        self.assertNotEqual(body["verification"]["status"], "BLOCKED")

    async def test_semantic_layer_catches_what_layer_one_misses_and_stream_agrees(self):
        draft = ("Với 10 triệu, hệ thống duyệt 9 đầu sách (92 bản), chi phí 9.987.000 ₫.\n"
                 "Ngân sách này giúp phủ kín mọi đầu sách ưu tiên.\nPhần dư là 13.000 ₫.")
        claims = {draft: [{"q": "giúp phủ kín mọi đầu sách ưu tiên", "m": "budget.coverage", "op": "covers_all",
                           "b": 10000000}]}
        with patch.object(main, "COPILOT_SEMANTIC_CLAIMS", True):
            body = await self.ask_with(SemanticProvider([draft], claims), "p3")
            done = await self.ask_with(SemanticProvider([draft], claims), "p4", stream=True)
        ver = body["verification"]
        self.assertTrue(ver["semantic"]["used"])
        self.assertIn("COVERAGE", [w["category"] for w in ver["withdrawn"]])
        self.assertFalse(ver["safe_to_act"])
        self.assertEqual(done["answer"], body["answer"])
        self.assertEqual(done["verification"]["status"], ver["status"])
        self.assertIn("assistant_claims", [u.get("feature") for u in body["debug"]["llm_calls"]])

    async def test_semantic_layer_failure_falls_back_to_layer_one(self):
        class Broken(SequenceProvider):
            async def chat_json(self, messages, **kw):
                raise TimeoutError("slow")

        with patch.object(main, "COPILOT_SEMANTIC_CLAIMS", True):
            body = await self.ask_with(Broken(["Với 10 triệu, hệ thống duyệt 9 đầu sách (92 bản), chi phí 9.987.000 ₫."]),
                                       "p5")
        self.assertEqual(body["verification"]["status"], "PASSED")
        self.assertEqual(body["verification"]["semantic"]["status"], "error")
        self.assertTrue(body["verification"]["safe_to_act"])

    async def test_figures_invented_without_tool_data_are_not_vouched_for_by_the_draft_itself(self):
        # live regression (3.3 test run 1): the turn's own draft sat in `messages`
        # and was taken as "earlier context", so its invented figure passed
        invented = "Hôm nay có 13 đầu sách đang dưới mức tồn tối thiểu."
        with patch.object(main, "_plan_assistant_turn", new=AsyncMock(
                return_value=(main.build_copilot_plan("xin chào", None, []), []))):
            body, provider, _ = await self.ask([invented], "p7")
        self.assertEqual(len(provider.calls), 2)  # the NO_DATA claim triggers the one retry
        self.assertEqual(body["verification"]["status"], "BLOCKED")
        self.assertNotIn("13", body["answer"])
        self.assertRegex(body["answer"], r"(?i)chưa (truy xuất|lấy) được dữ liệu")
        self.assertIsNone(body["pending_action"])

    async def test_semantic_layer_is_off_by_default(self):
        provider = SemanticProvider(["Với 10 triệu, hệ thống duyệt 9 đầu sách (92 bản), chi phí 9.987.000 ₫."], {})
        body = await self.ask_with(provider, "p6")
        self.assertEqual(provider.json_calls, 0)
        self.assertFalse(body["verification"]["semantic"]["used"])


if __name__ == "__main__":
    unittest.main()
