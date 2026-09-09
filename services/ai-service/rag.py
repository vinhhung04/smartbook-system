from __future__ import annotations

import json

from number_grounding import display_number, numbers_match, parse_number_candidates, parse_numbers


RAG_SYSTEM_RULES = """

## Quy tắc RAG bắt buộc
- Nếu có [RAG CONTEXT], phải ưu tiên trả lời dựa trên context đó.
- Không bịa số liệu. Nếu context không có số liệu cần thiết, nói rõ là chưa đủ dữ liệu.
- Luôn trả lời bằng tiếng Việt.
- Nếu có dùng dữ liệu từ endpoint, cuối câu trả lời thêm dòng: "Nguồn dữ liệu: ...".
- Không hiện URL nội bộ cho người dùng.
- Với gợi ý nhập thêm, nói rõ đây là gợi ý hỗ trợ, không phải quyết định bắt buộc.

## Quy tắc định dạng câu trả lời
- TUYỆT ĐỐI KHÔNG dùng markdown table (ký tự `|`, dòng `---`). UI không render được bảng.
- Dùng danh sách có đánh số hoặc bullet (`- `) thay cho bảng.
- Khi [RAG CONTEXT] có phần "Data summary" đã format sẵn (với 🏭 kho, 🔴🟡 sách), hãy dùng trực tiếp format đó — KHÔNG reformat lại thành bảng hay cách trình bày khác.
- Dùng emoji/icon phù hợp: 📚 sách, 📦 tồn kho, ⚠️ cảnh báo, ✅ OK, 🔴 hết hàng, 🟡 sắp hết, 📊 số liệu, 🏭 kho, 🛒 nhập hàng, 📋 phiếu, 👤 nhân viên.
- Câu trả lời phải ngắn gọn — không giải thích dài dòng.
- Khi trả lời về tồn kho thấp: nhóm theo kho (🏭 Tên kho (MÃ)) rồi liệt kê sách bên dưới.
- Mỗi đầu sách chỉ cần 1 dòng: icon + tên + số liệu. Không thêm thông tin không có trong dữ liệu.
- Dùng **bold** cho tên sách và số liệu nổi bật.
- Với danh sách > 5 mục, chỉ liệt kê top 5 rồi ghi "...và X sách khác".
- Tổng kết ở cuối bằng 1–2 câu gợi ý hành động cụ thể.

## Quy tắc nghiệp vụ tồn kho bắt buộc
- Không bịa số tồn kho. Không tự suy luận warehouse_id nếu API không cung cấp.
- Nếu vừa tạo pending action (CREATE_REORDER_DRAFT), phải nói: "Tôi đã chuẩn bị phiếu, vui lòng kiểm tra và xác nhận trong thẻ hành động bên dưới." KHÔNG nói "đã tạo phiếu" hoặc "đã hoàn thành".
- Nếu API trả lỗi hoặc context thiếu dữ liệu, nói rõ "chưa đủ dữ liệu" thay vì đoán.
- Nếu user hỏi rõ "kho X", chỉ dùng dữ liệu của kho X trong context. Nếu kho X không có dữ liệu, nói rõ.
- Nếu user nói "tất cả kho / từng kho / mỗi kho", trình bày dữ liệu theo từng kho riêng biệt — không gộp chung.
- Nếu user chỉ hỏi thông tin (không dùng từ "tạo/lập/sinh phiếu"), không đề cập đến việc tạo action.
- Nếu user yêu cầu tạo phiếu, chỉ tạo pending action — phải nói rõ user cần xác nhận trước khi phiếu được tạo thật.
- Không gom sách của nhiều kho vào một kho.
- Số liệu trong context (tồn hiện tại, ngưỡng nhập, gợi ý nhập) phải được dùng nguyên vẹn, không tự tính lại.
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


def verify_numeric_grounding(reply: str, retrieval: dict, question: str | None = None) -> str | None:
    """Anti-hallucination check: flag numbers in the reply with no matching
    value (within tolerance) anywhere in the retrieved context.

    This is a best-effort signal, not proof of fabrication - a number the
    model correctly *derives* (a percentage, a sum) from grounded data can
    still be flagged; that's a real limitation, not something silently
    special-cased away. It exists because RAG_SYSTEM_RULES only tells the
    LLM not to invent numbers via prompt instruction; nothing upstream
    actually checks the model kept that promise.

    Value-and-tolerance matching (via number_grounding) over the FULL raw
    payload, not digit-substring matching over a 9000-char truncated slice -
    this used to be a materially weaker check than eval/scoring.py's
    hallucinated_numbers, which the eval's own README flagged as a
    deliberately deferred gap pending evidence; the 26.7% hallucinated-number
    rate in assistant_answers_20260908_180847.md is that evidence. `question`
    is optional but should be passed when available: a number the user's own
    question supplied (e.g. "30 ngày qua") and the model echoes back is not a
    fabrication - same exclusion eval/scoring.py's hallucinated_numbers
    applies, for the same reason (see its docstring).

    Returns a Vietnamese caution string to surface to the user, or None if
    the reply's numbers are all grounded (or there was no real data to check
    against in the first place).
    """
    sources = retrieval.get("sources") or []
    if not any(source.get("status") == "ok" for source in sources):
        return None

    unverified = unverified_numbers(reply, retrieval, question)
    if not unverified:
        return None

    sample = ", ".join(display_number(n) for n in sorted(unverified)[:5])
    return (
        f"Một số con số trong câu trả lời ({sample}) không khớp trực tiếp với dữ liệu đã truy xuất — "
        "vui lòng đối chiếu lại trước khi dùng để ra quyết định."
    )


def unverified_numbers(reply: str, retrieval: dict, question: str | None = None) -> list[float]:
    """The number-matching core of verify_numeric_grounding, split out so a
    caller that wants to build its own correction message (e.g. an
    assistant_loop retry step naming the exact bad numbers) doesn't have to
    parse them back out of the Vietnamese warning string. Does not apply
    verify_numeric_grounding's "was there any real data at all" gate - that
    check depends on the caller's own definition of a usable `sources` list,
    which callers here already have and can check themselves.

    Groups the reply's numbers by the token they came from
    (parse_number_candidates) rather than checking every VN/EN
    interpretation independently: a token is only unverified when NONE of
    its own interpretations are grounded, so a correctly-grounded VN-style
    "500.000" isn't flagged just because its unintended EN reading (500.0)
    happens not to match anything.
    """
    candidate_groups = parse_number_candidates(reply)
    if not candidate_groups:
        return []
    grounded = parse_numbers(str(retrieval.get("summary") or ""))
    grounded += parse_numbers(json.dumps(retrieval.get("raw") or {}, ensure_ascii=False, default=str))
    grounded += parse_numbers(question)
    return [
        group[0] for group in candidate_groups
        if not any(numbers_match(value, grounded) for value in group)
    ]


def merge_grounding_context(retrieval: dict, personal: dict | None) -> dict:
    """Combines `retrieval` (system-wide analytics) with `personal` (the
    caller's own data, from user_personal_context.build_user_personal_context)
    into one {summary, raw, sources} envelope for ensure_source_line /
    verify_numeric_grounding to check a reply against.

    Without this, CUSTOMER/SUPPLIER get zero grounding: ANALYTICS_BLOCKED_ROLES
    zeroes out `retrieval` for them, but their own loans/fines/tasks are still
    injected into the prompt via `personal` - so a customer-facing answer that
    quotes a number from their own data was never checked against anything,
    and never got a "Nguồn dữ liệu:" citation either. `personal` carries no
    `raw` JSON (only prose `summary`), so `raw` here is retrieval's alone;
    `summary` and `sources` are merged.
    """
    personal_summary = (personal or {}).get("summary") or ""
    personal_sources = (personal or {}).get("sources") or []
    if not personal_summary and not personal_sources:
        return retrieval

    return {
        **retrieval,
        "summary": "\n\n".join(filter(None, [retrieval.get("summary"), personal_summary])),
        "sources": [*(retrieval.get("sources") or []), *personal_sources],
    }


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
