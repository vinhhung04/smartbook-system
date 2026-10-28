# Triển khai SmartBook lên production

Tài liệu vận hành cho môi trường production của SmartBook: VPS `smartbook`, domain `smartbook.io.vn`, CI/CD bằng GitHub Actions.

Quy trình thường ngày chỉ có một dòng: **code trên `hungg` → merge vào `production` → GitHub Actions tự test, build, deploy.** Không cần SSH vào VPS để `git pull` hay build.

---

## 1. Kiến trúc production

```
Internet ──► Caddy :80/:443 (HTTPS tự động, Let's Encrypt)
              ├─ smartbook.io.vn      ──► web (nginx, React build sẵn)
              ├─ api.smartbook.io.vn  ──► api-gateway:3000 (REST + Socket.IO/WSS)
              └─ www.smartbook.io.vn  ──► 301 về https://smartbook.io.vn
api-gateway ──► auth-service:3002, inventory-service:3001, borrow-service:3005,
                analytics-service:3006, ai-service:8000 (OpenRouter/Qwen)
services    ──► db (PostgreSQL 15 + pgvector), redis, rabbitmq
```

| Mạng Docker | Thành phần | Ghi chú |
|---|---|---|
| `edge` | caddy, web, api-gateway | Caddy chỉ thấy web và gateway |
| `app` | gateway và các service | Có internet: OpenRouter, SMTP, tra cứu sách |
| `data` (internal) | db, redis, rabbitmq và các service | Không có internet, Caddy/web không truy cập được |

Chỉ Caddy publish cổng ra ngoài (80, 443/tcp, 443/udp). PostgreSQL, Redis, RabbitMQ và các microservice **không** publish cổng nào.

AI: toàn bộ inference (chat, tool-calling, OCR/vision, embedding) đi qua **OpenRouter** (model Qwen). Không có Ollama, không cần GPU. Riêng tìm sách bằng ảnh bìa dùng CLIP chạy CPU trong `ai-service` (giới hạn 3 GB RAM).

## 2. VPS

| | |
|---|---|
| Hostname | **`smartbook`** (giữ nguyên, không đổi) |
| IP | 160.250.5.241 |
| OS | Ubuntu Server 24.04 LTS, x86_64, KVM |
| Tài nguyên | 6 vCPU, ~12 GB RAM, 120 GB SSD, swap 4 GB |
| Thư mục ứng dụng | `/opt/smartbook` (chủ sở hữu: `deploy`) |
| Host key | `RSA SHA256:uWaeV3OiLp0aUYzNedsL8Gzyv1+kK5oWKSgh1PW0Phs` |

Tài khoản:

- `root`: chỉ đăng nhập bằng SSH key (sau khi chạy `harden-ssh.sh`).
- `deploy`: thuộc nhóm `docker`, không có sudo. Có 2 key: key quản trị của bạn (`~/.ssh/smartbook_vps`) và key CI (gắn `restrict`: không pty, không forwarding).

> Lưu ý bảo mật: nhóm `docker` tương đương quyền root. Ai push được vào `production` là chạy được code trên VPS, nên nhánh `production` phải được bảo vệ (mục 9).

Bảo vệ đã cấu hình trên VPS: UFW (chỉ mở SSH/80/443), fail2ban cho sshd, unattended-upgrades (chỉ bản vá security, không tự reboot), xoay vòng log Docker (10 MB × 3), giới hạn journald 500 MB, swap 4 GB (`vm.swappiness=10`). Docker được enable khi boot, mọi container có `restart: unless-stopped`, nên stack tự chạy lại sau khi VPS reboot.

## 3. Domain và DNS

| Bản ghi | Loại | Giá trị |
|---|---|---|
| `smartbook.io.vn` | A | 160.250.5.241 |
| `api.smartbook.io.vn` | A | 160.250.5.241 |
| `www.smartbook.io.vn` | CNAME | smartbook.io.vn |

Kiểm tra: `nslookup api.smartbook.io.vn 1.1.1.1`. Chứng chỉ do Caddy tự xin và tự gia hạn, lưu trong volume `caddy_data`. Xem chi tiết trong `deploy/Caddyfile`.

## 4. Cấu trúc file

| File | Vai trò |
|---|---|
| `compose.prod.yml` | Stack production: image GHCR theo SHA, healthcheck, giới hạn CPU/RAM, mạng, volume |
| `deploy/Caddyfile` | HTTPS, reverse proxy, HSTS, redirect www |
| `.env.production.example` | Mẫu biến môi trường (không chứa secret) |
| `deploy/scripts/dc` | `docker compose` kèm sẵn `.env` và `IMAGE_TAG` hiện hành |
| `deploy/scripts/deploy.sh` | Pull image theo SHA, backup trước deploy, rollout, kiểm tra sức khỏe, tự rollback |
| `deploy/scripts/rollback.sh` | Quay về release trước (chỉ image, không đụng database) |
| `deploy/scripts/backup.sh` / `restore.sh` / `verify-backup.sh` | Sao lưu / khôi phục / thử khôi phục |
| `deploy/scripts/healthcheck.sh` | Giám sát gọn nhẹ (cron 5 phút) |
| `deploy/scripts/seed-demo.sh` | Nạp bộ dữ liệu demo |
| `deploy/scripts/bootstrap-vps.sh` / `harden-ssh.sh` | Chuẩn bị VPS lần đầu / tắt đăng nhập SSH bằng mật khẩu |
| `.github/workflows/deploy-production.yml` | Pipeline CI/CD |

Trên VPS, ngoài các file trên (CI upload ở mỗi lần deploy) còn có:

```
/opt/smartbook/.env                     secret production (mode 600, không có trong git)
/opt/smartbook/state/release.env        IMAGE_TAG đang chạy
/opt/smartbook/state/releases.log       lịch sử deploy/rollback
/opt/smartbook/backups/                 bản sao lưu
```

Volume dữ liệu (`docker volume ls`): `smartbook_postgres_data`, `smartbook_redis_data`, `smartbook_rabbitmq_data`, `smartbook_packing_evidence_data` (ảnh đóng gói), `smartbook_ai_model_cache`, `smartbook_ai_cloakbrowser_cache`, `smartbook_caddy_data` (chứng chỉ). **Không bao giờ chạy `docker compose down -v`.**

## 5. Biến môi trường

Toàn bộ nằm trong `/opt/smartbook/.env`, tạo bằng `deploy/scripts/init-env.sh` từ `.env.production.example`. Script tự sinh secret ngẫu nhiên dạng hex (an toàn khi đặt trong URL `postgresql://`).

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `ANALYTICS_DB_PASSWORD` | ✔ | Đổi mật khẩu DB sau khi đã có dữ liệu phải `ALTER ROLE` trong Postgres, không chỉ sửa file |
| `JWT_SECRET`, `INTERNAL_SERVICE_KEY` | ✔ | Đổi `JWT_SECRET` sẽ đăng xuất mọi người dùng |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | ✔ | |
| `OPENROUTER_API_KEY` | ✔ cho AI | Thiếu key: trợ lý AI/OCR/embedding báo lỗi, phần còn lại vẫn chạy |
| `OPENROUTER_*_MODEL` | | Mặc định `qwen/qwen3.7-flash`, embedding `qwen/qwen3-embedding-8b` |
| `GOOGLE_BOOKS_API_KEY` | | Tra cứu ISBN |
| `SMTP_*` | | Email quên mật khẩu/thông báo |
| `VNPAY_*` | | Mặc định dùng URL sandbox |
| `BACKUP_KEEP_DAYS`, `BACKUP_RCLONE_REMOTE`, `ALERT_WEBHOOK_URL` | | Vận hành |

Sửa `.env` xong thì áp dụng bằng: `cd /opt/smartbook && deploy/scripts/dc up -d` (chỉ các service dùng biến đó được tạo lại).

**URL API được nhúng vào bundle frontend lúc build** (Vite `VITE_*`). Workflow luôn build với `https://api.smartbook.io.vn`. Nếu đổi domain, sửa `PUBLIC_API_ORIGIN` / `PUBLIC_WEB_ORIGIN` ở **cả** workflow lẫn `.env` rồi deploy lại.

## 6. GitHub Actions: secrets và môi trường

Environment **`production`** (Settings → Environments) chỉ cho nhánh `production` deploy. Cấu hình của environment:

| Tên | Loại | Nội dung |
|---|---|---|
| `VPS_SSH_KEY` | Secret | Private key riêng cho CI (ed25519, chỉ dùng để deploy) |
| `VPS_KNOWN_HOSTS` | Secret | Host key đã ghim của VPS (bật `StrictHostKeyChecking=yes`) |
| `VPS_HOST` | Variable | `160.250.5.241` |
| `VPS_USER` | Variable | `deploy` (để dạng variable vì nếu là secret, GitHub sẽ che mọi chữ "deploy" trong log) |

Không cần PAT cho GHCR. Job deploy dùng `GITHUB_TOKEN` ngắn hạn (`packages: read`), đưa qua stdin vào `deploy.sh`. Token chỉ nằm trong một `DOCKER_CONFIG` tạm và bị xóa ngay sau khi pull; trên VPS không lưu credential registry nào.

Tạo lại key CI (khi lộ hoặc định kỳ), chạy trên máy local:

```bash
ssh-keygen -t ed25519 -N "" -C github-actions-deploy@smartbook -f ci_key
gh secret set VPS_SSH_KEY --env production -R vinhhung04/smartbook-system < ci_key
# thay dòng "restrict ssh-ed25519 ... github-actions-deploy@smartbook" trong /home/deploy/.ssh/authorized_keys bằng ci_key.pub
rm ci_key
```

## 7. Pipeline CI/CD

`.github/workflows/deploy-production.yml` chạy khi push vào `production`, hoặc chạy tay (Actions → *Deploy production* → *Run workflow*, chọn nhánh `production`).

1. **Tests (deploy gate)**: lint, typecheck web, build web, test cấu hình workspace, unit test web, test các Node service, toàn bộ test `ai-service` (pytest), `prisma validate` cho 3 schema, kiểm tra `compose.prod.yml`. Một bước fail thì không build, không deploy.
2. **Build images** (chạy song song): 7 image `ghcr.io/vinhhung04/smartbook-{web,api-gateway,auth-service,inventory-service,borrow-service,analytics-service,ai-service}`. Tag bất biến là **commit SHA đầy đủ**, kèm tag tham khảo `production`. Có cache build qua GitHub Actions.
3. **Deploy** (environment `production`): upload `compose.prod.yml`, `deploy/`, `db-init/` và dữ liệu seed lên `/opt/smartbook`, rồi chạy `deploy.sh <sha>`:
   - khóa `flock`: không bao giờ có 2 deploy chạy cùng lúc (workflow cũng có `concurrency`);
   - pull đúng 7 image theo SHA, không pull image hạ tầng nên **không restart database** khi deploy;
   - `pg_dump` toàn bộ database trước khi migration chạy (`backups/*-predeploy-*`, giữ 5 bản gần nhất);
   - `docker compose up -d --wait`: service chạy `prisma migrate deploy` (chỉ áp migration mới, không reset), sau đó chờ healthcheck;
   - smoke test `https://api.smartbook.io.vn/ready` và trang chủ qua Caddy;
   - nếu fail: **tự rollback** về release trước (chỉ image), log ghi vào `state/releases.log`;
   - giữ image của 3 release gần nhất để rollback, xóa image cũ hơn.
4. **Verify from the internet**: `/ready` trả 200; `https://smartbook.io.vn/version.json` phải đúng SHA vừa deploy; `/login` trả 200; `www` redirect về domain chính; CORS preflight từ `https://smartbook.io.vn` được chấp nhận.

Mức gián đoạn: **low-downtime, không phải zero-downtime.** Docker Compose tạo lại từng container (mỗi service một bản), nên gateway có một khoảng ngắn không phục vụ. Caddy giữ request tối đa 30 giây (`lb_try_duration`) trong lúc chờ container mới, vì vậy người dùng thường chỉ thấy request chậm hơn chứ không gặp lỗi 502. Kết nối WebSocket sẽ bị ngắt và client Socket.IO tự kết nối lại.

**Migration database:** rollback chỉ quay lại image, **không** quay lại schema. Mọi migration phải tương thích ngược (expand → contract): thêm cột/bảng trước, xóa sau ở một release khác. Không viết migration xóa hoặc đổi tên cột mà code cũ còn dùng.

Xem trạng thái: tab **Actions** trên GitHub, hoặc `gh run list -R vinhhung04/smartbook-system -w "Deploy production"` và `gh run watch`. Image: trang **Packages** của tài khoản `vinhhung04`.

## 8. Quy trình cập nhật code (hằng ngày)

```bash
git switch hungg
# ... sửa code, chạy test local ...
git push origin hungg            # CI (ci.yml) chạy, không deploy

# khi muốn phát hành:
git switch production
git pull --ff-only origin production
git merge --ff-only hungg        # hoặc mở Pull Request hungg -> production trên GitHub
git push origin production       # => test, build, deploy tự động
git switch hungg
```

Không cần SSH vào VPS. Theo dõi tab Actions; khoảng 15–25 phút sau trang web sẽ chạy bản mới. Kiểm tra bằng `curl https://smartbook.io.vn/version.json`.

## 9. Bảo vệ nhánh `production`

Đã bật: cấm force-push, cấm xóa nhánh, áp dụng cả với admin. Environment `production` chỉ nhận deploy từ nhánh `production`. Pull request từ fork không bao giờ chạy workflow deploy (workflow chỉ chạy khi `push`).

Nên bật thêm khi làm việc nhóm: *Require a pull request before merging* và *Require status checks* (chọn các job của `CI` trên `hungg`). Vào Settings → Branches → `production`.

## 10. SSH vào VPS

```bash
ssh -i ~/.ssh/smartbook_vps deploy@160.250.5.241   # vận hành hằng ngày
ssh -i ~/.ssh/smartbook_vps root@160.250.5.241     # quản trị hệ thống
cd /opt/smartbook
```

- Key `~/.ssh/smartbook_vps` có passphrase. Muốn script hoặc công cụ tự động dùng được key, hãy nạp nó vào ssh-agent một lần (`ssh-add ~/.ssh/smartbook_vps`).
- Đăng nhập SSH bằng mật khẩu đã bị tắt; chỉ chấp nhận key.
- UFW giới hạn **6 kết nối SSH mới trong 30 giây** cho mỗi IP, fail2ban khóa 1 giờ sau 5 lần đăng nhập sai. Nếu gặp `Connection timed out`, chờ khoảng 1 phút rồi thử lại. Không chạy vòng lặp SSH dày đặc; gộp nhiều lệnh vào một phiên `ssh`. Gỡ khóa fail2ban: `fail2ban-client set sshd unbanip <IP>` (chạy bằng root, qua web console).
- Nếu mất key: dùng web console của VPSMMO để đăng nhập và thêm key mới vào `authorized_keys`.

## 11. Logs, trạng thái, restart

```bash
cd /opt/smartbook
deploy/scripts/dc ps                                   # trạng thái + health
deploy/scripts/dc logs -f --tail=200 api-gateway       # log 1 service
deploy/scripts/dc logs --since=30m ai-service
deploy/scripts/dc logs caddy | grep -i error           # lỗi TLS / proxy
deploy/scripts/dc restart borrow-service               # restart 1 service
deploy/scripts/dc up -d                                # áp lại cấu hình (.env, compose)
deploy/scripts/healthcheck.sh --verbose                # kiểm tra tổng thể
cat state/releases.log                                 # lịch sử release
docker stats --no-stream                               # CPU/RAM từng container
```

## 12. Backup và restore

- **Tự động:** cron chạy `backup.sh` lúc 02:30 mỗi ngày (đồng hồ VPS là `Asia/Bangkok`, UTC+7, cùng giờ Việt Nam). Mỗi bản gồm `pg_dump -Fc` của `auth_db`, `inventory_db`, `borrow_db`, `ai_db`, roles Postgres (`globals.sql`), ảnh đóng gói (`packing_evidence.tar.gz`) và `SHA256SUMS`. Bản hằng ngày giữ 14 ngày (`BACKUP_KEEP_DAYS`). Ngoài ra còn có bản trước mỗi deploy (`predeploy`), trước seed và trước restore.
- **Thủ công:** `deploy/scripts/backup.sh --label manual`
- **Thử khôi phục (an toàn, không đụng production):** `deploy/scripts/verify-backup.sh [thư-mục]`. Script restore vào database tạm, so số bảng với database thật rồi xóa database tạm.
- **Khôi phục thật (ghi đè!):**
  ```bash
  deploy/scripts/restore.sh backups/<thư-mục> inventory_db --yes-overwrite-production
  deploy/scripts/restore.sh backups/<thư-mục> all --yes-overwrite-production
  ```
  Script tự backup trạng thái hiện tại trước, dừng các service ghi vào DB, restore, rồi khởi động lại.
- **Ngoài VPS:** Docker volume không phải là backup. Nên cấu hình rclone (Google Drive/S3/…): `apt install rclone`, chạy `rclone config` với user `deploy`, rồi đặt `BACKUP_RCLONE_REMOTE=tên-remote:smartbook-backups` trong `.env`. Hoặc định kỳ tải về máy local: `scp -r deploy@160.250.5.241:/opt/smartbook/backups/<thư-mục> .`

## 13. Rollback

- **Tự động:** `deploy.sh` tự quay về release trước khi healthcheck/smoke test fail.
- **Thủ công qua GitHub:** revert commit lỗi trên `production` rồi push. Cách này nên dùng vì giữ lịch sử git đúng.
- **Thủ công nhanh trên VPS:**
  ```bash
  deploy/scripts/rollback.sh            # về release liền trước
  deploy/scripts/rollback.sh <sha>      # về SHA cụ thể (image phải còn trên VPS, 3 bản gần nhất)
  ```
  Lưu ý: lần push tiếp theo vào `production` sẽ deploy lại theo code trên nhánh.

## 14. Dữ liệu ban đầu

Database mới tinh được tạo từ `db-init/` (4 database, extension `vector`/`pgcrypto`/`citext`/`pg_trgm`/`unaccent`, role `analytics_reader` chỉ đọc). Schema do `prisma migrate deploy` tạo khi service khởi động. `ai-service` tự áp `schema.sql` (idempotent).

Bộ dữ liệu demo được nạp bằng `deploy/scripts/seed-demo.sh --i-understand-demo-passwords`. **Mọi tài khoản demo dùng mật khẩu `123456`** (ví dụ `hung` là ADMIN, `manager01`, `librarian01`, `customer01`, …). Trên site public, hãy đổi mật khẩu các tài khoản này ngay, hoặc khóa những tài khoản không dùng, trong trang Quản lý người dùng.

## 15. Xử lý sự cố

| Triệu chứng | Kiểm tra / xử lý |
|---|---|
| **Lỗi SSL / trình duyệt báo chứng chỉ không hợp lệ** | `dc logs caddy \| grep -i -E "acme\|tls\|error"`. Kiểm tra DNS trỏ đúng IP và cổng 80/443 mở (`ufw status`). Let's Encrypt giới hạn số lần cấp, nên đừng restart Caddy liên tục. Volume `caddy_data` giữ chứng chỉ, không được xóa. |
| **CORS** (console: *blocked by CORS policy*) | Origin của trang phải đúng `https://smartbook.io.vn` (không phải `www`, không phải `http`). Kiểm tra `PUBLIC_WEB_ORIGIN` trong `.env`, sau đó `dc up -d`. Chạy thử: `curl -i -X OPTIONS -H "Origin: https://smartbook.io.vn" -H "Access-Control-Request-Method: POST" https://api.smartbook.io.vn/auth/login` |
| **CSP chặn request** (console: *Refused to connect*) | `connect-src` lấy từ `PUBLIC_API_ORIGIN` / `PUBLIC_API_WS_ORIGIN` (container `web`). |
| **502 Bad Gateway** | Upstream chết hoặc đang khởi động: `dc ps` (xem cột health), `dc logs --tail=100 api-gateway`. Nếu một service unhealthy thì xem log của service đó (thường do DB hoặc RabbitMQ chưa sẵn sàng). |
| **504 / request AI rất chậm** | Tra cứu ISBN/OCR có thể mất 30–45 giây. Xem `dc logs ai-service`, kiểm tra OpenRouter (key, hạn mức, `curl -s https://openrouter.ai/api/v1/models -o /dev/null -w '%{http_code}'`). |
| **`/ready` trả 503** | Một service lõi chưa sẵn sàng. Đăng nhập admin rồi xem `/system/health`, hoặc `dc ps`. |
| **Database** | `dc exec db pg_isready`; `dc logs db`; dung lượng `df -h /` và `dc exec db psql -U smartbook -c "select datname, pg_size_pretty(pg_database_size(datname)) from pg_database"`. Lỗi migration: `dc logs inventory-service \| grep -i prisma`. **Không** dùng `prisma migrate reset` hay `db push` trên production. |
| **Deploy fail trên GitHub** | Mở job lỗi trong Actions. Bước *Pull images and roll out* in kèm `dc ps` và log khi rollback. Trên VPS: `cat state/releases.log`. |
| **Hết RAM** | `docker stats --no-stream`; `free -h`. `ai-service` bị giới hạn 3 GB, Postgres 2 GB. |

Healthcheck tự động ghi vào syslog: `journalctl -t smartbook-health --since today`. Nếu đặt `ALERT_WEBHOOK_URL` (Discord/Slack) thì cảnh báo sẽ được gửi ra ngoài. Nên đăng ký thêm một dịch vụ uptime miễn phí (UptimeRobot, Better Stack, …) theo dõi `https://api.smartbook.io.vn/ready` và `https://smartbook.io.vn`, vì healthcheck chạy ngay trên VPS sẽ không báo được khi chính VPS sập.

## 16. Ứng dụng mobile

App Expo (`apps/mobile`) build và phát hành riêng qua EAS, không đi qua pipeline này. Đặt `EXPO_PUBLIC_API_BASE_URL=https://api.smartbook.io.vn` cho các profile `preview`/`production` (`eas env:create`). `app.config.js` đã chặn build release khi URL rỗng, là placeholder hoặc là localhost. App chỉ gọi HTTPS/WSS và không nhúng secret nào.

## 17. Mở rộng VPS

Phân bổ hiện tại (giới hạn tối đa): Postgres 2 GB/2 CPU, ai-service 3 GB/2 CPU, rabbitmq 768 MB, inventory/borrow 768 MB, các service còn lại 512 MB, web 128 MB, Caddy 256 MB. Tổng khoảng 9 GB trên 12 GB RAM.

- Nâng gói VPS: sau khi reboot, stack tự chạy lại. Tăng `limits` trong `compose.prod.yml` và `shared_buffers` / `effective_cache_size` của Postgres (khoảng 25% / 50–75% RAM), rồi deploy.
- Ổ đĩa: theo dõi `df -h`. Healthcheck cảnh báo khi quá 85%. Dọn image cũ: `docker image prune -f`.
- Khi cần chạy nhiều bản song song hoặc đạt zero-downtime thật sự, phải chuyển sang nhiều replica sau Caddy hoặc dùng orchestrator. Mô hình 1 VPS + Compose hiện tại chưa hỗ trợ.

## 18. Cài đặt lần đầu (đã thực hiện, ghi lại để làm lại khi cần)

```bash
# trên máy local (key quản trị đã có trong /root/.ssh/authorized_keys)
scp deploy/scripts/bootstrap-vps.sh deploy/scripts/harden-ssh.sh ~/.ssh/smartbook_vps.pub ci_key.pub root@160.250.5.241:/root/
ssh root@160.250.5.241 'bash /root/bootstrap-vps.sh /root/smartbook_vps.pub /root/ci_key.pub'
# kiểm tra ở cửa sổ khác: ssh deploy@... và ssh root@... bằng key đều được, rồi mới chạy:
ssh root@160.250.5.241 'bash /root/harden-ssh.sh'
# upload bundle + tạo .env (secret sinh ngẫu nhiên, không in ra)
tar -czf - compose.prod.yml .env.production.example deploy db-init data scripts/*.mjs scripts/lib | ssh deploy@160.250.5.241 'tar -xzf - -C /opt/smartbook'
ssh deploy@160.250.5.241 /opt/smartbook/deploy/scripts/init-env.sh
# điền OPENROUTER_API_KEY ... vào /opt/smartbook/.env, sau đó chạy workflow "Deploy production"
```
