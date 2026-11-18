"""Feature B - AI Metadata Anomaly Detection (rule-based only, no LLM reasoning
in this version - every anomaly below is produced by a deterministic rule
already computed elsewhere in book_ocr, never guessed by a model).

This module does not invent new checks: it packages signals that
validation.py (per-field CONFLICTED/INVALID/REVIEW_REQUIRED + reason codes)
and service.py (cross-source warnings) already compute into a single,
severity-graded `Anomaly` list - the structure the Anomaly Dashboard reads.
Every anomaly's `requiresHumanReview` matches exactly what the P0 save-gate
(apps/web/.../lib/book-ocr.ts unresolvedOcrFields) already blocks on, so the
dashboard and the gate can never disagree about what still needs a look.

No anomaly here changes or rejects a value - that stays the staff's call
(decideField / the proposal "apply" buttons), per the standing rule that AI
never auto-corrects or overrides metadata.
"""
from __future__ import annotations

from .schemas import Anomaly, AnomalySeverity, AnomalyType, FieldResult

# field -> (category, "identity-critical" - CONFLICTED/INVALID on these fields
# can mis-file the book entirely, not just one attribute).
_FIELD_CATEGORY: dict[str, tuple[AnomalyType, bool]] = {
    "isbn": ("ISBN_ANOMALY", True),
    "title": ("CROSS_SOURCE_ANOMALY", True),
    "subtitle": ("CROSS_SOURCE_ANOMALY", False),
    "authors": ("AUTHOR_TRANSLATOR_ANOMALY", False),
    "translators": ("AUTHOR_TRANSLATOR_ANOMALY", False),
    "publisher": ("PUBLICATION_ANOMALY", False),
    "distributor": ("PUBLICATION_ANOMALY", False),
    "publicationYear": ("PUBLICATION_ANOMALY", False),
    "printYear": ("PUBLICATION_ANOMALY", False),
    "copyrightYear": ("PUBLICATION_ANOMALY", False),
    "editionStatement": ("PUBLICATION_ANOMALY", False),
    "pageCount": ("PHYSICAL_METADATA_ANOMALY", False),
    "coverPrice": ("PHYSICAL_METADATA_ANOMALY", False),
    "description": ("CROSS_SOURCE_ANOMALY", False),
}

# Reason code -> a short, field-agnostic Vietnamese explanation of what it
# means. Field-specific wording (which field, which values) is added by the
# caller; this only explains the rule that fired.
_REASON_EXPLANATIONS: dict[str, str] = {
    "SOURCES_DISAGREE": "Các ảnh ghi giá trị khác nhau, không có giá trị nào được tự chọn.",
    "UNGROUNDED": "Giá trị AI đưa ra không khớp với đoạn chữ AI tự chép lại từ ảnh.",
    "ROLE_MISMATCH": "Tên này được ghi với vai trò khác (ví dụ dịch giả hoặc người minh họa), không phải vai trò của trường này.",
    "ROLE_UNCONFIRMED": "Không tìm thấy nhãn vai trò rõ ràng (ví dụ \"Tác giả:\", \"NXB:\") đi kèm giá trị này trên ảnh.",
    "ISBN_UNLABELLED": "Không thấy chữ \"ISBN\" đi kèm dãy số này trên ảnh.",
    "DIACRITICS_DIFFER": "Các nguồn ghi cùng một tên nhưng khác dấu tiếng Việt (ví dụ \"tiến\"/\"tiễn\").",
    "PARTIAL_AGREEMENT": "Một nguồn chỉ liệt kê một phần danh sách (ví dụ bìa chỉ ghi tác giả đầu).",
    "BARCODE_UNCONFIRMED": "Mã vạch do máy quét/tự nhận dạng, chưa có ảnh chữ in ISBN xác nhận lại.",
    "SOME_READINGS_INVALID": "Một số lần đọc bị loại vì không hợp lệ; giá trị dưới đây chỉ dựa trên các lần đọc còn lại.",
    "OUT_OF_RANGE": "Giá trị đọc được nằm ngoài khoảng hợp lý (ví dụ năm quá xa, số trang quá lớn).",
    "INVALID_FORMAT": "Giá trị đọc được không đúng định dạng mong đợi.",
    "INVALID_CHECKSUM": "Mã ISBN sai số kiểm tra (checksum) - chắc chắn không phải ISBN hợp lệ.",
    "NOT_ISBN_PREFIX": "Dãy số 13 chữ số này không bắt đầu bằng 978/979 nên không phải ISBN (có thể là mã vạch bán lẻ).",
    "UNKNOWN_SOURCE": "Giá trị được gán cho một ảnh không có trong lần tải lên này.",
}

_WARNING_RULES: dict[str, tuple[AnomalyType, AnomalySeverity, list[str], str, str, bool]] = {
    "IMAGES_MAY_SHOW_DIFFERENT_BOOKS": (
        "CROSS_SOURCE_ANOMALY", "CRITICAL", ["title", "isbn"],
        "Tên sách hoặc ISBN đọc được không khớp giữa các ảnh đã tải lên - các ảnh có thể thuộc hai cuốn sách khác nhau.",
        "Kiểm tra lại từng ảnh có thực sự cùng một cuốn sách trước khi tiếp tục.", True,
    ),
    "ISBN_LOOKUP_TITLE_MISMATCH": (
        "CROSS_SOURCE_ANOMALY", "MEDIUM", ["title", "isbn13"],
        "Bản ghi tra cứu theo ISBN có tên sách khác với tên in trên ảnh - hệ thống đã bỏ qua bản ghi này, không dùng dữ liệu của nó.",
        "Không cần thao tác thêm trừ khi muốn tra cứu lại bằng ISBN khác.", False,
    ),
    "ISBN_LOOKUP_DIFFERENT_EDITION": (
        "CROSS_SOURCE_ANOMALY", "MEDIUM", ["isbn13", "publishedDate"],
        "ISBN khớp nhưng bản ghi tra cứu là một ấn bản khác - hệ thống đã bỏ qua dữ liệu năm/số trang/mô tả của bản ghi đó.",
        "Không cần thao tác thêm; nếu cần đúng ấn bản này hãy nhập tay các trường còn thiếu.", False,
    ),
    "ISBN_LOOKUP_IDENTITY_UNVERIFIED": (
        "CROSS_SOURCE_ANOMALY", "LOW", ["isbn13"],
        "Không đọc được tên sách trên ảnh để xác nhận bản ghi tra cứu đúng là cuốn này; hệ thống chưa dùng dữ liệu của bản ghi đó.",
        "Có thể bỏ qua nếu tên sách đã được bạn xác nhận tay.", False,
    ),
    "ONLY_PRINT_YEAR_FOUND": (
        "PUBLICATION_ANOMALY", "LOW", ["publishedDate"],
        "Chỉ đọc được năm in/tái bản trên ảnh, không thấy năm xuất bản lần đầu.",
        "Kiểm tra lại trang thông tin xuất bản nếu cần đúng năm xuất bản lần đầu.", False,
    ),
}


def _field_anomaly(field: str, result: FieldResult) -> Anomaly | None:
    category, identity_critical = _FIELD_CATEGORY.get(field, ("CROSS_SOURCE_ANOMALY", False))
    reasons = result.reasons or ["SOURCES_DISAGREE" if result.status == "CONFLICTED" else "UNGROUNDED"]
    explanation = " ".join(dict.fromkeys(_REASON_EXPLANATIONS.get(r, r) for r in reasons))
    evidence = [f"{field}:{reason}" for reason in reasons]
    detected = [o.value for o in result.observations if o.valid] or None

    if result.status == "CONFLICTED":
        return Anomaly(
            anomalyType=category, severity="CRITICAL" if identity_critical else "HIGH",
            affectedFields=[field], detectedValue=detected, explanation=explanation, evidence=evidence,
            recommendedAction="So sánh các giá trị với sách thật rồi chọn giá trị đúng ở phần kiểm đếm.",
            requiresHumanReview=True,
        )
    if result.status == "INVALID":
        return Anomaly(
            anomalyType=category, severity="HIGH" if field == "isbn" else "MEDIUM",
            affectedFields=[field], detectedValue=detected, explanation=explanation, evidence=evidence,
            recommendedAction="Nhập lại giá trị này bằng tay, hoặc chụp ảnh rõ hơn rồi quét lại.",
            requiresHumanReview=True,
        )
    if result.status == "REVIEW_REQUIRED":
        severity: AnomalySeverity = "LOW" if reasons == ["BARCODE_UNCONFIRMED"] else "MEDIUM"
        return Anomaly(
            anomalyType=category, severity=severity, affectedFields=[field], detectedValue=result.value,
            explanation=explanation, evidence=evidence,
            recommendedAction="Xem lại đoạn bằng chứng từ ảnh trước khi dùng giá trị này.",
            requiresHumanReview=True,
        )
    return None


def detect_anomalies(fields: dict[str, FieldResult], warnings: list[str]) -> list[Anomaly]:
    """Rule-based only (Feature B v1, per the approved Phase 1 scope - no LLM
    explanation step yet). Every anomaly traces to a status or warning code
    already computed by validate_extraction()/service.py; this function adds
    no new judgment of its own, only severity and plain-language wording."""
    anomalies = [a for field, result in fields.items() if (a := _field_anomaly(field, result)) is not None]
    for warning in warnings:
        rule = _WARNING_RULES.get(warning)
        if not rule:
            continue
        anomaly_type, severity, affected_fields, explanation, action, requires_review = rule
        anomalies.append(Anomaly(
            anomalyType=anomaly_type, severity=severity, affectedFields=affected_fields,
            explanation=explanation, evidence=[warning], recommendedAction=action,
            requiresHumanReview=requires_review,
        ))
    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}
    return sorted(anomalies, key=lambda a: order[a.severity])
