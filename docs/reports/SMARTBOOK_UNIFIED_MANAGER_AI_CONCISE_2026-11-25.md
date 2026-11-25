# Manager kiêm Kho và Thư viện, và câu trả lời AI ngắn gọn

Ngày 25/11/2026, nhánh `hungg`. Commit chính: `ff09fd5`. Phần bổ sung trong báo cáo này: migration dữ liệu, sửa lỗi chép lại câu trả lời trước, chỉ số "chép thẻ" chặt.

## 1. Kết luận

- **Phân quyền.** Một Manager quản lý cả hai mảng là một tài khoản giữ hai role có sẵn, WAREHOUSE_MANAGER và LIBRARIAN. Không tạo role gộp. Phạm vi kho và chi nhánh vẫn lấy từ `user_warehouse_scopes`. LIBRARIAN được thêm `analytics.borrow.read`; mọi route analytics cần quyền này đều lọc theo chi nhánh.
- **Lỗ hổng đã sửa.** `/analytics/late-return-risk` và `/analytics/reservation-no-show-risk` trả về tên bạn đọc của mọi chi nhánh. Hôm nay chỉ ADMIN có quyền gọi, nên chưa rò rỉ thật. Nhưng nếu cấp quyền cho một Manager có phạm vi giới hạn mà không sửa thì sẽ rò rỉ. Hai endpoint này giờ chỉ chấm điểm phiếu mượn và đặt chỗ thuộc chi nhánh của người gọi.
- **Chatbot `/chat`.** Trung vị độ dài giảm 73% (477 → 131 ký tự). Độ đúng của câu trả lời tăng (0,879 → 0,909) và không còn từ chối nhầm.
- **Trợ lý ra quyết định.** Thử thêm mức số từ theo từng loại câu hỏi (C6) thì độ bao phủ căn cứ giảm, nên đã bỏ. Độ dài câu trả lời của trợ lý giữ nguyên. Lỗi model chép lại nguyên văn câu trước khi người dùng hỏi "kỹ hơn" hoặc "dễ hiểu hơn" đã được sửa.

## 2. Phân quyền

| Thay đổi | File |
|---|---|
| Lọc chi nhánh cho hai endpoint rủi ro (mô hình vẫn học trên mọi chi nhánh, chỉ trả trọng số) | `services/analytics-service/src/controllers/analytics.controller.js`, `src/routes/analytics.routes.js` |
| LIBRARIAN có `analytics.borrow.read` | `services/auth-service/prisma/seed.js` và migration dữ liệu `20261125120000_grant_librarian_borrow_analytics` (production chỉ chạy `migrate deploy` khi khởi động, không chạy lại seed) |
| Câu chữ về vai trò trong prompt chatbot và trợ lý | `ai_core/prompts.py`, `copilot_response.py` |

### Bằng chứng

- `scripts/unified-manager-integration.mjs` chạy trên stack thật, đạt **11/11** kiểm tra:
  - Quyền của tài khoản là hợp của hai role.
  - Đọc được Kho lẫn Thư viện, nhưng chỉ trong phạm vi được cấp.
  - Truyền `warehouse_id` của chi nhánh ngoài phạm vi vẫn không nhận được phiếu của chi nhánh đó.
  - Tên bạn đọc trong danh sách rủi ro chỉ thuộc phiếu mượn mà người gọi được xem.
  - Hai Manager có phạm vi khác nhau không thấy dữ liệu của nhau.
  - Manager chỉ có role kho không đọc được dữ liệu mượn trả; thủ thư không đọc được tồn kho.
  - Tài khoản chỉ có quyền xem bị backend chặn khi tạo phiếu mượn hay giao việc kho.
  - Gỡ role LIBRARIAN thì token cũ hết hiệu lực ngay.
  - Gỡ chi nhánh khỏi phạm vi thì dữ liệu chi nhánh đó biến mất trong vòng tối đa 30 giây.
- Chạy cùng script trên ảnh analytics cũ: kiểm tra 4 (tên bạn đọc ngoài phạm vi) và 10 (dữ liệu còn sau khi gỡ phạm vi) **thất bại**. Trên ảnh mới cả hai đạt.
- Test đơn vị:
  - `services/analytics-service/test/risk-scope.test.js`: 7 test.
  - `services/ai-service/test_unified_manager.py`: 7 test (cổng trợ lý, quyền dùng tool, xác nhận thao tác của cả hai mảng, cache tách theo phạm vi, thu hồi quyền).
- Web với tài khoản giữ hai role (Vite 5174): trang chủ là `/reports`. Dashboard hiện cả việc kho (sự cố, yêu cầu mua, đầu sách dưới ngưỡng) lẫn việc thư viện (phiếu quá hạn, tiền phạt, tình hình thư viện, AI dự báo rủi ro). `/borrow` và `/inventory` mở được, không có lỗi API.
- Migration đã chạy được trên dev DB và trên một database trống (trên DB trống chỉ tạo dòng permission).

## 3. Câu trả lời AI

### Cách đo

- Trợ lý: `eval/eval_explain.py` chạy trực tiếp mã endpoint của từng cây code (HEAD và working tree), dữ liệu và LLM thật (`qwen/qwen3.7-flash`), cùng một bộ chấm, 50 lượt hỏi. Bản trước đo 5 lần.
- Chatbot: `eval/eval_chat_answers.py` gửi 33 câu hỏi qua gateway tới một container ai-service tạm.
- Tổng chi phí OpenRouter khoảng **0,25 USD**.

### Chatbot `/chat` (C2: viết lại quy tắc độ dài và định dạng)

| Chỉ số | Trước | Sau |
|---|---|---|
| Trung vị độ dài | 477 ký tự | 131 ký tự (−73%) |
| Độ đúng của câu trả lời | 0,879 | 0,909 |
| Từ chối nhầm | 0,062 | 0 |
| Cảnh báo grounding | 0,121 | 0,03 |
| Câu trả lời có emoji | 25/33 | 0/33 |
| Trích dẫn nguồn (precision / recall) | 0,667 / 0,875 | 0,667 / 0,875 |

Hai case còn bị đánh dấu "claim không căn cứ". Một case là bộ chấm bắt nhầm: câu trả lời nói "chưa có thông tin về việc có wifi miễn phí hay không" và bị khớp cụm "có wifi miễn phí". Case kia bản trước cũng bị y hệt.

### Trợ lý ra quyết định

| Chỉ số | Bản trước (5 lần) | Bản cuối, có stream |
|---|---|---|
| Câu có số chưa kiểm chứng | 0,022 – 0,156 | 0,089 |
| Độ liên quan của câu mở đầu | 0,81 – 0,88 | 0,81 |
| Độ bao phủ căn cứ | 0,876 – 0,922 | 0,841 |
| Tuân thủ yêu cầu trình bày | 0,67 – 1,0 | 0,83 |
| Stream và non-stream giống nhau | — | 9/9 cặp chạy thành công |

Độ bao phủ thấp hơn chủ yếu ở các câu hỏi nguyên nhân về lượt mượn (ca-03, ca-04). Câu trả lời ở đây bác bỏ đúng giả định sai của câu hỏi và dùng trung bình mỗi ngày (6,61 → 8,84 lượt/ngày), đúng như prompt yêu cầu khi tháng chưa hết. Nó chỉ không nêu tổng thô 221/205 mà bộ chấm dùng làm dữ kiện vàng. Tỷ lệ số chưa kiểm chứng nằm trong dải của bản trước.

### Thử nghiệm không áp dụng

- **C6, mức số từ theo loại câu hỏi:** đo 6 lần, câu trả lời quyết định ngắn hơn khoảng 17%, nhưng độ bao phủ căn cứ trung bình giảm từ 0,895 xuống 0,874 và độ nhớ số liệu từ 0,934 xuống 0,914. Đã bỏ.
- **C3, lặp lại số liệu trên thẻ đề xuất:** chỉ số cũ đếm mọi số trên thẻ, kể cả số mà câu trả lời trích làm căn cứ. Đã thêm chỉ số chặt `card_duplication_strict`, chỉ đếm "Đề xuất nhập" và "Chi phí ước tính": **0,78** ở bản cuối. Chưa có bộ lọc tự động, vì xóa số khỏi câu dễ làm mất căn cứ. Đây là số đo cơ sở cho lần sửa sau.

### Lỗi chép lại câu trả lời trước khi đổi cách trình bày

Ở bản trước, câu trả lời cho "Giải thích kỹ hơn" hoặc "Giải thích dễ hiểu hơn" trùng nguyên văn câu trước ở khoảng một nửa số lần đo, dù có gọi LLM. Cách sửa:

- `copilot_response.copied_previous()` phát hiện độ giống từ 0,85 trở lên và đưa vào lượt sửa duy nhất sẵn có.
- Khi lượt sửa được kích hoạt vì chép lại, chỉ so mâu thuẫn và số không có căn cứ, không so số vấn đề nhỏ. Nếu không, câu viết lại (dài hơn, nhiều nhận định hơn) bị chấm "tệ hơn" và hệ thống quay lại bản chép.

Đo lại 6 lần:

| Lượt hỏi | Trước | Sau |
|---|---|---|
| "Giải thích kỹ hơn" | 3/5 lần đạt | **6/6** |
| "Giải thích dễ hiểu hơn" | chép lại ở nhiều lần đo | còn chép 1/6 lần |

Câu "dễ hiểu hơn" vẫn thường trượt bộ chấm vì bộ chấm đòi đúng các cụm như "tức là", "nghĩa là", "ví dụ".

## 4. Môi trường

- **Lỗi OpenRouter:** từ máy này, mọi request gọi model qua cổng Cloudflare HKG đều trả 400 "Request path cannot be relayed". Khóa và tài khoản không có vấn đề. Các phép đo dùng `--add-host openrouter.ai:141.101.90.106` trong container tạm. Container ai-service thật sẽ gặp lỗi này cho tới khi OpenRouter sửa.
- **Ảnh Docker dev:** analytics và ai-service đã build lại. Ảnh cũ giữ ở tag `pre-unified-manager` để rollback. Giới hạn gateway vẫn là 600 request / 15 phút; đã nâng tạm thời trong lúc đo rồi trả lại.

## 5. Chưa làm

- Chưa push. Chưa áp dụng lên production; migration sẽ tự chạy ở lần deploy sau.
- A3: trợ lý chưa có tool đọc dữ liệu quầy (danh sách phiếu mượn, đặt trước). Đây là tính năng mới cần thiết kế quyền xem dữ liệu cá nhân của bạn đọc.
- C5 (câu trả lời bị cụt khi hết token): chưa từng quan sát thấy nên không sửa.
- "Cho tôi biết rủi ro" sau một đề xuất vẫn được coi là câu hỏi mới về rủi ro kho.
