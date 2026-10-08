# Hướng dẫn gán nhãn metadata sách (cho người gán nhãn)

Mục tiêu: tạo bộ dữ liệu **do người gán nhãn** cho đánh giá trích xuất metadata (B1–B5). Bộ 120 edition hiện có
do AI gán nhãn (`ai_labeled_dataset/`) — **không được** dùng làm "gold" trong báo cáo. Bản tiếng Anh, chi tiết hơn:
`ANNOTATION_GUIDE.md`.

## Phiếu cần điền

| Phiếu | Ai điền | Nội dung |
| --- | --- | --- |
| `annotation/review_A.csv` | Người gán nhãn A | 120 edition × 11 trường = 1320 dòng |
| `annotation/review_B.csv` | Người gán nhãn B (**độc lập**, không xem phiếu A) | 24 edition chọn phân tầng (split × ngôn ngữ) |
| `annotation/adjudication.csv` | Người thứ ba | Chỉ các dòng A và B bất đồng (tạo sau bước nhập lần 1) |

Mở bằng Excel/LibreOffice (UTF-8, giữ nguyên dấu tiếng Việt). **Chỉ điền 3 cột**: `human_status`, `human_value`,
`annotator` (tên viết tắt của bạn); `notes` tùy ý. Không sửa các cột khác.

## Cách điền một dòng

Mỗi dòng là một trường của **đúng một edition** (đúng ISBN `targetIsbn`), không phải của tác phẩm nói chung.

`human_status` là một trong:
- `known` — bạn xác định được giá trị đúng của edition này; ghi vào `human_value`.
- `absent` — edition này chắc chắn **không có** trường đó (vd. sách không có phụ đề).
- `not_applicable` — trường không áp dụng (vd. `translator` của sách viết bằng chính ngôn ngữ đó).
- `unknown` — không tìm được nguồn đáng tin cậy. **Đừng đoán**: dòng `unknown` bị loại khỏi tính điểm, còn một
  giá trị đoán sai sẽ làm sai kết quả thực nghiệm.

Cột `ai_value` là gợi ý của AI và `source_values` là những gì các nguồn đã lưu ghi nhận — chỉ để tham khảo. Hãy kiểm
tra lại bằng nguồn đáng tin cậy (bìa/trang bản quyền sách thật, website nhà xuất bản, Thư viện Quốc gia, Fahasa/Tiki
đúng ISBN). Ghi nguồn đã dùng vào `notes`.

## Quy ước giá trị

- Nhiều giá trị (`authors`, `translator`, `categories`): ngăn cách bằng ` | ` theo đúng thứ tự trên sách,
  vd. `Tô Hoài | Ngọc Anh`.
- `authors` chỉ gồm tác giả — **không** ghi dịch giả, người minh họa, người biên soạn vào đây.
- `publisher` là nhà xuất bản, **không phải** đơn vị phát hành (vd. Nhã Nam, First News là đơn vị liên kết/phát hành).
- `publishedDate` giữ đúng độ chính xác của nguồn: chỉ biết năm thì ghi `2019`, không ghi `2019-01-01`.
- `isbn`: ISBN-13, chỉ chữ số, không gạch nối.
- `language`: mã ISO 639-1 (`vi`, `en`, `ja`, …).
- Giữ nguyên chính tả và dấu tiếng Việt của tên sách/tên người.

## Sau khi điền (chạy từ thư mục `services/ai-service`)

```bash
# Lần 1: nhập A và B, xem các dòng bất đồng (trong *_agreement.json)
python eval/metadata_intelligence/human_review.py import eval/metadata_intelligence/annotation/review_A.csv eval/metadata_intelligence/annotation/review_B.csv --out eval/metadata_intelligence/human_dataset.json
# Người thứ ba chép các dòng bất đồng vào eval/metadata_intelligence/annotation/adjudication.csv và điền quyết định cuối, rồi nhập lại:
python eval/metadata_intelligence/human_review.py import eval/metadata_intelligence/annotation/review_A.csv eval/metadata_intelligence/annotation/review_B.csv --adjudication eval/metadata_intelligence/annotation/adjudication.csv --out eval/metadata_intelligence/human_dataset.json
# Chạy B1–B5 trên nhãn của người (cần OPENROUTER_API_KEY cho các chế độ dùng LLM)
python eval/metadata_intelligence/run_experiments.py --dataset eval/metadata_intelligence/human_dataset.json
```

Trong báo cáo KLTN, ghi rõ: "gán nhãn bởi người, có tham khảo gợi ý của AI" và báo cáo mức đồng thuận giữa hai người
gán nhãn (`percent_agreement`) cùng số dòng đã phân xử. Nếu giao thức đầy đủ (60 edition tiếng Việt / 60 quốc tế) chưa
đạt — bộ hiện có 29 / 91 — thì nêu rõ đây là giới hạn, không chạy `--strict-protocol`.
