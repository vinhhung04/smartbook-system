# SmartBook Public Discovery Website

Biến SmartBook từ "đăng nhập → customer portal → tìm sách" thành website thư viện mà khách
chưa có tài khoản vẫn khám phá được; chỉ yêu cầu đăng nhập khi thực hiện hành động cá nhân.

```
Trang chủ công khai → Khám phá / Tìm kiếm / Thể loại / Phổ biến / Sách mới
  → Chi tiết sách → "Đặt mượn" → (chưa đăng nhập) Login/Register
  → quay lại đúng cuốn sách (?reserve=1) → mở bước đặt trước → Customer Portal
```

## 1. Vấn đề của UX cũ (kết quả audit)

| # | Hiện trạng trước thay đổi |
|---|---|
| 1 | `/` là dashboard nhân viên (`requireAuthLoader`); khách vào là bị đẩy về `/login`. |
| 2 | Mọi trang bạn đọc nằm dưới `/customer/*` và đều cần đăng nhập — kể cả danh mục và chi tiết sách. |
| 3 | Đăng nhập xong luôn về `/customer`; không có returnUrl nên mất ngữ cảnh cuốn sách đang xem. |
| 4 | Catalog khách hàng (`/catalog/books` → inventory `/api/books`) trả **`unit_cost`, `list_price`, SKU/barcode nội bộ, mã vị trí kệ** cho mọi tài khoản có `inventory.catalog.read` (kể cả CUSTOMER). Không thể public endpoint này. |
| 5 | Đánh giá sách (`/borrow/reviews/*`) cần JWT và trả `customer_code`, họ tên đầy đủ. |
| 6 | Catalog tải toàn bộ sách, lọc trong RAM, không phân trang, tìm kiếm có phân biệt dấu. |
| 7 | Phân bố sao trên trang chi tiết tính từ 10 review của trang hiện tại, không phải toàn bộ. |
| 8 | Hybrid search (pgvector + full-text, RRF) chỉ dùng trong trợ lý AI/cover search; Recommendation V2 phụ thuộc token người dùng. |
| 9 | Customer catalog/detail và public discovery sẽ trùng lặp nếu giữ cả hai. |

Dữ liệu tuyệt đối không public: giá vốn/giá niêm yết, SKU/barcode nội bộ, mã vị trí/kệ, tồn ở khu receiving/staging,
supplier, stock movement, ghi chú nội bộ, metadata provenance, mã/ID/họ tên đầy đủ khách hàng.

## 2. Kiến trúc mới

Không tạo frontend mới — vẫn `apps/web` (React + Vite), chia router thành hai layout pathless:

```
apps/web
 ├─ PublicLayout  (/ , /books, /search, /books/:id, /categories, /categories/:slug, /discover, /about)
 ├─ CustomerLayout (/customer/*)   ← giữ nguyên auth, nay redirect kèm returnUrl
 └─ AppLayout (staff, pathless)    ← dashboard chuyển từ / sang /dashboard; RBAC giữ nguyên

api-gateway  /public/*  (GET/HEAD only, rate limit riêng, chặn dot-segment)
 ├─ /public/catalog/*  → inventory-service /public/catalog/*   (read model whitelist + cache)
 ├─ /public/reviews/*  → borrow-service   /public/reviews/*    (ẩn danh hoá người đánh giá)
 └─ /public/discover   → ai-service       /public/discover     (hybrid search, grounded, giới hạn chi phí)

inventory-service ──(x-internal-service-key)──► analytics-service /analytics/catalog-signals
                                                 (lượt mượn/đặt trước/yêu thích/đánh giá thật)
```

- **Popular / trending / top rated** lấy từ analytics-service — service đã được thiết kế là read model liên DB
  (inventory + borrow) và inventory đã gọi nó bằng internal key. Chỉ trả số đếm tổng hợp, không có ID khách hàng.
- **Homepage = 1 request** (`GET /public/catalog/home`). Catalog được cache snapshot 60s, signals 5 phút,
  single-flight; trang chi tiết luôn đọc tồn kho mới.
- **Không fake số liệu**: section nào không có dữ liệu thì ẩn; khi analytics lỗi, sort "Phổ biến/Đánh giá"
  tự chuyển sang "Mới nhất" và UI ghi rõ "tạm chưa có dữ liệu".

## 3. Route

| Public (không cần đăng nhập) | Cần đăng nhập |
|---|---|
| `/` trang chủ | `/customer`, `/customer/profile`, `/customer/reservations`, `/customer/loans(/:id)`, `/customer/fines`, `/customer/wishlist`, `/customer/notifications`, `/customer/recommendations`, `/customer/membership`, `/customer/reading-analytics`, `/customer/scan-cover`, `/customer/support` |
| `/books` (lọc, sắp xếp, phân trang qua URL) | Alias `/my`, `/my/:section` → `/customer/:section` (`/my/wallet` → `/customer/fines`) |
| `/search?q=` | Toàn bộ route nhân viên (`/dashboard`, `/inventory`, `/borrow/*`, …) — redirect `/login?returnUrl=` |
| `/books/:id` | |
| `/categories`, `/categories/:slug` | |
| `/discover?q=` (AI "Không biết nên đọc gì?") | |
| `/about` | |
| `/new-arrivals` → `/books?sort=newest`, `/popular` → `/books?sort=popular` | |
| `/customer/books(/:id)` → redirect sang `/books(/:id)` (giữ link cũ) | |

## 4. API được public (chỉ đọc)

| Endpoint | Mô tả |
|---|---|
| `GET /public/catalog/home` | stats, trending, most_borrowed, top_rated, new_arrivals, categories |
| `GET /public/catalog/books` | `q, category(slug), author, publisher, language, year, availability=available, sort=relevance\|popular\|newest\|rating\|title, page, pageSize(≤48), ids` + facets |
| `GET /public/catalog/books/:id` | chi tiết (mô tả, tóm tắt AI, ISBN-13/10, số trang, NXB, năm, lần XB, thể loại, chi nhánh còn sách) + sách cùng thể loại |
| `GET /public/catalog/categories` | thể loại có sách, số đầu sách, số đang có trên kệ |
| `GET /public/reviews/book/:bookId` | review hiển thị, tên dạng "An N.", phân bố sao trên toàn bộ review |
| `GET /public/reviews/stats?bookIds=` | điểm trung bình/số review (không PII) |
| `GET /public/discover?q=` | gợi ý AI grounded trên catalog |
| `GET /analytics/catalog-signals` | **internal** (internal key hoặc quyền analytics) — không qua `/public` |

Vẫn bắt buộc đăng nhập: `POST /my/reservations`, `POST /my/wishlists`, `POST /my/reviews`, loan/fine/VNPay/wallet/profile/notification.

## 5. Biện pháp bảo mật

- **Whitelist ở tầng dữ liệu**: `PUBLIC_BOOK_SELECT` không hề select `unit_cost`, `list_price`, `sku`, `internal_barcode`,
  `location_code`; mapper riêng (không dùng `mapBookSummary`). Test kiểm tra cả câu select lẫn JSON trả ra.
- Chỉ sách `is_active` và không phải placeholder `is_incomplete`; chỉ biến thể `is_borrowable`; tồn receiving/staging
  chỉ hiện là "Đang nhập kho"; chi nhánh chỉ lộ tên + số bản sẵn sàng (cần cho đặt trước).
- Gateway: `/public` chỉ GET/HEAD (405 cho method khác), rate limit 300 req/5 phút/IP (`PUBLIC_RATE_LIMIT_MAX`),
  từ chối `..`/`%2e%2e` (400), prefix lạ dưới `/public` → 404, không proxy tới service khác.
- Review công khai không trả `customer_id`, `customer_code`, họ tên đầy đủ; ID không phải UUID bị từ chối trước khi chạm DB.
- AI discover: per-IP 6/phút + 40/giờ ở gateway, trần toàn hệ thống 30/phút + 300/giờ ở ai-service (chỉ tính khi
  cache miss), cache truy vấn 10 phút, không gọi LLM sinh văn bản (không thể bịa sách), kết quả phải được inventory
  public catalog xác nhận lại; lỗi/quá tải → UI tự chuyển sang tìm theo từ khóa.
- `returnUrl` chỉ nhận đường dẫn cùng origin (chặn `//evil.com`, `https://…`, `/\…`, ký tự điều khiển, vòng lặp login).
- Client public dùng axios riêng không gắn token — token hết hạn không làm hỏng việc duyệt sách.

## 6. Test đã thêm

| File | Nội dung |
|---|---|
| `services/inventory-service/test/public-catalog.test.js` (17) | router chỉ GET; select không chứa trường nội bộ; whitelist JSON; tồn kho shelf vs receiving; biến thể không cho mượn/chi nhánh đóng; placeholder; tìm không dấu theo tác giả/ISBN; filter/sort/phân trang; giới hạn pageSize; home không độn số 0; trending không lặp bảng mượn nhiều; analytics sập vẫn chạy; ID không hợp lệ; cache single-flight; filter `ids` |
| `services/analytics-service/test/catalog-signals.test.js` (4) | gộp variant→book, bỏ variant mồ côi, rating làm tròn, không có trường khách hàng |
| `services/borrow-service/test/public-reviews.test.js` (5) | router chỉ GET; che tên; không select/trả customer id/code; phân bố sao toàn bộ; từ chối ID sai |
| `apps/api-gateway/test/gateway-contract.test.js` (+2) | `/public` read-only + rate limit + chỉ catalog/reviews/discover; discover có limiter riêng và degrade |
| `services/ai-service/test_public_discover.py` (8) | chỉ trả sách được catalog xác nhận; abstain không gọi catalog; cache; trần chi phí 429; lỗi → 503; query quá ngắn |
| `apps/web/e2e/public-discovery.spec.ts` (7) | anonymous: home → catalog → search (URL, refresh giữ state) → detail → reserve → login có returnUrl; login → quay lại sách + mở dialog đặt trước; `/customer/*`, `/my/*`, route staff redirect kèm returnUrl; API GET 200 không lộ trường nội bộ; POST reservation/wishlist/review → 401/403; POST/DELETE `/public` → 405; `/catalog/books` vẫn cần token; customer thấy nav tài khoản; staff có lối về trang quản lý |

Kết quả chạy (stack Docker thật + dữ liệu demo): Node 296 test pass, AI 669 pass, workspace 38 pass,
E2E 12 pass (7 mới + `auth` + 2 spec đặt trước có sẵn — xác nhận đặt trước qua catalog công khai vẫn chạy).

## 7. Cách chạy test

```bash
pnpm test:node
pnpm test:ai
pnpm --filter web exec tsc --noEmit
pnpm lint
pnpm build
```

E2E (cần stack đang chạy, xem `apps/web/e2e/README.md`):

```bash
docker compose up -d --build db redis rabbitmq auth-service inventory-service borrow-service analytics-service api-gateway ai-service
pnpm --filter web dev
cd apps/web && npx playwright test e2e/public-discovery.spec.ts
```

`GATEWAY_URL` (mặc định `http://localhost:3000`) và `BASE_URL` (mặc định `http://localhost:5173`) có thể đổi qua biến môi trường.

## 8. Màn hình chính

- **Trang chủ**: hero "Khám phá cuốn sách tiếp theo của bạn." + ô tìm kiếm lớn; bên phải là *kệ sách thật* —
  ảnh bìa các đầu sách thư viện đang có. Sau đó: Đang được yêu thích (90 ngày) · Dành riêng cho bạn (chỉ khi đăng nhập,
  Recommendation V2) · Sách mới về · "Không biết nên đọc gì?" · Thể loại · Được mượn nhiều (bảng xếp hạng có số lượt) ·
  Bạn đọc đánh giá cao · Mượn sách thế nào? Mỗi section ghi rõ căn cứ xếp hạng.
- **Catalog/Search**: bộ lọc từ dữ liệu thật (thể loại, tác giả, NXB, ngôn ngữ, năm, chỉ sách đang có), sắp xếp,
  phân trang, debounce 350ms, skeleton, empty/error state, toàn bộ state trong URL.
- **Chi tiết sách**: bìa, tác giả (link lọc), đánh giá, tem tình trạng + danh sách chi nhánh còn sách, "Đặt mượn",
  "Yêu thích", giới thiệu, tóm tắt AI (có ghi chú), thông tin sách, review công khai, sách cùng thể loại.
- **Bìa chữ (typographic cover)**: sách chưa có ảnh hiển thị tên + tác giả trên nền màu bìa vải — không dùng ảnh minh hoạ giả.
- Responsive tới 375px không cuộn ngang; header thu vào menu trượt; skip-link, focus ring, `aria-current`, `aria-live`.

## 8b. Nâng cấp UX/UI (vòng 2)

| Vấn đề | Thay đổi |
|---|---|
| Phần lớn sách đang được mượn hết, trang chủ không chỉ ra sách mượn được ngay | Section đầu tiên "Có sẵn để mượn ngay" (`available_now` trong `/public/catalog/home`, chỉ sách `reservable`) |
| Phải bấm tìm mới thấy kết quả | Ô tìm kiếm có gợi ý tức thì (hero + header): ARIA combobox, ↑↓/Enter/Esc, ảnh bìa, tình trạng; không khớp → gợi ý tìm bằng AI |
| Tem "ĐÃ ĐƯỢC MƯỢN HẾT" lặp trên mọi thẻ | Tem chỉ dùng cho trạng thái hành động được (còn sách / đang nhập kho); hết sách là chữ nhạt; nút "Đặt trước" chỉ hiện khi đặt được |
| Sách hết là ngõ cụt | Nút chính "Báo khi có sách" (API availability alert có sẵn), auth-on-action như đặt mượn |
| Mobile: nút đặt mượn trôi mất, bìa chiếm cả màn hình | Thanh hành động dính đáy màn hình; bìa nhỏ lại để tiêu đề nằm trên màn hình đầu |
| Catalog không thấy bộ lọc đang áp dụng | Chip bộ lọc (xóa từng cái), công tắc "Chỉ sách có sẵn" cạnh số kết quả, bộ lọc mobile dạng bottom sheet |
| Viền ô nhập vô hình (`--input: transparent`) | Ô nhập trên trang công khai dùng `border-border bg-card` |
| Ảnh bìa lazy "nhảy" vào | Nền chờ + fade-in; bìa chữ co giãn theo container query (đọc được từ thumbnail 36px tới thẻ lớn) |
| Không quay lại được sách vừa xem | "Bạn đã xem gần đây" — lưu cục bộ trong trình duyệt (localStorage, có try/catch, có nút xóa), không gửi đi đâu |

Test thêm: `available_now` (inventory unit), typeahead bàn phím và "Báo khi có sách" → login (E2E). Tổng E2E: 14 pass.

## 9. Phase 2/3 — chưa làm

- **Tìm sách bằng ảnh bìa công khai**: hiện `/ai/find-book-by-cover` gọi OCR vision (tốn phí) kể cả khi không có token,
  và `/ai/find-book-by-cover/reindex` không có auth qua gateway `/ai/*`. Cần trước khi public: route `/public/cover-search`
  riêng, kiểm tra magic bytes + giới hạn kích thước (vd 4 MB) + resize, rate limit per-IP và trần chi phí như discover,
  lấy catalog từ public endpoint, không lưu ảnh.
- Trang `/membership` công khai (gói hội viên thật từ `membership_plans`) — cần endpoint public riêng.
- SEO sâu hơn: SPA nên crawler không chạy JS chỉ thấy meta mặc định; có thể prerender `/`, `/books/:id` hoặc sitemap động.
- Review discovery (lọc theo sao, review hữu ích), cảnh báo "báo khi có sách" ngay trên trang công khai.
- Phase 3: conversion analytics anonymous → account, cá nhân hoá discovery theo phiên.
