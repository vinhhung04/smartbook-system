# SmartBook System

Tài liệu onboarding nhanh cho toàn bộ hệ thống SmartBook.

---

## 📖 Tài liệu chính

- **[Chạy Docker (Chi tiết)](docs/RUN_WITH_DOCKER.md)** ← Hướng dẫn đầy đủ với troubleshooting
- **[Architecture Overview](docs/PROJECT_OVERVIEW.md)** ← Thiết kế tổng quan

---

## 🚀 Khởi động nhanh (máy mới pull về)

### 1️⃣ Chuẩn bị ban đầu

```bash
# Clone repo
git clone https://github.com/your-org/smartbook-system.git
cd smartbook-system

# Tạo .env từ template (nếu chưa có)
cp .env.example .env  # Linux/macOS
# hoặc: copy .env.example .env  # Windows CMD
```

### 2️⃣ Windows: chạy tự động 1 lệnh

```cmd
scripts\run-all.bat
```

Script sẽ tự làm:
- Kiểm tra môi trường (`check-env.bat`)
- Cài workspace dependencies (`pnpm install`)
- Kiểm tra Docker + Docker Compose
- Tạo `.env` nếu chưa có
- `docker compose up -d --build`
- Chạy db setup jobs (`auth-db-push`, `inventory-db-push`, `borrow-db-push`)
- In trạng thái service + health check nhanh

### 3️⃣ Linux/macOS: chạy bằng Docker Compose

```bash
docker compose up -d --build
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push
docker compose --profile dev run --rm borrow-db-push
```

### 4️⃣ Truy cập ứng dụng

Sau khi script/chạy compose xong:
- Web UI: http://localhost:5173
- API Gateway: http://localhost:3000
- AI Service: http://localhost:8000
- pgAdmin: http://localhost:8080
- Ollama: http://localhost:11434

---

## ⚡ Script tự động (Windows)

### `scripts\check-env.bat`
- Kiểm tra: Node.js, npm, pnpm, Docker, Docker Compose
- Non-interactive: trả mã lỗi nếu thiếu tool

### `scripts\bootstrap-workspace.bat`
- Cài pnpm (nếu thiếu) + `pnpm install` cho monorepo
- Có thể chain Docker bootstrap:

```cmd
scripts\bootstrap-workspace.bat --with-docker
```

### `scripts\bootstrap.bat`
- Script chính để máy mới pull về chạy được ngay
- Không cần pause/manual step

### `scripts\run-all.bat`
- Entrypoint duy nhất cho máy mới pull về
- Chạy tuần tự: check-env -> bootstrap-workspace -> bootstrap

```cmd
scripts\run-all.bat
```

Tùy chọn (nâng cao):
```cmd
scripts\run-all.bat --skip-workspace
scripts\run-all.bat --skip-docker
```

---

## 📦 Thành phần chính

| Component | Công nghệ | Chức năng |
|-----------|-----------|---------|
| **Web UI** (`apps/web`) | React + Vite | Frontend chính |
| **API Gateway** (`apps/api-gateway`) | Express | Reverse proxy, định tuyến |
| **Auth Service** | Node.js + Prisma | Xác thực, JWT, IAM |
| **Inventory Service** | Node.js + Prisma | Quản lý sách, kho |
| **AI Service** | FastAPI + Ollama | OCR, tóm tắt AI |
| **PostgreSQL** | DB | Lưu trữ dữ liệu |
| **Ollama** | AI Models | Local LLM runtime |

## 🔧 Các lệnh thường dùng

```bash
# Khởi động toàn bộ stack
docker compose up -d --build

# Dừng toàn bộ
docker compose down

# Xem logs
docker compose logs -f

# Kiểm tra trạng thái
docker compose ps

# Reset (xóa dữ liệu)
docker compose down -v

# DB setup jobs
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push
docker compose --profile dev run --rm borrow-db-push
```

### 🛠️ Windows Scripts

| Script | Mục đích |
|--------|---------|
| `run-all.bat` | Entrypoint 1 lệnh setup + run toàn bộ |
| `bootstrap.bat` | 1 lệnh tự động khởi động toàn hệ thống |
| `bootstrap-workspace.bat` | Cài đặt workspace dependencies |
| `check-env.bat` | Kiểm tra công cụ yêu cầu |

**Makefile (Linux/macOS)**:
```bash
make setup        # Bootstrap tự động
make up           # Khởi động
make down         # Dừng
make logs         # Xem logs
make status       # Trạng thái
```

## 🎯 Các port quan trọng

| Port | Service | URL |
|------|---------|-----|
| 3000 | API Gateway | http://localhost:3000 |
| 5173 | Web UI | http://localhost:5173 |
| 8000 | AI Service | http://localhost:8000 |
| 5432 | PostgreSQL | localhost:5432 |
| 8080 | pgAdmin | http://localhost:8080 |
| 11434 | Ollama | http://localhost:11434 |

---

## 📚 Tài liệu module

- [apps/web/README.md](apps/web/README.md) - Frontend
- [services/inventory-service/README.md](services/inventory-service/README.md) - Inventory
- [services/ai-service/README.md](services/ai-service/README.md) - AI/Ollama

---

## 🆘 Gặp vấn đề?

→ Xem **[docs/RUN_WITH_DOCKER.md](docs/RUN_WITH_DOCKER.md)** phần "Lỗi thường gặp" để biết cách fix

Các lỗi phổ biến:
- ❌ Docker daemon not running → Mở Docker Desktop
- ❌ Port already in use → `docker compose down` rồi chạy lại
- ❌ Missing `.env` → `cp .env.example .env`
- ❌ DB not ready → chạy lại 3 lệnh `*-db-push` và kiểm tra `docker compose ps`

---

## 📝 Ghi chú

- **`.env` file**: Không track trên git (credential/secret). Template: `.env.example`
- **Architecture**: Xem [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)

---

**Happy coding! 🎉**
