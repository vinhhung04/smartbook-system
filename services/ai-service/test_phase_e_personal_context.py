"""Phase E.6: personal context follows the question's purpose (data
minimization), and the dynamic-data summaries say what the service says.

The chat turn runs for real (main.chat -> _prepare_chat_turn ->
build_user_personal_context); only the gateway fetch (_fetch_one), NLU,
retrieval and the LLM are stand-ins, so the test sees exactly which personal
endpoints were read and what reached the prompt.
"""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import main
import user_personal_context as upc
from agent_schemas import UserContext
from main import ChatRequest
from cache import ResponseCache

READER = UserContext(user_id="reader-1", username="reader", roles=["CUSTOMER"], permissions=["customer.self.read"])
LIBRARIAN = UserContext(user_id="lib-1", username="lib", roles=["LIBRARIAN"], permissions=["borrow.read"])
USERS = {"Bearer reader": READER, "Bearer lib": LIBRARIAN}
NO_EVIDENCE_FAQ = {"summary": "Giờ mở cửa: 8:00-20:00.", "raw": {}, "warnings": [], "retrieval_status": "ANSWERABLE",
                   "sources": [{"name": "faq", "endpoint": "faq://branches-opening-hours", "status": "ok"}]}
DATA = {
    "/borrow/my/loans": {"data": [{"loan_number": "L-OLD", "status": "RETURNED", "primary_book_title": "Cũ"},
                                  {"loan_number": "L-NOW", "status": "BORROWED", "primary_book_title": "Đang đọc"}]},
    "/borrow/my/fines": {"data": {"fines": [{"status": "UNPAID", "amount": "5000", "fine_type": "OVERDUE"}]}},
    "/borrow/my/reservations": {"data": []},
    "/borrow/my/membership": {"data": {"plan": "SILVER", "status": "ACTIVE", "end_date": "2027-01-01"}},
    "/borrow/my/account": {"data": {"available_balance": 120000, "held_balance": 30000, "currency_code": "VND"}},
}


def _request(token):
    return SimpleNamespace(headers={"authorization": token}, client=SimpleNamespace(host="gw"))


class PersonalContextSelectionTest(unittest.TestCase):
    def test_topics_by_question(self):
        cases = [
            ("Tôi đang mượn sách nào?", "GENERAL_QUERY", {"loans"}),
            ("Tôi có khoản phạt nào?", "FINE_SUMMARY_QUERY", {"fines"}),
            ("Ví của tôi còn bao nhiêu?", "GENERAL_QUERY", {"wallet"}),
            ("Thẻ của tôi còn hạn không?", "GENERAL_QUERY", {"membership"}),
            ("Tôi đặt trước sách nào?", "RESERVATION_QUERY", {"reservations"}),
            ("Thư viện mở cửa lúc nào?", "GENERAL_QUERY", set()),
            ("Tôi muốn biết giờ mở cửa và wifi", "GENERAL_QUERY", set()),  # "tôi" alone loads nothing
            ("Phí phạt trễ hạn tính thế nào?", "FINE_SUMMARY_QUERY", set()),  # policy -> documents only
            ("Sách này phát hành năm nào?", "BOOK_SEARCH_QUERY", set()),  # "phát" is not "phạt"
        ]
        for question, intent, expected in cases:
            with self.subTest(question):
                self.assertEqual(upc.select_personal_topics(question, intent), expected)


class PersonalContextFetchTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.fetched = []

        async def fake_fetch(client, endpoint, auth_header):
            self.fetched.append(endpoint)
            if endpoint in getattr(self, "failing", set()):
                return endpoint, None, f"{endpoint} returned HTTP 503"
            return endpoint, DATA.get(endpoint), None

        self._patch = patch.object(upc, "_fetch_one", new=fake_fetch)
        self._patch.start()

    async def asyncTearDown(self):
        self._patch.stop()

    async def test_only_the_asked_topic_is_fetched(self):
        personal = await upc.build_user_personal_context(READER, {"intent": "FINE_SUMMARY_QUERY"}, "Bearer reader",
                                                         "Tôi có khoản phạt nào?")
        self.assertEqual(self.fetched, ["/borrow/my/fines"])
        self.assertNotIn("SILVER", personal["summary"])
        self.assertNotIn("Đang đọc", personal["summary"])

    async def test_public_question_fetches_nothing(self):
        personal = await upc.build_user_personal_context(READER, {"intent": "GENERAL_QUERY"}, "Bearer reader",
                                                         "Thư viện mở cửa lúc nào và có wifi không?")
        self.assertEqual((self.fetched, personal["summary"]), ([], ""))

    async def test_unreadable_data_is_stated_not_invented(self):
        self.failing = {"/borrow/my/loans"}
        personal = await upc.build_user_personal_context(READER, {"intent": "GENERAL_QUERY"}, "Bearer reader",
                                                         "Tôi đang mượn sách nào?")
        self.assertIn("không được suy đoán", personal["summary"])
        self.assertEqual(personal["warnings"], ["/borrow/my/loans returned HTTP 503"])

    async def test_whole_account_request_loads_the_roles_endpoints_only(self):
        await upc.build_user_personal_context(READER, {"intent": "GENERAL_QUERY"}, "Bearer reader",
                                              "Cho tôi xem tình hình tài khoản của tôi")
        self.assertEqual(sorted(self.fetched), sorted(upc._ROLE_ENDPOINTS["CUSTOMER"]))
        self.assertFalse(any(ep.startswith("/analytics") for ep in self.fetched))


class PersonalContextFormatterTest(unittest.TestCase):
    def test_returned_loans_are_not_reported_as_borrowed(self):
        text = upc._fmt_loans(DATA["/borrow/my/loans"])
        self.assertIn("Sách đang mượn: 1 phiếu", text)
        self.assertNotIn("Cũ", text)
        only_history = upc._fmt_loans({"data": [{"loan_number": "L1", "status": "RETURNED"}] * 20})
        self.assertIn("không có sách nào đang mượn", only_history)

    def test_librarian_overview_uses_the_service_totals_not_a_page_sample(self):
        page = {"data": [{"loan_number": f"L{i}", "status": "RETURNED"} for i in range(20)],
                "meta": {"total": 22688, "status_counts": {"BORROWED": 24, "OVERDUE": 436, "RETURNED": 22688}}}
        self.assertIn("460 đang mượn, trong đó 436 quá hạn", upc._fmt_borrow_loans_all(page))
        no_meta = upc._fmt_borrow_loans_all({"data": page["data"]})
        self.assertIn("không phải toàn hệ thống", no_meta)

    def test_finished_reservations_are_not_pending(self):
        rows = {"data": [{"status": "FULFILLED", "book_title": "Cũ"}] * 18 + [{"status": "READY_FOR_PICKUP", "book_title": "Mới"}]}
        text = upc._fmt_reservations(rows)
        self.assertIn("(1 đặt đang chờ)", text)
        self.assertNotIn("Cũ", text)
        self.assertEqual(upc._fmt_reservations({"data": [{"status": "NO_SHOW"}]}), "Bạn không có đặt sách nào đang chờ.")

    def test_finished_warehouse_work_is_not_pending(self):
        tasks = {"data": [{"id": "a" * 8, "type": "PUTAWAY", "status": "POSTED"},
                          {"id": "b" * 8, "type": "PURCHASE_REQUEST", "status": "CONVERTED"},
                          {"id": "c" * 8, "type": "EXCEPTION_REPORT", "status": "OPEN"}]}
        self.assertIn("(1 tasks đang chờ)", upc._fmt_warehouse_tasks(tasks))


class PrivacyThroughTheChatTurnTest(unittest.IsolatedAsyncioTestCase):
    """The prompt the model sees for a public question carries no personal data."""

    async def asyncSetUp(self):
        self.fetched, self.prompts = [], []

        async def fake_fetch(client, endpoint, auth_header):
            self.fetched.append(endpoint)
            return endpoint, DATA.get(endpoint), None

        async def fake_llm(messages, *args, **kwargs):
            self.prompts.append(messages[0]["content"])
            return "Thư viện mở cửa 8:00-20:00.", True

        self._patches = [
            patch.object(upc, "_fetch_one", new=fake_fetch),
            patch("main.get_user_context", new=AsyncMock(side_effect=lambda h: USERS[h])),
            patch("main.retrieve_context", new=AsyncMock(return_value=NO_EVIDENCE_FAQ)),
            patch("main._chat_with_text_llm", new=fake_llm),
            patch("main._get_text_llm_provider", return_value=SimpleNamespace(name="openrouter")),
            patch("main.plan_agent_action", new=AsyncMock(return_value=None)),
            patch("main.response_cache", ResponseCache()),
        ]
        for p in self._patches:
            p.start()

    async def asyncTearDown(self):
        for p in self._patches:
            p.stop()

    async def _ask(self, question, intent="GENERAL_QUERY", token="Bearer reader"):
        with patch("main.classify_user_message", new=AsyncMock(return_value={"intent": intent, "query": question})):
            return await main.chat(_request(token), ChatRequest(message=question))

    async def test_public_question_prompt_has_no_personal_data(self):
        await self._ask("Thư viện mở cửa lúc mấy giờ và có wifi không?")
        self.assertEqual(self.fetched, [])
        self.assertNotIn("Dữ liệu cá nhân người dùng", self.prompts[-1])
        for private in ("5000", "SILVER", "2027-01-01", "120,000", "Đang đọc"):
            self.assertNotIn(private, self.prompts[-1])

    async def test_fine_question_prompt_has_fines_only(self):
        await self._ask("Tôi còn khoản phạt nào chưa thanh toán?", "FINE_SUMMARY_QUERY")
        self.assertEqual(self.fetched, ["/borrow/my/fines"])
        self.assertIn("Dữ liệu cá nhân người dùng", self.prompts[-1])
        self.assertNotIn("SILVER", self.prompts[-1])
        self.assertNotIn("120,000", self.prompts[-1])


if __name__ == "__main__":
    unittest.main()
