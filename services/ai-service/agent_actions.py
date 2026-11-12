from __future__ import annotations

# ── Action type constants ─────────────────────────────────────────────────────
CREATE_REORDER_DRAFT = "CREATE_REORDER_DRAFT"
CREATE_REPORT_DRAFT = "CREATE_REPORT_DRAFT"
CREATE_RESERVATION_DRAFT = "CREATE_RESERVATION_DRAFT"
CREATE_STOCK_ALERT = "CREATE_STOCK_ALERT"
CREATE_STAFF_TASK_DRAFT = "CREATE_STAFF_TASK_DRAFT"

# ── Action status ─────────────────────────────────────────────────────────────
PENDING_CONFIRMATION = "PENDING_CONFIRMATION"
CONFIRMED = "CONFIRMED"
EXECUTED = "EXECUTED"
CANCELLED = "CANCELLED"
FAILED = "FAILED"
EXPIRED = "EXPIRED"
# The executor called the target service but cannot tell whether the write
# happened (timeout, connection drop, 5xx, a crash mid-execution). Never
# re-executed automatically: a person checks the target and resolves it to
# EXECUTED or FAILED (POST /actions/reconcile).
RECONCILE_REQUIRED = "RECONCILE_REQUIRED"

# Types whose execution can safely run again after an unknown outcome: the
# report draft writes nothing, and a reservation is sent with the
# Idempotency-Key ai-reservation-<action id>, which borrow-service replays
# instead of creating a second reservation. Everything else needs a person.
RETRY_SAFE_ACTIONS = frozenset({"CREATE_REPORT_DRAFT", "CREATE_RESERVATION_DRAFT"})

# ── Risk level ────────────────────────────────────────────────────────────────
RISK_LOW = "LOW"
RISK_MEDIUM = "MEDIUM"
RISK_HIGH = "HIGH"

# ── Action configuration ──────────────────────────────────────────────────────
#
# `policy` decides who may confirm an action - and it is the SAME rule the
# target service enforces on the write, so a card is never offered to someone
# whose confirm the target would refuse. It is a list of alternatives; a user
# qualifies through ONE alternative when they hold one of its roles AND one of
# its permissions (an empty list there means "any"). Superusers always
# qualify. Checked again at confirm time against this config (not the copy
# stored on the action), so a role or permission change takes effect at once.
#
# Target guards this mirrors (verified 2026-11-12):
#   POST /api/purchase-requests   inventory authorizeAnyPermission(['inventory.purchase.request'])
#   POST /api/stock-alerts        inventory authorizeManagerDecision: WAREHOUSE_MANAGER|ADMIN + inventory.operation.decide
#   POST /api/staff-tasks         same as stock alerts
#   POST /borrow/my/reservations  borrow authorizeCustomerSelf: CUSTOMER + customer.self.read|write
#   POST /borrow/reservations     borrow authorizeBorrowAdminWrite: LIBRARIAN|ADMIN + borrow write permission
_BORROW_WRITE = ["borrow.write", "borrow.customers.write", "borrow.loans.write", "borrow.fines.manage",
                 "borrow.fine.write", "borrow.membership.write"]
_MANAGER_DECISION = [{"roles": ["ADMIN", "WAREHOUSE_MANAGER"], "permissions": ["inventory.operation.decide"]}]

ACTION_CONFIG: dict[str, dict] = {
    CREATE_REORDER_DRAFT: {
        "policy": [{"roles": [], "permissions": ["inventory.purchase.request"]}],
        "risk": RISK_MEDIUM,
        "requires_confirmation": True,
        "description": "Tạo purchase request/đề xuất nhập sách, không cập nhật tồn kho.",
    },
    CREATE_REPORT_DRAFT: {
        # writes nothing anywhere: staff roles, or anyone who may read reports
        "policy": [{"roles": ["ADMIN", "WAREHOUSE_MANAGER", "LIBRARIAN"], "permissions": []},
                   {"roles": [], "permissions": ["analytics.read", "borrow.report.read", "inventory.report.read"]}],
        "risk": RISK_LOW,
        "requires_confirmation": True,
        "description": "Tạo báo cáo markdown từ dữ liệu retrieval, không ghi DB.",
    },
    CREATE_RESERVATION_DRAFT: {
        # a reader for themself (/my/reservations), or library staff for a customer
        "policy": [{"roles": ["CUSTOMER"], "permissions": ["customer.self.read", "customer.self.write"]},
                   {"roles": ["LIBRARIAN", "ADMIN"], "permissions": _BORROW_WRITE}],
        "risk": RISK_MEDIUM,
        "requires_confirmation": True,
        "description": "Tạo reservation draft, chỉ gọi API thật nếu đủ variant_id + warehouse_id + customer context.",
    },
    CREATE_STOCK_ALERT: {
        "policy": _MANAGER_DECISION,
        "risk": RISK_LOW,
        "requires_confirmation": True,
        "description": "Tạo cảnh báo tồn kho thấp/hết hàng từ warehouse-stock-risk, không chỉnh tồn kho.",
    },
    CREATE_STAFF_TASK_DRAFT: {
        "policy": _MANAGER_DECISION,
        "risk": RISK_MEDIUM,
        "requires_confirmation": True,
        "description": "Tạo task draft cho staff. Bản đầu lưu trong AI Agent store hoặc trả demo-safe draft nếu chưa có task service thật.",
    },
}

# Flattened copies stored on each action and shown to clients (pre-policy
# fields kept for compatibility). Informational only: decisions use `policy`.
for _config in ACTION_CONFIG.values():
    _config["allowed_roles"] = sorted({r for alt in _config["policy"] for r in alt["roles"]})
    _config["allowed_permissions"] = sorted({p for alt in _config["policy"] for p in alt["permissions"]})


def policy_allows(policy: list[dict], roles, permissions, is_superuser: bool = False) -> bool:
    """True when the user satisfies one alternative of the policy (role AND
    permission; an empty list in an alternative matches anything)."""
    if is_superuser:
        return True
    user_roles = {normalize_role(r) for r in roles or []}
    user_perms = set(permissions or [])
    for alt in policy:
        role_ok = not alt["roles"] or bool(user_roles & {normalize_role(r) for r in alt["roles"]})
        perm_ok = not alt["permissions"] or bool(user_perms & set(alt["permissions"]))
        if role_ok and perm_ok:
            return True
    return False


# ── Dangerous action denylist — AI MUST NEVER execute these ──────────────────
DANGEROUS_ACTION_DENYLIST: frozenset[str] = frozenset([
    "DELETE_BOOK",
    "DELETE_USER",
    "UPDATE_USER_ROLE",
    "UPDATE_STOCK_DIRECTLY",
    "COLLECT_FINE",
    "APPROVE_LOAN_DIRECTLY",
    "APPROVE_PURCHASE_ORDER",
    "POST_GOODS_RECEIPT",
    "RAW_SQL",
    "INVENTORY_INBOUND_DIRECT",
])


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_supported_action(action_type: str) -> bool:
    return action_type in ACTION_CONFIG


def get_action_config(action_type: str) -> dict | None:
    return ACTION_CONFIG.get(action_type)


def is_dangerous_action(action_type: str) -> bool:
    return action_type in DANGEROUS_ACTION_DENYLIST


def normalize_role(role: str) -> str:
    """Normalize role string to uppercase with underscores."""
    return role.upper().replace(" ", "_").replace("-", "_")
