"""ERD figures 4.24–4.36 (demo6 numbering), generated from the real schemas.

Tables per figure are the ones shown in the thesis' original figures. Columns and foreign keys come from
services/*/prisma/schema.prisma and services/ai-service/schema.sql; ELK computes positions and orthogonal
routes, everything is drawn with the SmartBook tokens (same table box, # / → / UK markers and 1 / 0..*
cardinality as the auth_db ERD).
usage: python fig_erd_legacy.py <out_dir> [figure-key ...]
"""
import sys, re, json, math, pathlib, subprocess
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dd import C, t, r4, tw, html
from xml.sax.saxutils import escape

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent.parent
ROW = 18
KEY_NAMES = {"code", "name", "title", "status", "full_name", "username", "email", "quantity"}
MAX_ROWS = 8
PRISMA_TYPES = {"Int": "int", "BigInt": "bigint", "Boolean": "boolean", "DateTime": "timestamptz", "Json": "jsonb",
                "Decimal": "decimal", "Float": "float", "String": "text", "Bytes": "bytea"}
DB_TYPES = {"Uuid": "uuid", "VarChar": "varchar", "Text": "text", "Timestamptz": "timestamptz", "Timestamp": "timestamp",
            "Decimal": "decimal", "Date": "date", "SmallInt": "smallint", "Integer": "int", "Char": "char", "JsonB": "jsonb"}


# ------------------------------------------------------------------ schema readers
def read_prisma(path):
    s = pathlib.Path(path).read_text(encoding="utf-8")
    models = {}
    for m in re.finditer(r"^model (\w+) \{(.*?)^\}", s, re.S | re.M):
        name, body = m.group(1), m.group(2)
        mp = re.search(r'@@map\("([^"]+)"\)', body)
        models[name] = {"table": mp.group(1) if mp else name, "body": body}
    tables = {}
    for name, mdl in models.items():
        cols, fks, uks = [], [], []
        for line in mdl["body"].splitlines():
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            if line.startswith("@@unique"):
                uks.append(re.findall(r"\w+", line.split("[", 1)[1].split("]", 1)[0]))
                continue
            if line.startswith("@@"):
                continue
            tok = line.split()
            if len(tok) < 2:
                continue
            fname, ftype = tok[0], tok[1]
            base = ftype.rstrip("?").replace("[]", "")
            if base in models:
                rel = re.search(r"fields:\s*\[([^\]]+)\].*?references:\s*\[([^\]]+)\]", line)
                if rel:
                    for a, b in zip(re.findall(r"\w+", rel.group(1)), re.findall(r"\w+", rel.group(2))):
                        fks.append((a, models[base]["table"], b))
                continue
            dbt = re.search(r"@db\.(\w+)", line)
            typ = DB_TYPES.get(dbt.group(1), dbt.group(1).lower()) if dbt else PRISMA_TYPES.get(base, base.lower())
            cols.append({"name": fname, "type": typ, "pk": "@id" in line, "uk": "@unique" in line, "null": ftype.endswith("?")})
        tables[mdl["table"]] = {"cols": cols, "fks": fks, "uks": uks}
    return tables


def read_sql(path):
    s = pathlib.Path(path).read_text(encoding="utf-8")
    tables = {}
    for m in re.finditer(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\);", s, re.S):
        name, body = m.group(1), m.group(2)
        cols, fks, uks = [], [], []
        for line in body.splitlines():
            line = line.strip().rstrip(",")
            if not line or line.startswith("--"):
                continue
            if line.upper().startswith("UNIQUE"):
                uks.append(re.findall(r"\w+", line.split("(", 1)[1].split(")", 1)[0])); continue
            if line.upper().startswith(("PRIMARY", "CONSTRAINT", "CHECK", "FOREIGN")):
                continue
            tok = line.split()
            typ = tok[1].split("(")[0].lower()
            typ = {"timestamptz": "timestamptz", "varchar": "varchar", "vector": "vector"}.get(typ, typ)
            up = line.upper()
            cols.append({"name": tok[0], "type": typ, "pk": "PRIMARY KEY" in up, "uk": " UNIQUE" in up, "null": "NOT NULL" not in up and "PRIMARY KEY" not in up})
            ref = re.search(r"REFERENCES (\w+) \((\w+)\)", line)
            if ref:
                fks.append((tok[0], ref.group(1), ref.group(2)))
        tables[name] = {"cols": cols, "fks": fks, "uks": uks}
    return tables


SCHEMAS = {
    "auth": read_prisma(ROOT / "services/auth-service/prisma/schema.prisma"),
    "inventory": read_prisma(ROOT / "services/inventory-service/prisma/schema.prisma"),
    "borrow": read_prisma(ROOT / "services/borrow-service/prisma/schema.prisma"),
    "ai": read_sql(ROOT / "services/ai-service/schema.sql"),
}


# ------------------------------------------------------------------ figure content
def rows_for(tb):
    fkcols = {a for a, _, _ in tb["fks"]}
    rows = []
    for c in tb["cols"]:
        if c["pk"]:
            rows.append(("#", c["name"], c["type"]))
    for c in tb["cols"]:
        if c["name"] in fkcols and not c["pk"]:
            rows.append(("→", c["name"], c["type"]))
    for c in tb["cols"]:
        if c["uk"] and not c["pk"] and c["name"] not in fkcols:
            rows.append(("", c["name"], c["type"] + " UK"))
    for c in tb["cols"]:
        if (c["name"] in KEY_NAMES or c["name"].endswith(("_number", "_type"))) and not (c["pk"] or c["uk"] or c["name"] in fkcols):
            rows.append(("", c["name"], c["type"]))
    rows = rows[:MAX_ROWS]
    uk_rows = []
    for u in tb["uks"]:
        line = "UK (" + ", ".join(u) + ")"
        if tw(line, 12, True) > 232 and len(u) > 1:
            half = (len(u) + 1) // 2
            uk_rows += [("UK", "UK (" + ", ".join(u[:half]) + ",", ""), ("UK", "    " + ", ".join(u[half:]) + ")", "")]
        else:
            uk_rows.append(("UK", line, ""))
    shown = len(rows)
    more = len(tb["cols"]) - shown
    return rows, uk_rows, more


def box_size(name, rows, uk_rows, more, ref):
    if ref:
        w = r4(max(tw(name, 14, bold=True) + 24, tw("# id", 12, True) + tw("uuid", 12, True) + 40, 120))
        return w, r4(34 + ROW + 14)
    widths = [tw(name, 14, bold=True) + 24]
    for pre, n, typ in rows:
        widths.append(12 + tw("xx" + n, 12, True) + 20 + tw(typ, 12, True) + 10)
    for _, n, _ in uk_rows:
        widths.append(12 + tw(n, 12, True) + 10)
    w = r4(max(min(max(widths), max(280, widths[0])), 160))
    n = len(rows) + len(uk_rows) + (1 if more > 0 else 0)
    return w, r4(34 + n * ROW + 14)


def elk(nodes, edges, direction, extra=None):
    g = {"id": "root", "layoutOptions": {
        "elk.algorithm": "layered", "elk.direction": direction, "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "32", "elk.spacing.edgeNode": "24", "elk.spacing.edgeEdge": "40",
        "elk.layered.spacing.nodeNodeBetweenLayers": "64", "elk.layered.spacing.edgeNodeBetweenLayers": "24",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "14", "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", "elk.padding": "[top=0,left=0,bottom=0,right=0]", **(extra or {})},
        "children": [{"id": n["id"], "width": n["w"], "height": n["h"]} for n in nodes],
        "edges": [{"id": e["id"], "sources": [e["src"]], "targets": [e["dst"]]} for e in edges]}
    res = subprocess.run(["node", str(HERE / "elk_layout.mjs")], input=json.dumps(g), capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(res.stdout)


def rounded(points, r=8):
    d = f"M {points[0][0]:.1f} {points[0][1]:.1f}"
    for i in range(1, len(points) - 1):
        (x0, y0), (x1, y1), (x2, y2) = points[i - 1], points[i], points[i + 1]
        l1 = math.hypot(x1 - x0, y1 - y0); l2 = math.hypot(x2 - x1, y2 - y1)
        rr = min(r, l1 / 2, l2 / 2)
        if rr < 1:
            d += f" L {x1:.1f} {y1:.1f}"; continue
        ax, ay = x1 - (x1 - x0) / l1 * rr, y1 - (y1 - y0) / l1 * rr
        bx, by = x1 + (x2 - x1) / l2 * rr, y1 + (y2 - y1) / l2 * rr
        d += f" L {ax:.1f} {ay:.1f} Q {x1:.1f} {y1:.1f} {bx:.1f} {by:.1f}"
    d += f" L {points[-1][0]:.1f} {points[-1][1]:.1f}"
    return d


def _hit(a, b, pad=0):
    return a[0] < b[0] + b[2] + pad and b[0] < a[0] + a[2] + pad and a[1] < b[1] + b[3] + pad and b[1] < a[1] + a[3] + pad


def place_card(x, y, dx, dy, text, boxes, segs, placed, prefer):
    """Cardinality text next to an endpoint; (dx, dy) = unit direction of the edge leaving the box.
    Tries both sides and increasing distance along the edge; first spot clear of boxes, lines and labels wins."""
    w = r4(tw(text, 12, True) + 8); h = 17
    cands = []
    for along in (14, 30, 46, 62, 78, 94, 110, 126):
        for lateral in (0, 22, 44):
            for side in (prefer, -prefer):
                if dx == 0:
                    cx, cy = x + side * (10 + lateral + w / 2), y + dy * along
                else:
                    cx, cy = x + dx * (along - 4 + w / 2), y + side * (15 + lateral)
                cands.append((cx - w / 2, cy - h / 2, w, h))
    best, best_cost = None, None
    for r in cands:
        if r[0] < 40 or r[0] + r[2] > 760:
            continue
        cost = 10 * sum(_hit(r, b, 2) for b in boxes) + 10 * sum(_hit(r, p_, 2) for p_ in placed) + sum(_hit(r, sg, 3) for sg in segs)
        if cost == 0:
            placed.append(r); return r, w
        if best_cost is None or cost < best_cost:
            best, best_cost = r, cost
    best = best or cands[0]
    placed.append(best); return best, w


def draw_card(r, text, out):
    out.append(f'<rect x="{r[0]:.1f}" y="{r[1]:.1f}" width="{r[2]}" height="{r[3]}" rx="2" fill="{C["paper"]}"/>')
    out.append(t(round(r[0] + r[2] / 2, 1), round(r[1] + 13, 1), text, 12, True, C["muted"], weight="700"))


def figure(key, slug, schema, tables, refs, title, desc, h1, src_note, direction="DOWN", focal=None):
    sch = SCHEMAS[schema]
    used = {tgt for n in tables for _, tgt, _ in sch[n]["fks"]}
    refs = [r for r in refs if r in used and r not in tables]
    nodes, edges = [], []
    content = {}
    for name in tables + refs:
        ref = name in refs
        tb = sch[name]
        rows, uk_rows, more = rows_for(tb)
        w, h = box_size(name, rows, uk_rows, more, ref)
        nodes.append({"id": name, "w": w, "h": h})
        content[name] = (rows, uk_rows, more, ref)
    present = set(tables + refs)
    for name in tables:
        tb = sch[name]
        for i, (col, target, _) in enumerate(tb["fks"]):
            if target in present:
                c = next(c for c in tb["cols"] if c["name"] == col)
                uniq = c["uk"] or any(u == [col] for u in tb["uks"])
                edges.append({"id": f"{name}.{col}", "src": name, "dst": target,
                              "child": "0..1" if uniq else "0..*", "parent": "0..1" if c["null"] else "1"})
    configs = [("DOWN", None), ("RIGHT", None)]
    for lb in ("3", "2"):
        for d in ("DOWN", "RIGHT"):
            configs.append((d, {"elk.layered.layering.strategy": "COFFMAN_GRAHAM", "elk.layered.layering.coffmanGraham.layerBound": lb}))
    for ar in ("1.4", "1.0", "0.75", "0.6"):
        configs += [("DOWN", {"elk.layered.wrapping.strategy": "MULTI_EDGE", "elk.aspectRatio": ar}),
                    ("RIGHT", {"elk.layered.wrapping.strategy": "MULTI_EDGE", "elk.aspectRatio": ar})]
    best = None
    for d, extra in configs:
        lay = elk(nodes, edges, d, extra)
        fits = lay["width"] <= 720 and lay["height"] <= 1080
        score = (0 if fits else 1, lay["height"] if fits else lay["width"] * lay["height"])
        if best is None or score < best[0]:
            best = (score, lay, d, extra)
    lay = best[1]
    print(f"   {slug}: chose {best[2]} {best[3] or ''} {lay['width']:.0f}x{lay['height']:.0f}")
    W_raw = lay["width"]; H_raw = lay["height"]
    W = 800
    ox = 40 + max(0, (720 - W_raw) / 2)
    oy = 40
    if W_raw > 720:
        print(f"WARN {slug}: layout width {W_raw:.0f} > 720")
    pos = {c["id"]: (c["x"] + ox, c["y"] + oy) for c in lay["children"]}
    A, L, N = [], [], []
    boxes = [(pos[n["id"]][0], pos[n["id"]][1], n["w"], n["h"]) for n in nodes]
    routes = []
    for e in lay["edges"]:
        meta = next(x for x in edges if x["id"] == e["id"])
        for sec in e["sections"]:
            pts = [(sec["startPoint"]["x"] + ox, sec["startPoint"]["y"] + oy)] +                   [(p["x"] + ox, p["y"] + oy) for p in sec.get("bendPoints", [])] +                   [(sec["endPoint"]["x"] + ox, sec["endPoint"]["y"] + oy)]
            routes.append((meta, pts))
    segs = []
    for _, pts in routes:
        for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
            segs.append((min(xa, xb) - 0.5, min(ya, yb) - 0.5, abs(xb - xa) + 1, abs(yb - ya) + 1))
    placed = []
    for meta, pts in routes:
        A.append(f'<path d="{rounded(pts)}" fill="none" stroke="{C["muted"]}" stroke-width="1.2"/>')
        (x0, y0), (x1, y1) = pts[0], pts[1]
        dx, dy = (0, 1 if y1 > y0 else -1) if abs(x1 - x0) < 0.5 else (1 if x1 > x0 else -1, 0)
        r, _ = place_card(x0, y0, dx, dy, meta["child"], boxes, segs, placed, +1); draw_card(r, meta["child"], L)
        (xa, ya), (xb, yb) = pts[-1], pts[-2]
        dx, dy = (0, 1 if yb > ya else -1) if abs(xb - xa) < 0.5 else (1 if xb > xa else -1, 0)
        r, _ = place_card(xa, ya, dx, dy, meta["parent"], boxes, segs, placed, -1); draw_card(r, meta["parent"], L)
    for name, (x, y) in pos.items():
        n = next(n for n in nodes if n["id"] == name)
        w, h = n["w"], n["h"]
        rows, uk_rows, more, ref = content[name]
        fill, stroke, sw, dash = ("#ffffff", C["ink"], 1, "")
        if ref:
            fill, stroke, dash = ("rgba(31,56,100,0.03)", C["muted"], ' stroke-dasharray="4,3"')
        if name == focal:
            fill, stroke, sw = (C["accent_tint"], C["accent"], 1.2)
        out = [f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" rx="6" fill="{C["paper"]}"/>',
               f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>',
               f'<path d="M {x:.1f} {y + 34:.1f} H {x + w:.1f}" stroke="rgba(31,56,100,0.22)" stroke-width="1"/>',
               t(round(x + 12, 1), round(y + 23, 1), name, 14, False, C["ink"], anchor="start", weight="700")]
        yy = y + 34 + 17
        body = [("#", "id", "uuid")] if ref else rows
        for pre, nm, typ in body:
            out.append(t(round(x + 12, 1), round(yy, 1), (pre + " " if pre else "  ") + nm, 12, True, C["ink"], anchor="start", weight="700" if pre == "#" else None))
            out.append(t(round(x + w - 10, 1), round(yy, 1), typ, 12, True, C["soft"], anchor="end"))
            yy += ROW
        if not ref:
            for _, nm, _ in uk_rows:
                out.append(t(round(x + 12, 1), round(yy, 1), nm, 12, True, C["soft"], anchor="start")); yy += ROW
            if more > 0:
                out.append(t(round(x + 12, 1), round(yy, 1), f"+ {more} cột khác", 12, False, C["soft"], anchor="start", extra=' font-style="italic"'))
        N.append("\n".join(out))
    H = r4(oy + H_raw + 40)
    leg_y = H + 28
    leg = [f'<line x1="40" y1="{leg_y - 20}" x2="760" y2="{leg_y - 20}" stroke="{C["rule"]}" stroke-width="1"/>']
    cur = 44
    items = [("#", "khóa chính"), ("→", "khóa ngoại"), ("UK", "duy nhất"), ("0..*", "bội số")]
    for sym, txt in items:
        leg.append(t(cur, leg_y + 4, sym, 12, True, C["ink"], anchor="start", weight="700")); cur += tw(sym, 12, True) + 6
        leg.append(t(cur, leg_y + 4, txt, 12, False, C["muted"], anchor="start")); cur += r4(tw(txt, 12)) + 18
    if refs:
        leg.append(f'<rect x="{cur}" y="{leg_y - 6}" width="20" height="12" rx="2" fill="rgba(31,56,100,0.03)" stroke="{C["muted"]}" stroke-width="1" stroke-dasharray="4,3"/>')
        leg.append(t(cur + 28, leg_y + 4, "bảng thuộc nhóm khác", 12, False, C["muted"], anchor="start"))
    Ht = leg_y + 28
    s = slug
    svg = (f'<svg viewBox="0 0 {W} {Ht}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{s}-title {s}-desc">\n'
           f'<title id="{s}-title">{escape(title)}</title>\n<desc id="{s}-desc">{escape(desc)}</desc>\n'
           f'<rect width="100%" height="100%" fill="{C["paper"]}"/>\n<!-- relationships -->\n' + "\n".join(A) +
           "\n<!-- cardinality -->\n" + "\n".join(L) + "\n<!-- tables -->\n" + "\n".join(N) + "\n<!-- legend -->\n" + "\n".join(leg) + "\n</svg>")
    out_dir = pathlib.Path(sys.argv[1]); out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{slug}.html").write_text(html(slug, "ER · Diagram Design · SmartBook", h1, svg, W, f'<p class="note">{src_note}</p>'), encoding="utf-8")
    print(f"wrote {slug} {W_raw:.0f}x{H_raw:.0f} -> H={Ht}")


INV = "Nguồn: <code>services/inventory-service/prisma/schema.prisma</code>; danh sách bảng theo hình gốc."
BOR = "Nguồn: <code>services/borrow-service/prisma/schema.prisma</code>; danh sách bảng theo hình gốc."
FIGS = {
    "4.24": dict(slug="auth-token-audit-dd", schema="auth",
                 tables=["refresh_tokens", "password_reset_tokens", "email_verification_tokens", "auth_audit_logs"], refs=["users"],
                 title="ERD auth_db: token và nhật ký", desc="Các bảng token thuộc về users; auth_audit_logs lưu nhật ký và không có khóa ngoại.",
                 h1="ERD auth_db – token và nhật ký", src="Nguồn: <code>services/auth-service/prisma/schema.prisma</code>."),
    "4.25": dict(slug="inventory-catalog-dd", schema="inventory",
                 tables=["books", "book_variants", "book_images", "book_authors", "authors", "author_aliases", "book_categories", "categories", "publishers", "publisher_aliases", "book_work_groups"], refs=[],
                 title="ERD inventory_db: danh mục sách", desc="Sách, ấn bản, ảnh, tác giả, thể loại, nhà xuất bản và nhóm tác phẩm cùng các bảng nối.",
                 h1="ERD inventory_db – danh mục sách", src=INV, focal="books"),
    "4.26": dict(slug="inventory-metadata-dd", schema="inventory",
                 tables=["metadata_reconciliation_drafts", "metadata_reconciliation_field_decisions", "duplicate_review_drafts"], refs=[],
                 title="ERD inventory_db: đối soát metadata và trùng lặp", desc="Bản nháp đối soát metadata, quyết định theo từng trường và bản nháp duyệt trùng lặp.",
                 h1="ERD inventory_db – đối soát metadata và trùng lặp", src=INV),
    "4.27": dict(slug="inventory-stock-dd", schema="inventory",
                 tables=["warehouses", "locations", "warehouse_settings", "inventory_units", "stock_balances", "stock_reservations", "stock_movements", "stock_alerts"], refs=["book_variants"],
                 title="ERD inventory_db: kho, vị trí và tồn kho", desc="Kho, vị trí lồng nhau, tồn theo vị trí, giữ tồn, biến động tồn, đơn vị tồn và cảnh báo.",
                 h1="ERD inventory_db – kho, vị trí và tồn kho", src=INV, focal="stock_balances"),
    "4.28": dict(slug="inventory-audit-task-dd", schema="inventory",
                 tables=["stock_audits", "stock_audit_lines", "staff_tasks", "warehouse_exception_reports"], refs=["warehouses", "locations", "book_variants", "goods_receipts"],
                 title="ERD inventory_db: kiểm kê, công việc và sự cố", desc="Phiếu kiểm kê và dòng kiểm kê, công việc nhân viên và báo cáo sự cố kho.",
                 h1="ERD inventory_db – kiểm kê, công việc và sự cố", src=INV),
    "4.29": dict(slug="inventory-purchasing-dd", schema="inventory",
                 tables=["purchase_requests", "purchase_orders", "purchase_order_items", "supplier_order_dispatches", "suppliers", "supplier_variants"], refs=["warehouses", "book_variants"],
                 title="ERD inventory_db: yêu cầu mua và đơn đặt hàng", desc="Yêu cầu mua, đơn đặt hàng và dòng đơn, lượt gửi đơn cho nhà cung cấp, nhà cung cấp và ấn bản họ cung cấp.",
                 h1="ERD inventory_db – yêu cầu mua và đơn đặt hàng", src=INV, focal="purchase_orders"),
    "4.30": dict(slug="inventory-receiving-dd", schema="inventory",
                 tables=["supplier_delivery_invoices", "supplier_delivery_invoice_items", "goods_receipts", "goods_receipt_items", "supplier_shortage_reports", "supplier_shortage_report_items", "smart_receiving_drafts", "smart_receiving_items"],
                 refs=["purchase_orders", "purchase_order_items", "suppliers", "warehouses", "locations", "book_variants"],
                 title="ERD inventory_db: hóa đơn, nhận hàng và thiếu hàng", desc="Hóa đơn giao hàng, phiếu nhập và dòng nhập, báo cáo thiếu hàng và bản nháp nhận hàng thông minh.",
                 h1="ERD inventory_db – hóa đơn, nhận hàng và thiếu hàng", src=INV, focal="goods_receipts"),
    "4.31": dict(slug="inventory-outbound-dd", schema="inventory",
                 tables=["outbound_orders", "outbound_order_items", "picking_tasks", "picking_task_items", "packing_tasks", "packing_task_items", "packing_scan_events", "packing_camera_evidence"],
                 refs=["warehouses", "locations", "book_variants"],
                 title="ERD inventory_db: xuất kho, lấy hàng và đóng gói", desc="Đơn xuất kho, công việc lấy hàng và đóng gói cùng sự kiện quét và bằng chứng hình ảnh.",
                 h1="ERD inventory_db – xuất kho, lấy hàng và đóng gói", src=INV, focal="outbound_orders"),
    "4.32": dict(slug="inventory-transfer-dd", schema="inventory",
                 tables=["transfer_orders", "transfer_order_items"], refs=["warehouses", "locations", "book_variants"],
                 title="ERD inventory_db: chuyển kho", desc="Lệnh chuyển kho giữa hai kho và các dòng chuyển theo vị trí.",
                 h1="ERD inventory_db – chuyển kho", src=INV),
    "4.33": dict(slug="borrow-circulation-dd", schema="borrow",
                 tables=["customers", "membership_plans", "customer_memberships", "loan_reservations", "loan_transactions", "loan_items", "loan_renewals"], refs=[],
                 title="ERD borrow_db: bạn đọc, hội viên và lưu thông", desc="Bạn đọc, gói và lượt hội viên, phiếu đặt giữ, phiếu mượn, cuốn mượn và gia hạn.",
                 h1="ERD borrow_db – bạn đọc, hội viên và lưu thông", src=BOR, focal="loan_transactions"),
    "4.34": dict(slug="borrow-fines-payments-dd", schema="borrow",
                 tables=["fines", "fine_payments", "fine_payment_intents", "customer_accounts", "account_ledger", "payment_methods", "auto_payment_settings"], refs=["customers", "loan_items"],
                 title="ERD borrow_db: phí phạt, thanh toán và ví", desc="Khoản phạt, lần thanh toán và giao dịch VNPay chờ xác nhận, tài khoản ví, sổ cái, phương thức thanh toán.",
                 h1="ERD borrow_db – phí phạt, thanh toán và ví", src=BOR, focal="fines"),
    "4.35": dict(slug="borrow-notifications-dd", schema="borrow",
                 tables=["customer_notifications", "customer_preferences", "book_reviews", "book_wishlists", "availability_alerts"], refs=["customers"],
                 title="ERD borrow_db: thông báo và tương tác", desc="Thông báo, tùy chọn, đánh giá, danh sách yêu thích và đăng ký báo có sách của bạn đọc.",
                 h1="ERD borrow_db – thông báo và tương tác", src=BOR),
    "4.36": dict(slug="ai-db-dd", schema="ai",
                 tables=["ai_conversations", "ai_messages", "ai_pending_actions", "ai_action_audit_logs", "ai_documents", "ai_document_chunks", "ai_cover_embeddings"], refs=[],
                 title="ERD ai_db", desc="Hội thoại và tin nhắn, hành động chờ xác nhận và nhật ký, tài liệu và đoạn nhúng cho RAG, nhúng ảnh bìa.",
                 h1="ERD ai_db", src="Nguồn: <code>services/ai-service/schema.sql</code>."),
}

def _part(base, n, tot, **kw):
    d = dict(FIGS[base]); d.update(kw)
    d["slug"] = FIGS[base]["slug"] + f"-p{n}"
    d["h1"] = FIGS[base]["h1"] + f" ({n}/{tot})"
    d["title"] = FIGS[base]["title"] + f", phần {n}"
    return d


_SPLITS = {
    "4.25": [dict(tables=["books", "book_variants", "book_images", "book_work_groups", "publishers", "publisher_aliases"], refs=[], focal="books",
                  desc="Sách, ấn bản, ảnh bìa, nhóm tác phẩm, nhà xuất bản và bí danh nhà xuất bản."),
             dict(tables=["book_authors", "authors", "author_aliases", "book_categories", "categories"], refs=["books"], focal=None,
                  desc="Tác giả và bí danh, thể loại phân cấp, các bảng nối sách – tác giả và sách – thể loại.")],
    "4.27": [dict(tables=["warehouses", "locations", "warehouse_settings", "stock_balances", "stock_alerts"], refs=["book_variants"], focal="stock_balances",
                  desc="Kho, vị trí lồng nhau, cấu hình kho, tồn theo vị trí và cảnh báo tồn."),
             dict(tables=["inventory_units", "stock_reservations", "stock_movements"], refs=["warehouses", "locations", "book_variants"], focal="stock_movements",
                  desc="Đơn vị tồn theo bản, giữ tồn và biến động tồn giữa các vị trí.")],
    "4.29": [dict(tables=["purchase_requests", "purchase_orders", "purchase_order_items", "supplier_order_dispatches"], refs=["warehouses", "book_variants", "suppliers"], focal="purchase_orders",
                  desc="Yêu cầu mua, đơn đặt hàng, dòng đơn và lượt gửi đơn cho nhà cung cấp."),
             dict(tables=["suppliers", "supplier_variants"], refs=["book_variants"], focal=None,
                  desc="Nhà cung cấp và các ấn bản họ cung cấp.")],
    "4.30": [dict(tables=["supplier_delivery_invoices", "supplier_delivery_invoice_items", "goods_receipts", "goods_receipt_items"],
                  refs=["purchase_orders", "purchase_order_items", "suppliers", "warehouses", "locations", "book_variants"], focal="goods_receipts",
                  desc="Hóa đơn giao hàng và dòng hóa đơn, phiếu nhập và dòng nhập."),
             dict(tables=["supplier_shortage_reports", "supplier_shortage_report_items"],
                  refs=["goods_receipts", "goods_receipt_items", "purchase_orders", "purchase_order_items", "suppliers", "warehouses", "book_variants"], focal=None,
                  desc="Báo cáo thiếu hàng và dòng thiếu hàng."),
             dict(tables=["smart_receiving_drafts", "smart_receiving_items"],
                  refs=["goods_receipts", "goods_receipt_items", "purchase_orders", "purchase_order_items", "suppliers", "warehouses", "book_variants"], focal=None,
                  desc="Bản nháp nhận hàng thông minh và dòng nhận.")],
    "4.31": [dict(tables=["outbound_orders", "outbound_order_items", "picking_tasks", "picking_task_items"], refs=["warehouses", "locations", "book_variants"], focal="outbound_orders",
                  desc="Đơn xuất kho, dòng xuất, công việc lấy hàng và dòng lấy hàng."),
             dict(tables=["packing_tasks", "packing_task_items", "packing_scan_events", "packing_camera_evidence"], refs=["outbound_orders", "outbound_order_items", "warehouses", "book_variants"], focal="packing_tasks",
                  desc="Công việc đóng gói, dòng đóng gói, sự kiện quét và bằng chứng hình ảnh.")],
}
for _k, _parts in _SPLITS.items():
    for _i, _kw in enumerate(_parts, 1):
        FIGS[f"{_k}-p{_i}"] = _part(_k, _i, len(_parts), **_kw)
    del FIGS[_k]


if __name__ == "__main__":
    keys = sys.argv[2:] or list(FIGS)
    for k in keys:
        f = FIGS[k]
        missing = [x for x in f["tables"] + f["refs"] if x not in SCHEMAS[f["schema"]]]
        if missing:
            print("MISSING tables", k, missing); continue
        figure(k, f["slug"], f["schema"], f["tables"], f["refs"], f["title"], f["desc"], f["h1"], f["src"], focal=f.get("focal"))
