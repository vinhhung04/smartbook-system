import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from seqauto import SeqDiagram

OUT = pathlib.Path(sys.argv[1])
S = "borrow-vnpay-fine-payment"
XS6 = [92, 208, 324, 448, 596, 708]
U = ("U", "Bạn đọc", "CUSTOMER", "input")
W = ("W", "Web App", "trình duyệt")
G = ("G", "API Gateway", "api-gateway")
B = ("B", "Borrow", "borrow-service")
DB = ("DB", "PostgreSQL", "borrow_db", "store")
V = ("V", "Cổng VNPay", "sandbox", "external")
SRC = f'docs/diagrams/source/sequence/{S}.mmd'

SeqDiagram(f"{S}-dd-p1", [U, W, G, B, DB, V], [
    ("msg", "U", "W", "1. Bấm thanh toán VNPay cho một khoản phạt", "call"),
    ("msg", "W", "G", "2. POST\n`/my/fines/payments/`\n`vnpay/create {fine_id}`", "link"),
    ("msg", "G", "B", "3. Chuyển tiếp tới /borrow/my (JWT bạn đọc)", "link"),
    ("msg", "B", "DB", "4. Đọc khoản phạt, các lần đã trả và giao dịch VNPay đang chờ", "call"),
    ("frame", "break", "[Yêu cầu không hợp lệ]"),
    ("note", ("W", "B"), "fine_id sai, không phải của bạn đọc, đã trả/miễn,\nđang có giao dịch chờ, VNPay chưa cấu hình"),
    ("msg", "B", "G", "5. 400 / 404 / 409 (PAYMENT_PENDING) / 503", "return"),
    ("msg", "G", "W", "6. Thông báo lỗi", "return"),
    ("end",),
    ("note", ("B", "V"), "Số còn nợ = amount − waived_amount − đã trả\nvnp_Amount = số tiền × 100, ký HMAC-SHA512\ntrên tham số đã sắp xếp, hết hạn sau 15 phút"),
    ("msg", "B", "DB", "7. Tạo fine_payment_intents (PENDING, txn_ref, expires_at)", "call"),
    ("msg", "B", "G", "8. 201\n`{payment_url, txn_ref,`\n`amount, expires_at}`", "return"),
    ("msg", "G", "W", "9. 201", "return"),
    ("msg", "W", "V", "10. Chuyển hướng trình duyệt tới payment_url", "link"),
    ("msg", "U", "V", "11. Thanh toán trên cổng VNPay", "call"),
], box_w=104, xs=XS6, title="Thanh toán phí phạt qua VNPay, phần 1: tạo liên kết",
   desc="Bạn đọc yêu cầu thanh toán một khoản phạt; Borrow Service kiểm tra khoản phạt và giao dịch đang chờ, tạo giao dịch PENDING hết hạn sau 15 phút với URL ký HMAC-SHA512 rồi trình duyệt chuyển tới cổng VNPay.").write(
    OUT / f"{S}-dd-p1.html", "Thanh toán phí phạt qua VNPay (1/2): tạo liên kết thanh toán",
    f'<p class="note">Nguồn: <code>{SRC}</code>, bước 1–11.</p>')

SeqDiagram(f"{S}-dd-p2", [U, W, G, B, DB, V], [
    ("frame", "par", "[Return URL (trình duyệt)]"),
    ("msg", "V", "W", "12. Chuyển hướng về returnUrl kèm tham số vnp_*", "return"),
    ("msg", "W", "G", "13. Gọi returnUrl", "link"),
    ("note", ("W", "G"), "GET /webhooks/vnpay/return?vnp_..."),
    ("msg", "G", "B", "14. Chuyển tiếp", "link"),
    ("note", "B", "verifySignedParams, sai chữ ký → 400"),
    ("msg", "B", "DB", "15. finalizeVnpayPayment (một giao dịch)", "call"),
    ("msg", "B", "G", "16. Trang kết quả HTML, liên kết về /customer/fines", "return"),
    ("msg", "G", "W", "17. Trang kết quả", "return"),
    ("else", "[IPN (máy chủ VNPay)]"),
    ("msg", "V", "G", "18. GET /webhooks/vnpay/ipn?vnp_...", "link"),
    ("msg", "G", "B", "19. Chuyển tiếp", "link"),
    ("note", "B", "Sai chữ ký → RspCode 97"),
    ("msg", "B", "DB", "20. finalizeVnpayPayment (một giao dịch)", "call"),
    ("msg", "B", "G", "21. RspCode 00 / 01 / 02 / 04 / 99", "return"),
    ("msg", "G", "V", "22. RspCode", "return"),
    ("end",),
    ("note", ("W", "V"), "finalizeVnpayPayment: giành intent PENDING → PROCESSING (UPDATE có điều kiện),\nnên Return URL và IPN không ghi trùng, kiểm tra số tiền và vnp_ResponseCode = 00,\ntạo fine_payments, cập nhật fines và total_fine_balance,\nthông báo FINE_PAYMENT_RECORDED, nhật ký CUSTOMER_PAY_FINE_VNPAY"),
    ("msg", "W", "U", "23. Kết quả thanh toán", "accent"),
], box_w=104, xs=XS6, title="Thanh toán phí phạt qua VNPay, phần 2: xác nhận kết quả",
   desc="VNPay báo kết quả song song qua Return URL của trình duyệt và IPN máy chủ; cả hai đi qua API Gateway tới Borrow Service, kiểm tra chữ ký và gọi cùng hàm ghi nhận có khóa để không ghi trùng thanh toán.").write(
    OUT / f"{S}-dd-p2.html", "Thanh toán phí phạt qua VNPay (2/2): xác nhận qua Return URL và IPN",
    f'<p class="note">Nguồn: <code>{SRC}</code>, bước 12–23.</p>')
