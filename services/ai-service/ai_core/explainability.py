"""Unified evidence contract (Phase F4) shared by the General Chatbot and the
Decision Assistant: one optional `explainability` field on both responses.

    {
      "version": "F1",
      "evidence":  [{id, source_type, source, source_ref, field, value, unit, scope,
                     retrieved_at, internal, kind, snippet?, book_id?}],
      "claims":    [{id, claim, kind FACT|INFERENCE|ASSUMPTION|UNKNOWN,
                     verdict SUPPORTED|CONTRADICTED|UNSUPPORTED|UNVERIFIABLE|null,
                     evidence_ids, detail}],
      "explanation": {facts, inferences, assumptions, unknowns, limitations, method},
      "verification": {status PASSED|PARTIAL|WARNING|FAILED|NO_FACTUAL_CLAIMS|<assistant status>,
                       supported_claims, contradicted_claims, unsupported_claims,
                       unverifiable_claims, checker}
    }

Nothing here is written by a model. For the assistant it is a re-shaping of
what copilot_explain / copilot_verification already computed. For the chatbot
it is a rule-based check of the final reply against the data the turn really
retrieved (number_grounding, document overlap, the recognised photo): a
sentence with a number that matches nothing retrieved is UNSUPPORTED, and the
answer is never PASSED while such a sentence exists. No numeric confidence is
produced (none is calibrated); the status words are the only grading.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from intent import normalize_text
from number_grounding import numbers_match, parse_number_candidates, parse_numbers

SUPPORTED, CONTRADICTED, UNSUPPORTED, UNVERIFIABLE = "SUPPORTED", "CONTRADICTED", "UNSUPPORTED", "UNVERIFIABLE"
FACT, INFERENCE, ASSUMPTION, UNKNOWN = "FACT", "INFERENCE", "ASSUMPTION", "UNKNOWN"
VERSION = "F1"
CHAT_LIMITATIONS = [
    "Kiểm chứng tự động theo luật: so khớp từng con số với dữ liệu đã truy xuất và độ trùng lặp từ với tài liệu; "
    "không kiểm chứng ngữ nghĩa sâu.",
    "Trạng thái kiểm chứng không phải xác suất đúng.",
]
_UNKNOWN_CUE = re.compile(r"\b(chua co (du )?(du lieu|thong tin)|khong co (du )?(du lieu|thong tin)|khong tim thay|"
                          r"chua du (du lieu|thong tin|bang chung)|khong the xac dinh|khong xac dinh duoc|"
                          r"khong tai duoc|khong ro)\b")
_INFERENCE_CUE = re.compile(r"\b(co the|co le|nen|khuyen|goi y|de xuat|du kien|uoc tinh|du bao|kha nang)\b")
_AVAILABILITY = re.compile(r"\b(con|co san|kha dung|san sang)\b[^.?!]{0,30}?(\d+)\s*(ban|cuon|quyen)\b")
_STOP = set("va la cua cho cac nhung mot co khong duoc trong tai voi thi neu de ve nay do ban toi minh se da dang "
            "the nao gi hay hoac cung rat nhieu it".split())


def _sentences(text: str) -> list[str]:
    body = re.split(r"\n\s*Nguồn dữ liệu:", text or "")[0]
    parts = re.split(r"(?<=[.!?])\s+|\n+", body)
    out = []
    for part in parts:
        part = re.sub(r"\*\*|__|`", "", re.sub(r"^[\s\-*•\d.)]+", "", part)).strip(" *_#")
        if len(part.split()) >= 4 and not part.endswith("?"):
            out.append(part)
    return out


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", normalize_text(text)) if len(w) > 1 and w not in _STOP}


def _overlap(sentence: str, document: str) -> float:
    s = _words(sentence)
    return len(s & _words(document)) / len(s) if s else 0.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── General Chatbot ─────────────────────────────────────────────────────────

def chat_evidence(retrieval: dict, personal: dict | None, image: dict | None) -> list[dict]:
    """Evidence items for the sources the turn really read (status ok)."""
    out: list[dict] = []
    at = retrieval.get("retrieved_at") or _now()
    faq = {f"faq://{m.get('id')}": m for m in (retrieval.get("raw") or {}).get("faq_matches") or []}
    for src in retrieval.get("sources") or []:
        if src.get("status") != "ok":
            continue
        ref = src.get("endpoint") or ""
        item = {"id": f"ev-{len(out) + 1}", "source_type": "DOCUMENT" if ref.startswith("faq://") else "API",
                "source": src.get("name"), "source_ref": ref, "field": None, "value": None, "unit": None,
                "scope": "public" if ref.startswith(("faq://", "/public")) else "permission",
                "retrieved_at": at, "internal": True,
                "kind": "policy_document" if ref.startswith("faq://") else "dynamic_data"}
        if ref in faq:
            item["snippet"] = str(faq[ref].get("answer") or "")[:280]
        out.append(item)
    for src in (personal or {}).get("sources") or []:
        if src.get("status") == "ok":
            out.append({"id": f"ev-{len(out) + 1}", "source_type": "API", "source": src.get("name"),
                        "source_ref": src.get("endpoint"), "field": None, "value": None, "unit": None,
                        "scope": "self", "retrieved_at": at, "internal": True, "kind": "personal_data"})
    book = (image or {}).get("book")
    if book:
        out.append({"id": f"ev-{len(out) + 1}", "source_type": "IMAGE_RECOGNITION", "source": "/vision/identify",
                    "source_ref": (image or {}).get("attachment_id"), "field": "book", "value": book.get("title"),
                    "unit": None, "scope": "self", "retrieved_at": at, "internal": True,
                    "kind": "image_match", "book_id": book.get("book_id"),
                    "match_status": (image or {}).get("status")})
        avail = (image or {}).get("availability") or {}
        if avail.get("available_quantity") is not None:
            out.append({"id": f"ev-{len(out) + 1}", "source_type": "API", "source": "public catalog",
                        "source_ref": "/public/catalog/books", "field": "available_quantity",
                        "value": avail.get("available_quantity"), "unit": "bản", "scope": "public",
                        "retrieved_at": avail.get("retrieved_at") or at, "internal": True, "kind": "dynamic_data",
                        "book_id": book.get("book_id")})
    return out


def _grounded_numbers(grounding: dict, image: dict | None) -> list[float]:
    import json
    nums = parse_numbers(str(grounding.get("summary") or ""))
    nums += parse_numbers(json.dumps(grounding.get("raw") or {}, ensure_ascii=False, default=str))
    if image:
        nums += parse_numbers(json.dumps({"availability": image.get("availability"), "book": image.get("book")},
                                         ensure_ascii=False, default=str))
    return nums


def chat_claims(reply: str, question: str, grounding: dict, evidence: list[dict], image: dict | None) -> list[dict]:
    grounded = _grounded_numbers(grounding, image)
    asked = parse_numbers(question)
    docs = [(e["id"], e.get("snippet") or "") for e in evidence if e.get("snippet")]
    data_ids = [e["id"] for e in evidence if e["kind"] in ("dynamic_data", "personal_data")]
    book = (image or {}).get("book") or {}
    avail_qty = ((image or {}).get("availability") or {}).get("available_quantity")
    image_ids = [e["id"] for e in evidence if e["kind"] == "image_match"]
    claims: list[dict] = []
    for sentence in _sentences(reply):
        norm = normalize_text(sentence)
        groups = [g for g in parse_number_candidates(sentence) if not any(numbers_match(v, asked) for v in g)]
        claim = {"id": f"c-{len(claims) + 1}", "claim": sentence[:240], "kind": FACT, "verdict": None,
                 "evidence_ids": [], "detail": ""}
        m = _AVAILABILITY.search(norm)
        if m and avail_qty is not None and book and int(m.group(2)) != int(avail_qty):
            claim.update(verdict=CONTRADICTED, evidence_ids=[e["id"] for e in evidence if e["field"] == "available_quantity"],
                         detail=f"Dữ liệu catalog: {avail_qty} bản khả dụng.")
        elif groups:
            missing = [g[0] for g in groups if not any(numbers_match(v, grounded) for v in g)]
            if missing:
                claim.update(verdict=UNSUPPORTED, detail="Không tìm thấy trong dữ liệu đã truy xuất: "
                             + ", ".join(f"{n:g}" for n in missing[:4]))
            else:
                claim.update(verdict=SUPPORTED, evidence_ids=data_ids or [e["id"] for e in evidence][:2])
        elif _UNKNOWN_CUE.search(norm):
            claim.update(kind=UNKNOWN)
        elif book and normalize_text(book.get("title") or "") and normalize_text(book["title"]) in norm:
            claim.update(verdict=SUPPORTED, evidence_ids=image_ids, detail="Khớp sách đã nhận diện từ ảnh.")
        elif _INFERENCE_CUE.search(norm):
            claim.update(kind=INFERENCE, verdict=UNVERIFIABLE, detail="Suy luận/gợi ý, không đối chiếu được trực tiếp.")
        elif docs:
            best_id, best = max(((i, _overlap(sentence, d)) for i, d in docs), key=lambda x: x[1])
            if best >= 0.5:
                claim.update(verdict=SUPPORTED, evidence_ids=[best_id], detail="Trùng nội dung tài liệu nguồn.")
            else:
                claim.update(verdict=UNVERIFIABLE, detail="Không tìm thấy đoạn tài liệu tương ứng.")
        else:
            continue  # connective prose with nothing to check (greeting, framing)
        claims.append(claim)
    return claims


def _status(claims: list[dict]) -> str:
    verdicts = [c["verdict"] for c in claims if c["verdict"]]
    if not verdicts:
        return "NO_FACTUAL_CLAIMS"
    if CONTRADICTED in verdicts:
        return "FAILED"
    if UNSUPPORTED in verdicts:
        return "WARNING"
    return "PASSED" if all(v == SUPPORTED for v in verdicts) else "PARTIAL"


def _verification(claims: list[dict], status: str, checker: str) -> dict:
    count = lambda v: sum(1 for c in claims if c["verdict"] == v)  # noqa: E731
    return {"status": status, "supported_claims": count(SUPPORTED), "contradicted_claims": count(CONTRADICTED),
            "unsupported_claims": count(UNSUPPORTED), "unverifiable_claims": count(UNVERIFIABLE), "checker": checker}


def for_chat(reply: str, question: str, retrieval: dict, grounding: dict, personal: dict | None,
             image: dict | None, abstained: bool = False) -> dict:
    evidence = [] if abstained else chat_evidence(retrieval, personal, image)
    claims = [] if abstained else chat_claims(reply, question, grounding, evidence, image)
    unknowns = [c["claim"] for c in claims if c["kind"] == UNKNOWN]
    unknowns += [f"Không đọc được nguồn: {s.get('name')}" for s in (retrieval.get("sources") or [])
                 if s.get("status") not in ("ok", None)]
    if abstained:
        unknowns.append("Không có tài liệu hoặc dữ liệu nội bộ đủ liên quan để trả lời.")
    used = sorted({e["source"] for e in evidence if e.get("source")})
    return {
        "version": VERSION,
        "evidence": evidence,
        "claims": claims,
        "explanation": {
            "facts": [c["claim"] for c in claims if c["verdict"] == SUPPORTED],
            "inferences": [c["claim"] for c in claims if c["kind"] == INFERENCE],
            "assumptions": [],
            "unknowns": unknowns,
            "limitations": list(CHAT_LIMITATIONS),
            "method": ("Trả lời từ: " + "; ".join(used)) if used else "Không có nguồn dữ liệu nào được dùng.",
        },
        "verification": _verification(claims, "NO_EVIDENCE" if abstained else _status(claims), "rule_based_chat_v1"),
    }


# ── Decision Assistant (re-shaped, nothing re-computed) ─────────────────────

_ASSISTANT_STATUS = {"PASSED": "PASSED", "REPAIRED": "PASSED", "WARNING": "WARNING", "BLOCKED": "FAILED"}


def for_assistant(payload: dict) -> dict:
    as_of = payload.get("data_as_of")
    evidence = [{
        "id": f"ev-{i + 1}", "source_type": "API", "source": e.get("tool_name"), "source_ref": e.get("tool_name"),
        "field": e.get("metric"), "value": e.get("value"), "unit": e.get("unit"), "scope": "permission",
        "retrieved_at": as_of, "internal": True, "kind": "dynamic_data", "label": e.get("label"),
    } for i, e in enumerate(payload.get("evidence") or [])]
    by_tool: dict[str, list[str]] = {}
    for e in evidence:
        by_tool.setdefault(e["source"] or "", []).append(e["id"])
    verification = payload.get("verification") or {}
    claims = []
    for c in verification.get("claims") or []:
        tools = {x.get("source") for x in c.get("evidence") or [] if isinstance(x, dict)}
        claims.append({"id": f"c-{len(claims) + 1}", "claim": c.get("text"), "kind": FACT, "verdict": c.get("verdict"),
                       "evidence_ids": [i for t in tools for i in by_tool.get(t or "", [])][:4],
                       "detail": c.get("detail") or c.get("label") or ""})
    expl = payload.get("explanation") or {}
    kinds = {k: [c.get("statement") for c in expl.get("claims") or [] if c.get("kind") == k]
             for k in (FACT, INFERENCE, ASSUMPTION, UNKNOWN)}
    status = _ASSISTANT_STATUS.get(str(verification.get("status") or "").upper()) or _status(claims)
    if not claims:
        # Nothing was checked: never "PASSED". An answer that could only say
        # what is unknown (no permission, tool failed) is NO_EVIDENCE.
        status = "NO_EVIDENCE" if kinds[UNKNOWN] or payload.get("retrieval_warnings") else "NO_FACTUAL_CLAIMS"
    headline = expl.get("headline")
    return {
        "version": VERSION,
        "evidence": evidence,
        "claims": claims,
        "explanation": {
            "facts": kinds[FACT], "inferences": kinds[INFERENCE],
            "assumptions": kinds[ASSUMPTION] + list((payload.get("plan") or {}).get("assumptions") or []),
            "unknowns": kinds[UNKNOWN],
            # copilot_explain repeats each unknown as a "Chưa biết: …" limit: show it once
            "limitations": [x for x in list(expl.get("limits") or []) + list(payload.get("caveats") or [])
                            if not any(u and u in x for u in kinds[UNKNOWN])],
            "method": headline if headline and headline not in kinds[UNKNOWN]
            else "Phân tích từ dữ liệu công cụ đọc của hệ thống.",
        },
        "verification": {**_verification(claims, status, "copilot_verification"),
                         "assistant_status": verification.get("status"),
                         "safe_to_act": verification.get("safe_to_act")},
    }
