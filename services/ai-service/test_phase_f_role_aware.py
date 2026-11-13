"""Phase F1: role-aware AI. Capabilities come from ALL roles AND permissions,
the chatbot reads only the personal endpoints those capabilities allow, the
supplier sees only its own orders, and a Decision Assistant tool outside the
caller's capabilities is refused. Security matrix: right role + right
permission, role without permission, permission without role, multi-role,
superuser, revoked permission, anonymous."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import routes_ai_experience
import user_personal_context as upc
from agent_schemas import UserContext
from ai_core import capabilities as caps
from ai_core import tools as ai_tools
from routes_conversations import can_use_assistant


def U(roles, perms, uid="u", superuser=False):
    return UserContext(user_id=uid, username=uid, roles=roles, permissions=perms, is_superuser=superuser)


ADMIN = U(["ADMIN"], ["analytics.reports.view", "inventory.operation.decide", "inventory.purchase.request",
                      "borrow.write", "borrow.read", "inventory.catalog.read", "inventory.task.read"], "admin")
MANAGER = U(["WAREHOUSE_MANAGER"], ["analytics.reports.view", "reports.read", "inventory.operation.decide",
                                    "inventory.purchase.request", "inventory.catalog.read", "inventory.task.read"], "mgr")
STAFF = U(["WAREHOUSE_STAFF"], ["inventory.catalog.read", "inventory.task.read", "inventory.task.progress",
                                "inventory.purchase.request", "inventory.exception.report"], "staff")
LIBRARIAN = U(["LIBRARIAN"], ["inventory.catalog.read", "borrow.read", "borrow.write", "borrow.loans.read"], "lib")
CUSTOMER = U(["CUSTOMER"], ["inventory.catalog.read", "customer.self.read", "customer.self.write"], "cust")
SUPPLIER = U(["SUPPLIER"], ["supplier.portal.read", "supplier.portal.write"], "sup")
ALL_SIX = {"ADMIN": ADMIN, "WAREHOUSE_MANAGER": MANAGER, "WAREHOUSE_STAFF": STAFF, "LIBRARIAN": LIBRARIAN,
           "CUSTOMER": CUSTOMER, "SUPPLIER": SUPPLIER}


def ids(user):
    return {c.id for c in caps.allowed(user)}


class CapabilityMatrixTest(unittest.TestCase):
    def test_each_role_gets_its_experience(self):
        expected = {"ADMIN": "decision_assistant", "WAREHOUSE_MANAGER": "decision_assistant",
                    "WAREHOUSE_STAFF": "warehouse_work", "LIBRARIAN": "library_operations",
                    "CUSTOMER": "reader", "SUPPLIER": "supplier"}
        for role, user in ALL_SIX.items():
            with self.subTest(role):
                self.assertEqual(caps.experience(user), expected[role])

    def test_internal_and_personal_boundaries(self):
        self.assertTrue({"reader.loans", "reader.fines", "reader.reserve", "book.identify_image"} <= ids(CUSTOMER))
        self.assertFalse(ids(CUSTOMER) & {"analytics.chat", "ops.overview", "decision.assistant", "supplier.orders",
                                          "library.circulation"})
        self.assertEqual(ids(SUPPLIER) - {"library.policy", "catalog.search", "catalog.availability"},
                         {"supplier.orders"})
        self.assertIn("library.circulation", ids(LIBRARIAN))
        self.assertFalse(ids(LIBRARIAN) & {"ops.overview", "decision.assistant", "reader.loans"})
        self.assertTrue({"warehouse.my_tasks", "warehouse.picking", "warehouse.putaway", "warehouse.exceptions",
                         "warehouse.purchase_request"} <= ids(STAFF))
        self.assertFalse(ids(STAFF) & {"ops.overview", "decision.assistant", "library.circulation"})
        self.assertTrue({"decision.assistant", "ops.overview", "ops.decide"} <= ids(MANAGER))
        self.assertNotIn("library.circulation", ids(MANAGER))  # managers have no borrow permission

    def test_role_without_permission_and_permission_without_role(self):
        self.assertNotIn("reader.loans", ids(U(["CUSTOMER"], [])))
        self.assertNotIn("reader.loans", ids(U(["LIBRARIAN"], ["customer.self.read"])))
        self.assertNotIn("decision.assistant", ids(U(["WAREHOUSE_MANAGER"], ["inventory.catalog.read"])))
        self.assertNotIn("decision.assistant", ids(U(["LIBRARIAN"], ["analytics.reports.view"])))
        self.assertNotIn("supplier.orders", ids(U(["CUSTOMER"], ["supplier.portal.read"])))
        self.assertNotIn("supplier.orders", ids(U(["SUPPLIER"], [])))
        self.assertNotIn("book.identify_image", ids(SUPPLIER))  # no catalog permission

    def test_revoked_permission_takes_effect_on_the_next_request(self):
        before = U(["WAREHOUSE_STAFF"], ["inventory.task.read"])
        after = U(["WAREHOUSE_STAFF"], [])
        self.assertIn("warehouse.picking", ids(before))
        self.assertNotIn("warehouse.picking", ids(after))

    def test_superuser_and_anonymous(self):
        self.assertEqual(ids(U([], [], superuser=True)), {c.id for c in caps.CAPABILITIES})
        self.assertEqual(ids(None), {"library.policy", "catalog.search", "catalog.availability"})

    def test_multi_role_is_the_union_not_the_primary_role(self):
        both = U(["LIBRARIAN", "CUSTOMER"], ["borrow.read", "borrow.write", "customer.self.read",
                                             "inventory.catalog.read"])
        self.assertEqual(caps.primary_role(both), "LIBRARIAN")  # persona only
        self.assertTrue({"library.circulation", "reader.loans"} <= ids(both))
        self.assertTrue({"/borrow/loans", "/borrow/my/loans"} <= set(caps.personal_endpoints(both)))

    def test_assistant_capability_is_exactly_the_assistant_gate(self):
        users = list(ALL_SIX.values()) + [
            U(["WAREHOUSE_MANAGER"], []), U(["LIBRARIAN"], ["analytics.reports.view"]), U([], [], superuser=True),
            U(["ADMIN", "CUSTOMER"], ["reports.read"]), U(["MANAGER"], ["analytics.read"])]
        for user in users:
            with self.subTest(roles=user.roles, perms=user.permissions):
                self.assertEqual(caps.allows(user, "decision.assistant"), can_use_assistant(user))

    def test_starters_only_offer_what_the_user_can_get(self):
        mgr = caps.starter_questions(MANAGER)
        self.assertFalse(any("phạt" in q or "mượn" in q.lower() and "quá hạn" in q for q in mgr), mgr)
        self.assertIn("Tôi có sách nào sắp đến hạn trả?", caps.starter_questions(CUSTOMER))
        self.assertTrue(all("đơn" in q.lower() or "hóa đơn" in q.lower() or "quy định" in q.lower()
                            for q in caps.starter_questions(SUPPLIER)))
        self.assertIn("Hôm nay tôi có nhiệm vụ kho nào?", caps.starter_questions(STAFF))

    def test_describe_lists_confirmation_from_the_action_config(self):
        described = {c["id"]: c for c in caps.describe(CUSTOMER)["capabilities"]}
        self.assertTrue(described["reader.reserve"]["requires_confirmation"])
        self.assertEqual(described["reader.reserve"]["actions"], ["CREATE_RESERVATION_DRAFT"])


class PersonalContextByCapabilityTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.fetched = []

        async def fake_fetch(client, endpoint, auth_header):
            self.fetched.append(endpoint)
            return endpoint, ORDERS if endpoint == "/api/supplier-account/orders" else {"data": []}, None

        self._p = patch.object(upc, "_fetch_one", new=fake_fetch)
        self._p.start()

    async def asyncTearDown(self):
        self._p.stop()

    async def test_librarian_who_is_also_a_reader_gets_their_own_loans(self):
        both = U(["LIBRARIAN", "CUSTOMER"], ["borrow.read", "customer.self.read"])
        await upc.build_user_personal_context(both, {"intent": "GENERAL_QUERY"}, "Bearer x", "Tôi đang mượn sách nào?")
        self.assertIn("/borrow/my/loans", self.fetched)

    async def test_supplier_reads_only_its_own_orders(self):
        personal = await upc.build_user_personal_context(SUPPLIER, {"intent": "GENERAL_QUERY"}, "Bearer s",
                                                         "Đơn hàng của tôi đã giao đủ chưa?")
        self.assertEqual(self.fetched, ["/api/supplier-account/orders"])
        self.assertIn("PO-2026-001", personal["summary"])
        self.assertIn("còn chờ giao 4 cuốn", personal["summary"])
        self.assertIn("1 báo thiếu chưa xử lý", personal["summary"])

    async def test_supplier_never_reaches_staff_borrow_or_analytics_endpoints(self):
        await upc.build_user_personal_context(SUPPLIER, {"intent": "DASHBOARD_SUMMARY_QUERY"}, "Bearer s",
                                              "Cho tôi xem tất cả thông tin của tôi")
        self.assertEqual(self.fetched, ["/api/supplier-account/orders"])

    async def test_staff_exception_reports_use_the_real_route(self):
        await upc.build_user_personal_context(STAFF, {"intent": "GENERAL_QUERY"}, "Bearer w",
                                              "Báo cáo ngoại lệ của tôi thế nào?")
        self.assertIn("/api/exception-reports/my", self.fetched)
        self.assertNotIn("/api/my-exception-reports", self.fetched)

    async def test_reader_without_permission_reads_nothing_personal(self):
        await upc.build_user_personal_context(U(["CUSTOMER"], []), {"intent": "GENERAL_QUERY"}, "Bearer c",
                                              "Tôi đang mượn sách nào?")
        self.assertEqual(self.fetched, [])


ORDERS = {"data": {"supplier": {"id": "s1", "name": "NCC Phương Nam"}, "orders": [{
    "dispatch": {"status": "SENT"},
    "purchase_order": {"po_number": "PO-2026-001", "status": "CONFIRMED", "expected_date": "2026-11-20T00:00:00Z",
                       "items": [{"ordered_qty": 10, "remaining_qty": 4}, {"ordered_qty": 5, "remaining_qty": 0}]},
    "invoices": [{"id": 1}], "shortage_reports": [{"status": "OPEN"}],
}]}}


class ToolAllowlistTest(unittest.IsolatedAsyncioTestCase):
    async def test_tool_outside_capabilities_is_refused(self):
        called = AsyncMock(return_value={"ok": True})
        with patch.dict(ai_tools.TOOL_FUNCTIONS, {"get_top_books": called}):
            token = ai_tools.CALLER.set(LIBRARIAN)
            try:
                refused = await ai_tools.run_read_tool("get_top_books", {}, "Bearer lib")
            finally:
                ai_tools.CALLER.reset(token)
            token = ai_tools.CALLER.set(MANAGER)
            try:
                allowed = await ai_tools.run_read_tool("get_top_books", {}, "Bearer mgr")
            finally:
                ai_tools.CALLER.reset(token)
        self.assertIn("error", refused)
        self.assertEqual(allowed, {"ok": True})
        self.assertEqual(called.await_count, 1)


def _request(token=None):
    return SimpleNamespace(headers={"authorization": token} if token else {}, client=SimpleNamespace(host="gw"))


class CapabilitiesEndpointTest(unittest.IsolatedAsyncioTestCase):
    async def test_anonymous_gets_public_capabilities_only(self):
        body = await routes_ai_experience.get_capabilities(_request())
        self.assertEqual(body["experience"], "anonymous")
        self.assertFalse(body["multimodal"]["enabled"])

    async def test_roles_come_from_auth_service_not_the_client(self):
        with patch("ai_core.policy.get_user_context", new=AsyncMock(return_value=SUPPLIER)):
            body = await routes_ai_experience.get_capabilities(_request("Bearer s"))
        self.assertEqual(body["persona"]["primary_role"], "SUPPLIER")
        self.assertFalse(body["multimodal"]["enabled"])
        self.assertNotIn("decision.assistant", [c["id"] for c in body["capabilities"]])

    async def test_revoked_token_is_refused(self):
        revoked = AsyncMock(side_effect=HTTPException(status_code=401, detail="Invalid or expired token."))
        with patch("ai_core.policy.get_user_context", new=revoked):
            with self.assertRaises(HTTPException) as ctx:
                await routes_ai_experience.get_capabilities(_request("Bearer revoked"))
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
