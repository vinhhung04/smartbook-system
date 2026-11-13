# -*- coding: utf-8 -*-
"""Content edits part C: chapters 5-8 and appendices."""
from sbdoc import ns, text_of
from edits_a import DIA


def run(d):
    F = d.find
    T2 = d.table_after(F('Bảng 5.3 Các công cụ'))
    T3 = d.table_after(F('Bảng 7.6 Kết quả đánh giá chất lượng'))
    T4 = d.table_after(F('Bảng 7.5 Kết quả đánh giá khả năng chọn'))
    T5 = d.table_after(F('Bảng 7.1 Kết quả kiểm thử đơn vị'))
    T6 = d.table_after(F('Bảng 1.1 So sánh các nhóm giải pháp'))

    # ---------------- CHƯƠNG 5 ----------------
    p = d.set_text(F('Khi người quản lý nhập ngân sách, danh sách đề xuất'),
        'Khi người quản lý nhập ngân sách, phiên bản trước phân bổ tham lam theo thứ tự ưu tiên: lần lượt chọn các đề xuất có chi phí còn nằm trong ngân sách và bỏ qua nguyên dòng nếu không vừa. Từ ngày 18/10/2026, chế độ ngân sách dùng thuật toán cấp vốn cận biên đã được kiểm định bằng mô phỏng (trình bày ở Chương 7), gồm ba bước:')
    p = d.add_seq(p, [
        ('bullet', '**Vị thế tồn kho:** tồn khả dụng cộng số bản đang về (số đặt trừ số đã nhận của các đơn đặt hàng đã duyệt, đã gửi, đã được nhà cung cấp xác nhận hoặc đã nhận một phần) và số bản đang được mượn dự kiến được trả trong thời gian chờ, ước lượng bằng đường cong sống sót Kaplan–Meier từ các lượt trả trong 365 ngày (chỉ dùng khi có ít nhất 30 lượt trả).'),
        ('bullet', '**Trần số lượng:** số lượng đề xuất được tính lại với vị thế tồn kho trên; số lượng tối thiểu theo mức ưu tiên chỉ áp dụng khi nhu cầu trong thời gian chờ vượt vị thế tồn. Kết quả là số bản tối đa có thể cấp cho từng dòng.'),
        ('bullet', '**Cấp từng bản:** nhu cầu trong thời gian chờ được mô hình hóa bằng phân phối Poisson với tham số bằng dự báo; bản thứ k của một dòng có giá trị bằng xác suất nhu cầu vượt vị thế cộng k chia cho đơn giá, và bản tiếp theo luôn được cấp cho dòng có giá trị lớn nhất cho tới khi hết ngân sách hoặc mọi dòng chạm trần.'),
        ('body', 'Khi không có ngân sách, danh sách và số lượng đề xuất giữ nguyên như trước; các phương án thay đổi số lượng ở chế độ không ngân sách (tính bản trả về, số lượng tối thiểu có điều kiện, hệ số z thích ứng) đã được đánh giá nhưng không đạt tiêu chí đăng ký trước nên chưa được đưa vào production. Kết quả có ngân sách trả thêm số bản được cấp, chi phí được cấp và các giả định cho từng dòng. Mỗi đề xuất kèm một đoạn giải thích bằng tiếng Việt sinh từ chính các số liệu trên (tồn hiện tại, lượt mượn, số ngày dự kiến hết hàng, mức tăng nhu cầu, hệ số mùa vụ), nên không cần mô hình ngôn ngữ.'),
    ])
    d.set_text(F('Trợ lý dùng mô hình Qwen qua OpenRouter với 11 công cụ'),
        'Trợ lý AI (Copilot) dùng mô hình Qwen qua OpenRouter với 20 công cụ chỉ đọc: 11 công cụ phân tích gốc (Bảng 5.3), mỗi công cụ ánh xạ tới một endpoint của Analytics Service hoặc danh mục sách, và 9 công cụ tổng hợp (Bảng {TAB:copilot_tools}) tự kết hợp nhiều endpoint để so sánh kho, so sánh kỳ, đối chiếu nhu cầu với tồn kho và mô phỏng ngân sách.')
    empty = d.table_after(F('Bảng 5.3 Các công cụ')).getnext()
    last = d.add_seq(empty, [
        ('captab', 'Bảng {TAB:copilot_tools} Các công cụ tổng hợp của Trợ lý AI'),
        ('table', dict(template=T2, rows=[
            ['Công cụ', 'Dữ liệu trả về'],
            ['get_warehouse_low_stock_items', 'Danh sách đầu sách dưới ngưỡng tồn của một kho'],
            ['compare_warehouses', 'Xếp hạng rủi ro tồn kho giữa các kho theo tiêu chí công bố'],
            ['explain_warehouse_shortage', 'Các yếu tố gây thiếu hàng của một kho'],
            ['compare_borrow_periods', 'So sánh lượt mượn giữa hai kỳ: tổng, trung bình ngày, ngày cao điểm'],
            ['compare_top_books', 'So sánh danh sách sách được mượn nhiều giữa hai kỳ'],
            ['analyze_demand_vs_stock', 'Đối chiếu nhu cầu mượn với tồn kho và đề xuất nhập'],
            ['simulate_reorder_budget', 'Mô phỏng nhiều mức ngân sách nhập hàng: số dòng, số bản được cấp, phần thiếu'],
            ['explain_reorder_item', 'Giải thích một dòng đề xuất nhập hàng cụ thể'],
            ['rank_priority_tasks', 'Xếp hạng việc cần ưu tiên theo quy tắc công bố'],
        ])),
    ])
    p = d.set_text(F('Luồng xử lý một câu hỏi gồm các bước sau'),
        'Luồng xử lý một câu hỏi được minh họa ở Hình {FIG:copilot}. Câu hỏi được chuẩn hóa (bỏ dấu, viết tắt, sửa lỗi gõ trong từ vựng nghiệp vụ) và đưa qua bộ lập kế hoạch dựa trên luật, có theo dõi trạng thái hội thoại nhiều lượt (năng lực, kho, kỳ, ngân sách, danh sách vừa hiển thị) để hiểu các câu nối tiếp như "kho đó", "cuốn thứ hai", "tăng thêm 5 triệu". Kế hoạch gồm tối đa 6 công cụ với đối số do backend dựng; kho kế thừa từ lượt trước được lọc lại theo quyền hiện tại. Nếu câu hỏi không ánh xạ được năng lực nào, mô hình tự chọn công cụ trong tối đa 4 vòng. Một lớp lập kế hoạch ngữ nghĩa (Semantic Planner) có thể dùng mô hình ngôn ngữ để đọc nghĩa câu diễn đạt gián tiếp, nhưng chỉ được thêm năng lực, còn số tiền, tỷ lệ và tên sách luôn lấy từ câu chữ người dùng; lớp này đang tắt mặc định vì chưa đạt tiêu chí đánh giá. Kết quả công cụ được gom thành bảng bằng chứng; phần giải thích phân loại từng nhận định thành dữ kiện (FACT), suy luận (INFERENCE), giả định (ASSUMPTION) hoặc chưa biết (UNKNOWN). Câu trả lời được truyền về dạng luồng (SSE) cùng danh sách công cụ đã gọi, bằng chứng, giải thích và trạng thái kiểm chứng.')
    d.add_seq(p, [
        ('image', DIA + 'architecture/ai-copilot-pipeline.png', 13.5),
        ('capfig', 'Hình {FIG:copilot} Kiến trúc xử lý của Trợ lý AI: kế hoạch, bằng chứng, giải thích, kiểm chứng và trực quan hóa'),
        ('h3', 'Kiểm chứng câu trả lời của trợ lý'),
        ('body', 'Sau khi mô hình sinh bản nháp, lớp kiểm chứng tất định (Layer 1, luôn bật) trích các nhận định có thể đối chiếu: con số, khoảng ngày, xếp hạng, ngân sách, số bản và chi phí được cấp, xu hướng, cùng trường hợp không truy xuất được dữ liệu nào mà câu trả lời vẫn có số liệu (NO_DATA). Mỗi nhận định mang cơ sở exact (đối chiếu trực tiếp với dữ liệu) hoặc heuristic (suy ra từ từ vựng). Lỗi nghiêm trọng có cơ sở exact được sửa an toàn nếu có thể, nếu không thì câu trả lời được sinh lại tối đa một lần; nếu vẫn lỗi, hệ thống trả câu dựng trực tiếp từ dữ liệu (BLOCKED) và không đề xuất hành động. Lỗi chỉ nằm ở nhận định suy luận thì hệ thống lược bỏ đúng các câu sai và gắn trạng thái WARNING; bản sinh lại tệ hơn bản đầu bị loại. Bước sửa tự động không bao giờ viết đè một con số trùng với một đại lượng khác của dữ liệu, vì đánh giá cho thấy sửa lặng lẽ có thể biến câu đúng thành sai.'),
        ('body', 'Lớp trích nhận định bằng mô hình ngôn ngữ (Layer 2–3: mô hình chỉ trích nhận định có cấu trúc, backend so với dữ liệu và phán quyết) bắt được thêm lỗi nhưng làm tăng độ trễ p95 thêm 7,0–8,3 giây, vượt ngưỡng 6 giây đã đặt trước, nên đang tắt mặc định (cờ COPILOT_SEMANTIC_CLAIMS). Trợ lý chỉ được đề xuất hành động khi kết quả kiểm chứng an toàn (safe_to_act).'),
        ('h3', 'Trực quan hóa dữ liệu trong hội thoại'),
        ('body', 'Mô hình ngôn ngữ không chọn số liệu, không chọn loại biểu đồ và không sinh mã giao diện. Backend dựng đặc tả biểu đồ từ dữ liệu công cụ bằng 18 bộ dựng theo công cụ, chọn một trong sáu loại (đường, cột, miền, tròn, thẻ KPI, bảng) và kiểm tra bằng lược đồ Pydantic với các giới hạn: tối đa 4 biểu đồ mỗi câu trả lời, 60 điểm mỗi biểu đồ, 50 dòng bảng, 8 lát biểu đồ tròn; kỳ chưa trọn và giá trị không hợp lệ được đánh dấu thay vì thay bằng 0. Frontend lọc lại đặc tả và chỉ vẽ bằng danh sách component cho phép trên Recharts; người dùng có thể đổi kiểu biểu đồ, bật tắt chuỗi, xem dạng bảng và kéo thanh trượt ngân sách để đặt câu hỏi tiếp theo. Mô hình chỉ nhận bản tóm tắt của biểu đồ để viết lời giải thích nhất quán với hình; câu trả lời vẽ biểu đồ bằng ký tự bị loại bỏ.'),
    ])
    p = F('Kết quả hợp nhất không được ghi thẳng vào danh mục')
    d.add_seq(p, [
        ('h3', 'Nhập sách bằng OCR nhiều ảnh'),
        ('body', 'Nhân viên có thể chụp hoặc tải tối đa ba ảnh của một cuốn sách: bìa trước, bìa sau và trang thông tin xuất bản. Chức năng này khác với tìm sách bằng ảnh bìa (chỉ nhận diện sách đã có trong danh mục) và đọc hóa đơn nhà cung cấp: mục tiêu là đề xuất metadata để biên mục một cuốn sách. Pipeline gồm các bước:'),
        ('bullet', '**Tiền xử lý:** xác minh định dạng bằng chữ ký tệp và giải mã thật, chặn ảnh nén bất thường, xoay theo EXIF, thu nhỏ cạnh dài về 1.600 px, mã hóa lại JPEG và xóa EXIF/GPS; tối đa 3 ảnh và 8 MB.'),
        ('bullet', '**Trích xuất:** một lời gọi mô hình thị giác (mặc định qwen/qwen3.7-flash) chứa cả ba ảnh có nhãn loại ảnh; mô hình trả về giá trị từng trường kèm đoạn chữ chép lại từ ảnh.'),
        ('bullet', '**Kiểm tra:** chuẩn hóa Unicode, chuyển ISBN-10 sang ISBN-13 và kiểm tra chữ số kiểm tra; giá trị phải xuất hiện trong đoạn chữ đã chép; kiểm tra đúng vai trò (dịch giả, họa sĩ minh họa không phải tác giả, nhà phát hành không phải nhà xuất bản, năm in không phải năm xuất bản).'),
        ('bullet', '**So khớp tiếng Việt hai mức:** khóa mờ (bỏ dấu) để gom các lần đọc có thể cùng giá trị và khóa chặt (giữ dấu thanh, dấu mũ, chữ đ) để xác nhận; hai giá trị chỉ khác dấu bị đánh dấu DIACRITICS_DIFFER và phải được duyệt.'),
        ('bullet', '**Đối chiếu với tra cứu ISBN:** khi có đúng một ISBN hợp lệ, hệ thống gọi lại chức năng tra cứu ISBN hiện có; bản ghi tra cứu chỉ được coi là cùng cuốn khi nhan đề khớp hoặc cùng ISBN xuất hiện ở hai ảnh. Mã vạch do trình duyệt đọc chỉ được tính là nguồn thứ hai khi khớp ISBN đọc từ ảnh.'),
        ('bullet', '**Chính sách tự điền:** mỗi trường mang một trạng thái EXTRACTED, CORROBORATED, LOOKUP_ONLY, REVIEW_REQUIRED, CONFLICTED, INVALID, INFERRED hoặc MISSING; chỉ giá trị được hai nguồn độc lập xác nhận (kể cả dấu) hoặc một số trường ít rủi ro (dịch giả, số trang) mới được tự điền. Hệ thống không dùng điểm tin cậy do mô hình tự khai.'),
        ('body', 'Kết quả OCR không được đưa vào bước hợp nhất bằng chứng của tra cứu ISBN, vì một lần đọc của mô hình không có định vị kiểm chứng được như dữ liệu của nguồn. Kết quả chỉ được điền vào biểu mẫu; việc lưu vẫn đi qua bản nháp đối soát, kiểm tra trùng lặp và nút Lưu, và kết quả bị khóa nếu ảnh thay đổi sau lần quét.'),
    ])
    d.set_text(F('Gợi ý sách cho bạn đọc kết hợp bốn thành phần'), 'Phiên bản đầu (V1) của bộ gợi ý kết hợp bốn thành phần:')
    p = F('Sách bạn đọc đã mượn, yêu thích hoặc đánh giá được loại khỏi danh sách')
    d.add_after(p, 'body', 'Đánh giá ở Chương 7 cho thấy V1 kém hơn cả phương án gợi ý theo độ phổ biến, nên từ ngày 30/09/2026 hệ thống chuyển sang Recommendation V2 và đặt làm mặc định (biến RECOMMENDATION_MODEL=v2). V2 gồm hai bước. Bước sinh ứng viên lấy tối đa 40 sách từ mỗi nguồn: sở thích thể loại, cùng tác giả, tương đồng ngữ nghĩa, lọc cộng tác theo cặp sách, sách phổ biến theo xu hướng 90 ngày và sách mới về trong 60 ngày. Bước xếp hạng tính tám đặc trưng – sở thích, tác giả, ngữ nghĩa, cộng tác, độ phổ biến, độ mới, chất lượng và khả năng có sách – chuẩn hóa theo độ lệch chuẩn rồi cộng có trọng số; trọng số (lần lượt 1,0; 0,25; 1,0; 2,0; 1,0; 1,0; 0,25; 0,1) được chọn bằng tìm kiếm tọa độ trên tập kiểm định theo thời gian, không chỉnh tay. Thành phần chất lượng vẫn dùng điểm đánh giá co về trung bình theo (5.6). Mỗi gợi ý giữ các thành phần điểm để sinh lý do; mô hình ngôn ngữ vẫn không chọn và không chấm điểm sách.')

    # ---------------- CHƯƠNG 6 ----------------
    t = d.table_after(F('Bảng 6.1 Cấu trúc thư mục'))
    for i, r in enumerate(d.rows(t)):
        c0 = text_of(r.findall('w:tc', ns)[0])
        if c0.startswith('packages/shared'):
            d.set_row(t, i, [None, 'Thư viện dùng chung: chỉ số, ngữ cảnh yêu cầu, thu hồi token, phạm vi kho, hợp đồng dữ liệu'])
        elif c0.startswith('infra'):
            d.set_row(t, i, ['observability, deploy, .github', 'Cấu hình Prometheus/Grafana (tùy chọn); Caddyfile và kịch bản triển khai, sao lưu, khôi phục, quay lui; quy trình CI/CD; docker-compose.yml (phát triển) và compose.prod.yml (production)'])
    d.add_row(t, ['thesis, docs/diagrams', 'Dữ liệu, bảng và biểu đồ đánh giá sinh tự động cho báo cáo; mã nguồn sơ đồ Mermaid và Draw.io'])
    t = d.table_after(F('Bảng 6.2 Công nghệ và phiên bản'))
    for i, r in enumerate(d.rows(t)):
        c0 = text_of(r.findall('w:tc', ns)[0])
        if c0.startswith('Ứng dụng di động'):
            d.set_row(t, i, [None, 'Expo SDK 58, React Native 0.88, Expo Router', 'Hai nhóm màn hình bạn đọc và nhân viên kho; quét mã bằng camera; build qua EAS'])
        elif c0.startswith('Quan sát'):
            d.set_row(t, i, [None, 'OpenTelemetry (chỉ số), Prometheus 2.53, Grafana 11.1', 'Profile monitoring tùy chọn; không còn trace và log tập trung'])
    d.add_row(t, ['Triển khai', 'Docker Compose, Caddy 2.8, GitHub Actions, GHCR, Expo EAS', 'Production trên VPS; image gắn theo commit SHA'])
    d.set_text(F('Ứng dụng web là ứng dụng một trang'),
        'Ứng dụng web là ứng dụng một trang, định tuyến bằng React Router với cơ chế tải lười theo trang và hàm kiểm tra quyền chạy trước khi vào trang; trang không đủ quyền chuyển tới màn hình từ chối truy cập. Giao diện hỗ trợ tiếng Việt và tiếng Anh, chế độ sáng và tối. Bản build tĩnh được phục vụ bởi nginx kèm chính sách bảo mật nội dung. Ứng dụng di động xây bằng Expo SDK 58 và Expo Router, dùng một hệ thống giao diện thống nhất và thanh điều hướng gốc của nền tảng, gồm hai nhóm màn hình: nhóm bạn đọc (khám phá, tìm kiếm, trợ lý tìm sách, chi tiết sách và đặt giữ, sách của tôi với mã nhận sách và phiếu mượn, ví và phí phạt có thanh toán VNPay, tìm sách bằng ảnh bìa, thông báo) và nhóm nhân viên kho (việc của tôi, quét mã, tra cứu sách, cất hàng, lấy hàng, xuất kho, nhận chuyển kho, kiểm kê, báo cáo sự cố). Ứng dụng dùng chung tài khoản, hỗ trợ bước OTP và duy trì phiên bằng refresh token xoay vòng.')
    t = d.table_after(F('Bảng 6.3 Các tác vụ nền'))
    d.add_row(t, ['Đồng bộ danh mục cho AI', 'AI', '300 giây', 'Cập nhật chỉ mục tìm kiếm của AI Service từ danh mục sách qua endpoint nội bộ'])
    d.add_row(t, ['Sao lưu cơ sở dữ liệu', 'VPS (cron)', '02:30 hằng ngày', 'pg_dump bốn cơ sở dữ liệu và ảnh đóng gói, giữ 14 ngày'])
    d.add_row(t, ['Kiểm tra sức khỏe', 'VPS (cron)', '5 phút', 'Kiểm tra container, endpoint công khai và dung lượng đĩa, ghi syslog, cảnh báo qua webhook (tùy chọn)'])
    d.set_text(F('Khi khởi động, các service từ chối chạy nếu khóa bí mật'),
        'Khi khởi động, các service từ chối chạy nếu khóa bí mật bị thiếu hoặc còn là giá trị mẫu; kịch bản khởi tạo môi trường sinh ngẫu nhiên mật khẩu cơ sở dữ liệu, khóa ký JWT và khóa dịch vụ nội bộ. Mọi service gắn các tiêu đề bảo mật HTTP, giới hạn kích thước thân yêu cầu và chỉ chấp nhận nguồn gốc (origin) được cấu hình. Khóa API của OpenRouter chỉ tồn tại trong môi trường của AI Service. Ảnh và video bằng chứng đóng gói được lưu trong volume riêng, chỉ truy cập qua API có kiểm tra quyền. Mã OTP chỉ được lưu dưới dạng HMAC với khóa riêng OTP_HMAC_SECRET (Auth Service từ chối khởi động ở production khi thiếu khóa này); refresh token chỉ được lưu dưới dạng băm. Ở production, bí mật nằm trong tệp .env trên máy chủ và trong môi trường được bảo vệ của GitHub, không được đưa vào image; các biến EXPO_PUBLIC_* của ứng dụng di động được nhúng vào gói mã nên chỉ chứa địa chỉ API công khai.')
    d.set_text(F('Mọi service khởi tạo OpenTelemetry qua thư viện dùng chung'),
        'Từ ngày 16/10/2026, cấu hình quan sát được rút gọn cho phù hợp với việc vận hành trên một máy chủ. Các service Node.js khởi tạo OpenTelemetry qua thư viện dùng chung ở chế độ chỉ số (MeterProvider với bộ xuất Prometheus và đo HTTP tự động), không còn SDK truy vết; AI Service cung cấp /metrics với số token, chi phí, độ trễ OCR và đồng bộ danh mục. Prometheus và Grafana (bốn bảng điều khiển: tổng quan hệ thống, luồng mượn, sức khỏe kho, hiệu năng AI; kèm năm luật cảnh báo) chỉ chạy khi bật profile monitoring ở môi trường phát triển; Tempo, Loki và Promtail đã bị loại bỏ. Ở production, việc giám sát dựa trên kiểm tra sức khỏe của từng container, endpoint /ready của gateway kiểm tra các service lõi, kịch bản healthcheck.sh chạy mỗi 5 phút ghi vào syslog và có thể gửi cảnh báo qua webhook, cùng log JSON của Docker được xoay vòng theo dung lượng.')
    p = F('Thanh toán phí phạt qua VNPay', nth=1)
    d.add_after(p, 'body', 'Tích hợp VNPay nằm trong Borrow Service gồm ba thành phần: vnpay.service.js dựng và ký URL thanh toán theo đặc tả VNPay (sắp xếp tham số, HMAC-SHA512 với khóa bí mật của cửa hàng) và xác minh chữ ký của tham số trả về; vnpay-payment.controller.js tạo ý định thanh toán cho bạn đọc (/my/fines/payments/vnpay/create) và tra trạng thái (/my/fines/payments/vnpay/status/:txnRef); vnpay-webhook.controller.js xử lý /webhooks/vnpay/return và /webhooks/vnpay/ipn, trả mã RspCode theo đặc tả (97 chữ ký sai, 01 không tìm thấy, 02 đã xác nhận, 04 sai số tiền, 00 đã xử lý). Trang kết quả được Borrow Service trả trực tiếp dưới dạng HTML độc lập, vì đường dẫn trả về có thể được mở từ trình duyệt hệ thống của điện thoại, nơi không có phiên đăng nhập của ứng dụng web. Khi chưa cấu hình mã cửa hàng và khóa bí mật, API trả mã 503 và hướng dẫn bạn đọc thanh toán tại quầy. Hệ thống hiện chỉ dùng môi trường sandbox của VNPay [1].')
    p = F('Lệnh pnpm verify là cổng chất lượng duy nhất')
    d.add_after(p, 'body', 'Từ ngày 29/10/2026, dự án có thêm quy trình triển khai liên tục deploy-production.yml, chỉ chạy khi mã được đẩy lên nhánh production hoặc khi chạy tay (Hình {FIG:cicd}). Job test là cổng chặn (lint, kiểm tra kiểu, build, kiểm thử Node.js, web, AI và kiểm tra tệp compose.prod.yml); job build dựng song song 7 image (web, api-gateway và năm service) và đẩy lên GHCR với hai nhãn là commit SHA và production; job deploy chạy trong môi trường production của GitHub (giữ bí mật và quy tắc chỉ nhánh production được triển khai), kết nối SSH với khóa máy chủ được ghim, tải tệp cấu hình lên VPS và gọi deploy.sh, sau đó kiểm tra từ Internet rằng web trả về đúng commit vừa triển khai. Quy trình mobile-release.yml chạy độc lập để build ứng dụng di động trên EAS hoặc phát hành bản cập nhật qua mạng.')
    p = F('Sau khi khởi động, web chạy tại cổng 5173')
    d.add_seq(p, [
        ('h2', 'Triển khai production và phát hành ứng dụng di động'),
        ('h3', 'Hạ tầng và cấu hình'),
        ('body', 'Môi trường production chạy trên một VPS Ubuntu Server 24.04 (6 vCPU, khoảng 12 GB RAM, 120 GB SSD, swap 4 GB) với tên miền smartbook.io.vn cho web và api.smartbook.io.vn cho API, hoạt động từ ngày 29/10/2026. Máy chủ được bảo vệ bằng tường lửa UFW chỉ mở SSH, 80 và 443, fail2ban cho SSH và cập nhật bảo mật tự động; đăng nhập SSH chỉ bằng khóa. Toàn bộ tệp vận hành nằm trong /opt/smartbook, mọi lệnh Docker Compose chạy qua kịch bản deploy/scripts/dc để nạp bí mật từ .env và phiên bản đang chạy từ state/release.env. Kiến trúc container và mạng được trình bày ở Hình 4.2. Cơ sở dữ liệu production chứa bộ dữ liệu mẫu phục vụ trình diễn.'),
        ('h3', 'Quy trình triển khai và quay lui'),
        ('body', 'Kịch bản deploy.sh thực hiện theo thứ tự: sao lưu toàn bộ cơ sở dữ liệu bằng pg_dump trước khi migration chạy (giữ 5 bản gần nhất), tải image theo commit SHA, khởi động bằng docker compose up --wait (mỗi service chạy prisma migrate deploy, chỉ áp các migration mới), chờ kiểm tra sức khỏe và kiểm tra nhanh; nếu thất bại thì tự quay lui về release trước, ghi lịch sử vào state/releases.log và giữ image của ba release gần nhất. Quay lui chỉ đổi image, không đổi lược đồ cơ sở dữ liệu, nên mọi migration phải tương thích ngược theo nguyên tắc mở rộng trước, thu hẹp sau. Hình {FIG:cicd} tóm tắt toàn bộ quy trình từ mã nguồn đến máy chủ.'),
        ('image', DIA + 'architecture/deploy-ci-cd-pipeline.png', 15.5),
        ('capfig', 'Hình {FIG:cicd} Quy trình CI/CD từ mã nguồn đến VPS production'),
        ('h3', 'Sao lưu, khôi phục và giám sát'),
        ('body', 'Cron trên VPS chạy backup.sh lúc 02:30 hằng ngày: mỗi bản gồm pg_dump định dạng custom của auth_db, inventory_db, borrow_db, ai_db, các vai trò PostgreSQL, ảnh và video đóng gói, kèm tệp SHA256SUMS; bản hằng ngày được giữ 14 ngày, ngoài ra còn bản trước mỗi lần triển khai, nạp dữ liệu và khôi phục. verify-backup.sh khôi phục thử vào một cơ sở dữ liệu tạm và so số bảng với cơ sở dữ liệu thật; restore.sh tự sao lưu trạng thái hiện tại, dừng các service ghi dữ liệu, khôi phục rồi khởi động lại. Sao lưu ra ngoài VPS (qua rclone) đã được chuẩn bị trong kịch bản nhưng chưa được xác nhận là đã cấu hình. healthcheck.sh chạy mỗi 5 phút kiểm tra container, endpoint công khai và dung lượng đĩa (cảnh báo khi trên 85%).'),
        ('h3', 'Phát hành ứng dụng di động'),
        ('body', 'Ứng dụng di động có ba hồ sơ build trên Expo Application Services: development (APK có dev client, trỏ tới máy phát triển), preview (APK được ký trên EAS, trỏ tới https://api.smartbook.io.vn) và production (AAB cho Google Play, IPA cho App Store). Địa chỉ API của preview và production nằm trong môi trường của dự án EAS; tệp cấu hình chặn build nếu địa chỉ còn là giá trị mẫu, dùng http hoặc địa chỉ mạng nội bộ. Đến ngày 29/10/2026, bản APK preview đầu tiên (phiên bản 1.0.0) đã được build và kiểm tra tĩnh (đã ký, đúng định danh com.smartbook.picking, trỏ tới API production, không bật HTTP không mã hóa), nhưng chưa được cài và kiểm chứng trên điện thoại thật; bản iOS chưa được build vì cần tài khoản Apple Developer Program; ứng dụng chưa được nộp lên Google Play hay App Store.'),
    ])
