# BOOK_DATA_SOURCE_AUDIT — Rà soát nguồn dữ liệu sách

- **Thời điểm kiểm tra:** 2026-11-12, 14:54–15:13 UTC (21:54–22:13 giờ Việt Nam)
- **Nhánh:** `khoa` (code tra cứu ISBN giống hệt `origin/hungg`; `hungg` chỉ khác ở phần chatbot)
- **Môi trường:** máy local (Windows) + container `smartbook-system-ai-service-1`; mỗi kiểm tra 1 request, không retry, User-Agent trình duyệt cho khảo sát và `SmartBookBot/1.0` cho kiểm tra adapter
- **Script tái lập:** `services/ai-service/eval/live_book_sources.py` (chạy trong container, không thuộc CI)

> Phạm vi: chỉ đọc trang/API công khai. Không vượt CAPTCHA, đăng nhập, Cloudflare hay `robots.txt`. Một lệnh gọi thẳng API tìm kiếm nội bộ của Fahasa (`/api/elsearch`, dùng khóa nhúng trong trang) đã bị chặn vì là lách cơ chế truy cập, và không được dùng.

## 1. Luồng tìm kiếm hiện có (trước nâng cấp)

| Tầng | Thành phần | Ghi chú |
|---|---|---|
| Web | `apps/web/src/components/pages/ai-import/index.tsx` → `aiService.enrichBookAfterIsbn` | Chuẩn hóa nhập (`normalizeIsbnInput`) |
| Web khác | `book-detail.tsx` → `lookupBookByIsbn`; OCR (`routes_book_ocr.py`) dùng chung lookup | |
| Gateway | `apps/api-gateway/src/index.js` `/ai/*` → `ai-service:8000` | Proxy, không timeout riêng |
| ai-service | `enrich_book_after_isbn` → `lookup_book_by_isbn` → `_lookup_book_by_isbn_legacy` | V2 (`metadata_extraction_service`, đang tắt) cũng gọi `_lookup_book_by_isbn_legacy` |
| Chuẩn hóa mã | `_normalize_and_validate_isbn` (checksum ISBN-10/13, đổi 10↔13) | Mã 13 số sai checksum → "barcode mode" |
| Hợp nhất | `_build_isbn_intelligence` + `isbn_fusion.fuse_field` | Gom cụm giá trị, độ tin cậy nguồn × phương pháp trích xuất |
| Độ tin cậy | `source_reliability.py`, `isbn_fusion.METHOD_RELIABILITY`, `INDEPENDENCE_GROUPS` | |
| Cache | `isbn_lookup_cache` (in-memory, 7 ngày; 10 phút nếu thiếu trường/nguồn lỗi) | |
| Timeout | `BOOK_LOOKUP_TIMEOUT_SECONDS=15`, `BOOK_MARKETPLACE_TIMEOUT_SECONDS=20–30` | |
| Retry | **Không có** | |
| Rate limit | Chỉ giới hạn chung của gateway; endpoint lookup không có giới hạn riêng | |

**Vấn đề phát hiện**

1. Luồng legacy gọi song song mọi nguồn và **chấp nhận kết quả không xác minh mã** (ví dụ Fahasa qua DuckDuckGo từng trả trang "Combo Nhà Giả Kim + Cây Cam Ngọt" cho mã 8935235226272).
2. Web search chỉ chạy khi không nguồn nào thấy, và có thể tự tạo metadata từ đoạn trích.
3. Ba nguồn đã chết hoặc bị chặn nhưng vẫn được gọi ở mọi lượt tra (Vinabook, WorldCat, Fahasa).
4. Fahasa bằng HTTP thường **thường xuyên** bị Cloudflare chặn (403). Code cũ dựa vào **CloakBrowser** (trình duyệt chống phát hiện bot) để chạy ổn định. *Đính chính:* lúc 14:55 bị 403, nhưng đầu phiên và lúc 16:00 HTTP thường vẫn đọc được trang. Việc chặn **không ổn định**, không phải lúc nào cũng chặn.
5. Không có retry; không phân biệt ISBN với EAN của nhà phát hành (8935…).
6. Adapter Nhã Nam do phiên trước thêm vào gọi `/search`, **vi phạm robots.txt** của nhanam.vn (đã gỡ).

## 2. Danh sách nguồn và kết quả kiểm tra thực tế

Mã thử: `9780132350884` (Clean Code), `8935235226272` (Nhà giả kim – Nhã Nam), `8935212359658` (Bé ngoan học lễ phép – Đinh Tị), `8935074130600` (Văn Lang), `8935309501694`, `8935270704704` (mã người dùng đưa).

| Nguồn | Domain / endpoint | Phương thức | Tìm theo mã | Tìm theo tên | robots.txt | Kết quả kiểm tra | Phân loại |
|---|---|---|---|---|---|---|---|
| Google Books | `www.googleapis.com/books/v1/volumes?q=isbn:` | API chính thức (JSON) | Có | Có (`intitle:`) | Không có (404) | **429** "Quota exceeded … Queries per day" (không có API key) | **UNSTABLE** khi không có key |
| Open Library | `openlibrary.org/api/books`, `/search.json` | API chính thức | Có (khóa theo ISBN) | Có | Chặn `/api`, `/search` cho crawler; đây là API công khai có tài liệu cho lập trình viên | 200; không có 5/6 mã Việt Nam; ISBN Clean Code trả bản ghi rác "The Earn2Trade Discount Code" | **PARTIAL** |
| WorldCat Classify | `classify.oclc.org/classify2/Classify` | API | — | — | — | **404** (OCLC đã đóng Classify) | **INACTIVE** |
| Fahasa | `www.fahasa.com/searchengine`, trang sản phẩm | HTML (kết quả render bằng JS) | Chỉ qua API nội bộ | — | Cho phép | **403 Cloudflare challenge** cho cả trang tìm kiếm và trang sản phẩm | **BLOCKED** |
| Tiki | `tiki.vn/api/v2/products` | API công khai không tài liệu | **Không** (0 kết quả với cả 6 mã) | Có | Cho phép | 200, 58–804 ms | **PARTIAL** (chỉ theo tên) |
| Vinabook | `www.vinabook.com` | HTML | — | — | — | **404** cả trang chủ và tìm kiếm | **INACTIVE** |
| Web search (`ddgs`) | thư viện `ddgs` (DuckDuckGo/Bing… qua scraping) | Đoạn trích kết quả tìm kiếm | Có (mã trong đoạn trích) | — | — | ~3 s; kết quả nhiễu (Shopee, Amazon, trang không liên quan) | **UNSTABLE** |
| Nhã Nam | `nhanam.vn/sitemap.xml`, `/<handle>.js` | Sitemap + JSON sản phẩm (Sapo) | Không (robots chặn `/search`) | Có (sitemap có `<image:title>`, 4.893 sản phẩm) | **Chặn `/search`**; cho phép `.js`, sitemap | 200; JSON có barcode, tác giả, số trang, NXB, năm | **PARTIAL** (chỉ Vòng 2) |
| **Đinh Tị** | `dinhtibooks.com.vn/search/<từ khóa>.html`, trang `-dpNNN.html` | HTML render phía server | **Có** — trả đúng sản phẩm | Có | Không có (404) | 200, 145–712 ms; trang có "Mã sản phẩm", tác giả, dịch giả, NXB, năm, số trang | **ACTIVE** |
| **Thái Hà** | `nhasachthaiha.vn/sitemap.xml`, `/products/<handle>.js` | Sitemap + JSON (Haravan) | Không (robots chặn `/search`; JSON không có barcode) | Có (2.263 sản phẩm) | **Chặn `/search`** | 200; `vendor` = tác giả; không có barcode | **PARTIAL** (chỉ Vòng 2) |
| **Văn Lang** | `vanlang.vn/sitemap.xml`, `/products/<handle>.js` | Sitemap + JSON (Haravan) | Không (robots chặn `/search`) | Có (3.184 sản phẩm) | **Chặn `/search`** | 200; JSON có barcode; tác giả chỉ có trong mô tả văn xuôi | **PARTIAL** (chỉ Vòng 2) |

### Bằng chứng (trích nhật ký kiểm tra)

```
2026-11-12T14:54:52 googleBooks isbn 9780132350884 -> 429 "Quota exceeded for quota metric 'Queries' … per day"
2026-11-12T14:54:53 openLibrary api/books ISBN:9780132350884 -> 200 title="The Earn2Trade Discount Code"
2026-11-12T14:54:54 openLibrary api/books ISBN:8935235226272 / 8935212359658 / 8935074130600 / 8935309501694 / 8935270704704 -> 200 no record
2026-11-12T14:54:56 worldCat classify2/Classify -> 404
2026-11-12T14:54:57 tiki products?q=<6 mã> -> 200 results=0 (cả 6 mã)
2026-11-12T14:54:59 tiki products?q=nhà giả kim -> 200 results=3
2026-11-12T14:55:00 vinabook / và /search -> 404
2026-11-12T14:55:00 fahasa searchengine, trang sản phẩm -> 403 (Cloudflare)
2026-11-12T16:00:57 fahasa (HTTP thường, qua adapter) mã 8935235226272 -> đọc được trang, mã khớp (Vòng 1 SUCCESS)
2026-11-12T14:55:01 dinhTi search/8935212359658.html -> 200, 1 sản phẩm; 5 mã khác -> 0 sản phẩm
2026-11-12T14:55:02 dinhTi trang sản phẩm -> Mã sản phẩm 8935212359658, có NXB, số trang
2026-11-12T14:55:02 thaiHa robots.txt Disallow: /search; products/chu-tho-muon-di-ngu.js -> 200 barcode=null
2026-11-12T14:55:02 vanLang robots.txt Disallow: /search; products/…js -> 200 barcode=8935074129901
2026-11-12T15:13:17 dinhTi adapter (SmartBookBot/1.0) code 8935212359658 -> OK 712 ms, 8 trường
2026-11-12T15:13:23 nhanam adapter title "Nhà giả kim" -> OK 1518 ms (sitemap + .js), ấn bản đầu tiên mã 8935235247376
2026-11-12T15:13:25 thaiHa adapter title "Chú thỏ muốn đi ngủ" -> OK 1631 ms
2026-11-12T15:13:28 vanLang adapter title "Tự Đổ Tách Trà…" -> OK 3262 ms, barcode 8935074130020
```

## 3. Ba nhà sách mới

| | Thái Hà | Đinh Tị | Văn Lang |
|---|---|---|---|
| Website | Hoạt động, Haravan | Hoạt động, CMS PHP riêng (render server) | Hoạt động, Haravan |
| Bản chất | Nhà sách / nhà phát hành (sách thiếu nhi, Ehon…) | Nhà phát hành (sách thiếu nhi, tương tác) | Nhà phát hành (Vanlangbooks) |
| Tìm kiếm công khai | Có `/search`, nhưng **robots.txt cấm** | `/search/<từ khóa>.html` (form gọi `submitSearch()`) | Có `/search`, nhưng **robots.txt cấm** |
| Tìm theo ISBN | Không dùng được | **Có**, khớp chính xác | Không dùng được |
| Tìm theo tên | Qua sitemap (`<image:title>`) | Có | Qua sitemap |
| Trang chi tiết | `/products/<handle>.js` (JSON) | HTML: `<h1 class="name">`, danh sách `<li>Nhãn: giá trị</li>` | `/products/<handle>.js` (JSON) |
| Trường lấy được | tên, tác giả (`vendor`), mô tả, ảnh, thể loại | tên, mã, tác giả, dịch giả, NXB, năm, số trang, mô tả, ảnh | tên, **barcode**, mô tả, ảnh, thể loại |
| Lưu ý dữ liệu | Không có barcode | `og:image` trỏ file `/original/…png` **404**; ảnh thật ở `<img class="mySlides">` | Tên kèm hậu tố " - Vanlangbooks"; tác giả chỉ có trong văn xuôi (không đoán) |
| Tích hợp | **Vòng 2** (khớp tên + tác giả) | **Vòng 1 + Vòng 2** | **Vòng 2** (khớp tên, xác minh bằng barcode) |

## 4. Đề xuất cho từng nguồn

| Nguồn | Đề xuất | Lý do |
|---|---|---|
| Google Books | **Giữ, nâng cấp**: đặt `GOOGLE_BOOKS_API_KEY` | Không có key thì 429 hằng ngày; là nguồn Vòng 1 đứng đầu |
| Open Library | **Giữ** (Vòng 1 + 2) | API ổn định; cần cảnh giác bản ghi rác (dữ liệu cộng đồng) |
| Đinh Tị | **Thêm** (Vòng 1 + 2) | Tìm mã chính xác, dữ liệu đầy đủ |
| Tiki | **Giữ, chỉ Vòng 2 theo tên** | Không tìm được theo mã |
| Nhã Nam, Thái Hà, Văn Lang | **Thêm/sửa, chỉ Vòng 2 qua sitemap** | robots.txt cấm `/search` |
| Web search | **Giữ, chỉ Vòng 2**, độ tin cậy thấp nhất | Không phải trang chi tiết sách; nhiễu |
| Fahasa | **Giữ, chỉ HTTP thường** (không CloakBrowser), Vòng 1 xếp cuối + Vòng 2; bị 403/429 thì tự tạm dừng | Cloudflare chặn không ổn định; khi đọc được thì xác minh được bằng mã trên trang |
| Vinabook | **Tắt** (giữ code) | Site 404 |
| WorldCat Classify | **Tắt** (giữ code) | Dịch vụ đã đóng (404) |

Code của các nguồn bị tắt vẫn còn nguyên (`_fetch_first_valid`, `_fetch_vinabook_by_isbn_api`, `_fetch_worldcat_by_isbn`). Chúng chỉ còn được dùng bởi luồng field-level (đang tắt bằng cờ), và không bị xóa.
