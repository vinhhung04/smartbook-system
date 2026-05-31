from __future__ import annotations

import json


RAG_SYSTEM_RULES = """

## Quy tắc RAG bắt buộc
- Nếu có [RAG CONTEXT], phải ưu tiên trả lời dựa trên context đó.
- Không bịa số liệu. Nếu context không có số liệu cần thiết, nói rõ là chưa đủ dữ liệu.
- Luôn trả lời bằng tiếng Việt.
- Nếu có dùng dữ liệu từ endpoint, cuối câu trả lời thêm dòng: "Nguồn dữ liệu: ...".
- Không hiện URL nội bộ cho người dùng.
- Với gợi ý nhập thêm, nói rõ đây là gợi ý hỗ trợ, không phải quyết định bắt buộc.

## Quy tắc định dạng câu trả lời
- Dùng emoji/icon phù hợp để làm nổi bật thông tin: 📚 sách, 📦 tồn kho, ⚠️ cảnh báo, ✅ OK, 🔴 hết hàng, 🟡 sắp hết, 📊 số liệu, 🏭 kho, 🛒 nhập hàng, 📋 phiếu, 👤 nhân viên.
- Câu trả lời phải ngắn gọn, súc tích — không giải thích dài dòng.
- Mỗi đầu sách chỉ cần 1 dòng: icon + tên + số liệu quan trọng nhất.
- Dùng **bold** cho tên sách và số liệu nổi bật.
- Với danh sách > 5 mục, chỉ liệt kê top 5 quan trọng nhất rồi ghi "...và X mục khác".
- Tổng kết ở cuối bằng 1–2 câu gợi ý hành động cụ thể.
"""


def _safe_json(value: dict) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False, default=str, indent=2)
    except TypeError:
        text = str(value)
    return text[:9000]


def source_names(sources: list[dict]) -> list[str]:
    names = []
    for source in sources or []:
        if source.get("status") == "ok" and source.get("name"):
            names.append(str(source["name"]))
    return names


def build_rag_context(intent_info: dict, retrieval: dict) -> str:
    sources = retrieval.get("sources") or []
    warnings = retrieval.get("warnings") or []
    raw = retrieval.get("raw") or {}
    source_lines = []
    for source in sources:
        source_lines.append(f"  - {source.get('name')}: {source.get('status')}")

    warning_lines = [f"  - {warning}" for warning in warnings] or ["  - none"]
    summary = retrieval.get("summary") or "Khong co du lieu retrieve duoc."

    return "\n".join([
        "\n[RAG CONTEXT]",
        f"- Intent detected: {intent_info.get('intent')}",
        f"- Confidence: {intent_info.get('confidence')}",
        f"- Retrieved at: {retrieval.get('retrieved_at')}",
        "- Sources used:",
        *(source_lines or ["  - none"]),
        "- Retrieval warnings:",
        *warning_lines,
        "- Data summary:",
        summary,
        "- Raw compact data:",
        _safe_json(raw),
        "[/RAG CONTEXT]\n",
    ])


def build_no_data_context(intent_info: dict) -> str:
    return "\n".join([
        "\n[RAG CONTEXT]",
        f"- Intent detected: {intent_info.get('intent')}",
        "- Sources used: none",
        "- Data summary: Khong co du lieu thoi gian thuc duoc retrieve cho cau hoi nay.",
        "[/RAG CONTEXT]\n",
    ])


def ensure_source_line(reply: str, sources: list[dict]) -> str:
    names = source_names(sources)
    if not names:
        return reply
    if ("Nguon du lieu:" in reply or "Nguồn dữ liệu:" in reply) and all(name in reply for name in names):
        return reply
    return f"{reply.rstrip()}\n\nNguồn dữ liệu: {', '.join(names)}"


def build_fallback_reply(intent_info: dict, retrieval: dict, used_legacy: bool = False) -> str:
    warnings = retrieval.get("warnings") or []
    summary = retrieval.get("summary") or ""
    sources = retrieval.get("sources") or []

    if used_legacy:
        return ensure_source_line(
            "Tôi tạm thời không retrieve được dữ liệu mới từ backend RAG, nên đang dùng context legacy từ frontend. "
            "Số liệu có thể không đầy đủ như dashboard analytics.\n\n"
            f"{summary}",
            sources,
        )

    if summary:
        lead = ""
        if warnings and not source_names(sources):
            lead = "Tôi chưa có dữ liệu thời gian thực đầy đủ cho câu hỏi này. "
        return ensure_source_line(f"{lead}{summary}", sources)

    intent = intent_info.get("intent")
    if intent and intent != "GENERAL_QUERY":
        return "Tôi chưa có dữ liệu thời gian thực để trả lời chính xác câu hỏi này. Vui lòng kiểm tra quyền truy cập hoặc thử lại sau."

    return "Tôi có thể hỗ trợ tra cứu sách, tồn kho, mượn trả, reservation và fine. Hãy hỏi một câu cụ thể để tôi retrieve dữ liệu phù hợp."
