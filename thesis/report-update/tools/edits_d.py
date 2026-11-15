# -*- coding: utf-8 -*-
"""Content edits part D: chapter 7, chapter 8, appendices."""
from sbdoc import ns, text_of


def run(d):
    F = d.find
    T3 = d.table_after(F('Bảng 7.6 Kết quả đánh giá chất lượng'))
    T4 = d.table_after(F('Bảng 7.5 Kết quả đánh giá khả năng chọn'))
    T5 = d.table_after(F('Bảng 7.1 Kết quả kiểm thử đơn vị'))
    T6 = d.table_after(F('Bảng 1.1 So sánh các nhóm giải pháp'))

    d.set_text(F('Chương này trình bày kết quả chạy lại toàn bộ bộ kiểm thử'),
        'Chương này trình bày kết quả kiểm thử và đánh giá của hệ thống. Kết quả đến từ hai đợt: đợt chạy lại toàn bộ ngày 05/10/2026 (kiểm thử tích hợp, giao diện, tải và các đánh giá AI ban đầu) và đợt kiểm chứng ngày 06/11/2026 trên mã nguồn hiện tại (kiểm thử đơn vị, ảnh chụp giao diện, chạy thật chức năng OCR và trợ lý), cùng các báo cáo đánh giá có giao thức đăng ký trước được lưu trong mã nguồn (Copilot 3.0–3.3, bộ lập kế hoạch ngữ nghĩa, Recommendation V2, tối ưu nhập hàng). Mỗi bảng ghi rõ nguồn và ngày đánh giá; các kết quả trên dữ liệu tổng hợp được nêu rõ là dữ liệu mô phỏng. Phần cuối chương thảo luận ưu điểm, hạn chế và các vấn đề phát hiện trong quá trình đánh giá.')
    d.set_text(F('Toàn bộ kiểm thử và đánh giá được chạy lại ngày 05/10/2026'),
        'Đợt đánh giá đầy đủ thứ nhất được chạy ngày 05/10/2026 trên máy cá nhân mô tả ở Bảng 6.4, với hệ thống triển khai bằng Docker Compose và dữ liệu mẫu hiện có trong các volume (không xóa và không khởi tạo lại dữ liệu). Việc đánh giá được tổ chức theo năm mức: kiểm tra chất lượng mã và kiểm thử đơn vị; kiểm thử tích hợp chạy trên hệ thống thật; kiểm thử giao diện đầu – cuối bằng trình duyệt; kiểm thử tải; đánh giá định lượng các thành phần AI và các mô hình hỗ trợ ra quyết định trên các bộ dữ liệu có gán nhãn. Đợt kiểm chứng thứ hai ngày 06/11/2026 chạy lại kiểm thử đơn vị trên mã nguồn hiện tại và chạy thật các chức năng mới trên cùng máy. Các thành phần dùng mô hình ngôn ngữ gọi mô hình qwen/qwen3.7-flash và mô hình nhúng qwen/qwen3-embedding-8b qua OpenRouter, nên kết quả của chúng phụ thuộc vào mô hình và có thể dao động giữa các lần chạy.')
    d.set_text(F('Các bước kiểm tra mã (ESLint'),
        'Ở đợt kiểm chứng ngày 06/11/2026, các bộ kiểm thử đơn vị được chạy lại trên mã nguồn hiện tại (Bảng 7.1): toàn bộ ca kiểm thử đều đạt; 3 ca của Analytics Service và 8 ca của AI Service được bỏ qua có chủ đích vì cần tài nguyên ngoài. Kiểm thử AI Service được chạy trong image Docker của service với mã nguồn hiện tại được gắn vào. Bước lint, kiểm tra kiểu và build không được chạy lại trong đợt này; chúng được kiểm tra tự động bởi quy trình CI ở mỗi lần đẩy mã.')
    t = d.table_after(F('Bảng 7.1 Kết quả kiểm thử đơn vị'))
    rows = [
        ['Cấu hình workspace', '74', '74', '0', 'Monorepo, Docker Compose, CI/CD, cấu hình di động'],
        ['packages/shared', '30', '30', '0', 'Chỉ số, thu hồi token, phạm vi kho'],
        ['API Gateway', '13', '13', '0', 'Định tuyến, consumer RabbitMQ'],
        ['Auth Service', '86', '86', '0', 'Xác thực, OTP, refresh token, phân công kho'],
        ['Inventory Service', '206', '206', '0', 'Nghiệp vụ kho, phạm vi kho, đối soát metadata, trùng lặp'],
        ['Borrow Service', '154', '154', '0', 'Lưu thông, phí phạt, VNPay, bù trừ, đối soát'],
        ['Analytics Service', '137', '134', '0', '3 ca bỏ qua; dự báo, thời gian chờ, ngân sách cận biên, rủi ro'],
        ['Ứng dụng web (unit)', '46', '46', '0', 'Kiểm chứng và biểu đồ của trợ lý, phân quyền tuyến'],
        ['Ứng dụng di động (Jest)', '216', '216', '0', '33 bộ kiểm thử'],
        ['AI Service (pytest)', '1218', '1210', '0', '8 ca bỏ qua; thêm 30 ca con đạt'],
        ['Tổng', '2180', '2169', '0', 'Chạy ngày 06/11/2026'],
    ]
    trs = d.rows(t)
    for tr in trs[2:]:
        t.remove(tr)
    d.set_row(t, 1, rows[0])
    for r in rows[1:]:
        d.add_row(t, r, clone_index=1)
    d.set_text(F('Mười bốn kịch bản kiểm thử tích hợp gọi API thật'),
        'Ở đợt ngày 05/10/2026, mười bốn kịch bản kiểm thử tích hợp gọi API thật qua API Gateway trên hệ thống đang chạy; một số kịch bản đọc trực tiếp cơ sở dữ liệu để xác nhận trạng thái sau thao tác, hoặc chủ động khởi động lại service và dừng RabbitMQ để kiểm tra khả năng chịu lỗi. Kết quả được trình bày ở Bảng 7.2. Các kịch bản này chưa được chạy lại trên phiên bản hiện tại; riêng phạm vi kho có thêm kịch bản tích hợp mới (scripts/warehouse-scope-integration.mjs) chưa được đưa vào đợt đánh giá.')
    d.set_text(F('Bộ kiểm thử Playwright gồm 20 ca'),
        'Bộ kiểm thử Playwright ở đợt ngày 05/10/2026 gồm 20 ca chạy trên trình duyệt Chrome với ứng dụng web thật. Kết quả có 18 ca đạt và 2 ca không đạt (Bảng 7.3). Sau đợt này, bộ kiểm thử được bổ sung các kịch bản cho xác thực OTP, nhập sách bằng OCR và biểu đồ, quyết định của trợ lý (thư mục apps/web/e2e); các kịch bản mới chưa được chạy lại trong đợt kiểm chứng 06/11/2026.')
    d.set_text(F('Ba kịch bản k6 được chạy từ một container'),
        'Ba kịch bản k6 được chạy ở đợt ngày 05/10/2026 từ một container trong cùng mạng Docker (Bảng 7.4).')
    d.set_text(F('Bộ dữ liệu gồm 34 câu hỏi tiếng Việt'),
        'Đánh giá này được thực hiện với phiên bản trợ lý trước khi nâng cấp thành Copilot (11 công cụ, tháng 9/2026) và được giữ làm mốc tham chiếu. Bộ dữ liệu gồm 34 câu hỏi tiếng Việt bao phủ cả 11 công cụ, 8 câu hỏi cần nhiều công cụ và 3 câu không cần công cụ nào. Mỗi câu được chạy với đúng lời nhắc hệ thống và mô tả công cụ của trợ lý, so sánh tập công cụ mô hình chọn với tập kỳ vọng (Bảng 7.5).')
    d.set_text(F('Bộ dữ liệu gồm 30 câu hỏi gửi tới endpoint trợ lý thật'),
        'Đánh giá đầu – cuối của phiên bản trước Copilot (đợt 05/10/2026) gồm 30 câu hỏi gửi tới endpoint trợ lý thật qua API Gateway với tài khoản quản lý kho: 18 câu hỏi phân tích có căn cứ, 4 câu hỏi ghép, 4 câu ngoài phạm vi, 2 câu không thể trả lời từ dữ liệu và 2 câu thăm dò ảo giác. Các số liệu bắt buộc trong câu trả lời được khai báo dưới dạng đường dẫn vào kết quả công cụ của chính lần chạy, nên phép đo không phụ thuộc dữ liệu cụ thể của cơ sở dữ liệu. Kết quả ở Bảng 7.6.')
    p = F('Trong lần chạy với tài khoản quản trị, sáu câu không đạt')
    d.add_seq(p, [
        ('h3', 'Kiểm chứng câu trả lời của Copilot'),
        ('body', 'Phiên bản Copilot 3.3 được đánh giá theo giao thức đăng ký trước (17–19/10/2026): 110 câu hỏi mới chia 10 nhóm (tự nhiên, viết tắt và không dấu, nhiều điều kiện, so sánh kho, ngân sách, xu hướng và nguyên nhân, giả định "nếu – thì", thiếu dữ liệu, bẫy đơn vị – thực thể – kỳ, hội thoại nhiều lượt), tách thành tập phát triển 40, tập kiểm định 30 và tập kiểm thử 40 câu (44 lượt). Tập kiểm thử và mã nguồn được băm và đóng băng trước khi gán nhãn; luật chỉ được viết từ tập phát triển. Dữ liệu là hệ thống phát triển với dữ liệu mô phỏng, mô hình qwen/qwen3.7-flash, một người gán nhãn. Bảng {TAB:c33det} đo khả năng phát hiện lỗi của các bộ kiểm chứng trên cùng các bản nháp; Bảng {TAB:c33live} đo câu trả lời cuối cùng người dùng nhận được qua ba lần chạy thật.'),
        ('captab', 'Bảng {TAB:c33det} Khả năng phát hiện lỗi của bộ kiểm chứng trên tập kiểm thử (44 lượt, 19 lượt có lỗi)'),
        ('table', dict(template=T5, rows=[
            ['Bộ kiểm chứng', 'Precision', 'Lượt có lỗi bị phát hiện', 'Lượt đúng bị báo nhầm', 'Lỗi nghiêm trọng bị phát hiện'],
            ['Phiên bản 3.2', '0,571', '4/19', '3/25', '0/12'],
            ['3.3 – Layer 1 tất định (đang dùng)', '0,625', '5/19', '3/25', '1/12'],
            ['3.3 – hybrid Layer 2–3 (2 lần trích, đang tắt)', '0,727', '8/19', '3/25', '3/12'],
        ])),
        ('captab', 'Bảng {TAB:c33live} Câu trả lời cuối của trợ lý trên tập kiểm thử qua ba lần chạy thật'),
        ('table', dict(template=T4, rows=[
            ['Chỉ số', 'Phiên bản 3.2', '3.3 – lần A', '3.3 – lần B'],
            ['Câu trả lời có lỗi', '16/44', '17/44', '13/44'],
            ['Có lỗi nghiêm trọng', '10/44', '12/44', '9/44'],
            ['Chặn oan câu trả lời đúng', '2', '0', '0'],
            ['Độ trễ p50 / p95 (giây)', '3,51 / 13,91', '3,37 / 14,55', '3,27 / 9,36'],
            ['Chi phí cả lượt chạy (USD)', '0,0133', '0,0069', '0,0076'],
        ])),
        ('body', 'Lớp 1 tất định được đưa vào production vì đạt tiêu chí đăng ký trước (không giảm khả năng phát hiện, không tăng báo động giả). Lớp hybrid phát hiện thêm lỗi (8/19 so với 5/19) nhưng độ trễ trích nhận định p95 7,0–8,3 giây vượt ngưỡng 6 giây nên được tắt. Ở câu trả lời cuối, chênh lệch từ 16 xuống 13 câu có lỗi nằm trong biên dao động giữa hai lần chạy (lần A gặp một lỗi tích hợp đã được sửa sau đó), nên với 44 lượt không thể kết luận phiên bản 3.3 giảm lỗi có ý nghĩa thống kê; điều chắc chắn hơn là số lần chặn oan giảm từ 2 về 0. Phát hiện quan trọng là bước sửa tự động của phiên bản 3.2 đã biến 3 trong 4 bản nháp đúng thành sai; quy tắc không viết đè con số trùng một đại lượng khác của dữ liệu được bổ sung sau khi chấm tập kiểm thử nên chưa có tập độc lập để đo lại. Khả năng phát hiện tuyệt đối còn thấp vì phần lớn lỗi còn lại là giả định và quan hệ nhân quả không có căn cứ, loại lỗi mà kiểm tra số liệu không bắt được.'),
        ('h3', 'Hiểu ngôn ngữ tự nhiên của bộ lập kế hoạch'),
        ('body', 'Bộ lập kế hoạch được đánh giá trên 209 lượt chấm trong 187 hội thoại (26/10/2026), tách theo họ câu hỏi cùng nghĩa; tập kiểm thử 108 lượt và tiêu chí chấp nhận được đóng băng trước mọi thay đổi mã. Bộ chấm độc lập với mã được kiểm thử. Bảng {TAB:nlu} so sánh bộ lập kế hoạch luật trước và sau khi sửa với phương án hybrid có Semantic Planner.'),
        ('captab', 'Bảng {TAB:nlu} Kết quả của bộ lập kế hoạch trên tập kiểm thử đóng băng'),
        ('table', dict(template=T5, rows=[
            ['Chỉ số', 'Luật (trước)', 'Luật (sau sửa, đang dùng)', 'Hybrid (đang tắt)', 'Tiêu chí'],
            ['Nhận diện đúng trọn ý định', '59/82', '61/82', '74/82', '–'],
            ['F1 nhận diện năng lực', '0,855', '0,869', '0,957', '≥ 0,90'],
            ['F1 chọn công cụ', '0,851', '0,864', '0,953', '≥ 0,90'],
            ['Hiểu ngữ cảnh nhiều lượt', '0,619', '0,762', '0,810', '≥ 0,85 (không đạt)'],
            ['Hiểu câu diễn đạt gián tiếp', '2/14', '3/14', '13/14', '–'],
            ['Vi phạm bảo mật', '0', '0', '0', '0'],
            ['p95 lập kế hoạch (lượt được định tuyến)', '–', '–', '3,16 giây', '≤ 6 giây'],
        ])),
        ('body', 'Các sửa đổi của bộ lập kế hoạch luật được bật vì không làm giảm chỉ số nào. Semantic Planner tăng mạnh khả năng hiểu câu diễn đạt gián tiếp nhưng trượt tiêu chí hiểu ngữ cảnh nên được giữ tắt theo đúng quy tắc đăng ký trước. Khi chạy đầu – cuối 82 lượt qua endpoint thật, với cờ tắt có 9/82 câu cần dữ liệu được trả lời mà không gọi công cụ nào, với cờ bật còn 1/82; đổi lại, độ trễ p95 của các lượt được định tuyến tăng từ 10,1 lên 18,4 giây (một lần chạy, mẫu 16 lượt).'),
        ('h3', 'Trực quan hóa dữ liệu trong trợ lý'),
        ('body', 'Chức năng biểu đồ được đánh giá trên 64 trường hợp, 75 lượt hỏi chia 10 nhóm (xu hướng, so sánh, xếp hạng, KPI, mô phỏng ngân sách, câu hỏi nối tiếp, thiếu dữ liệu, phân quyền, mơ hồ, dữ liệu sai), ngày 15/10/2026 (Bảng {TAB:viz}).'),
        ('captab', 'Bảng {TAB:viz} Kết quả đánh giá trực quan hóa trong trợ lý'),
        ('table', dict(template=T3, rows=[
            ['Chỉ số', 'Offline (tập phát triển)', 'Chạy thật (dữ liệu dev, LLM thật)'],
            ['Chọn đúng loại biểu đồ', '75/75', '60/61'],
            ['Chọn đúng công cụ', '48/48', '33/34'],
            ['Đặc tả biểu đồ hợp lệ', '60/60', '47/47'],
            ['Ô số liệu khớp dữ liệu công cụ', '1184/1184', '1002/1002'],
            ['Nhất quán khi hỏi nối tiếp', '11/11', '11/11'],
            ['Độ trễ dựng đặc tả p95', '1,27 ms', '–'],
            ['Độ trễ lượt có LLM p50 / p95', '–', '3,65 / 7,48 giây'],
        ])),
        ('body', 'Kết quả offline đạt tuyệt đối vì đây là tập phát triển viết song song với mã, nên chỉ chứng minh bộ dựng làm đúng điều được mô tả; bằng chứng ngoài mẫu là lượt chạy thật, trong đó lượt sai duy nhất là câu hỏi về một kho không tồn tại mà trợ lý hỏi lại thay vì bịa tên kho. Ảnh chụp Hình 4.47 là một lượt chạy thật ngày 06/11/2026.'),
    ])
    p = F('Cả hai cách cùng chọn đúng giá trị cho mọi trường')
    d.add_seq(p, [
        ('h3', 'Nhập sách bằng OCR nhiều ảnh'),
        ('body', 'Chức năng OCR nhiều ảnh hiện có khung đánh giá ba lớp (giá trị thô của mô hình, giá trị sau kiểm tra, giá trị được tự điền), chế độ chạy lại không tốn phí, một bộ smoke gồm 3 ảnh bìa trước do nhóm tự gán nhãn và 27 lần quét chạy thật (23/10/2026). Bộ dữ liệu mục tiêu gồm ít nhất 50 cuốn sách tiếng Việt chụp đủ ba ảnh, có hai người gán nhãn độc lập, chưa được xây dựng; vì vậy báo cáo không công bố độ chính xác của OCR. Các lần chạy thật chỉ chứng minh pipeline hoạt động đầu – cuối, đo chi phí và độ trễ, và giúp phát hiện các loại lỗi như sai dấu tiếng Việt hay nhầm năm in với năm xuất bản. Ngày 06/11/2026, pipeline được chạy lại thật trên hai ảnh thử nghiệm tự tạo (Hình 4.45).'),
    ])
    d.set_text(F('Phép kiểm tra ngược được thực hiện trên 114 ấn bản'),
        'Phép kiểm tra ngược được thực hiện bằng quy trình sinh tự động trong services/analytics-service/eval trên 114 ấn bản của dữ liệu hành vi tổng hợp (hạt giống 20260928), cửa sổ cuộn với tầm dự báo 7 ngày, tổng cộng 16.758 điểm dự báo; mô hình đang dùng được so với sáu mô hình cơ sở, trong đó có ba mô hình chuyên cho nhu cầu gián đoạn là Croston, SBA và TSB (Bảng 7.11; kết quả tầm 14 ngày nằm trong thesis/tables). Kết quả này thay cho bảng của phiên bản trước vì được sinh lại bằng quy trình cố định có thể tái lập.')
    t = d.table_after(F('Bảng 7.11 Kết quả kiểm tra ngược'))
    rows = [
        ['Trung bình trượt 30 ngày', '0,331', '0,522', '1,234'],
        ['TSB', '0,333', '0,528', '1,240'],
        ['Trung bình trượt 7 ngày', '0,338', '0,550', '1,259'],
        ['EWMA và xu hướng (đang dùng)', '0,338', '0,569', '1,260'],
        ['SBA', '0,344', '0,523', '1,280'],
        ['Croston', '0,349', '0,523', '1,301'],
        ['Giá trị gần nhất', '0,358', '0,728', '1,333'],
    ]
    trs = d.rows(t)
    for tr in trs[2:]:
        t.remove(tr)
    d.set_row(t, 1, rows[0])
    for r in rows[1:]:
        d.add_row(t, r, clone_index=1)
    p = d.set_text(F('Các phương pháp cho sai số gần nhau; EWMA kèm xu hướng'),
        'Các phương pháp cho sai số gần nhau; trung bình trượt 30 ngày và TSB có MAE thấp nhất, EWMA kèm xu hướng đang dùng tốt hơn rõ rệt so với giá trị gần nhất về RMSE nhưng không vượt các mô hình cơ sở mạnh. WAPE lớn hơn 1 ở mọi phương pháp phản ánh nhu cầu thưa theo từng ngày của từng ấn bản. Vì khác biệt sai số nhỏ, mô hình dự báo của production chưa được thay đổi; hệ thống dùng dự báo tổng theo cả tầm dự báo kết hợp tồn kho an toàn theo độ biến động, và các cải tiến được đánh giá ở cấp quyết định nhập hàng. Thời gian chờ hàng học từ dữ liệu chưa thể kiểm định vì dữ liệu mẫu chỉ có một đơn đặt hàng có lịch sử giao hàng (trạng thái INSUFFICIENT_DATA).')
    d.add_seq(p, [
        ('h3', 'Chính sách nhập hàng và phân bổ ngân sách'),
        ('body', 'Các chính sách nhập hàng được so sánh bằng bộ mô phỏng tồn kho trên dữ liệu tổng hợp: 114 ấn bản, chu kỳ xem xét 7 ngày, 395 ngày khởi động và khoảng 335 ngày chấm điểm, ba kịch bản (cơ sở, nhà cung cấp giao chậm, tồn đầu kỳ thấp), 4 hạt giống phát triển và 8 hạt giống kiểm định mới; tiêu chí chấp nhận được cố định trước khi chạy các hạt giống kiểm định. Mọi chính sách dùng cùng nhu cầu, cùng tồn đầu kỳ, cùng đơn giá và cùng ngân sách mỗi lần xem xét. Bảng {TAB:reorder} trình bày mức đáp ứng nhu cầu khi ngân sách bị giới hạn; cột Phân bổ cũ là cách phân bổ trước đây của hệ thống, cột cuối là phương án đang dùng (cấp từng bản kết hợp vị thế tồn có tính bản trả về và số lượng tối thiểu có điều kiện).'),
        ('captab', 'Bảng {TAB:reorder} Mức đáp ứng nhu cầu (%) trung bình trên 8 hạt giống kiểm định khi cùng ngân sách (dữ liệu tổng hợp)'),
        ('table', dict(template=T6, rows=[
            ['Kịch bản', 'Điểm đặt hàng lại', 'Trung bình trượt 30 ngày', 'Phân bổ cũ', 'Cấp từng bản', 'Cấp từng bản + vị thế tồn (đang dùng)'],
            ['Cơ sở', '94,22', '94,26', '94,02', '96,02', '96,95'],
            ['Nhà cung cấp giao chậm', '93,91', '94,10', '92,32', '93,89', '95,19'],
            ['Tồn đầu kỳ thấp', '78,53', '79,55', '81,15', '86,84', '89,23'],
        ])),
        ('body', 'Phương án cấp vốn cận biên kết hợp vị thế tồn có tính bản trả về và số lượng tối thiểu có điều kiện có mức đáp ứng cao hơn phân bổ cũ ở cả 24/24 lần chạy, chênh lệch trung bình +2,93 (cơ sở), +2,87 (giao chậm) và +8,07 (tồn đầu thấp) điểm phần trăm với khoảng tin cậy 95% đều dương, nên được tích hợp vào production ngày 18/10/2026; sau khi chuyển, chạy lại toàn bộ mô phỏng cho kết quả trùng khớp 100% vì mô phỏng và production dùng chung một hàm. Ở chế độ không ngân sách, không phương án nào đạt đồng thời hai điều kiện không giảm mức phục vụ và giảm ít nhất 10% chi phí: tính bản trả về giảm chi phí 2,6–8,0% nhưng chưa đủ ngưỡng, còn số lượng tối thiểu có điều kiện rẻ hơn 21–41% nhưng làm tăng số ngày hết hàng có ý nghĩa; vì vậy số lượng đề xuất mặc định được giữ nguyên. Đây là kết quả trên dữ liệu mô phỏng do chính dự án xây dựng, giả định nhu cầu Poisson và chưa xét ràng buộc nhà cung cấp, nên chưa thể chuyển thẳng sang thư viện thật. Trên dữ liệu phát triển, với ngân sách 6 triệu đồng thuật toán dồn 67/68 bản cho một đầu sách vì gần như chỉ dòng này có dự báo nhu cầu dương; đây là rủi ro cần người quản lý xem xét trước khi tạo đơn.'),
    ])
    d.set_text(F('Bộ gợi ý được đánh giá bằng cách chia theo thời gian'),
        'Bộ gợi ý V2 được đánh giá bằng giao thức theo thời điểm (30/09/2026) trên dữ liệu hành vi tổng hợp gồm 600 bạn đọc, 113 đầu sách và 33.866 tương tác: huấn luyện trước 26/01/2026, kiểm định (chọn trọng số) đến 30/05/2026, kiểm tra đến 28/09/2026; tập kiểm tra có 344 bạn đọc đủ điều kiện. Bảng 7.12 so sánh V2 với gợi ý ngẫu nhiên, theo độ phổ biến, phiên bản V1 trước đây và mô hình tham chiếu đọc trực tiếp sở thích ẩn của bộ mô phỏng (chỉ dùng làm trần so sánh).')
    cap = F('Bảng 7.12 Kết quả đánh giá gợi ý sách')
    d.set_text(cap, 'Bảng 7.12 Kết quả đánh giá gợi ý sách V2 trên dữ liệu tổng hợp')
    t = d.table_after(cap)
    rows = [
        ['Ngẫu nhiên', '0,439', '0,166', '0,109', '0,171', '1,000', '0,946'],
        ['Phổ biến nhất', '0,767', '0,445', '0,352', '0,470', '0,797', '0,854'],
        ['V1 (trước 30/09/2026)', '0,579', '0,275', '0,212', '0,311', '0,938', '0,886'],
        ['V2 (đang dùng)', '0,861', '0,541', '0,428', '0,533', '0,885', '0,895'],
        ['Trần tham chiếu', '0,878', '0,553', '0,432', '0,522', '0,938', '0,900'],
    ]
    trs = d.rows(t)
    for tr in trs[2:]:
        t.remove(tr)
    d.set_row(t, 1, rows[0])
    for r in rows[1:]:
        d.add_row(t, r, clone_index=1)
    d.set_text(F('Bộ gợi ý của hệ thống tốt hơn nhiều so với gợi ý ngẫu nhiên'),
        'V2 tốt hơn rõ rệt cả V1 lẫn phương án theo độ phổ biến ở mọi chỉ số độ chính xác (NDCG@10 0,428 so với 0,352; khoảng tin cậy bootstrap 95% của V2 là [0,400; 0,455], không giao với khoảng [0,323; 0,381] của phương án phổ biến) và tiến sát mô hình tham chiếu; đổi lại, độ bao phủ danh mục giảm từ 0,938 xuống 0,885 và mức thiên lệch về sách phổ biến tăng. Biến thể chỉ dùng lọc cộng tác đạt NDCG@10 0,400, cho thấy phần lớn lợi ích đến từ tín hiệu cộng tác. Vì đây là dữ liệu mô phỏng, hiệu quả trên bạn đọc thật chưa được kiểm chứng.')
    p = F('Kiểm thử thanh toán VNPay')
    d.add_after(p, 'body', 'Tích hợp VNPay được kiểm thử bằng 16 ca kiểm thử đơn vị của Borrow Service (vnpay.service.test.js, vnpay-payment.service.test.js): ký và xác minh chữ ký, từ chối tham số bị sửa và chữ ký trống, quy đổi số tiền, giờ Việt Nam, hoàn tất thành công tạo đúng một bản ghi thanh toán, gọi hoàn tất lần hai không ghi trùng, phản hồi thất bại không tạo bản ghi thanh toán, sai số tiền bị từ chối, mã giao dịch không tồn tại và trường hợp khoản phạt đã được thanh toán bằng cách khác trước khi VNPay xác nhận. Các ca này nằm trong 154 ca đạt của Borrow Service ở Bảng 7.1. Dữ liệu mẫu có giao dịch VNPay thành công ngày 12/9/2026 (Hình {FIG:ui_mcust}); luồng thanh toán trên môi trường sandbox của VNPay chưa được chạy lại trong đợt kiểm chứng 06/11/2026.')
    d.set_text(F('Kết quả đánh giá cho thấy các quy tắc nghiệp vụ quan trọng'),
        'Kết quả đánh giá cho thấy các quy tắc nghiệp vụ quan trọng được bảo đảm ở tầng backend chứ không chỉ ở giao diện: phiếu nhập nháp không làm tăng tồn, nhà cung cấp không thể ghi sổ tồn kho, các thao tác đồng thời trên cùng một cuốn sách chỉ được áp dụng một lần, 30 yêu cầu tranh chấp hai cuốn sách không làm bán vượt tồn kho, và phạm vi kho được áp dụng theo nguyên tắc từ chối khi lỗi. Mẫu Transactional Outbox giữ được sự kiện khi service bị dừng đột ngột và khi RabbitMQ ngừng hoạt động. Ở thành phần AI, các thay đổi được kiểm định bằng tập kiểm thử đóng băng và tiêu chí đăng ký trước, kể cả khi kết quả buộc phải tắt một tính năng (Semantic Planner, trích nhận định bằng mô hình ngôn ngữ) hoặc giữ nguyên thuật toán (số lượng đề xuất không ngân sách); kiểm chứng của trợ lý không còn chặn oan câu trả lời đúng, biểu đồ khớp hoàn toàn với dữ liệu công cụ khi chạy thật, cơ chế từ chối của truy xuất lai không trả lời sai truy vấn tài liệu nào, hợp nhất bằng chứng chỉ báo xung đột thật, các mô hình rủi ro đạt khoảng 94–95% trần lý thuyết, gợi ý V2 và phân bổ ngân sách cận biên cải thiện rõ so với phương án cũ trên dữ liệu tổng hợp.')
    d.set_text(F('Các mô hình rủi ro, dự báo và gợi ý mới được đánh giá trên dữ liệu tổng hợp, chưa có'),
        'Các mô hình rủi ro, dự báo, gợi ý và chính sách nhập hàng mới được đánh giá trên dữ liệu tổng hợp, chưa có dữ liệu vận hành thật. Bộ dữ liệu tra cứu ISBN chỉ gồm 25 sách quốc tế; các bộ đánh giá trợ lý có quy mô vài chục đến hơn một trăm lượt, một người gán nhãn và một mô hình ngôn ngữ, nên chênh lệch một hai lượt đã làm thay đổi vài điểm phần trăm; OCR nhiều ảnh chưa có bộ dữ liệu đánh giá. Kiểm thử tích hợp, giao diện và tải chưa được chạy lại trên phiên bản hiện tại. Các thành phần dùng mô hình ngôn ngữ phụ thuộc vào dịch vụ bên ngoài: trong đợt đánh giá 05/10/2026, độ trễ của dịch vụ nhúng dao động từ khoảng 1 giây đến hơn 30 giây, một số lời gọi bị quá thời gian chờ.')
    d.set_text(F('Chỉ mục ngữ nghĩa của danh mục sách không được xây khi AI Service khởi động'),
        'Chỉ mục ngữ nghĩa của danh mục sách không được xây khi AI Service khởi động vì tác vụ đồng bộ gọi /api/books mà không có JWT. Vấn đề này đã được khắc phục: AI Service hiện đồng bộ danh mục qua endpoint nội bộ /internal/catalog/books xác thực bằng khóa dịch vụ, định kỳ mỗi 300 giây; bản sửa chưa được đo lại bằng bộ đánh giá truy xuất.')
    d.set_text(F('Inventory Service khởi tạo đối tượng PrismaClient riêng'),
        'Inventory Service khởi tạo đối tượng PrismaClient riêng ở nhiều mô-đun (40 vị trí trong mã nguồn hiện tại); trong lần chạy 05/10/2026, service giữ 82 kết nối rảnh tới inventory_db, và khi nhiều kịch bản đánh giá chạy song song, PostgreSQL hết số kết nối cho phép (100) làm một lời gọi đề xuất nhập hàng trả lỗi 500. Cấu hình production đã nâng giới hạn kết nối của PostgreSQL lên 200 nhưng chưa giải quyết gốc vấn đề.')
    d.set_text(F('Phạm vi kho của nhân viên đã có bảng lưu trữ nhưng chưa được Inventory'),
        'Phạm vi kho của nhân viên đã có bảng lưu trữ nhưng chưa được Inventory Service áp dụng khi lọc dữ liệu. Vấn đề này đã được khắc phục ở phiên bản hiện tại: phạm vi kho được áp dụng ở Inventory, Analytics và AI Service theo nguyên tắc từ chối khi lỗi, có kiểm thử đơn vị đi kèm (Chương 4).')
    d.set_text(F('Các vấn đề trên không làm sai lệch kết quả nghiệp vụ'),
        'Các vấn đề còn lại không làm sai lệch kết quả nghiệp vụ đã đánh giá, nhưng ảnh hưởng tới khả năng vận hành ổn định và được nêu lại trong phần hạn chế của Chương 8. Đợt kiểm chứng 06/11/2026 còn ghi nhận hai điểm nhỏ: ứng dụng di động ở chế độ phát triển phát cảnh báo React về một thuộc tính không phải kiểu boolean trên màn hình chính, và cơ sở dữ liệu của môi trường phát triển có 64 quyền trong khi dữ liệu khởi tạo khai báo 65 quyền.')

    # ---------------- CHƯƠNG 8 ----------------
    d.set_text(F('Về kiến trúc: hệ thống microservices gồm API Gateway'),
        '**Về kiến trúc:** hệ thống microservices gồm API Gateway, năm service với bốn cơ sở dữ liệu tách biệt, giao tiếp đồng bộ qua HTTP nội bộ và bất đồng bộ qua RabbitMQ theo mẫu Transactional Outbox, thông báo thời gian thực qua Socket.IO, chỉ số vận hành theo chuẩn Prometheus; triển khai bằng Docker Compose trên máy cá nhân và trên VPS production phía sau Caddy với HTTPS, CI/CD bằng GitHub Actions, sao lưu hằng ngày và tự quay lui khi triển khai lỗi.')
    d.set_text(F('Về nghiệp vụ: luồng lưu thông đầu – cuối'),
        '**Về nghiệp vụ:** luồng lưu thông đầu – cuối (đặt giữ có giữ tồn thật, mã nhận sách QR, mượn, gia hạn, trả, phí phạt, thanh toán VNPay sandbox) và luồng kho vận – mua hàng đầu – cuối (yêu cầu mua, đơn đặt hàng, cổng nhà cung cấp, phiếu nhập chỉ cộng tồn khi ghi sổ, thiếu hàng, xếp kệ có gợi ý vị trí, lấy hàng, đóng gói có bằng chứng hình ảnh, xuất kho, chuyển kho, kiểm kê), với phân quyền chi tiết cho sáu vai trò, phân công nhân viên theo kho, xác minh email bằng OTP và OTP hai lớp tùy chọn cho nhân viên; ứng dụng di động cho bạn đọc và nhân viên kho.')
    d.set_text(F('Về hỗ trợ ra quyết định: dự báo nhu cầu có mùa vụ'),
        '**Về hỗ trợ ra quyết định:** dự báo nhu cầu có mùa vụ, thời gian chờ hàng học từ dữ liệu, tồn kho an toàn, đề xuất nhập hàng có phân bổ ngân sách theo lợi ích phục vụ cận biên, gợi ý thanh lý và điều chuyển, hai mô hình rủi ro tự hiện thực, bộ gợi ý sách V2, Trợ lý AI (Copilot) với 20 công cụ chỉ đọc, giải thích theo dữ kiện – suy luận – giả định – chưa biết, kiểm chứng câu trả lời, biểu đồ do backend dựng và kiểm tra, năm loại hành động phải được con người xác nhận và bản tin tổng hợp hằng đêm.')
    d.set_text(F('Về trích xuất thông tin sách: tra cứu ISBN đa nguồn'),
        '**Về trích xuất thông tin sách:** tra cứu ISBN đa nguồn có ngân sách thời gian, hợp nhất bằng chứng theo từng trường với độ tin cậy tính từ nguồn và mức đồng thuận, chuẩn hóa thực thể theo danh mục chuẩn, phát hiện trùng lặp và phân biệt ấn bản, duyệt từng trường trước khi áp dụng, nhập sách bằng OCR từ tối đa ba ảnh với chính sách tự điền thận trọng, tìm sách bằng ảnh bìa, trích xuất hóa đơn nhà cung cấp.')
    d.set_text(F('Về kiểm chứng: 1014 ca kiểm thử đơn vị đạt'),
        '**Về kiểm chứng:** các bộ kiểm thử đơn vị chạy lại ngày 06/11/2026 đều đạt (74 ca cấu hình workspace, 623 ca của thư viện dùng chung, gateway và các service Node.js, 46 ca web, 216 ca di động, 1210 ca của AI Service); kiểm thử tích hợp, giao diện và tải của đợt 05/10/2026 cho thấy các quy tắc nghiệp vụ và khả năng chịu lỗi hoạt động đúng. Các thành phần AI được đánh giá bằng bộ dữ liệu có gán nhãn và giao thức đăng ký trước: kiểm chứng của trợ lý không còn chặn oan câu trả lời đúng, biểu đồ khớp 1.002/1.002 ô số liệu khi chạy thật, recall@5 0,896 với 90% từ chối đúng, hợp nhất metadata phát hiện xung đột chính xác 18/18 tình huống; trên dữ liệu tổng hợp, gợi ý V2 đạt NDCG@10 0,428 và phân bổ ngân sách cận biên tăng mức đáp ứng nhu cầu ở cả 24 lần chạy kiểm định.')
    d.set_text(F('Các mô hình rủi ro, dự báo và gợi ý mới được đánh giá trên dữ liệu hành vi tổng hợp'),
        'Các mô hình rủi ro, dự báo, gợi ý và thuật toán phân bổ ngân sách mới được đánh giá trên dữ liệu hành vi tổng hợp do chính dự án xây dựng; hiệu quả trên dữ liệu vận hành thật của một thư viện chưa được kiểm chứng.')
    d.set_text(F('Các bộ dữ liệu đánh giá AI còn nhỏ'),
        'Các bộ dữ liệu đánh giá AI còn nhỏ và phần lớn do một người gán nhãn (25 ISBN sách quốc tế, 44 lượt kiểm thử của trợ lý, 108 lượt kiểm thử của bộ lập kế hoạch, 130 truy vấn truy xuất); chưa có bộ ISBN sách Việt Nam có thông tin chuẩn và chưa có bộ ít nhất 50 cuốn sách ba ảnh để đánh giá OCR.')
    d.set_text(F('Chất lượng câu trả lời của trợ lý còn hạn chế'),
        'Câu trả lời của trợ lý vẫn còn lỗi ở khoảng 30% số lượt trong tập kiểm thử, chủ yếu là giả định và suy luận nhân quả không có căn cứ mà kiểm chứng số liệu chưa bắt được; Semantic Planner và lớp trích nhận định bằng mô hình ngôn ngữ chưa đạt tiêu chí nên đang tắt; các chức năng dùng mô hình ngôn ngữ phụ thuộc vào dịch vụ bên ngoài và chịu ảnh hưởng của độ trễ, chi phí và sự thay đổi phiên bản mô hình.')
    d.set_text(F('Chỉ mục ngữ nghĩa của danh mục sách chưa được tự động xây'),
        'Inventory Service tạo nhiều đối tượng kết nối cơ sở dữ liệu, có nguy cơ cạn kết nối khi tải đồng thời cao; OTP hai lớp cho nhân viên đã được hiện thực nhưng chưa được bật ở production.')
    d.set_text(F('Hệ thống mới được triển khai trên một máy đơn'),
        'Hệ thống chạy trên một VPS đơn: chưa có máy chủ dự phòng, sao lưu ra ngoài VPS chưa được xác nhận là đã cấu hình, chưa có truy vết phân tán, log tập trung và giám sát Prometheus/Grafana ở production; bộ giới hạn tần suất của gateway lưu trạng thái trong bộ nhớ của một tiến trình.')
    d.set_text(F('Các chức năng dùng camera trên thiết bị di động'),
        'Ứng dụng di động mới có bản APK preview, chưa được kiểm chứng trên điện thoại thật, chưa có bản iOS và chưa phát hành lên cửa hàng ứng dụng; các chức năng dùng camera (quét mã vạch, chụp ảnh bìa, quay video đóng gói) chưa được kiểm thử tự động; thanh toán VNPay mới ở môi trường sandbox.')
    p = F('Hướng phát triển')
    _move_sect = p.find('w:pPr/w:sectPr', ns)
    last83 = d.add_seq(p, [
        ('body', 'Từ các kết quả và hạn chế trên, các hướng phát triển tiếp theo gồm:'),
        ('bullet', '**Dữ liệu thật:** thu thập dữ liệu vận hành của một thư viện (lịch sử mượn trả, giao hàng) để huấn luyện lại và kiểm định mô hình rủi ro, dự báo, gợi ý và chính sách nhập hàng; bổ sung ràng buộc nhà cung cấp (số lượng tối thiểu, bội số đóng gói, lịch giao) và ngân sách theo kho.'),
        ('bullet', '**Bộ dữ liệu đánh giá:** xây dựng bộ ít nhất 50 cuốn sách tiếng Việt chụp đủ ba ảnh với hai người gán nhãn để công bố độ chính xác của OCR, bộ ISBN sách Việt Nam có thông tin chuẩn, và bổ sung người gán nhãn thứ hai cùng tập kiểm thử độc lập mới cho trợ lý.'),
        ('bullet', '**Trợ lý AI:** giảm độ trễ của lớp trích nhận định (mô hình nhanh hơn hoặc chạy song song với luồng trả lời) để có thể bật; cải thiện hiểu ngữ cảnh nhiều lượt trước khi bật Semantic Planner; mở rộng kiểm chứng sang giả định và quan hệ nhân quả.'),
        ('bullet', '**Vận hành:** dùng một thể hiện PrismaClient chung, chuyển bộ giới hạn tần suất sang Redis, cấu hình sao lưu ra ngoài VPS, triển khai Prometheus và Grafana ở production, thêm máy chủ dự phòng hoặc nền tảng điều phối container khi tải tăng; bật OTP hai lớp cho nhân viên sau khi kiểm chứng việc gửi email ở production.'),
        ('bullet', '**Ứng dụng di động:** kiểm thử trên thiết bị Android và iOS thật, bổ sung kiểm thử tự động cho các chức năng dùng camera và phát hành lên Google Play, App Store.'),
        ('bullet', '**Mở rộng nghiệp vụ:** hỗ trợ chuẩn biên mục MARC21 và Z39.50, tài liệu số, RFID cho kho và thanh toán VNPay ở môi trường thật.'),
    ])
    if _move_sect is not None:
        _move_sect.getparent().remove(_move_sect)
        last83.find('w:pPr', ns).append(_move_sect)

    # ---------------- PHỤ LỤC ----------------
    p = F('Lệnh trên dừng và xóa container nhưng giữ nguyên dữ liệu')
    d.add_seq(p, [
        ('appx', 'A.9. Triển khai production'),
        ('body', 'Triển khai production trên VPS được tự động hóa bằng GitHub Actions; hướng dẫn đầy đủ nằm trong docs/DEPLOYMENT.md. Quy trình cập nhật thông thường là kiểm thử ở máy cá nhân, hợp nhất vào nhánh production và theo dõi workflow Deploy production. Trên máy chủ, mọi lệnh chạy qua deploy/scripts/dc; một số lệnh vận hành thường dùng:'),
        ('code', 'deploy/scripts/healthcheck.sh --verbose'),
        ('code', 'deploy/scripts/backup.sh --label manual'),
        ('code', 'deploy/scripts/rollback.sh'),
        ('appx', 'A.10. Phát hành ứng dụng di động'),
        ('body', 'Bản APK preview được build trên Expo Application Services bằng tài khoản Expo của dự án (hoặc chạy workflow Mobile release trên GitHub); hướng dẫn chi tiết, kể cả build iOS và nộp lên cửa hàng, nằm trong docs/MOBILE_DEPLOYMENT.md.'),
        ('code', 'cd apps/mobile && npx eas-cli@latest build -p android --profile preview'),
    ])
    d.set_text(F('Các bảng dưới đây liệt kê toàn bộ endpoint của từng service'),
        'Các bảng dưới đây liệt kê các endpoint chính của từng service, được trích từ mã nguồn định tuyến. Đường dẫn được ghi theo đường dẫn thật của service; khi gọi từ bên ngoài, yêu cầu đi qua API Gateway với cùng đường dẫn, trừ các endpoint của AI Service (gọi qua tiền tố /ai như trong bảng), các endpoint bạn đọc tự phục vụ (/borrow/my/... được gọi qua /my/...) và các endpoint nội bộ có tiền tố /internal (chỉ dùng giữa các service, không mở qua gateway). Các endpoint kiểm tra sống, sẵn sàng và chỉ số của từng service không được liệt kê. Các endpoint thanh toán VNPay được liệt kê ở cuối Bảng B.3. PT là phương thức HTTP.')
    t = d.table_after(F('Bảng B.1. Danh sách API của Auth Service'))
    for i, r in enumerate(d.rows(t)):
        cells = r.findall('w:tc', ns)
        txts = [text_of(c) for c in cells]
        if len(cells) == 4 and 'verify-email' in txts[3]:
            d.set_row(t, i, [None, None, 'POST', '/auth/email-otp/verify'])
        if len(cells) == 4 and 'resend-verification' in txts[1]:
            d.set_row(t, i, [None, None, 'POST', '/auth/email-otp/resend'])
            d.add_row(t, ['POST', '/auth/login/verify-otp', 'POST', '/auth/refresh'], clone_index=i, after_index=i)
            rows_now = d.rows(t)
            d.add_row(t, ['POST', '/auth/refresh/revoke', '', ''], clone_index=i, after_index=i + 1)
            break
    d.add_row(t, ['GET', '/iam/users/:id/warehouse-scopes', 'PUT', '/iam/users/:id/warehouse-scopes'])
    d.add_row(t, ['GET', '/iam/warehouses/:warehouseId/staff', '', ''])
    t = d.table_after(F('Bảng B.3. Danh sách API của Borrow Service'))
    d.add_row(t, ['POST', '/borrow/my/fines/payments/vnpay/create', 'GET', '/borrow/my/fines/payments/vnpay/status/:txnRef'], clone_index=-1)
    d.add_row(t, ['GET', '/webhooks/vnpay/return', 'GET', '/webhooks/vnpay/ipn'], clone_index=-1)
    t = d.table_after(F('Bảng B.5. Danh sách API của AI Service'))
    rows = d.rows(t)
    for i, r in enumerate(rows):
        if 'explain-storage-suggestion' in text_of(r):
            d.add_row(t, ['GET', '/ai/book-metadata/capabilities', 'POST', '/ai/book-metadata/scan-images'], clone_index=i, after_index=i)
            break
