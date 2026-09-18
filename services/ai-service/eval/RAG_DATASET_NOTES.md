# Note về `rag_dataset.json`

Nửa `BOOK_METADATA` (60 case) của `rag_dataset.json` được xây trên **id sách thật**, lấy
từ catalog đang chạy trong Docker Postgres volume (113 sách) tại thời điểm chạy baseline —
xem `eval/reports/rag_baseline_20260916_072855.md` để biết mốc thời gian chính xác. Đây là
lựa chọn có chủ đích (seed fixture `data/smartbook_sample_seed.sql` chỉ có 3 sách tiếng Anh,
không đủ để dựng 60 case semantic search tiếng Việt có ý nghĩa), nhưng hệ quả là các
`expected_ids` này **không tái lập được** nếu volume Docker bị reset
(`docker compose down -v`, clone mới, CI, máy dev khác...).

`eval/rag_dataset_books_snapshot.json` là snapshot tham chiếu: nội dung (title, author,
category, isbn, description, summary_vi) của đúng những sách được `expected_ids` trỏ tới,
lấy tại cùng thời điểm baseline. Nếu lần chạy so sánh "sau Phase A" (Task 10) ra kết quả
recall thấp bất thường, hãy kiểm tra catalog sống hiện tại có còn khớp với snapshot này
không (`GET /api/books`, so `id`/`title`/`description` với snapshot) trước khi kết luận là
retrieval bị regress.

Nếu volume Docker bị reset trước khi chạy so sánh, người chạy Task 10 cần hoặc khôi phục
đúng trạng thái catalog này, hoặc dựng lại `expected_ids` dựa trên catalog mới rồi mới tin
kết quả so sánh.
