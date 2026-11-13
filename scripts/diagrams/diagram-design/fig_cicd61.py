"""Hình 6.1 — CI/CD (faithful redraw of docs/diagrams/source/architecture/deploy-ci-cd-pipeline.mmd)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from arch import Fig
from dd import C, t

OUT = pathlib.Path(sys.argv[1])
V, M = False, True
f = Fig("deploy-ci-cd-pipeline-dd")


def chain(x, y0, w, items, gap=20):
    """Vertical chain of boxes joined by arrows; returns list of (top, bottom)."""
    spans, y = [], y0
    for name, subs, h, kind in items:
        f.box(x, y, w, h, name, subs, kind)
        spans.append((y, y + h))
        y += h + gap
    cx = x + w // 2
    for (a0, a1), (b0, b1) in zip(spans, spans[1:]):
        f.arrow(f"M {cx} {a1} V {b0 - 1}")
    return spans


# ---- 1. ci.yml
f.zone(40, 40, 320, 452, "1. ci.yml – mọi nhánh, pull request")
chain(56, 80, 288, [
    ("Push mã / mở pull request", [], 44, "input"),
    ("Kiểm tra toàn workspace", [("lint, typecheck, build, unit test", V)], 60, "backend"),
    ("Prisma schema 3 service", [], 44, "backend"),
    ("Kiểm tra cấu hình", [("Docker Compose", V)], 60, "backend"),
    ("Kiểm thử tích hợp trên Docker", [], 44, "backend"),
    ("Kiểm thử E2E Playwright", [], 44, "backend"),
])
# ci → cd
f.arrow("M 200 492 V 547")
f.label(212, 510, [("hợp nhất vào production", V)])

# ---- 2. deploy-production.yml
f.zone(40, 548, 320, 424, "2. deploy-production.yml –")
f.Z.append(t(56, 588, "nhánh production", 14, False, C["muted"], anchor="start", weight="700"))
chain(56, 608, 288, [
    ("Job test (cổng chặn): lint, typecheck,", [("build, test Node/Web/AI,", V), ("kiểm tra compose.prod.yml", V)], 76, "backend"),
    ("Job build: ma trận 7 image", [("web, api-gateway, auth, inventory,", V), ("borrow, analytics, ai", V)], 76, "backend"),
    ("Đẩy lên GHCR", [("tag = commit SHA và production", V)], 60, "backend"),
    ("Job deploy (môi trường production)", [("SSH với host key được ghim", V)], 60, "backend"),
])
# cd → vps
f.arrow("M 360 620 H 399")

# ---- 3. VPS – deploy/scripts/deploy.sh
f.zone(400, 40, 360, 700, "3. VPS – deploy/scripts/deploy.sh")
sp = chain(416, 80, 328, [
    ("pg_dump trước khi deploy", [("(giữ 5 bản predeploy)", V)], 60, "backend"),
    ("docker compose pull", [("IMAGE_TAG = SHA", M)], 60, "backend"),
    ("up -d --wait", [("prisma migrate deploy", M)], 60, "backend"),
])
# decision diamond (focal)
cx, dy, dw, dh = 580, sp[-1][1] + 20, 208, 88
f.arrow(f"M {cx} {sp[-1][1]} V {dy - 1}")
pts = f"{cx},{dy} {cx + dw // 2},{dy + dh // 2} {cx},{dy + dh} {cx - dw // 2},{dy + dh // 2}"
f.N.append(f'<polygon points="{pts}" fill="{C["paper"]}"/>\n<polygon points="{pts}" fill="{C["accent_tint"]}" stroke="{C["accent"]}" stroke-width="1.2"/>\n'
           + t(cx, dy + dh // 2 - 4, "Healthcheck và", 14, False, C["ink"], weight="700") + "\n"
           + t(cx, dy + dh // 2 + 14, "smoke test đạt?", 14, False, C["ink"], weight="700"))
f.used.add("focal")
ok_y = dy + dh + 36
f.arrow(f"M {cx} {dy + dh} V {ok_y - 1}")
f.label(cx - 12, dy + dh + 9, [("Có", V)], anchor="end")
f.box(416, ok_y, 328, 76, "Ghi state/releases.log,", [("giữ image 3 release gần nhất,", V), ("kiểm tra từ Internet", V)])
rb_y = ok_y + 76 + 24
# "Không": right vertex → right gutter of the zone → down → rollback box's right edge
f.arrow(f"M {cx + dw // 2} {dy + dh // 2} H 744 Q 752 {dy + dh // 2} 752 {dy + dh // 2 + 8} V {rb_y + 22} Q 752 {rb_y + 30} 744 {rb_y + 30} H 745")
f.label(712, dy + dh // 2 - 26, [("Không", V)], anchor="middle")
f.box(416, rb_y, 328, 60, "Tự rollback về release trước", [("(chỉ image, không đổi schema)", V)])
cron_y = rb_y + 60 + 24
f.box(416, cron_y, 328, 60, "Cron: backup.sh 02:30 hằng ngày", [("(giữ 14 ngày), healthcheck.sh 5 phút", V)], "store")

f.legend(1020, [("input", "Sự kiện kích hoạt"), ("backend", "Bước tự động"), ("focal", "Điểm quyết định"), ("store", "Tác vụ định kỳ"), ("call", "Thứ tự thực hiện")])
f.write(OUT / "deploy-ci-cd-pipeline-dd.html", 1048,
        "Quy trình CI/CD từ mã nguồn đến VPS production",
        "ci.yml kiểm tra mọi nhánh; khi hợp nhất vào production, deploy-production.yml kiểm tra lại, build 7 image lên GHCR và SSH vào VPS, nơi deploy.sh sao lưu, kéo image, chạy migrate và tự rollback nếu healthcheck không đạt.",
        "Quy trình CI/CD từ mã nguồn đến VPS production", "Flowchart · Diagram Design · SmartBook",
        '<p class="note">Nguồn: <code>docs/diagrams/source/architecture/deploy-ci-cd-pipeline.mmd</code> (Hình 6.1), vẽ lại ở mức faithful.</p>')
