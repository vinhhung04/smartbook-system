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
 ├─ PublicLayout  (/ , /books, /search, /books/:id, /categories, /categories/:slug, /discover, /about,
 │                 /branches, /branches/:id, /membership)
 ├─ CustomerLayout (/customer/*)   ← giữ nguyên auth, nay redirect kèm returnUrl
 └─ AppLayout (staff, pathless)    ← dashboard chuyển từ / sang /dashboard; RBAC giữ nguyên

api-gateway  /public/*  (GET/HEAD only, rate limit riêng, chặn dot-segment)
 ├─ /public/catalog/*  → inventory-service /public/catalog/*   (read model whitelist + cache; gồm cả chi nhánh)
 ├─ /public/reviews/*  → borrow-service   /public/reviews/*    (ẩn danh hoá người đánh giá)
 ├─ /public/membership/* → borrow-service /public/membership/* (gói thẻ đang áp dụng, whitelist field)
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
| `/branches` (chi nhánh đang hoạt động) | |
| `/branches/:id` (chi tiết chi nhánh, id = UUID kho) | |
| `/membership` (thẻ bạn đọc, gói thẻ thật) | |
| `/books?branch=<id>[&availability=available]` (sách tại chi nhánh) | |
| `/new-arrivals` → `/books?sort=newest`, `/popular` → `/books?sort=popular` | |
| `/customer/books(/:id)` → redirect sang `/books(/:id)` (giữ link cũ) | |

## 4. API được public (chỉ đọc)

| Endpoint | Mô tả |
|---|---|
| `GET /public/catalog/home` | stats, trending, most_borrowed, top_rated, new_arrivals, categories |
| `GET /public/catalog/books` | `q, category(slug), branch(UUID), author, publisher, language, year, availability=available, sort=relevance\|popular\|newest\|rating\|title, page, pageSize(≤48), ids` + facets (gồm `facets.branches`) + `branch: {id,name}\|null` |
| `GET /public/catalog/books/:id` | chi tiết (mô tả, tóm tắt AI, ISBN-13/10, số trang, NXB, năm, lần XB, thể loại, chi nhánh còn sách) + sách cùng thể loại |
| `GET /public/catalog/categories` | thể loại có sách, số đầu sách, số đang có trên kệ |
| `GET /public/catalog/branches` | chi nhánh đang hoạt động: `id, name, address, stats{title_count, available_title_count, available_copies}` |
| `GET /public/catalog/branches/:id` | chi nhánh + `available_books` (đặt trước được tại đây), `new_arrivals` (sách chi nhánh giữ), `categories`; id sai/không tồn tại/đã đóng → 404 |
| `GET /public/membership/plans` | gói thẻ `is_active`: `id, name, description, max_active_loans, max_loan_days, max_renewal_count, reservation_hold_hours, fine_per_day, is_default` + `card_validity_days` |
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
- **Chi nhánh = điểm phục vụ bạn đọc, không phải mọi kho.** Chi nhánh/điểm nhận sách công khai là một tập con của bảng
  `warehouses`: chỉ kho `is_active` có `warehouse_type` thuộc `PUBLIC_PICKUP_WAREHOUSE_TYPES` = `['BRANCH', 'LIBRARY']`
  (`services/inventory-service/src/utils/constants.js` — nguồn duy nhất). `WAREHOUSE` (kho tổng, vận hành nội bộ) và
  `STORE` (cửa hàng — trong code chỉ là đích xuất `TRANSFER_TO_STORE`, không phải nơi nhận sách mượn) **không** được public,
  và tồn kho ở đó **không** được tính là có sẵn cho bạn đọc. Một hàm duy nhất `isPublicPickupWarehouse()` áp dụng rule cho:
  danh sách/chi tiết chi nhánh, bộ lọc `?branch=`, `facets.branches`, `pickup_branches`, `available_quantity`, `reservable`,
  `availability_status` (kể cả "Đang nhập kho": hàng ở khu nhận của kho tổng không tính), `available_now` trên trang chủ,
  holdings/số liệu chi nhánh — và vì modal đặt trước trên web công khai chỉ dựng từ `pickup_branches`, web công khai không
  bao giờ gửi một kho nội bộ làm nơi nhận sách. Query kho lọc ở DB (`PUBLIC_BRANCH_WHERE`) rồi kiểm lại bằng cùng hàm.
  `id` của kho nội bộ ở `/public/catalog/branches/:id` → 404, ở `?branch=` → trang rỗng `branch: null` — giống chi nhánh đã
  đóng, không tiết lộ đó là kho nội bộ. Muốn mở thêm loại (vd `STORE`) chỉ sửa hằng số này.
- `PUBLIC_BRANCH_SELECT` chỉ select `id, name, warehouse_type, is_active, address_line1/2, ward, district, province`
  (type/active chỉ để kiểm rule, `toPublicBranch` bỏ đi); JSON không bao giờ có `code`, `warehouse_type`, `manager_user_id`,
  settings, location/kệ, sức chứa, tồn receiving/staging hay stock movement. Số liệu tính trên snapshot catalog
  đã cache (1 query sách + 1 query kho mỗi TTL, không N+1). Bộ lọc `branch` chạy ở server; id sai/không tồn tại/đã đóng trả
  trang rỗng với `branch: null` (không lặng lẽ bỏ bộ lọc để trả toàn bộ catalog). "Có sẵn tại chi nhánh" = chi nhánh nằm
  trong `pickup_branches` của sách, nên sách thấy ở trang chi nhánh luôn đặt trước được tại đúng chi nhánh đó.
- **Gói thẻ**: route riêng `public-membership.routes.js` (chỉ `GET /plans`), select whitelist — không trả `code`, `created_at`,
  `updated_at`, `lost_item_fee_multiplier`, số hội viên (`_count`), gói `is_active=false`. `is_default` lấy theo đúng quy tắc
  cấp gói khi tạo tài khoản (`DEFAULT_MEMBERSHIP_PLAN_CODE`, nếu không có thì gói active cũ nhất) — không có nhãn
  "Phổ biến/Khuyên dùng". Schema không có phí/giá gói nên trang không hiển thị giá.
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

Bổ sung cho chi nhánh + thẻ bạn đọc:

| File | Nội dung |
|---|---|
| `services/inventory-service/test/public-catalog.test.js` (+7) | router có `GET /branches(/:id)`; select chi nhánh chỉ name/address; JSON không lộ code/type/manager/location/tồn; chỉ chi nhánh active; holdings bỏ receiving/kho đóng/biến thể không cho mượn nhưng tính bản đang được mượn; detail chỉ liệt kê sách đặt được tại chi nhánh; filter `branch` kết hợp `q/category/availability/sort/page`; branch sai/đóng/chuỗi SQL → trang rỗng, không crash |
| `services/inventory-service/test/public-catalog.test.js` (+6, sửa 5) | rule loại kho: chỉ `BRANCH`/`LIBRARY` active (không `WAREHOUSE`, `STORE`, đã đóng, thiếu type); `WAREHOUSE 10 + BRANCH 0` → `reservable=false, available_quantity=0, pickup_branches=[]`; `WAREHOUSE 10 + BRANCH 2` → `available_quantity=2`, 1 pickup branch; hàng ở khu nhận của kho tổng không thành "Đang nhập kho"; kho tổng 100 bản không có trong `/branches`, `facets.branches`, `pickup_branches`, `available_now`, JSON; `?branch=<kho tổng/cửa hàng>` → rỗng + `branch: null`; `branch(<kho tổng>)` → null (404); `LIBRARY` active được liệt kê/lọc/đếm; danh sách vẫn đúng nếu query trả nhầm kho nội bộ. Trên code cũ 10 test fail. |
| `apps/web/e2e/public-discovery.spec.ts` (mở rộng) | mọi `pickup_branches` và `facets.branches` của catalog đều nằm trong `/public/catalog/branches`; số thẻ trên `/branches` bằng số chi nhánh API trả |
| `services/borrow-service/test/public-membership.test.js` (5) | router chỉ `GET /plans`; select không có code/audit/_count; HTTP thật: chỉ gói active, whitelist key, `fine_per_day` là số, `Cache-Control: public`; `is_default` theo `DEFAULT_MEMBERSHIP_PLAN_CODE` rồi gói cũ nhất; POST/PUT/PATCH/DELETE không có route; DB lỗi → 500 không lộ lỗi |
| `apps/api-gateway/test/gateway-contract.test.js` (+1) | `/public/membership` proxy tới borrow-service, nằm sau guard GET/HEAD và trước 404 của `/public` |
| `apps/web/e2e/public-discovery.spec.ts` (+4, mở rộng 2) | anonymous: header → `/branches` → chi nhánh → "Khám phá sách tại chi nhánh này" → URL giữ `branch` + `sort` sau reload → chi tiết sách → link chi nhánh nhận sách quay lại `/branches/:id`, không bị đẩy login; branch không tồn tại → empty state; `/membership` hiện đúng tên gói từ API, "Tạo tài khoản" → `/customer/register?returnUrl=%2Fcustomer%2Fmembership`; customer → `/customer/membership`; API: branches/plans không lộ trường nội bộ, POST/PUT `/public/membership`, DELETE `/public/catalog/branches` → 405 |

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

## 8c. Chi nhánh và thẻ bạn đọc

- **`/branches`**: thẻ cho từng chi nhánh active — tên, trạng thái "Đang hoạt động" (chữ + chấm, không chỉ dựa vào màu),
  địa chỉ ("Địa chỉ đang được cập nhật" nếu trống), số đầu sách và số đầu sách có sẵn; CTA "Xem sách tại chi nhánh"
  (`/books?branch=<id>&availability=available`, hoặc bỏ `availability` khi mọi bản đang được mượn để không thành ngõ cụt) và
  "Xem chi tiết". Chi nhánh chưa có sách → chữ "Chi nhánh chưa có sách trên kệ", không hiện số 0 vô nghĩa.
- **Dữ liệu demo**: trước đây mọi bản sách trên kệ trong seed nằm ở 2 kho `WAREHOUSE`, còn 2 kho `BRANCH` không có kệ nào.
  Seed inventory nay tạo kệ `BR-SHELF-01` cho mỗi chi nhánh và đặt bản sách lên đó (D1: 6 variant, D3: 6 variant, 1 variant
  có ở cả hai). Tồn kho tổng giữ nguyên (vẫn dùng cho nhập/putaway nội bộ) nhưng không hiện trên web.
- **`/branches/:id`**: breadcrumb, `PageHero`, ba số liệu, hàng "Có sẵn tại chi nhánh" (đặt trước ngay), "Sách khác tại chi
  nhánh", thể loại tại chi nhánh (link `/books?branch=…&category=…`), CTA "Khám phá sách tại chi nhánh này". 404/lỗi/rỗng có
  trạng thái riêng.
- **Catalog**: tham số `branch` trong URL, select "Chi nhánh" trong bộ lọc (từ `facets.branches`), chip xoá được, đổi chi
  nhánh reset về trang 1, tiêu đề "Sách tại …" + breadcrumb, công tắc đổi thành "Có sẵn tại chi nhánh".
- **Chi tiết sách**: tên chi nhánh trong "Chi nhánh còn sách" là link sang `/branches/:id` (logic đặt trước không đổi).
- **`/membership`**: hero với CTA theo vai trò (khách: "Tạo tài khoản" → `/customer/register?returnUrl=/customer/membership`
  + "Khám phá sách trước" + đăng nhập; CUSTOMER: "Xem thẻ bạn đọc của tôi"; nhân viên: "Khám phá sách", lối về trang quản lý
  vẫn ở header). 7 quyền lợi có thật (đặt trước, phiếu mượn + gia hạn, yêu thích, đánh giá, gợi ý cá nhân, thông báo, phí trễ hạn
  + VNPay). Gói thẻ từ API: 1 gói → một thẻ rộng, nhiều gói → lưới so sánh; nhãn duy nhất là "Cấp khi tạo tài khoản"
  (theo quy tắc thật). Không có gói → empty state, quyền lợi vẫn hiển thị. "Mượn sách thế nào?" dùng lại `HowBorrowingWorks`
  (thêm prop `steps` cho 4 bước).
- **Điều hướng**: header = Khám phá · Thể loại · Chi nhánh · AI gợi ý · Về SmartBook (khách/nhân viên) hoặc · Gợi ý cho bạn ·
  Sách của tôi (bạn đọc); logo về trang chủ; ô tìm ở header ẩn ở 1024–1279px để không tràn. Menu mobile thêm "Quyền lợi thẻ bạn
  đọc". Footer 3 cột: Khám phá (Sách, Thể loại, Sách mới về, AI gợi ý), Thư viện (Chi nhánh, Thẻ bạn đọc, Về SmartBook),
  Hỗ trợ (Cách mượn sách, Đăng nhập/Đăng ký hoặc Sách của tôi, Đăng nhập nhân viên).
- SEO: `usePageMeta` — "Chi nhánh thư viện", "<tên chi nhánh>" (mô tả có địa chỉ), "Sách tại <chi nhánh>", "Thẻ bạn đọc".

## 9. Phase 2/3 — chưa làm

- **Tìm sách bằng ảnh bìa công khai**: hiện `/ai/find-book-by-cover` gọi OCR vision (tốn phí) kể cả khi không có token,
  và `/ai/find-book-by-cover/reindex` không có auth qua gateway `/ai/*`. Cần trước khi public: route `/public/cover-search`
  riêng, kiểm tra magic bytes + giới hạn kích thước (vd 4 MB) + resize, rate limit per-IP và trần chi phí như discover,
  lấy catalog từ public endpoint, không lưu ảnh.
- **Chi nhánh — dữ liệu còn thiếu**: bảng `warehouses` chưa có số điện thoại, giờ mở cửa, slug hay toạ độ. Trang `/branches`
  chỉ hiện dữ liệu đang có (tên, địa chỉ, số sách) và không bịa thêm. Muốn hiển thị cần migration thêm cột (vd `phone`,
  `opening_hours` JSON, `slug` unique), form nhập ở trang quản lý kho, seed, rồi thêm vào `PUBLIC_BRANCH_SELECT` + test.
- **Rule điểm nhận sách ở backend đặt trước — đã áp cho bạn đọc**: `POST /my/reservations` gắn `reservation_channel=CUSTOMER`
  (đặt ở server, không đọc từ body) khi gọi inventory; `getAvailability` và `reserveFromBorrow` khi đó kiểm tra kho bằng cùng
  `isPublicPickupWarehouse()` (`src/utils/public-pickup-warehouse.js`) và trả 409 "Selected warehouse is not a valid pickup
  location" trước khi giữ hàng. Màn `/customer/scan-cover` chỉ đưa các `locations` nằm trong `/public/catalog/branches`.
  Nhân viên (đặt hộ ở trang quản lý, mượn tại quầy) không gửi kênh nên vẫn dùng mọi kho. Còn lại: app mobile đặt tại
  `default_warehouse_id` của catalog có xác thực — nếu đó là kho nội bộ, backend sẽ từ chối (409) thay vì đề xuất chi nhánh.
- **Gói thẻ — dữ liệu còn thiếu**: `membership_plans` không có phí/giá và thời hạn riêng từng gói (thẻ cấp khi đăng ký có hạn
  `DEFAULT_MEMBERSHIP_DURATION_DAYS` = 365 ngày); đổi gói chỉ do nhân viên làm (`POST /borrow/customers/:id/membership/renew`).
  Mô tả gói trong seed demo đang là tiếng Việt không dấu — nên sửa dữ liệu ở trang quản lý gói.
  Seed tạo 4 gói cùng một `created_at` và không có gói `STANDARD`, nên "gói active cũ nhất" (cả khi cấp thẻ lẫn `is_default`)
  phụ thuộc thứ tự Postgres trả về khi trùng (dữ liệu demo hiện là SILVER, khớp 91 thẻ đã cấp tự động). Nên đặt
  `DEFAULT_MEMBERSHIP_PLAN_CODE` rõ ràng trong `.env`.
- **"Báo khi có sách" chưa gửi thông báo**: `availability_alerts` chỉ được lưu/xoá; chưa có job/consumer nào gửi thông báo khi
  sách có lại (`notified_at` không bao giờ được ghi). Vì vậy `/membership` không quảng cáo tính năng này; câu "Sẽ báo cho bạn
  khi sách có trở lại" trên trang chi tiết sách là có từ trước và cần job gửi thông báo để đúng.
- SEO sâu hơn: SPA nên crawler không chạy JS chỉ thấy meta mặc định; có thể prerender `/`, `/books/:id` hoặc sitemap động.
- Review discovery (lọc theo sao, review hữu ích), cảnh báo "báo khi có sách" ngay trên trang công khai.
- Phase 3: conversion analytics anonymous → account, cá nhân hoá discovery theo phiên.
