"""Role-aware capability registry (Phase F1): what SmartBook AI may do for a
user, decided from ALL their roles AND permissions - never from one "primary"
role, never from anything a client or the model says.

A capability names a business ability ("đọc phiếu mượn của chính mình", "xem
đơn hàng của nhà cung cấp mình") and declares:

  policy        who holds it: alternatives of role AND permission, checked by
                agent_actions.policy_allows (the same rule the action layer and
                the target services use; superusers pass)
  data_scope    whose data it reaches: public | self | supplier_self |
                library | warehouse_scope | system
  endpoints     personal-context reads the chatbot may make for it, always
                with the caller's own token (the target re-checks)
  tools         READ tools of the Decision Assistant it unlocks (names in
                ai_core.tools.READ_TOOLS - not redefined here)
  actions       action types it may draft (keys of agent_actions.ACTION_CONFIG -
                confirmation policy and `requires_confirmation` stay there)
  sensitivity   LOW | MEDIUM | HIGH          personal   touches personal data

The registry only ever NARROWS: holding a capability lets the AI attempt a
read with the caller's token; the target service still decides. Nothing here
replaces can_use_assistant, the action confirm policy or warehouse scope.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from agent_actions import ACTION_CONFIG, normalize_role, policy_allows

# Display order only (persona, greeting). Never an authorization input.
ROLE_ORDER = ["ADMIN", "WAREHOUSE_MANAGER", "LIBRARIAN", "WAREHOUSE_STAFF", "SUPPLIER", "CUSTOMER"]
ROLE_LABELS = {"ADMIN": "Quản trị viên", "WAREHOUSE_MANAGER": "Quản lý kho", "LIBRARIAN": "Thủ thư",
               "WAREHOUSE_STAFF": "Nhân viên kho", "SUPPLIER": "Nhà cung cấp", "CUSTOMER": "Độc giả"}
INTERNAL_ROLES = ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF", "LIBRARIAN"]
ANALYTICS_PERMS = ["analytics.reports.view", "analytics.read", "reports.read"]
CATALOG_PERMS = ["inventory.catalog.read", "inventory.catalog.write"]
_BORROW_READ = ["borrow.read", "borrow.loans.read", "borrow.customers.read", "borrow.write", "borrow.loans.write"]
_ANYONE: list[dict] = [{"roles": [], "permissions": []}]


@dataclass(frozen=True)
class Capability:
    id: str
    label: str
    policy: list
    data_scope: str
    sensitivity: str = "LOW"
    personal: bool = False
    endpoints: tuple = ()
    tools: tuple = ()
    actions: tuple = ()
    public: bool = False  # also offered to anonymous visitors
    starters: tuple = field(default=())


CAPABILITIES: tuple[Capability, ...] = (
    # ── public ────────────────────────────────────────────────────────────
    Capability("library.policy", "Giải đáp quy định, giờ mở cửa, quy trình", _ANYONE, "public", public=True,
               starters=("Quy định mượn và trả sách thế nào?",)),
    Capability("catalog.search", "Tìm sách theo tên, tác giả, ISBN", _ANYONE, "public", public=True,
               starters=("Tìm giúp tôi sách của Nguyễn Nhật Ánh.",)),
    Capability("catalog.availability", "Tình trạng sách tại các chi nhánh công khai", _ANYONE, "public",
               public=True),
    # Identification needs the caller to read the catalog it matches against.
    Capability("book.identify_image", "Nhận diện sách từ ảnh bìa (OCR + so khớp ảnh)",
               [{"roles": [], "permissions": CATALOG_PERMS}], "public",
               starters=("Gửi ảnh bìa sách để tôi nhận diện giúp bạn.",)),
    # ── reader (self) ─────────────────────────────────────────────────────
    Capability("reader.loans", "Sách đang mượn và hạn trả của tôi",
               [{"roles": ["CUSTOMER"], "permissions": ["customer.self.read"]}], "self", "MEDIUM", True,
               endpoints=("/borrow/my/loans",), starters=("Tôi có sách nào sắp đến hạn trả?",)),
    Capability("reader.reservations", "Đặt trước của tôi",
               [{"roles": ["CUSTOMER"], "permissions": ["customer.self.read"]}], "self", "MEDIUM", True,
               endpoints=("/borrow/my/reservations",), starters=("Tình trạng đặt sách của tôi thế nào?",)),
    Capability("reader.fines", "Tiền phạt của tôi",
               [{"roles": ["CUSTOMER"], "permissions": ["customer.self.read"]}], "self", "MEDIUM", True,
               endpoints=("/borrow/my/fines",), starters=("Tôi có khoản phạt nào chưa thanh toán?",)),
    Capability("reader.membership", "Thẻ thành viên của tôi",
               [{"roles": ["CUSTOMER"], "permissions": ["customer.self.read"]}], "self", "MEDIUM", True,
               endpoints=("/borrow/my/membership",)),
    Capability("reader.wallet", "Ví và số dư (chỉ khi được hỏi)",
               [{"roles": ["CUSTOMER"], "permissions": ["customer.self.read"]}], "self", "HIGH", True,
               endpoints=("/borrow/my/account",)),
    Capability("reader.reserve", "Đặt trước sách cho chính mình (cần xác nhận)",
               [{"roles": ["CUSTOMER"], "permissions": ["customer.self.read", "customer.self.write"]}], "self",
               "MEDIUM", True, actions=("CREATE_RESERVATION_DRAFT",)),
    # ── warehouse staff ───────────────────────────────────────────────────
    Capability("warehouse.my_tasks", "Nhiệm vụ kho được giao cho tôi",
               [{"roles": ["WAREHOUSE_STAFF", "WAREHOUSE_MANAGER", "ADMIN"], "permissions": ["inventory.task.read"]}],
               "self", "LOW", True, endpoints=("/api/my-warehouse-tasks",),
               starters=("Hôm nay tôi có nhiệm vụ kho nào?",)),
    Capability("warehouse.picking", "Lấy hàng (picking) được giao",
               [{"roles": ["WAREHOUSE_STAFF"], "permissions": ["inventory.task.read"]}], "warehouse_scope", "LOW",
               True, endpoints=("/api/picking/tasks",), starters=("Tôi có đơn picking nào cần làm?",)),
    Capability("warehouse.putaway", "Cất hàng (putaway) / nhận hàng",
               [{"roles": ["WAREHOUSE_STAFF"], "permissions": ["inventory.task.progress"]}], "warehouse_scope",
               "LOW", True, endpoints=("/api/putaway/receipts",),
               starters=("Phiếu nhập nào đang chờ tôi cất hàng?",)),
    Capability("warehouse.exceptions", "Báo cáo ngoại lệ của tôi",
               [{"roles": ["WAREHOUSE_STAFF"], "permissions": ["inventory.exception.report"]}], "self", "LOW",
               True, endpoints=("/api/exception-reports/my",), starters=("Báo cáo ngoại lệ của tôi đang ở trạng thái nào?",)),
    Capability("warehouse.purchase_request", "Tạo bản nháp yêu cầu nhập (cần xác nhận)",
               [{"roles": [], "permissions": ["inventory.purchase.request"]}], "warehouse_scope", "MEDIUM",
               actions=("CREATE_REORDER_DRAFT",)),
    # ── library desk ──────────────────────────────────────────────────────
    Capability("library.circulation", "Mượn trả, đặt trước, tiền phạt tại quầy",
               [{"roles": ["LIBRARIAN", "ADMIN"], "permissions": _BORROW_READ}], "library", "MEDIUM", True,
               endpoints=("/borrow/loans", "/borrow/reservations", "/borrow/fines"),
               starters=("Có phiếu mượn nào quá hạn?", "Đặt trước nào đang chờ xử lý?",
                         "Khách nào có phạt chưa thanh toán?")),
    Capability("library.reserve_for_customer", "Đặt trước sách cho khách (cần xác nhận)",
               ACTION_CONFIG["CREATE_RESERVATION_DRAFT"]["policy"][1:], "library", "MEDIUM", True,
               actions=("CREATE_RESERVATION_DRAFT",)),
    # ── internal analytics through the chatbot (target enforces) ──────────
    Capability("analytics.chat", "Số liệu nghiệp vụ theo quyền của bạn",
               [{"roles": INTERNAL_ROLES, "permissions": []}], "warehouse_scope", "MEDIUM"),
    Capability("ops.overview", "Tổng quan vận hành và rủi ro tồn kho",
               [{"roles": ["WAREHOUSE_MANAGER", "ADMIN"], "permissions": ANALYTICS_PERMS}], "warehouse_scope",
               "MEDIUM", endpoints=("/analytics/dashboard/kpis", "/analytics/warehouse-stock-risk"),
               starters=("Tổng quan vận hành hôm nay.", "Sách nào tồn kho thấp?")),
    Capability("ops.decide", "Cảnh báo tồn kho, giao việc cho nhân viên (cần xác nhận)",
               ACTION_CONFIG["CREATE_STOCK_ALERT"]["policy"], "warehouse_scope", "MEDIUM",
               actions=("CREATE_STOCK_ALERT", "CREATE_STAFF_TASK_DRAFT")),
    Capability("report.draft", "Bản nháp báo cáo (cần xác nhận)", ACTION_CONFIG["CREATE_REPORT_DRAFT"]["policy"],
               "warehouse_scope", actions=("CREATE_REPORT_DRAFT",)),
    # ── Decision Assistant (same gate as routes_conversations.can_use_assistant) ─
    Capability("decision.assistant", "Trợ lý ra quyết định: phân tích, so sánh, mô phỏng ngân sách",
               [{"roles": ["ADMIN", "WAREHOUSE_MANAGER"], "permissions": ANALYTICS_PERMS}], "warehouse_scope",
               "MEDIUM", tools=("*",),
               starters=("Kho nào đang có rủi ro thiếu sách cao nhất?",
                         "Sách nào được mượn nhiều nhưng tồn kho thấp?",
                         "Với ngân sách 20 triệu nên nhập những sách nào?",
                         "Hôm nay nên ưu tiên xử lý việc gì trước?")),
    Capability("admin.action_audit", "Theo dõi và đối chiếu hành động AI", [{"roles": ["ADMIN"], "permissions": []}],
               "system", "MEDIUM", starters=("Có hành động AI nào cần đối chiếu không?",)),
    # ── supplier (own orders only; target filters by the account's supplier) ─
    Capability("supplier.orders", "Đơn đặt hàng, hóa đơn giao hàng, báo thiếu của nhà cung cấp mình",
               [{"roles": ["SUPPLIER"], "permissions": ["supplier.portal.read", "supplier.portal.write"]}],
               "supplier_self", "MEDIUM", True, endpoints=("/api/supplier-account/orders",),
               starters=("Đơn đặt hàng nào của tôi đang chờ xác nhận?", "Đơn hàng của tôi đã giao đủ chưa?",
                         "Quy trình nộp hóa đơn giao hàng thế nào?")),
)
BY_ID = {c.id: c for c in CAPABILITIES}
for _c in CAPABILITIES:  # a typo in an action name must fail at import, not at runtime
    assert all(a in ACTION_CONFIG for a in _c.actions), _c.id


def roles_of(user_ctx) -> list[str]:
    # Legacy role codes are NOT mapped here: the action policy and the
    # assistant gate do not map them either, and the registry must never be
    # wider than the backend gates (auth-service returns canonical roles).
    return list(dict.fromkeys(normalize_role(r) for r in (getattr(user_ctx, "roles", None) or [])))


def allowed(user_ctx) -> list[Capability]:
    """Every capability the user holds now (anonymous: the public ones)."""
    if user_ctx is None:
        return [c for c in CAPABILITIES if c.public]
    roles, perms = roles_of(user_ctx), list(getattr(user_ctx, "permissions", None) or [])
    superuser = bool(getattr(user_ctx, "is_superuser", False))
    return [c for c in CAPABILITIES if policy_allows(c.policy, roles, perms, superuser)]


def allows(user_ctx, capability_id: str) -> bool:
    return any(c.id == capability_id for c in allowed(user_ctx))


def personal_endpoints(user_ctx) -> list[str]:
    """Personal-context reads the chatbot may make for this user - the union
    over ALL held capabilities (a CUSTOMER + LIBRARIAN gets both sets)."""
    out: list[str] = []
    for c in allowed(user_ctx):
        out += [e for e in c.endpoints if e not in out]
    return out


def tool_allowed(user_ctx, tool_name: str) -> bool:
    """A Decision Assistant READ tool is callable only through a capability that unlocks it."""
    return any("*" in c.tools or tool_name in c.tools for c in allowed(user_ctx))


def primary_role(user_ctx) -> str | None:
    """For persona/greeting only - never an authorization input."""
    roles = roles_of(user_ctx)
    return next((r for r in ROLE_ORDER if r in roles), roles[0] if roles else None)


def experience(user_ctx) -> str:
    if user_ctx is None:
        return "anonymous"
    if allows(user_ctx, "decision.assistant"):
        return "decision_assistant"
    role = primary_role(user_ctx)
    return {"LIBRARIAN": "library_operations", "WAREHOUSE_STAFF": "warehouse_work", "SUPPLIER": "supplier",
            "CUSTOMER": "reader"}.get(role or "", "reader" if allows(user_ctx, "reader.loans") else "general")


def starter_questions(user_ctx, limit: int = 4) -> list[str]:
    """Suggestions built only from capabilities the user holds, so a question
    they cannot get answered is never offered. The experience's own
    capabilities come first."""
    held = allowed(user_ctx)
    lead = {"decision_assistant": ("decision.assistant",), "supplier": ("supplier.orders",),
            "library_operations": ("library.circulation",),
            "warehouse_work": ("warehouse.my_tasks", "warehouse.picking", "warehouse.putaway", "warehouse.exceptions"),
            "reader": ("reader.loans", "reader.fines", "reader.reservations")}.get(experience(user_ctx), ())
    ordered = sorted(held, key=lambda c: (c.id not in lead, lead.index(c.id) if c.id in lead else 0))
    out: list[str] = []
    for c in ordered:
        for q in c.starters:
            if q not in out:
                out.append(q)
    return out[:limit]


def describe(user_ctx) -> dict:
    """The public description of the user's AI experience (GET /capabilities)."""
    held = allowed(user_ctx)
    roles = roles_of(user_ctx) if user_ctx is not None else []
    primary = primary_role(user_ctx) if user_ctx is not None else None
    return {
        "experience": experience(user_ctx),
        "persona": {"primary_role": primary, "roles": roles, "label": ROLE_LABELS.get(primary or "", "Khách")},
        "capabilities": [{
            "id": c.id, "label": c.label, "data_scope": c.data_scope, "sensitivity": c.sensitivity,
            "personal": c.personal, "actions": list(c.actions),
            "requires_confirmation": any(ACTION_CONFIG[a]["requires_confirmation"] for a in c.actions),
        } for c in held],
        "starter_questions": starter_questions(user_ctx),
    }
