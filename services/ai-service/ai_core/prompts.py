"""Prompt management: every system prompt of ai-service by use case, each
with a version derived from its text (sha256, 8 hex) - a prompt edit changes
the version, so a log line or eval report can say which prompt answered.

General chatbot prompts are defined here. The Decision Assistant's standing
rules stay with its answer shaping (copilot_response.COPILOT_SYSTEM_PROMPT),
the NLU classifier's with the classifier (nlu._NLU_SYSTEM_PROMPT) and the RAG
grounding rules with the grounding checks (rag.RAG_SYSTEM_RULES); they are
registered here so all prompts are listed and versioned in one place. The
chatbot and the assistant never share a system prompt.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

# Fixed reply for /chat when retrieval_confidence.py decides NO_EVIDENCE on an
# information-seeking GENERAL_QUERY message - the corpus has no real answer, so
# the LLM is skipped rather than risk it inventing one (a greeting with the same
# decision still reaches the LLM - see intent.is_information_seeking).
GENERAL_QUERY_ABSTENTION_REPLY = (
    "Hiện hệ thống chưa có đủ thông tin trong dữ liệu nội bộ để trả lời câu hỏi này."
)

CHAT_SYSTEM_PROMPT = (
    "Bạn là **SmartBook AI** — trợ lý ảo thông minh chuyên biệt cho hệ thống quản lý thư viện SmartBook.\n\n"

    "## Vai trò & năng lực\n"
    "- Bạn có quyền truy cập DỮ LIỆU THỜI GIAN THỰC của thư viện (được cung cấp trong mục [DỮ LIỆU HỆ THỐNG] bên dưới).\n"
    "- Bạn hỗ trợ: tra cứu sách, kiểm tra tồn kho, theo dõi mượn/trả, phạt quá hạn, gợi ý sách, phân tích xu hướng.\n"
    "- Bạn hiểu cấu trúc hệ thống: Catalog (danh mục sách), Inventory (kho), Borrow (mượn/trả), Fines (phạt).\n\n"

    "## Quy tắc trả lời\n"
    "1. **Luôn dùng dữ liệu thực** khi có trong [DỮ LIỆU HỆ THỐNG]. Trích dẫn con số cụ thể.\n"
    "2. Nếu người dùng hỏi về sách cụ thể, tìm trong danh sách sách được cung cấp. Nếu không tìm thấy, nói rõ.\n"
    "3. Khi phân tích, đưa ra nhận xét có giá trị (ví dụ: cảnh báo tồn kho thấp, sách quá hạn nhiều).\n"
    "4. Trả lời bằng **tiếng Việt**, ngắn gọn, thân thiện, chuyên nghiệp.\n"
    "5. Dùng **bold** cho số liệu quan trọng và tên sách. Dùng emoji nhẹ (📚 📊 ⚠️ ✅) làm điểm nhấn.\n"
    "6. Giới hạn 3-8 câu, trừ khi người dùng yêu cầu chi tiết.\n"
    "7. Khi gợi ý hành động, chỉ rõ người dùng nên vào trang nào (Dashboard, Catalog, Inventory, Borrow, Reports).\n"
    "8. Nếu dữ liệu không đủ để trả lời chính xác, nói rõ giới hạn và gợi ý cách kiểm tra.\n\n"

    "## Khả năng đặc biệt\n"
    "- Phân tích xu hướng mượn sách và gợi ý nhập thêm đầu sách.\n"
    "- Cảnh báo sách tồn kho thấp hoặc hết hàng.\n"
    "- Tổng hợp tình hình mượn quá hạn và phạt.\n"
    "- So sánh và xếp hạng sách theo lượt mượn.\n"
    "- Tư vấn quy trình nghiệp vụ thư viện (nhập kho, putaway, picking, xuất kho).\n"
)

ROLE_BASED_RULES = (
    "\n## Quy tắc theo vai trò người dùng\n"
    "- Luôn trả lời theo user hiện tại được xác định từ Authorization token. KHÔNG dùng thông tin user từ body request.\n"
    "- CUSTOMER: Chỉ dùng dữ liệu cá nhân của customer đó. Không tiết lộ dữ liệu người khác hay analytics toàn hệ thống.\n"
    "- WAREHOUSE_STAFF: Ưu tiên task được giao cho họ, không hiện task của người khác.\n"
    "- WAREHOUSE_MANAGER/ADMIN: Có thể trả lời dữ liệu tổng quan hệ thống.\n"
    "- LIBRARIAN: Tập trung nghiệp vụ mượn trả, reservation, loan, fine.\n"
    "- SUPPLIER: Chỉ xem dữ liệu liên quan supplier của họ.\n"
    "- Nếu người dùng hỏi ngoài phạm vi quyền của họ, giải thích ngắn gọn họ không có quyền xem dữ liệu đó.\n"
    "- Không bịa dữ liệu. Nếu không có dữ liệu từ endpoint, nói rõ là chưa có thông tin.\n"
)


@dataclass(frozen=True)
class Prompt:
    name: str
    use_case: str
    text: str

    @property
    def version(self) -> str:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()[:8]


def _registry() -> dict[str, Prompt]:
    from copilot_response import COPILOT_SYSTEM_PROMPT
    from nlu import _NLU_SYSTEM_PROMPT
    from rag import RAG_SYSTEM_RULES
    prompts = [
        Prompt("chat.system", "general_chatbot", CHAT_SYSTEM_PROMPT),
        Prompt("chat.role_rules", "general_chatbot", ROLE_BASED_RULES),
        Prompt("chat.rag_rules", "general_chatbot", RAG_SYSTEM_RULES),
        Prompt("chat.abstention_reply", "general_chatbot", GENERAL_QUERY_ABSTENTION_REPLY),
        Prompt("assistant.system", "decision_assistant", COPILOT_SYSTEM_PROMPT),
        Prompt("nlu.classifier", "shared_nlu", _NLU_SYSTEM_PROMPT),
    ]
    return {p.name: p for p in prompts}


def get(name: str) -> Prompt:
    return _registry()[name]


def versions() -> dict[str, str]:
    """{prompt name: version}, e.g. for /health and eval reports."""
    return {name: prompt.version for name, prompt in _registry().items()}
