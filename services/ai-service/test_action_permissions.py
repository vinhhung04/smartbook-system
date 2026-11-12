"""Phase 4: an AI action card is offered only to someone its downstream write
would accept. inventory-service guards POST /api/stock-alerts and
POST /api/staff-tasks with authorizeManagerDecision (WAREHOUSE_MANAGER/ADMIN +
inventory.operation.decide), so a warehouse staff member - who used to get
these cards and then a 403 on confirm - must not be able to confirm them."""
from __future__ import annotations

import unittest

from agent_actions import (
    ACTION_CONFIG,
    CREATE_REORDER_DRAFT,
    CREATE_STAFF_TASK_DRAFT,
    CREATE_STOCK_ALERT,
)
from agent_permissions import can_confirm_action
from agent_schemas import PendingAction, UserContext

STAFF = UserContext(user_id="s", roles=["WAREHOUSE_STAFF"], permissions=[
    "inventory.task.read", "inventory.stock.read", "inventory.exception.report", "inventory.purchase.request"])
MANAGER = UserContext(user_id="m", roles=["WAREHOUSE_MANAGER"], permissions=["inventory.operation.decide"])


def _action(action_type: str) -> PendingAction:
    config = ACTION_CONFIG[action_type]
    return PendingAction(
        id="act_1", type=action_type, status="PENDING_CONFIRMATION", summary="", payload={}, risk=config["risk"],
        requires_confirmation=True, allowed_roles=config["allowed_roles"],
        allowed_permissions=config["allowed_permissions"], created_from_message="", created_at="", expires_at="",
    )


class ActionPermissionTest(unittest.TestCase):
    def test_manager_only_actions_are_not_offered_to_staff(self):
        for action_type in (CREATE_STOCK_ALERT, CREATE_STAFF_TASK_DRAFT):
            with self.subTest(action_type):
                self.assertFalse(can_confirm_action(STAFF, _action(action_type)))
                self.assertTrue(can_confirm_action(MANAGER, _action(action_type)))

    def test_staff_can_still_confirm_a_purchase_request_draft(self):
        # POST /api/purchase-requests only needs inventory.purchase.request
        self.assertTrue(can_confirm_action(STAFF, _action(CREATE_REORDER_DRAFT)))


if __name__ == "__main__":
    unittest.main()
