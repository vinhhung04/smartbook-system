"""The AI permission matrix, role by role, with the permissions each role
actually holds in auth_db (queried 2026-11-12 from role_permissions; only the
permissions relevant here are listed). Documented in
docs/AI/PERMISSION_MATRIX.md - keep the two in sync.

Every decision is Role AND Permission, like the web (canAccess) and like the
target services; superusers pass everything.
"""
from __future__ import annotations

import unittest

from agent_actions import (
    ACTION_CONFIG,
    CREATE_REORDER_DRAFT,
    CREATE_REPORT_DRAFT,
    CREATE_RESERVATION_DRAFT,
    CREATE_STAFF_TASK_DRAFT,
    CREATE_STOCK_ALERT,
)
from agent_permissions import can_confirm_action
from agent_schemas import PendingAction, UserContext
from routes_conversations import can_use_assistant

ROLES = {
    "ADMIN": UserContext(user_id="a", roles=["ADMIN"], permissions=[
        "analytics.reports.view", "reports.read", "inventory.operation.decide", "inventory.purchase.request",
        "customer.self.read", "customer.self.write", "borrow.write"]),
    "WAREHOUSE_MANAGER": UserContext(user_id="m", roles=["WAREHOUSE_MANAGER"], permissions=[
        "analytics.reports.view", "reports.read", "inventory.operation.decide", "inventory.purchase.request"]),
    "WAREHOUSE_STAFF": UserContext(user_id="s", roles=["WAREHOUSE_STAFF"], permissions=[
        "inventory.purchase.request", "inventory.task.read"]),
    "LIBRARIAN": UserContext(user_id="l", roles=["LIBRARIAN"], permissions=[
        "borrow.customers.read", "borrow.customers.write", "borrow.loans.write", "borrow.write"]),
    "CUSTOMER": UserContext(user_id="c", roles=["CUSTOMER"], permissions=["customer.self.read", "customer.self.write"]),
    "SUPPLIER": UserContext(user_id="p", roles=["SUPPLIER"], permissions=["supplier.portal.read", "supplier.portal.write"]),
}

# who may CONFIRM each action type (= who the target service accepts the write from)
EXPECTED = {
    CREATE_REORDER_DRAFT: {"ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF"},
    CREATE_STOCK_ALERT: {"ADMIN", "WAREHOUSE_MANAGER"},
    CREATE_STAFF_TASK_DRAFT: {"ADMIN", "WAREHOUSE_MANAGER"},
    CREATE_RESERVATION_DRAFT: {"ADMIN", "LIBRARIAN", "CUSTOMER"},
    CREATE_REPORT_DRAFT: {"ADMIN", "WAREHOUSE_MANAGER", "LIBRARIAN"},
}
ASSISTANT = {"ADMIN", "WAREHOUSE_MANAGER"}


def _action(action_type: str, stored_roles=None) -> PendingAction:
    return PendingAction(
        id="act_1", type=action_type, status="PENDING_CONFIRMATION", summary="", payload={}, risk="LOW",
        requires_confirmation=True, allowed_roles=stored_roles if stored_roles is not None else [],
        allowed_permissions=[], created_from_message="", created_at="", expires_at="")


class PermissionMatrixTest(unittest.TestCase):
    def test_every_action_type_is_covered(self):
        self.assertEqual(set(EXPECTED), set(ACTION_CONFIG))

    def test_confirm_matrix(self):
        for action_type, allowed in EXPECTED.items():
            for role, user in ROLES.items():
                with self.subTest(action=action_type, role=role):
                    self.assertEqual(can_confirm_action(user, _action(action_type)), role in allowed)

    def test_role_without_the_permission_is_refused(self):
        bare_manager = UserContext(user_id="m2", roles=["WAREHOUSE_MANAGER"], permissions=[])
        for action_type in (CREATE_STOCK_ALERT, CREATE_STAFF_TASK_DRAFT, CREATE_REORDER_DRAFT):
            with self.subTest(action=action_type):
                self.assertFalse(can_confirm_action(bare_manager, _action(action_type)))

    def test_permission_without_the_role_is_refused_where_the_target_requires_both(self):
        decider = UserContext(user_id="x", roles=["WAREHOUSE_STAFF"], permissions=["inventory.operation.decide"])
        self.assertFalse(can_confirm_action(decider, _action(CREATE_STOCK_ALERT)))
        customer_perm_only = UserContext(user_id="y", roles=["LIBRARIAN"], permissions=["customer.self.write"])
        self.assertFalse(can_confirm_action(customer_perm_only, _action(CREATE_RESERVATION_DRAFT)))

    def test_the_role_list_stored_on_an_old_action_is_not_trusted(self):
        # drafted before the policy change with WAREHOUSE_STAFF in its stored list
        stale = _action(CREATE_STOCK_ALERT, stored_roles=["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF"])
        self.assertFalse(can_confirm_action(ROLES["WAREHOUSE_STAFF"], stale))

    def test_unknown_action_type_is_never_confirmable(self):
        superuser = UserContext(user_id="su", roles=["ADMIN"], is_superuser=True)
        self.assertFalse(can_confirm_action(superuser, _action("DELETE_BOOK")))

    def test_superuser_passes_every_known_type(self):
        superuser = UserContext(user_id="su", roles=[], is_superuser=True)
        for action_type in ACTION_CONFIG:
            self.assertTrue(can_confirm_action(superuser, _action(action_type)))

    def test_decision_assistant_gate_matches_the_web(self):
        for role, user in ROLES.items():
            with self.subTest(role=role):
                self.assertEqual(can_use_assistant(user), role in ASSISTANT)
        # web canAccess(aiAssistant) = manager role AND analytics permission: both halves required
        self.assertFalse(can_use_assistant(UserContext(user_id="r", roles=["WAREHOUSE_MANAGER"], permissions=[])))
        self.assertFalse(can_use_assistant(UserContext(user_id="r", roles=["LIBRARIAN"], permissions=["analytics.read"])))
        self.assertTrue(can_use_assistant(UserContext(user_id="r", roles=[], permissions=[], is_superuser=True)))


if __name__ == "__main__":
    unittest.main()
