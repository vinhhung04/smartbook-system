# Monitoring & Alerting

Hệ thống giám sát và quản lý sự cố của SmartBook. Runbook từng cảnh báo: [`docs/runbooks/MONITORING_RUNBOOKS.md`](runbooks/MONITORING_RUNBOOKS.md).

## 1. Kiến trúc

```
Dịch vụ (:9464 /metrics, ai-service :8000/metrics)  ─┐
node-exporter · cAdvisor · postgres-exporter         ├─ scrape ─▶ Prometheus (15 ngày / 2 GB)
redis-exporter · RabbitMQ :15692/metrics/per-object ─┘                 │
                                                                        ▼
                                                     Grafana Alerting: 37 rule (rules.yaml)
                                                                        │ webhook + Bearer MONITORING_INGEST_TOKEN
deploy/scripts/healthcheck.sh (cron 5 phút) ── node src/cli/ingest-healthcheck.js ─┤   (mạng Docker nội bộ)
                                                                        ▼
                         monitoring-service (monitoring_db) — sự cố, chính sách, hàng đợi gửi
                           │ email (SMTP)   │ in-app (lưu DB → gateway → Socket.IO room "monitoring")   │ Slack/Discord
healthcheck.sh ── webhook trực tiếp (ALERT_WEBHOOK_URL) — đường dự phòng không phụ thuộc monitoring-service
healthcheck.sh ── ping EXTERNAL_HEARTBEAT_URL khi khỏe — dịch vụ bên ngoài báo khi VPS mất kết nối
```

Nguyên tắc thiết kế:

- **Grafana chỉ phát hiện.** Sự cố, chống trùng lặp, định tuyến, retry và lịch sử gửi nằm trong `monitoring-service`.
- **Không phụ thuộc RabbitMQ.** Cảnh báo critical đi qua hàng đợi gửi lưu trong PostgreSQL (`alert_deliveries`, claim bằng `FOR UPDATE SKIP LOCKED`, lease 2 phút).
- **PostgreSQL ngừng không làm mất cảnh báo:**
  - Payload hợp lệ được ghi vào spool trên volume `monitoring_spool` (tối đa 10 MB), và service vẫn trả 202 để Grafana coi là đã gửi thành công. Nhờ vậy Grafana vẫn gửi `resolved` sau đó, vì Alertmanager chỉ gửi bản tin phục hồi cho alert đã được báo thành công.
  - Khi DB trở lại, spool được phát lại theo đúng thứ tự, với đúng thời điểm nhận ban đầu (E2E: 3 payload được spool, rồi phát lại, rồi tự xử lý).
  - Thông báo cho các sự cố này chỉ được gửi *sau khi* DB phục hồi. Trong lúc DB ngừng, đường báo theo thời gian thực là `healthcheck.sh` (webhook trực tiếp) và heartbeat bên ngoài.
- **Monitoring lỗi không làm dừng nghiệp vụ.** Không service nghiệp vụ nào `depends_on` monitoring. `deploy.sh` chỉ khởi động monitoring *sau* khi release đã khỏe, và lỗi của monitoring không làm hỏng release.
- **Không có số liệu giả.** UI hiển thị "Chưa có dữ liệu" khi thiếu dữ liệu.

## 2. Vòng đời sự cố

| Sự kiện | Kết quả |
|---|---|
| Alert `firing` lần đầu (fingerprint mới) | Tạo sự cố `OPEN`, ghi sự kiện `DETECTED`, gửi thông báo theo chính sách |
| Grafana gửi lại cùng alert đang mở | Chỉ cập nhật `last_seen_at` (partial unique index: tối đa 1 sự cố mở / fingerprint) |
| Mức độ tăng (vd. WARNING → CRITICAL) | `SEVERITY_ESCALATED`, gửi lại thông báo |
| Quản trị viên tiếp nhận | `ACKNOWLEDGED`, lưu người tiếp nhận; khóa lạc quan theo `version` (409 nếu dữ liệu cũ) |
| Alert `resolved` | `RESOLVED` (`AUTO`), gửi thông báo phục hồi nếu chính sách bật và trước đó đã thông báo |
| Đánh dấu đã xử lý thủ công | `RESOLVED` (`MANUAL`), lưu nguyên nhân/ghi chú |
| Tái diễn trong `MONITORING_REOPEN_WINDOW_MINUTES` (30 phút) | Mở lại cùng sự cố, `occurrence_count + 1`, thông báo tuân theo cooldown |
| Payload cũ gửi lại (replay `startsAt` đã xử lý) | Bỏ qua (`ignored_replay`) |
| Chỉ nhận được `resolved` (lúc `firing`, monitoring-service hoặc PostgreSQL không khả dụng) | Ghi sự cố `RESOLVED` kèm nhãn `detected_late`, giữ nguyên thời gian thực của sự cố (MTTR đúng, loại khỏi MTTD), gửi thông báo "đã xảy ra và đã phục hồi" |

**Inhibition:** khi một dịch vụ có sự cố `alert_kind=availability` đang mở, các sự cố khác của cùng dịch vụ vẫn được ghi nhưng không gửi thông báo.

**Phân loại:** `TECHNICAL`, `BUSINESS`, `INFO`. Mức độ: `CRITICAL`, `HIGH`, `WARNING`, `INFO`.

## 3. Chính sách và kênh thông báo

Cấu hình trong **Giám sát hệ thống → Cài đặt thông báo** (quyền `monitoring.settings.manage`).

- **Chính sách:** khớp theo rule uid > phân loại + mức độ > mức độ > phân loại > mặc định. Mỗi chính sách bật/tắt Email, In-app, Webhook, báo phục hồi, và thời gian chờ (cooldown). UI cảnh báo khi một chính sách critical bị tắt hoặc không có kênh nào. Dữ liệu mặc định do migration tạo, không hardcode ở frontend.
- **Email:** danh sách người nhận do quản trị viên nhập; dùng `SMTP_*` của máy chủ. Template escape HTML, tiêu đề có mức độ, kèm link sự cố.
- **In-app:** chỉ dành cho ADMIN và người có quyền `monitoring.*`, không bao giờ tới khách hàng. Thông báo được lưu (`system_notifications`) trước khi phát realtime; mất Socket.IO không làm mất thông báo; trạng thái đã đọc tính theo từng người.
- **Webhook (Slack/Discord):** URL được mã hóa AES-256-GCM (`MONITORING_SECRET_KEY`), chỉ hiển thị gợi ý `host/…abcd`. Chống SSRF:
  - chỉ HTTPS cổng 443, phải dùng tên miền;
  - allowlist `hooks.slack.com`, `discord.com/api/webhooks`; loại "generic" chỉ khi `MONITORING_WEBHOOK_ALLOW_PUBLIC=true`;
  - mọi IP phân giải phải là IP công khai, và kết nối được ghim vào IP đã kiểm tra;
  - không theo redirect, timeout 5 giây, giới hạn phản hồi 64 KB.
- **Retry:** lùi thời gian 30s, 2m, 10m, 30m, 1h, 2h… (±20% jitter), tối đa theo cấu hình kênh (1–12). Lỗi 4xx (trừ 408/429), SMTP 5xx và lỗi chính sách là lỗi vĩnh viễn. Hết số lần thử → `DEAD`, kèm sự kiện `DELIVERY_FAILED` và rule "Alert delivery failing".

## 4. Alert rule

`observability/grafana/provisioning/alerting/rules.yaml`, gồm 37 rule trong 5 nhóm:
- **availability:** mất metrics dịch vụ, DB/PostgreSQL/Redis, RabbitMQ thiếu consumer, canary Prometheus, gửi thông báo thất bại/tồn.
- **performance:** tỷ lệ 5xx toàn hệ thống và theo dịch vụ, p95.
- **infrastructure:** CPU, RAM, đĩa, container gần giới hạn/OOM, kết nối PostgreSQL, deadlock, DLQ, backlog, publish lỗi.
- **business:** outbox, đối soát, thanh toán, xung đột đặt trước, tồn kho thấp, phiếu nhập kẹt, ngoại lệ kho, metrics nghiệp vụ bị thiếu.
- **ai:** lỗi provider, quota, OCR, chi phí 24 giờ, đồng bộ catalog.

Mỗi rule có dạng: truy vấn A → ngưỡng B. `noDataState` và `execErrState` được chọn có chủ đích (chi tiết ở đầu file). Kết quả rỗng nghĩa là khỏe; chỉ rule canary báo khi Prometheus lỗi. Các ngưỡng có ghi "initial"/"ban đầu" là ngưỡng chưa có baseline production: điều chỉnh trong file này (có review qua Git), không sửa trong UI Grafana.

## 5. Biến môi trường

| Biến | Nơi dùng | Ghi chú |
|---|---|---|
| `MONITORING_DB_PASSWORD` | db, monitoring-service, postgres-exporter | Role `monitoring_runtime` (bảng monitoring_db) và `monitoring_exporter` (`pg_monitor`). Để trống thì deploy bỏ qua monitoring |
| `MONITORING_INGEST_TOKEN` | Grafana, monitoring-service, healthcheck CLI | ≥ 24 ký tự. Grafana và monitoring-service từ chối khởi động nếu thiếu |
| `MONITORING_SECRET_KEY` | monitoring-service | 64 ký tự hex (`openssl rand -hex 32`). Thiếu thì không lưu được webhook |
| `MONITORING_WEBHOOK_ALLOW_PUBLIC` | monitoring-service | Mặc định `false` (chỉ Slack/Discord) |
| `MONITORING_SMTP_FROM` | monitoring-service | Người gửi email cảnh báo |
| `MONITORING_REOPEN_WINDOW_MINUTES`, `MONITORING_DELIVERY_INTERVAL_MS` | monitoring-service | Mặc định 30 phút / 5000 ms |
| `MONITORING_SPOOL_DIR` | monitoring-service | Mặc định `/app/spool` (volume `monitoring_spool`) |
| `GOODS_RECEIPT_STUCK_HOURS` | inventory-service | Mặc định 24 |
| `ALERT_WEBHOOK_URL` | healthcheck.sh | Đường dự phòng trực tiếp; Grafana không còn dùng |
| `EXTERNAL_HEARTBEAT_URL` | healthcheck.sh | Ping sau mỗi lần kiểm tra khỏe (dead-man's switch) |
| `GRAFANA_ADMIN_PASSWORD` | Grafana | Bắt buộc, không có mật khẩu mặc định |

## 6. Phân quyền

- API `/monitoring/*` (qua gateway) yêu cầu JWT hợp lệ và chưa bị thu hồi:
  - **đọc:** ADMIN, superuser, hoặc `monitoring.incidents.read`, `monitoring.incidents.manage`, `monitoring.settings.manage`;
  - **tiếp nhận/xử lý/ghi chú:** ADMIN hoặc `monitoring.incidents.manage`;
  - **cấu hình:** ADMIN hoặc `monitoring.settings.manage`.
- Mọi thay đổi cấu hình được ghi vào `monitoring_audit_logs`.
- `audit.read` **không** cấp quyền xem sự cố. Trang **Giám sát hệ thống → Dịch vụ** vẫn giữ nguyên quyền cũ.
- Seed của auth-service đã có 3 permission mới. ADMIN có quyền ngay cả khi DB production chưa có các dòng permission này.
- `/internal/alerts/*` không được gateway proxy và yêu cầu `MONITORING_INGEST_TOKEN`.

## 7. Triển khai production

Lần đầu trên VPS đang chạy:

1. Thêm vào `/opt/smartbook/.env`:
   - `MONITORING_DB_PASSWORD=$(openssl rand -hex 24)`;
   - `MONITORING_INGEST_TOKEN=$(openssl rand -hex 32)`;
   - `MONITORING_SECRET_KEY=$(openssl rand -hex 32)`;
   - tùy chọn `EXTERNAL_HEARTBEAT_URL`, `MONITORING_SMTP_FROM`.

   Không đổi biến cũ.
2. Deploy như bình thường. Sau khi release khỏe, `deploy.sh`:
   - chạy `db-init/05-monitoring-db.sh` (idempotent);
   - chạy owner job `migrate-monitoring`;
   - khởi động `monitoring-service prometheus grafana node-exporter cadvisor postgres-exporter redis-exporter`.

   Lỗi ở bước này chỉ ghi `WARNING` vào log và không làm hỏng release.
3. Vì biến môi trường của container `db` thay đổi, deploy đầu tiên sẽ tạo lại container `db`, đúng trong cửa sổ bảo trì mà các writer đã được dừng.
4. Vào **Cài đặt thông báo**: nhập email nhận cảnh báo, thêm webhook Slack/Discord, bấm **Gửi thử** từng kênh.
5. Grafana: `ssh -L 3100:127.0.0.1:3100 sb-deploy` → `http://localhost:3100`.

**Giám sát từ bên ngoài** (bắt buộc để biết khi VPS sập, vì monitoring cùng VPS không tự báo được):
- tạo một check miễn phí ở healthchecks.io (hoặc tương đương) với chu kỳ 5 phút, grace 10 phút, rồi đặt URL ping vào `EXTERNAL_HEARTBEAT_URL`;
- thêm một monitor HTTP (UptimeRobot/Better Stack) cho `https://api.smartbook.io.vn/ready` và `https://smartbook.io.vn`.

Việc đăng ký dịch vụ do người vận hành thực hiện; repository không chứa credential.

**Tài nguyên:**

| Thành phần | Giới hạn |
|---|---|
| prometheus | 0.5 CPU / 384 MB |
| grafana | 0.5 CPU / 256 MB |
| monitoring-service | 0.5 CPU / 256 MB |
| cadvisor | 0.3 CPU / 192 MB |
| node-exporter | 0.2 CPU / 64 MB |
| postgres-exporter | 0.2 CPU / 64 MB |
| redis-exporter | 0.1 CPU / 32 MB |

Tổng *giới hạn* toàn stack khoảng 10,9 GB trên VPS 12 GB RAM + 4 GB swap. Mức dùng thực tế đo trên stack QA nhỏ hơn nhiều; theo dõi qua rule bộ nhớ.

**Bảo mật mạng:**
- Prometheus, các exporter và monitoring-service chỉ nằm trên mạng nội bộ.
- Grafana chỉ bind loopback, không có sign-up hay anonymous, và không có mật khẩu mặc định.
- cAdvisor cần Docker socket (mount `:ro` không hạn chế được API Docker). Container này không mở cổng và chạy `no-new-privileges`. Nếu không chấp nhận rủi ro này, xóa service `cadvisor` khỏi `MONITORING_SERVICES` trong `deploy/scripts/lib.sh`; khi đó hai rule container sẽ không có dữ liệu.

**Backup/restore:**
- `backup.sh` dump thêm `monitoring_db` (nếu có) thành `monitoring_db.dump.gpg`, ghi vào `optional_databases` của manifest. Bản dump này nằm ngoài ranh giới writers-stopped.
- `restore.sh` không tự khôi phục `monitoring_db`. Khôi phục thủ công: tạo DB/role bằng `db-init/05-monitoring-db.sh`, sau đó `gpg --decrypt monitoring_db.dump.gpg | dc exec -T db pg_restore -U "$POSTGRES_USER" -d monitoring_db --no-owner --no-acl`.
- Lịch sử Prometheus/Grafana không được backup; chúng được dựng lại từ cấu hình trong Git.

**Rollback:**
- Tắt monitoring: `dc stop monitoring-service prometheus grafana node-exporter cadvisor postgres-exporter redis-exporter`. Nghiệp vụ không bị ảnh hưởng.
- Image rollback dùng cơ chế sẵn có của `deploy.sh`.
- Migration của `monitoring_db` chỉ thêm bảng mới, không chạm DB nghiệp vụ. Giữ nguyên DB khi rollback; không cần down-migration.
- File cũ `observability/production/contact-points.yaml` có thể còn trên VPS từ lần deploy trước (tar không xóa file). File này không còn được mount; có thể xóa an toàn.

## 8. Kiểm thử

| Lệnh | Phạm vi |
|---|---|
| `pnpm --filter monitoring-service test` | Unit (payload Grafana/healthcheck, severity, policy, backoff, SSRF, mã hóa, template, RBAC). DB test bị skip nếu thiếu DB |
| `MONITORING_TEST_DATABASE_URL=postgresql://…@127.0.0.1:<port>/monitoring_test node --test --test-concurrency=1 services/monitoring-service/test/*.test.js` | Vòng đời, chống trùng (kể cả 5 webhook đồng thời), replay, reopen, cooldown, inhibition, retry SMTP, in-app không trùng, lease, analytics |
| `node --test tests/monitoring-config.test.mjs tests/production-readiness/integration/metrics-promql.test.mjs` | Cấu hình; `promtool` parse mọi biểu thức |
| `node --test tests/production-readiness/integration/grafana-alerting.test.mjs` | Grafana + Prometheus thật: provisioning, từ chối khởi động khi thiếu token, không rule nào bắn khi khỏe, mất target → đúng rule |
| CI job `monitoring` | Migrate, kiểm tra drift, chạy test DB (không cho phép skip) |

Kiểm thử lỗi thật (E2E) chỉ chạy trên stack tạm riêng (project compose riêng, volume riêng, cổng 23xxx), **không bao giờ trên production**. Các kịch bản:
- dịch vụ ngừng/phục hồi, RabbitMQ ngừng, outbox FAILED, mất scrape target;
- SMTP lỗi rồi retry thành công, webhook lỗi DNS → retry → DEAD;
- chống trùng/replay, tiếp nhận/xử lý, thông báo phục hồi, phân quyền và room Socket.IO.
