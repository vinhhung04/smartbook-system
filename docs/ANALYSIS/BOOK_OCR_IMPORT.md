# AI Multi-Image OCR Book Import

Ngày: 2026-10-23 · Nhánh: `hungg` · Prompt: `book-ocr-v2` · Model mặc định: `qwen/qwen3.7-flash` (OpenRouter)

Nhân viên chụp/tải 1–3 ảnh của một cuốn sách (bìa trước, bìa sau, trang thông tin xuất bản) trên trang **AI Import**;
hệ thống đọc ảnh bằng một lời gọi multimodal, kiểm tra từng giá trị, đối chiếu với **ISBN Lookup** hiện có rồi **đề xuất**
dữ liệu vào biểu mẫu `EditableBookForm`. OCR không bao giờ tạo hay sửa sách: việc lưu vẫn đi qua luồng review
(reconciliation draft, duplicate review, nút Lưu) như khi tra cứu ISBN.

Đánh giá định lượng: [BOOK_OCR_EVALUATION.md](BOOK_OCR_EVALUATION.md).

## 1. Pipeline

```
Ảnh (1–3)  ──>  [web] resize ≤2048px + giải mã mã vạch EAN-13 bìa sau (html5-qrcode, tất định, miễn phí)
                    │  multipart: front_cover / back_cover / copyright_page (+ barcode)
                    v
API Gateway /ai ──> ai-service POST /book-metadata/scan-images
   1. Quyền: hỏi inventory-service GET /api/metadata-reconciliations/capabilities/import
      (manager + inventory.catalog.write - cùng cổng với tạo draft). Chưa có quyền -> chưa tốn inference.
   2. images.py   : xác minh định dạng bằng magic bytes + decode thật, chặn decompression bomb,
                    xoay theo EXIF, làm phẳng alpha, thu nhỏ (không phóng to) ≤1600px, re-encode JPEG
                    (xóa EXIF/GPS) - toàn bộ trong RAM.
   3. extractor.py: MỘT request OpenRouter chứa cả 3 ảnh, mỗi ảnh có nhãn "Image label: <loại>".
                    Không hỏi lại model chỉ để sửa JSON.
   4. validation.py: chuẩn hóa (NFC, khoảng trắng, ISBN-10 -> 13, checksum), kiểm tra
                    nguồn ảnh có thật, giá trị phải nằm trong đoạn chữ model chép (grounding),
                    đúng vai trò (dịch giả ≠ tác giả, NXB ≠ nhà phát hành, năm in ≠ năm xuất bản),
                    gộp theo trường và phát hiện xung đột giữa các ảnh.
   5. ISBN Lookup : chỉ khi có đúng một ISBN hợp lệ -> lookup_book_by_isbn() hiện có
                    (cache + Metadata Intelligence v2 nếu bật), có timeout riêng.
   6. reconcile.py: đối chiếu từng trường ảnh ↔ lookup -> proposals cho từng ô của form.
                    v
[web] Panel "Kết quả đọc ảnh": giá trị, trạng thái, bằng chứng, so sánh ảnh/lookup, xem lại ảnh,
      áp dụng từng trường / áp dụng các trường an toàn.
      Có bản ghi ISBN -> tạo reconciliation draft như tra cứu ISBN; luôn chạy duplicate check.
      -> nhân viên sửa, xử lý trùng lặp, bấm Lưu (luồng hiện có).
```

### Vì sao không đưa OCR vào `metadata_intelligence.fuse()`

Pipeline MI (`field_fusion.py`) cân các nguồn web/API theo `source_reliability` và yêu cầu bằng chứng có locator
kiểm chứng được (`JSON_POINTER` vào payload gốc, `TEXT_SPAN` vào văn bản nguồn). Một quan sát OCR không có locator
như vậy: `observedText` là bản chép của chính model, không phải văn bản nguồn độc lập. Nhét nó vào `fuse()` sẽ buộc
phải tạo locator giả hoặc coi model là một "nguồn" ngang hàng với nhà cung cấp. Vì vậy:

- OCR có schema bằng chứng riêng (`Observation`: `source` = loại ảnh, `observedText`, `issues`) và **không** bao giờ
  được gọi là "đã xác minh" chỉ vì có `observedText`.
- MI được tái sử dụng ở những chỗ có nghĩa: `normalization.clean/normalize`, `verification.canonical_isbn`,
  `evidence_validation.ROLE_LABELS`, và toàn bộ pipeline lookup (qua `lookup_book_by_isbn`, kể cả MI v2).
- Hợp nhất ảnh ↔ lookup làm ở `reconcile.py` theo quy tắc minh bạch bên dưới.

## 2. Trạng thái và quy tắc

| Trạng thái | Ý nghĩa | Tự điền? |
|---|---|---|
| `EXTRACTED` | Một ảnh có giá trị hợp lệ, có bằng chứng, đúng vai trò | Có |
| `CORROBORATED` | Hai nguồn độc lập khớp: 2 ảnh, ảnh + mã vạch, hoặc ảnh + ISBN lookup | Có |
| `LOOKUP_ONLY` | Ảnh không có, ISBN lookup (cùng ISBN in trên sách) có | Có, trừ khi nguồn lookup tự đánh dấu xung đột/độ tin thấp hoặc lookup trả ấn bản khác |
| `REVIEW_REQUIRED` | Có giá trị nhưng cần người xem (ví dụ thiếu nhãn vai trò, ảnh khác nhau về dấu, khớp một phần) | Không |
| `CONFLICTED` | Các nguồn khác nhau — không chọn giá trị nào, hiển thị mọi lựa chọn | Không |
| `INVALID` | Có đọc nhưng mọi lần đọc đều sai (checksum, ngoài khoảng, không có bằng chứng, sai vai trò) | Không |
| `INFERRED` | Suy ra bằng quy tắc, không đọc (chỉ `language`: chữ tiếng Việt có dấu ⇒ `vi`) | Không |
| `MISSING` | Không thấy | — |

Quy tắc quan trọng:

- **Không tự giải quyết xung đột.** Ưu tiên nguồn theo trường (ví dụ trang xuất bản trước bìa với NXB/năm) chỉ dùng
  để chọn *cách viết* khi các nguồn đã khớp (ví dụ "Nhà giả kim" thay vì "NHÀ GIẢ KIM").
- **ISBN:** chỉ 978/979 + checksum đúng. Mã 893… (EAN bán lẻ), mã sản phẩm, SKU được báo riêng trong `otherCodes`,
  không bao giờ thành ISBN. Ảnh khác ISBN nhau ⇒ `CONFLICTED`, không gọi lookup.
- **Năm:** `publicationYear` → ô *Năm xuất bản*; năm in/nộp lưu chiểu (`printYear`), năm © (`copyrightYear`) và
  lần tái bản/in (`editionStatement`) chỉ hiển thị, không tự điền.
- **Ấn bản:** lookup trả bản ghi có ISBN khác ISBN in trên sách ⇒ không trường nào từ lookup được coi là an toàn,
  giá trị đọc từ ảnh giữ nguyên ở trạng thái `REVIEW_REQUIRED`.
- **ISBN của cuốn khác:** ISBN khớp chưa đủ — mã vạch/ISBN có thể thuộc sách khác (tem dán, in nhầm, ISBN bộ).
  Nếu tên sách đọc từ ảnh khác tên trong bản ghi lookup ⇒ `LOOKUP_TITLE_MISMATCH`: không trường nào từ lookup được tự
  điền, không dùng lookup để "đối chiếu", và chính ISBN chuyển sang `REVIEW_REQUIRED` (kiểm chứng live: bìa
  *Hội Phượng Hoàng* + mã vạch của *Philosopher's Stone*).
- **Ảnh của hai cuốn khác nhau:** tên sách hoặc ISBN xung đột giữa các ảnh ⇒ toàn bộ đề xuất thành không an toàn
  (`IMAGES_MAY_SHOW_DIFFERENT_BOOKS`).
- **ISBN lookup “khớp” ISBN không phải là bằng chứng độc lập** (lookup được gọi bằng chính ISBN đó) nên trạng thái
  ISBN không được nâng lên `CORROBORATED` vì lookup.
- **Không có điểm tin cậy do model tự đánh giá.** Trạng thái là kết quả quy tắc.

## 3. API

### `GET /ai/book-metadata/capabilities`

```json
{"enabled": true, "imageKinds": ["front_cover", "back_cover", "copyright_page"], "maxImages": 3,
 "maxFileBytes": 8388608, "maxTotalBytes": 8388608, "acceptedTypes": ["image/jpeg", "image/png", "image/webp"],
 "model": "qwen/qwen3.7-flash"}
```

### `POST /ai/book-metadata/scan-images`

`multipart/form-data`, `Authorization: Bearer <token>` (manager + `inventory.catalog.write`).

| Part | Bắt buộc | Ghi chú |
|---|---|---|
| `front_cover` | ít nhất 1 trong 3 | JPG/PNG/WebP, tối đa 1 file mỗi loại |
| `back_cover` | | |
| `copyright_page` | | |
| `barcode` | không | EAN-13 trình duyệt giải mã từ bìa sau; server tự kiểm tra là ISBN |

```bash
curl -H "Authorization: Bearer $TOKEN" \
  -F "front_cover=@bia-truoc.jpg;type=image/jpeg" \
  -F "copyright_page=@trang-xuat-ban.jpg;type=image/jpeg" \
  http://localhost:3000/ai/book-metadata/scan-images
```

Response 200 (rút gọn từ một lần chạy thật, ảnh bìa trước *Harry Potter và Hội Phượng Hoàng*):

```json
{
  "schemaVersion": "book-ocr-scan-v1", "promptVersion": "book-ocr-v2", "status": "SUCCESS",
  "metadata": {"title": "Harry Potter và Hội Phượng Hoàng", "subtitle": null, "authors": ["J.K. Rowling"],
               "translators": ["Lý Lan"], "publisher": "Nhà xuất bản Trẻ", "distributor": null, "isbn13": null,
               "isbn10": null, "publishedYear": null, "printYear": null, "copyrightYear": null,
               "editionStatement": "In lần thứ 40", "pageCount": null, "coverPrice": null, "description": null,
               "language": "vi"},
  "fields": {"translators": {"field": "translators", "status": "EXTRACTED", "value": ["Lý Lan"], "sources": ["front_cover"],
             "observations": [{"source": "front_cover", "value": ["Lý Lan"], "normalizedValue": ["Lý Lan"],
                               "observedText": "LÝ LAN dịch", "valid": true, "issues": []}], "reasons": []}},
  "fieldEvidence": {"translators": [{"source": "front_cover", "observedText": "LÝ LAN dịch"}]},
  "missingFields": ["subtitle", "distributor", "isbn13", "publishedYear", "printYear", "copyrightYear", "pageCount", "coverPrice", "description"],
  "conflictedFields": [], "otherCodes": [], "warnings": [],
  "isbnLookup": {"status": "SKIPPED_NO_VALID_ISBN", "isbn": null, "editionMatches": null, "lookup": null},
  "proposals": {
    "title": {"formField": "title", "value": "Harry Potter và Hội Phượng Hoàng", "status": "EXTRACTED", "source": "images",
              "safeToApply": true, "reasons": [], "ocrValue": "Harry Potter và Hội Phượng Hoàng", "lookupValue": null,
              "options": [{"source": "images", "value": "Harry Potter và Hội Phượng Hoàng"}]},
    "isbn": {"formField": "isbn", "value": null, "status": "MISSING", "source": null, "safeToApply": false,
             "reasons": [], "ocrValue": null, "lookupValue": null, "options": []}
  },
  "usage": {"model": "qwen/qwen3.7-flash", "fallbackUsed": false, "cacheHit": false, "imageCount": 1,
            "promptTokens": 1355, "completionTokens": 385, "costUsd": 0.000104, "latencyMs": 7802,
            "calls": [{"model": "qwen/qwen3.7-flash", "trigger": "primary", "status": "OK", "latencyMs": 7802,
                       "promptTokens": 1355, "completionTokens": 385, "costUsd": 0.000104305, "error": null}]},
  "processingTimeMs": 7965
}
```

`proposals` có một mục cho mỗi ô form: `isbn`, `isbn13`, `isbn10`, `title`, `subtitle`, `authorsText`,
`translatorText`, `publisher`, `publishedDate`, `pageCount`, `description`, `language`, `categoriesText`
(thể loại chỉ đến từ lookup). Khi `isbnLookup.status = FOUND`, `isbnLookup.lookup` là nguyên response
`LookupBookByIsbnResponse` của tra cứu ISBN — web dùng nó để tạo reconciliation draft như luồng ISBN.

Lỗi luôn có dạng `{"message": "<tiếng Việt>", "code": "<MÃ>"}`:

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `NO_IMAGES`, `UNKNOWN_IMAGE_SLOT`, `DUPLICATE_IMAGE_SLOT`, `TOO_MANY_IMAGES`, `INVALID_UPLOAD`, `EMPTY_IMAGE`, `CORRUPT_IMAGE`, `IMAGE_TOO_SMALL` | Upload sai |
| 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN` | Chưa đăng nhập / không có quyền import catalog |
| 404 | `BOOK_OCR_DISABLED` | `BOOK_OCR_ENABLED=false` |
| 413 | `IMAGE_TOO_LARGE`, `UPLOAD_TOO_LARGE`, `IMAGE_DIMENSIONS_TOO_LARGE` | Vượt giới hạn |
| 415 | `UNSUPPORTED_IMAGE_TYPE` | Không phải JPG/PNG/WebP thật (kể cả đổi đuôi/Content-Type) |
| 429 | `AI_RATE_LIMITED`, `OCR_BUSY` | OpenRouter 429 / đang quá số lượt quét đồng thời |
| 502 | `AI_UPSTREAM_ERROR`, `AI_INVALID_RESPONSE`, `AI_INVALID_SCHEMA` | OpenRouter 5xx / JSON hỏng / sai cấu trúc |
| 503 | `AI_NOT_CONFIGURED`, `AUTH_UNAVAILABLE` | Thiếu API key / không xác minh được quyền |
| 504 | `AI_TIMEOUT` | Model quá `BOOK_OCR_TIMEOUT_SECONDS` |

Endpoint chỉ đọc: không ghi catalog, không tạo draft (draft và duplicate review do web tạo sau, như luồng ISBN).

## 4. Chi phí, hiệu năng, cấu hình

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `BOOK_OCR_ENABLED` | `true` | |
| `OPENROUTER_BOOK_OCR_MODEL` | `qwen/qwen3.7-flash` | Không ảnh hưởng chatbot/vision chung |
| `OPENROUTER_BOOK_OCR_FALLBACK_MODEL` | *(rỗng)* | Rỗng = không bao giờ gọi model khác. **Không** dùng `OPENROUTER_FALLBACK_MODEL` chung |
| `BOOK_OCR_FALLBACK_DAILY_BUDGET_USD` | `0.5` | Trần chi phí fallback/ngày (trong process); cost không báo được tính 0,01 USD |
| `BOOK_OCR_MAX_IMAGES` | `3` | |
| `BOOK_OCR_MAX_TOKENS` | `1800` | Đủ cho JSON 3 ảnh kèm đoạn giới thiệu; đo thực tế 352–455 token output cho 1 ảnh bìa |
| `BOOK_OCR_TIMEOUT_SECONDS` | `45` | Retry cùng model chỉ khi 429/5xx trả nhanh |
| `BOOK_OCR_MAX_FILE_MB` / `BOOK_OCR_MAX_TOTAL_MB` | `8` / `8` | Tổng = trần 8 MB của gateway; web resize trước khi gửi |
| `BOOK_OCR_MAX_IMAGE_EDGE` | `1600` | Đủ đọc chữ 6–7pt trang xuất bản khổ A5 chụp điện thoại |
| `BOOK_OCR_LOOKUP_TIMEOUT_SECONDS` | `35` | Quá hạn ⇒ vẫn trả kết quả OCR, cảnh báo `ISBN_LOOKUP_TIMEOUT` |
| `BOOK_OCR_MAX_CONCURRENCY` | `2` | Vượt ⇒ 429 `OCR_BUSY` ngay (không xếp hàng, bảo vệ RAM VPS) |
| `BOOK_OCR_MAX_PIXELS` | `40000000` | Chặn ảnh khổng lồ trước khi decode |

- Không model nào chạy trên VPS; không GPU; Pillow đã có sẵn trong `requirements.txt` — **không thêm dependency**.
- 1–3 ảnh trong **một** request (một lần overhead prompt). Chưa benchmark "từng ảnh riêng" vì chưa có dataset 3 ảnh
  có nhãn — xem đánh giá.
- Cache 24 giờ theo hash ảnh đã xử lý + model + prompt: quét lại cùng ảnh không tốn phí (`usage.cacheHit`);
  web còn chặn gửi lại khi ảnh chưa đổi.
- Fallback chỉ khi model chính lỗi upstream, trả JSON không dùng được, hoặc **không đọc được cả tên sách lẫn ISBN**;
  tối đa 1 lần/scan và trong ngân sách ngày. Thiếu trường tùy chọn hay xung đột giữa ảnh không gọi fallback
  (ý kiến của model thứ hai không quyết định được chữ in nào đúng — xung đột thuộc về nhân viên).
- Theo dõi: log `book_ocr_scan {...}` (số ảnh, outcome, model, token, chi phí, latency, trạng thái lookup — không
  có ảnh, không có API key), log `llm_call feature=book_ocr` và metrics Prometheus `ai_llm_tokens_total`,
  `ai_llm_cost_usd_total` (feature=`book_ocr`), `ai_book_ocr_scans_total{outcome,images}`.

Số đo thật (smoke 2026-10-23, 9 lần quét 1 ảnh bìa, báo cáo `eval/reports/book_ocr_20261023_134306.*`):
1.355–2.370 token input, 352–455 token output, **0,000104–0,000134 USD/lần quét (trung bình 0,000116)**,
model 7,5–11,5 s. Chưa có số đo cho 3 ảnh/lần (cần dataset ảnh bìa sau và trang xuất bản).

## 5. Hướng dẫn cho nhân viên

1. Mở **Nhập sách qua AI** → khối **Nhập sách bằng hình ảnh (AI OCR)**.
2. Chọn hoặc kéo thả ảnh vào 1–3 ô: *Bìa trước*, *Bìa sau*, *Trang thông tin xuất bản*. Trên điện thoại, ô chọn ảnh
   cho phép chụp trực tiếp. Có thể *Thay ảnh* hoặc *Xóa*.
3. Bấm **Quét và trích xuất bằng AI** (thường 5–30 giây; có thể *Hủy quét*; trang không bị khóa).
4. Các trường **an toàn** được điền sẵn vào ô còn trống. Trường bạn đã gõ **không bao giờ** bị ghi đè tự động.
5. Trong **Kết quả đọc ảnh**: xem trạng thái từng trường, mở *Bằng chứng từ ảnh* để đối chiếu đoạn chữ AI đọc được,
   *Xem lại* ảnh gốc. Trường **Xung đột** phải tự chọn một giá trị (hoặc gõ tay). **Cần kiểm tra** nghĩa là có giá trị
   nhưng chưa tự điền.
6. Thiếu ISBN thì nhập tay (ISBN vẫn bắt buộc khi lưu). Nếu có bản ghi ISBN, tab **Kiểm duyệt** xử lý authority và
   trùng lặp như tra cứu ISBN.
7. So với sách thật lần cuối, rồi bấm **Lưu**.

Mẹo chụp: ảnh thẳng, đủ sáng, không lóa; chụp trang xuất bản gần để chữ nhỏ rõ; nên có ít nhất bìa trước + trang
xuất bản để tên sách được đối chiếu hai nguồn.

## 6. Khi nào OCR có thể sai

- **Sai dấu tiếng Việt từ một ảnh duy nhất** — ví dụ thật: "Pháp sư *tiễn* táng" được đọc thành "*tiến*" cả 3 lần;
  một ảnh không có gì để đối chiếu nên giá trị vẫn là `EXTRACTED` và được tự điền. Thêm trang xuất bản để có
  `CORROBORATED`, và luôn so với sách thật.
- **Kết quả dao động giữa các lần gọi**: cùng một ảnh, "NHÀ XUẤT BẢN TRẺ" có lần đọc thành "NHA XUẤT BẢN TRẺ" hoặc mất
  hết dấu (khi đó thiếu nhãn NXB ⇒ `REVIEW_REQUIRED`, không tự điền).
- Chữ cách điệu, chữ trên nền ảnh, ảnh lóa/nghiêng; bìa chỉ in chữ hoa (giữ nguyên, không tự đổi hoa thường).
- Bộ sách có nhiều ISBN (ISBN bộ và ISBN tập) ⇒ `CONFLICTED`, phải chọn.
- Năm ghi trong số ĐKXB/QĐXB không phải năm xuất bản; trang chỉ có "nộp lưu chiểu năm …" ⇒ ô năm xuất bản để trống.
- `observedText` là bản chép của model: kiểm tra grounding chỉ bắt giá trị *không khớp với chính bản chép đó*
  (suy đoán, bịa, sai vai trò), không chứng minh chữ đó thật sự có trong ảnh.

## 7. File và kiểm thử

| Phần | File |
|---|---|
| Provider | `services/ai-service/llm_provider.py` (`VisionImage`, `analyze_images`, `openrouter_connection`) |
| OCR | `services/ai-service/book_ocr/` (`config`, `images`, `prompts`, `schemas`, `normalization`, `validation`, `extractor`, `reconcile`, `service`, `errors`) |
| API | `services/ai-service/routes_book_ocr.py`, `catalog_access.py` (cổng quyền dùng chung với MI) |
| Quyền | `services/inventory-service/src/routes/metadata-reconciliation.routes.js` (`GET /capabilities/import`) |
| Web | `apps/web/src/components/pages/ai-import/{image-ocr-card,ocr-review-panel,use-book-ocr,index}.tsx`, `src/lib/book-ocr.ts`, `src/lib/decode-barcode-file.ts`, `src/services/book-ocr.ts` |
| Test | `services/ai-service/test_book_ocr.py` (55), `eval/book_ocr_eval/test_ocr_scoring.py` (5), `apps/web/tests/book-ocr.test.mjs` (8), `apps/web/e2e/ai-import-ocr.spec.ts` (3), `services/inventory-service/test/metadata-intelligence-routes.test.js` |
