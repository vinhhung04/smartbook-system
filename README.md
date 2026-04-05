# SmartBook System

> He thong quan ly kho va luan chuyen sach hien dai, duoc thiet ke theo huong microservices va san sang mo rong cho AI.

![status](https://img.shields.io/badge/status-active%20development-0a7f5a)
![architecture](https://img.shields.io/badge/architecture-microservices-0b5fff)
![runtime](https://img.shields.io/badge/runtime-Docker%20Compose-ff6b00)

## Muc luc

- [SmartBook System](#smartbook-system)
  - [Muc luc](#muc-luc)
  - [Tong quan](#tong-quan)
  - [Key Features](#key-features)
    - [📚 Inventory Domain](#-inventory-domain)
    - [🔁 Circulation Domain](#-circulation-domain)
    - [🤖 AI Domain](#-ai-domain)
    - [🔐 IAM Domain](#-iam-domain)
  - [Architecture](#architecture)
    - [Luong request tong quat](#luong-request-tong-quat)
    - [Dich vu chinh](#dich-vu-chinh)
  - [User Roles](#user-roles)
  - [Gateway Route Map](#gateway-route-map)
  - [Tech Stack](#tech-stack)
  - [Getting Started (Docker Compose)](#getting-started-docker-compose)
    - [1) Chuan bi](#1-chuan-bi)
    - [2) Khoi dong nhanh (khuyen nghi cho Windows)](#2-khoi-dong-nhanh-khuyen-nghi-cho-windows)
    - [3) Hoac chay bang Docker Compose thu cong](#3-hoac-chay-bang-docker-compose-thu-cong)
    - [4) Truy cap he thong](#4-truy-cap-he-thong)
  - [Project Structure](#project-structure)
  - [Tai lieu bo sung](#tai-lieu-bo-sung)
  - [Gop y](#gop-y)

## Tong quan

SmartBook System la nen tang quan ly danh muc sach, ton kho va nghiep vu muon tra theo mo hinh **Microservices (REST-first)** voi **API Gateway** lam diem vao duy nhat.

- Trang thai hien tai: **dang phat trien tich cuc**, stack core da chay on dinh tren Docker Compose.
- Dinh huong san pham: phan tach nghiep vu ro rang, de scale theo tung domain.
- Diem nhan ky thuat: tich hop **AI Service (FastAPI + Ollama local LLM)** de nhan dien sach va trich xuat metadata.

## Key Features

### 📚 Inventory Domain

- Quan ly catalog sach, barcode, bien the va vi tri kho.
- Theo doi ton kho, bien dong kho, nhap kho/xuat kho.
- Dang mo rong nghiep vu Supplier va Stock Audit.

### 🔁 Circulation Domain

- Quan ly muon, tra, gia han, dat cho.
- Theo doi phi phat va trang thai ban sao sach.
- Ho tro cong tu phuc vu cho khach hang.

### 🤖 AI Domain

- Nhan dien thong tin sach tu anh (OCR + metadata extraction).
- Tra cuu metadata tu ISBN va nguon bo tro.
- Van hanh local model qua Ollama (uu tien rieng tu du lieu).

### 🔐 IAM Domain

- Xac thuc va uy quyen tap trung qua Auth Service.
- RBAC/PBAC cho 5 vai tro nghiep vu.
- Tach ro quyen truy cap theo muc do van hanh va quan tri.

## Architecture

### Luong request tong quat

1. Web Client gui request vao API Gateway.
2. Gateway route theo path den dung service domain.
3. Service xu ly nghiep vu va truy cap PostgreSQL theo DB rieng.
4. Cac tac vu AI duoc dieu phoi toi AI Service va Ollama.

```text
Client -> API Gateway -> (Auth | Inventory | Borrow | AI) -> PostgreSQL / Ollama
```

### Dich vu chinh

| Service | Port (Host) | Vai tro |
|---|---:|---|
| API Gateway | 3000 | Diem vao tap trung, dinh tuyen route |
| Auth Service | 3004 | IAM, JWT, RBAC/PBAC |
| Inventory Service | 3003 | Catalog, kho, ton, barcode |
| Borrow Service | 3005 | Muon/tra, dat cho, phi phat |
| AI Service | 8000 | OCR, metadata extraction, AI processing |
| Web UI | 5173 | Portal van hanh va nghiep vu |
| PostgreSQL | 5432 | Luu tru du lieu giao dich |
| pgAdmin | 8080 | Quan tri CSDL |
| Ollama | 11434 | Local LLM runtime |

## User Roles

> Trong SmartBook, **Librarian** va **Staff** la 2 vai tro tach biet:
> Librarian tap trung vao nghiep vu muon tra va tuong tac ban doc;
> Staff tap trung vao van hanh vat ly kho, nhap xuat, kiem dem.

| Vai tro | Trong tam trach nhiem | Quyen tieu bieu |
|---|---|---|
| Customer | Su dung dich vu thu vien | Xem catalog, dat cho, xem lich su muon tra ca nhan |
| Librarian | Nghiep vu luan chuyen sach | Duyet/quan ly muon tra, xu ly giu cho, xu ly tinh huong ban doc |
| Staff | Van hanh kho vat ly | Nhap kho, dieu chuyen, cap nhat ton, barcode, vi tri |
| Manager | Dieu phoi van hanh | Giam sat KPI, phe duyet nghiep vu, dieu huong tac nghiep |
| Admin | Quan tri he thong | Quan ly user/role/policy, cau hinh nen tang, quan tri toan cuc |

## Gateway Route Map

| Route chinh | Dich vu dich | Muc dich |
|---|---|---|
| /auth | Auth Service | Dang nhap, xac thuc, token |
| /iam | Auth Service | User, role, permission |
| /api | Inventory Service | Nhom API catalog, kho, ton |
| /borrow | Borrow Service | API muon/tra, dat cho, phi phat |
| /my | Borrow Service | Khach hang xem du lieu ca nhan |
| /catalog | Inventory Service | Public catalog |
| /ai | AI Service | OCR, metadata, AI endpoints |
| /api/ai | AI Service | Nhom API AI qua gateway |
| /health | API Gateway | Health check he thong |

## Tech Stack

| Lop | Cong nghe |
|---|---|
| Backend | Node.js, Express, Prisma, FastAPI |
| Frontend | React, Vite, TypeScript |
| Database | PostgreSQL |
| DevOps | Docker Compose, pgAdmin |
| AI | Ollama (Local LLM) |

## Getting Started (Docker Compose)

### 1) Chuan bi

```bash
git clone https://github.com/your-org/smartbook-system.git
cd smartbook-system
copy .env.example .env
```

### 2) Khoi dong nhanh (khuyen nghi cho Windows)

```cmd
scripts\run-all.bat
```

Tuy chon nhanh:

```cmd
scripts\run-all.bat --skip-workspace
scripts\run-all.bat --skip-docker
scripts\run-all.bat --reset-db
scripts\run-all.bat --help
```

### 3) Hoac chay bang Docker Compose thu cong

```bash
docker compose up -d --build
docker compose --profile dev run --rm auth-db-push
docker compose --profile dev run --rm inventory-db-push
docker compose --profile dev run --rm borrow-db-push
docker compose ps
```

### 4) Truy cap he thong

| Thanh phan | URL |
|---|---|
| Web UI | http://localhost:5173 |
| API Gateway | http://localhost:3000 |
| AI Service | http://localhost:8000 |
| pgAdmin | http://localhost:8080 |
| Ollama | http://localhost:11434 |

## Project Structure

```text
smartbook-system/
|- apps/
|  |- api-gateway/
|  \- web/
|- services/
|  |- auth-service/
|  |- borrow-service/
|  |- inventory-service/
|  |- ai-service/
|  \- analytics-service/
|- packages/
|  \- shared/
|- docs/
|- db-init/
|- data/
|- scripts/
|- docker-compose.yml
|- pnpm-workspace.yaml
\- README.md
```

## Tai lieu bo sung

- Kien truc tong quan: docs/PROJECT_OVERVIEW.md
- Huong dan chay voi Docker chi tiet: docs/RUN_WITH_DOCKER.md
- AI service chi tiet: docs/SERVICES/AI_SERVICE.md
- Inventory service chi tiet: docs/SERVICES/INVENTORY_SERVICE.md
- Huong dan test theo phase: docs/CUSTOMER_PORTAL_PHASE1_TEST_GUIDE.md, docs/CUSTOMER_PORTAL_PHASE34_TEST_GUIDE.md, docs/BORROW_PHASE1_HARDEN_TEST_GUIDE.md

## Gop y

Neu ban muon dong gop, hay bat dau tu viec chay stack bang Docker, xac nhan health endpoint va tao pull request theo pham vi service cu the.
