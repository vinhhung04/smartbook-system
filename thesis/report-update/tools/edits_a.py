# -*- coding: utf-8 -*-
"""Content edits part A: front matter, chapters 1-3."""
import copy
from sbdoc import ns, q

REPO = 'C:/Users/hungx/Desktop/Work/Work/KLTN/smartbook-system'
SHOT = REPO + '/thesis/report-update/screenshots/'
DIA = REPO + '/docs/diagrams/exports/png/'


def set_cell_lines(d, tc, lines):
    ps = tc.findall('w:p', ns)
    first = ps[0]
    for extra in ps[1:]:
        tc.remove(extra)
    d.set_text(first, lines[0])
    cur = first
    for ln in lines[1:]:
        np_ = copy.deepcopy(first)
        d.set_text(np_, ln)
        cur.addnext(np_)
        cur = np_


def run(d):
    F = d.find
    # ---------------- ABSTRACT ----------------
    d.set_text(F('This thesis develops SmartBook'),
        'This thesis develops SmartBook, a microservice platform that unifies circulation with warehouse and procurement operations and embeds AI in two controlled roles. It comprises an API Gateway, five domain services (Auth, Inventory, Borrow, Analytics, AI), a React web app and an Expo mobile app on PostgreSQL with pgvector, Redis and RabbitMQ, deployed on a VPS with continuous deployment and automatic rollback. Sign-up is confirmed by an email one-time code and staff access is limited to assigned warehouses.')
    d.set_text(F('For decision support, the system forecasts'),
        'For decision support, the system forecasts title-level demand with a seasonal EWMA-plus-trend model, sizes safety stock from learned lead times and, under a budget, funds copies one at a time by marginal service gain per dong. A copilot (Qwen via OpenRouter) calls 20 read-only analytics tools with the user\'s permissions, separates facts from inferences and assumptions, renders validated charts, verifies the figures of every answer and can only propose actions that a person confirms. For extraction, multi-source ISBN metadata is fused field by field and a multi-image OCR import only proposes values for human review.')
    d.set_text(F('Evaluation shows 97.1% correct tool selection'),
        'On a frozen 44-turn test set, the copilot\'s verification removed unjustified blocking (2 to 0) while erroneous answers stayed within run-to-run variation (13 to 17); charts matched tool data in all 1,002 cells. On synthetic data, the recommender reached NDCG@10 of 0.428 (popularity: 0.352) and budget allocation raised the fill rate by 2.9 to 8.1 points in all 24 validation runs.')
    # ---------------- TÓM TẮT ----------------
    d.set_text(F('Khóa luận xây dựng SmartBook'),
        'Khóa luận xây dựng SmartBook, nền tảng microservices hợp nhất lưu thông với kho vận – mua hàng và tích hợp AI ở hai vai trò có kiểm soát. Hệ thống gồm API Gateway, năm service nghiệp vụ (Auth, Inventory, Borrow, Analytics, AI), ứng dụng web React và ứng dụng di động Expo trên nền PostgreSQL có pgvector, Redis, RabbitMQ, chạy trên VPS phía sau Caddy bằng Docker Compose với CI/CD có tự quay lui. Tài khoản bạn đọc được xác minh bằng mã OTP qua email và nhân viên chỉ thao tác trong phạm vi kho được phân công.')
    d.set_text(F('Về hỗ trợ ra quyết định, hệ thống dự báo'),
        'Về hỗ trợ ra quyết định, hệ thống dự báo nhu cầu từng đầu sách bằng mô hình trung bình trượt hàm mũ có xu hướng và mùa vụ, tính tồn kho an toàn theo thời gian chờ hàng học từ dữ liệu và, khi có ngân sách, cấp vốn theo từng bản dựa trên lợi ích phục vụ cận biên. Trợ lý AI (Qwen qua OpenRouter) gọi 20 công cụ phân tích chỉ đọc bằng quyền của người hỏi, tách dữ kiện với suy luận và giả định, hiển thị biểu đồ được kiểm tra, kiểm chứng số liệu của mọi câu trả lời và chỉ được đề xuất hành động để con người xác nhận. Về trích xuất thông tin, metadata theo ISBN từ nhiều nguồn được hợp nhất theo từng trường; chức năng nhập sách bằng OCR đọc tối đa ba ảnh của cuốn sách và chỉ đề xuất giá trị để người duyệt quyết định.')
    d.set_text(F('Kết quả đánh giá: chọn đúng công cụ'),
        'Kết quả đánh giá: trên tập kiểm thử đóng băng 44 lượt, kiểm chứng của trợ lý không còn chặn oan câu trả lời đúng (từ 2 xuống 0), số câu trả lời có lỗi dao động 13–17 giữa các lần chạy; biểu đồ khớp dữ liệu công cụ ở toàn bộ 1.002 ô. Trên dữ liệu tổng hợp, bộ gợi ý lai đạt NDCG@10 0,428 so với 0,352 của gợi ý theo độ phổ biến; phân bổ ngân sách cận biên tăng mức đáp ứng nhu cầu 2,9–8,1 điểm phần trăm ở cả 24 lần chạy kiểm định.')

    # ---------------- Abbreviations ----------------
    t0 = d.tables()[0]
    def ins_after_row(label, vals):
        rows = d.rows(t0)
        for i, r in enumerate(rows):
            from sbdoc import text_of
            if text_of(r.findall('w:tc', ns)[0]).strip() == label:
                d.add_row(t0, vals, clone_index=i, after_index=i)
                return
        raise KeyError(label)
    ins_after_row('XAI' if False else 'WMS', ['XAI', 'Explainable Artificial Intelligence', 'Trí tuệ nhân tạo có khả năng giải thích'])
    ins_after_row('UML', ['VPS', 'Virtual Private Server', 'Máy chủ ảo riêng'])
    ins_after_row('OCR', ['OTP', 'One-Time Password', 'Mật khẩu (mã) dùng một lần'])
    ins_after_row('EWMA', ['GHCR', 'GitHub Container Registry', 'Kho lưu trữ image container của GitHub'])
    ins_after_row('GHCR', ['HMAC', 'Hash-based Message Authentication Code', 'Mã xác thực thông điệp dựa trên hàm băm có khóa'])
    ins_after_row('DSS', ['EAS', 'Expo Application Services', 'Dịch vụ build và phát hành ứng dụng Expo'])
    ins_after_row('API', ['CI/CD', 'Continuous Integration / Continuous Delivery', 'Tích hợp liên tục / triển khai liên tục'])

    # ---------------- CHƯƠNG 1 ----------------
    d.set_text(F('Xây dựng phân hệ trích xuất thông tin sách: tra cứu ISBN'),
        '**Xây dựng phân hệ trích xuất thông tin sách:** tra cứu ISBN đa nguồn, hợp nhất bằng chứng theo từng trường có độ tin cậy và nguồn gốc, duyệt từng trường trước khi ghi danh mục, phát hiện trùng lặp ấn phẩm, đọc thông tin sách từ tối đa ba ảnh chụp (bìa trước, bìa sau, trang thông tin xuất bản), tìm sách bằng ảnh bìa, đọc hóa đơn nhà cung cấp và sinh tóm tắt tiếng Việt.')
    d.set_text(F('Xây dựng phân hệ hỗ trợ ra quyết định: dự báo'),
        '**Xây dựng phân hệ hỗ trợ ra quyết định:** dự báo nhu cầu và đề xuất nhập hàng có phân bổ theo ngân sách, gợi ý thanh lý, mô hình dự đoán rủi ro trả trễ và không đến nhận sách, trợ lý AI gọi công cụ phân tích có giải thích, kiểm chứng số liệu và trực quan hóa bằng biểu đồ, cơ chế hành động có xác nhận và bản tin tổng hợp tự động hằng đêm.')
    d.set_text(F('Bảo đảm các yêu cầu phi chức năng về phân quyền'),
        '**Bảo đảm các yêu cầu phi chức năng** về xác thực (xác minh email bằng OTP, OTP hai lớp tùy chọn cho nhân viên), phân quyền theo vai trò và theo kho, tính nhất quán dữ liệu giữa các service, khả năng giám sát và triển khai tái lập bằng Docker Compose, cả trên máy cá nhân lẫn trên máy chủ thật có quy trình CI/CD.')
    d.set_text(F('Auth Service quản lý tài khoản, vai trò, quyền, xác thực JWT'),
        '**Auth Service** quản lý tài khoản, vai trò, quyền và phạm vi kho của nhân viên; xác thực JWT, refresh token cho ứng dụng di động, mã OTP qua email để xác minh tài khoản và làm lớp xác thực thứ hai, đặt lại mật khẩu qua email.')
    d.set_text(F('AI Service (Python/'),
        '**AI Service** (Python/FastAPI) cung cấp trợ lý quản lý (Copilot) có giải thích, kiểm chứng và biểu đồ, chatbot, trích xuất metadata theo ISBN, nhập sách bằng OCR nhiều ảnh, tìm sách bằng ảnh bìa, OCR hóa đơn, xác minh ảnh đóng gói, gợi ý sách và tìm kiếm lai trên pgvector.')
    d.set_text(F('Hạ tầng PostgreSQL có pgvector, Redis, RabbitMQ, bộ giám sát'),
        '**Hạ tầng** PostgreSQL có pgvector, Redis, RabbitMQ; triển khai bằng Docker Compose trên máy cá nhân và trên một VPS production phía sau Caddy (HTTPS) với quy trình CI/CD bằng GitHub Actions; Prometheus và Grafana là thành phần giám sát tùy chọn.')
    p = d.set_text(F('AI Service chưa được gắn truy vết phân tán'),
        'Khả năng quan sát mới dừng ở chỉ số (metric) và kiểm tra sức khỏe; hệ thống không còn truy vết phân tán và thu thập log tập trung, môi trường production chưa triển khai Prometheus và Grafana.')
    p = d.add_after(p, 'bullet', 'Ứng dụng di động mới có bản APK preview được build trên Expo Application Services, chưa được kiểm chứng trên điện thoại thật và chưa phát hành lên Google Play hay App Store; bản iOS chưa được build.')
    d.add_after(p, 'bullet', 'Chức năng nhập sách bằng OCR nhiều ảnh chưa được đánh giá trên một bộ dữ liệu sách có gán nhãn đủ lớn; các thành phần thử nghiệm của trợ lý (lập kế hoạch ngữ nghĩa, trích nhận định bằng mô hình ngôn ngữ) được giữ ở trạng thái tắt mặc định vì chưa đạt tiêu chí đánh giá.')
    d.set_text(F('Hệ thống SmartBook hoàn chỉnh gồm API Gateway, năm service'),
        'Hệ thống SmartBook hoàn chỉnh gồm API Gateway, năm service nghiệp vụ, ứng dụng web và ứng dụng di động; chạy được bằng Docker Compose trên máy cá nhân với dữ liệu mẫu và đã được triển khai trên VPS tại tên miền smartbook.io.vn với HTTPS, CI/CD, sao lưu hằng ngày và tự quay lui phiên bản khi triển khai lỗi.')
    d.set_text(F('Phân hệ trích xuất thông tin sách với tra cứu ISBN đa nguồn'),
        'Phân hệ trích xuất thông tin sách với tra cứu ISBN đa nguồn, hợp nhất bằng chứng theo trường, duyệt từng trường, kiểm tra trùng lặp, nhập sách bằng OCR từ tối đa ba ảnh, tìm sách bằng ảnh bìa, OCR hóa đơn.')
    p = d.set_text(F('Phân hệ hỗ trợ ra quyết định với dự báo nhu cầu'),
        'Phân hệ hỗ trợ ra quyết định với dự báo nhu cầu có mùa vụ và thời gian chờ hàng học từ dữ liệu, phân bổ ngân sách theo lợi ích phục vụ cận biên, gợi ý thanh lý, mô hình rủi ro, gợi ý sách V2, trợ lý AI dùng 20 công cụ chỉ đọc có giải thích, kiểm chứng và biểu đồ, 5 loại hành động phải được xác nhận, bản tin tổng hợp hằng đêm.')
    d.add_after(p, 'bullet', 'Bảo mật tài khoản bằng mã OTP qua email khi đăng ký và OTP hai lớp tùy chọn cho nhân viên; phân công nhân viên theo kho với kiểm tra phạm vi kho ở Inventory, Analytics và AI Service.')
    d.set_text(F('Trợ lý chọn đúng tập công cụ ở 94,1%'),
        'Trợ lý AI (Copilot 3.3) trên tập kiểm thử đóng băng 44 lượt: bước kiểm chứng tất định không còn chặn oan câu trả lời đúng (từ 2 xuống 0 lượt); số câu trả lời cuối có lỗi dao động 13–17/44 giữa các lần chạy nên chưa đủ để khẳng định giảm lỗi có ý nghĩa thống kê. Biểu đồ do trợ lý tạo chọn đúng loại ở 60/61 lượt chạy thật và khớp dữ liệu công cụ ở 1.002/1.002 ô.')
    d.set_text(F('Đánh giá đầu – cuối 30 câu hỏi: tỷ lệ đạt'),
        'Bộ lập kế hoạch ngữ nghĩa (tùy chọn) tăng F1 nhận diện năng lực từ 0,855 lên 0,957 nhưng chưa đạt tiêu chí hiểu ngữ cảnh 0,85 (đạt 0,810) nên được tắt mặc định.')
    p = F('Hợp nhất bằng chứng metadata trên 18 tình huống')
    d.add_after(p, 'bullet', 'Trên dữ liệu hành vi tổng hợp: bộ gợi ý V2 đạt NDCG@10 0,428 so với 0,352 của gợi ý theo độ phổ biến; phân bổ ngân sách cận biên tăng mức đáp ứng nhu cầu 2,9–8,1 điểm phần trăm ở cả 24 lần chạy kiểm định.')

    # ---------------- CHƯƠNG 2 ----------------
    d.set_text(F('Trong hệ thống phân tán, một yêu cầu có thể đi qua nhiều service'),
        'Trong hệ thống phân tán, một yêu cầu có thể đi qua nhiều service nên cần khả năng quan sát (observability) dựa trên ba trụ cột: truy vết phân tán (trace) cho biết yêu cầu đi qua những đâu và tốn bao lâu ở mỗi bước, số đo (metric) phản ánh tình trạng hệ thống theo thời gian, và nhật ký (log) tập trung [28]. OpenTelemetry là chuẩn mở để thu thập trace và metric; Prometheus lưu metric, Loki lưu log, Tempo lưu trace và Grafana hiển thị tập trung. Ở phiên bản hiện tại, SmartBook chỉ áp dụng trụ cột số đo: các service Node.js xuất chỉ số theo chuẩn OpenTelemetry qua bộ xuất Prometheus và AI Service tự cung cấp endpoint /metrics; truy vết phân tán và log tập trung đã được loại khỏi cấu hình để giảm tài nguyên vận hành trên một máy chủ đơn (trình bày ở Chương 6).')
    p = F('JSON Web Token (JWT) là chuẩn biểu diễn')
    d.add_seq(p, [
        ('h3', 'Mã dùng một lần qua email và refresh token'),
        ('body', 'Mật khẩu là yếu tố "điều người dùng biết"; khi mật khẩu bị lộ, kẻ tấn công có thể đăng nhập từ bất kỳ đâu. Mã dùng một lần (One-Time Password – OTP) gửi qua email bổ sung yếu tố "quyền kiểm soát hộp thư": mã ngắn, ngẫu nhiên, chỉ có hiệu lực vài phút và chỉ dùng được một lần. Để an toàn, máy chủ không lưu mã gốc mà chỉ lưu giá trị băm có khóa (HMAC), đồng thời giới hạn số lần nhập sai, thời gian chờ giữa hai lần gửi và số lần gửi trong một khoảng thời gian để chống dò mã và lạm dụng hộp thư. Cùng một cơ chế có thể phục vụ hai mục đích khác nhau: xác minh rằng email đăng ký thuộc về người dùng, và làm lớp xác thực thứ hai sau mật khẩu.'),
        ('body', 'Access token JWT có thời hạn ngắn nên ứng dụng di động cần một refresh token để duy trì phiên mà không bắt người dùng đăng nhập lại. Refresh token là chuỗi ngẫu nhiên không mang thông tin, được lưu dưới dạng băm phía máy chủ và được xoay vòng: mỗi lần dùng, token cũ bị thu hồi và thay bằng token mới thuộc cùng một "họ". Nếu một token đã bị thay thế lại được trình ra, nhiều khả năng token đã bị lộ, nên toàn bộ họ token bị thu hồi.'),
    ])
    p = F('Các hướng dẫn thiết kế tương tác người – AI nhấn mạnh')
    d.add_after(p, 'body', 'Trong hệ hỗ trợ ra quyết định, một câu trả lời đúng về số liệu vẫn có thể dẫn đến quyết định sai nếu người dùng không phân biệt được đâu là dữ kiện và đâu là suy đoán. Vì vậy, hướng AI có khả năng giải thích (Explainable AI – XAI) được đề tài áp dụng ở mức câu trả lời: mỗi nhận định được gắn loại dữ kiện (lấy trực tiếp từ dữ liệu), suy luận (rút ra từ dữ kiện), giả định (điều kiện người dùng đưa ra hoặc hệ thống mặc định) và chưa biết (dữ liệu không đủ để kết luận). Bên cạnh đó, kiểm chứng sau khi sinh tách hai loại lỗi: lỗi có thể đối chiếu chính xác với dữ liệu (con số, kỳ thời gian, thứ hạng) và lỗi ở các nhận định suy luận, để chọn cách xử lý tương xứng thay vì chặn toàn bộ câu trả lời.')
    p = F('Docker Compose: định nghĩa và khởi chạy toàn bộ các container')
    d.add_after(p, 'bullet', '**Caddy, GitHub Actions và GitHub Container Registry (GHCR):** Caddy là máy chủ web đóng vai trò reverse proxy và tự cấp, gia hạn chứng chỉ HTTPS; GitHub Actions chạy kiểm thử, build image Docker gắn nhãn theo commit và triển khai lên VPS; GHCR lưu trữ các image.')
    d.set_text(F('OpenTelemetry, Prometheus, Grafana, Loki, Tempo'),
        '**OpenTelemetry, Prometheus, Grafana:** OpenTelemetry được dùng để xuất chỉ số, Prometheus thu thập và Grafana hiển thị; hai thành phần sau nằm trong profile tùy chọn monitoring [28].')
    d.set_text(F('Expo và React Native: xây dựng ứng dụng di động'),
        '**Expo và React Native:** xây dựng ứng dụng di động đa nền tảng cho nhân viên kho (quét mã vạch, lấy hàng, xếp kệ, kiểm kê) và bạn đọc (tìm sách bằng ảnh bìa, đặt giữ, thanh toán phí phạt); build và phát hành qua Expo Application Services (EAS).')
    t = d.table_after(F('Bảng 2.2 Tổng hợp công nghệ'))
    from sbdoc import text_of
    for i, r in enumerate(d.rows(t)):
        c0 = text_of(r.findall('w:tc', ns)[0])
        if c0.startswith('Ứng dụng di động'):
            d.set_row(t, i, [None, 'Expo SDK 58, React Native 0.88, expo-camera', 'Quét mã vạch, lấy hàng, xếp kệ, kiểm kê; tìm sách bằng ảnh bìa, đặt giữ, thanh toán'])
        elif c0.startswith('Quan sát'):
            d.set_row(t, i, [None, 'OpenTelemetry (chỉ số), Prometheus, Grafana (profile tùy chọn)', 'Chỉ số vận hành và bảng điều khiển'])
        elif c0.startswith('Triển khai'):
            d.set_row(t, i, [None, 'Docker Compose, Caddy, GitHub Actions, GHCR, EAS; Playwright, k6', 'Triển khai tái lập trên máy cá nhân và VPS, CI/CD, phát hành ứng dụng di động; kiểm thử đầu – cuối và kiểm thử tải'])

    # ---------------- CHƯƠNG 3 ----------------
    t = d.table_after(F('Bảng 3.2 Yêu cầu chức năng phân hệ xác thực'))
    d.set_row(t, 1, [None, 'Đăng nhập bằng tên đăng nhập hoặc email; cấp JWT chứa vai trò, quyền; điều hướng theo vai trò; ứng dụng di động nhận thêm refresh token xoay vòng.', None])
    d.set_row(t, 2, [None, 'Bạn đọc tự đăng ký; tài khoản ở trạng thái chờ xác minh cho đến khi nhập đúng mã OTP 6 chữ số gửi qua email; hồ sơ bạn đọc được khởi tạo tự động.', None])
    d.add_row(t, ['FR-54', 'Xác thực hai lớp bằng mã OTP qua email cho nhân viên nội bộ, bật theo cấu hình toàn hệ thống hoặc theo từng tài khoản.', 'Nhân viên nội bộ'])
    d.add_row(t, ['FR-55', 'Phân công nhân viên vào kho với quyền đọc hoặc ghi; mọi truy vấn và thao tác kho bị giới hạn theo phạm vi kho được phân công.', 'Quản trị hệ thống, Quản lý kho'])
    t = d.table_after(F('Bảng 3.5 Yêu cầu chức năng phân hệ trích xuất'))
    d.add_row(t, ['FR-56', 'Nhập sách bằng OCR từ 1–3 ảnh (bìa trước, bìa sau, trang thông tin xuất bản): đọc các trường thư mục kèm bằng chứng, đối chiếu với tra cứu ISBN, gán trạng thái cho từng trường và chỉ đề xuất giá trị vào biểu mẫu chờ duyệt.', 'Quản lý kho'])
    t = d.table_after(F('Bảng 3.6 Yêu cầu chức năng phân hệ hỗ trợ'))
    for i, r in enumerate(d.rows(t)):
        c0 = text_of(r.findall('w:tc', ns)[0]).strip()
        if c0 == 'FR-44':
            d.set_row(t, i, [None, 'Thời gian chờ hàng học từ lịch sử giao hàng, có ghi rõ nguồn; phân bổ theo ngân sách bằng lợi ích phục vụ cận biên, có tính hàng đang về và sách dự kiến được trả; kiểm định lùi độ chính xác dự báo và chính sách nhập hàng.', None])
        elif c0 == 'FR-47':
            d.set_row(t, i, [None, 'Trợ lý AI trả lời câu hỏi tiếng Việt bằng cách lập kế hoạch và gọi 20 công cụ phân tích chỉ đọc với quyền của người hỏi; trả kèm bằng chứng, giải thích, công cụ đã gọi; lưu hội thoại nhiều lượt.', None])
        elif c0 == 'FR-48':
            d.set_row(t, i, [None, 'Kiểm chứng câu trả lời (số liệu, kỳ, xếp hạng, ngân sách, thiếu dữ liệu); sửa an toàn, sinh lại, lược bỏ nhận định sai hoặc chặn câu trả lời; từ chối câu hỏi ngoài phạm vi.', None])
    d.add_row(t, ['FR-57', 'Trực quan hóa kết quả phân tích trong hội thoại bằng biểu đồ đường, cột, miền, tròn, thẻ KPI và bảng; đặc tả biểu đồ được dựng và kiểm tra ở backend từ dữ liệu công cụ.', 'Quản lý kho, Quản trị hệ thống'])
    p = F('Mật khẩu được băm; khóa bí mật và khóa API')
    d.add_after(p, 'bullet', 'Mã OTP chỉ được lưu dưới dạng HMAC-SHA256, có hiệu lực 5 phút, cho phép tối đa 5 lần nhập sai và 10 lần gửi mỗi giờ cho một tài khoản; refresh token chỉ được lưu dưới dạng băm.')
    d.set_text(F('Có điểm kiểm tra sống và sẵn sàng cho từng service'),
        'Có điểm kiểm tra sống và sẵn sàng cho từng service và chỉ số vận hành theo chuẩn Prometheus; môi trường production có kiểm tra sức khỏe định kỳ, sao lưu hằng ngày và tự quay lui khi triển khai lỗi.')
    d.set_text(F('Toàn bộ hệ thống triển khai được bằng Docker Compose; các bí mật'),
        'Toàn bộ hệ thống triển khai được bằng Docker Compose; các bí mật mặc định bị từ chối khi khởi động; ở production chỉ Caddy mở cổng 80 và 443.')
    t = d.table_after(F('Bảng 3.7 Yêu cầu phi chức năng đặc thù'))
    d.add_row(t, ['NFR-AI-07', 'Cờ tính năng', 'Thành phần thử nghiệm (lập kế hoạch ngữ nghĩa, trích nhận định bằng mô hình ngôn ngữ, truy xuất metadata theo trường) chỉ được bật khi đạt tiêu chí đăng ký trước trên tập kiểm thử đóng băng; mặc định tắt.'])
    t = d.table_after(F('Bảng 3.8 Danh sách use case'))
    d.add_row(t, ['UC63', 'Xác thực email bằng mã OTP', 'Khách hàng', 'FR-02'])
    d.add_row(t, ['UC64', 'Đăng nhập hai lớp bằng mã OTP', 'Nhân viên nội bộ', 'FR-54'])
    d.add_row(t, ['UC65', 'Nhập sách bằng OCR nhiều ảnh', 'Quản lý kho', 'FR-56'])
    d.add_row(t, ['UC66', 'Phân công nhân viên theo kho', 'Quản trị hệ thống, Quản lý kho', 'FR-55'])
    d.set_text(F('Bảng 3.8 liệt kê toàn bộ use case'),
        'Bảng 3.8 liệt kê toàn bộ use case của hệ thống cùng tác nhân chính và các yêu cầu chức năng được đáp ứng. Bốn use case UC63–UC66 được bổ sung theo phiên bản hiện tại; luồng xử lý của chúng được mô tả bằng sơ đồ tuần tự ở Chương 4 (đăng ký và đăng nhập có OTP, nhập sách bằng OCR) và ở phần phân quyền theo kho.')
    t = d.table_after(F('Bảng 3.65 Đặc tả use case UC57'))
    for tc in t.iter('{%s}tc' % ns['w']):
        if text_of(tc).startswith('Mở Grafana'):
            d.set_cell(tc, 'Mở Grafana (khi bật profile monitoring ở môi trường phát triển) để xem chỉ số chi tiết theo thời gian.')
    t = d.table_after(F('Bảng 3.10 Đặc tả use case UC02'))
    d.set_row(t, 5, [None, 'Tài khoản vai trò CUSTOMER được tạo ở trạng thái PENDING_VERIFICATION, hồ sơ bạn đọc được khởi tạo, mã OTP được gửi tới email; tài khoản chuyển sang ACTIVE khi mã được xác nhận.'])
    d.set_row(t, 13, [None, None, 'Tạo thử thách OTP (chỉ lưu HMAC của mã 6 chữ số, hết hạn sau 5 phút) và gửi mã tới email.'])
    d.set_row(t, 14, [None, None, 'Hiển thị màn hình nhập mã; khi mã đúng, chuyển tài khoản sang ACTIVE và đưa người dùng tới trang đăng nhập.'])
    set_cell_lines(d, d.cell(t, 15, 1), [
        '• Email hoặc tên đăng nhập đã tồn tại: báo lỗi tại trường tương ứng, yêu cầu nhập lại.',
        '• Người dùng yêu cầu gửi lại mã: hệ thống cấp mã mới sau thời gian chờ 60 giây, tối đa 10 lần gửi mỗi giờ.',
        '• Nhập sai mã: hệ thống báo số lần thử còn lại; sau 5 lần sai hoặc khi mã hết hạn phải yêu cầu mã mới.'])
