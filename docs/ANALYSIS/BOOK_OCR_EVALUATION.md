# Đánh giá AI Multi-Image OCR Book Import

Ngày: 2026-10-23 · Prompt `book-ocr-v2` · Code: `services/ai-service/eval/book_ocr_eval/`

> **Tình trạng:** đã có framework đánh giá, schema dataset, mẫu dataset và một **smoke set 3 ảnh bìa trước** do người
> phát triển tự gán nhãn. **Chưa có dataset sách tiếng Việt 3 ảnh có nhãn**, nên tài liệu này **không** công bố số liệu
> benchmark. Số trong mục 4 chỉ chứng minh pipeline thật chạy được và minh họa các loại lỗi.

## 1. Câu hỏi đánh giá

1. OCR đọc đúng các trường thư mục (tên sách, tác giả, dịch giả, NXB, năm xuất bản, ISBN, số trang) đến mức nào?
2. Hệ thống có **bịa** giá trị cho trường không in trên ảnh không?
3. Những gì được **tự điền** vào form có đáng tin hơn toàn bộ những gì đọc được không (tức là các quy tắc an toàn
   có tác dụng)?
4. Chi phí và độ trễ thực tế mỗi cuốn trên VPS không GPU.
5. So sánh nhiều model OpenRouter trên cùng dữ liệu.

## 2. Dataset

Schema: `eval/book_ocr_eval/dataset.schema.json`; mẫu: `dataset.example.json`.

```json
{"bookId": "...", "split": "development|test|smoke",
 "images": {"front_cover": "x/front.jpg", "back_cover": "x/back.jpg", "copyright_page": "x/copyright.jpg"},
 "groundTruth": {"title": "...", "subtitle": null, "authors": ["..."], "translators": [], "publisher": "...",
                 "publishedYear": 2024, "isbn13": "978...", "pageCount": 320}}
```

Quy tắc gán nhãn (quan trọng cho tính đúng của chỉ số):

- Chỉ ghi những gì **in trên các ảnh đã cho**, đúng dấu tiếng Việt. Biết từ nguồn khác mà không in ⇒ `null`/`[]`.
  Nhờ vậy, giá trị dự đoán cho trường không in được tính là **hallucination**.
- `authors` gồm "Nguyên tác", không gồm người minh họa/dịch giả. `publisher` là NXB, không phải đơn vị liên kết.
- `publishedYear` chỉ khi ghi rõ năm xuất bản (năm in/nộp lưu chiểu/©/số ĐKXB ⇒ `null`).
- `subtitle` là tựa phụ tiếng Việt; tên gốc tiếng nước ngoài và số tập không phải tựa phụ.
- ISBN-10 trên sách đổi sang ISBN-13; mã 893… (EAN bán lẻ) ⇒ `isbn13: null`.

Đề xuất xây dataset thật: 50–100 cuốn sách tiếng Việt từ kho thư viện, đủ 3 ảnh mỗi cuốn, chụp bằng điện thoại trong
điều kiện làm việc thật; trộn sách văn học, giáo khoa, truyện tranh, sách dịch, sách tái bản; hai người gán nhãn độc lập
(đo đồng thuận), chia `development`/`test` theo cuốn và **chốt prompt trước khi chạy `test`**.
Ảnh bìa có bản quyền: lưu ngoài repo, truyền thư mục bằng `--images-root`.

## 3. Chỉ số (định nghĩa trong `ocr_scoring.py`)

So khớp **exact** = không phân biệt hoa/thường, khoảng trắng, dấu câu nhưng **phân biệt dấu thanh** (mất/sai dấu là sai
giá trị tiếng Việt). **Normalized** = bỏ qua cả dấu (chỉ báo cáo cho tên sách, để tách lỗi dấu khỏi lỗi chữ).

Mỗi lần quét chấm hai "góc nhìn":

- **reading** = `response.metadata`: mọi giá trị đọc được và qua kiểm tra (kể cả cần review).
- **autofill** = các `proposals` có `safeToApply`: thứ form tự nhận mà không cần ai bấm.

| Chỉ số | Định nghĩa |
|---|---|
| ISBN / Title (exact, normalized) / Authors / Publisher / Year accuracy | Đúng / số cuốn có trường đó in trên ảnh (reading) |
| Precision, Recall, F1 theo trường + micro | TP = đúng; FP = sai giá trị **hoặc** có giá trị cho trường không in; FN = có in nhưng không trả |
| Field coverage | (TP + FP_sai_giá_trị) / số trường có in |
| Hallucination rate | Số giá trị cho trường **không in** / tổng số giá trị trả về |
| Invalid ISBN rate | Lần đọc ISBN bị loại (checksum, không phải 978/979, sai định dạng) / tổng lần đọc ISBN từ ảnh |
| JSON validity rate | Lần quét model trả JSON dùng được / lần quét model có trả lời (timeout không tính) |
| Malformed observations / scan | Số mục model trả sai cấu trúc bị loại, trung bình mỗi lần quét |
| Latency mean / P95 | `processingTimeMs` (tiền xử lý + model + kiểm tra; lookup tắt) |
| Cost / book | `usage.costUsd` do OpenRouter báo, trung bình mỗi lần quét |
| Autofill precision | Precision của góc nhìn autofill — chỉ số an toàn chính |
| Manual correction rate | Trường có in mà form tự điền sai hoặc để trống / số trường có in (việc nhân viên còn phải làm) |

Không có chỉ số "độ tin cậy" của model; mọi chỉ số được tính từ nhãn.

## 4. Chạy đánh giá

```bash
cd services/ai-service
# Kiểm tra harness (không cần API key, không tốn phí, PHẢI ra 100% - không phải kết quả):
python eval/book_ocr_eval/run_benchmark.py --dataset eval/book_ocr_eval/smoke_dataset.json --images-root ../../.. --dry-run
# Chạy thật, nhiều model, lặp 3 lần mỗi cuốn (model dao động giữa các lần gọi):
OPENROUTER_API_KEY=... python eval/book_ocr_eval/run_benchmark.py \
  --dataset <dataset.json> --images-root <thư mục ảnh> --models qwen/qwen3.7-flash,<model khác> --runs 3
```

Runner chạy đúng pipeline production (`book_ocr.service.scan_book_images`: resize, 1 lời gọi multimodal, kiểm tra,
proposals) với ISBN lookup **tắt** để số đo phản ánh OCR; xóa cache trước mỗi lần quét; ghi
`eval/reports/book_ocr_<thời gian>.{json,md}` (JSON có toàn bộ response từng lần quét để phân tích lỗi).
Unit test chỉ số: `python -m pytest services/ai-service/eval/book_ocr_eval`.

So sánh "3 ảnh một request" với "từng ảnh riêng": chưa làm — cần dataset 3 ảnh. Thiết kế đề xuất: thêm cờ chạy mỗi ảnh
một request rồi hợp nhất bằng chính `validation.aggregate`, so F1/chi phí/độ trễ trên cùng tập `development`.

## 5. Smoke run 2026-10-23 (KHÔNG phải benchmark)

3 ảnh **bìa trước** (Dế Mèn phiêu lưu ký – NXB Kim Đồng; Harry Potter và Hội Phượng Hoàng – NXB Trẻ; Frieren Pháp sư
tiễn táng tập 1 – NXB Kim Đồng), mỗi ảnh 3 lần, `qwen/qwen3.7-flash`, prompt v2. Không có ISBN/năm/số trang trên bìa
trước nên các chỉ số đó không đo được. Báo cáo: `services/ai-service/eval/reports/book_ocr_20261023_134306.{md,json}`.

| Chỉ số | Giá trị (n = 9 lần quét, 3 cuốn) |
|---|---|
| Quét thành công / JSON hợp lệ | 9/9 / 100% |
| Title exact / normalized | 66,7% / 100% |
| Authors / Publisher | 100% / 100% |
| Reading micro F1 | 95,2% |
| Hallucination rate | 0% |
| Autofill precision | 90,9% (30 đúng, 3 sai) |
| Manual correction rate | 9,1% |
| Latency mean / P95 | 8.648 / 11.586 ms |
| Chi phí / lần quét | 0,000116 USD (tổng 0,001046 USD) |

Diễn giải trung thực:

- Cả 3 lỗi đều là **cùng một lỗi dấu**: "Pháp sư *tiễn* táng" đọc thành "*tiến*" ở cả 3 lần. Vì chỉ có một ảnh, không
  có nguồn đối chiếu nên giá trị sai vẫn ở trạng thái `EXTRACTED` và được tự điền ⇒ autofill precision 90,9%.
  Đây là giới hạn thật của OCR một ảnh; cách giảm là thêm trang xuất bản (hai nguồn ⇒ `CORROBORATED`/`CONFLICTED`).
- n = 3 cuốn: không đủ để kết luận về độ chính xác của model; khoảng tin cậy rất rộng.
- Phát hiện trong quá trình làm (đã sửa, có test hồi quy):
  - Prompt v1 chỉ đưa mảng rỗng trong mẫu JSON ⇒ Qwen trả **chuỗi trần không nguồn/bằng chứng**; server loại hết
    (đúng thiết kế) ⇒ 3/3 lần `NO_DATA`. Prompt v2 đưa ví dụ object đầy đủ.
  - Model đôi khi trả trường đơn trị dạng mảng 1 phần tử, hoặc chèn dấu câu ("Frieren - Pháp sư…") ⇒ trước đây bị
    loại oan; nay mở gói mảng 1 phần tử và so khớp theo chuỗi từ (vẫn phân biệt dấu thanh).
  - Tên gốc tiếng Anh bị đưa vào tựa phụ; tên họa sĩ bị đưa vào `otherCodes` ⇒ siết prompt và lọc `otherCodes`
    phải có chữ số.
  - Cùng ảnh, có lần model đọc "NHÀ" thành "NHA" hoặc bỏ hết dấu ⇒ không có nhãn NXB hợp lệ ⇒ `REVIEW_REQUIRED`, không tự điền.
- Một lần quét live qua UI với bìa *Dế Mèn* + trang *Harry Potter* (hai cuốn khác nhau): tên sách, tác giả, NXB đều
  `CONFLICTED`, không giá trị nào được tự chọn; sau đó thêm quy tắc "ảnh của hai cuốn khác nhau ⇒ không tự điền gì".
