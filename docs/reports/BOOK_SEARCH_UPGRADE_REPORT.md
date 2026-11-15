# BOOK_SEARCH_UPGRADE_REPORT — Nâng cấp tra cứu sách hai vòng

- **Ngày:** 2026-11-12 · **Nhánh:** `khoa` (theo lựa chọn của người dùng; chưa commit, chưa push)
- **Báo cáo audit đi kèm:** [BOOK_DATA_SOURCE_AUDIT.md](BOOK_DATA_SOURCE_AUDIT.md)

## 1. Hiện trạng trước nâng cấp

- `_lookup_book_by_isbn_legacy` gọi **song song** Google Books, Open Library, Fahasa, Tiki, Vinabook rồi trộn bất kỳ kết quả nào trả về. Không kiểm tra mã in trên bản ghi có khớp mã quét hay không.
- Web search chạy khi không nguồn nào thấy, và có thể dựng metadata từ đoạn trích kết quả tìm kiếm.
- Không có retry. Không phân biệt ISBN (978/979) với EAN của nhà phát hành (8935…).
- Bản sửa "nguồn mốc" của phiên trước (chưa commit) lấy nguồn trả lời **nhanh nhất** làm mốc và tra Nhã Nam qua `/search`.

## 2. Vấn đề phát hiện

1. Kết quả sai được chấp nhận. Ví dụ đã gặp: mã 8935235226272 nhận về trang "Combo Nhà Giả Kim + Cây Cam Ngọt" từ Fahasa.
2. Ba nguồn không còn dùng được nhưng vẫn được gọi: Vinabook (404), WorldCat Classify (404), Fahasa (403 Cloudflare).
3. Fahasa bằng HTTP thường **hay** bị Cloudflare chặn (không phải lúc nào cũng chặn); code cũ dùng CloakBrowser, là công cụ chống phát hiện bot, để chạy ổn định.
4. Nhã Nam `/search` bị robots.txt cấm. Thái Hà và Văn Lang cũng cấm `/search`.
5. Google Books không có API key → 429 hằng ngày.
6. Open Library có bản ghi rác cho ISBN Clean Code ("The Earn2Trade Discount Code").
7. CSP `img-src` của web chưa cho phép domain ảnh của các nhà sách mới.
8. `og:image` của Đinh Tị trỏ tới file 404.
9. Lỗi có sẵn: nếu lệnh gọi chi tiết Tiki thất bại thì `authors_text` chưa được gán → `NameError` → mất toàn bộ kết quả Tiki. Đã sửa ở phiên trước bằng `_fetch_tiki_detail`.
10. Ngoài phạm vi, **chưa sửa**: `ruff` báo `_format_summary_description` chưa được định nghĩa (`main.py`, F821). Lỗi này có từ trước, ở HEAD.

## 3. Nguồn còn hoạt động

Google Books (cần API key), Open Library, Tiki (chỉ theo tên), Đinh Tị, Nhã Nam / Thái Hà / Văn Lang (chỉ theo tên, qua sitemap), Web search (nhiễu).

## 4. Nguồn ngừng hoạt động hoặc không thể dùng

| Nguồn | Lý do | Xử lý |
|---|---|---|
| ~~Fahasa~~ | *Cập nhật lần 2:* đã bật lại ở chế độ HTTP thường, không CloakBrowser (xem mục 14) | — |
| Vinabook | 404 toàn site | `DISABLED`, giữ code |
| WorldCat Classify | Dịch vụ đã đóng (404) | `DISABLED`, giữ code |

## 5. Kết quả với Thái Hà, Đinh Tị, Văn Lang

| Nhà sách | Kết nối | Theo mã | Theo tên | Tích hợp |
|---|---|---|---|---|
| Đinh Tị | 200, 0,1–0,7 s | Có, khớp chính xác ("Mã sản phẩm") | Có | **Vòng 1 + Vòng 2** |
| Thái Hà | 200 | Không (robots cấm `/search`; không có barcode) | Có, qua sitemap 2.263 sản phẩm | **Vòng 2** |
| Văn Lang | 200 | Không (robots cấm `/search`) | Có, qua sitemap 3.184 sản phẩm; xác minh bằng barcode | **Vòng 2** |

## 6. Nguồn tích hợp thành công

`googleBooks`, `openLibrary`, `dinhTi` (Vòng 1 và 2); `tiki`, `nhanam`, `thaiHa`, `vanLang`, `webSearch` (Vòng 2).

## 7. Nguồn không tích hợp được

Fahasa, Vinabook, WorldCat (xem mục 4). Thái Hà, Văn Lang và Nhã Nam **không thể tìm theo mã** mà vẫn tuân thủ robots.txt, nên không tham gia Vòng 1.

## 8. Kiến trúc hai vòng sau nâng cấp

```
Mã nhập → _normalize_and_validate_isbn (bỏ gạch/khoảng trắng, checksum, 10↔13)
   │  không hợp lệ và không phải barcode 10/13 số → trả lỗi kiểm tra, không gọi nguồn nào
   ▼
VÒNG 1 – isbn_rounds.run_round1 (TUẦN TỰ theo ISBN_ROUND1_ORDER = googleBooks,openLibrary,dinhTi)
   mỗi nguồn: tra theo mã → bản ghi phải in đúng mã đó (compare_codes = MATCH)
     • khớp → dừng, các nguồn sau = SKIPPED (ROUND1_ALREADY_MATCHED)
     • mã khác / không có mã → MISMATCH, hỏi nguồn kế tiếp
     • timeout / lỗi → TIMEOUT/ERROR (retry có giới hạn), hỏi nguồn kế tiếp
   không nguồn nào khớp → found=false, metadata rỗng,
                         message "Không tìm thấy thông tin sách theo mã đã nhập.", KHÔNG chạy Vòng 2
   ▼
VÒNG 2 – isbn_rounds.run_round2 (SONG SONG, MỌI nguồn còn bật, không dừng sớm)
   • nguồn tra được mã mà chưa được hỏi ở Vòng 1 → tra theo mã (phải khớp mã)
   • nguồn tra được tên → tra theo tên + tác giả của sách đã xác định:
       mã cùng loại khớp           → CODE_MATCH (lấy đủ trường)
       mã cùng loại khác            → DIFFERENT_EDITION (loại)
       không có mã so được         → khớp tên + tác giả → TITLE_MATCH (chỉ lấy tên, tác giả, mô tả, thể loại, ngôn ngữ)
   ▼
Hợp nhất – _build_isbn_intelligence + isbn_fusion (theo từng trường; giữ mọi giá trị, đánh dấu xung đột)
   ▼
Response = các trường cũ + verification + fieldSources + provenance của từng giá trị
```

**Registry** — `main._book_providers()`, dùng `isbn_rounds.BookProvider`. Mỗi nguồn khai báo `by_code` / `by_title`, `round1`, `accepts_raw_barcode`, `timeout`, `retries`, `disabled_reason`. Muốn thêm nguồn: khai báo thêm một dòng ở đây, rồi bổ sung vào `ISBN_SOURCE_ORDER` và `source_reliability.py`.

**Cấu hình** (env):
- `ISBN_ROUND1_ORDER`
- `ISBN_DISABLED_SOURCES`
- `ISBN_PROVIDER_TIMEOUT_SECONDS` (10)
- `ISBN_PROVIDER_RETRIES` (1)
- `BOOKSTORE_SITEMAP_TTL_SECONDS` (86400)

**Retry** — `isbn_rounds.call_with_retry`:
- chỉ retry khi timeout, lỗi mạng hoặc 5xx; backoff 0,5 s × 2ⁿ;
- không retry với 404, 429 hay lỗi parser;
- mỗi nguồn dùng client riêng và không bao giờ ném lỗi ra ngoài.

**ISBN và EAN** — mã `8935…` là EAN-13 của nhà phát hành, không phải ISBN. Một bản ghi chỉ có ISBN `978-604-…` không thể bác bỏ một EAN, nên được đánh giá bằng tên + tác giả thay vì bị loại.

**Độ tin cậy** (`source_reliability.py`):
- Nhã Nam / Đinh Tị / Thái Hà / Văn Lang là đơn vị phát hành của chính sách họ bán, nên được xếp cao (0,88–0,95).
- Kết quả chỉ khớp theo tên nhân hệ số `title_match = 0,7`.
- Mỗi nhà phát hành là một nhóm độc lập.
- Độ tin cậy của các nguồn cũ giữ nguyên, để không đổi kết quả hợp nhất hiện có.

**Tuân thủ** — Thái Hà, Văn Lang, Nhã Nam chỉ dùng `sitemap.xml` và `/products/<handle>.js`, đều được robots.txt cho phép. Sitemap được cache 24 giờ. Mỗi lượt tra đọc tối đa 3 trang sản phẩm mỗi nhà sách. User-Agent trung thực: `SmartBookBot/1.0`.

## 9. File đã sửa và tạo mới

**Tạo mới**

| File | Nội dung |
|---|---|
| `services/ai-service/isbn_rounds.py` | Registry, retry/backoff, Vòng 1, Vòng 2, tóm tắt xác minh |
| `services/ai-service/isbn_matching.py` | Chuẩn hóa mã, ISBN/EAN, so tên/tác giả, giới hạn trường theo tác phẩm |
| `services/ai-service/bookstore_providers.py` | Adapter Đinh Tị, Nhã Nam, Thái Hà, Văn Lang; chỉ mục sitemap |
| `services/ai-service/test_isbn_rounds.py`, `test_isbn_matching.py`, `test_bookstore_providers.py` | Test mới (fixture, không gọi mạng) |
| `services/ai-service/conftest.py` | Tắt mọi nguồn khi chạy pytest (CI không phụ thuộc website ngoài) |
| `services/ai-service/eval/live_book_sources.py` | Kiểm tra trực tiếp, chạy tay, luôn exit 0 |
| `BOOK_DATA_SOURCE_AUDIT.md`, `BOOK_SEARCH_UPGRADE_REPORT.md` | Báo cáo |

**Sửa**

| File | Thay đổi |
|---|---|
| `services/ai-service/main.py` | `_lookup_book_by_isbn_legacy` chạy hai vòng (field-level vẫn theo cờ); adapter theo mã/tên; registry; trạng thái nguồn từ hai vòng; provenance trong `fieldEvidence`; gỡ code "nguồn mốc"; Google trả `identifiers` |
| `isbn_coverage.py` | Thêm `dinhTi`, `thaiHa`, `vanLang`; thêm trường `translator` (không tính vào chỉ số độ phủ) |
| `isbn_fusion.py` | `translator` so như tác giả; `normalized_value()`; nhóm độc lập cho nhà phát hành; phương pháp `title_match` |
| `source_reliability.py` | Độ tin cậy cho 4 nhà phát hành |
| `metadata_intelligence/pipeline.py` | Bổ sung tên nguồn mới cho V2 |
| 3 file test cũ | Chuyển sang provider giả của registry; test "web search khi không thấy gì" đổi thành "không có mã khớp → không có metadata" |
| `apps/web/src/services/ai.ts` | Kiểu dữ liệu: nguồn mới, `DIFFERENT_EDITION`, `verification`, `fieldSources`, provenance (đều là trường tùy chọn) |
| `apps/web/.../ai-import/utils.ts`, `index.tsx`, `isbn-intelligence-panel.tsx`, `lib/i18n.tsx` | Nhãn nguồn; huy hiệu "khớp mã (vòng 1)" / "khớp theo tên"; "Nguồn chính" ưu tiên nguồn Vòng 1 |
| `apps/web/nginx.conf` | CSP `img-src` thêm `dinhtibooks.com.vn`, `bizweb.dktcdn.net`, `*.hstatic.net` |
| `docker-compose.yml`, `compose.prod.yml`, `.env.example` | Biến cấu hình hai vòng (bỏ biến "nguồn mốc") |

## 10. Thay đổi API (tương thích ngược)

Endpoint giữ nguyên: `/lookup-book-by-isbn`, `/isbn-intelligence`, `/enrich-book-after-isbn`. Không đổi tên hay xóa trường nào. Chỉ **thêm**:

- `verification`:
  - `round1 { order, matchedSource, matchedUrl, attempts[] }`
  - `round2Ran`
  - `totalSourcesChecked`, `sourcesFound`, `sourcesNotFound`, `sourcesFailed`, `sourcesRejected`
  - `foundSources`, `notFoundSources`, `failedSources`, `rejectedSources`, `disabledSources`
  - `verifiedFields`, `conflictedFields`, `crossSourceVerified`
- `fieldSources`: `{ trường: [các nguồn đồng thuận] }`
- `message` (khi không tìm thấy) và `translator`
- `sources[]` có thêm `round`, `query`, `attempts`, `verification`, `matchConfidence`, `retrievedAt`, `reason`, `error`, `matchedBy`; trạng thái mới `MISMATCH`, `DIFFERENT_EDITION`
- `fieldEvidence.<trường>.confirmations[]` có thêm `retrievedAt`, `verification`, `matchConfidence`, `round`, `normalizedValue`
- `source{}` / `confidence{}` có thêm khóa `nhanam`, `dinhTi`, `thaiHa`, `vanLang`

**Thay đổi hành vi có chủ đích:**
- Mã không khớp ở Vòng 1 → `found: false` (trước đây có thể "đoán" từ web search hoặc kết quả không xác minh).
- Mã 13 số sai checksum chỉ được tra ở nguồn nhận barcode thô (Đinh Tị).
- Database không đổi.

## 11. Kết quả kiểm thử (đã chạy thật)

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Toàn bộ test ai-service | `python -m pytest services/ai-service` (container) | **1263 passed, 8 skipped** (trước nâng cấp: 1231 passed) |
| Test mới | `test_isbn_rounds.py`, `test_isbn_matching.py`, `test_bookstore_providers.py` | Phủ 8 kịch bản Vòng 1, 9 kịch bản Vòng 2, parser, timeout, lỗi HTTP, website không phản hồi |
| TypeScript | `pnpm --filter web exec tsc --noEmit` | exit 0 |
| Unit test web | `pnpm --filter web test:unit` | 46/46 pass |
| ESLint (file đã sửa) | `eslint …` | exit 0 |
| Build web | `pnpm --filter web build` | thành công |
| Ruff (file mới) | `ruff check --select F,E9` | sạch; 6 cảnh báo trong `main.py` đều có sẵn ở HEAD |
| Live — từng nguồn | `eval/live_book_sources.py` | Xem bảng trong báo cáo audit |
| Live — trọn luồng | 6 mã | `8935212359658`: **found**, Vòng 1 = Đinh Tị, Vòng 2 thêm Tiki (theo tên), 7,6 s. `8935235226272`, `8935074130020`, `8935309501694`, `8935270704704`: **found=false** (Google 429, Open Library và Đinh Tị không có). `9780132350884`: found từ bản ghi **rác** của Open Library (Google 429) |
| Giao diện (localhost:5173) | Nhập `893-5212-35965-8` | Form điền đủ tác giả, dịch giả, NXB, số trang, ảnh bìa; "Nguồn chính: Đinh Tị"; 11 nguồn hiển thị trạng thái đúng |

Chưa kiểm thử: luồng OCR với ảnh thật (không có ảnh mẫu trong phiên), app mobile, môi trường production.

## 12. Vấn đề còn tồn tại

1. **Độ phủ Vòng 1 với sách Việt Nam rất thấp.** Khi Google Books không có key, chỉ còn Open Library (gần như không có sách VN) và Đinh Tị (chỉ sách Đinh Tị). Nhiều mã 8935… sẽ trả `found: false`; production trước đây ra kết quả chủ yếu nhờ Fahasa + CloakBrowser, nay đã tắt.
2. Open Library có thể trả bản ghi rác, và Vòng 1 vẫn coi là khớp vì mã đúng. Nên đặt Google Books lên trước khi có key (thứ tự mặc định đã như vậy).
3. Thái Hà không có barcode → chỉ khớp theo tên + tác giả. Văn Lang không có tác giả có cấu trúc.
4. Khi hai nguồn hòa điểm, chuỗi hiển thị có thể là bản không dấu (ví dụ "Ha Giang" thay vì "Hà Giang").
5. Vòng 1 tuần tự cộng thêm độ trễ: không thấy ~2,5 s, thấy ~7–8 s, trường hợp xấu nhất khoảng tổng các timeout.
6. Luồng field-level (`ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL`, đang tắt) vẫn theo logic "dừng khi đủ trường", trái với quy tắc Vòng 2. Chưa xóa vì chưa chứng minh được là không còn cần.

## 13. Hướng phát triển tiếp theo

1. Đặt `GOOGLE_BOOKS_API_KEY` cho local và production. Đây là cách nhanh nhất để tăng độ phủ Vòng 1.
2. Đề xuất với Nhã Nam / Văn Lang / Thái Hà / Fahasa một kênh dữ liệu chính thức (feed, API hoặc cho phép tra cứu), thay vì cố vượt giới hạn.
3. Có thể dựng chỉ mục barcode từ `/products/<handle>.js` theo lịch đêm, với tốc độ thấp. robots.txt cho phép đường dẫn này; khi đó Nhã Nam và Văn Lang tham gia được Vòng 1. Cần cân nhắc tải gây ra cho site (~8.000 request mỗi lượt quét) trước khi làm.
4. Thêm nguồn thư mục Việt Nam (Thư viện Quốc gia) nếu có API hoặc OPAC công khai được phép tích hợp.
5. Khi hòa điểm, ưu tiên chuỗi có dấu tiếng Việt.
6. Quyết định giữ hay bỏ luồng field-level.

## 14. Cập nhật lần 2 — tối ưu và tránh bị chặn (2026-11-12, tối)

### Đã làm

| Hạng mục | Thay đổi | File |
|---|---|---|
| **Nguồn số 0: Kho SmartBook** | Vòng 1 hỏi kho của chính thư viện **trước tiên**, qua endpoint nội bộ mới `GET /internal/catalog/books/by-code/:code` (khóa dịch vụ, chỉ nhận ISBN-10/13 hoặc EAN-13, chỉ trả sách đang hoạt động). Sách thủ thư đã lưu thì quét ra ngay, không phụ thuộc website ngoài. | `services/inventory-service/src/routes/internal-book-corpus.routes.js`, `src/services/internal-catalog.service.js`, `main._catalog_by_code` |
| **Fahasa bật lại, chỉ HTTP thường** | Tìm trang qua web search, đọc trang bằng HTTP thường, lấy mã in trên trang (JSON-LD `sku`/`gtin13`/`isbn`, "Mã hàng"). Không dùng CloakBrowser. Trang combo mang mã khác → `MISMATCH`. | `main._fahasa_by_code` |
| **Giãn cách theo host** | Hai request tới cùng một host cách nhau tối thiểu `BOOK_SOURCE_MIN_INTERVAL_SECONDS` (0,5 s), dùng chung cho mọi lượt tra trong tiến trình. | `isbn_rounds._throttle` |
| **Tự tạm dừng khi bị chặn** | 403/429 → **không retry**, nguồn chuyển `PAUSED` trong `BOOK_SOURCE_BLOCK_COOLDOWN_SECONDS` (900 s), hoặc theo `Retry-After` nếu site gửi. Bị chặn lặp lại thì thời gian dừng gấp đôi, tối đa 6 giờ. Lần thành công đầu tiên đặt lại. Khi `PAUSED`, site không bị gọi. | `isbn_rounds.call_with_retry`, `_trip`, `paused_until` |
| **Cache bền "bản tốt gần nhất"** | Kết quả tìm thấy lưu vào Postgres của ai-service (bảng `ai_isbn_lookup_cache`, giữ 30 ngày). Trước mốc làm mới thì trả ngay. Sau mốc thì tra lại; nếu lần tra lại không thấy gì (nguồn sập hoặc chặn) thì trả bản đã lưu, kèm `servedFromStore: true`. Lỗi database không làm hỏng lượt tra. Không thêm dependency. | `isbn_cache_store.py`, `schema.sql` |
| **Gợi ý chụp trang xuất bản** | Không tìm thấy mã → toast "Không tìm thấy thông tin sách theo mã đã nhập.", kèm nút "Chụp trang xuất bản" cuộn tới ô OCR "Trang thông tin xuất bản". Không đổi bố cục trang. | `apps/web/.../ai-import/index.tsx` |
| **User-Agent** | Giữ `SmartBookBot/1.0` trung thực. `.env.example` hướng dẫn thêm URL liên hệ. Không giả trình duyệt, không đổi IP. | `.env.example` |

Thứ tự Vòng 1 mặc định: `catalog → googleBooks → openLibrary → dinhTi → fahasa`.

Cấu hình mới:
- `BOOK_SOURCE_MIN_INTERVAL_SECONDS`
- `BOOK_SOURCE_BLOCK_COOLDOWN_SECONDS`
- `BOOK_SOURCE_BLOCK_COOLDOWN_MAX_SECONDS`
- `ISBN_PERSISTENT_CACHE`
- `ISBN_PERSISTENT_CACHE_KEEP_SECONDS`

API chỉ thêm: trạng thái `PAUSED`, khóa nguồn `catalog`, trường `servedFromStore`.

### Kiểm thử (đã chạy thật)

| Hạng mục | Kết quả |
|---|---|
| Test ai-service | **1275 passed**, 8 skipped (thêm `test_isbn_politeness.py`: tạm dừng khi 403/429, `Retry-After`, backoff tăng dần, giãn cách host, catalog, Fahasa, cache bền, fallback "bản tốt gần nhất") |
| Test inventory-service | **210/210** (thêm `test/internal-catalog-by-code.test.js`) |
| Web | tsc exit 0, ESLint exit 0, 46/46 unit test |
| Live — `8935235247376` (có trong kho) | Vòng 1 = **Kho SmartBook**; Vòng 2: Nhã Nam + Tiki xác nhận; `crossSourceVerified = true` |
| Live — `8935235226272` (Nhà giả kim 2020) | Trước: không tìm thấy. Nay: Vòng 1 = **Fahasa (HTTP thường)**; Vòng 2: Nhã Nam + Tiki |
| Live — `8935212359658` (Đinh Tị) | Vòng 1 = Đinh Tị; Vòng 2: Fahasa + Tiki |
| Live — Google Books 429 | Lượt sau báo `PAUSED` (dừng tới 16:15:38 UTC), không gọi lại Google |
| Live — cache bền | Khởi động lại container rồi tra lại `8935235226272`: **0,02 s** |
| Live — `8935270704704` | Vẫn `found: false` (web search không ra trang Fahasa nào cho mã này); giao diện hiện toast gợi ý chụp trang xuất bản, nút cuộn đúng tới ô OCR |

### Còn tồn tại

- Fahasa vẫn phụ thuộc web search (`ddgs`) để tìm URL, và có thể bị Cloudflare chặn bất cứ lúc nào. Khi đó nó chỉ tạm dừng, không ảnh hưởng nguồn khác.
- Trạng thái tạm dừng nằm trong bộ nhớ tiến trình: khởi động lại thì mất; chạy nhiều replica thì mỗi replica tự đếm riêng.
- `GOOGLE_BOOKS_API_KEY` vẫn trống ở local. Đây là việc **người dùng** cần làm.

## 15. Cập nhật lần 3 — chỉ mục mã vạch cho Nhã Nam, Văn Lang, Thái Hà (2026-11-13)

**Vấn đề người dùng gặp:** mã `8935074112750` có trên vanlang.vn nhưng không tìm ra. Lý do: robots.txt của Văn Lang cấm `/search`, nên Văn Lang chỉ tham gia Vòng 2 (tra theo tên), không thể nhận diện sách theo mã ở Vòng 1.

**Cách xử lý hợp lệ.** Cả ba nhà sách đều có feed sản phẩm công khai `/collections/all/products.json`, robots.txt **cho phép**, mỗi sản phẩm kèm `variants[].barcode`. Feed trả 50 sản phẩm mỗi trang trên Haravan và 250 trên Sapo.
- Tác vụ nền dựng chỉ mục `mã → URL sản phẩm` khi ai-service khởi động, mỗi trang cách nhau 1 giây, làm mới mỗi 24 giờ.
- Một lượt dựng mất khoảng 200 giây và tốn khoảng 130 request **cho cả ba nhà sách**.
- Gặp 403/429 hoặc lỗi thì giữ chỉ mục cũ và thử lại sau 1 giờ.
- Khi khớp mã, hệ thống chỉ đọc JSON của đúng một sản phẩm.

Thứ tự Vòng 1 mới: `catalog → nhanam → vanLang → thaiHa → dinhTi → googleBooks → openLibrary → fahasa`. Tra trong chỉ mục mà không thấy thì không tốn request nào.

**Kích thước chỉ mục (dựng thật):**

| Nhà sách | Mã | Sản phẩm |
|---|---|---|
| Văn Lang | 3.060 | 3.180 |
| Nhã Nam | 2.446 | 2.454 |
| Thái Hà | 360 | 2.260 |

**Đọc thêm khối thông số có nhãn.** Mô tả sản phẩm của Văn Lang và Thái Hà có khối "Mã sản phẩm: … Tác giả: … Dịch giả: … Nhà xuất bản: … Số trang: …". Hệ thống chỉ đọc khi có **ít nhất 2 nhãn** cùng xuất hiện và giá trị đủ ngắn để là tên. Một tiêu đề "Tác giả:" đứng trước đoạn tiểu sử bị bỏ qua.

**Kết quả thật:**

| Mã | Vòng 1 | Dữ liệu |
|---|---|---|
| `8935074112750` | **Văn Lang** (trước đây: không tìm thấy) | Phật Giáo Có Là Tôn Giáo Không? · Alan Watts · dịch giả Hạnh Duyên · NXB Hồng Đức · 172 trang · ảnh bìa; Fahasa và Tiki xác nhận tên sách |
| `8935235226272` | **Nhã Nam** | Nhà giả kim · Paulo Coelho · 228 trang; Open Library bị loại vì ghi mã của một ấn bản khác |
| `8935280922525` | **Thái Hà** | Sức sống bắt đầu từ đường ruột · Hiromi Shinya |

**Kiểm thử:**
- **1284 passed** (thêm test cho chỉ mục và khối thông số).
- Playwright có thêm luồng 7 "mã Văn Lang"; luồng này đạt.

**Hạn chế:**
- Chỉ mục nằm trong bộ nhớ: sau khi khởi động lại, mất khoảng 3 phút mới dựng xong. Trong thời gian đó các nhà sách này báo `ERROR` (đang dựng chỉ mục) ở Vòng 1 nhưng vẫn tham gia Vòng 2 theo tên.
- Thái Hà chỉ có barcode ở khoảng 16% sản phẩm.

## 16. Cập nhật lần 4 — Fahasa tìm trang ổn định hơn, đọc bảng thông số (2026-11-13)

**Vấn đề người dùng gặp:** mã `8935325011894` lấy từ fahasa.com nhưng hệ thống không tìm ra (Fahasa báo `NOT_FOUND`).

**Nguyên nhân (kiểm tra thật):**
- Trang sản phẩm Fahasa **đọc được bằng HTTP thường**: trả 200, không bị Cloudflare chặn, "Mã hàng" khớp mã.
- Lỗi nằm ở bước **tìm link**. Truy vấn `<mã> site:fahasa.com` trên backend `auto` của `ddgs` trả "No results found". Cùng truy vấn đó trên Bing/Google lại ra link; truy vấn chỉ có mã trên `auto`/Bing/Yahoo ra đúng trang.

**Sửa:**
- `_fahasa_by_code` thử lần lượt 4 cặp (truy vấn, công cụ): mã trần/auto → `site:fahasa.com`/Bing → `"mã"`/Google → `site:fahasa.com`/Google.
- Chỉ nhận trang có "Mã hàng" **khớp đúng mã**. Tối đa đọc 4 trang; timeout 30 giây.
- Đọc thêm **bảng thông số** của trang (`<th class="table-label">`): Tác giả, Người Dịch, NXB, Năm XB, Số trang, Ngôn Ngữ. Trước đây chỉ đọc JSON-LD, vốn thiếu các trường này.

**Kết quả thật:** `8935325011894` → **Đắc Nhân Tâm** · Dale Carnegie · dịch giả Tín Nghĩa · NXB Thế Giới · 2023 · 360 trang · tiếng Việt, nhận diện qua **Fahasa** ở Vòng 1, mất khoảng 12 giây. Vòng 2: Thái Hà và Tiki xác nhận. Nhã Nam và Văn Lang bị loại vì bán ấn bản khác (`DIFFERENT_EDITION`).

**Kiểm thử:**
- **1287 passed**.
- Playwright có thêm luồng 8 "mã Fahasa"; luồng này đạt.

**Lưu ý:** Fahasa vẫn phụ thuộc kết quả của các công cụ tìm kiếm (có thể đổi theo thời gian) và vào việc Cloudflare có cho HTTP thường đi qua hay không. Khi Fahasa báo `NOT_FOUND`/`PAUSED`, hãy kiểm tra trạng thái nguồn trước khi kết luận là mã sai.

## 17. Cập nhật lần 5 — chỉ mục mã vạch cho 6 nhà phát hành (2026-11-13)

**Vấn đề người dùng gặp:** mã `8935250722483` (Your Name, IPM, in năm 2026) có trên Fahasa nhưng không tìm ra; Fahasa báo `MISMATCH`.

**Nguyên nhân (kiểm tra thật):**
- Chưa công cụ tìm kiếm nào lập chỉ mục trang của ấn bản mới này. Bing/Google chỉ trả các trang Fahasa khác, và hệ thống loại chúng đúng vì "Mã hàng" khác.
- Trang `/searchengine` của Fahasa không có kết quả trong HTML: kết quả do JavaScript gọi API tìm kiếm nội bộ. Đường này không dùng vì là lách cơ chế truy cập.
- Như vậy, với sách mới, chỉ dựa vào web search thì không thể tìm thấy.

**Cách xử lý hợp lệ — tra trực tiếp ở nhà phát hành.** Đã kiểm tra 12 site. Sáu site có feed `/collections/all/products.json` kèm barcode, và robots.txt cho phép cả feed lẫn JSON sản phẩm:

| Nhà phát hành | Mã trong chỉ mục | Sản phẩm |
|---|---|---|
| Kim Đồng | 11.277 | 5.717 |
| Tân Việt | 2.953 | 3.246 |
| AZ Việt Nam | 2.101 | 1.864 |
| IPM | 1.585 | 1.180 |
| Alpha Books | 779 | 1.008 |
| Omega+ | 469 | 548 |

Không dùng được: Phương Nam và Skybooks (feed không có barcode), First News và Bookbuy (không có feed), Đông A và NXB Trẻ (site không phản hồi).

**Thay đổi:**
- **Bộ đọc chung** `parse_feed_store_product` hiểu ba kiểu ghi thông tin:
  - tag có tiền tố, ví dụ IPM `tacgia_…`, `nhaxb_…`, `namxb_…`;
  - dòng "Nhãn: giá trị" (Kim Đồng, Omega+, Alpha), có thêm các nhãn NXB / Năm XB / Người dịch;
  - bảng thông số trong mô tả (AZ Việt Nam).
- `vendor` chỉ được coi là tác giả ở những site mà nó thực sự là tác giả (Thái Hà, Alpha Books).
- Chỉ mục giữ thêm **tên sách** để tra theo tên ở Vòng 2 mà không cần sitemap.
- 9 nhà sách được dựng **song song**; mỗi host vẫn đọc từng trang, cách nhau 1 giây. Tổng thời gian khoảng 104 giây cho khoảng 25.000 mã.
- Vòng 1 mặc định: `catalog → nhanam → vanLang → thaiHa → ipm → kimDong → azVietnam → omegaPlus → tanViet → alphaBooks → dinhTi → googleBooks → openLibrary → fahasa`.
- Kết quả chỉ khớp theo tên mà tên tác giả không so được, ví dụ `新海誠` với "Shinkai Makoto", thì không đóng góp trường tác giả, để tránh xung đột giả.

**Kết quả thật:** `8935250722483` → **Your Name** · Shinkai Makoto · NXB Hồng Đức, nhận diện qua **IPM** ở Vòng 1.

**Kiểm thử:**
- **1294 passed**.
- Playwright có thêm luồng 9 "mã IPM"; luồng này đạt.

**Lưu ý dữ liệu:** năm xuất bản lấy theo tag của IPM (`namxb_2017`), còn Fahasa ghi 2026 cho lần in này. IPM không ghi số trang.

## 18. Cập nhật lần 6 — làn AI web search (OpenRouter qwen/qwen3.7-flash + Exa) (2026-11-13)

**Luồng mới:** Vòng 1 gồm hai làn chạy song song.
- **Làn A:** tra mã tuần tự như cũ.
- **Làn B:** `aiWebSearch`, bắt đầu ngay khi Kho SmartBook không có sách; sách đã có trong kho thì không gọi AI.
- **Chọn nguồn nhận diện sách:**
  - làn A khớp → làn A thắng; kết quả AI vào Vòng 2 làm nguồn đối chiếu, **không gọi lần thứ hai**;
  - chỉ AI khớp mã đã xác minh → AI nhận diện sách;
  - không làn nào khớp → báo không tìm thấy.
- Chế độ `ISBN_AI_WEB_MODE = parallel | fallback | off`.

**AI chỉ được làm "người đọc"** (`ai_web_search.py`):
1. Gọi Responses API với tool `openrouter:web_search` (engine `exa`, `max_uses: 1`). Câu truy vấn mặc định là `"{mã} sách mã hàng"`.
2. Câu trả lời không có `url_citation` thì bị loại (model trả lời từ trí nhớ).
3. Mã phải nằm trong đoạn nội dung của chính trang được trích dẫn: ngay sau nhãn Mã hàng / ISBN / SKU…, hoặc là mã sách duy nhất trên trang.
4. Mọi giá trị (tên, tác giả, dịch giả, NXB, năm, số trang) phải có trong đoạn nội dung đó; giá trị nào không có thì bị bỏ.
5. Nguồn có phương thức `llm_grounded`, độ tin cậy thấp hơn các nguồn đọc trực tiếp.

**Chi tiêu:**
- Mỗi lượt gọi được **giữ chỗ trong Postgres trước khi gọi** (bảng `ai_web_search_calls`, có khóa advisory), với trần ngày/tháng là **trần cứng**.
- Không đọc được bộ đếm → **không gọi**.
- Kết quả, kể cả không tìm thấy, được cache theo mã trong `ai_web_search_cache` (mặc định 7 ngày).
- Lỗi 429/5xx từ nhà cung cấp được thử lại tối đa 2 lần **trong cùng một lượt đã giữ chỗ**, vì OpenRouter không tính phí các lỗi này.

**Kết quả chạy thật (giới hạn 3 lượt theo yêu cầu):**

| Lượt | Mã | Kết quả | Chi phí |
|---|---|---|---|
| 1 | 8935250722483 | HTTP 429 "Provider returned error" (nhà cung cấp phía sau OpenRouter tạm từ chối) | $0 |
| 2 | 8935250722483 | Gọi thành công, 8 trích dẫn. Truy vấn mã trần khiến Exa chỉ trả các trang tra mã vạch chung (upcitemdb, ean1.de…). Qwen trả `{"results":[]}`, không bịa | **$0,0072** |
| 3 | 8935325011894 | HTTP 429 lần nữa (đã ghi lại nội dung lỗi). Sách vẫn được AZ Việt Nam nhận diện ở Vòng 1, cùng 4 nguồn xác nhận | $0 |

**Đã sửa sau khi chạy thật:**
- Câu truy vấn có thêm ngữ cảnh "sách mã hàng".
- Thử lại khi gặp 429.
- Ghi lại mã và nội dung lỗi.

**Chưa kiểm chứng trên dữ liệu thật** (vì đã hết 3 lượt): trường hợp AI tìm được trang có mã và vượt qua bước xác minh. Trường hợp này đã có test offline.

**Kiểm thử offline:**
- **1312 passed** (thêm `test_ai_web_search.py`: xác minh trích dẫn và mã, chống bịa, hạn mức fail-closed, cache, thử lại 429, các nhánh làn song song).
- tsc, 46 unit test web đều đạt.

**Trạng thái container hiện tại:** chạy với `ISBN_AI_WEB_DAILY_LIMIT=3` và `ISBN_AI_WEB_MONTHLY_LIMIT=3`, nên làn AI đang `PAUSED` (3/3). Mặc định trong compose là 50/ngày, 900/tháng.

### 18b. Thêm 3 lượt chạy thật (trần nâng lên 6)

| Lượt | Mã | Kết quả AI | Chi phí ghi nhận |
|---|---|---|---|
| 4 | 8935325011894 (Đắc Nhân Tâm) | TIMEOUT sau 65 s. Dòng ghi bị kẹt `RESERVED` → **đã sửa**: lượt bị cắt nay được ghi `TIMEOUT`, mọi lần thử lại dùng chung hạn 60 s | không đo được (có thể đã bị tính phí) |
| 5 | 8935235226272 (Nhà giả kim) | NOT_FOUND | $0,0073 |
| 6 | 8935270704704 | NOT_FOUND. Sách **đã được Fahasa nhận diện** ở Vòng 1 (Đắc Nhân Tâm) | $0,0074 |

**Kết luận về Qwen + Exa:**
- Trong cả 3 lượt gọi thành công (2, 5, 6), Exa trả về các trang **nói về mã vạch** (hướng dẫn tra mã, kiểm tra tem sách, tiêu chuẩn mã số…). Có **0 trang chứa mã cần tìm**, kể cả với sách phổ biến mà Google/Bing tìm ra dễ dàng.
- Exa tìm theo ngữ nghĩa nên **không phù hợp để tra chính xác một dãy số**.
- Qwen không bịa lần nào (luôn trả kết quả rỗng), và bước xác minh hoạt động đúng. Nhưng làn AI **chưa đóng góp được nguồn nào**.
- Credit OpenRouter tăng $0,034 trong đợt test, gồm cả các tính năng AI khác của ai-service; còn $3,44.

**Hướng tiếp theo đề xuất:** thử engine tìm theo từ khóa hoặc chỉ mục Google thay cho Exa. Công cụ của OpenRouter hỗ trợ `engine` = `firecrawl` / `parallel` / `perplexity` / `native` (ví dụ Gemini dùng Google Search). Chỉ cần đổi `ISBN_AI_WEB_ENGINE` / `ISBN_AI_WEB_MODEL`, không phải sửa code. Trong lúc chưa có engine phù hợp, nên đặt `ISBN_AI_WEB_MODE=off` để không tốn tiền vô ích.

## 19. Cập nhật lần 7 — AI tra theo tên sách ở Vòng 2 (chế độ `title`, mặc định) (2026-11-13)

**Lý do:** Exa tìm theo ngữ nghĩa nên vô dụng với một dãy mã trần (mục 18b: 0 trang khớp), nhưng hợp với câu truy vấn "Nhà giả kim Paulo Coelho".

**Luồng mới:**
1. Vòng 1 giữ nguyên: tra mã tuần tự, không gọi AI.
2. Vòng 1 xác định được sách → Vòng 2 gọi `aiWebSearch` **một lần**. Truy vấn là `"{tên} {tác giả} sách"` (đổi bằng `ISBN_AI_WEB_TITLE_QUERY`). Prompt yêu cầu model ưu tiên các trang có mã đã quét.
3. Vòng 1 không tìm thấy → AI không được gọi (SKIPPED).
4. Mỗi trang model trích dẫn được xét theo 3 mức (dùng chung bộ xét của Vòng 2):
   - trang ghi **đúng mã** (sau nhãn Mã hàng / Mã sản phẩm / ISBN…, hoặc là mã duy nhất) → `CODE_MATCH`, lấy mọi trường;
   - trang **không ghi mã**, nhưng khớp tên + tác giả → `TITLE_MATCH`, chỉ lấy trường cấp tác phẩm;
   - trang ghi **mã khác** của cùng tên sách → `DIFFERENT_EDITION`, bị loại.
5. Giá trị nào không có nguyên văn trên trang vẫn bị bỏ. AI không bao giờ thay nguồn nhận diện sách.
6. Cache theo khóa `title:{mã}`, dùng chung bộ đếm hạn mức.
7. `ISBN_AI_WEB_MODE = title | parallel | fallback | off`. Hai chế độ tra theo mã cũ vẫn còn.

**Chạy thật 3 lượt** (trần nâng từ 6 lên 9):

| Lượt | Sách | Kết quả |
|---|---|---|
| 7 | Đắc Nhân Tâm (8935325011894) | Hết thời gian 60 s (ReadTimeout). Sách vẫn tìm thấy nhờ nguồn khác |
| 8 | Nhà giả kim (8935235226272) | Exa trả **8/8 trang đúng sách** (Wikipedia, Goodreads, Netabooks, Bến Nghé…). Trang Bến Nghé ghi "Mã sản phẩm: 8935235226272", và Qwen chọn đúng trang đó. **Nhưng bị loại do lỗi của code**: model chép tên kèm tên website ("Nhà giả kim – Bến Nghé Books"), không khớp nguyên văn. Chi phí $0,0076, 2.768 token suy luận, 34 s |
| 9 | Phật Giáo Có Là Tôn Giáo Không? (8935074112750) | Hết thời gian 60 s |

**Đã sửa sau khi chạy:**
- Bỏ hậu tố tên website (" – …", " | …") khỏi tên sách trước khi đối chiếu với trang.
  - Chạy lại **phản hồi thật đã lưu** của lượt 8 qua code đã sửa (không tốn lượt): ra `CODE_MATCH` với tên "Nhà giả kim", Paulo Coelho, dịch giả Lê Chu Cầu, NXB Hội nhà văn, 2020, 228 trang, nguồn bennghe.com.vn.
  - Các giá trị này đều có nguyên văn trên trang.
- Gửi `reasoning: {"effort": "low"}` (biến `ISBN_AI_WEB_REASONING_EFFORT`, mặc định `low`), vì việc chép thông tin từ trang không cần suy luận dài.
  - **Chưa kiểm chứng trên dữ liệu thật**: chưa biết qwen3.7-flash có tuân theo hay không, và có hết lỗi quá thời gian hay không.

**Kiểm thử offline:** **1322 passed**. Có thêm các test:
- 3 mức xác minh;
- thứ tự trang;
- bỏ tên website;
- truy vấn theo tên + tác giả;
- cache;
- provider chế độ title chỉ chạy ở Vòng 2.

### 19b. Thêm 3 lượt chạy thật sau khi sửa (trần nâng lên 12)

Chạy lại đúng 3 sách trên, sau khi đã xóa cache.

| Lượt | Sách | Kết quả AI | Thời gian cả lượt tra | Chi phí |
|---|---|---|---|---|
| 10 | Đắc Nhân Tâm (8935325011894) | `NOT_FOUND`, **đúng như mong đợi** (xem dưới) | 49,5 s | $0,0078 |
| 11 | Nhà giả kim (8935235226272) | **`CODE_MATCH`** từ bennghe.com.vn ("Mã sản phẩm: 8935235226272"). Đóng góp tác giả, dịch giả Lê Chu Cầu, NXB, năm 2020, 228 trang | 44,7 s | $0,0078 |
| 12 | Phật Giáo Có Là Tôn Giáo Không? (8935074112750) | **`CODE_MATCH`** từ vanlang.vn. Đóng góp tên, tác giả, dịch giả Hạnh Duyên, NXB Hồng Đức, 172 trang | 32,1 s | $0,0076 |

**Nhận xét:**
- **2/3 sách được AI xác nhận bằng trang có đúng mã**, và không lượt nào quá thời gian.
- Exa tra theo tên trả về 8/8 trang đúng tác phẩm ở cả 3 lượt.
- Không có giá trị bịa: mọi giá trị đều có nguyên văn trên trang trích dẫn.
- **Đắc Nhân Tâm:** sách này có hàng chục ấn bản.
  - Truy vấn là "Đắc Nhân Tâm (2023) sách". Nguồn nhận diện ở Vòng 1 không có tác giả, nên truy vấn không kèm tác giả.
  - Exa không trả về trang nào chứa mã 8935325011894.
  - Trang Skybooks ghi ISBN 9786043927436 của ấn bản khác; trang Khai Trí là "Đắc Nhân Tâm - Thuật Thu Phục Lòng Người".
  - Hệ thống không nhận trang nào, tức là **không lấy nhầm dữ liệu của ấn bản khác**.
- **`reasoning.effort=low` không có tác dụng rõ:** Qwen vẫn dùng 2,9k–4,4k token suy luận. Lượt này không bị quá thời gian, nhưng chưa thể khẳng định là nhờ tham số đó.

**Đã sửa thêm:** ở lượt 11, AI chép tiêu đề trang "Nhà Giả Kim - Paulo Coelho" nên hệ thống báo xung đột tên giả. Nay hậu tố " - <tác giả>" bị bỏ khi trùng tác giả đã xác minh.
- Chạy lại 3 phản hồi đã lưu cho ra tên sạch.
- Có thêm test; tổng cộng **1322 passed**.
- Lưu ý: kết quả cũ của mã này vẫn nằm trong cache 7 ngày ở môi trường local.

**Tổng chi phí AI web search của 12 lượt thử:** khoảng $0,06 (mỗi lượt thành công khoảng $0,0075–0,008).

**Trạng thái container:** trần 12/12 đã dùng hết, nên AI đang `PAUSED`. Mặc định trong compose là 50 lượt/ngày, 900 lượt/tháng.
