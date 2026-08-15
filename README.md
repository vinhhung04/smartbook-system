<div align="center">

# 📚 SmartBook System

### Nền tảng Quản lý Thư viện & Kho vận kết hợp — Đồ án tốt nghiệp (KLTN)

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10.6.2-F69220?logo=pnpm&logoColor=white)
![Status](https://img.shields.io/badge/Status-Private%20Project-lightgrey)

**SmartBook** kết hợp **📖 Quản lý Thư viện** (đặt / mượn / trả sách) và **📦 Quản lý Kho vận & Mua hàng** (mua hàng, nhập kho, sắp xếp kệ, xuất kho) trong một hệ thống microservices duy nhất.

</div>

---

Hai trụ cột dùng chung một nền tảng: quản trị người dùng/phân quyền (🔐 Auth/IAM), một service tồn kho lõi (📦 Inventory Service) cung cấp API tích hợp cho cả hai phía, một service AI hỗ trợ nhập liệu (🤖), một service Analytics tổng hợp báo cáo (📊), và một cơ chế real-time (🔔 WebSocket) đẩy thông báo cho cả nhân viên thư viện lẫn nhân viên kho.

Mục tiêu của project là chứng minh một hệ thống thư viện kiêm kho vận có thể được thiết kế như một sản phẩm vận hành thật: dữ liệu được tách theo domain, các service giao tiếp qua API, tồn kho được cập nhật đúng theo từng bước nghiệp vụ (không tự động cộng/trừ ngầm), và các flow chính có thể demo/test end-to-end bằng Docker.

## 🔢 Tổng Quan Nhanh

| | |
|---|---|
| 🧩 **Kiến trúc** | Microservices — 5 service nghiệp vụ + API Gateway + Web UI |
| 📦 **Service lớn nhất** | Inventory Service — ~28 route file (mua hàng, nhập/xuất kho) |
| 🗄️ **Cơ sở dữ liệu** | PostgreSQL (3 domain DB: `auth_db`, `inventory_db`, `borrow_db`) + Redis cache |
| 🐳 **Triển khai** | Docker Compose — 11 container |
| 🤖 **AI** | Ollama (local LLM, `llama3.1:8b-instruct-q4_0`) + fallback Anthropic Claude |
| 🔔 **Real-time** | Socket.IO qua API Gateway, theo phòng user/role |
| 🌐 **Ngôn ngữ** | Tiếng Việt (giao diện & tài liệu) |

## ✨ Tính Năng Nổi Bật

<table>
<tr>
<td width="50%" valign="top">

**📖 Thư viện**

- 🔐 Đăng nhập, JWT, phân quyền theo role/permission
- 🔎 Duyệt catalog, xem chi tiết sách
- 🗓️ Đặt sách, giữ tồn kho thật (không giữ chỗ ảo)
- 📲 Pickup code / QR code khi nhận sách
- 📖 Mượn, gia hạn, trả sách
- 💸 Sinh phí phạt khi quá hạn / mất / hư sách
- ❤️ Wishlist, review, thông báo cho khách hàng

</td>
<td width="50%" valign="top">

**📦 Kho vận & Mua hàng**

- 🛒 Purchase Request → Purchase Order → gửi nhà cung cấp
- 🚚 Supplier Portal (token công khai) + Supplier Account (đăng nhập)
- 📥 Goods Receipt — chỉ cộng tồn khi **post**
- 🗂️ Putaway — gợi ý vị trí kệ trống
- 🧺 Picking & Packing có bằng chứng ảnh/video
- 🧮 Stock Audit, Exception Report, Reslotting
- ⚠️ Shortage report & giao bù (redelivery)

</td>
</tr>
</table>

## 🚀 Bắt Đầu Nhanh

```powershell
pnpm install --frozen-lockfile
pnpm demo:env
docker compose up -d --build
pnpm demo:seed
pnpm demo:status
```

Mở **http://localhost:5173**, đăng nhập bằng tài khoản demo `hung` / `123456`.

> [!TIP]
> Xem chi tiết đầy đủ về biến môi trường, URL từng service và cách rebuild riêng lẻ ở mục [🐳 Chạy Project Bằng Docker](#chạy-project-bằng-docker).

## 📑 Mục Lục

- [🧩 Bài toán](#bài-toán)
- [🗂️ Phạm vi hệ thống](#phạm-vi-hệ-thống)
- [🏗️ Kiến trúc tổng quan](#kiến-trúc-tổng-quan)
- [🧭 Các domain nghiệp vụ](#các-domain-nghiệp-vụ)
- [🔁 Luồng nghiệp vụ chính](#luồng-nghiệp-vụ-chính)
- [🧱 Service catalog](#service-catalog)
- [🛠️ Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [🐳 Chạy project bằng Docker](#chạy-project-bằng-docker)
- [🔑 Tài khoản demo](#tài-khoản-demo)
- [🧪 Kiểm thử](#kiểm-thử)
- [🗃️ Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [📚 Tài liệu tham khảo](#tài-liệu-tham-khảo)

## 🧩 Bài Toán

**📖 Phía thư viện**, một thư viện thực tế không chỉ cần lưu danh sách sách. Hệ thống phải quản lý được:

- 📚 Sách có nhiều biến thể, ISBN, barcode, trạng thái mượn được hay không.
- 🪪 Khách hàng có membership, giới hạn số sách được mượn/đặt.
- 🗓️ Reservation cần giữ tồn kho thật, có hạn nhận sách và có thể hết hạn.
- 🧑‍💼 Staff cần xác nhận đặt sách, phát sách tại quầy, xử lý mượn/trả.
- 💸 Khi quá hạn, mất hoặc hư sách, hệ thống phải sinh phí phạt.

**📦 Phía kho vận & mua hàng**, việc có sách để cho mượn không tự nhiên mà có — hệ thống phải mô phỏng cả chuỗi cung ứng phía sau:

- 🛒 Khi tồn kho thấp, ai đó phải tạo purchase request, được duyệt rồi mới trở thành purchase order gửi cho nhà cung cấp.
- 🚚 Nhà cung cấp cần một kênh riêng để xác nhận đơn hàng, gửi hóa đơn/phiếu giao hàng — mà không được phép tự ý sửa tồn kho.
- 📥 Hàng về kho phải được kiểm đếm, tạo goods receipt, rồi mới thật sự cộng vào tồn kho khi phiếu được "post".
- 🗂️ Sau khi nhập, hàng cần được sắp xếp vào đúng vị trí kệ (putaway), và có gợi ý vị trí tối ưu.
- 🧺 Khi có đơn xuất kho (phục vụ mượn sách hoặc chuyển kho), cần một luồng lấy hàng (picking) và đóng gói (packing) trước khi xuất.
- 🧮 Kho phải kiểm kê định kỳ (stock audit), ghi nhận sự cố/thiếu hụt (exception report, shortage report) và có cơ chế xử lý tái sắp xếp (reslotting).
- 👤 Admin cần quản trị user, role, permission cho toàn bộ hệ thống.
- 🤖 Nhân viên cần công cụ nhập liệu nhanh, có thể dùng OCR/AI để lấy metadata sách.

SmartBook giải bài toán này bằng cách chia hệ thống thành các domain service độc lập, mỗi service sở hữu dữ liệu và nghiệp vụ riêng, và ép các quy tắc quan trọng (vd: "chỉ cộng tồn khi goods receipt được post") xuống tận backend thay vì chỉ ở giao diện.

## 🗂️ Phạm Vi Hệ Thống

### 📖 Nhóm Thư viện

- 🔐 Auth/IAM: đăng nhập, JWT, user, role, permission, phân quyền theo API, quên/đặt lại mật khẩu qua email.
- 📖 Borrow: customer, membership, reservation, loan, return, renewal, fine, notification, wallet/account ledger.
- 🙋 Customer Portal: customer xem catalog, đặt sách, xem reservation, mã pickup/QR, loan, fine, wishlist, review, notification.

### 📦 Nhóm Kho vận & Mua hàng

- 🏷️ Catalog & tồn kho: books, variants, warehouse, location/shelf, stock balance, stock movement, stock alert.
- 🛒 Mua hàng: purchase request, purchase order (submit/approve/reject/cancel/gửi nhà cung cấp), supplier, supplier account, supplier portal (token công khai), supplier delivery, shortage report/redelivery.
- 📥 Nhập kho: goods receipt (draft/post), receiving thông minh có gợi ý AI, putaway (xếp hàng vào kệ), receiving-putaway, transfer receiving.
- 📤 Xuất kho: order request (outbound/transfer), picking, packing (có bằng chứng ảnh/video), outbound.
- 🧮 Vận hành kho: stock audit, exception report, reslotting/storage suggestion, staff task, "my warehouse tasks".

### 🧰 Nền Tảng Dùng Chung

- 🤖 AI Service: tra cứu thông tin sách theo ISBN, OCR hóa đơn nhập kho, metadata enrichment, chat/agent và trợ lý ra quyết định hỗ trợ nghiệp vụ.
- 📊 Analytics Service: tổng hợp KPI/báo cáo thật từ dữ liệu thư viện lẫn kho vận.
- 🔔 Real-time: API Gateway phát sự kiện qua WebSocket (Socket.IO) cho cả hai phía thư viện và kho vận.
- 🖥️ Web UI: giao diện quản trị, kho vận và customer portal trên React/Vite.
- 🐳 Docker Compose: dựng toàn bộ stack local gồm database, Redis, services, gateway, web, pgAdmin, Ollama.

## 🏗️ Kiến Trúc Tổng Quan

```mermaid
flowchart LR
    UI["🖥️ Web UI :5173"] --> GW["🚪 API Gateway :3000"]

    GW --> AUTH["🔐 Auth Service :3002"]
    GW --> INV["📦 Inventory Service :3001"]
    GW --> BORROW["📖 Borrow Service :3005"]
    GW --> AI["🤖 AI Service :8000"]
    GW --> ANA["📊 Analytics Service :3006"]

    AUTH --> PG[("🐘 PostgreSQL :5432")]
    INV --> PG
    BORROW --> PG
    ANA --> PG

    AUTH --> REDIS["⚡ Redis :6379"]
    INV --> REDIS

    AI --> OLLAMA["🦙 Ollama :11434"]
    PGADMIN["🛠️ pgAdmin :8080"] --> PG

    GW -. WebSocket Socket.IO .-> UI
```

API Gateway là cổng vào tập trung cho frontend, vừa proxy HTTP vừa giữ kết nối WebSocket:

- `/auth`, `/iam` → Auth Service.
- `/api`, `/catalog` (rewrite sang `/api`) → Inventory Service.
- `/borrow`, `/my` (rewrite sang `/borrow/my`) → Borrow Service.
- `/analytics` → Analytics Service.
- `/ai`, `/api/ai` → AI Service.
- Kết nối `socket.io` (xác thực bằng JWT khi handshake) để đẩy sự kiện real-time cho cả hai phía thư viện và kho vận (xem mục [🔔 Real-time](#real-time--thông-báo)).

Các service Node.js dùng Prisma ORM và PostgreSQL. Database được tách theo domain để giảm coupling:

- `auth_db`: người dùng, role, permission, session/auth metadata.
- `inventory_db`: catalog, variants, warehouse, location, stock balances/movements, purchase request/order, supplier, goods receipt, putaway, picking, packing, stock audit, exception report.
- `borrow_db`: customers, memberships, reservations, loans, fines, notifications, wallet/account ledger.

> [!NOTE]
> Analytics Service không có database riêng — nó đọc trực tiếp từ `inventory_db` và `borrow_db` (qua hai connection string riêng) để tổng hợp báo cáo. Đây là **ngoại lệ duy nhất** được phép truy vấn chéo domain. Auth Service và Inventory Service dùng thêm Redis để cache.

## 🧭 Các Domain Nghiệp Vụ

### 🔐 Auth / IAM

Auth Service quản lý định danh và phân quyền:

- Đăng nhập bằng username/email, sinh JWT dùng chung qua API Gateway.
- Quên mật khẩu / đặt lại mật khẩu qua email (SMTP).
- Quản lý user, role, permission; hỗ trợ superuser và permission-based authorization cho các service khác.

### 📖 Borrow (mượn / trả / đặt sách)

Borrow Service là domain lưu thông sách:

- Customer profile, membership plan, active membership.
- Reservation lifecycle: `PENDING`, `CONFIRMED`, `READY_FOR_PICKUP`, `CONVERTED_TO_LOAN`, `CANCELLED`, `EXPIRED`.
- Loan lifecycle: mượn, gia hạn, trả, quá hạn, mất, hư.
- Fine lifecycle: sinh fine, thanh toán, waive/reduce.
- Notification và audit log cho các nghiệp vụ quan trọng.
- Account/wallet ledger cho phí mượn/phí phạt.

### 🙋 Customer Portal

Customer Portal là phần trải nghiệm khách hàng:

- Xem catalog và chi tiết sách, đặt sách.
- Theo dõi reservation, hạn nhận sách, xem pickup code/QR khi sách sẵn sàng nhận.
- Xem loan, yêu cầu gia hạn, xem fine, thanh toán fine.
- Wishlist, review, notification, preference.

### 📦 Kho vận & Mua hàng (Inventory Service)

Đây là service lớn nhất hệ thống (gần 30 route file), quản lý toàn bộ vòng đời hàng hóa từ lúc đặt mua đến lúc xuất kho.

**🏷️ Catalog & tồn kho cơ bản** (`/api/books`, `/api/warehouses`, `/api/locations`, `/api/shelves`, `/api/stock-balances`, `/api/stock-movements`, `/api/stock-alerts`)

- Books, book variants, ISBN, barcode, metadata; tạo nhanh sách "incomplete" ngay từ luồng nhập kho.
- Warehouse, cây vị trí (zone/kệ/ô) theo từng warehouse.
- Stock balance theo variant/location, lịch sử stock movement, cảnh báo tồn thấp (`low-stock`).

**🛒 Mua hàng (Procurement)** (`/api/purchase-requests`, `/api/purchase-orders`, `/api/suppliers`, `/api/supplier-account`, `/api/supplier-deliveries`, `/api/supplier-portal`)

- Purchase Request: nhân viên tạo yêu cầu mua, manager duyệt/từ chối, hoặc convert thẳng thành Purchase Order.
- Purchase Order: submit → approve/reject → gửi cho nhà cung cấp (`send-to-supplier`) → nhà cung cấp xác nhận (`supplier-confirm`) → tạo goods receipt từ PO; PO có thể bị hủy, có mục reconciliation, danh sách chứng từ nhà cung cấp và shortage report riêng.
- Supplier: quản lý nhà cung cấp; Supplier Account (đăng nhập có tài khoản) và Supplier Portal (token công khai) là hai kênh để nhà cung cấp xác nhận đơn, nộp hóa đơn/phiếu giao hàng, xác nhận thiếu hàng và nộp hóa đơn giao bù — xem chi tiết ở mục [🚚 Nhà cung cấp](#nhà-cung-cấp--supplier-portal).

**📥 Nhập kho (Receiving & Putaway)** (`/api/goods-receipts`, `/api/receiving-smart`, `/api/receiving-putaway`, `/api/putaway`, `/api/transfer-receiving`)

- Goods Receipt: tạo/sửa phiếu nhập ở trạng thái draft, gán người xác nhận, chỉ cộng tồn kho khi phiếu được **post**.
- Receiving-smart: nhân viên nhập liệu nhanh bằng cách khớp (match) hàng thực nhận với đơn hàng, AI hỗ trợ tạo/convert draft.
- Putaway & Receiving-putaway: gợi ý ô kệ trống, quét barcode vị trí/variant, xác nhận xếp hàng vào kệ, có thể đảo ngược (reverse) khi xếp nhầm.
- Transfer receiving: nhận hàng chuyển kho nội bộ, có hàng chờ (queue), gán người nhận, xác nhận.

**📤 Xuất kho (Fulfillment)** (`/api/order-requests`, `/api/picking`, `/api/packing`, `/api/outbound`)

- Order Request: tạo yêu cầu xuất kho (outbound) hoặc chuyển kho (transfer), cần approve/reject trước khi thực thi.
- Picking: danh sách task lấy hàng theo `taskType`/`taskId`, nhận task, xử lý repick khi thiếu hàng, xem theo cây (picking-tasks/children).
- Packing: quét hóa đơn để bắt đầu đóng gói, nhận task, quét từng item, upload bằng chứng (ảnh/ghi hình), hoàn tất hoặc hủy task, xem lịch sử.
- Outbound: hàng đợi xuất kho, gán/nhận task, xác nhận xuất.

**🧮 Vận hành kho (Warehouse Operations)** (`/api/stock-audits`, `/api/exception-reports`, `/api/storage-suggestions`, `/api/reslotting-suggestions`, `/api/staff-tasks`, `/api/my-warehouse-tasks`)

- Stock Audit: tạo phiếu kiểm kê, gán người kiểm, nhập số lượng đếm theo từng dòng, submit rồi approve/cancel.
- Exception Report: nhân viên báo cáo sự cố kho, manager gán và xử lý.
- Storage/Reslotting Suggestion: gợi ý vị trí lưu trữ tối ưu (AI hỗ trợ) và đề xuất tái sắp xếp kệ.
- Staff Task & My Warehouse Tasks: giao việc chung cho nhân viên kho, theo dõi task khả dụng và task của riêng mình.

**🔗 Tích hợp với Borrow Service** (`/api/borrow-integration`)

- API nội bộ để Borrow Service tìm variant/warehouse khả dụng, giữ tồn khi đặt sách (`reservations/reserve`), nhả tồn khi hủy (`reservations/release`), trừ tồn khi phát sách (`reservations/consume`) và trả lại tồn khi hoàn sách (`loans/return`).

### 🚚 Nhà cung cấp / Supplier Portal

Hai kênh để nhà cung cấp tương tác với hệ thống, dùng chung một tập quy tắc:

- **Supplier Account** (`/api/supplier-account`): nhà cung cấp đăng nhập bằng tài khoản thật, được route tới `/supplier` trên Web UI.
- **Supplier Portal công khai** (`/api/supplier-portal`): staff gửi link kèm token (`/supplier/portal/:token`), không cần đăng nhập, dùng cho các nhà cung cấp chưa có tài khoản.

Cả hai kênh chỉ cho phép: xác nhận đơn hàng, nộp hóa đơn/phiếu giao hàng, xác nhận (acknowledge) hoặc báo không thể giao khi thiếu hàng, nộp hóa đơn giao bù (redelivery).

> [!IMPORTANT]
> Endpoint `create-goods-receipt` và `post-goods-receipt` phía nhà cung cấp cố tình trả lỗi (`supplierCannotPostStock`) — nhà cung cấp **không bao giờ** được tự tạo hoặc post goods receipt, không được sửa tồn kho. Việc tạo và post goods receipt luôn do warehouse staff thực hiện từ hóa đơn nhà cung cấp gửi lên (`/api/supplier-deliveries/:id/create-goods-receipt`).

### 🤖 AI

AI Service hỗ trợ tự động hóa nhập liệu:

- OCR hóa đơn/phiếu giao hàng khi nhập kho (`/scan-receipt`), lookup metadata theo ISBN (Google Books, Open Library, marketplace Fahasa/Tiki/Vinabook).
- Gợi ý mô tả/tóm tắt sách, chat/agent hỗ trợ nghiệp vụ (nhận diện ý định, gợi ý kho/hàng cần nhập).
- Chạy local qua Ollama (model mặc định `llama3.1:8b-instruct-q4_0`, dùng chung cho `/chat` và `/assistant`) để phù hợp môi trường demo và kiểm soát dữ liệu; có thể fallback sang Anthropic Claude nếu cấu hình `ANTHROPIC_API_KEY`.
- `POST /ai/assistant` — chatbot hỗ trợ ra quyết định dành cho manager/admin: dùng Ollama tool-calling thật (model `ASSISTANT_MODEL`, mặc định `llama3.1:8b-instruct-q4_0`) để tự chọn gọi các endpoint `/analytics/*` rồi tổng hợp câu trả lời tiếng Việt kèm số liệu cụ thể, thay vì chỉ đọc lại số liệu thô. Trang web tương ứng: `/ai-assistant` (chỉ hiển thị cho ADMIN/WAREHOUSE_MANAGER).

### 📊 Analytics

Analytics Service là module dành cho báo cáo vận hành:

- Tổng hợp KPI thật từ `inventory_db` và `borrow_db`.
- Phục vụ dashboard staff/manager/admin qua API Gateway prefix `/analytics`.
- Là nơi duy nhất gom dữ liệu chéo domain cho báo cáo; các service nghiệp vụ khác không query chéo database.
- Không dùng fake data hoặc số liệu hardcode ở frontend.

Các endpoint chính:

| Method | Endpoint | Ý nghĩa |
|---|---|---|
| GET | `/analytics/dashboard/kpis` | 📊 KPI tổng quan: đầu sách, bản sao, loan, reservation, pickup code, fine, low stock |
| GET | `/analytics/borrow-trends` | 📈 Xu hướng mượn/trả/đặt sách theo ngày hoặc tháng |
| GET | `/analytics/top-books` | 🏆 Sách được mượn nhiều nhất |
| GET | `/analytics/overdue-summary` | ⏰ Tổng hợp loan/item quá hạn |
| GET | `/analytics/fine-summary` | 💸 Tổng hợp fine đã thu, chưa thu, waived và theo loại |
| GET | `/analytics/warehouse-stock-risk` | ⚠️ Rủi ro tồn kho thấp/hết hàng theo warehouse |
| GET | `/analytics/reorder-suggestions` | 🤖 AI demand forecasting và gợi ý nhập thêm sách từ lượt mượn, reservation, wishlist, cảnh báo chờ hàng và tồn kho |
| GET | `/analytics/reservation-funnel` | 🔻 Funnel reservation và tỷ lệ convert sang loan |

Ví dụ response rút gọn:

```json
{
  "data": {
    "total_titles": 120,
    "total_copies": 850,
    "active_loans": 42,
    "overdue_loans": 7,
    "unpaid_fine_amount": 350000,
    "reservation_conversion_rate": 68.5
  }
}
```

Endpoint `/analytics/reorder-suggestions` nhận các query phổ biến như `days=30`, `limit=20`, `leadTimeDays=14`, `priority=HIGH|MEDIUM|LOW|ALL`. Response gồm summary tổng số candidate, số lượng HIGH/MEDIUM/LOW, tổng số lượng đề xuất nhập thêm và danh sách sách với `forecast_7d`, `forecast_30d`, `estimated_days_until_stockout`, `priority`, `suggested_reorder_qty`, `reason`.

### 🔔 Real-time / Thông báo

API Gateway giữ một kết nối Socket.IO dùng chung cho cả hai phía. Client xác thực bằng JWT khi handshake; sau khi kết nối, mỗi user tự động vào phòng riêng (`user:{id}`) và các phòng theo vai trò: `admin`, `librarian`, `warehouse_manager`, `warehouse_staff`, hoặc phòng `customer:{id}` nếu là khách hàng. Các service nội bộ gọi `POST /internal/push-event` (xác thực bằng `INTERNAL_SERVICE_KEY`) để gateway phát sự kiện tới đúng phòng, ví dụ:

- 📖 Phía thư viện: `loan:*`, `reservation:*`, `fine:*`, `notification:new`.
- 📦 Phía kho vận: `stock:*`, `purchase_request:*`, `purchase_order:*`, `goods_receipt:created`, `putaway:*`, `picking:*`, `warehouse_task:*`, `exception_report:*`.
- 🤖 Phía AI: `ai_action:*` (tạo/duyệt/thực thi/hủy một hành động do AI đề xuất).

## 🔁 Luồng Nghiệp Vụ Chính

### 1. 📖 Đặt sách → mượn sách → trả sách

Đây là flow demo quan trọng nhất của phần thư viện:

```mermaid
sequenceDiagram
    participant C as 🙋 Customer
    participant B as 📖 Borrow Service
    participant I as 📦 Inventory Service
    participant S as 🧑‍💼 Staff

    C->>B: Tạo reservation
    B->>I: Reserve stock
    I-->>B: available_qty giảm, reserved_qty tăng
    S->>B: Confirm reservation
    S->>B: Mark READY_FOR_PICKUP
    B-->>C: Sinh pickup code/QR
    C->>S: Đưa mã nhận sách
    S->>B: Nhập/scan pickup code
    B->>I: Consume reservation
    I-->>B: reserved_qty giảm, borrowed_qty tăng
    B-->>S: Tạo loan
    S->>B: Return loan
    B->>I: Return borrowed stock
    I-->>B: borrowed_qty giảm, available_qty tăng
```

Các điểm nghiệp vụ đã xử lý:

- ✅ Customer đặt sách thì hệ thống giữ tồn kho thật.
- ✅ Staff xác nhận reservation trước khi phát sách.
- ✅ Khi `READY_FOR_PICKUP`, hệ thống tạo pickup code.
- ✅ Staff nhập mã hoặc scan QR để convert reservation thành loan.
- ✅ Khi mượn, tồn kho chuyển từ `reserved_qty` sang `borrowed_qty`.
- ✅ Khi trả, tồn kho được phục hồi về `available_qty`.
- ✅ Quá hạn, mất hoặc hư sách sẽ sinh fine.
- ✅ Reservation hết hạn được job tự động release stock.

### 2. 📲 Pickup code / QR code

Pickup code giúp staff phát đúng sách cho đúng reservation:

- Mã có dạng `PU-XXXX-XXXX`.
- QR payload có dạng `SMARTBOOK:PICKUP:PU-XXXX-XXXX`.
- Customer nhìn thấy mã trong My Reservations.
- Staff dùng ô Pickup Counter để nhập mã hoặc mở modal scan QR.
- Reservation `READY_FOR_PICKUP` không được convert trực tiếp bằng id; bắt buộc dùng pickup code.
- Sau khi convert thành loan, hệ thống lưu `pickup_code_used_at`.

Endpoint chính:

```http
POST /borrow/reservations/pickup/convert-to-loan
Content-Type: application/json

{
  "pickup_code": "SMARTBOOK:PICKUP:PU-XXXX-XXXX"
}
```

### 3. 💸 Fine và xử lý vi phạm

Borrow Service tự tạo fine cho các trường hợp:

- `OVERDUE`: sách quá hạn.
- `LOST`: sách bị mất.
- `DAMAGE`: sách bị hư/hỏng.

Fine có thể được thanh toán, thanh toán một phần hoặc waive/reduce.

### 4. 🛒 Mua hàng → nhà cung cấp → nhập kho

Đây là flow demo quan trọng nhất của phần kho vận:

```text
Purchase Request (staff tạo)
→ Manager approve → convert thành Purchase Order
→ submit → manager approve
→ gửi cho nhà cung cấp (send-to-supplier)
→ nhà cung cấp xác nhận + gửi hóa đơn/phiếu giao hàng
→ warehouse staff tạo Goods Receipt (draft) từ hóa đơn
→ staff post Goods Receipt
→ tồn kho tăng
→ putaway: xếp hàng vào đúng vị trí kệ
```

Quy tắc nghiệp vụ:

- ❌ Approve Purchase Order không tự tạo tồn kho hay goods receipt.
- ✅ Tồn kho chỉ tăng khi Goods Receipt được **post**.
- 📄 Goods Receipt cho một PO phải xuất phát từ hóa đơn/phiếu giao hàng của nhà cung cấp.
- 🚫 Over-receiving (nhận nhiều hơn đặt) bị chặn ở backend.
- ⚠️ Thiếu hàng được ghi nhận thành shortage report riêng, không tự trừ vào PO.

### 5. 🔧 Supplier Portal / xử lý thiếu hàng & giao bù

```text
Manager approve PO
→ Purchase staff gửi cho nhà cung cấp
→ Nhà cung cấp xác nhận
→ Nhà cung cấp nộp hóa đơn/phiếu giao hàng
→ Warehouse staff tạo Goods Receipt (draft) từ hóa đơn
→ Staff post Goods Receipt
→ Sinh shortage report nếu số lượng kiểm đếm bị thiếu
→ Nhà cung cấp acknowledge shortage
→ Nhà cung cấp nộp hóa đơn giao bù (redelivery)
→ Staff nhận hàng giao bù, resolve shortage
```

Quy tắc nghiệp vụ:

- 🚚 Nhà cung cấp chỉ được xác nhận đơn và nộp hóa đơn/phiếu giao hàng/phiếu giao bù.
- ❌ Nhà cung cấp không được tạo, post Goods Receipt, hay sửa tồn kho.
- ✅ Tồn kho chỉ tăng khi Goods Receipt ở trạng thái `POSTED`; `DRAFT` không ảnh hưởng tồn kho.
- 🚫 Số lượng trên hóa đơn nhà cung cấp không được vượt số lượng còn lại của PO.
- 🚫 Số lượng giao bù không được vượt số lượng trong shortage report hoặc số lượng còn lại của PO.
- 🚫 Staff nhận hàng từ hóa đơn nhà cung cấp không được nhận nhiều hơn số trên hóa đơn hoặc số còn lại của PO.
- 👀 Shortage report hiển thị cho cả staff và nhà cung cấp; có thể gửi, acknowledge, giao bù và resolve.

## 🧱 Service Catalog

| Service | Cổng local | Vai trò | Endpoint tiêu biểu |
|---|---:|---|---|
| 🖥️ Web UI | 5173 | Giao diện admin/staff/kho vận/customer | Dashboard, Catalog, Borrow, Kho vận, IAM, Customer Portal |
| 🚪 API Gateway | 3000 | Cổng vào tập trung + WebSocket | `/health`, `/auth`, `/iam`, `/api`, `/borrow`, `/analytics`, `/ai`, `socket.io` |
| 🔐 Auth Service | 3004 → 3002 | Xác thực và phân quyền | `/auth/login`, `/auth/me`, `/iam/users`, `/iam/roles` |
| 📦 Inventory Service | 3003 → 3001 | Catalog, tồn kho, mua hàng, kho vận | `/api/books`, `/api/warehouses`, `/api/purchase-orders`, `/api/picking`, `/api/packing`, `/api/borrow-integration/*` |
| 📖 Borrow Service | 3005 | Lưu thông sách | `/borrow/reservations`, `/borrow/loans`, `/borrow/fines`, `/my/*` |
| 🤖 AI Service | 8000 | OCR/metadata enrichment | `/health`, `/lookup-book-by-isbn`, `/scan-receipt`, `/assistant` |
| 📊 Analytics Service | 3006 | Báo cáo/KPI từ dữ liệu thật | `/analytics/dashboard/kpis`, `/analytics/borrow-trends`, `/analytics/top-books` |
| 🐘 PostgreSQL | 5432 | Lưu dữ liệu | `auth_db`, `inventory_db`, `borrow_db` |
| ⚡ Redis | 6379 | Cache cho Auth/Inventory Service | Không có UI |
| 🛠️ pgAdmin | 8080 | Quản trị database | Web UI |
| 🦙 Ollama | 11434 | Local LLM runtime | inference nội bộ |

## 🛠️ Công Nghệ Sử Dụng

**⚙️ Backend**

- Node.js, Express.
- Prisma ORM.
- PostgreSQL.
- Redis (cache).
- JWT, permission middleware.
- Socket.IO (real-time), `http-proxy-middleware` (API Gateway).

**🎨 Frontend**

- React.
- Vite.
- TypeScript.
- Tailwind-style utility classes.
- `qrcode` để render QR thật.
- `html5-qrcode` để scan camera/manual input.

**🤖 AI**

- FastAPI.
- Ollama (mặc định `llama3.1:8b-instruct-q4_0` cho text, `llava` cho ảnh), fallback Anthropic Claude.
- OCR/metadata lookup (Google Books, Open Library, marketplace scraping).

**🐳 DevOps**

- Docker Compose.
- pgAdmin.
- Seed data theo từng service.

## 🐳 Chạy Project Bằng Docker

### 1️⃣ Chuẩn bị env an toàn

```powershell
pnpm install --frozen-lockfile
pnpm demo:env
```

Lệnh này sinh `.env` với password, JWT secret và internal key ngẫu nhiên. Không dùng trực tiếp các placeholder `GENERATE_*` trong `.env.example`; mọi service sẽ từ chối khởi động nếu secret thiếu hoặc là giá trị mẫu.

Các biến quan trọng:

- `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`
- `AUTH_DB_NAME`, `INVENTORY_DB_NAME`, `BORROW_DB_NAME`
- `JWT_SECRET`, `INTERNAL_SERVICE_KEY`
- `ANALYTICS_SERVICE_URL`, `LOW_STOCK_THRESHOLD`
- `VITE_API_BASE_URL`, `VITE_AUTH_BASE_URL`, `VITE_AI_BASE_URL`
- `ALLOWED_ORIGINS`, `SOCKET_CORS_ORIGIN`
- `OLLAMA_HOST`, `SUMMARY_MODEL` (chỉ cần khi bật profile AI)

### 2️⃣ Chạy toàn bộ stack

```powershell
docker compose up -d --build
pnpm demo:seed
pnpm demo:status
docker compose ps
```

Migration chạy khi service khởi động; seed là bước riêng, có thể chạy lại bằng `pnpm demo:seed`. Restart container không tự seed và không ghi đè dữ liệu. Để reset hoàn toàn dữ liệu demo:

```powershell
docker compose down -v
docker compose up -d --build
pnpm demo:seed
```

AI là tính năng tùy chọn. Stack thư viện/kho vận mặc định không chờ Ollama. Khi chưa bật AI, Gateway vẫn healthy/ready và giao diện báo AI tạm thời không khả dụng. Bật AI sau khi nghiệp vụ lõi đã sẵn sàng:

```powershell
docker compose --profile ai up -d --build ai-service ollama
docker compose exec ollama ollama pull llama3.1:8b-instruct-q4_0
```

pgAdmin chỉ bật khi cần quản trị DB:

```powershell
docker compose --profile tools up -d pgadmin
```

Khi chỉ cần rebuild các service vừa chỉnh:

```powershell
docker compose build borrow-service analytics-service api-gateway smartbook-ui
docker compose up -d borrow-service analytics-service api-gateway smartbook-ui
```

Ba database, Redis và các service nội bộ chỉ nằm trong Docker network; host chỉ truy cập Web UI, API Gateway và pgAdmin khi profile `tools` được bật.

### 3️⃣ URL local

| Thành phần | URL |
|---|---|
| 🖥️ Web UI | http://localhost:5173 |
| 🚪 API Gateway | http://localhost:3000 |
| ❤️ Liveness | http://localhost:3000/health |
| ✅ Readiness nghiệp vụ lõi | http://localhost:3000/ready |
| 🛠️ pgAdmin (profile `tools`) | http://localhost:8080 |

`GET /health` công khai chỉ trả `service`, `status`, `version`. `GET /ready` mới kiểm tra dependency và không công khai URL/topology nội bộ.

## 🔑 Tài Khoản Demo

Seed Auth Service tạo các user demo với mật khẩu chung:

```text
123456
```

**👥 Tài khoản quản trị/nhân viên**

| Username | Vai trò |
|---|---|
| `hung` | 👑 Admin / superuser |
| `manager01` | 🧑‍💼 Manager |
| `staff01` | 🧑‍💻 Staff |
| `staff02` | 🧑‍💻 Staff |
| `staff03` | 🧑‍💻 Staff |
| `warehouse01` | 📦 Warehouse staff |
| `cs01` | 🎧 Customer support |

**🚚 Tài khoản nhà cung cấp** (đăng nhập tại `/login`, tự động vào `/supplier`)

| Username | Mật khẩu |
|---|---|
| `supplier-sv` | `123456` |
| `supplier-phuongnam` | `123456` |
| `supplier-ibd` | `123456` |

> [!WARNING]
> Đây là mật khẩu demo dùng chung cho môi trường local/seed. Tài khoản nhà cung cấp chỉ có quyền `supplier.portal.*`, không truy cập được các endpoint nhận/sửa tồn kho; quyền truy cập được ràng buộc theo email đăng nhập khớp với email nhà cung cấp trong Inventory Service.

## 🧪 Kiểm Thử

Quality gate duy nhất dùng ở local và CI:

```powershell
pnpm verify
```

Sau khi dựng và seed stack sạch, chạy ba golden flow theo đúng thứ tự RBAC, mua hàng/nhập kho và đặt/mượn/trả:

```powershell
pnpm test:smoke
```

Các file kết quả cũ không được commit; kết quả chỉ có giá trị khi được tái tạo từ lệnh kiểm thử hiện tại.

### ✅ Purchase Order → Supplier Fulfillment → Goods Receipt

![purchase-supplier-receiving](https://img.shields.io/badge/purchase--supplier--receiving-13%2F13%20PASS-brightgreen)

<details>
<summary>Xem lệnh chạy &amp; kết quả</summary>

Flow nghiệp vụ chi tiết xem ở mục [🛒 Mua hàng → nhà cung cấp → nhập kho](#4-mua-hàng---nhà-cung-cấp---nhập-kho).

```powershell
node scripts\purchase-supplier-receiving-integration.mjs
```

Expected summary:

```text
PASS=13 TOTAL=13
```

</details>

### ✅ Supplier Portal / Shortage Redelivery

![supplier-portal](https://img.shields.io/badge/supplier--portal-22%2F22%20PASS-brightgreen)

<details>
<summary>Xem lệnh chạy &amp; kết quả</summary>

Supplier Portal hỗ trợ 2 kênh truy cập cho nhà cung cấp (xem [🚚 Nhà cung cấp / Supplier Portal](#nhà-cung-cấp--supplier-portal) và [luồng Supplier Portal](#5-supplier-portal--xử-lý-thiếu-hàng--giao-bù)):

- Tài khoản nhà cung cấp: đăng nhập tại `/login`, được route tới `/supplier`.
- Token công khai: staff mở `/supplier/portal/:token` từ link dispatch của PO.

Frontend entry points:

```text
/supplier
/supplier/portal/:token
/supplier-deliveries
/supplier-deliveries/:id
/purchase-orders/:id
```

```powershell
node scripts\supplier-portal-integration.mjs
```

Expected summary:

```text
PASS=22 TOTAL=22
```

</details>

### ✅ Admin User Management integration

![admin-user-management](https://img.shields.io/badge/admin--user--management-14%2F14%20PASS-brightgreen)

<details>
<summary>Xem lệnh chạy &amp; kết quả</summary>

Admin user management is tested through the API Gateway. The flow covers
creating a user with role IDs, logging in with the newly created password,
checking roles/permissions from `/auth/me`, updating roles, locking the user,
and validation failures for missing email, short password, invalid roles, and
duplicate username/email.

```powershell
node scripts\admin-user-management-integration.mjs
```

Expected summary:

```text
PASS=14 TOTAL=14
```

</details>

### ✅ Analytics dashboard integration

![analytics](https://img.shields.io/badge/analytics-7%2F7%20PASS-brightgreen)

<details>
<summary>Xem lệnh chạy &amp; kết quả</summary>

Script này đăng nhập bằng tài khoản staff demo, gọi đủ 7 endpoint `/analytics` qua API Gateway, kiểm tra response có field `data`, kiểm tra kiểu dữ liệu cơ bản và xác nhận customer token bị chặn 403:

```powershell
node scripts\analytics-integration.mjs
```

Kết quả mong đợi:

```text
PASS analytics/dashboard/kpis
PASS analytics/borrow-trends
PASS analytics/top-books
PASS analytics/overdue-summary
PASS analytics/fine-summary
PASS analytics/warehouse-stock-risk
PASS analytics/reservation-funnel
PASS analytics/customer-denied
PASS=7 TOTAL=7
ACCESS=1 TOTAL=1
```

</details>

### ✅ AI Assistant (chatbot hỗ trợ ra quyết định) integration

<details>
<summary>Xem lệnh chạy &amp; kết quả</summary>

Script này đăng nhập bằng tài khoản manager demo, gọi `POST /ai/assistant` qua API Gateway với các câu hỏi tiếng Việt, kiểm tra tool-calling thật sự được gọi (không hard-code intent), kiểm tra customer token bị chặn 403, và kiểm tra hành vi từ chối với câu hỏi ngoài phạm vi. Yêu cầu model `ASSISTANT_MODEL` đã được pull trong Ollama trước:

```powershell
docker compose exec ollama ollama pull llama3.1:8b-instruct-q4_0
node scripts\ai-assistant-integration.mjs
```

Kết quả mong đợi:

```text
PASS assistant/reorder-suggestions-question
PASS assistant/overdue-fine-question
PASS assistant/customer-denied
PASS assistant/out-of-scope-refusal
PASS=4 TOTAL=4
```

> [!NOTE]
> Case cuối (`out-of-scope-refusal`) phụ thuộc hành vi của LLM nên có thể in `WARN` thay vì `PASS` nếu model vẫn gọi tool cho câu hỏi ngoài phạm vi — script vẫn tính là pass ở mức "endpoint hoạt động đúng", đây là kiểm tra best-effort.

</details>

### ✅ Borrow phase 2 integration

![borrow-phase2](https://img.shields.io/badge/borrow--phase2-15%2F15%20PASS-brightgreen)

<details>
<summary>Xem lệnh chạy &amp; kết quả</summary>

Script này kiểm tra flow borrow/fine chính qua API Gateway:

```powershell
$env:TEST_VARIANT_ID='36c746bb-6c0f-459e-b5e6-62759ca94de7'
$env:TEST_WAREHOUSE_ID='bae473df-be73-4e30-9348-5557217638ef'
node scripts\borrow-phase2-integration.mjs
```

Kết quả gần nhất:

```text
PASS=15 TOTAL=15
```

</details>

### ✅ Pickup code / QR flow

![pickup-code](https://img.shields.io/badge/pickup--code-19%2F19%20PASS-brightgreen)

<details>
<summary>Xem lệnh chạy &amp; kết quả</summary>

Flow pickup code đã được test end-to-end trên Docker:

- ✅ UI container response: pass.
- ✅ Customer tạo reservation: pass.
- ✅ Inventory chuyển `available_qty → reserved_qty`: pass.
- ✅ Staff confirm và mark `READY_FOR_PICKUP`: pass.
- ✅ Hệ thống sinh pickup code: pass.
- ✅ Customer nhìn thấy pickup code: pass.
- ✅ Convert không có code bị chặn: pass.
- ✅ Convert bằng QR payload thành loan: pass.
- ✅ Inventory chuyển `reserved_qty → borrowed_qty`: pass.
- ✅ Return loan phục hồi tồn kho: pass.

Kết quả gần nhất:

```text
Pickup code docker test: 19/19 passed
```

</details>

## 🗃️ Cấu Trúc Thư Mục

```text
smartbook-system/
|- apps/
|  |- api-gateway/
|  \- web/
|- services/
|  |- auth-service/
|  |- inventory-service/
|  |- borrow-service/
|  |- ai-service/
|  \- analytics-service/
|- packages/
|  \- shared/
|- db-init/
|- docs/
|  |- ARCHITECTURE/
|  |- SERVICES/
|  |- ANALYSIS/
|  \- TEST_GUIDES/
|- scripts/
|- docker-compose.yml
\- README.md
```

## 📚 Tài Liệu Tham Khảo

- 🏗️ Tổng quan kiến trúc: `docs/ARCHITECTURE/PROJECT_OVERVIEW.md`
- 🐳 Hướng dẫn Docker: `docs/RUN_WITH_DOCKER.md`
- 🔐 Auth Service: `docs/SERVICES/AUTH_SERVICE.md`
- 📦 Inventory Service: `docs/SERVICES/INVENTORY_SERVICE.md`
- 📖 Borrow Service: `docs/SERVICES/BORROW_SERVICE.md`
- 🤖 AI Service: `docs/SERVICES/AI_SERVICE.md`
- 📊 Analytics Dashboard: `scripts/analytics-integration.mjs`, `/analytics/*`
- 🧪 Test guides: `docs/TEST_GUIDES/`

## 📝 Ghi Chú Phát Triển

- 🧩 Mỗi service nên sở hữu dữ liệu của domain mình, hạn chế truy vấn chéo database trực tiếp trong business code (ngoại lệ duy nhất là Analytics Service).
- 🔗 Các flow ảnh hưởng tồn kho phải đi qua API tích hợp giữa Borrow Service và Inventory Service, hoặc qua vòng đời goods receipt/putaway/picking/packing — không cập nhật `stock_balances` trực tiếp từ nơi khác.
- 🔁 Các thao tác tạo/cancel/convert/return nên dùng `Idempotency-Key` để tránh double-processing.
- 📲 Reservation `READY_FOR_PICKUP` phải được convert bằng pickup code hoặc QR payload.
- 🚫 Nhà cung cấp không bao giờ được cấp quyền tạo/post goods receipt hay sửa tồn kho, dù qua supplier account hay supplier portal token.
- 🐛 Khi debug tồn kho, kiểm tra bảng `stock_balances` trong `inventory_db` với ba trường chính: `available_qty`, `reserved_qty`, `borrowed_qty`.

---

<div align="center">

🎓 **SmartBook System** — Đồ án tốt nghiệp (KLTN), Nhóm 9

</div>
