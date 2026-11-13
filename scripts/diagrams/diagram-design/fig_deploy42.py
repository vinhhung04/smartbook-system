"""Hình 4.2 — Triển khai production (faithful redraw of docs/diagrams/drawio/deployment-production.drawio)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from arch import Fig
from dd import t, C

OUT = pathlib.Path(sys.argv[1])
V, M = False, True
f = Fig("deployment-production-dd")

# ---- outside the VPS
f.box(40, 40, 152, 64, "Trình duyệt", [("smartbook.io.vn", M)], "input")
f.box(204, 40, 216, 64, "Ứng dụng di động (APK EAS)", [("api.smartbook.io.vn", M)], "input")
f.box(432, 40, 184, 64, "GitHub", [("Actions (CI/CD) + GHCR", V), ("image gắn tag commit SHA", V)], "external")
f.box(628, 40, 132, 64, "Expo EAS", [("build APK/AAB, OTA", V)], "external")

# ---- VPS zone with a 3-line heading kept left of the inbound connectors
VPS_TOP = 152
f.Z.append(f'<rect x="40" y="{VPS_TOP}" width="720" height="__VPSH__" rx="8" fill="#ffffff" stroke="{C["ink"]}" stroke-width="1"/>')
f.Z.append(t(56, VPS_TOP + 22, "VPS Ubuntu 24.04 (6 vCPU, ~12 GB RAM)", 14, False, C["ink"], anchor="start", weight="700"))
f.Z.append(t(56, VPS_TOP + 40, "UFW chỉ mở 22/80/443 · fail2ban ·", 12, False, C["muted"], anchor="start"))
f.Z.append(t(56, VPS_TOP + 56, "Docker Compose · /opt/smartbook", 12, True, C["muted"], anchor="start"))

# mạng edge
f.zone(56, 224, 688, 96, "mạng edge")
f.box(72, 252, 192, 56, "web", [("(nginx, bundle React, CSP)", V)])
f.box(304, 252, 192, 56, "caddy 2.8 · cổng 80/443", [("HTTPS tự động, HSTS", V)])
f.box(536, 252, 192, 56, "api-gateway", [("(nối cả 3 mạng)", V)], "focal")
f.arrow("M 304 280 H 265", "call")          # caddy → web
f.arrow("M 496 280 H 535", "call")          # caddy → api-gateway
# inbound: browser and mobile app → caddy (distinct attach points 384 / 416 on caddy's top edge)
f.arrow("M 116 104 V 120 Q 116 128 124 128 H 376 Q 384 128 384 136 V 251", "link")
f.arrow("M 312 104 V 112 Q 312 120 320 120 H 408 Q 416 120 416 128 V 251", "link")
f.label(376, 196, [("HTTPS", M)], C["link"], anchor="end")
f.label(424, 196, [("HTTPS / WSS", M)], C["link"])
# GitHub → VPS: SSH deploy, pull image (dashed, ends on the VPS frame)
f.arrow(f"M 524 104 V {VPS_TOP - 1}", "call", dashed=True)
f.label(536, 116, [("SSH deploy, pull image", V)])

# mạng app
APP_Y = 356
f.zone(56, APP_Y, 688, 164, "mạng app (có đường ra Internet)")
f.box(72, APP_Y + 32, 208, 56, "auth-service", [("512 MB", M)])
f.box(296, APP_Y + 32, 208, 56, "inventory-service", [("768 MB", M)])
f.box(520, APP_Y + 32, 208, 56, "borrow-service", [("768 MB", M)])
f.box(184, APP_Y + 96, 208, 56, "analytics-service", [("512 MB", M)])
f.box(408, APP_Y + 96, 208, 56, "ai-service", [("3 GB (CLIP CPU, Chromium)", V)])
f.arrow(f"M 632 308 V {APP_Y - 1}", "call")
f.label(644, 326, [("HTTP nội bộ", V)])

# mạng data + tác vụ máy chủ
DATA_Y = APP_Y + 164 + 40
f.zone(56, DATA_Y, 440, 124, "mạng data (internal: không ra Internet,")
f.Z.append(t(72, DATA_Y + 40, "Caddy không tới được)", 12, False, C["muted"], anchor="start"))
f.box(72, DATA_Y + 48, 128, 60, "db", [("pgvector/pg15", M), ("2 GB · 4 CSDL", V)], "store")
f.box(212, DATA_Y + 48, 128, 60, "redis 7 (AOF)", [("512 MB", M)], "store")
f.box(352, DATA_Y + 48, 128, 60, "rabbitmq 3.13", [("768 MB", M)], "store")
f.arrow(f"M 276 {APP_Y + 164} V {DATA_Y - 1}", "call")
f.label(288, APP_Y + 164 + 11, [("SQL, cache, sự kiện", V)])
ops_h = f.note(512, DATA_Y, 232, [
    ("Tác vụ trên máy chủ", V), ("(cron, deploy/scripts)", V),
    ("• backup.sh 02:30: pg_dump 4 CSDL", V), ("  + ảnh đóng gói, giữ 14 ngày", V),
    ("• healthcheck.sh mỗi 5 phút,", V), ("  cảnh báo webhook tùy chọn", V),
    ("• deploy.sh: backup trước deploy,", V), ("  tự rollback", V),
    ("• restore.sh, verify-backup.sh", V)])
# db capacity line sits under the data zone boxes (source: "db pgvector/pg15 · 2 GB · 4 CSDL")

# Volume Docker
VOL_Y = max(DATA_Y + 124, DATA_Y + ops_h) + 16
f.zone(56, VOL_Y, 688, 152, "Volume Docker")
vols = [("postgres_data",), ("redis_data",), ("rabbitmq_data",), ("packing_evidence_data",),
        ("ai_model_cache,", "ai_cloakbrowser_cache"), ("caddy_data, caddy_config",)]
for i, v in enumerate(vols):
    col, row = i % 3, i // 3
    x, y = 72 + col * 224, VOL_Y + 32 + row * 56
    f.box(x, y, 208, 48, "", [(s, M) for s in v], "store")
VPS_H = VOL_Y + 152 + 16 - VPS_TOP
f.Z[0] = f.Z[0].replace("__VPSH__", str(VPS_H))

# Dịch vụ bên ngoài
EXT_Y = VPS_TOP + VPS_H + 24
f.zone(40, EXT_Y, 720, 100, "Dịch vụ bên ngoài (đi ra từ mạng app)")
f.box(56, EXT_Y + 32, 160, 52, "OpenRouter (Qwen)", [], "external")
f.box(228, EXT_Y + 32, 144, 52, "Máy chủ SMTP", [], "external")
f.box(384, EXT_Y + 32, 208, 52, "", [("Google Books, Open Library,", V), ("nhà sách", V)], "external")
f.box(604, EXT_Y + 32, 140, 52, "VNPay sandbox", [], "external")

LEG = EXT_Y + 100 + 44
f.legend(LEG, [("input", "Máy khách"), ("backend", "Container"), ("focal", "Gateway nối 3 mạng"), ("store", "Dữ liệu, volume"), ("external", "Bên ngoài")])
f.legend(LEG + 28, [("link", "HTTPS từ Internet"), ("call", "Lưu lượng nội bộ"), ("dash", "Triển khai qua SSH")], rule=False)
f.write(OUT / "deployment-production-dd.html", LEG + 56,
        "Triển khai production trên VPS bằng Docker Compose",
        "Một VPS Ubuntu chạy Docker Compose với ba mạng edge, app và data: Caddy nhận HTTPS và chuyển tới web và api-gateway, năm service ở mạng app, cơ sở dữ liệu, Redis và RabbitMQ ở mạng data không ra Internet; GitHub triển khai qua SSH.",
        "Sơ đồ triển khai production trên VPS bằng Docker Compose", "Deployment · Diagram Design · SmartBook",
        '<p class="note">Nguồn: <code>docs/diagrams/drawio/deployment-production.drawio</code> (Hình 4.2), vẽ lại ở mức faithful.</p>')
