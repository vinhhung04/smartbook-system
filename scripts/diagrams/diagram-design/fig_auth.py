import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from seqauto import SeqDiagram

OUT = pathlib.Path(sys.argv[1])  # docs/diagrams/designed/sequence
U = ("U", "Người dùng", "staff · bạn đọc", "input")
B = ("U", "Bạn đọc", "CUSTOMER", "input")
W = ("W", "Web App", "React · apps/web")
G = ("G", "API Gateway", "api-gateway")
A = ("A", "Auth Service", "auth-service")
DB = ("DB", "PostgreSQL", "auth_db", "store")
R = ("R", "Redis", "redis:7", "store")
M = ("M", "Máy chủ SMTP", "email", "external")
XS6 = [92, 220, 348, 484, 596, 708]   # U W G A (M|R) DB — the rarely used store sits between A and DB
SRC_L = "docs/diagrams/source/sequence/auth-login-email-otp.mmd"
SRC_R = "docs/diagrams/source/sequence/auth-register-email-otp.mmd"


def note(src, steps, extra=""):
    return f'<p class="note">Nguồn: <code>{src}</code>, bước {steps}.{(" " + extra) if extra else ""}</p>'


# ================================================================ Hình 4.5 — đăng nhập
SeqDiagram("auth-login-email-otp-dd-p1", [U, W, G, A, DB], [
    ("msg", "U", "W", "1. Nhập tên đăng nhập/email và mật khẩu", "call"),
    ("msg", "W", "G", "2. POST /auth/login\n`{identifier, password}`", "link"),
    ("msg", "G", "A", "3. Chuyển tiếp yêu cầu (proxy /auth)", "link"),
    ("note", "A", "Kiểm tra giới hạn tần suất\n(10 lần / 15 phút / IP)"),
    ("msg", "A", "DB", "4. Tìm user theo username hoặc email (chưa bị xóa)", "call"),
    ("msg", "DB", "A", "5. Bản ghi user", "return"),
    ("frame", "break", "[Không tìm thấy user hoặc sai mật khẩu]"),
    ("msg", "A", "DB", "6. Tăng\n`failed_login_attempts`\n(khi user tồn tại)", "call"),
    ("msg", "A", "G", "7. 401 Invalid credentials (403 và khóa tài khoản khi vượt ngưỡng)", "return"),
    ("msg", "G", "W", "8. 401 / 403", "return"),
    ("msg", "W", "U", "9. Hiển thị thông báo lỗi", "return"),
    ("end",),
    ("note", ("A", "DB"), "Mật khẩu đúng (bcrypt.compare).\n`PENDING_VERIFICATION → 202`\n`EMAIL_VERIFICATION_REQUIRED`\nstatus khác ACTIVE → 403 (không vẽ chi tiết)"),
    ("msg", "A", "DB", "10. Lấy roles và permissions của user", "call"),
    ("msg", "DB", "A", "11. roles, permissions", "return"),
    ("note", ("G", "A"), "Cần OTP → Phần 2 · Không cần OTP → Phần 3, bước 27"),
], title="Đăng nhập Web, phần 1: kiểm tra mật khẩu",
   desc="Người dùng gửi tên đăng nhập và mật khẩu qua API Gateway; Auth Service giới hạn tần suất, tìm user, xử lý sai mật khẩu bằng 401/403 và lấy vai trò, quyền khi mật khẩu đúng.").write(
    OUT / "auth-login-email-otp-dd-p1.html", "Đăng nhập Web có OTP qua email (1/3): kiểm tra mật khẩu", note(SRC_L, "1–11"))

SeqDiagram("auth-login-email-otp-dd-p2", [U, W, G, A, M, DB], [
    ("frame", "opt", "[Cần OTP]"),
    ("note", ("W", "A"), "email_otp_2fa_enabled, hoặc STAFF_EMAIL_OTP_MODE=required\nvới nhân viên nội bộ (mặc định off)"),
    ("msg", "A", "DB", "12. Tạo EmailOtpChallenge (chỉ lưu HMAC của mã)", "call"),
    ("msg", "A", "M", "13. Gửi email chứa mã OTP 6 chữ số", "link"),
    ("msg", "A", "G", "14. 202 OTP_REQUIRED\n`{challenge}`", "return"),
    ("msg", "G", "W", "15. 202 {challenge}", "return"),
    ("msg", "W", "U", "16. Hiển thị màn hình nhập mã", "return"),
    ("msg", "U", "W", "17. Nhập mã OTP", "call"),
    ("msg", "W", "G", "18. POST\n`/auth/login/verify-otp`\n`{challenge_id, code}`", "link"),
    ("msg", "G", "A", "19. Chuyển tiếp yêu cầu", "link"),
    ("msg", "A", "DB", "20. Giữ một lượt thử, so khớp HMAC, đánh dấu đã dùng", "call"),
    ("frame", "break", "[Mã sai, hết hạn hoặc vượt số lần thử]"),
    ("msg", "A", "G", "21. Trả lỗi", "return"),
    ("note", ("G", "A"), "`400 OTP_INVALID / 410 OTP_EXPIRED /`\n`429 OTP_TOO_MANY_ATTEMPTS`"),
    ("msg", "G", "W", "22. Lỗi kèm\n`attempts_remaining`", "return"),
    ("msg", "W", "U", "23. Báo lỗi, cho nhập lại hoặc gửi lại mã", "return"),
    ("end",),
    ("note", ("G", "A"), "Tiếp tục ở Phần 3 (bước 24–26)"),
    ("end",),
], box_w=104, xs=XS6, title="Đăng nhập Web, phần 2: gửi và nhập mã OTP",
   desc="Khi cần OTP, Auth Service tạo thử thách chỉ lưu HMAC của mã, gửi email mã 6 chữ số, nhận mã người dùng nhập và trả lỗi 400/410/429 khi mã sai, hết hạn hoặc vượt số lần thử.").write(
    OUT / "auth-login-email-otp-dd-p2.html", "Đăng nhập Web có OTP qua email (2/3): gửi và nhập mã", note(SRC_L, "12–23"))

SeqDiagram("auth-login-email-otp-dd-p3", [U, W, G, A, R, DB], [
    ("frame", "opt", "[Cần OTP] (tiếp)"),
    ("msg", "A", "DB", "24. Đọc lại user (phải còn ACTIVE)", "call"),
    ("msg", "A", "R", "25. Đọc mốc thu hồi token", "call"),
    ("note", ("A", "DB"), "`(user:tokens-valid-after)`"),
    ("msg", "A", "DB", "26. Lấy lại roles và permissions", "call"),
    ("end",),
    ("note", "A", "Ký JWT access token"),
    ("msg", "A", "G", "27. 200 AUTHENTICATED\n`{token, user}`", "accent"),
    ("msg", "G", "W", "28. 200 {token, user}", "return"),
    ("note", "W", "Lưu token vào localStorage"),
    ("msg", "W", "U", "29. Vào trang làm việc", "return"),
], box_w=104, xs=XS6, title="Đăng nhập Web, phần 3: cấp phiên",
   desc="Sau khi mã OTP đúng, Auth Service đọc lại user, mốc thu hồi token trên Redis và quyền; trong mọi trường hợp đăng nhập thành công, Auth Service ký JWT và Web App lưu token.").write(
    OUT / "auth-login-email-otp-dd-p3.html", "Đăng nhập Web có OTP qua email (3/3): cấp phiên", note(SRC_L, "24–29"))

# ================================================================ Hình 4.6 — đăng ký
SeqDiagram("auth-register-email-otp-dd-p1", [B, W, G, A, M, DB], [
    ("msg", "U", "W", "1. Nhập họ tên, email, tên đăng nhập, mật khẩu", "call"),
    ("msg", "W", "G", "2. POST /auth/register", "link"),
    ("msg", "G", "A", "3. Chuyển tiếp (proxy /auth)", "link"),
    ("note", "A", "Giới hạn tần suất, kiểm tra dữ liệu,\ntrùng username/email"),
    ("msg", "A", "DB", "4. Tạo users (status = PENDING_VERIFICATION), gán vai trò CUSTOMER", "call"),
    ("msg", "A", "DB", "5. Tạo email_otp_challenges (chỉ lưu HMAC-SHA256 của mã, hết hạn sau 5 phút)", "call"),
    ("msg", "A", "M", "6. Gửi email chứa mã 6 chữ số", "link"),
    ("frame", "alt", "[Gửi email thất bại]"),
    ("msg", "A", "G", "7. 201\n`VERIFICATION_REQUIRED,`\n`email_delivery = FAILED`", "return"),
    ("msg", "G", "W", "8. 201 {challenge}", "return"),
    ("msg", "W", "U", "9. Cho phép gửi lại mã ngay", "return"),
    ("else", "[Gửi thành công]"),
    ("msg", "A", "G", "10. 201\n`VERIFICATION_REQUIRED`\n`{challenge}`", "accent"),
    ("msg", "G", "W", "11. 201", "return"),
    ("note", ("W", "G"), "`{challenge: masked_email, code_length, expires_at}`"),
    ("msg", "W", "U", "12. Hiển thị màn hình nhập mã", "return"),
    ("end",),
], box_w=104, xs=XS6, title="Đăng ký tài khoản, phần 1: tạo tài khoản và gửi mã",
   desc="Bạn đọc đăng ký; Auth Service tạo tài khoản chờ xác minh, lưu HMAC của mã OTP và gửi email, trả 201 kèm thông tin thử thách dù gửi email thành công hay thất bại.").write(
    OUT / "auth-register-email-otp-dd-p1.html", "Đăng ký tài khoản và xác thực email bằng OTP (1/3): đăng ký và gửi mã",
    note(SRC_R, "1–12", "Cờ <code>REGISTRATION_EMAIL_VERIFICATION</code> mặc định <code>required</code>."))

SeqDiagram("auth-register-email-otp-dd-p2", [W, G, A, M, DB], [
    ("frame", "opt", "[Bạn đọc yêu cầu gửi lại mã]"),
    ("msg", "W", "G", "13. POST\n`/auth/email-otp/resend`", "link"),
    ("msg", "G", "A", "14. Chuyển tiếp", "link"),
    ("note", "A", "Chờ 60 giây giữa hai lần gửi,\ntối đa 10 lần gửi mỗi giờ"),
    ("msg", "A", "DB", "15. Thay mã mới, đặt lại số lần thử", "call"),
    ("msg", "A", "M", "16. Gửi email mới", "link"),
    ("msg", "A", "W", "17. 200 {challenge} (qua API Gateway)", "return"),
    ("end",),
], title="Đăng ký tài khoản, phần 2: gửi lại mã",
   desc="Khi bạn đọc yêu cầu gửi lại mã, Auth Service áp thời gian chờ 60 giây và tối đa 10 lần gửi mỗi giờ, thay mã mới, gửi email và trả lại thông tin thử thách.").write(
    OUT / "auth-register-email-otp-dd-p2.html", "Đăng ký tài khoản và xác thực email bằng OTP (2/3): gửi lại mã",
    note(SRC_R, "13–17", "Bước 17 trong nguồn vẽ thẳng Auth → Web; ở đây ghi rõ phản hồi đi qua API Gateway (proxy <code>/auth</code>)."))

SeqDiagram("auth-register-email-otp-dd-p3", [B, W, G, A, DB], [
    ("msg", "U", "W", "18. Nhập mã OTP", "call"),
    ("msg", "W", "G", "19. POST\n`/auth/email-otp/verify`\n`{challenge_id, code}`", "link"),
    ("msg", "G", "A", "20. Chuyển tiếp", "link"),
    ("msg", "A", "DB", "21. Giữ một lượt thử (UPDATE có điều kiện)", "call"),
    ("frame", "break", "[Mã sai, hết hạn hoặc vượt 5 lần thử]"),
    ("msg", "A", "G", "22. Trả lỗi", "return"),
    ("note", ("G", "A"), "`400 OTP_INVALID / 410 OTP_EXPIRED /`\n`429 OTP_TOO_MANY_ATTEMPTS`"),
    ("msg", "G", "W", "23. Lỗi kèm\n`attempts_remaining`", "return"),
    ("msg", "W", "U", "24. Báo lỗi, cho nhập lại hoặc gửi lại mã", "return"),
    ("end",),
    ("msg", "A", "DB", "25. Trong một giao dịch: đánh dấu mã đã dùng, users.status = ACTIVE, ghi thời điểm xác thực email", "call"),
    ("msg", "A", "G", "26. 200 VERIFIED", "accent"),
    ("msg", "G", "W", "27. 200 VERIFIED", "return"),
    ("msg", "W", "U", "28. Chuyển sang đăng nhập (không tự cấp phiên)", "return"),
], title="Đăng ký tài khoản, phần 3: xác minh mã",
   desc="Bạn đọc nhập mã; Auth Service giữ một lượt thử bằng UPDATE có điều kiện, trả lỗi khi mã sai, hết hạn hoặc vượt 5 lần thử, nếu đúng thì kích hoạt tài khoản trong một giao dịch.").write(
    OUT / "auth-register-email-otp-dd-p3.html", "Đăng ký tài khoản và xác thực email bằng OTP (3/3): xác minh mã", note(SRC_R, "18–28"))
