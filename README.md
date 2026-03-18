# SmartBook System

Tài liệu onboarding nhanh cho toàn bộ hệ thống SmartBook 🚀

---

## 📖 Tài liệu chính

- **[Chạy Docker (Chi tiết)](docs/RUN_WITH_DOCKER.md)** ← Hướng dẫn đầy đủ với troubleshooting
- **[Architecture Overview](docs/PROJECT_OVERVIEW.md)** ← Thiết kế tổng quan

---

## 🚀 Khởi động nhanh (1-2 phút)

### 1️⃣ Chuẩn bị ban đầu

```bash
# Clone repo
git clone https://github.com/your-org/smartbook-system.git
cd smartbook-system

# Tạo .env từ template
cp .env.example .env  # (Linux/macOS)
# hoặc copy .env.example .env  (Windows)
```

### 2️⃣ Chạy Scripts (Windows Batch)

```cmd
REM Kiểm tra môi trường (tùy chọn)
scripts\check-env.bat

REM Cài đặt workspace dependencies
scripts\bootstrap-workspace.bat

REM Khởi động hệ thống (Docker + services)
scripts\bootstrap.bat
```

### 3️⃣ Truy cập ứng dụng

Script sẽ hiển thị các URL sau khi khởi động:
- 🌐 **Web UI**: http://localhost:5173
- 🔌 **API Gateway**: http://localhost:3000
- 🗄️ **pgAdmin**: http://localhost:8080
- 🤖 **Ollama**: http://localhost:11434

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

---

## 🔧 Các lệnh thường dùng

### 🐳 Docker Commands

```bash
# Khởi động toàn bộ
docker compose up -d --build

# Dừng toàn bộ
docker compose down

# Xem logs
docker compose logs -f

# Kiểm tra trạng thái
docker compose ps

# Reset (xóa dữ liệu)
docker compose down -v

# Chạy migration
docker compose --profile dev run --rm auth-service pnpm db:push
docker compose --profile dev run --rm inventory-service pnpm db:push
```

### 🛠️ Windows Batch Scripts

| Script | Mục đích |
|--------|---------|
| `bootstrap.bat` | Khởi động Docker stack + services |
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

---

## 📜 Hướng dẫn sử dụng Windows Batch Scripts

### ✅ Bước 1: Kiểm tra môi trường

Trước khi khởi động, hãy chắc chắn bạn đã cài đặt:
- ✔️ Node.js v18+
- ✔️ Docker Desktop
- ✔️ Docker Compose (thường đi kèm Docker Desktop)

```cmd
scripts\check-env.bat
```

### ✅ Bước 2: Cài đặt Workspace Dependencies

Cài đặt các dependencies của toàn bộ monorepo:

```cmd
scripts\bootstrap-workspace.bat
```

> **Lưu ý**: Script sẽ cài đặt `pnpm` nếu chưa có

### ✅ Bước 3: Khởi động Hệ thống

Script này sẽ:
1. Kiểm tra Docker daemon
2. Tạo `.env` file nếu chưa có
3. Khởi động Docker Compose stack
4. Chạy database migrations
5. Hiển thị URLs truy cập

```cmd
scripts\bootstrap.bat
```

### 🔄 Các tác vụ thường xuyên

**Xem logs (tất cả services):**
```bash
docker compose logs -f
```

**Xem logs của service cụ thể:**
```bash
docker compose logs -f auth-service
docker compose logs -f inventory-service
docker compose logs -f api-gateway
```

**Dừng tất cả services:**
```bash
docker compose down
```

**Reset (xóa dữ liệu database):**
```bash
docker compose down -v
scripts\bootstrap.bat
```

---

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
- ❌ DB not ready → Chờ 10-15 giây, sau đó kiểm tra `docker compose ps`

---

## 📝 Ghi chú

- **`.env` file**: Không track trên git (credential/secret). Template: `.env.example`
- **Architecture**: Xem [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)

---

**Happy coding! 🎉**
