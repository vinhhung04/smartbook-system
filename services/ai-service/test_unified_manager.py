"""A manager of both warehouse and library work = one account holding
WAREHOUSE_MANAGER + LIBRARIAN (no merged role). Permissions are the union of
the two roles as auth-service issues them (services/auth-service/prisma/seed.js);
LIBRARIAN carries analytics.borrow.read since the unified-manager change.

The AI must open both domains to that account and keep each one closed to an
account holding only the other role. Warehouse/branch scope is enforced by the
target services with the caller's token (test_warehouse_scope,
test_copilot_security); these tests cover the AI-side gates.
"""
from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

import main
from agent_actions import CREATE_RESERVATION_DRAFT, CREATE_STOCK_ALERT, CREATE_REORDER_DRAFT
from agent_permissions import can_confirm_action
from agent_schemas import PendingAction, UserContext
from ai_core import capabilities
from copilot_response import _can_read_borrow
from routes_conversations import can_use_assistant

WM_PERMS = ["analytics.reports.view", "analytics.reports.export", "analytics.forecast.view", "reports.read",
            "inventory.stock.read", "inventory.operation.decide", "inventory.purchase.request",
            "inventory.transfer.write", "inventory.catalog.read"]
LIB_PERMS = ["inventory.catalog.read", "borrow.read", "borrow.write", "borrow.customers.read", "borrow.customers.write",
             "borrow.loans.read", "borrow.loans.write", "borrow.fines.manage", "borrow.payments.process",
             "analytics.borrow.read"]

WAREHOUSE_ONLY = UserContext(user_id="wm", roles=["WAREHOUSE_MANAGER"], permissions=WM_PERMS)
LIBRARY_ONLY = UserContext(user_id="lib", roles=["LIBRARIAN"], permissions=LIB_PERMS)
UNIFIED = UserContext(user_id="um", roles=["LIBRARIAN", "WAREHOUSE_MANAGER"],
                      permissions=sorted(set(WM_PERMS) | set(LIB_PERMS)))


def _action(kind: str) -> PendingAction:
    return PendingAction(id="a", type=kind, status="PENDING_CONFIRMATION", summary="", payload={}, risk="LOW",
                         requires_confirmation=True, allowed_roles=[], allowed_permissions=[],
                         created_from_message="", created_at="", expires_at="")


class UnifiedManagerAccessTests(unittest.TestCase):
    def test_unified_manager_uses_the_decision_assistant_with_library_data(self):
        self.assertTrue(can_use_assistant(UNIFIED))
        self.assertTrue(_can_read_borrow(UNIFIED))
        held = {c.id for c in capabilities.allowed(UNIFIED)}
        self.assertTrue({"decision.assistant", "ops.overview", "library.circulation"} <= held)
        self.assertEqual(capabilities.experience(UNIFIED), "decision_assistant")

    def test_each_single_role_keeps_only_its_own_domain(self):
        # warehouse manager: assistant yes, borrow analytics no
        self.assertTrue(can_use_assistant(WAREHOUSE_ONLY))
        self.assertFalse(_can_read_borrow(WAREHOUSE_ONLY))
        self.assertNotIn("library.circulation", {c.id for c in capabilities.allowed(WAREHOUSE_ONLY)})
        # librarian: borrow data yes, the warehouse decision assistant no
        self.assertFalse(can_use_assistant(LIBRARY_ONLY))
        self.assertTrue(_can_read_borrow(LIBRARY_ONLY))
        held = {c.id for c in capabilities.allowed(LIBRARY_ONLY)}
        self.assertIn("library.circulation", held)
        self.assertNotIn("decision.assistant", held)
        self.assertNotIn("ops.overview", held)

    def test_assistant_tools_open_for_the_unified_manager_only_through_the_gate(self):
        from tool_registry import TOOL_FUNCTIONS
        for tool in ("get_overdue_summary", "get_reservation_funnel", "get_borrow_trends", "get_warehouse_stock_risk",
                     "analyze_inventory_rebalancing"):
            self.assertIn(tool, TOOL_FUNCTIONS)
            self.assertTrue(capabilities.tool_allowed(UNIFIED, tool), tool)
            self.assertFalse(capabilities.tool_allowed(LIBRARY_ONLY, tool), tool)

    def test_unified_manager_confirms_actions_of_both_domains(self):
        for kind in (CREATE_RESERVATION_DRAFT, CREATE_STOCK_ALERT, CREATE_REORDER_DRAFT):
            self.assertTrue(can_confirm_action(UNIFIED, _action(kind)), kind)
        self.assertFalse(can_confirm_action(WAREHOUSE_ONLY, _action(CREATE_RESERVATION_DRAFT)))
        self.assertFalse(can_confirm_action(LIBRARY_ONLY, _action(CREATE_STOCK_ALERT)))

    def test_losing_the_librarian_role_closes_the_library_side(self):
        revoked = UserContext(**{**UNIFIED.model_dump(), "roles": ["WAREHOUSE_MANAGER"], "permissions": WM_PERMS})
        self.assertFalse(_can_read_borrow(revoked))
        self.assertFalse(can_confirm_action(revoked, _action(CREATE_RESERVATION_DRAFT)))
        self.assertTrue(can_use_assistant(revoked))


class UnifiedManagerCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_managers_with_the_same_roles_but_other_scopes_never_share_cached_answers(self):
        other = UserContext(**{**UNIFIED.model_dump(), "user_id": "um2"})

        async def readable(user_ctx, **_kw):
            return frozenset({"wh-a", "br-a"}) if user_ctx.user_id == "um" else frozenset({"wh-b"})

        with patch("warehouse_scope.readable_warehouses", new=readable):
            a = await main._access_fingerprint(UNIFIED)
            b = await main._access_fingerprint(other)
        self.assertNotEqual(a, b)
        self.assertNotEqual(main._assistant_cache_key("c1", "Kho nào thiếu sách?", a),
                            main._assistant_cache_key("c1", "Kho nào thiếu sách?", b))

    async def test_a_role_change_changes_the_cache_partition(self):
        revoked = UserContext(**{**UNIFIED.model_dump(), "roles": ["WAREHOUSE_MANAGER"], "permissions": WM_PERMS})
        with patch("warehouse_scope.readable_warehouses", new=AsyncMock(return_value=frozenset({"wh-a"}))):
            self.assertNotEqual(await main._access_fingerprint(UNIFIED), await main._access_fingerprint(revoked))


if __name__ == "__main__":
    unittest.main()
