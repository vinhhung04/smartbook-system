# -*- coding: utf-8 -*-
"""Content edits part B: chapter 4."""
from sbdoc import ns, text_of
from edits_a import SHOT, DIA


def run(d):
    F = d.find
    # 4.1.1
    d.set_text(F('SmartBook được tổ chức thành bốn lớp như Hình 4.1'),
        'SmartBook được tổ chức thành bốn lớp như Hình 4.1. Lớp trình bày gồm website công khai, ứng dụng web cho nhân viên, cổng bạn đọc, cổng nhà cung cấp và ứng dụng di động. Mọi yêu cầu từ lớp này đi qua API Gateway (ở production, Caddy đứng trước để kết thúc HTTPS). Lớp dịch vụ gồm năm service độc lập: Auth Service quản lý tài khoản, vai trò, quyền, phạm vi kho và mã OTP; Inventory Service quản lý danh mục sách, kho, mua hàng, nhận hàng, xuất kho và đối soát metadata; Borrow Service quản lý bạn đọc, hội viên, đặt giữ, mượn trả, phí phạt, thanh toán VNPay và thông báo; Analytics Service tính toán báo cáo, dự báo, đề xuất nhập hàng và mô hình rủi ro; AI Service cung cấp Trợ lý AI (Copilot), trích xuất thông tin sách (tra cứu ISBN, OCR nhiều ảnh), tìm sách bằng ảnh bìa, gợi ý sách và các hành động chờ xác nhận. Lớp dữ liệu gồm một máy chủ PostgreSQL 15 có tiện ích pgvector chứa bốn cơ sở dữ liệu tách biệt, Redis cho danh sách token bị thu hồi, refresh token của ứng dụng di động và bộ nhớ đệm, RabbitMQ cho sự kiện tích hợp. Cuối cùng là các dịch vụ bên ngoài: OpenRouter cung cấp mô hình Qwen, các nguồn metadata sách, máy chủ SMTP gửi mã OTP và cổng VNPay ở chế độ sandbox.')
    d.replace_image('Hình 4.1 Kiến trúc tổng thể', DIA + 'architecture/architecture-system-overview.png', 15.5)
    d.set_text(F('Mỗi service sở hữu riêng cơ sở dữ liệu của mình'),
        'Mỗi service sở hữu riêng cơ sở dữ liệu của mình và không ghi vào cơ sở dữ liệu của service khác. Ngoại lệ duy nhất là Analytics Service được cấp kết nối chỉ đọc tới inventory_db và borrow_db để tính toán số liệu tổng hợp mà không làm tăng tải cho các service nghiệp vụ. AI Service không truy cập trực tiếp cơ sở dữ liệu nghiệp vụ: số liệu phân tích được lấy qua API Gateway bằng chính JWT của người dùng, còn danh mục sách dùng cho chỉ mục tìm kiếm được đồng bộ định kỳ (mặc định 300 giây) qua endpoint nội bộ của Inventory Service có xác thực bằng khóa dịch vụ.')
    t = d.table_after(F('Bảng 4.2 Các điểm tích hợp'))
    d.add_row(t, ['AI', 'Inventory', 'HTTP nội bộ (khóa dịch vụ)', 'Đồng bộ danh mục sách cho chỉ mục tìm kiếm (/internal/catalog/books)'])
    d.add_row(t, ['Inventory, Analytics, AI', 'Auth', 'HTTP nội bộ (khóa dịch vụ)', 'Đọc phạm vi kho của người dùng để lọc dữ liệu và kiểm tra quyền thao tác'])
    # 4.1.4 deployment
    d.set_text(F('Toàn bộ hệ thống được đóng gói thành các container'),
        'Hệ thống có hai cấu hình triển khai dùng chung mã nguồn của các service. Ở máy cá nhân, tệp docker-compose.yml build và chạy toàn bộ container, mở cổng 5173 cho ứng dụng web (nginx phục vụ bản build tĩnh) và 3000 cho API Gateway; AI Service (profile ai), Prometheus và Grafana (profile monitoring), pgAdmin và k6 là các thành phần tùy chọn. Ở production (Hình 4.2), tệp compose.prod.yml chạy trên một VPS Ubuntu 24.04 (6 vCPU, khoảng 12 GB RAM) với tên miền smartbook.io.vn cho web và api.smartbook.io.vn cho API: không image nào được build trên máy chủ, mọi image do GitHub Actions build, đẩy lên GHCR và được ghim theo commit SHA. Chỉ Caddy mở cổng 80 và 443, tự cấp và gia hạn chứng chỉ Let\'s Encrypt. Các container được chia vào ba mạng: edge (Caddy, web, API Gateway), app (các service, có đường ra Internet để gọi OpenRouter, SMTP và nguồn metadata) và data (PostgreSQL, Redis, RabbitMQ) là mạng nội bộ không có đường ra Internet và không thể truy cập từ Caddy. Mỗi container có kiểm tra sức khỏe và giới hạn CPU, bộ nhớ (ví dụ PostgreSQL 2 GB, AI Service 3 GB vì chạy CLIP trên CPU và trình duyệt không giao diện cho tra cứu nhà sách). Dữ liệu bền vững được lưu trong các volume postgres_data, redis_data, rabbitmq_data, packing_evidence_data (ảnh và video đóng gói), bộ nhớ đệm mô hình AI và dữ liệu chứng chỉ của Caddy.')
    cap = d.replace_image('Hình 4.2 Sơ đồ triển khai', DIA + 'architecture/deployment-production.png', 15.5)
    d.set_text(cap, 'Hình 4.2 Sơ đồ triển khai production trên VPS bằng Docker Compose')
    # 4.2.1 authentication
    p = d.set_text(F('Người dùng đăng nhập bằng tên đăng nhập hoặc email và mật khẩu. Auth Service'),
        'Người dùng đăng nhập bằng tên đăng nhập hoặc email và mật khẩu (Hình 4.5). Auth Service so khớp mật khẩu đã băm bằng bcrypt, kiểm tra trạng thái tài khoản và cấp JWT ký bằng HS256, thời hạn mặc định 2 giờ. Payload của token chứa mã người dùng, tên đăng nhập, email, trạng thái, cờ quản trị tối cao, danh sách vai trò, danh sách quyền và mã token (jti). Mỗi service tự xác minh chữ ký token bằng khóa bí mật dùng chung và kiểm tra thêm hai khóa trong Redis: danh sách token đã thu hồi theo jti (khi đăng xuất) và mốc thời gian token hợp lệ của từng người dùng (khi đổi mật khẩu, bị khóa hoặc đổi vai trò). Nhờ đó, việc khóa tài khoản có hiệu lực ngay ở mọi service mà không phải chờ token hết hạn. Đăng nhập bị giới hạn 10 lần trong 15 phút cho mỗi địa chỉ IP; tài khoản bị khóa sau 5 lần nhập sai mật khẩu liên tiếp.')
    d.add_seq(p, [
        ('body', 'Phiên bản hiện tại bổ sung ba cơ chế xác thực. Thứ nhất, xác minh email khi đăng ký (Hình {FIG:reg}): tài khoản mới ở trạng thái PENDING_VERIFICATION; Auth Service sinh mã 6 chữ số ngẫu nhiên và chỉ lưu HMAC-SHA256 của mã (khóa OTP_HMAC_SECRET, bắt buộc ở production) trong bảng email_otp_challenges. Mã hết hạn sau 5 phút, cho phép tối đa 5 lần nhập sai, phải chờ 60 giây giữa hai lần gửi và tối đa 10 lần gửi mỗi giờ; mỗi tài khoản và mục đích chỉ có một thử thách còn hiệu lực. Mọi thay đổi trạng thái của thử thách là một câu lệnh UPDATE có điều kiện nên vẫn đúng khi có yêu cầu đồng thời. Người dùng nhập đúng mật khẩu nhưng chưa xác minh email sẽ nhận một thử thách thay vì phiên đăng nhập. Cơ chế này mặc định bật (REGISTRATION_EMAIL_VERIFICATION=required).'),
        ('body', 'Thứ hai, OTP hai lớp khi đăng nhập: sau khi mật khẩu đúng, nếu tài khoản bật email_otp_2fa_enabled hoặc cấu hình STAFF_EMAIL_OTP_MODE=required áp dụng cho nhân viên nội bộ, Auth Service chỉ trả mã 202 kèm thử thách và chưa cấp bất kỳ token nào; token chỉ được cấp sau khi /auth/login/verify-otp xác nhận mã. Ở cả môi trường phát triển và production, STAFF_EMAIL_OTP_MODE hiện mặc định là off, nghĩa là OTP hai lớp đã được hiện thực và kiểm thử đơn vị nhưng chưa được bật khi vận hành.'),
        ('body', 'Thứ ba, refresh token cho ứng dụng di động: khi client gửi client = mobile, Auth Service cấp thêm một refresh token ngẫu nhiên 32 byte, chỉ lưu SHA-256 của token trong Redis với thời hạn 30 ngày. Mỗi lần làm mới, token cũ bị tiêu thụ nguyên tử và được thay bằng token mới trong cùng họ; trình ra một token đã bị thay thế sẽ thu hồi toàn bộ họ token. Họ token còn ghi nhận phiên đã qua OTP hay chưa, để không thể dùng refresh token vượt qua yêu cầu xác thực hai lớp. Ứng dụng web vẫn chỉ dùng access token.'),
    ])
    # 4.2.2 permissions & warehouse scope
    d.set_text(F('Hệ thống định nghĩa 66 quyền chi tiết'),
        'Hệ thống định nghĩa 65 quyền chi tiết dạng module.tài_nguyên.hành_động trong dữ liệu khởi tạo (cơ sở dữ liệu của môi trường phát triển hiện có 64 quyền do chưa chạy lại dữ liệu khởi tạo sau lần bổ sung quyền gần nhất) và sáu vai trò. Mỗi tuyến API được gắn middleware kiểm tra quyền hoặc vai trò, nên việc ẩn chức năng trên giao diện chỉ là lớp bảo vệ thứ nhất; một yêu cầu gửi thẳng tới API mà thiếu quyền vẫn bị từ chối với mã 403. Bảng 4.3 tóm tắt phạm vi quyền của từng vai trò theo dữ liệu khởi tạo.')
    t = d.table_after(F('Bảng 4.3 Phạm vi quyền'))
    d.set_row(t, 1, [None, '65', None])
    d.set_text(F('Một số quy tắc được kiểm tra ở tầng nghiệp vụ chứ không chỉ'),
        'Một số quy tắc được kiểm tra ở tầng nghiệp vụ chứ không chỉ ở tầng quyền: nhân viên kho chỉ thao tác trên công việc được giao cho mình; chỉ quản lý kho được ghi sổ phiếu nhập và tạo phiếu nhập từ hóa đơn giao hàng; bạn đọc chỉ xem được phiếu của chính mình. Phạm vi kho của nhân viên được lưu trong bảng user_warehouse_scopes của auth_db với quyền đọc hoặc ghi theo từng kho; quản trị viên và quản lý kho phân công nhân viên qua API /iam/users/:id/warehouse-scopes. Inventory, Analytics và AI Service đọc phạm vi qua endpoint nội bộ của Auth Service (có bộ nhớ đệm) và áp dụng nguyên tắc từ chối khi lỗi: người dùng không có phạm vi không thấy kho nào, khi không đọc được phạm vi thì yêu cầu bị trả mã 503 thay vì mặc định cho phép mọi kho; chỉ tài khoản quản trị tối cao (cờ đã ký trong JWT) thấy mọi kho. Ở Inventory Service, mọi mã kho mà client gửi lên (trong đường dẫn, tham số hoặc thân yêu cầu) đều được kiểm tra quyền đọc hoặc ghi; thao tác trên một bản ghi (nhận việc, giao việc, xác nhận) lấy mã kho từ chính bản ghi và đọc lại phạm vi không qua bộ nhớ đệm; người được giao việc phải là nhân viên kho đang hoạt động và có quyền ghi ở kho đó. Ba nhóm đường dẫn được loại trừ có chủ đích: tích hợp lưu thông (/api/borrow-integration, do Borrow Service gọi cho bạn đọc ở mọi chi nhánh), danh mục sách (/api/books) và cổng nhà cung cấp (/api/supplier-account).')
    d.set_text(F('Trợ lý phân tích chỉ mở cho vai trò ADMIN'),
        'Trợ lý phân tích chỉ mở cho vai trò ADMIN và WAREHOUSE_MANAGER, và toàn bộ 20 công cụ của trợ lý đều chỉ đọc dữ liệu. Khi trợ lý gọi công cụ, AI Service chuyển tiếp nguyên JWT của người hỏi tới API Gateway, vì vậy mô hình ngôn ngữ không bao giờ có nhiều quyền hơn người dùng: một quản lý kho không có quyền xem phân tích lưu thông thì công cụ tương ứng cũng nhận mã 403, và các công cụ theo kho chỉ trả về những kho trong phạm vi của người hỏi. Hành động do AI đề xuất được kiểm tra hai lần: khi tạo, dựa trên danh sách vai trò cho phép của từng loại hành động; khi xác nhận, AI Service gọi /auth/me để lấy vai trò và quyền hiện tại của người xác nhận. Mười loại thao tác nguy hiểm như xóa sách, xóa người dùng, đổi vai trò, sửa tồn kho trực tiếp, thu phí phạt, duyệt đơn mua, ghi sổ phiếu nhập hay chạy SQL thô nằm trong danh sách cấm và không bao giờ được tạo thành hành động.')
    # 4.4 interaction
    cap = d.replace_image('Hình 4.5 Sơ đồ tuần tự đăng nhập', DIA + 'sequence/auth-login-email-otp.png', 15.5)
    d.set_text(cap, 'Hình 4.5 Sơ đồ tuần tự đăng nhập, OTP hai lớp và kiểm tra quyền')
    d.set_text(F('Hình 4.5 mô tả luồng đăng nhập'),
        'Hình 4.5 mô tả luồng đăng nhập, nhánh OTP hai lớp (chỉ xảy ra khi tài khoản hoặc cấu hình yêu cầu) và cách mọi yêu cầu sau đó được kiểm tra quyền tại service đích.')
    d.add_seq(cap, [
        ('h3', 'Đăng ký tài khoản và xác thực email bằng OTP'),
        ('body', 'Hình {FIG:reg} mô tả luồng đăng ký của bạn đọc. Auth Service tạo tài khoản ở trạng thái chờ xác minh, gửi mã OTP qua email và chỉ kích hoạt tài khoản khi mã đúng; bước xác thực không cấp phiên đăng nhập, người dùng đăng nhập lại sau khi tài khoản được kích hoạt. Nếu gửi email thất bại, hệ thống vẫn tạo tài khoản và cho phép yêu cầu gửi lại mã ngay.'),
        ('image', DIA + 'sequence/auth-register-email-otp.png', 15.5),
        ('capfig', 'Hình {FIG:reg} Sơ đồ tuần tự đăng ký tài khoản và xác thực email bằng OTP'),
    ])
    p = F('Thanh toán phí phạt qua VNPay')  # heading in 4.4 (first occurrence)
    d.add_after(p, 'body', 'Bạn đọc thanh toán phí phạt trực tuyến qua cổng VNPay ở chế độ sandbox. Borrow Service kiểm tra khoản phạt thuộc về bạn đọc và còn dư nợ, từ chối tạo liên kết mới khi khoản phạt đang có một giao dịch chờ xác nhận, rồi tạo bản ghi fine_payment_intents (trạng thái PENDING, có thời hạn) với mã giao dịch duy nhất và trả về đường dẫn thanh toán đã ký HMAC-SHA512. Sau khi thanh toán, VNPay gọi lại hai endpoint /webhooks/vnpay/return (trình duyệt quay về) và /webhooks/vnpay/ipn (máy chủ VNPay thông báo); cả hai đều xác minh chữ ký rồi gọi chung một hàm hoàn tất. Hàm này chạy trong một giao dịch: chiếm quyền xử lý bằng câu lệnh UPDATE có điều kiện trạng thái PENDING nên hai lời gọi đồng thời không ghi nhận trùng; kiểm tra số tiền khớp với ý định thanh toán; nếu khoản phạt đã được thanh toán bằng cách khác trong lúc chờ thì đánh dấu thất bại thay vì để dư nợ âm; nếu hợp lệ thì tạo bản ghi fine_payments, cập nhật trạng thái khoản phạt, số dư của bạn đọc, thông báo và nhật ký kiểm toán.')
    cap = F('Hình 4.13 Sơ đồ tuần tự biên mục')
    d.add_seq(cap, [
        ('h3', 'Nhập sách bằng OCR nhiều ảnh'),
        ('body', 'Hình {FIG:ocr} mô tả luồng nhập sách từ ảnh chụp. Trình duyệt thu nhỏ ảnh, băm nội dung để gắn kết quả đúng bộ ảnh và đọc mã vạch EAN-13 ở bìa sau; AI Service kiểm tra quyền tạo bản nháp danh mục trước khi gọi mô hình (nên yêu cầu không có quyền không tốn chi phí suy luận), gửi cả ba ảnh trong một lời gọi, kiểm tra từng giá trị rồi đối chiếu với kết quả tra cứu ISBN. Kết quả chỉ là đề xuất cho biểu mẫu; việc lưu sách vẫn đi qua bản nháp đối soát, kiểm tra trùng lặp và bước duyệt như Hình 4.13.'),
        ('image', DIA + 'sequence/ai-book-ocr-multi-image.png', 15.5),
        ('capfig', 'Hình {FIG:ocr} Sơ đồ tuần tự nhập sách bằng OCR nhiều ảnh'),
    ])
    cap = d.replace_image('Hình 4.15 Sơ đồ tuần tự đề xuất nhập hàng', DIA + 'sequence/analytics-reorder-budget.png', 15.5)
    d.set_text(cap, 'Hình 4.15 Sơ đồ tuần tự đề xuất nhập hàng và phân bổ ngân sách')
    d.set_text(F('Hình 4.15 mô tả cách Analytics Service tổng hợp'),
        'Hình 4.15 mô tả cách Analytics Service tổng hợp dữ liệu chỉ đọc từ hai cơ sở dữ liệu, trong phạm vi kho của người dùng, để tạo đề xuất nhập hàng; khi người dùng nhập ngân sách, service tính thêm vị thế tồn kho (hàng đang về, sách dự kiến được trả) và cấp vốn theo từng bản. Chi tiết thuật toán được trình bày ở Chương 5.')
    cap = d.replace_image('Hình 4.16 Sơ đồ tuần tự trợ lý', DIA + 'sequence/ai-copilot-query-verification.png', 15.5)
    d.set_text(cap, 'Hình 4.16 Sơ đồ tuần tự Trợ lý AI: kế hoạch, công cụ, bằng chứng và kiểm chứng')
    d.set_text(F('Hình 4.16 mô tả vòng lặp gọi công cụ'),
        'Hình 4.16 mô tả một lượt hỏi đáp với Trợ lý AI (Copilot). Bộ lập kế hoạch dựa trên luật xác định năng lực, kỳ, kho, ngân sách và chọn công cụ; các công cụ được gọi song song qua API Gateway bằng JWT của người dùng; câu trả lời được sinh từ bảng bằng chứng kèm đặc tả biểu đồ, rồi đi qua bước kiểm chứng trước khi được trả về dạng luồng (SSE). Các bước dùng mô hình ngôn ngữ để đọc nghĩa câu hỏi hoặc trích nhận định đều nằm sau cờ cấu hình và đang tắt mặc định.')
    # 4.5 database
    t = d.table_after(F('Bảng 4.4 Các cơ sở dữ liệu'))
    d.set_row(t, 1, [None, None, '13', 'Người dùng, vai trò, quyền, phạm vi kho, token làm mới, token đặt lại mật khẩu, thử thách OTP qua email, nhật ký xác thực, outbox/inbox'])
    cap = d.replace_image('Hình 4.20 ERD auth_db', DIA + 'erd/auth-service-iam.png', 15.5)
    d.set_text(cap, 'Hình 4.20 ERD auth_db – tài khoản, vai trò, quyền, phạm vi kho, token và OTP')
    # 4.6 UI
    d.set_text(F('Giao diện web dùng một hệ thống thành phần thống nhất'),
        'Giao diện web dùng một hệ thống thành phần thống nhất (React, Tailwind CSS, Radix UI) với bố cục gồm thanh điều hướng bên trái được nhóm theo nghiệp vụ và chỉ hiện các mục người dùng có quyền, thanh tiêu đề có ô tìm màn hình, chuyển ngôn ngữ, chế độ tối và chuông thông báo thời gian thực. Các chức năng AI luôn hiển thị nguồn dữ liệu, độ tin cậy và trạng thái chờ duyệt; thao tác thay đổi dữ liệu luôn có bước xác nhận. Giao diện đã được thiết kế lại trong tháng 10/2026 theo một bộ nhận diện thống nhất (logo, màu, kiểu chữ). Các hình trong phần này được chụp ngày 06/11/2026 từ mã nguồn hiện tại chạy trên máy cá nhân với dữ liệu mẫu, ở độ rộng 1440 px; ảnh di động được chụp từ bản web của ứng dụng Expo ở độ rộng 390 px.')
    p = F('Giao diện web dùng một hệ thống thành phần thống nhất')
    d.add_seq(p, [
        ('h3', 'Đăng nhập, đăng ký và xác thực OTP'),
        ('body', 'Trang đăng nhập của nhân viên (Hình {FIG:ui_login}) và trang đăng ký của bạn đọc dùng chung các thành phần xác thực. Sau khi đăng ký, bạn đọc được chuyển sang bước nhập mã 6 chữ số (Hình {FIG:ui_otp}) với đồng hồ hiệu lực của mã và thời gian chờ gửi lại; cùng thành phần này được dùng cho bước OTP hai lớp khi đăng nhập. Ảnh Hình {FIG:ui_otp} được chụp với phản hồi của API đăng ký được giả lập trong trình duyệt, để không gửi email thật từ môi trường phát triển; giao diện và nội dung hiển thị là của ứng dụng thật.'),
        ('image', SHOT + 'web-staff-login.png', 15.5),
        ('capfig', 'Hình {FIG:ui_login} Trang đăng nhập dành cho nhân viên'),
        ('image', SHOT + 'web-customer-register-otp.png', 15.5),
        ('capfig', 'Hình {FIG:ui_otp} Bước xác thực email bằng mã OTP sau khi đăng ký'),
    ])
    rep = [
        ('Hình 4.34 Trang chủ', 'web-public-home.png', None),
        ('Hình 4.35 Trang chi tiết sách', 'web-public-book-detail.png', None),
        ('Hình 4.36 Trang tổng quan của cổng', 'web-customer-portal.png', None),
        ('Hình 4.37 Tìm sách bằng ảnh bìa', 'web-customer-scan-cover.png', None),
        ('Hình 4.38 Gợi ý sách', 'web-customer-recommendations.png', None),
        ('Hình 4.39 Màn hình tổng quan mượn trả', 'web-borrow-overview.png', None),
        ('Hình 4.40 Danh sách phiếu đặt giữ', 'web-borrow-reservations.png', None),
        ('Hình 4.41 Bảng điều khiển', 'web-admin-dashboard.png', 'Hình 4.41 Bảng điều khiển tổng quan của quản lý'),
        ('Hình 4.42 Danh sách đơn đặt hàng', 'web-purchase-orders.png', None),
        ('Hình 4.43 Màn hình nhận và cất hàng', 'web-putaway.png', 'Hình 4.43 Màn hình cất hàng lên kệ'),
        ('Hình 4.44 Màn hình đóng gói', 'web-packing.png', None),
        ('Hình 4.45 Màn hình nhập sách qua AI', 'web-ai-import-ocr.png', 'Hình 4.45 Màn hình nhập sách qua AI với kết quả đọc ảnh'),
        ('Hình 4.46 Màn hình đề xuất nhập hàng', 'web-reorder-suggestions.png', None),
        ('Hình 4.47 Màn hình trợ lý AI', 'web-ai-assistant-chart-full.png', 'Hình 4.47 Màn hình Trợ lý AI trả lời bằng biểu đồ và bằng chứng'),
        ('Hình 4.48 Quản lý vai trò', 'web-admin-roles.png', None),
        ('Hình 4.49 Giám sát tình trạng', 'web-admin-monitor.png', None),
    ]
    for cap_prefix, img, newcap in rep:
        cap = d.replace_image(cap_prefix, SHOT + img, 15.5)
        if newcap:
            d.set_text(cap, newcap)
    d.set_text(F('Cổng bạn đọc (Hình 4.36) tổng hợp'),
        'Cổng bạn đọc (Hình 4.36) tổng hợp sách đang mượn, phiếu đặt giữ, phí phạt và quyền lợi hội viên. Chức năng tìm sách bằng ảnh bìa (Hình 4.37) cho phép chụp hoặc tải ảnh bìa; kết quả trả về nhan đề, tác giả đọc được trên bìa và các sách khớp kèm phần trăm độ khớp. Trang gợi ý (Hình 4.38) hiển thị sách đề xuất kèm lý do và khả năng đặt trước.')
    cap = F('Hình 4.44 Màn hình đóng gói')
    d.add_seq(cap, [
        ('body', 'Nhân viên kho có các màn hình tự phục vụ: Công việc kho của tôi (Hình {FIG:ui_tasks}) gom việc cần làm, đang làm và chờ duyệt từ nhận hàng, cất hàng, lấy hàng, xuất kho, chuyển kho và kiểm kê, chỉ trong các kho được phân công; Yêu cầu mua hàng của tôi và Báo cáo sự cố của tôi theo dõi các đề xuất mà nhân viên đã gửi. Quản lý kho dùng màn hình Giao việc nhân viên (Hình {FIG:ui_assign}) để giao việc cho nhân viên có quyền ghi ở kho tương ứng.'),
        ('image', SHOT + 'web-my-warehouse-tasks.png', 15.5),
        ('capfig', 'Hình {FIG:ui_tasks} Màn hình Công việc kho của tôi'),
        ('image', SHOT + 'web-staff-tasks.png', 15.5),
        ('capfig', 'Hình {FIG:ui_assign} Màn hình giao việc cho nhân viên kho'),
    ])
    d.set_text(F('Màn hình nhập sách qua AI (Hình 4.45)'),
        'Màn hình nhập sách qua AI (Hình 4.45) cho phép tra cứu theo ISBN hoặc tải 1–3 ảnh của cuốn sách. Ảnh trong hình là hai ảnh thử nghiệm do nhóm tự tạo (bìa trước và trang thông tin xuất bản của một sách đã có trong danh mục mẫu) và được AI Service xử lý thật: hệ thống tự điền 7 trường an toàn, còn 3 trường cần người duyệt quyết định (trong đó 2 trường xung đột giữa ảnh và nguồn tra cứu), và khóa nút Lưu cho tới khi người duyệt xử lý trùng lặp, chuẩn hóa thực thể và các trường còn lại. Màn hình đề xuất và cảnh báo rủi ro (Hình 4.46) hiển thị danh sách sách nên nhập kèm nhu cầu, dự báo 30 ngày, số ngày dự kiến hết hàng, số lượng, chi phí và khung kế hoạch ngân sách. Trợ lý AI (Hình 4.47) gồm lịch sử hội thoại, câu trả lời xen kẽ văn bản và biểu đồ, ghi chú kỳ chưa trọn, nguồn dữ liệu, bằng chứng số liệu, trạng thái kiểm chứng và Trung tâm hành động AI để xác nhận hoặc hủy các hành động chờ.')
    cap = F('Hình 4.49 Giám sát tình trạng')
    d.add_seq(cap, [
        ('h3', 'Ứng dụng di động'),
        ('body', 'Ứng dụng di động dùng chung tài khoản với ứng dụng web và tự chọn nhóm màn hình theo vai trò. Với bạn đọc (Hình {FIG:ui_mcust}), màn hình khám phá có ô tìm kiếm, nút chụp ảnh bìa, lối vào trợ lý tìm sách và gợi ý cá nhân hóa; Sách của tôi theo dõi phiếu mượn, đặt trước; Ví và phí hiển thị khoản phạt và lịch sử thanh toán VNPay. Với nhân viên kho (Hình {FIG:ui_mstaff}), màn hình chính tóm tắt ca làm việc, việc tiếp theo và nút quét mã; Việc của tôi và các màn hình nghiệp vụ (lấy hàng, cất hàng, xuất kho, kiểm kê) dùng camera để quét mã. Các ảnh được chụp từ bản web của ứng dụng Expo, không phải từ điện thoại thật; ứng dụng chưa được kiểm chứng trên thiết bị thật.'),
        ('image', SHOT + 'mobile-customer-montage.png', 15.5),
        ('capfig', 'Hình {FIG:ui_mcust} Ứng dụng di động – các màn hình của bạn đọc'),
        ('image', SHOT + 'mobile-staff-montage.png', 15.5),
        ('capfig', 'Hình {FIG:ui_mstaff} Ứng dụng di động – các màn hình của nhân viên kho'),
    ])
