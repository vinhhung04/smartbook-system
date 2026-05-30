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

# ── Risk level ────────────────────────────────────────────────────────────────
RISK_LOW = "LOW"
RISK_MEDIUM = "MEDIUM"
RISK_HIGH = "HIGH"

# ── Action configuration ──────────────────────────────────────────────────────
ACTION_CONFIG: dict[str, dict] = {
    CREATE_REORDER_DRAFT: {
        "allowed_roles": ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF"],
        "allowed_permissions": ["inventory.purchase.request"],
        "risk": RISK_MEDIUM,
        "requires_confirmation": True,
        "description": "Tạo purchase request/đề xuất nhập sách, không cập nhật tồn kho.",
    },
    CREATE_REPORT_DRAFT: {
        "allowed_roles": ["ADMIN", "WAREHOUSE_MANAGER", "LIBRARIAN"],
        "allowed_permissions": ["analytics.read", "borrow.report.read", "inventory.report.read"],
        "risk": RISK_LOW,
        "requires_confirmation": True,
        "description": "Tạo báo cáo markdown từ dữ liệu retrieval, không ghi DB.",
    },
    CREATE_RESERVATION_DRAFT: {
        "allowed_roles": ["ADMIN", "LIBRARIAN", "CUSTOMER"],
        "allowed_permissions": ["borrow.reservation.write", "customer.self.write"],
        "risk": RISK_MEDIUM,
        "requires_confirmation": True,
        "description": "Tạo reservation draft, chỉ gọi API thật nếu đủ variant_id + warehouse_id + customer context.",
    },
    CREATE_STOCK_ALERT: {
        "allowed_roles": ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF"],
        "allowed_permissions": ["inventory.stock.read", "inventory.task.read"],
        "risk": RISK_LOW,
        "requires_confirmation": True,
        "description": "Tạo cảnh báo tồn kho thấp/hết hàng từ warehouse-stock-risk, không chỉnh tồn kho.",
    },
    CREATE_STAFF_TASK_DRAFT: {
        "allowed_roles": ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF"],
        "allowed_permissions": ["inventory.task.read", "inventory.exception.report", "inventory.purchase.request"],
        "risk": RISK_MEDIUM,
        "requires_confirmation": True,
        "description": "Tạo task draft cho staff. Bản đầu lưu trong AI Agent store hoặc trả demo-safe draft nếu chưa có task service thật.",
    },
}

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
