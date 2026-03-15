# 📚 SmartBook System Overview

## 1) 🎯 Muc tieu he thong
SmartBook la he thong quan ly kho sach theo huong microservices, ket hop:
- Quan ly ton kho, vi tri kho, nhap/xuat sach.
- Xac thuc nguoi dung bang JWT.
- Frontend web de van hanh kho.
- AI service de nhan dien thong tin sach tu anh (bia truoc/bia sau).

## 2) 🧩 Kien truc tong the
Thanh phan chinh:
- 🖥️ `smartbook-ui` (React + Vite): giao dien quan tri.
- 📦 `inventory-service` (Node.js + Express + Prisma): API kho sach va ton kho.
- 🔐 `auth-service` (Node.js + Express + Prisma): dang ky/dang nhap, cap JWT.
- 🤖 `ai-service` (FastAPI): OCR/vision qua Ollama model.
- 🧠 `ollama` (container): model server cho AI.
- 🗄️ `postgres` + `pgadmin`: co so du lieu va cong cu quan tri DB.

Luot goi co ban:
1. Nguoi dung dang nhap tu UI -> `auth-service` (`/auth/login`) -> nhan JWT.
2. UI luu JWT vao `localStorage`.
3. UI goi API kho (`inventory-service`) kem header `Authorization: Bearer <token>`.
4. `inventory-service` verify JWT (middleware) roi tra du lieu sach/kho.
5. Khi can scan sach, UI upload anh sang `ai-service`.
6. `ai-service` goi `ollama` de trich xuat thong tin sach dang JSON.

## 3) 🗂️ Cau truc thu muc chinh
- `ai-service/`: FastAPI app, endpoint AI (`/health`, `/recognize-book`, `/scan-back-cover`).
- `auth-service/`: Auth routes (`/auth/*`), health check (`/health`).
- `inventory-service/`: API sach, kho, va giao dich nhap/xuat.
- `smartbook-ui/`: frontend React.
- `docker-compose.yml`: stack chay bang Docker.
- `setup.ps1`: script setup nhanh (neu can).

## 4) 🔌 Ports mac dinh
Theo ma nguon hien tai:
- UI: `5173`
- Inventory Service: `3001`
- Auth Service: `3002`
- AI Service: `8000`
- Ollama: `11434`
- PostgreSQL: `5432`
- pgAdmin: `8080`

Luu y quan trong:
- `auth-service` dang chay rieng (PORT mac dinh `3002`) trong ma nguon.
- `docker-compose.yml` hien co `inventory-service`, `smartbook-ui`, `ai-service`, `ollama`, `db`, `pgadmin`, nhung chua co service `auth-service`.

## 5) 🌐 API chinh (tom tat)
Auth (`auth-service`):
- `POST /auth/register`
- `POST /auth/login`
- `GET /health`

Inventory (`inventory-service`, can JWT cho `/api/*`):
- `GET /api/books`
- `GET /api/warehouses`
- `GET /api/warehouses/:id/locations`
- `GET /api/inventory`
- `POST /api/inventory/inbound`
- `POST /api/inventory/outbound`

AI (`ai-service`):
- `GET /health`
- `POST /recognize-book` (anh bia truoc)
- `POST /scan-back-cover` (anh bia sau)

## 6) 🛡️ Bao mat va xac thuc
- Token luu o frontend qua key `token` trong `localStorage`.
- Frontend tu dong gan header Authorization trong `src/services/api.js`.
- `inventory-service` ap middleware auth cho toan bo `/api`.
- Neu thieu/sai token: API tra `401`/`403`.

## 7) 🚀 Cach chay he thong
### Cach A: 🐳 Chay bang Docker Compose (nhanh)
Tu thu muc `smartbook-system`:

```bash
docker compose up --build
```

Sau khi chay:
- UI: http://localhost:5173
- Inventory API: http://localhost:3001
- AI API: http://localhost:8000
- pgAdmin: http://localhost:8080

Neu can dang nhap, ban van can chay them `auth-service` (do compose chua include service nay).

### Cach B: 💻 Chay local tung service
1. Chay DB/Ollama bang Docker (neu can).
2. Chay `auth-service` (Node).
3. Chay `inventory-service` (Node).
4. Chay `ai-service` (Python/FastAPI).
5. Chay `smartbook-ui` (`npm run dev`).

## 8) ⚙️ Bien moi truong quan trong
Frontend (`smartbook-ui/.env`):
- `VITE_API_BASE_URL=http://localhost:3001`
- `VITE_AUTH_BASE_URL=http://localhost:3002`

Inventory/Auth:
- `JWT_SECRET`
- `DATABASE_URL`

AI Service:
- `OLLAMA_HOST` (mac dinh: `http://ollama:11434` trong Docker)
- `OLLAMA_MODEL` (mac dinh: `llava`)

## 9) 📌 Tinh trang hien tai va de xuat
Tinh trang:
- ✅ Kien truc da tach service ro rang.
- ✅ UI da co login + route guard + logout.
- ✅ Inventory API da duoc bao ve bang JWT middleware.

De xuat tiep theo:
- ➕ Them `auth-service` vao `docker-compose.yml` de stack day du.
- 🧭 Dong bo README cac service de tranh lech cong/URL.
- 🧪 Them OpenAPI/Postman collection chung cho toan he thong.
- ✅ Them test tu dong (integration test cho auth + inventory).
