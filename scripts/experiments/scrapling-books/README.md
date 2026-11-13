# Thử nghiệm Scrapling trên các nguồn sách của SmartBook

Thử dùng [Scrapling](https://github.com/D4Vinci/Scrapling) 0.5.1 (BSD-3, miễn phí) để tra sách theo mã ISBN/EAN trên các nguồn mà ai-service đang dùng.
Đây là **thử nghiệm độc lập**: image Docker riêng, không đụng tới `services/ai-service` và luồng tra cứu production.

## Thiết kế

Mỗi nguồn là một adapter. Các nguồn chạy song song, và mọi kết quả đi qua cùng một phép kiểm: chỉ tính là `CODE_MATCH` khi **mã in trên trang hoặc bản ghi đúng bằng mã đang tra**.

| Nguồn | robots.txt | Cách truy xuất |
|---|---|---|
| Fahasa | cho phép `/searchengine` | `StealthyFetcher` (Chromium + Patchright) mở trang tìm kiếm, chờ `ul.products-grid`, lấy link `fhs_campaign=SEARCH`. `Fetcher` đọc trang sản phẩm, so "Mã hàng" |
| Đinh Tị | không có robots.txt | `Fetcher` mở `/search/<mã>.html`, đọc trang sản phẩm, so "Mã sản phẩm" |
| **Bizbooks** (mới) | cho phép `/wp-json/` | `Fetcher` gọi Store API công khai của WooCommerce (`/wp-json/wc/store/v1/products?search=<mã>`), so SKU (`#8935...`) |
| Google Books | API chính thức | `Fetcher` gọi `volumes?q=isbn:<mã>`, so `industryIdentifiers`. Dùng `GOOGLE_BOOKS_API_KEY` nếu có |
| Open Library | API chính thức | `Fetcher` gọi `/isbn/<mã>.json`, so `isbn_13`/`isbn_10` |
| Nhã Nam, Thái Hà, Văn Lang, IPM, Kim Đồng, AZ Việt Nam, Omega+, Tân Việt, Alpha Books, **Phương Nam, Nhân Văn, Minh Long** (3 nguồn cuối là mới) | **cấm `/search`**, cho phép feed | Đọc feed `/collections/all/products.json` (Haravan trả tối đa 50 sản phẩm/trang), dựng chỉ mục mã vạch, cache 24 giờ trong volume `/cache`. Mã vạch 12 số (thiếu số kiểm tra, gặp nhiều ở Phương Nam) được tính lại thành EAN-13 |
| Tiki | cho phép | API chỉ tìm được theo tên, nên chạy sau, với tên sách đã được nguồn khác xác minh. Kết quả là `TITLE_MATCH`, không xác minh được mã |

Giới hạn để lịch sự với các site:
- Kiểm `robots.txt` (thư viện `protego`) trước khi đọc mọi trang web. Theo RFC 9309: robots.txt trả 4xx thì coi như không giới hạn, trả 5xx thì coi như cấm toàn bộ.
- Giãn tối thiểu 1,5 s giữa hai request tới cùng một host.
- Đọc tối đa 4 trang sản phẩm mỗi nguồn, mỗi mã.
- Không bắt API nội bộ, **không giải Cloudflare** (`solve_cloudflare=False`).
- Gặp 403/429/503 hoặc trang kiểm tra thì báo `BLOCKED`.

Không có trong probe:
- `catalog`: kho sách nội bộ, cần service key.
- `webSearch`, `aiWebSearch`: tìm kiếm web và AI có tính phí.

## Kết quả chạy thử (2026-11-13)

| Mã | Tìm thấy ở | Ghi chú |
|---|---|---|
| 8935325011894 | Fahasa, AZ Việt Nam (+ Tiki theo tên) | Đắc Nhân Tâm |
| 8935250722483 | Fahasa, IPM | Your Name (Tái Bản 2026) |
| 8935074112750 | Fahasa, Văn Lang (+ Tiki) | Phật Giáo Có Là Tôn Giáo Không? |
| 9780132350884 | Open Library (+ Tiki) | Clean Code. Fahasa trả sách khác nên bị loại đúng (`MISMATCH`) |
| 8935251422238 | Fahasa, Alpha Books (+ Tiki) | Sai Sao Cho Đúng |
| 8935280922525 | Thái Hà | Sức sống bắt đầu từ đường ruột |
| 8935212377041 | Fahasa, Đinh Tị (+ Tiki) | Các Triều Đại Trung Quốc |
| 8935235250222 | Fahasa, Nhã Nam | Em Sẽ Đến Cùng Cơn Mưa |
| 8935210316189 | Tân Việt | Đêm Trước Giáng Sinh |
| 9786044616100 | Omega+ (+ Tiki) | Lạm phát - Lịch sử và những bài học qua 2000 năm |
| 6262202450041 | Kim Đồng (+ Tiki) | Conan - Nàng dâu Halloween, Tập 1 |
| 8930000000001 (mã giả) | không nguồn nào | Fahasa trả sách gợi ý nhưng mã không khớp nên bị loại đúng |

- **11/11 mã thật được tìm thấy, mã giả bị loại ở mọi nguồn.** Mỗi adapter đều có ít nhất một kết quả khớp mã, trừ Google Books: không có API key nên luôn nhận HTTP 429.
- Lần chạy đầu mất khoảng 2 phút 20 giây, vì phải dựng chỉ mục feed cho 9 nhà sách (Văn Lang lâu nhất, khoảng 108 s). Các lần sau đọc từ cache, mỗi mã khoảng 4–10 s, chủ yếu do bước trình duyệt của Fahasa.
- Fahasa trả 200 ở mọi lần chạy, không gặp Cloudflare.

### Nguồn mới (cùng ngày)

| Mã | Tìm thấy ở |
|---|---|
| 9786042398060 Host Club Trường Ouran tập 15 | Fahasa, **Phương Nam** (mã 12 số trong feed, tính lại số kiểm tra), **Nhân Văn** |
| 9786042425933 Từ Ngày Có Em Trai tập 1 | **Nhân Văn** |
| 8936238103737 Đánh Thức Khả Năng Quan Sát Và Ghi Nhớ | Fahasa, **Phương Nam**, **Minh Long** (+ Tiki) |
| 8935246945926 Đắc Nhân Tâm (bản khác) | **Bizbooks** |
| 8935325011894 Đắc Nhân Tâm | Fahasa (+ Tiki) |

Kích thước các chỉ mục feed:

| Nguồn | Số mã | Nguồn | Số mã |
|---|---|---|---|
| Phương Nam | 20.249 (bị cắt) | Văn Lang | 3.060 |
| Nhân Văn | 19.996 (bị cắt) | Tân Việt | 2.953 |
| Kim Đồng | 11.297 | Nhã Nam | 2.447 |
| AZ Việt Nam | 2.101 | IPM | 1.585 |
| Minh Long | 1.239 | Alpha Books | 779 |
| Omega+ | 469 | Thái Hà | 360 |

- Phương Nam và Nhân Văn chạm trần 400 trang (20.000 sản phẩm), nên chỉ mục có thể thiếu sách. Nâng trần thì mỗi site phải nhận gần 1.000 request mỗi ngày, nên tôi giữ nguyên trần và để probe in cảnh báo khi bị cắt.
- Thêm 3 feed lớn làm lần dựng chỉ mục đầu tăng lên khoảng 11 phút. Sau đó mỗi mã vẫn chỉ mất vài giây.

### Các site đã dò nhưng không dùng

| Site | Lý do |
|---|---|
| Newshop | Trang có in Barcode, nhưng tìm kiếm không khớp theo mã và không có Store API (chỉ tìm được theo tên) |
| First News, 1980 Books | Trang sản phẩm không in mã |
| Bến Nghé, Skybooks | Có feed nhưng không có mã vạch; robots cấm `/search` |
| Thư viện Quốc hội (VuFind) | Tìm theo tên không ra kết quả |
| ppdvn.gov.vn (tra cứu lưu chiểu) | robots.txt trả lỗi 500, theo RFC 9309 phải coi như cấm |
| Bookbuy | Timeout |
| Sài Gòn Books, NXB Hà Nội, Khai Tâm, HUC | Lỗi chứng chỉ SSL |
| NXB Trẻ | Redirect vòng lặp |
| Đông A, Hương Thảo, bennghebooks.com | Tên miền không tồn tại |

## Cách chạy

Yêu cầu: Docker Desktop đang chạy. Image khoảng 2,3 GB (có Chromium).

**1. Build image** (chạy từ thư mục gốc repo):

```bash
docker build -t smartbook-scrapling-probe scripts/experiments/scrapling-books
```

**2. Tra một hoặc nhiều mã trên mọi nguồn.** Volume `smartbook-scrapling-cache` giữ chỉ mục feed giữa các lần chạy; lần đầu mất khoảng 11 phút (riêng Phương Nam và Nhân Văn khoảng 10 phút):

```bash
docker run --rm -v smartbook-scrapling-cache:/cache smartbook-scrapling-probe 8935325011894 8935212377041
```

**3. Chỉ chạy vài nguồn:**

```bash
docker run --rm -v smartbook-scrapling-cache:/cache smartbook-scrapling-probe 8935325011894 --sources fahasa,dinhTi,openLibrary
```

Tên nguồn hợp lệ: `fahasa, dinhTi, bizbooks, googleBooks, openLibrary, nhanam, thaiHa, vanLang, ipm, kimDong, azVietnam, omegaPlus, tanViet, alphaBooks, phuongNam, nhanVan, minhLong`.

**4. Dùng Google Books có API key:**

```bash
docker run --rm -v smartbook-scrapling-cache:/cache -e GOOGLE_BOOKS_API_KEY=<key-của-bạn> smartbook-scrapling-probe 9780132350884
```

**5. Lấy JSON đầy đủ** (tác giả, dịch giả, NXB, năm, số trang, URL) và lưu ra file:

```bash
docker run --rm -v smartbook-scrapling-cache:/cache smartbook-scrapling-probe 8935325011894 --json > result.json
```

**6. Dựng lại chỉ mục feed** (bỏ qua cache 24 giờ):

```bash
docker run --rm -v smartbook-scrapling-cache:/cache smartbook-scrapling-probe 8935325011894 --refresh-feeds
```

Sau khi sửa `probe.py`, chạy lại bước 1. Lần build sau chỉ mất vài giây.

## Đọc kết quả

Mặc định, mỗi mã in ra một bảng: dòng tiêu đề là `mã → FOUND/NOT_FOUND + tên sách`, mỗi dòng sau là một nguồn kèm trạng thái, thời gian và tên sách hoặc lỗi.
Dòng `Tóm tắt: x/y mã tìm thấy` (in ra stderr) có thể hiện lên trước bảng.

| Trạng thái | Nghĩa |
|---|---|
| `CODE_MATCH` | Mã trên trang hoặc bản ghi đúng bằng mã đang tra. Chỉ trạng thái này được tính là tìm thấy |
| `MISMATCH` | Nguồn trả kết quả, nhưng là sách khác |
| `NOT_FOUND` | Nguồn không có mã này |
| `TITLE_MATCH` | (Tiki) Có sản phẩm trùng tên, nhưng không xác minh được mã |
| `BLOCKED` | 403/429/503 hoặc trang kiểm tra Cloudflare |
| `ROBOTS_DISALLOWED` | robots.txt cấm đường dẫn, probe không đọc |
| `ERROR` | Timeout, lỗi mạng hoặc lỗi trình duyệt |

## Ghi chú kỹ thuật

- Phải ghim `playwright<1.65`. Nếu không, pip kéo Playwright 1.65, `scrapling install` tải bản Chromium khác với bản `patchright 1.64.x` cần, và `StealthyFetcher` báo "Executable doesn't exist".
- Image `python:3.10-slim` thiếu `libatomic1`, nên node driver của Playwright báo lỗi 127. Dockerfile đã cài thêm gói này.
- Không dùng `network_idle=True` với Fahasa: trang còn gọi quảng cáo và tracking nên bước này mất khoảng 50 s. Chờ `ul.products-grid` chỉ mất 3–4 s.
- Selector phụ thuộc giao diện từng site (`ul.products-grid`, `th.table-label`, `.info-prd li`). Nếu site đổi giao diện, nguồn đó sẽ trả `NOT_FOUND` hoặc `MISMATCH` hàng loạt.
- Chưa tích hợp vào ai-service. Nếu tích hợp, nên:
  - giữ 1 trình duyệt chạy tại một thời điểm, có hard timeout;
  - dùng cache Postgres và cơ chế tạm dừng nguồn khi bị 403/429 của `isbn_rounds`;
  - không cần thay phần feed: ai-service đã có chỉ mục mã vạch tương đương.
