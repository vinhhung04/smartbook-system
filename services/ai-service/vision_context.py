"""Book recognition decision, its explanation, and the short-lived context
that lets a conversation refer to "cuốn sách này" (Phase F3/F4).

decide() turns the ranked candidates of routes_cover_search into one of
  IDENTIFIED   one book is supported well enough to talk about it
  AMBIGUOUS    candidates exist but the evidence does not single one out:
               the user picks (never a silent guess)
  NO_MATCH     nothing in the catalog matched
The rule uses only measured signals - the OCR title match score (assistant_tools
._score_and_rank_books) and the CLIP cosine of the best cover - and was set on
the DEV split of the cover-search research dataset (docs/AI/PHASE_F_MULTIMODAL.md):
there, every out-of-collection photo reached the catalog only through a weak
partial title match (0.5) with no visual support, and every wrong visual-only
answer led its runner-up by < 0.06. None of these numbers is a probability and
none is shown as one.

The context store keeps, per uploaded photo, the candidate book references
(ids, title, authors) - never the image - bound to the uploader, for
CONTEXT_TTL_SECONDS. A later turn may name a book_id only if it is one of
those candidates (the client cannot inject an arbitrary book).
"""
from __future__ import annotations

import os
import re
import secrets
import time

TEXT_STRONG = float(os.getenv("VISION_TEXT_STRONG", "0.9"))
VISUAL_MARGIN = float(os.getenv("VISION_VISUAL_MARGIN", "0.10"))
CONTEXT_TTL_SECONDS = int(os.getenv("VISION_CONTEXT_TTL_SECONDS", "1800"))
CONTEXT_MAX_ENTRIES = 2000

IDENTIFIED, AMBIGUOUS, NO_MATCH = "IDENTIFIED", "AMBIGUOUS", "NO_MATCH"


def _signals(candidate: dict) -> dict:
    return {e.get("signal"): e.get("score") for e in candidate.get("evidence") or []}


def match_basis(candidate: dict) -> str:
    s = _signals(candidate)
    if s.get("visual") is not None and s.get("ocr_text") is not None:
        return "BOTH_SIGNALS"
    return "VISUAL_ONLY" if s.get("visual") is not None else "TEXT_ONLY"


def decide(candidates: list[dict]) -> tuple[str, list[str]]:
    """(status, reason codes) for the ranked candidates."""
    if not candidates:
        return NO_MATCH, ["no_candidate"]
    top, rest = candidates[0], candidates[1:]
    s = _signals(top)
    text, visual = s.get("ocr_text"), s.get("visual")
    rival_strong_text = any((_signals(c).get("ocr_text") or 0) >= TEXT_STRONG for c in rest)
    if text is not None and text >= TEXT_STRONG and not rival_strong_text:
        return IDENTIFIED, ["title_match_strong"] + (["visual_agrees"] if visual is not None else [])
    if text is not None and visual is not None and not rival_strong_text:
        return IDENTIFIED, ["text_and_visual_agree"]
    if visual is not None and text is None:
        runner = max((_signals(c).get("visual") or 0 for c in rest), default=0.0)
        if visual - runner >= VISUAL_MARGIN:
            return IDENTIFIED, ["visual_clear_margin"]
        return AMBIGUOUS, ["visual_close_candidates"]
    if rival_strong_text:
        return AMBIGUOUS, ["several_title_matches"]
    return AMBIGUOUS, ["title_match_weak"]


def candidate_view(candidate: dict, rank: int, ocr: dict | None) -> dict:
    """The fields a client shows for one candidate - scores labelled as
    similarity / match scores, never as a chance of being right."""
    s = _signals(candidate)
    authors = candidate.get("authors") or candidate.get("author") or []
    if isinstance(authors, str):
        authors = [authors]
    return {
        "rank": rank,
        "book_id": str(candidate.get("id") or ""),
        "variant_id": candidate.get("variant_id"),
        "title": candidate.get("title"),
        "authors": [a if isinstance(a, str) else (a or {}).get("name") for a in authors if a],
        "isbn": candidate.get("isbn13") or candidate.get("isbn") or None,
        "publisher": (candidate.get("publisher") or {}).get("name") if isinstance(candidate.get("publisher"), dict)
        else candidate.get("publisher"),
        "cover_image_url": candidate.get("cover_image_url") or candidate.get("image_url"),
        "match_basis": match_basis(candidate),
        "visual_similarity": s.get("visual"),
        "text_match_score": s.get("ocr_text"),
        "ranking_score": candidate.get("confidence"),
        "ocr_title": (ocr or {}).get("title"),
        "ocr_author": (ocr or {}).get("author"),
    }


_REASON_TEXT = {
    "title_match_strong": "Tên sách đọc được trên bìa khớp đầy đủ với một đầu sách trong thư viện.",
    "visual_agrees": "Hình ảnh bìa cũng giống bìa của chính đầu sách đó.",
    "text_and_visual_agree": "Chữ trên bìa và hình ảnh bìa cùng chỉ tới một đầu sách (chữ chỉ khớp một phần).",
    "visual_clear_margin": "Không đọc được tên sách; hình ảnh bìa giống một đầu sách rõ rệt hơn các bìa còn lại.",
    "visual_close_candidates": "Không đọc được tên sách và nhiều bìa có hình ảnh giống nhau tương đương nhau.",
    "several_title_matches": "Tên đọc được khớp với nhiều đầu sách.",
    "title_match_weak": "Tên đọc được chỉ khớp một phần và không có hình ảnh bìa nào xác nhận.",
    "no_candidate": "Không có đầu sách nào trong thư viện khớp với chữ hoặc hình ảnh trên bìa.",
}


def explain(status: str, reasons: list[str], views: list[dict], ocr: dict | None, signals: dict) -> dict:
    """The recognition in the unified explainability shape (ai_core/explainability):
    facts are what OCR/CLIP/catalog returned, inferences the decision rule's
    conclusion, unknowns what the signals could not tell."""
    ocr = ocr or {}
    facts, unknowns, limitations, evidence = [], [], [], []
    if ocr.get("title") or ocr.get("author"):
        read = ", ".join(x for x in (f"tên “{ocr['title']}”" if ocr.get("title") else "",
                                      f"tác giả “{ocr['author']}”" if ocr.get("author") else "") if x)
        facts.append(f"OCR đọc được trên bìa: {read}.")
        evidence.append({"id": "ev-ocr", "source_type": "OCR", "source": "OpenRouter vision", "field": "title/author",
                         "value": {"title": ocr.get("title"), "author": ocr.get("author")}})
    elif signals.get("ocr_status") == "error":
        unknowns.append("Dịch vụ OCR không phản hồi; chỉ dùng so khớp hình ảnh.")
    else:
        unknowns.append("Không đọc được chữ trên bìa.")
    if signals.get("visual_status") == "ok":
        top = next((v for v in views if v.get("visual_similarity") is not None), None)
        if top:
            facts.append(f"So khớp hình ảnh với {signals.get('gallery_size', 0)} bìa trong thư viện: gần nhất là "
                         f"“{top['title']}” (độ tương đồng {top['visual_similarity']:.2f}).")
            evidence.append({"id": "ev-clip", "source_type": "CLIP", "source": "cover_embeddings",
                             "field": "visual_similarity", "value": top["visual_similarity"], "book_id": top["book_id"]})
        else:
            facts.append("Không có bìa nào trong thư viện đủ giống ảnh (dưới ngưỡng so khớp hình ảnh).")
    else:
        unknowns.append("So khớp hình ảnh không khả dụng lúc này; chỉ dùng chữ đọc được.")
    for v in views[:3]:
        evidence.append({"id": f"ev-cat-{v['rank']}", "source_type": "CATALOG", "source": "inventory-service /api/books",
                         "field": "book", "value": v["title"], "book_id": v["book_id"], "match_basis": v["match_basis"]})
    limitations.append("Điểm tương đồng và điểm khớp chữ dùng để xếp hạng, không phải xác suất nhận diện đúng.")
    limitations.append("Hệ thống không ghi kết quả nhận diện vào danh mục sách.")
    inferences = [_REASON_TEXT[r] for r in reasons if r in _REASON_TEXT]
    verdict = {IDENTIFIED: "SUPPORTED", AMBIGUOUS: "UNVERIFIABLE", NO_MATCH: "UNSUPPORTED"}[status]
    return {
        "summary": {IDENTIFIED: "Đã nhận diện được sách.", AMBIGUOUS: "Có nhiều khả năng, cần bạn chọn đúng sách.",
                    NO_MATCH: "Không đủ bằng chứng để nhận diện."}[status],
        "facts": facts, "inferences": inferences, "assumptions": [], "unknowns": unknowns,
        "limitations": limitations, "evidence": evidence,
        "verification": {"status": "PASSED" if status == IDENTIFIED else "PARTIAL" if status == AMBIGUOUS else "NO_EVIDENCE",
                         "verdict": verdict},
    }


# ── short-lived, owner-bound context ────────────────────────────────────────
# shortcut: in-process dict (one ai-service instance today, like the rate
# limiter); move to Redis when ai-service runs more than one replica.
_STORE: dict[str, dict] = {}


def owner_key(user_ctx) -> str | None:
    return f"user:{user_ctx.user_id}" if user_ctx is not None and getattr(user_ctx, "user_id", None) else None


def _purge(now: float) -> None:
    for key in [k for k, v in _STORE.items() if v["expires"] <= now]:
        _STORE.pop(key, None)
    while len(_STORE) >= CONTEXT_MAX_ENTRIES:
        _STORE.pop(next(iter(_STORE)))


def save(user_ctx, status: str, views: list[dict], ocr: dict | None) -> str:
    owner = owner_key(user_ctx)
    if owner is None:
        raise ValueError("an image context needs an authenticated owner")
    now = time.time()
    _purge(now)
    attachment_id = "img_" + secrets.token_urlsafe(16)
    _STORE[attachment_id] = {
        "owner": owner, "expires": now + CONTEXT_TTL_SECONDS, "status": status,
        "candidates": [{k: v.get(k) for k in ("book_id", "variant_id", "title", "authors", "isbn", "publisher",
                                               "match_basis")} for v in views],
        "ocr": {"title": (ocr or {}).get("title"), "author": (ocr or {}).get("author")},
    }
    return attachment_id


def load(attachment_id: str | None, user_ctx) -> dict | None:
    """The context if it exists, has not expired and belongs to this user."""
    if not attachment_id:
        return None
    entry = _STORE.get(attachment_id)
    if not entry or entry["expires"] <= time.time() or entry["owner"] != owner_key(user_ctx):
        return None
    return entry


def select(entry: dict, book_id: str | None) -> dict | None:
    """The candidate the turn is about: the chosen book_id if it is one of the
    verified candidates, else the top one when the photo was IDENTIFIED."""
    if book_id:
        return next((c for c in entry["candidates"] if c["book_id"] == str(book_id)), None)
    if entry["status"] == IDENTIFIED and entry["candidates"]:
        return entry["candidates"][0]
    return None


# "Sách này", "cuốn trong ảnh", "đây là sách gì", "nó"...: the turn points at the photo.
_REFERS_TO_PHOTO = re.compile(r"\b(sach|cuon|quyen|tua|bia|anh) (nay|do|kia|ay|vua roi|tren anh|trong anh|vua gui)\b"
                              r"|\bday la\b|\bno\b|\banh nay\b|\bcuon nay\b|\btrong anh\b")


def refers_to_photo(normalized_message: str) -> bool:
    return bool(_REFERS_TO_PHOTO.search(normalized_message))
