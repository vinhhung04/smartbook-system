"""Semantic faithfulness validator for copilot answers (AI Copilot 3.1).

The number check (rag.verify_numeric_grounding) knows whether every number in
an answer exists in the data; copilot_explain.overclaims() knows a few words
that claim too much. Neither knows what a sentence MEANS. This module checks
the claims an answer makes against what the system itself computed for the
same turn - the explanation (copilot_explain), the visualization summaries
(copilot_visualization) and the tool data:

  A CONTRADICTION              trend said to go the other way (or "tăng 16,5%"
                               for a -16,5% change)
  B UNSUPPORTED_CAUSAL         a cause asserted where the data only shows
                               co-occurrence (no tool returns causes)
  C SCOPE_CONFUSION            library-wide borrowing presented as one
                               warehouse's
  D RANKING_INCONSISTENCY      another warehouse called the riskier one than
                               the fixed risk rule ranks first
  E UNSUPPORTED_RECOMMENDATION an option called optimal / the best
  F REASONING_OVERCLAIM        certainty the evidence does not carry
  G EXPLANATION_CHART_MISMATCH the explanation and a chart disagree
  H INTERNAL_LABEL             prompt-internal labels copied into the answer
                               ("Ý nghĩa:", "[DỮ KIỆN]", field names)

Deterministic and cheap (pure regex over a few hundred words, no LLM): an
answer that passes costs nothing extra. main.py folds the findings into the
single corrective retry it already had, re-checks, and when a blocking finding
(A, C, D, G) survives replaces the answer by the deterministic conclusion of
the explanation; non-blocking ones keep the answer with a visible warning.
"""
from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass, field

from copilot_explain import overclaims
from copilot_tools import _risk_key
from copilot_visualization import consistency_issues
from intent import normalize_text

CONTRADICTION = "CONTRADICTION"
UNSUPPORTED_CAUSAL = "UNSUPPORTED_CAUSAL"
SCOPE_CONFUSION = "SCOPE_CONFUSION"
RANKING_INCONSISTENCY = "RANKING_INCONSISTENCY"
UNSUPPORTED_RECOMMENDATION = "UNSUPPORTED_RECOMMENDATION"
REASONING_OVERCLAIM = "REASONING_OVERCLAIM"
EXPLANATION_CHART_MISMATCH = "EXPLANATION_CHART_MISMATCH"
INTERNAL_LABEL = "INTERNAL_LABEL"
ISSUE_TYPES = (CONTRADICTION, UNSUPPORTED_CAUSAL, SCOPE_CONFUSION, RANKING_INCONSISTENCY, UNSUPPORTED_RECOMMENDATION,
               REASONING_OVERCLAIM, EXPLANATION_CHART_MISMATCH, INTERNAL_LABEL)
# Findings that make the answer say something the data contradicts: if a
# retry cannot fix them, the answer is replaced, not just flagged.
BLOCKING = frozenset({CONTRADICTION, SCOPE_CONFUSION, RANKING_INCONSISTENCY, EXPLANATION_CHART_MISMATCH})

_VI_TYPE = {
    CONTRADICTION: "mâu thuẫn với xu hướng trong dữ liệu",
    UNSUPPORTED_CAUSAL: "khẳng định nguyên nhân khi dữ liệu chỉ cho thấy tương quan",
    SCOPE_CONFUSION: "nhầm phạm vi: số liệu toàn hệ thống được gán cho một kho",
    RANKING_INCONSISTENCY: "xếp hạng rủi ro khác với quy tắc xếp hạng của hệ thống",
    UNSUPPORTED_RECOMMENDATION: "gọi một phương án là tối ưu/tốt nhất khi hệ thống không tối ưu hóa",
    REASONING_OVERCLAIM: "diễn đạt chắc chắn hơn mức bằng chứng cho phép",
    EXPLANATION_CHART_MISMATCH: "phần giải thích và biểu đồ không khớp nhau",
    INTERNAL_LABEL: "chép nhãn nội bộ của hệ thống vào câu trả lời",
}


@dataclass
class Issue:
    type: str
    phrase: str
    detail: str
    blocking: bool = False


@dataclass
class Context:
    """What the system itself established for this turn."""
    trend: str | None = None            # "tăng" / "giảm" / "đi ngang" (borrowing, complete periods)
    trend_pct: float | None = None
    riskiest: str | None = None         # warehouse first under the risk rule
    risk_tie: bool = False
    warehouses: list[str] = field(default_factory=list)
    borrow_data: bool = False           # some borrowing / demand figure was used (always library-wide)
    explanation: dict | None = None
    visualizations: list = field(default_factory=list)


# ── context ──────────────────────────────────────────────────────────────────

def _direction(pct) -> str | None:
    if not isinstance(pct, (int, float)):
        return None
    return "tăng" if pct >= 5 else "giảm" if pct <= -5 else "đi ngang"


_BORROW_TOOLS = ("get_borrow_trends", "compare_borrow_periods", "get_top_books", "compare_top_books",
                 "analyze_demand_vs_stock", "explain_warehouse_shortage", "get_reorder_suggestions",
                 "explain_reorder_item")


def build_context(collected: dict | None, explanation: dict | None = None, visualizations: list | None = None) -> Context:
    collected = collected or {}
    ctx = Context(explanation=explanation, visualizations=list(visualizations or []))
    for v in ctx.visualizations:
        summary = v.get("summary") or {}
        if summary.get("metric") == "loans" and summary.get("direction") and ctx.trend is None:
            ctx.trend, ctx.trend_pct = summary["direction"], summary.get("change_pct")
        if "riskiest" in summary or summary.get("tie"):
            ctx.riskiest = summary.get("riskiest")
            ctx.risk_tie = bool(summary.get("tie"))
    periods = collected.get("compare_borrow_periods")
    if ctx.trend is None and isinstance(periods, dict) and isinstance(periods.get("metrics"), dict):
        loans = periods["metrics"].get("loans") or {}
        pct = loans.get("per_day_change_pct") if periods.get("unequal_length") else loans.get("change_pct")
        ctx.trend, ctx.trend_pct = _direction(pct), pct
    rows = None
    cw = collected.get("compare_warehouses")
    if isinstance(cw, dict) and isinstance(cw.get("ranking"), list):
        rows = cw["ranking"]
    elif isinstance(collected.get("get_warehouse_stock_risk"), list):
        rows = collected["get_warehouse_stock_risk"]
    if rows:
        rows = sorted([r for r in rows if isinstance(r, dict) and r.get("warehouse_name")], key=_risk_key)
        ctx.warehouses = [r["warehouse_name"] for r in rows]
        if ctx.riskiest is None and not ctx.risk_tie and rows:
            ctx.risk_tie = len(rows) >= 2 and _risk_key(rows[0]) == _risk_key(rows[1])
            ctx.riskiest = None if ctx.risk_tie else rows[0]["warehouse_name"]
    for key, result in collected.items():
        if key.split("#")[0] in _BORROW_TOOLS and not (isinstance(result, dict) and result.get("error")):
            ctx.borrow_data = True
        if isinstance(result, dict) and result.get("warehouse_name") and result["warehouse_name"] not in ctx.warehouses:
            ctx.warehouses.append(result["warehouse_name"])
    return ctx


# ── text helpers ─────────────────────────────────────────────────────────────

def _sentences(text: str) -> list[str]:
    plain = re.sub(r"[*_`#>]+", "", text or "")
    parts = re.split(r"(?<=[.!?;])\s+|\n+", plain)
    return [p.strip(" -•\t") for p in parts if p and p.strip(" -•\t")]


_NEG = re.compile(r"\b(khong|chua|chang|khong phai|khong the|chua du|chua the|kho co the)\b")
_HEDGE = re.compile(r"\b(co the|nhieu kha nang|kha nang|tuong quan|di kem|chua du|chua the khang dinh|khong khang dinh|"
                    r"gia thuyet|du doan|uoc tinh|neu|gia su)\b")


def _clause_before(norm: str, start: int, width: int = 45) -> str:
    return re.split(r"[.;:!?,]", norm[max(0, start - width):start])[-1]


def _negated(norm: str, start: int) -> bool:
    return bool(_NEG.search(_clause_before(norm, start)))


def _alias(name: str) -> list[str]:
    n = normalize_text(name)
    out = {n}
    if n.startswith("kho "):
        out.add(n[4:])
    if n.startswith("chi nhanh "):
        out.add(n[10:])
    return sorted((a for a in out if len(a) >= 2), key=len, reverse=True)


def _mentions(norm: str, names: list[str]) -> list[tuple[int, str]]:
    """(position, name) of every warehouse named in a normalized sentence."""
    found = []
    for name in names:
        for alias in _alias(name):
            m = re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", norm)
            if m:
                found.append((m.start(), name))
                break
    return sorted(found)


# ── detectors ────────────────────────────────────────────────────────────────

_UP = r"(tang|tang truong|di len|tang manh|tang len)"
_DOWN = r"(giam|sut giam|di xuong|giam manh|giam xuong|suy giam|sut)"
_TREND_SUBJECT = re.compile(r"\b(luot muon|xu huong|nhu cau muon|so luot muon|hoat dong muon)\b")


def _contradictions(sentences: list[str], ctx: Context) -> list[Issue]:
    if ctx.trend not in ("tăng", "giảm"):
        return []
    wrong, right = (_UP, _DOWN) if ctx.trend == "giảm" else (_DOWN, _UP)
    out = []
    for s in sentences:
        n = normalize_text(s)
        subj = _TREND_SUBJECT.search(n)
        if not subj:
            continue
        # direction words in the 60 characters after the subject: the claim
        # about that subject, not a word elsewhere in a long sentence.
        window = n[subj.start():subj.end() + 60]
        m = re.search(rf"\b{wrong}\b", window)
        if not m or re.search(rf"\b{right}\b", window[:m.start()]):
            continue
        start = subj.start() + m.start()
        if _negated(n, start) or re.search(r"\b(o mot so|mot vai|thang \d|ngay \d|cao diem)\b", window):
            continue  # "tăng ở tháng 8", "không tăng" are not claims about the overall trend
        out.append(Issue(CONTRADICTION, s[:160], f"Dữ liệu (các kỳ trọn): lượt mượn {ctx.trend}"
                         + (f" {abs(ctx.trend_pct)}%" if isinstance(ctx.trend_pct, (int, float)) else "")
                         + f"; câu trả lời nói ngược lại.", True))
    if isinstance(ctx.trend_pct, (int, float)) and ctx.trend_pct:
        magnitude = f"{abs(ctx.trend_pct):g}".replace(".", ",")
        for s in sentences:
            n = normalize_text(s)
            if re.search(rf"\b{wrong}\s+{re.escape(magnitude)}\s*%", n) and not any(i.phrase == s[:160] for i in out):
                out.append(Issue(CONTRADICTION, s[:160], f"Mức thay đổi trong dữ liệu là {ctx.trend_pct}% ({ctx.trend}).", True))
    return out


_RISK_WORDS = re.compile(r"\b(rui ro|thieu sach|thieu hang|het hang)\b")
_MORE = re.compile(r"\b(cao hon|nhieu hon|lon hon|nghiem trong hon|cao nhat|nhieu nhat|lon nhat|nghiem trong nhat)\b")
_LESS = re.compile(r"\b(thap hon|it hon|nho hon|an toan hon|thap nhat|it nhat)\b")


def _ranking(sentences: list[str], ctx: Context) -> list[Issue]:
    if len(ctx.warehouses) < 2:
        return []
    out = []
    for s in sentences:
        n = normalize_text(s)
        if not _RISK_WORDS.search(n):
            continue
        named = _mentions(n, ctx.warehouses)
        if not named:
            continue
        subject = named[0][1]
        # an aside or a threshold phrase ("(thấp hơn mức an toàn)", "thấp hơn ngưỡng") says
        # what low stock means, not which warehouse is riskier
        scan = re.sub(r"\([^)]*\)", lambda g: " " * len(g.group(0)), n)
        scan = re.sub(r"\b(thap|it|nho|cao) hon (muc|nguong)\b[^,.;]*", lambda g: " " * len(g.group(0)), scan)
        more, less = _MORE.search(scan), _LESS.search(scan)
        if not (more or less) or (more and _negated(n, more.start())) or (less and _negated(n, less.start())):
            continue
        claims_riskier = bool(more) and not (less and less.start() < more.start())
        if ctx.risk_tie:
            out.append(Issue(RANKING_INCONSISTENCY, s[:160], "Theo quy tắc xếp hạng, các kho đang ngang nhau.", True))
        elif claims_riskier and ctx.riskiest and subject != ctx.riskiest:
            out.append(Issue(RANKING_INCONSISTENCY, s[:160], f"Theo quy tắc xếp hạng (hết hàng → dưới ngưỡng → tồn khả "
                                                             f"dụng), kho rủi ro hơn là {ctx.riskiest}.", True))
        elif not claims_riskier and ctx.riskiest and subject == ctx.riskiest:
            out.append(Issue(RANKING_INCONSISTENCY, s[:160], f"{ctx.riskiest} là kho rủi ro hơn theo quy tắc xếp hạng, "
                                                             "không phải thấp hơn.", True))
    return out


_BORROW_STAT = re.compile(r"\b(luot muon|nhu cau muon|so luot muon|duoc muon|muon nhieu)\b")
_WH_ATTRIB = re.compile(r"\b(tai|cua|o)\s+(kho|chi nhanh)\b")


def _scope_confusion(sentences: list[str], ctx: Context) -> list[Issue]:
    if not ctx.borrow_data:
        return []
    out = []
    for s in sentences:
        n = normalize_text(s)
        stat = _BORROW_STAT.search(n)
        if not stat or re.search(r"\b(toan he thong|toan thu vien|tat ca cac kho|chua tach|khong tach)\b", n):
            continue
        tail = n[stat.end():stat.end() + 40]
        attrib = _WH_ATTRIB.search(tail)
        named_after = _mentions(tail, ctx.warehouses)
        # "Kho HCM có 5.445 lượt mượn": a warehouse as the subject of a borrow figure
        named_before = _mentions(n[:stat.start()], ctx.warehouses)
        subject_figure = bool(named_before) and re.search(r"\b(co|ghi nhan|dat)\s+[\d.,]+\s*$", n[:stat.start()].strip() + " ")
        if (attrib and named_after) or (attrib and re.search(r"\b(kho|chi nhanh) \w+", tail)) or subject_figure:
            out.append(Issue(SCOPE_CONFUSION, s[:160], "Lượt mượn/nhu cầu trong hệ thống được tính trên toàn thư viện, "
                                                       "chưa tách theo kho.", True))
    return out


_CAUSAL = re.compile(r"\b(nguyen nhan (chinh |chu yeu )?(la|do|nam o)|la do|chu yeu do|chinh la do|bat nguon tu|gay ra|"
                     r"dan den viec|dan toi viec|khien cho|do nhu cau|vi nhu cau|do luot muon|vi luot muon)\b")


def _unsupported_causal(sentences: list[str], ctx: Context) -> list[Issue]:
    out = []
    for s in sentences:
        n = normalize_text(s)
        for m in _CAUSAL.finditer(n):
            clause = _clause_before(n, m.start(), 60) + n[m.start():m.end() + 30]
            if _negated(n, m.start()) or _HEDGE.search(clause):
                continue
            out.append(Issue(UNSUPPORTED_CAUSAL, s[:160], "Dữ liệu chỉ cho thấy các yếu tố đi kèm (tương quan); hệ thống "
                                                          "không có dữ liệu chứng minh nguyên nhân."))
            break
    return out


_OPTIMAL = re.compile(r"\b(toi uu nhat|phuong an toi uu|lua chon toi uu|tot nhat|hieu qua nhat|la toi uu|sang suot nhat)\b")


def _unsupported_recommendation(sentences: list[str], ctx: Context) -> list[Issue]:
    out = []
    for s in sentences:
        n = normalize_text(s)
        m = _OPTIMAL.search(n)
        if not m or _negated(n, m.start()) or re.search(r"\b(khong co (phuong an|kich ban|lua chon) nao)\b", n):
            continue
        out.append(Issue(UNSUPPORTED_RECOMMENDATION, s[:160], "Hệ thống chỉ áp dụng quy tắc xếp hạng/phân bổ, không xác "
                                                              "định phương án tối ưu."))
    return out


_LABELS = re.compile(r"(\[(DỮ KIỆN|SUY LUẬN[^\]]*|GIẢ ĐỊNH|CHƯA BIẾT|PHƯƠNG ÁN KHÁC|BƯỚC TIẾP THEO)\]\s*|"
                     r"(?<![\w])(Ý nghĩa|Cơ sở|Ý nghĩa với người quản lý)\s*:\s*)")
_FIELDS = re.compile(r"\b(variant_id|warehouse_id|available_qty|reorder_point|suggested_reorder_qty|borrow_count|"
                     r"lead_time_days|out_of_stock_variants|low_stock_variants|estimated_cost)\b")


def _drop_label(m: re.Match) -> str:
    """Remove the label; capitalise what follows when it now starts a sentence."""
    following = m.group(m.lastindex)
    before = m.string[:m.start()].rstrip(" \t*_")
    return following.upper() if not before or before[-1] in ".!?\n" else following


def strip_internal_labels(answer: str) -> tuple[str, list[Issue]]:
    """Deterministic repair: drop prompt-internal tags/labels ("Ý nghĩa:",
    "[DỮ KIỆN]") keeping the text after them. Field names are reported only."""
    issues = [Issue(INTERNAL_LABEL, m.group(0).strip(), "Nhãn nội bộ của khung giải thích, đã được bỏ.")
              for m in _LABELS.finditer(answer or "")]
    cleaned = re.sub(rf"(?:{_LABELS.pattern})(\w?)", _drop_label, answer or "")
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    issues += [Issue(INTERNAL_LABEL, m.group(0), "Tên trường kỹ thuật trong câu trả lời.")
               for m in _FIELDS.finditer(cleaned)]
    return cleaned, issues


def _overclaims(answer: str, ctx: Context) -> list[Issue]:
    out = []
    for flag in overclaims(answer, ctx.explanation):
        kind = (UNSUPPORTED_CAUSAL if "nguyên nhân" in flag["reason"] else
                UNSUPPORTED_RECOMMENDATION if "tối ưu" in flag["reason"] else REASONING_OVERCLAIM)
        out.append(Issue(kind, flag["phrase"], flag["reason"]))
    return out


# ── entry points ─────────────────────────────────────────────────────────────

def validate(answer: str, ctx: Context) -> list[Issue]:
    """Every finding for `answer` (after label repair), deduplicated."""
    sentences = _sentences(answer)
    issues = (_contradictions(sentences, ctx) + _ranking(sentences, ctx) + _scope_confusion(sentences, ctx)
              + _unsupported_causal(sentences, ctx) + _unsupported_recommendation(sentences, ctx) + _overclaims(answer, ctx))
    issues += [Issue(EXPLANATION_CHART_MISMATCH, m, "Giải thích và biểu đồ được dựng từ cùng dữ liệu nhưng kết luận khác "
                                                    "nhau.", True)
               for m in consistency_issues(ctx.visualizations, ctx.explanation)]
    seen, out = set(), []
    for issue in issues:
        key = (issue.type, issue.phrase)
        if key not in seen:
            seen.add(key)
            out.append(issue)
    return out


def retry_instruction(issues: list[Issue]) -> str | None:
    """The findings as constraints for the one corrective retry."""
    relevant = [i for i in issues if i.type != INTERNAL_LABEL]
    if not relevant:
        return None
    lines = [f"- {_VI_TYPE[i.type]}: \"{i.phrase}\" — {i.detail}" for i in relevant[:6]]
    return ("Câu trả lời có nhận định không khớp với dữ liệu đã truy xuất:\n" + "\n".join(lines)
            + "\nHãy viết lại: giữ nguyên số liệu, nói đúng xu hướng/xếp hạng/phạm vi như dữ liệu, chỉ nêu các yếu tố đi "
              "kèm (không khẳng định nguyên nhân), không gọi phương án nào là tối ưu, diễn đạt đúng mức chắc chắn.")


def fallback_answer(explanation: dict | None) -> str | None:
    """A conclusion built only from the explanation - used when the model's
    analysis still contradicts the data after the retry."""
    if not explanation or not explanation.get("headline"):
        return None
    facts = [c["statement"] for c in explanation.get("claims") or []
             if c.get("kind") == "FACT" and c.get("statement") != explanation["headline"]][:3]
    unknown = [c["statement"] for c in explanation.get("claims") or [] if c.get("kind") == "UNKNOWN"][:1]
    lines = [explanation["headline"]] + [f"- {f}" for f in facts] + [f"Chưa biết: {u}" for u in unknown]
    lines.append("(Phần phân tích tự động đã được thay bằng kết luận tính trực tiếp từ dữ liệu vì bản phân tích của mô "
                 "hình không khớp với số liệu.)")
    return "\n".join(lines)


def summarize(issues: list[Issue], status: str, retried: bool, started: float) -> dict:
    return {
        "status": status,
        "retried": retried,
        "issues": [asdict(i) | {"label": _VI_TYPE[i.type]} for i in issues],
        "checked": list(ISSUE_TYPES),
        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def blocking(issues: list[Issue]) -> list[Issue]:
    return [i for i in issues if i.blocking]
