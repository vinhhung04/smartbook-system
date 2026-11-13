"""Hình 4.22 — ERD auth_db, redrawn in two figures (ER type allows ≤ 8 entities)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dd import C, SANS, MONO, t, r4, tw, html
from xml.sax.saxutils import escape

OUT = pathlib.Path(sys.argv[1])
ROW = 18


class ER:
    def __init__(self, slug, W=800):
        self.slug, self.W = slug, W
        self.lines, self.labels, self.nodes, self.extra = [], [], [], []
        self.box = {}

    def entity(self, key, x, y, w, rows, more=0, focal=False):
        """rows: (prefix, name, type). prefix '#'=PK, '→'=FK, '⇢'=logical ref, ''=plain, 'UK'=constraint line."""
        n = len(rows) + (1 if more else 0)
        h = r4(40 + n * ROW + 10)
        fill, stroke, sw = ("#ffffff", C["ink"], 1) if not focal else (C["accent_tint"], C["accent"], 1.2)
        out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{C["paper"]}"/>',
               f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>',
               f'<path d="M {x} {y + 34} H {x + w}" stroke="rgba(31,56,100,0.22)" stroke-width="1"/>',
               t(x + 12, y + 23, key, 14, False, C["ink"], anchor="start", weight="700")]
        yy = y + 34 + 17
        for pre, name, typ in rows:
            if pre == "UK":
                out.append(t(x + 12, yy, name, 12, True, C["soft"], anchor="start"))
            else:
                label = (pre + " " if pre else "  ") + name
                color = C["ink"] if pre in ("#", "→") else (C["link"] if pre == "⇢" else C["ink"])
                out.append(t(x + 12, yy, label, 12, True, color, anchor="start", weight="700" if pre == "#" else None))
                out.append(t(x + w - 10, yy, typ, 12, True, C["soft"], anchor="end"))
            yy += ROW
        if more:
            out.append(t(x + 12, yy, f"+ {more} cột khác", 12, False, C["soft"], anchor="start", extra=' font-style="italic"'))
        self.nodes.append("\n".join(out))
        self.box[key] = (x, y, w, h)
        for pre, name, typ in rows:  # width check
            need = 12 + tw(("xx" + name), 12, True) + 16 + tw(typ, 12, True) + 10
            if pre != "UK" and need > w:
                print("WARN row too wide", key, name, round(need))
            if pre == "UK" and 12 + tw(name, 12, True) + 10 > w:
                print("WARN UK too wide", key, name)
        return h

    def card(self, x, y, text, anchor="middle"):
        w = r4(tw(text, 12, True) + 8)
        x0 = x - w / 2 if anchor == "middle" else (x if anchor == "start" else x - w)
        self.labels.append(f'<rect x="{x0:g}" y="{y - 13}" width="{w}" height="17" rx="2" fill="{C["paper"]}"/>\n' +
                           t(x0 + w / 2, y, text, 12, True, C["muted"], weight="700"))

    def rel(self, cx, top, text):
        """relationship label plate whose top edge is at `top`, centered on cx; text may have \\n."""
        lines = text.split("\n")
        w = r4(max(tw(s, 12) for s in lines) + 12)
        h = 18 + 16 * (len(lines) - 1)
        out = [f'<rect x="{cx - w / 2:g}" y="{top}" width="{w}" height="{h}" rx="2" fill="{C["paper"]}"/>']
        for i, s in enumerate(lines):
            out.append(t(cx, top + 13 + 16 * i, s, 12, False, C["muted"], extra=' font-style="italic"'))
        self.labels.append("\n".join(out))

    def line(self, d):
        self.lines.append(f'<path d="{d}" fill="none" stroke="{C["muted"]}" stroke-width="1.2"/>')

    def svg(self, H, title, desc, notes, legend_y):
        s = self.slug
        foot = []
        for i, n in enumerate(notes):
            foot.append(t(44, legend_y - 56 + i * 18 - (len(notes) - 1) * 18, n, 12, False, C["muted"], anchor="start", extra=' font-style="italic"'))
        leg = [f'<line x1="40" y1="{legend_y - 20}" x2="760" y2="{legend_y - 20}" stroke="{C["rule"]}" stroke-width="1"/>']
        cur = 44
        for sym, txt in (("#", "khóa chính"), ("→", "khóa ngoại"), ("UK", "duy nhất"), ("⇢", "tham chiếu logic, không có FK"), ("0..*", "bội số")):
            leg.append(t(cur, legend_y + 4, sym, 12, True, C["link"] if sym == "⇢" else C["ink"], anchor="start", weight="700"))
            cur += tw(sym, 12, True) + 6
            leg.append(t(cur, legend_y + 4, txt, 12, False, C["muted"], anchor="start"))
            cur += r4(tw(txt, 12)) + 18
        body = "\n".join(["<!-- relationships -->", *self.lines, "<!-- labels -->", *self.labels, "<!-- entities -->", *self.nodes, "<!-- notes -->", *foot, "<!-- legend -->", *leg])
        return (f'<svg viewBox="0 0 {self.W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{s}-title {s}-desc">\n'
                f'<title id="{s}-title">{escape(title)}</title>\n<desc id="{s}-desc">{escape(desc)}</desc>\n'
                f'<rect width="100%" height="100%" fill="{C["paper"]}"/>\n{body}\n</svg>')


SRC = '<p class="note">Nguồn: <code>docs/diagrams/source/erd/auth-service-iam.mmd</code>, đối chiếu <code>services/auth-service/prisma/schema.prisma</code>.</p>'

# ================================================================ (a) tài khoản, vai trò, quyền, phạm vi kho
e = ER("auth-service-iam-dd-p1")
e.entity("users", 40, 40, 240, [
    ("#", "id", "uuid"), ("", "username", "varchar UK"), ("", "email", "varchar UK"), ("", "password_hash", "text"),
    ("", "full_name", "varchar"), ("", "status", "varchar"), ("⇢", "primary_warehouse_id", "uuid"),
    ("", "is_superuser", "boolean"), ("", "failed_login_attempts", "int"), ("", "email_verified_at", "timestamptz"),
    ("", "email_otp_2fa_enabled", "boolean"), ("", "deleted_at", "timestamptz")], more=5, focal=True)
e.entity("user_warehouse_scopes", 40, 392, 240, [
    ("#", "id", "uuid"), ("→", "user_id", "uuid"), ("⇢", "warehouse_id", "uuid"), ("", "access_level", "varchar"),
    ("UK", "UK (user_id, warehouse_id)", "")], more=2)
X2 = 480
e.entity("user_roles", X2, 40, 240, [
    ("#", "id", "uuid"), ("→", "user_id", "uuid"), ("→", "role_id", "uuid"),
    ("", "assigned_by_user_id", "uuid"), ("", "expires_at", "timestamptz"), ("UK", "UK (user_id, role_id)", "")], more=1)
e.entity("roles", X2, 284, 240, [("#", "id", "uuid"), ("", "code", "varchar UK"), ("", "name", "varchar"), ("", "is_system", "boolean")], more=3)
e.entity("role_permissions", X2, 492, 240, [
    ("#", "id", "uuid"), ("→", "role_id", "uuid"), ("→", "permission_id", "uuid"), ("UK", "UK (role_id, permission_id)", "")], more=1)
e.entity("permissions", X2, 700, 240, [("#", "id", "uuid"), ("", "code", "varchar UK"), ("", "module_name", "varchar"), ("", "action_name", "varchar")], more=2)
CX = X2 + 120
# users 1 —— 0..* user_roles "được gán"
e.line(f"M 280 100 H {X2}"); e.card(290, 120, "1", "start"); e.card(X2 - 6, 120, "0..*", "end"); e.rel(380, 68, "được gán")
# users 1 —— 0..* user_warehouse_scopes "phụ trách kho"
e.line("M 160 324 V 392"); e.card(172, 342, "1", "start"); e.card(172, 386, "0..*", "start"); e.rel(108, 342, "phụ trách\nkho")
# roles 1 —— 0..* user_roles "gồm"   (user_roles above roles)
e.line(f"M {CX} 216 V 284"); e.card(CX + 12, 234, "0..*", "start"); e.card(CX + 12, 278, "1", "start"); e.rel(CX - 34, 241, "gồm")
# roles 1 —— 0..* role_permissions "có"
e.line(f"M {CX} 424 V 492"); e.card(CX + 12, 442, "1", "start"); e.card(CX + 12, 486, "0..*", "start"); e.rel(CX - 30, 449, "có")
# permissions 1 —— 0..* role_permissions "thuộc"
e.line(f"M {CX} 632 V 700"); e.card(CX + 12, 650, "0..*", "start"); e.card(CX + 12, 694, "1", "start"); e.rel(CX - 40, 657, "thuộc")
H = 1000
svg = e.svg(H, "ERD auth_db: tài khoản, vai trò, quyền và phạm vi kho",
            "Bảng users liên kết vai trò qua user_roles, vai trò liên kết quyền qua role_permissions, và phạm vi kho qua user_warehouse_scopes; mọi quan hệ là một – nhiều.",
            ["status: ACTIVE, LOCKED, PENDING_VERIFICATION…",
             "primary_warehouse_id, warehouse_id: tham chiếu logic sang inventory-service",
             "(khác cơ sở dữ liệu, không có ràng buộc khóa ngoại).",
             "Không vẽ: auth_audit_logs, integration_outbox, integration_inbox (không có khóa ngoại)."],
            H - 28)
(OUT / "auth-service-iam-dd-p1.html").write_text(html(e.slug, "ER · Diagram Design · SmartBook", "ERD auth_db (1/2): tài khoản, vai trò, quyền và phạm vi kho", svg, 800, SRC), encoding="utf-8")

# ================================================================ (b) token và OTP
e = ER("auth-service-iam-dd-p2")
e.entity("users", 40, 296, 200, [("#", "id", "uuid"), ("", "email", "varchar UK"), ("", "status", "varchar")], more=14, focal=True)
y = 40
specs = [
    ("refresh_tokens", [("#", "id", "uuid"), ("→", "user_id", "uuid"), ("", "token_hash", "varchar UK"), ("", "expires_at", "timestamptz"), ("", "revoked_at", "timestamptz")], 3, "sở hữu"),
    ("password_reset_tokens", [("#", "id", "uuid"), ("→", "user_id", "uuid"), ("", "token_hash", "varchar UK"), ("", "expires_at", "timestamptz"), ("", "used_at", "timestamptz")], 1, "yêu cầu"),
    ("email_otp_challenges", [("#", "id", "uuid"), ("→", "user_id", "uuid"), ("", "purpose", "varchar"), ("", "code_hash", "varchar"), ("", "attempts", "int"), ("", "send_count", "int"), ("", "expires_at", "timestamptz"), ("", "consumed_at", "timestamptz"), ("", "invalidated_at", "timestamptz")], 3, "nhận mã"),
    ("email_verification_tokens", [("#", "id", "uuid"), ("→", "user_id", "uuid"), ("", "token_hash", "varchar UK"), ("", "expires_at", "timestamptz"), ("", "used_at", "timestamptz")], 1, "legacy"),
]
attach = [312, 336, 360, 384]           # distinct attach points on users' right edge (x = 240), 24 px apart
for (name, rows, more, lab), ay in zip(specs, attach):
    hh = e.entity(name, 456, y, 304, rows, more=more)
    ty = y + 52                           # target y on the table's left edge
    tx = 456
    vx = [336, 352, 384, 368][attach.index(ay)]  # up-routes inner→outer, down-routes outer→inner: no crossings
    if ty < ay:
        e.line(f"M 240 {ay} H {vx - 8} Q {vx} {ay} {vx} {ay - 8} V {ty + 8} Q {vx} {ty} {vx + 8} {ty} H {tx}")
    else:
        e.line(f"M 240 {ay} H {vx - 8} Q {vx} {ay} {vx} {ay + 8} V {ty - 8} Q {vx} {ty} {vx + 8} {ty} H {tx}")
    e.card(252, ay - 4, "1", "start") if ay == attach[0] else None
    e.card(tx - 6, ty + 18, "0..*", "end")
    e.rel(422, ty - 26, lab)
    y += hh + 24
H = r4(y + 120)
svg = e.svg(H, "ERD auth_db: token và mã OTP",
            "Mỗi user sở hữu nhiều refresh token, token đặt lại mật khẩu, thử thách OTP qua email và token xác minh email kiểu cũ; mọi quan hệ là một – nhiều.",
            ["purpose: EMAIL_VERIFICATION, LOGIN_2FA · code_hash: HMAC-SHA256",
             "email_verification_tokens: luồng xác minh cũ (legacy).",
             "Mỗi quan hệ: một users – 0..* bản ghi. Các cột của users: xem Hình (1/2)."],
            H - 28)
(OUT / "auth-service-iam-dd-p2.html").write_text(html(e.slug, "ER · Diagram Design · SmartBook", "ERD auth_db (2/2): token và mã OTP", svg, 800, SRC), encoding="utf-8")
print("ok", H)
