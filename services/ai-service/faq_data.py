from __future__ import annotations

# Static FAQ set for the /chat chatbot's GENERAL_QUERY fallback (see
# faq_retrieval.py). Content is grounded in real data already in the codebase —
# membership tiers come from services/borrow-service/prisma/seed.js, process
# descriptions from README.md — so answers are correct, not invented.
#
# To extend: append more {id, category, question, answer} dicts. test_faq_retrieval.py
# guards uniqueness and required fields as the list grows.

FAQ_ENTRIES: list[dict] = [
    {
        "id": "membership-loan-limit",
        "category": "borrow",
        "question": "Mỗi hạng thành viên được mượn tối đa bao nhiêu sách và trong bao lâu?",
        "answer": (
            "Số sách và thời hạn mượn phụ thuộc vào hạng thành viên: Thẻ Đọc (BASIC) mượn tối đa "
            "3 cuốn trong 14 ngày, Bạc Sĩ (SILVER) mượn 5 cuốn trong 21 ngày, Vàng Hoàng (GOLD) "
            "mượn 8 cuốn trong 30 ngày, Thượng Đế (VIP) mượn 15 cuốn trong 60 ngày."
        ),
    },
    {
        "id": "fine-calculation",
        "category": "fine",
        "question": "Phí phạt trả sách trễ hạn được tính như thế nào?",
        "answer": (
            "Phí phạt tính theo số ngày trễ nhân với mức phạt mỗi ngày của hạng thành viên: Thẻ Đọc "
            "5.000 VND/ngày, Bạc Sĩ 3.000 VND/ngày, Vàng Hoàng 2.000 VND/ngày, Thượng Đế 1.000 VND/ngày. "
            "Hạng thành viên càng cao thì mức phạt mỗi ngày càng thấp."
        ),
    },
    {
        "id": "renewal-count",
        "category": "borrow",
        "question": "Tôi có thể gia hạn sách đã mượn không?",
        "answer": (
            "Có. Số lần gia hạn tối đa theo hạng thành viên: Thẻ Đọc 1 lần, Bạc Sĩ 2 lần, Vàng Hoàng "
            "3 lần, Thượng Đế 5 lần. Mỗi lần gia hạn thường kéo dài thêm khoảng một nửa thời hạn mượn gốc."
        ),
    },
    {
        "id": "reservation-hold",
        "category": "reservation",
        "question": "Đặt trước sách xong thì giữ chỗ trong bao lâu?",
        "answer": (
            "Thời gian giữ chỗ khác nhau theo hạng thành viên: Thẻ Đọc 24 giờ, Bạc Sĩ 36 giờ, Vàng Hoàng "
            "48 giờ, Thượng Đế 72 giờ. Sau khi sách sẵn sàng và có mã pickup, nếu quá thời hạn mà không "
            "đến nhận thì đặt trước sẽ tự động hết hạn."
        ),
    },
    {
        "id": "lost-item-fee",
        "category": "fine",
        "question": "Làm mất sách đang mượn thì phải đền bao nhiêu?",
        "answer": (
            "Phí đền sách mất được tính bằng giá trị sách nhân với hệ số đền bù theo hạng thành viên: "
            "Thẻ Đọc x1.5, Bạc Sĩ x1.3, Vàng Hoàng x1.2, Thượng Đế x1.0. Hạng thành viên càng cao thì "
            "hệ số đền bù càng thấp."
        ),
    },
    {
        "id": "goods-receipt-process",
        "category": "warehouse",
        "question": "Quy trình nhập kho khi hàng từ nhà cung cấp về hoạt động như thế nào?",
        "answer": (
            "Nhân viên tạo goods receipt ở trạng thái draft khi nhận hàng, đối chiếu với purchase order, "
            "sau đó 'post' phiếu để chính thức cộng tồn kho. Tồn kho chỉ được cập nhật sau khi goods "
            "receipt được post, không tự động cộng ngầm."
        ),
    },
    {
        "id": "purchase-order-flow",
        "category": "purchasing",
        "question": "Purchase request và purchase order khác nhau như thế nào?",
        "answer": (
            "Khi tồn kho thấp, nhân viên tạo purchase request; sau khi được duyệt, purchase request trở "
            "thành purchase order và được gửi cho nhà cung cấp xác nhận. Đây là hai bước tách biệt để "
            "đảm bảo có kiểm soát trước khi đặt hàng thật."
        ),
    },
    {
        "id": "supplier-portal",
        "category": "purchasing",
        "question": "Nhà cung cấp xác nhận đơn hàng bằng cách nào nếu chưa có tài khoản?",
        "answer": (
            "Nhà cung cấp chưa có tài khoản có thể dùng Supplier Portal công khai qua đường link kèm "
            "token do nhân viên gửi (không cần đăng nhập) để xác nhận đơn hàng, nộp hóa đơn/phiếu giao "
            "hàng, hoặc báo thiếu hàng."
        ),
    },
    {
        "id": "storage-suggestion-ai",
        "category": "warehouse",
        "question": "AI hỗ trợ gợi ý vị trí lưu trữ sách trong kho như thế nào?",
        "answer": (
            "Hệ thống có tính năng Storage/Reslotting Suggestion gợi ý vị trí lưu trữ tối ưu khi xếp "
            "hàng vào kệ (putaway) và đề xuất tái sắp xếp kệ hiện có, dựa trên dữ liệu tồn kho và hoạt "
            "động kho."
        ),
    },
    {
        "id": "ai-assistant-scope",
        "category": "general",
        "question": "Trợ lý AI (chatbot) trong hệ thống hỗ trợ được những gì?",
        "answer": (
            "Chatbot có thể tra cứu tồn kho, sách quá hạn, xu hướng mượn trả, phí phạt, gợi ý đặt hàng, "
            "và trả lời các câu hỏi thường gặp về chính sách mượn/trả, phí phạt, quy trình kho. Với các "
            "câu hỏi cần quyết định phức tạp hơn dành cho quản lý/quản kho, hãy dùng trang AI Assistant."
        ),
    },
]
