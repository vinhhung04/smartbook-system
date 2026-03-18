# Hướng dẫn chạy SmartBook bằng Docker

## Mục tiêu

- **Tài liệu này dành cho**: Nhà phát triển mới clone/pull repo từ GitHub và muốn chạy toàn bộ hệ thống trong Docker một cách nhanh chóng
- **Sau khi làm xong bạn sẽ chạy được**:
  - ✅ Web UI (http://localhost:5173)
  - ✅ API Gateway (http://localhost:3000)
  - ✅ Auth Service (JWT, đăng nhập)
  - ✅ Inventory Service (quản lý sách/kho)
  - ✅ AI Service + Ollama (OCR, tóm tắt)
  - ✅ PostgreSQL + pgAdmin UI
  - ✅ Tất cả service liên kết với nhau qua Docker network

---

## Yêu cầu cài đặt trước

### Bắt buộc:
- **Docker Desktop** (v20.10+) hoặc Docker Engine + Docker Compose
  - [Cài đặt Docker](https://docs.docker.com/get-docker/)
  - Kiểm tra: `docker --version` và `docker compose version`
- **Git** (v2.20+)
  - Kiểm tra: `git --version`
- **RAM tối thiểu**: 4 GB (khuyến nghị 8 GB)
- **Disk space**: 5-10 GB cho images + volumes

### Tuỳ chọn:
- **curl hoặc wget**: Để script bootstrap kiểm tra health endpoint (nếu không có sẽ bỏ qua)
- **JQ**: Để parse JSON trong logs (không bắt buộc)

### Có sẵn trong repo:
- `docker-compose.yml` - Định nghĩa stack
- `.env.example` - Template biến môi trường (`.env` thực tế được ignore trong `.gitignore`)
- `scripts/bootstrap.sh` - Script tự động (Linux/macOS)
- `scripts/bootstrap.ps1` - Script tự động (Windows)
- `scripts/check-env.sh` - Kiểm tra môi trường
- `Makefile` - Development commands (Linux/macOS)
- `ollama_data/.gitkeep` - Đảm bảo thư mục Ollama được tracked khi contents ignore

---

## Lưu ý về Git & .env

**`.env` không được track bởi git** (xem `.gitignore`):
```
.env         ← Ignored (credential, secret)
.env.example ← Tracked (template)
```

**Workflow**:
1. Nhà phát triển clone repo → nhận `.env.example`
2. Copy `.env.example` → `.env`
3. Edit `.env` với các value cụ thể cho máy mình
4. `.env` được sửa cục bộ, không bao giờ push lên git

**Nếu cần share `.env.example` mới**: 
```bash
# Cập nhật template (commit nó)
git add .env.example
git commit -m "Update .env.example template"

# Sẽ tự động được pull khi nhà phát triển fetch
```

---

## Bước 1: Clone project

```bash
git clone https://github.com/your-org/smartbook-system.git
cd smartbook-system
```

Nếu cần branch cụ thể:
```bash
git checkout develop  # hoặc branch bạn cần
```

---

## Bước 2: Chuẩn bị môi trường

### 2.1. Kiểm tra/Tạo file `.env`

File `.env` chứa tất cả biến môi trường cho Docker stack. **File này được ignore trong git** (xem `.gitignore`), vì chứa secret/credential.

Repo cung cấp template `.env.example`. Bạn cần copy nó thành `.env`:

```bash
# Linux/macOS
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env

# Windows (Command Prompt)
xcopy .env.example .env
```

**⚠️ Quan trọng**: 
- Không bao giờ commit `.env` lên git (đã có trong `.gitignore`)
- Nếu git cho phép commit `.env`, có lỗi cấu hình
- **Script bootstrap tự động sẽ copy** `.env.example` → `.env` nếu `.env` chưa tồn tại

### 2.2. Kiểm tra/Cập nhật biến môi trường trong `.env`

Mở `.env` và kiểm tra các biến **bắt buộc**:

```env
# ===== DATABASE =====
POSTGRES_USER=user              # Default: user
POSTGRES_PASSWORD=password      # ⚠️ ĐỔI thành mật khẩu mạnh trong thực tế!
POSTGRES_DB=inventory
DB_HOST=db                       # Không đổi (hostname của container PostgreSQL)
DB_PORT=5432                     # Không đổi (port trong container)
DB_USER=user                     # Phải match với POSTGRES_USER
DB_PASSWORD=password             # Phải match với POSTGRES_PASSWORD
AUTH_DB_NAME=auth_db             # Tên database cho auth-service
INVENTORY_DB_NAME=inventory_db   # Tên database cho inventory-service

# ===== JWT =====
JWT_SECRET=smartbook_shared_jwt_secret  # ⚠️ ĐỔI thành chuỗi bí mật ngẫu nhiên!
                                        # Gợi ý: openssl rand -base64 32

# ===== pgAdmin (quản lý DB) =====
PGADMIN_DEFAULT_EMAIL=admin@admin.com       # Email đăng nhập pgAdmin
PGADMIN_DEFAULT_PASSWORD=admin              # Mật khẩu pgAdmin

# ===== Frontend (tuỳ chọn) =====
VITE_API_BASE_URL=http://localhost:3000     # Đường dẫn API Gateway (trỏ tới gateway)
VITE_AUTH_BASE_URL=http://localhost:3000    # Trỏ tới gateway (gateway định tuyến)
VITE_AI_BASE_URL=http://localhost:8000      # AI Service URL (hoặc qua gateway)

# ===== AI Service (tuỳ chọn) =====
SUMMARY_MODEL=llama3  # Model Ollama để dùng (phải tải sẵn trong Ollama)
```

**Các trường quan trọng**:
- Phải match: `DB_USER` = `POSTGRES_USER`
- Phải match: `DB_PASSWORD` = `POSTGRES_PASSWORD`
- `DB_HOST=db` là hostname của PostgreSQL container (cố định)
- `JWT_SECRET` nên thay đổi cho môi trường production

Ví dụ tạo JWT_SECRET an toàn (Linux/macOS):
```bash
openssl rand -base64 32
# Output: aBc1DefGhIjKlmnOpQrStUvWxYz1234567890==
# Copy vào JWT_SECRET=
```

---

## Bước 3: Khởi động nhanh (1 lệnh duy nhất)

### Tùy chọn A: Linux / macOS

```bash
bash scripts/bootstrap.sh
```

Script này sẽ:
1. ✅ Kiểm tra Docker daemon đang chạy
2. ✅ Kiểm tra/tạo `.env` nếu cần
3. ✅ Xác thực biến môi trường bắt buộc
4. ✅ Chạy `docker compose up -d --build`
5. ✅ Chờ 15 giây để service lên
6. ✅ Chạy Prisma db push (migration)
7. ✅ Kiểm tra health endpoint
8. ✅ In ra danh sách URL local

**Thời gian chạy**: 3-5 phút lần đầu (tùy tốc độ internet với Ollama)

### Tùy chọn B: Windows (PowerShell)

```powershell
.\scripts\bootstrap.ps1
```

**Chú ý**: Nếu gặp lỗi `cannot be loaded because running scripts is disabled`, chạy:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Rồi chạy lại:
```powershell
.\scripts\bootstrap.ps1
```

### Tùy chọn C: Chạy thủ công (nếu script gặp vấn đề)

```bash
# Kiểm tra môi trường
bash scripts/check-env.sh

# Khởi động stack
docker compose up -d --build

# Chờ 15 giây
sleep 15

# Chạy migration (một lần)
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push

# Kiểm tra status
docker compose ps
```

---

## Bước 4: Xác nhận hệ thống chạy thành công

### 4.1. Kiểm tra container

```bash
docker compose ps
```

Tất cả container phải có status `Up`:
```
NAME              STATUS         PORTS
smartbook_postgres    Up (healthy)   5432/tcp
smartbook_pgadmin     Up             0.0.0.0:8080->80/tcp
auth-service          Up             0.0.0.0:3004->3002/tcp
inventory-service     Up             0.0.0.0:3003->3001/tcp
ai-service            Up             0.0.0.0:8000->8000/tcp
api-gateway           Up             0.0.0.0:3000->3000/tcp
smartbook-ui          Up             0.0.0.0:5173->5173/tcp
ollama                Up             0.0.0.0:11434->11434/tcp
```

### 4.2. Kiểm tra endpoint nhanh

Mở trình duyệt hoặc terminal:

| Service | URL Test | Kỳ vọng |
|---------|----------|--------|
| **Web UI** | http://localhost:5173 | Trang web hiển thị |
| **API Gateway** | http://localhost:3000/health | `{ "status": "ok" }` hoặc tương tự |
| **Auth Service** | http://localhost:3004/health | HTTP 200 OK |
| **AI Service** | http://localhost:8000/health | HTTP 200 OK |
| **pgAdmin** | http://localhost:8080 | Giao diện login pgAdmin |
| **Ollama** | http://localhost:11434/api/tags | JSON danh sách model |
| **PostgreSQL** | `localhost:5432` | Ping TCP |

Kiểm tra bằng curl:
```bash
curl -s http://localhost:3000/health | jq .
curl -s http://localhost:8000/health | jq .
curl -s http://localhost:11434/api/tags | jq .
```

### 4.3. Xem logs

```bash
# Tất cả service
docker compose logs -f --tail 100

# Một service cụ thể
docker compose logs -f api-gateway
docker compose logs -f auth-service
docker compose logs -f ai-service
```

---

## Các service sẽ chạy

| Service | Chức năng | Port Local | URL Test | Phụ thuộc | Ready Check |
|---------|----------|-----------|----------|-----------|------------|
| **db** | PostgreSQL 15 | 5432 | `localhost:5432` | volume `postgres_data`, `./db-init/` | Container up |
| **pgadmin** | UI quản lý DB | 8080→80 | http://localhost:8080 | `db` | HTTP 200 |
| **auth-service** | Xác thực, JWT, IAM | 3004→3002 | http://localhost:3004/health | `db` | `/health` OK |
| **inventory-service** | Quản lý sách, kho | 3003→3001 | Via gateway `/api/inventory/*` | `db` | Container up |
| **ai-service** | OCR, tóm tắt AI | 8000 | http://localhost:8000/health | `ollama` | `/health` OK |
| **api-gateway** | Reverse proxy, định tuyến | 3000 | http://localhost:3000/health | `auth-service`, `inventory-service`, `ai-service` | `/health` OK |
| **smartbook-ui** | Frontend React/Vue | 5173 | http://localhost:5173 | `api-gateway` | Trang web load |
| **ollama** | AI Model runtime | 11434 | http://localhost:11434 | `./ollama_data/` volume | Container up |
| **auth-db-push** | Prisma migration (auth) | — | Chạy 1 lần | `db` | Exit code 0 |
| **inventory-db-push** | Prisma migration (inventory) | — | Chạy 1 lần | `db` | Exit code 0 |

**Service bắt buộc**: `db`, `auth-service`, `inventory-service`, `ai-service`, `api-gateway`, `smartbook-ui`, `ollama`  
**Service tuỳ chọn**: `pgadmin` (quản lý DB UI)

---

## Các lệnh thường dùng

### Quản lý stack

```bash
# Khởi động (nền)
docker compose up -d --build

# Dừng tất cả
docker compose down

# Dừng + xóa volumes (reset dữ liệu)
docker compose down -v

# Xem status
docker compose ps

# Xem logs (tất cả)
docker compose logs -f --tail 200

# Xem logs (một service)
docker compose logs -f api-gateway

# Restart một service
docker compose restart api-gateway

# Rebuild một service
docker compose up -d --build api-gateway
```

### Migration / Seeding

```bash
# Chạy Prisma db push (auth)
docker compose --profile dev run --rm auth-db-push

# Chạy Prisma db push (inventory)
docker compose --profile dev run --rm inventory-db-push

# Login vào container shell (debug)
docker compose exec auth-service bash
docker compose exec db psql -U user -d auth_db
```

### Debug & Cleanup

```bash
# Xem resource sử dụng
docker stats

# Remove tất cả unused images/volumes/networks
docker system prune -a --volumes

# Reset toàn bộ (xóa images + rebuild)
docker compose down -v
docker rmi $(docker images | grep smartbook | awk '{print $3}')
docker compose build --no-cache
docker compose up -d
```

---

## Lỗi thường gặp và cách xử lý

### ❌ "Docker daemon is not running"

**Nguyên nhân**: Docker Desktop chưa mở hoặc Docker service chưa start

**Cách xử lý**:
- **Windows/macOS**: Mở Docker Desktop, chờ tới status `Docker is running`
- **Linux**: `sudo systemctl start docker`
- **Kiểm tra**: `docker info` phải chạy không lỗi

---

### ❌ "Port 3000 is already allocated"

**Nguyên nhân**: Port bị service khác chiếm (thường là SmartBook cũ hoặc ứng dụng khác)

**Cách xử lý**:
```bash
# Tìm container chiếm port
docker ps -a | grep 3000

# Tìm process chiếm port (Linux/macOS)
sudo lsof -i :3000
sudo lsof -i :5173
sudo lsof -i :5432

# Windows (PowerShell)
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess

# Tắt container cũ
docker compose down

# Hoặc thay đổi port trong docker-compose.yml
# Thay "3000:3000" thành "3001:3000"
```

---

### ❌ ".env file not found" hoặc "missing POSTGRES_USER"

**Nguyên nhân**: File `.env` chưa được tạo hoặc biến môi trường chưa được điền

**Cách xử lý**:
```bash
# Tạo từ template
cp .env.example .env

# Hoặc chạy script kiểm tra
bash scripts/check-env.sh

# Script tự động sẽ copy nếu cần và kiểm tra biến
```

Nếu vẫn lỗi, mở `.env` bằng editor:
```env
POSTGRES_USER=user  # Không để trống!
POSTGRES_PASSWORD=password  # Không để trống!
```

---

### ❌ "Database connection refused: ECONNREFUSED 127.0.0.1:5432"

**Nguyên nhân**: PostgreSQL container chưa lên hoặc chưa ready

**Cách xử lý**:
```bash
# Kiểm tra db container status
docker compose ps db

# Xem logs
docker compose logs db

# Chờ 10-30 giây rồi kiểm tra
docker compose exec db psql -U user -c "SELECT 1"

# Nếu vẫn lỗi, reset DB
docker compose down -v
docker compose up -d db
sleep 10
docker compose up -d
```

---

### ❌ "auth-service exited with code 1"

**Nguyên nhân**: Thường là Prisma migration fail, hoặc DB không sẵn sàng

**Cách xử lý**:
```bash
# Xem logs chi tiết
docker compose logs auth-service

# Nếu lỗi Prisma:
# 1. Chờ DB ready
docker compose logs db | tail -20

# 2. Chạy migration thủ công
docker compose --profile dev run --rm auth-db-push

# 3. Restart service
docker compose restart auth-service
```

---

### ❌ "ollama: image not found" hoặc timeout tải Ollama

**Nguyên nhân**: Image Ollama chưa tải, hoặc network chậm

**Cách xử lý**:
```bash
# Tải image trước
docker pull ollama/ollama

# Hoặc restart
docker compose down
docker compose pull
docker compose up -d

# Kiểm tra Ollama status
docker compose logs ollama
```

**Chú ý**: Lần đầu tải Ollama + model (llama3) mất ~5-10 phút tuỳ internet

---

### ❌ "ai-service can't connect to ollama:11434"

**Nguyên nhân**: ai-service và ollama chưa trên cùng Docker network, hoặc ollama chưa ready

**Cách xử lý**:
```bash
# Kiểm tra network
docker network ls
docker compose ps

# Kiểm tra ollama ready
curl -s http://localhost:11434/api/tags

# Nếu ollama chưa sẵn model, tạo request để tải:
curl -X POST http://localhost:11434/api/pull -d '{"name": "llama3"}'

# Sau đó restart ai-service
docker compose restart ai-service
```

---

### ❌ "SUMMARY_MODEL llama3 not found" trong AI Service

**Nguyên nhân**: Model Ollama chưa được tải

**Cách xử lý**:
```bash
# Liệt kê models sẵn có
curl -s http://localhost:11434/api/tags | jq .models

# Tải model (mất 3-10 phút)
curl -X POST http://localhost:11434/api/pull -d '{"name": "llama3"}'

# Hoặc SSH vào ollama container
docker compose exec ollama ollama pull llama3

# Kiểm tra
curl -s http://localhost:11434/api/tags | jq .
```

---

### ❌ "healthcheck: up but unhealthy"

**Nguyên nhân**: Service chạy nhưng health check fail

**Cách xử lý**:
```bash
# Xem health logs
docker compose ps  # kiểm tra "(unhealthy)"

docker compose logs api-gateway  # tìm lỗi

# Thử restart
docker compose restart api-gateway

# Hoặc rebuild
docker compose up -d --build api-gateway
```

---

### ❌ "prisma db push: relation 'public.user' already exists"

**Nguyên nhân**: Schema đã tồn tại từ lần trước, hoặc data lỗi

**Cách xử lý**:
```bash
# Cách 1: Reset DB (xóa hết dữ liệu)
docker compose down -v
docker compose up -d

# Cách 2: Chạy lại migration với accept-data-loss
docker compose --profile dev run --rm inventory-db-push

# Cách 3: Manual reset toàn bộ
docker compose exec db psql -U user -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push
```

---

### ❌ "Volume permission denied" (Linux)

**Nguyên nhân**: Volume Docker chạy với user khác

**Cách xử lý**:
```bash
# Fix ownership
sudo chown -R $USER:$USER ./ollama_data

# Hoặc chạy Docker với sudo (không khuyến nghị)
sudo docker compose up -d
```

---

## Quy trình Bootstrap tự động

Script `scripts/bootstrap.sh` thực hiện các bước sau:

```bash
1. Kiểm tra Docker
   ├─ Kiểm tra `docker` command có
   └─ Kiểm tra Docker daemon chạy

2. Chuẩn bị môi trường
   ├─ Kiểm tra `.env` có tồn tại
   ├─ Nếu không → Copy từ `.env.example`
   ├─ Kiểm tra biến bắt buộc
   ├─ Kiểm tra docker-compose.yml có
   └─ Cảnh báo thiếu db-init/

3. Khởi động Stack
   ├─ Chạy `docker compose up -d --build`
   └─ Chờ 15 giây

4. Migration
   ├─ Chạy `auth-db-push` (Prisma db push)
   └─ Chạy `inventory-db-push`

5. Health Check
   ├─ Ping http://localhost:3000/health
   ├─ Ping http://localhost:3004/health
   ├─ Ping http://localhost:8000/health
   └─ In kết quả

6. Output
   ├─ In danh sách URL local
   ├─ In danh sách lệnh thường dùng
   └─ Hoàn tất
```

Script cũng hỗ trợ chạy lại từng bước để debug.

---

## Kiểm tra sau khi chạy

### 1. Container Status

```bash
docker compose ps

# ✅ Tất cả phải "Up" (hoặc "Up (healthy)")
# ❌ Nếu có "Exited" → xem logs: docker compose logs <service>
```

### 2. Endpoint Test

```bash
# Test API Gateway
curl -s http://localhost:3000/health

# Test Auth
curl -s http://localhost:3004/health

# Test AI
curl -s http://localhost:8000/health

# Test Ollama
curl -s http://localhost:11434/api/tags

# Test Web
curl -s http://localhost:5173 | head -5
```

### 3. Database Check

```bash
# Connect psql
docker compose exec db psql -U user -d inventory_db -c "SELECT count(*) FROM information_schema.tables;"

# Check pgAdmin
# Vào http://localhost:8080
# Email: admin@admin.com (từ .env)
# Mật khẩu: admin (từ .env)
```

### 4. Logs

```bash
# Tail logs real-time
docker compose logs -f --tail 50

# Xem một service
docker compose logs ai-service --tail 20
```

---

## Dọn dẹp và chạy lại từ đầu

### Scenario 1: Dừng nhưng giữ dữ liệu

```bash
docker compose down
# Volumes và dữ liệu vẫn giữ lại

# Chạy lại bình thường
docker compose up -d
```

### Scenario 2: Reset toàn bộ (xóa dữ liệu)

```bash
docker compose down -v
# Xóa hết containers + volumes + dữ liệu

# Build lại
docker compose build
docker compose up -d

# Chạy migration
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push
```

### Scenario 3: Clean images (nếu update Dockerfile)

```bash
docker compose down
docker rmi $(docker images | grep "smartbook\|api-gateway\|auth-service\|inventory-service\|ai-service" | awk '{print $3}')

# Build từ đầu
docker compose build --no-cache
docker compose up -d --build
```

---

## Ghi chú cho developer mới

### 📚 Nên đọc trước:

1. **Architecture Overview**: `docs/PROJECT_OVERVIEW.md`
2. **Docker Stack**: `docker-compose.yml` (8 service chính)
3. **Service Detail**:
   - `services/inventory-service/README.md` - Business logic
   - `services/ai-service/README.md` - AI/Ollama integration
   - `apps/api-gateway/` - Request routing
   - `apps/web/` - Frontend (React/Vue)

### 🎯 Các port quan trọng:

| Port | Service | Local Test |
|------|---------|-----------|
| 3000 | API Gateway | http://localhost:3000 |
| 3002 | Auth Service | (Internal) |
| 3001 | Inventory Service | (Internal) |
| 5173 | Web UI | http://localhost:5173 |
| 8000 | AI Service | http://localhost:8000 |
| 5432 | PostgreSQL | localhost:5432 |
| 8080 | pgAdmin | http://localhost:8080 |
| 11434 | Ollama | http://localhost:11434 |

### ⚙️ Config quan trọng:

- `.env` - Tất cả biến môi trường
- `docker-compose.yml` - Định nghĩa service
- `services/auth-service/prisma/schema.prisma` - Auth DB schema
- `services/inventory-service/prisma/schema.prisma` - Inventory DB schema
- `apps/web/vite.config.ts` - Frontend config
- `apps/api-gateway/src/index.js` - Gateway routing

### ⚠️ Chỗ dễ nhầm:

1. **DB Credentials**: Phải match `POSTGRES_USER`, `DB_USER`
2. **DB Names**: `AUTH_DB_NAME` ≠ `INVENTORY_DB_NAME` (2 database riêng)
3. **Network**: Service trong container gọi nhau bằng hostname (`auth-service`, `db`)
4. **Ports**: Container port ≠ Local port (e.g., `3004:3002` = port 3002 trong container, 3004 local)
5. **Ollama Model**: Phải tải sẵn model trước dùng AI Service
6. **JWT Secret**: Phải cùng một giá trị cho tất cả service dùng JWT

### 🔧 Debug Tips:

```bash
# 1. Xem environment variable trong container
docker compose exec api-gateway env | grep -i api

# 2. Test network connectivity
docker compose exec api-gateway ping auth-service
docker compose exec auth-service ping db

# 3. Check port
docker compose exec api-gateway curl http://localhost:3000/health

# 4. View real-time metrics
docker stats

# 5. Shell vào container
docker compose exec api-gateway sh
docker compose exec db bash
```

---

## Hỗ trợ thêm

- Gặp vấn đề? Xem phần "Lỗi thường gặp" ở trên
- Cần debug chi tiết? Chạy `docker compose logs -f` để xem logs real-time
- Cần reset? Chạy `docker compose down -v && docker compose up -d`

**Happy coding! 🚀**
5. Kiem tra nhanh endpoint:
   - `http://localhost:3000/health`
   - `http://localhost:3004/health`
   - `http://localhost:8000/health`
6. In danh sach URL va lenh van hanh co ban

# Cac service se chay

| Service | Chuc nang | Port local | URL test nhanh | Phu thuoc | Ready condition |
|---|---|---:|---|---|---|
| db | PostgreSQL chinh | 5432 | ket noi TCP `localhost:5432` | volume `postgres_data`, `db-init` | Container running |
| pgadmin | Quan tri Postgres | 8080 -> 80 | http://localhost:8080 | db | Container running |
| auth-service | Dang nhap, JWT, IAM | 3004 -> 3002 | http://localhost:3004/health | db | `/health` tra ve ok |
| inventory-service | Nghiep vu kho/sach | 3003 -> 3001 | test qua gateway `/api/*` | db, JWT tu auth | Khong co `/health` rieng trong source hien tai |
| ai-service | OCR/summary | 8000 | http://localhost:8000/health | ollama | `/health` tra ve model/host |
| api-gateway | Reverse proxy tap trung | 3000 | http://localhost:3000/health | auth-service, inventory-service, ai-service | `/health` tra ve target |
| smartbook-ui | Frontend chinh | 5173 | http://localhost:5173 | api-gateway, auth-service, inventory-service | Mo duoc trang web |
| ollama | Model runtime cho AI | 11434 | http://localhost:11434 | volume `./ollama_data` | Container running |
| auth-db-push (profile dev) | Prisma db push auth | - | chay 1 lan theo lenh | db | Exit code 0 |
| inventory-db-push (profile dev) | Prisma db push inventory | - | chay 1 lan theo lenh | db | Exit code 0 |

Service bat buoc de full stack chay:
- db, auth-service, inventory-service, ai-service, api-gateway, smartbook-ui, ollama

Service tuy chon:
- pgadmin
- auth-db-push, inventory-db-push (chay theo profile `dev`, phuc vu migration/db push)

# Kiem tra sau khi chay

## 1) Kiem tra container

```bash
docker compose ps
```

## 2) Kiem tra endpoint nhanh

- Web: http://localhost:5173
- Gateway health: http://localhost:3000/health
- Auth health: http://localhost:3004/health
- AI health: http://localhost:8000/health
- pgAdmin: http://localhost:8080

## 3) Xem logs

```bash
docker compose logs -f --tail 200
```

## 4) Restart 1 service

```bash
docker compose restart api-gateway
```

## 5) Rebuild 1 service

```bash
docker compose up -d --build api-gateway
```

# Cac lenh thuong dung

```bash
# Up full stack
docker compose up -d --build

# Down stack
docker compose down

# Restart 1 service
docker compose restart <service>

# Logs
docker compose logs -f --tail 200
docker compose logs -f --tail 200 <service>

# Rebuild 1 service
docker compose up -d --build <service>

# Migration/db push
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push

# Seed thu cong (neu can)
# Vi du import SQL mau vao inventory_db:
docker exec -i smartbook_postgres psql -U user -d inventory_db < "Tai Lieu/smartbook_sample_seed.sql"

# Kiem tra env/compose
bash scripts/check-env.sh

# Bootstrap auto
bash scripts/bootstrap.sh
```

# Loi thuong gap va cach xu ly

## 1) Thieu `.env`

Dau hieu:
- Compose loi bien moi truong rong

Xu ly:
```bash
cp .env.example .env
# Sau do sua gia tri can thiet
```
Hoac:
```bash
bash scripts/check-env.sh
```

## 2) Port bi trung

Dau hieu:
- `Bind for 0.0.0.0:<port> failed`

Xu ly:
- Dung process dang chiem port
- Hoac doi port mapping trong `docker-compose.yml`

## 3) Container restart lien tuc

Dau hieu:
- `docker compose ps` thay trang thai restart

Xu ly:
```bash
docker compose logs --tail 200 <service>
```
- Kiem tra bien env lien quan service do
- Kiem tra ket noi DB host phai la `db` trong compose

## 4) DB chua ready

Dau hieu:
- Service backend bao loi ket noi Postgres luc khoi dong

Xu ly:
- Cho them 10-20 giay roi retry
- Chay lai migration:
```bash
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push
```

## 5) Migration fail

Dau hieu:
- Lenh `auth-db-push` hoac `inventory-db-push` exit code != 0

Xu ly:
- Kiem tra logs cua lenh push
- Kiem tra lai `DATABASE_URL` tu `.env`
- Neu can reset DB volume, xem muc "Don dep va chay lai tu dau"

## 6) Volume cu gay loi schema/data

Xu ly:
```bash
docker compose down -v
docker compose up -d --build
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push
```

## 7) Image build fail

Xu ly:
```bash
docker compose build --no-cache
```
- Kiem tra mang internet va registry access

## 8) Thieu docker network/volume

Ghi chu:
- Compose se tu tao network mac dinh va volume `postgres_data` neu chua co.
- Neu bi loi metadata cu, dung `docker compose down -v` roi up lai.

## 9) Gateway len nhung backend chua len

Dau hieu:
- Gateway `/health` ok nhung goi `/auth` hoac `/api` loi 502/504

Xu ly:
```bash
docker compose ps
docker compose logs -f --tail 200 auth-service inventory-service ai-service
```
- Dam bao auth/inventory/ai da ready truoc khi test qua gateway

## 10) Service goi sai hostname trong Docker network

Nguyen tac:
- Trong compose, service-to-service phai goi bang ten service (`db`, `auth-service`, ...)
- Khong dung `localhost` de goi service khac tu ben trong container

# Don dep va chay lai tu dau

```bash
# Dung container
docker compose down

# Dung va xoa ca volume (mat du lieu local)
docker compose down -v

# Build lai sach
docker compose build --no-cache
docker compose up -d --build

# Chay lai migration
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push
```

# Ghi chu cho developer moi

- Nen doc truoc:
  - `docs/PROJECT_OVERVIEW.md`
  - `docker-compose.yml`
- Cac config quan trong:
  - `.env`
  - `services/auth-service/prisma/schema.prisma`
  - `services/inventory-service/prisma/schema.prisma`
  - `db-init/01-extensions.sql`
- Cho de nham trong local env:
  - Repo co `smartbook-backend/docker-compose.yml` (legacy/reference), khong phai stack chinh dang dung.
  - Frontend chuan la `apps/web`; `smartbook-ui` folder o root da duoc danh dau archived/reference.
  - `inventory-service` hien tai khong co endpoint `/health` rieng.

# Cach chay ngan nhat

```bash
bash scripts/bootstrap.sh
```

# Nhung gi van can dien tay

- Ban can tu dien gia tri thuc te trong `.env` neu khong muon dung gia tri mac dinh template:
  - `POSTGRES_PASSWORD`
  - `JWT_SECRET`
  - `PGADMIN_DEFAULT_EMAIL`
  - `PGADMIN_DEFAULT_PASSWORD`
  - Neu can: `SUMMARY_MODEL`
