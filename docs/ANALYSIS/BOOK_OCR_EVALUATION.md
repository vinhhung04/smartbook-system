# Đánh giá AI Multi-Image OCR Book Import

Ngày: 2026-10-23 · Prompt `book-ocr-v2` · Model `qwen/qwen3.7-flash` · Code: `services/ai-service/eval/book_ocr_eval/`

> **Tình trạng:** có framework đánh giá 3 ảnh (schema, hướng dẫn gán nhãn, runner, 3 lớp chỉ số, chế độ replay không tốn
> phí), một **smoke set 3 ảnh bìa trước** do người phát triển tự gán nhãn và 27 lần quét live (9 + 18).
> **Chưa có dataset sách tiếng Việt 3 ảnh có nhãn (mục tiêu ≥ 50 cuốn)**, nên tài liệu này **không** công bố số liệu
> benchmark. Số trong mục 5–7 chỉ chứng minh pipeline thật chạy được, đo chi phí/độ trễ một ảnh và minh họa các loại lỗi.
> Mẫu báo cáo benchmark (mục 8) để trống có chủ ý.

## 1. Câu hỏi đánh giá

1. OCR đọc đúng các trường thư mục (tên sách, tác giả, dịch giả, NXB, năm xuất bản, ISBN, số trang) đến mức nào?
2. Hệ thống có **bịa** giá trị cho trường không in trên ảnh không?
3. Những gì được **tự điền** vào form có đáng tin hơn toàn bộ những gì đọc được không (tức là các quy tắc an toàn
   có tác dụng)? Cải tiến đến từ model hay từ hậu xử lý?
4. Nhân viên còn phải làm bao nhiêu: bấm một lần hay gõ lại?
5. Chi phí và độ trễ thực tế mỗi cuốn trên VPS không GPU.
6. So sánh nhiều model OpenRouter / kích thước ảnh trên cùng dữ liệu.

## 2. Dataset

Schema: `eval/book_ocr_eval/dataset.schema.json`; mẫu: `dataset.example.json` (giá trị hư cấu, không phải dữ liệu).

```json
{"bookId": "...", "split": "development|test|smoke", "tags": ["translated", "isbn13", "glare"],
 "images": {"front_cover": "x/front.jpg", "back_cover": "x/back.jpg", "copyright_page": "x/copyright.jpg"},
 "groundTruth": {"title": "...", "subtitle": null, "authors": ["..."], "translators": [], "publisher": "...",
                 "publishedYear": 2024, "isbn13": "978...", "pageCount": 320}}
```

### 2.1. Thiết kế benchmark ≥ 50 cuốn (chưa thực hiện)

Mỗi cuốn tối đa 3 ảnh, chụp bằng điện thoại trong điều kiện làm việc thật, lấy từ kho thư viện (ảnh bìa có bản quyền:
**lưu ngoài repo**, truyền thư mục bằng `--images-root`; không tải hàng loạt ảnh từ internet). Phân tầng bằng `tags`
để runner báo riêng từng nhóm (`by_tag`):

| Nhóm (tag) | Tối thiểu | Ghi chú |
|---|---|---|
| `vn-literature` | 10 | Văn học Việt Nam, nhiều dấu |
| `translated` | 10 | Có dịch giả, tên gốc nước ngoài (bẫy tựa phụ) |
| `textbook` | 6 | Giáo trình / sách giáo khoa |
| `comic` | 6 | Truyện tranh (họa sĩ ≠ tác giả, số tập) |
| `reprint` | 5 | Tái bản: năm in ≠ năm xuất bản |
| `multi-author` | 5 | Nhiều tác giả (bìa ghi thiếu) |
| `isbn13` / `isbn10` / `no-isbn` | 30 / 5 / 5 | Gồm cả sách chỉ có EAN 893… |
| `clear` / `tilted` / `glare` / `small-print` | mỗi loại ≥ 8 | Một cuốn có thể mang nhiều tag |

Chia `development` / `test` theo **cuốn** (không theo ảnh); chốt prompt và chính sách trên `development` rồi mới chạy
`test` một lần.

### 2.2. Hướng dẫn gán nhãn

- Chỉ ghi những gì **in trên các ảnh đã cho**, đúng dấu tiếng Việt. Biết từ nguồn khác mà không in ⇒ `null`/`[]`.
  Nhờ vậy, giá trị dự đoán cho trường không in được tính là **hallucination**.
- `authors` gồm "Nguyên tác", không gồm người minh họa/dịch giả. `publisher` là NXB, không phải đơn vị liên kết.
- `publishedYear` chỉ khi ghi rõ năm xuất bản (năm in/nộp lưu chiểu/©/số ĐKXB ⇒ `null`).
- `subtitle` là tựa phụ tiếng Việt; tên gốc tiếng nước ngoài và số tập không phải tựa phụ.
- ISBN-10 trên sách đổi sang ISBN-13; mã 893… (EAN bán lẻ) ⇒ `isbn13: null`. ISBN bộ và ISBN tập cùng in ⇒ ghi ISBN
  của **tập** đang chụp, ghi chú vào `notes`.
- Viết đúng như in (giữ hoa/thường không quan trọng — chỉ số không phân biệt), nhưng **dấu phải đúng**.
- Hai người gán nhãn độc lập; trường bất đồng được người thứ ba quyết định; báo cáo tỉ lệ đồng thuận trước khi chạy.

## 3. Chỉ số (định nghĩa trong `ocr_scoring.py`)

So khớp **exact** = không phân biệt hoa/thường, khoảng trắng, dấu câu nhưng **phân biệt dấu thanh** (mất/sai dấu là sai
giá trị tiếng Việt). **Normalized** = bỏ qua cả dấu (chỉ báo cáo cho tên sách, để tách lỗi dấu khỏi lỗi chữ).

Mỗi lần quét chấm **ba lớp**, để biết cải tiến đến từ model hay từ hậu xử lý:

- **raw** = câu trả lời của model trước kiểm tra (lần đọc đầu tiên mỗi trường, hợp lệ hay không; không tính mã vạch).
- **reading** = `response.metadata`: giá trị qua kiểm tra (kể cả cần review).
- **autofill** = các `proposals` có `safeToApply`: thứ form tự nhận mà không cần ai bấm.

| Chỉ số | Định nghĩa |
|---|---|
| ISBN / Title (exact, normalized) / Authors / Publisher / Year accuracy | Đúng / số cuốn có trường đó in trên ảnh (reading) |
| Precision, Recall, F1 theo trường + micro, cho từng lớp | TP = đúng; FP = sai giá trị **hoặc** có giá trị cho trường không in; FN = có in nhưng không trả |
| Field coverage | (TP + FP_sai_giá_trị) / số trường có in |
| Hallucination rate | Số giá trị cho trường **không in** / tổng số giá trị trả về (từng lớp) |
| Autofill precision | Precision của lớp autofill — chỉ số an toàn chính |
| Manual correction rate | Trường có in mà form tự điền sai hoặc để trống / số trường có in |
| ↳ One-click rate | …trong đó panel **có sẵn** giá trị đúng (giá trị đề xuất hoặc một lựa chọn) — chỉ cần bấm |
| ↳ Typing rate | …trong đó phải tự gõ (không đề xuất nào đúng) |
| Invalid ISBN rate | Lần đọc ISBN bị loại (checksum, không phải 978/979, sai định dạng) / tổng lần đọc ISBN từ ảnh |
| JSON validity rate | Lần quét model trả JSON dùng được / lần quét model có trả lời (timeout không tính) |
| Malformed observations / scan | Số mục model trả sai cấu trúc bị loại, trung bình mỗi lần quét |
| Latency mean / P50 / P95 | `processingTimeMs` (tiền xử lý + model + kiểm tra; lookup tắt) |
| Tokens in / out | Trung bình `usage.promptTokens` / `completionTokens` |
| Cost / book | `usage.costUsd` do OpenRouter báo, trung bình mỗi lần quét |

Không có chỉ số "độ tin cậy" của model; mọi chỉ số được tính từ nhãn.

## 4. Chạy đánh giá

```bash
cd services/ai-service
# Kiểm tra harness (không cần API key, không tốn phí; raw/reading PHẢI ra 100% - không phải kết quả):
python eval/book_ocr_eval/run_benchmark.py --dataset eval/book_ocr_eval/smoke_dataset.json --images-root ../../.. --dry-run
# Chạy thật, nhiều model, lặp 3 lần mỗi cuốn (model dao động giữa các lần gọi):
OPENROUTER_API_KEY=... python eval/book_ocr_eval/run_benchmark.py \
  --dataset <dataset.json> --images-root <thư mục ảnh> --models qwen/qwen3.7-flash,<model khác> --runs 3
# So sánh kích thước tiền xử lý (mặc định production vẫn 1600):
  ... --max-edge 1600,2048
# Chấm lại câu trả lời ĐÃ LƯU của model bằng code hiện tại (0 lời gọi, 0 phí) - tách tác động của hậu xử lý:
python eval/book_ocr_eval/run_benchmark.py --dataset <cùng dataset> --images-root <...> --replay eval/reports/book_ocr_<...>.json
```

Runner chạy đúng pipeline production (`book_ocr.service.scan_book_images`) với ISBN lookup **tắt**; xóa cache trước
mỗi lần quét; lưu câu trả lời của model (`modelAnswer`) để replay; ghi `eval/reports/book_ocr_<thời gian>.{json,md}`.
Báo cáo cũ (trước khi lưu `modelAnswer`) vẫn replay được: câu trả lời được dựng lại từ `fields[*].observations`.
So sánh model khác: cùng dataset, cùng prompt, cùng quy tắc chấm — chỉ đổi `--models`; không tự đổi model production.
Unit test chỉ số: `python -m pytest services/ai-service/eval/book_ocr_eval` (8).

Chưa làm (cần dataset 3 ảnh): so "3 ảnh một request" với "từng ảnh riêng"; crop vùng chữ (cần phát hiện vùng chữ —
Pillow không đủ, OpenCV là dependency nặng nên chưa thêm); OCR lại có điều kiện ảnh trang xuất bản ở 2048 px khi thiếu
trường quan trọng (chỉ đáng làm nếu `--max-edge` cho thấy 2048 cải thiện rõ trên trang xuất bản).

## 5. Smoke run 1 – 2026-10-23 (KHÔNG phải benchmark; OCR 1.0)

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

## 6. Trước / sau OCR 2.0 trên **cùng** câu trả lời của model (replay, không tốn phí)

9 câu trả lời đã lưu của smoke run 1 được chấm lại qua pipeline OCR 1.0 (commit `076c729`) và OCR 2.0, cùng code chấm
điểm. Model không đổi nên mọi khác biệt là do hậu xử lý. Báo cáo:
`eval/reports/book_ocr_20261023_134306_replay_ocr1-code.*` và `..._replay_ocr2-code.*`.

| Lớp / chỉ số | OCR 1.0 | OCR 2.0 |
|---|---|---|
| raw: precision / recall / hallucination | 90,9% / 100% / 0% | 90,9% / 100% / 0% (cùng câu trả lời) |
| reading: precision / recall | 90,9% / 100% | 90,9% / 100% |
| **autofill precision** | **90,9%** (3 tên sách sai dấu được tự điền) | **100%** |
| autofill recall | 100% | 18,2% (chỉ dịch giả được tự điền) |
| Manual correction (bấm / gõ) | 9,1% (0% / 9,1%) | 81,8% (72,7% / **9,1%**) |

Diễn giải: lượng phải **gõ lại** không đổi (9,1% — chính 3 tên "tiến" sai, model không đọc được dấu đúng nên không có
lựa chọn đúng nào để bấm). Cái được: không còn giá trị sai nào tự vào form. Cái mất: với ảnh **chỉ bìa trước**, tên
sách/tác giả/NXB đọc một lần cần một thao tác xác nhận (từng trường, hoặc nút "áp dụng N giá trị đọc từ một ảnh").
Khi có trang xuất bản, các trường này được hai nguồn đối chiếu và tự điền lại — chưa đo được vì chưa có dataset 3 ảnh.

## 7. Smoke run 2 – 18 lần quét live (OCR 2.0, 1600 vs 2048 px)

Cùng 3 bìa trước × 3 lần × 2 cấu hình, chạy trong container ai-service (OpenRouter thật, tổng ≈ 0,0021 USD). Báo cáo:
`eval/reports/book_ocr_20261023_091159.*` (live) và `..._replay_ocr2-code.*` (cùng câu trả lời, chính sách cuối).

| Chỉ số | 1600 px | 2048 px |
|---|---|---|
| Quét thành công / JSON hợp lệ | 9/9 / 100% | 9/9 / 100% |
| Title exact / normalized | 66,7% / 100% | 66,7% / 100% |
| raw hallucination | 2,9% (1 tựa phụ bịa) | 0% |
| Autofill precision (chính sách cuối) | 100% | 100% |
| Manual correction (bấm / gõ) | 81,8% (72,7% / 9,1%) | 81,8% (72,7% / 9,1%) |
| Latency mean / P50 / P95 | 8.110 / 7.917 / 9.254 ms | 8.065 / 8.109 / 8.924 ms |
| Tokens in / out | 1.818 / 380 | 1.818 / 381 |
| Chi phí / lần quét | 0,000116 USD | 0,000117 USD |

Diễn giải trung thực:

- **1600 vs 2048: không có kết luận.** Cả 3 ảnh đều nhỏ hơn 1600 px (1024×1390, 600×600, 743×1024) nên hai cấu hình gửi
  **cùng một ảnh**; khác biệt chỉ là dao động của model. Mặc định giữ 1600 px.
- "tiễn" → "tiến" lặp lại ở 6/6 lần (tổng 9/9 cả hai đợt): lỗi hệ thống của model trên ảnh này, không phải ngẫu nhiên.
- Hallucination thật: ở 1/9 lần, model đưa tên gốc "Harry Potter and the Order of the Phoenix" vào `subtitle` dù prompt
  cấm. Bản OCR 2.0 lúc chạy coi tựa phụ là trường ít rủi ro nên **đã tự điền** (autofill precision 85,7%, hallucination
  14,3% ở lớp autofill trong báo cáo live). Đã chuyển tựa phụ vào nhóm trường định danh (có test hồi quy); replay
  cùng câu trả lời: autofill precision 100%, hallucination autofill 0%.
- n = 3 cuốn, chỉ bìa trước: không phải benchmark.

## 8. Mẫu báo cáo benchmark (chưa có số liệu — điền sau khi chạy dataset thật)

| Model / cấu hình | Lớp | Precision | Recall | F1 | Hallucination | Coverage |
|---|---|---|---|---|---|---|
| qwen/qwen3.7-flash@1600px | raw | | | | | |
| | reading | | | | | |
| | autofill | | | | | |

| Model | ISBN exact | Title exact / normalized | Authors | Publisher | Year | Manual correction (bấm / gõ) | Latency mean / P50 / P95 | Tokens in / out | Cost / cuốn |
|---|---|---|---|---|---|---|---|---|---|
| qwen/qwen3.7-flash | | | | | | | | | |

Kèm: bảng theo tag (mục 2.1), danh sách lỗi theo trường (đọc từ `results[*].response.fields`), so sánh OCR 1.0 / 2.0 bằng
`--replay` trên cùng câu trả lời.

## 9. Hạn chế

- Chưa có dataset 3 ảnh có nhãn ⇒ chưa trả lời được câu hỏi 1, 3 (trên sách thật), 6.
- Smoke set do chính người phát triển gán nhãn, 3 cuốn, chỉ bìa trước, ảnh độ phân giải thấp.
- `observedText` do model sinh: grounding không chứng minh chữ có trong ảnh; lỗi dấu nhất quán trên một ảnh không phát
  hiện được bằng quy tắc.
- Chính sách tự điền OCR 2.0 đổi recall lấy precision; mức đánh đổi trên sách 3 ảnh cần đo lại.
