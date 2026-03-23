# SmartBook System

Onboarding guide cho toàn bộ hệ thống SmartBook.

---

## Tong quan

SmartBook la he thong quan ly thu vien tu dong, gom cac microservice chay trong Docker cung PostgreSQL lam co so du lieu.

**Cac thanh phan chinh:**
| Thanh phan | Cong nghe | Chuc nang |
|---|---|---|
| **Web UI** (`apps/web`) | React + Vite + Tailwind | Giao dien nguoi dung |
| **API Gateway** (`apps/api-gateway`) | Express | Reverse proxy, dinh tuyen yeu cau |
| **Auth Service** | Node.js + Prisma | Xac thuc, JWT |
| **Inventory Service** | Node.js + Prisma | Quan ly sach, kho |
| **Borrow Service** | Node.js + Prisma | Quan ly muon/tra sach |
| **AI Service** | FastAPI + Ollama | OCR, tom tat AI |
| **PostgreSQL** | Database | Luu tru du lieu |
| **Ollama** | AI Models | Local LLM runtime |

**Co so du lieu rieng biet** (3 database):
- `auth_db` — Auth Service
- `inventory_db` — Inventory Service
- `borrow_db` — Borrow Service

---

## Khoi dong nhanh

### Buoc 1 — Clone va tao file .env

```bash
git clone https://github.com/your-org/smartbook-system.git
cd smartbook-system

# Tao .env tu template (bat buoc, cac service can .env de chay)
copy .env.example .env     # Windows CMD
# hoac: cp .env.example .env   # Linux/macOS
```

**Quan trong:** File `.env` chua thong tin ket noi database va JWT secret. Neu khong co, cac service se khong khoi dong duoc.

### Buoc 2 — Chay script khoi dong (Windows)

```cmd
scripts\run-all.bat
```

Script tu dong lam:
1. Kiem tra Node.js, Docker, Docker Compose (can cai dat neu thieu)
2. Kiem tra Docker daemon dang chay (neu chua, yeu cau mo Docker Desktop)
3. Tao file `.env` neu chua co
4. Cai dat pnpm (neu chua cai)
5. Chay `pnpm install` tai workspace root (cai thu vien cho tat ca packages)
6. Chay `docker compose up -d --build` (khoi dong PostgreSQL + tat ca service)
7. Cho PostgreSQL san sang
8. Chay Prisma schema push cho 3 database (`auth_db`, `inventory_db`, `borrow_db`)

**Luu y:** Buoc 6 (`docker compose up --build`) lai dau tien se mat nhieu phut vi can tai hinh anh Docker va build code.

### Buoc 3 — Truy cap ung dung

Sau khi script hoan tat:

| Service | Dia chi |
|---|---|
| Web UI | http://localhost:5173 |
| API Gateway | http://localhost:3000 |
| AI Service | http://localhost:8000 |
| pgAdmin | http://localhost:8080 |
| Ollama | http://localhost:11434 |

### Cac tuy chon cua run-all.bat

```cmd
scripts\run-all.bat --skip-workspace   # Bo qua pnpm install (da cai roi)
scripts\run-all.bat --skip-docker      # Chi chay pnpm install, khong khoi docker
scripts\run-all.bat --reset-db         # Xoa toan bo du lieu DB cu roi khoi dong lai
scripts\run-all.bat --skip-env         # Bo qua kiem tra moi truong
scripts\run-all.bat --help             # Xem huong dan
```

---

## Khoi dong thu cong (Linux/macOS hoac tuy chinh)

### 1. Tao .env

```bash
cp .env.example .env
```

### 2. Cai dat pnpm

```bash
npm install -g pnpm
pnpm install
```

### 3. Khoi dong Docker

```bash
# Khoi dong toan bo stack
docker compose up -d --build

# Hoac khoi dong tung buoc de dam bao DB san sang
docker compose up -d db
# Choi PostgreSQL san sang
docker compose exec db pg_isready -U user -d inventory

# Khoi dong cac service con lai
docker compose up -d --build

# Chay schema push cho 3 database
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push
docker compose --profile dev run --rm borrow-db-push
```

---

## Cac lenh thuong dung

```bash
# Khoi dong lai (sau khi da build lan dau)
docker compose up -d

# Xem trang thai cac container
docker compose ps

# Xem logs
docker compose logs -f
docker compose logs -f inventory-service    # Logs chi 1 service
docker compose logs --tail=50 api-gateway   # 50 dong cuoi

# Dung toan bo
docker compose down

# Dung + xoa du lieu (reset hoan toan)
docker compose down -v

# Reset + khoi dong lai tu dau
scripts\run-all.bat --reset-db

# Chay lai schema push (neu thay schema Prisma)
docker compose --profile dev run --rm inventory-db-push
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm borrow-db-push

# Rebuild 1 service cu the
docker compose up -d --build inventory-service
```

---

## Xem logs va xu ly loi

### Docker daemon khong chay

```
Error response from daemon: ...
```

**Cach fix:** Mo Docker Desktop, cho den khi hien thi "Docker Desktop is running", sau do chay lai script.

### Port da duoc su dung

```
Bind for 0.0.0.0:5432 failed: port is already allocated
```

**Cach fix:** Dung tat ca container hien tai roi khoi dong lai:

```bash
docker compose down
docker compose up -d --build
```

Hoac kiem tra port nao dang su dung:

```bash
netstat -ano | findstr :5432   # Windows
lsof -i :5432                  # macOS/Linux
```

### Schema loi sau khi thay doi code

Neu sua schema Prisma (`schema.prisma`) trong `services/*/prisma/schema.prisma`, can chay lai schema push:

```bash
docker compose --profile dev run --rm inventory-db-push
```

### Khoong the truy cap Web UI

Kiem tra container co dang chay khong:

```bash
docker compose ps smartbook-ui
```

Kiem tra logs:

```bash
docker compose logs smartbook-ui
```

Neu build that bai, xoa image cu va build lai:

```bash
docker compose down
docker compose up -d --build
```

---

## Cau truc database

### Database cua Auth Service (`auth_db`)
Luu user accounts, roles, permissions, JWT tokens.

### Database cua Inventory Service (`inventory_db`)
Luu sach, tac gia, nha xuat ban, kho, vi tri, theo doi ton kho, yeu cau nhap/xuat sach, yeu cau dat hang.

### Database cua Borrow Service (`borrow_db`)
Luu thong tin muon/tra sach, theo doi trang thai cac ban sao sach.

---

## Cong cu phat trien

### pgAdmin (quan ly PostgreSQL)

Truy cap: http://localhost:8080

Dang nhap: `admin@admin.com` / `admin`

**Ket noi PostgreSQL tu pgAdmin:**
- Host: `db`
- Port: `5432`
- Database: `inventory` (default, tao boi db-init)
- Username: `user` (hoac gia tri cua `POSTGRES_USER` trong .env)
- Password: `password` (hoac gia tri cua `POSTGRES_PASSWORD` trong .env)

### Ollama (AI model)

Truy cap: http://localhost:11434

De tai model AI:

```bash
docker compose exec ollama ollama pull llama3
docker compose exec ollama ollama pull llava
```

### Khi phat trien khong qua Docker

Co the chay tung service truc tiep tren may (thay vi Docker):

```bash
# Khoi dong PostgreSQL
docker compose up -d db

# Cai dat phu thuoc
pnpm install

# Chay 1 service
cd services/auth-service
node src/index.js

# Chay Web UI
cd apps/web
pnpm dev
```

---

## Tien ich (Windows Scripts)

| Script | Muc dich |
|---|---|
| `scripts\run-all.bat` | Entry point duy nhat — setup + run toan bo he thong |
| `scripts\run-all.bat --reset-db` | Reset hoan toan (xoa DB, build lai) |

---

## De loi thuong gap

| Loi | Nguyen nhan | Cach xu ly |
|---|---|---|
| `docker: command not found` | Docker chua cai dat | Tai Docker Desktop |
| `Error response from daemon` | Docker daemon chua chay | Mo Docker Desktop, doi "running" roi thu lai |
| `port is already allocated` | Port bi chiem | `docker compose down` roi `up -d --build` |
| Services khoi dong nhung khong truy cap duoc | Healthcheck that bai | Xem logs: `docker compose logs <service>` |
| Schema chua dong bo | Thay doi `schema.prisma` nhung chua push | Chay `docker compose --profile dev run --rm <service>-db-push` |
| `npm install` that bai tren Windows | PowerShell policy | Mo PowerShell voi quyen Admin, chay `Set-ExecutionPolicy RemoteSigned` |

---

## Ghi chu

- **`.env`**: Khong track tren git. Tao tu `.env.example` truoc khi chay.
- **Package manager**: Dung `pnpm` (quy dinh trong `package.json` `packageManager` field).
- **Node.js**: Can Node.js 20+. Kiem tra: `node --version`.
- **Docker**: Docker Desktop (Windows/macOS) hoac Docker Engine (Linux).
- **Database**: PostgreSQL 15 chay trong container `db`.
- **Architecture**: Xem [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md).

---

**Happy coding!**
