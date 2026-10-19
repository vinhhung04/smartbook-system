"""Hybrid semantic verification for copilot answers (AI Copilot 3.3).

Layer 1 (copilot_verification + copilot_faithfulness) reads claims with
regular expressions: exact when an answer is phrased the way a rule expects,
blind to every other phrasing (live run 2 of 3.2 still missed 6/11 drafts with
errors). This module adds two layers on top - it never replaces Layer 1:

Layer 2 - extract(): ONE LLM call (JSON-object output, temperature 0) that
    only EXTRACTS and NORMALIZES the answer's claims into a fixed vocabulary
    (metric, entity, warehouse, period, budget scenario, operator, value, unit,
    FACT/INFERENCE/ASSUMPTION, the exact quote). The model is shown the
    answer, the metric vocabulary and the NAMES of entities present in the
    tool data - never the values - so it cannot judge whether a claim is right.

Layer 3 - validate(): the backend decides every verdict from the same tool
    data the answer was written from: SUPPORTED / CONTRADICTED / UNSUPPORTED /
    UNVERIFIABLE. Guards against a wrong extraction: the quote must occur in
    the answer, a value must be written in the quote, an entity / metric /
    scenario the data does not hold is UNVERIFIABLE (never "wrong"), and
    rounding is accepted to the precision the number is written with.

Claims from here carry basis="semantic": the value is exact but the mapping
of words to a metric came from a model, so main._finalize_assistant_turn
treats a surviving semantic contradiction like a heuristic one (the sentence
is withdrawn) rather than replacing the whole answer.
"""
from __future__ import annotations

import json
import logging
import re

import copilot_faithfulness as cf
import copilot_verification as cv
from intent import normalize_text

logger = logging.getLogger(__name__)

# metric id -> (unit, meaning shown to the extractor)
METRICS: dict[str, tuple[str, str]] = {
    # library-wide activity (period: current | previous | YYYY-MM)
    "loans.total": ("events", "tổng lượt mượn của một kỳ"),
    "loans.per_day": ("events", "lượt mượn trung bình mỗi ngày của một kỳ"),
    "loans.change": ("%", "mức/chiều thay đổi lượt mượn giữa hai kỳ"),
    "returns.total": ("events", "tổng lượt trả của một kỳ"),
    "returns.change": ("%", "mức/chiều thay đổi lượt trả giữa hai kỳ"),
    "reservations.total": ("events", "tổng lượt đặt chỗ của một kỳ"),
    "reservations.change": ("%", "mức/chiều thay đổi lượt đặt chỗ giữa hai kỳ"),
    "loans.peak_day": ("events", "số lượt mượn của ngày cao điểm trong kỳ"),
    "period.days": ("days", "số ngày của kỳ"),
    # one title (entity = title)
    "title.available": ("copies", "số bản khả dụng/còn trên kệ của một đầu sách"),
    "title.borrows": ("events", "lượt mượn của một đầu sách trong kỳ"),
    "title.trend": ("%", "xu hướng/mức thay đổi nhu cầu mượn của một đầu sách"),
    "title.reorder_qty": ("copies", "số bản đề xuất nhập của một đầu sách"),
    "title.cost": ("money", "chi phí đề xuất nhập của một đầu sách"),
    "title.unit_cost": ("money", "đơn giá một bản"),
    "title.lead_time": ("days", "thời gian chờ hàng của một đầu sách"),
    "title.days_to_stockout": ("days", "số ngày ước tính đến khi hết sách"),
    "title.stock_level": ("", "đánh giá mức tồn kho (thấp/cao/đủ) của một đầu sách"),
    "title.wishlist": ("events", "số lượt wishlist của một đầu sách"),
    "title.in_data": ("", "một đầu sách được nêu tên như có trong danh sách / dữ liệu"),
    # the reorder list (system-wide)
    "reorder.titles": ("titles", "tổng số đầu sách cần xem xét nhập"),
    "reorder.high_priority": ("titles", "số đầu sách ưu tiên cao trong danh sách cần nhập"),
    "reorder.copies": ("copies", "tổng số bản đề xuất nhập"),
    "reorder.cost": ("money", "tổng chi phí ước tính để nhập toàn bộ danh sách"),
    "reorder.first": ("", "đầu sách nên nhập trước tiên (theo thứ tự của hệ thống)"),
    # one budget scenario (budget_vnd says which)
    "budget.amount": ("money", "số tiền ngân sách của kịch bản (do người dùng đặt)"),
    "budget.approved_titles": ("titles", "số đầu sách được duyệt trong ngân sách"),
    "budget.approved_copies": ("copies", "số bản được duyệt trong ngân sách"),
    "budget.approved_cost": ("money", "chi phí được duyệt / số tiền sử dụng trong ngân sách"),
    "budget.remaining": ("money", "ngân sách còn lại / dư"),
    "budget.hp_approved": ("titles", "số đầu sách ưu tiên cao được duyệt"),
    "budget.hp_unapproved": ("titles", "số đầu sách ưu tiên cao chưa được duyệt / bị bỏ lại"),
    "budget.compliance": ("", "chi phí duyệt nằm trong hay vượt ngân sách"),
    "budget.coverage": ("", "ngân sách có đáp ứng toàn bộ nhu cầu nhập hay không"),
    "budget.title_status": ("", "một đầu sách được duyệt (funded) hay bị bỏ lại / chưa được duyệt (unfunded) trong ngân sách"),
    # warehouses (entity = warehouse; scope=system for a sum over the warehouses in the data)
    "warehouse.out_of_stock": ("titles", "số đầu sách hết hàng của kho"),
    "warehouse.low_stock": ("titles", "số đầu sách dưới ngưỡng tồn tối thiểu của kho"),
    "warehouse.available": ("copies", "tổng số bản khả dụng của kho"),
    "warehouse.reserved": ("copies", "số bản đang giữ cho đặt trước của kho"),
    "warehouse.borrowed": ("copies", "số bản đang cho mượn của kho"),
    "warehouse.risk": ("", "mức rủi ro thiếu sách của kho (so sánh/xếp hạng)"),
    # loans, fines, KPIs
    "overdue.loans": ("tickets", "số phiếu mượn quá hạn"),
    "overdue.items": ("books", "số cuốn sách quá hạn chưa trả"),
    "overdue.avg_days": ("days", "số ngày trễ hạn trung bình"),
    "fines.unpaid": ("money", "tổng tiền phạt chưa thu"),
    "fines.paid": ("money", "tổng tiền phạt đã thu"),
    "fines.by_type": ("money", "tiền phạt theo một loại (entity = loại phạt: OVERDUE/DAMAGED/LOST...)"),
    "kpi.active_loans": ("events", "số lượt mượn đang hoạt động (chưa trả)"),
    "kpi.total_titles": ("titles", "tổng số đầu sách trong hệ thống"),
    "kpi.total_copies": ("copies", "tổng số bản sách trong hệ thống"),
    "kpi.low_stock": ("titles", "số đầu sách dưới ngưỡng (chỉ số tổng quan)"),
    "reservations.conversion_rate": ("%", "tỷ lệ đặt chỗ chuyển thành mượn"),
    # reasoning claims (no value)
    "cause": ("", "một nguyên nhân được nêu cho một hiện tượng"),
    "optimality": ("", "gọi một phương án là tối ưu / tốt nhất / đúng đắn nhất"),
}
OPERATORS = ("eq", "gt", "lt", "max", "min", "increase", "decrease", "stable", "low", "high", "within", "exceeds",
             "covers_all", "not_covers_all", "part_of", "first", "cause", "optimal", "out_of_stock", "funded", "unfunded",
             "absent")
# bump when the extraction prompt changes (eval cache key)
PROMPT_VERSION = "3.3.2"
# causes the tool data can speak to (left UNVERIFIABLE); any other cause stated as fact is UNSUPPORTED
_MEASURED_CAUSES = ("stock_out", "demand_change", "seasonality", "system_rule")
_STABLE_PCT = 20.0  # same threshold as copilot_verification._check_trends

MAX_TOKENS = 1400
TIMEOUT_SECONDS = 12.0

_PROMPT = """Bạn là bộ TRÍCH XUẤT nhận định. Nhiệm vụ duy nhất: đọc câu trả lời của trợ lý và liệt kê các nhận định có thể \
kiểm tra bằng dữ liệu, chuẩn hóa theo bộ từ vựng bên dưới. KHÔNG đánh giá đúng/sai, KHÔNG thêm thông tin không có trong \
câu trả lời, KHÔNG sửa số.

Trả về JSON {"c": [...]}, mỗi phần tử là một nhận định với các khóa ngắn (BỎ khóa nào không có giá trị, không ghi null):
  "q": trích NGUYÊN VĂN đoạn ngắn nhất (≤ 120 ký tự) của câu trả lời chứa nhận định
  "m": mã METRIC
  "e": thực thể (tên đầu sách / kho / loại phạt, viết như trong danh sách THỰC THỂ)
  "ce": thực thể được so sánh cùng ("hơn/kém/so với")
  "s": "w" nếu nói về một kho cụ thể, "sys" nếu nói về toàn hệ thống / tổng các kho
  "p": kỳ: "current" | "previous" | "YYYY-MM"
  "b": ngân sách của kịch bản được nhắc, số VND (vd 10000000)
  "op": eq gt lt max min increase decrease stable low high within exceeds covers_all part_of first cause optimal
        out_of_stock funded unfunded absent
  "v": con số VIẾT trong q, đã quy đổi ("8,9 triệu" -> 8900000, "35,2%" -> 35.2)
  "tm": mã METRIC của tổng chứa nó (chỉ khi op = part_of, vd "trong đó")
  "cf": khi m = cause: stock_out | demand_change | seasonality | system_rule | staff | supplier | marketing | event | user_behavior | other
  "k": "F" khẳng định | "I" suy luận có rào đón | "A" giả định ("có thể", "nếu")

Quy tắc:
- Chỉ trích nhận định CÓ trong câu trả lời và có mã METRIC phù hợp; mỗi con số gắn với một ý nghĩa = một phần tử. Bỏ câu \
chào, câu hỏi lại, lời khuyên chung, và các số không có mã METRIC.
- "đầu sách" (titles) khác "bản" (copies); "phiếu" khác "cuốn"; ngân sách khác chi phí duyệt khác tiền còn lại.
- op: eq cho một giá trị; max/min cho "nhiều nhất/cao nhất/ít nhất/an toàn nhất"; gt/lt cho so sánh hai thực thể; \
increase/decrease/stable cho xu hướng ("ổn định", "duy trì đều", "không đổi nhiều" = stable); low/high cho đánh giá \
mức tồn ("tồn kho thấp"); first cho "nên nhập trước tiên"; covers_all cho "đáp ứng toàn bộ/đủ nhu cầu"; part_of cho "trong đó X".
- Đánh giá xu hướng bằng lời ("ổn định", "tăng mạnh") là một phần tử riêng (không có "v"), kể cả khi cùng câu với con số.
- m = cause: q là câu nêu nguyên nhân, cf là loại nguyên nhân. m = optimality: chỉ khi câu trả lời tự gọi một phương án \
là tối ưu/tốt nhất/đúng đắn nhất (không tính "đứng đầu thứ tự ưu tiên của hệ thống").
- "đang hết hàng / hết sạch" về một đầu sách: m = title.stock_level, op = out_of_stock (một phần tử cho MỖI đầu sách được gọi là hết hàng).
- Đầu sách được nói là được duyệt / nằm trong danh sách mua: m = budget.title_status, op = funded; bị bỏ lại / chưa được nhập: op = unfunded (một phần tử cho MỖI đầu sách được nêu tên).
- Câu trả lời nói dữ liệu về một chỉ số KHÔNG có / chưa được cung cấp: op = absent với metric tương ứng.
- Không có gì kiểm tra được -> {"c": []}.

VÍ DỤ (tên giả):
"Ba đầu sách đang hết hàng: Sách P (0 bản), Sách Q (1 bản). Ngân sách duyệt Sách R; Sách S bị bỏ lại. Dữ liệu chưa có tổng số bản." ->
{"c":[{"q":"Sách P (0 bản)","m":"title.stock_level","e":"Sách P","op":"out_of_stock"},
{"q":"Sách Q (1 bản)","m":"title.stock_level","e":"Sách Q","op":"out_of_stock"},
{"q":"Ngân sách duyệt Sách R","m":"budget.title_status","e":"Sách R","op":"funded"},
{"q":"Sách S bị bỏ lại","m":"budget.title_status","e":"Sách S","op":"unfunded"},
{"q":"Dữ liệu chưa có tổng số bản","m":"kpi.total_copies","op":"absent"}]}
"Kho A an toàn nhất, có 122 bản khả dụng — cao nhất hệ thống." ->
{"c":[{"q":"Kho A an toàn nhất","m":"warehouse.risk","e":"Kho A","op":"min"},
{"q":"122 bản khả dụng — cao nhất hệ thống","m":"warehouse.available","e":"Kho A","op":"max","v":122}]}
"Lượt đặt chỗ giảm 35%, nhìn chung vẫn tương đối ổn định. Sách X: tồn kho thấp, chỉ còn 3 bản." ->
{"c":[{"q":"Lượt đặt chỗ giảm 35%","m":"reservations.change","op":"decrease","v":35},
{"q":"nhìn chung vẫn tương đối ổn định","m":"reservations.change","op":"stable","k":"I"},
{"q":"Sách X: tồn kho thấp","m":"title.stock_level","e":"X","op":"low"},
{"q":"chỉ còn 3 bản","m":"title.available","e":"X","op":"eq","v":3}]}
"Tổng phạt chưa thu 499 triệu, trong đó phạt quá hạn 591 triệu." ->
{"c":[{"q":"Tổng phạt chưa thu 499 triệu","m":"fines.unpaid","op":"eq","v":499000000},
{"q":"trong đó phạt quá hạn 591 triệu","m":"fines.by_type","e":"OVERDUE","op":"part_of","v":591000000,"tm":"fines.unpaid"}]}

METRIC:
{METRICS}

THỰC THỂ có trong dữ liệu:
{ENTITIES}
"""
_SHORT = {"q": "quote", "m": "metric", "e": "entity", "ce": "compared_entity", "s": "scope", "p": "period",
          "b": "budget_vnd", "op": "operator", "v": "value", "tm": "total_metric", "cf": "cause_factor", "k": "kind"}
_KIND = {"F": "FACT", "I": "INFERENCE", "A": "ASSUMPTION"}


def _expand(c: dict) -> dict:
    out = {_SHORT.get(k, k): v for k, v in c.items()}
    out["kind"] = _KIND.get(str(out.get("kind") or "F").upper()[:1], "FACT")
    out["scope"] = {"w": "warehouse", "sys": "system"}.get(out.get("scope"), out.get("scope"))
    return out


def _salvage(content: str) -> list[dict]:
    """Complete claim objects of a truncated / slightly malformed JSON reply."""
    out = []
    for m in re.finditer(r"\{[^{}]*\}", content or ""):
        try:
            obj = json.loads(m.group(0))
        except ValueError:
            continue
        if isinstance(obj, dict) and ("m" in obj or "metric" in obj):
            out.append(obj)
    return out


def _catalog(sheet: cv.Sheet, collected: dict) -> str:
    lines = []
    if sheet.warehouses or sheet.low_items or sheet.shortage:
        names = list(dict.fromkeys(list(sheet.warehouses) + [n for n in list(sheet.low_items) + list(sheet.shortage) if n]))
        lines.append("- Kho: " + "; ".join(names))
    if sheet.titles:
        lines.append("- Đầu sách: " + "; ".join(t["name"] for t in list(sheet.titles.values())[:40]))
    budgets = [s["budget"] for s in sheet.scenarios if s.get("budget")]
    if budgets:
        lines.append("- Kịch bản ngân sách (budget_vnd): " + "; ".join(str(int(b)) for b in budgets))
    if sheet.monthly:
        lines.append("- Tháng có dữ liệu: " + "; ".join(f"{y}-{m:02d}" for y, m in sorted(sheet.monthly)))
    fines = (collected.get("get_fine_summary") or {}) if isinstance(collected.get("get_fine_summary"), dict) else {}
    if fines.get("by_type"):
        lines.append("- Loại phạt: " + "; ".join(str(x.get("fine_type")) for x in fines["by_type"] if isinstance(x, dict)))
    return "\n".join(lines) or "- (không có)"


def worth_extracting(answer: str, collected: dict) -> bool:
    """No call for an answer without tool data or without a checkable figure /
    assessment (a greeting, a clarification, an out-of-scope refusal)."""
    if not collected or not answer or len(answer) < 40:
        return False
    norm = normalize_text(answer)
    return bool(re.search(r"\d", norm) or re.search(r"\b(on dinh|tang|giam|nhat|hon|nen|vi|do|toi uu|tot nhat)\b", norm))


async def extract(answer: str, sheet: cv.Sheet, collected: dict, provider, *, timeout: float = TIMEOUT_SECONDS) -> tuple[list[dict], dict]:
    """Layer 2: the answer's claims as dicts in the fixed vocabulary, plus the
    call's usage. Raises on a provider error (the caller degrades to Layer 1)."""
    system = _PROMPT.replace("{METRICS}", "\n".join(f"- {k}: {v[1]}" for k, v in METRICS.items())) \
        .replace("{ENTITIES}", _catalog(sheet, collected))
    from llm_provider import JSONContentError
    try:
        parsed, usage = await provider.chat_json(
            [{"role": "system", "content": system}, {"role": "user", "content": f"CÂU TRẢ LỜI:\n{answer}"}],
            max_tokens=MAX_TOKENS, timeout=timeout, feature="assistant_claims")
        claims = parsed.get("c", parsed.get("claims")) if isinstance(parsed, dict) else None
        claims = [c for c in claims if isinstance(c, dict)] if isinstance(claims, list) else []
    except JSONContentError as exc:
        claims, usage = _salvage(exc.content), exc.usage
    return [_expand(c) for c in claims], usage.as_dict()


# ── Layer 3: backend validation ──────────────────────────────────────────────

def _n(text) -> str:
    return re.sub(r"\s+", " ", normalize_text(str(text or ""))).strip()


def _find_title(name, sheet: cv.Sheet) -> str | None:
    key = cv._title_key(name)
    if not key:
        return None
    if key in sheet.titles:
        return key
    hits = [k for k in sheet.titles if len(key) >= 5 and (key in k or k in key)]
    return hits[0] if len(hits) == 1 else None


def _warehouse_names(sheet: cv.Sheet) -> list[str]:
    return list(dict.fromkeys(list(sheet.warehouses) + [n for n in list(sheet.low_items) + list(sheet.shortage) if n]))


def _find_warehouse(name, sheet: cv.Sheet) -> str | None:
    norm = _n(name)
    if not norm:
        return None
    for w in _warehouse_names(sheet):
        if any(norm == a or (len(a) >= 4 and a in norm) for a in cf._alias(w)):
            return w
    return None


def _scenario(claim: dict, sheet: cv.Sheet) -> dict | None:
    b = cv._num(claim.get("budget_vnd"))
    if b:
        hits = [s for s in sheet.scenarios if s.get("budget") and abs(s["budget"] - b) < 1]
        return hits[0] if hits else None
    return sheet.scenarios[0] if len(sheet.scenarios) == 1 else None


def _title_value(entry: dict, field: str):
    for scope in ("system", "warehouse"):
        v = (entry.get(scope) or {}).get(field)
        if v is not None:
            return v
    return None


_TITLE_FIELD = {"title.available": "available_qty", "title.borrows": "borrow_count", "title.trend": "demand_trend_pct",
                "title.reorder_qty": "suggested_reorder_qty", "title.cost": "estimated_cost", "title.unit_cost": "unit_cost",
                "title.lead_time": "lead_time_days", "title.days_to_stockout": "estimated_days_until_stockout"}
_WH_FIELD = {"warehouse.out_of_stock": "out_of_stock_variants", "warehouse.low_stock": "low_stock_variants",
             "warehouse.available": "total_available_qty", "warehouse.reserved": "total_reserved_qty",
             "warehouse.borrowed": "total_borrowed_qty"}
_SCEN_FIELD = {"budget.amount": "budget", "budget.approved_titles": "titles", "budget.approved_copies": "copies", "budget.approved_cost": "cost",
               "budget.remaining": "remaining", "budget.hp_approved": "hp_funded", "budget.hp_unapproved": "hp_unfunded"}


def _dict(collected: dict, name: str) -> dict:
    v = collected.get(name)
    return v if isinstance(v, dict) and not v.get("error") else {}


def _truth(metric: str, claim: dict, sheet: cv.Sheet, collected: dict):
    """(value, label, peers) for a value metric, or None when the data cannot
    tell. `peers`: [(name, value)] of the same metric for other entities, used
    to recognise a number given to the wrong warehouse / title / role."""
    if metric in _TITLE_FIELD:
        t = _find_title(claim.get("entity"), sheet)
        if not t:
            return None
        field = _TITLE_FIELD[metric]
        peers = [(sheet.titles[k]["name"], _title_value(sheet.titles[k], field)) for k in sheet.titles if k != t]
        return _title_value(sheet.titles[t], field), f"{sheet.titles[t]['name']} — {METRICS[metric][1]}", peers
    if metric in _WH_FIELD:
        field = _WH_FIELD[metric]
        rows = sheet.warehouses
        if claim.get("scope") == "system" and not claim.get("entity"):
            if not rows:
                return None
            return sum((r.get(field) or 0) for r in rows.values()), f"Tổng {len(rows)} kho — {METRICS[metric][1]}", \
                [(n, r.get(field)) for n, r in rows.items()]
        w = _find_warehouse(claim.get("entity"), sheet)
        if not w:
            return None
        if w in rows:
            peers = [(n, r.get(field)) for n, r in rows.items() if n != w]
            if len(rows) >= 2:
                peers.append((f"tổng {len(rows)} kho", sum((r.get(field) or 0) for r in rows.values())))
            return rows[w].get(field), f"{w} — {METRICS[metric][1]}", peers
        low = sheet.low_items.get(w) or {}
        if metric == "warehouse.low_stock" and low.get("total") is not None:
            return low["total"], f"{w} — {METRICS[metric][1]}", []
        if metric == "warehouse.out_of_stock" and low.get("oos") is not None:
            return low["oos"], f"{w} — {METRICS[metric][1]}", []
        short = sheet.shortage.get(w) or {}
        key = {"warehouse.low_stock": "low_stock_items", "warehouse.out_of_stock": "out_of_stock_items"}.get(metric)
        if key and short.get(key) is not None:
            return short[key], f"{w} — {METRICS[metric][1]}", []
        return None
    if metric in _SCEN_FIELD:
        s = _scenario(claim, sheet)
        if not s:
            return None
        field = _SCEN_FIELD[metric]
        peers = [(f"{s['label']} — {cv._ROLE_VI.get(k, k)}", s.get(k)) for k in _SCEN_FIELD.values() if k != field]
        peers += [(o["label"], o.get(field)) for o in sheet.scenarios if o is not s]
        return s.get(field), f"{s['label']} — {cv._ROLE_VI.get(field, field)}", peers
    if metric.startswith("reorder."):
        src = sheet.reorder_summary or {}
        key = {"reorder.titles": "total_candidates", "reorder.high_priority": "high_priority",
               "reorder.copies": "estimated_total_reorder_qty", "reorder.cost": "estimated_total_cost"}.get(metric)
        if not key:
            return None
        if not src and sheet.full_need:
            src = sheet.full_need
        return (src.get(key), METRICS[metric][1], []) if src else None
    if metric in ("loans.total", "returns.total", "reservations.total", "loans.per_day"):
        kind = metric.split(".")[0]
        period = str(claim.get("period") or "")
        m = re.match(r"^(\d{4})-(\d{2})$", period)
        if m and sheet.monthly:
            key = (int(m.group(1)), int(m.group(2)))
            if metric == "loans.per_day":
                return None
            value = sheet.monthly.get(key) if kind == "loans" else (sheet.monthly_other.get(key) or {}).get(kind)
            peers = [(f"{y}-{mo:02d}", v if kind == "loans" else (sheet.monthly_other.get((y, mo)) or {}).get(kind))
                     for (y, mo), v in sheet.monthly.items() if (y, mo) != key]
            return (value, f"{kind} {period}", peers) if key in sheet.monthly else None
        cmp = _dict(collected, "compare_borrow_periods")
        if period in ("current", "previous") and cmp:
            metrics = (cmp.get("metrics") or {}).get(kind) or {}
            field = period if metric != "loans.per_day" else f"{period}_per_day"
            other = "previous" if period == "current" else "current"
            peer_field = other if metric != "loans.per_day" else f"{other}_per_day"
            return metrics.get(field), f"{kind} kỳ {period}", [(f"kỳ {other}", metrics.get(peer_field))]
        return None
    if metric == "period.days":
        p = sheet.periods.get(str(claim.get("period") or "current")) or {}
        return (p.get("days"), "số ngày của kỳ", []) if p else None
    if metric == "loans.peak_day":
        p = sheet.periods.get(str(claim.get("period") or "current")) or {}
        return (p.get("peak_loans"), "lượt mượn ngày cao điểm", []) if p.get("peak_loans") is not None else None
    if metric in ("overdue.loans", "overdue.items", "overdue.avg_days"):
        o = sheet.overdue or {}
        key = {"overdue.loans": "total_overdue_loans", "overdue.items": "total_overdue_items",
               "overdue.avg_days": "average_overdue_days"}[metric]
        peers = [("số cuốn quá hạn", o.get("total_overdue_items")), ("số phiếu quá hạn", o.get("total_overdue_loans"))]
        return (o.get(key), METRICS[metric][1], [p for p in peers if p[0] != METRICS[metric][1]]) if o else None
    fines = _dict(collected, "get_fine_summary")
    kpis = _dict(collected, "get_dashboard_kpis")
    if metric == "fines.unpaid":
        if fines.get("total_unpaid") is not None:
            return fines["total_unpaid"], "Tiền phạt chưa thu", [("tiền phạt đã thu", fines.get("total_paid"))]
        if kpis.get("unpaid_fine_amount") is not None:
            return kpis["unpaid_fine_amount"], "Tiền phạt chưa thu", []
        return None
    if metric == "fines.paid":
        return (fines.get("total_paid"), "Tiền phạt đã thu", [("tiền phạt chưa thu", fines.get("total_unpaid"))]) \
            if fines.get("total_paid") is not None else None
    if metric == "fines.by_type":
        want = _n(claim.get("entity"))
        for x in fines.get("by_type") or []:
            if isinstance(x, dict) and _n(x.get("fine_type")) == want:
                return x.get("amount"), f"Tiền phạt loại {x.get('fine_type')} (gồm cả đã thu)", []
        return None
    kpi_key = {"kpi.active_loans": "active_loans", "kpi.total_titles": "total_titles", "kpi.total_copies": "total_copies",
               "kpi.low_stock": "low_stock_variants"}.get(metric)
    if kpi_key:
        return (kpis.get(kpi_key), METRICS[metric][1], []) if kpi_key in kpis else None
    if metric == "reservations.conversion_rate":
        funnel = _dict(collected, "get_reservation_funnel")
        v = funnel.get("conversion_rate", kpis.get("reservation_conversion_rate"))
        return (v, METRICS[metric][1], []) if v is not None else None
    return None


def _change(metric: str, claim: dict, sheet: cv.Sheet, collected: dict) -> list[float]:
    """Candidate % changes the data holds for a trend claim."""
    if metric == "title.trend":
        t = _find_title(claim.get("entity"), sheet)
        v = _title_value(sheet.titles[t], "demand_trend_pct") if t else None
        return [float(v)] if isinstance(v, (int, float)) else []
    kind = metric.split(".")[0]
    if kind == "loans":
        out = list(sheet.loan_pcts)
        if isinstance(sheet.trend_pct, (int, float)):
            out.append(float(sheet.trend_pct))
        return out
    return list(sheet.other_pcts.get(kind, []))


def _written(claim: dict, quote_norm: str):
    """The Mention in the quote that carries the claim's value - the closest
    one, within 2% (None when the value is not written there: an extraction
    we do not trust)."""
    value = cv._num(claim.get("value"))
    if value is None:
        return None
    best, gap = None, None
    for m in cv.mentions(quote_norm):
        for v in m.values:
            for cand in (abs(v), abs(v) * 1e6 if m.scale == 1 else None):
                if cand is None:
                    continue
                d = abs(cand - abs(value))
                if d <= max(1e-6, abs(value) * 0.02) and (gap is None or d < gap):
                    best, gap = m, d
    return best


def _locate(quote: str, answer: str) -> str | None:
    """The answer sentence holding `quote` (accent/space-insensitive)."""
    q = _n(quote)
    if len(q) < 4:
        return None
    for sent, _line in cv._sentences(answer):
        if q in _n(sent):
            return sent
    return q if q in _n(answer) else None


def _category(metric: str) -> str:
    unit = METRICS.get(metric, ("",))[0]
    return {"money": "MONEY", "%": "PERCENT"}.get(unit, "COUNT")


def _claim(out: list, text: str, category: str, verdict: str, detail: str, *, expected: str | None = None,
           evidence: list | None = None) -> None:
    c = cv.Claim(text[:200], category, verdict, detail, expected, evidence or [], cv._severity(category, verdict))
    c.basis = "semantic"
    out.append(c)


def _check_value(out, sent, metric, claim, m, sheet, collected) -> None:
    if metric.startswith("budget.") and metric != "budget.amount" and any(
            s.get("budget") and cv._matches(m, s["budget"]) for s in sheet.scenarios):
        return  # the scenario's own budget amount, read as another role: an extraction slip, not a claim
    found = _truth(metric, claim, sheet, collected)
    if not found:
        return
    truth, label, peers = found
    unit = METRICS[metric][0]
    unit_vi = {"money": "đ", "titles": "đầu sách", "copies": "bản", "events": "lượt", "%": "%", "days": "ngày",
               "tickets": "phiếu", "books": "cuốn"}.get(unit, "")
    if truth is None:
        if any(abs(v) < 0.5 for v in m.values):
            _claim(out, sent, "MISSING_DATA", cv.CONTRADICTED, f"{label}: dữ liệu không có giá trị (không phải 0).",
                   expected="không có dữ liệu")
        return
    if metric == "title.trend" or unit == "%":
        if cv._pct_close(m, abs(m.values[0]), float(truth)):
            _claim(out, sent, _category(metric), cv.SUPPORTED, f"Khớp dữ liệu ({label}).")
            return
    elif cv._matches(m, float(truth)):
        _claim(out, sent, _category(metric), cv.SUPPORTED, f"Khớp dữ liệu ({label}).")
        return
    other = [name for name, v in peers if isinstance(v, (int, float)) and cv._matches(m, float(v))]
    category = _category(metric)
    detail = f"{label}: {cv._fmt(float(truth), unit_vi)}"
    if other:
        if metric.startswith("warehouse.") and other[0].startswith("tổng"):
            category = "SCOPE"
        elif metric.startswith(("warehouse.", "title.")) and not other[0].startswith("tổng"):
            category = "ENTITY"
        detail += f"; {cv._fmt(m.values[0])} là của {other[0]}"
    _claim(out, sent, category, cv.CONTRADICTED, detail + ".", expected=cv._fmt(float(truth), unit_vi),
           evidence=[{"label": label, "value": truth, "unit": unit_vi}])


def _check_trend(out, sent, metric, claim, op, sheet, collected) -> None:
    pcts = _change(metric, claim, sheet, collected)
    if not pcts:
        return
    if op == "stable":
        bad = [p for p in pcts if abs(p) >= _STABLE_PCT]
        if bad and len(bad) == len(pcts):
            _claim(out, sent, "TREND", cv.CONTRADICTED, f"Dữ liệu cho thấy thay đổi {cv._fmt(bad[0])}% — không phải ổn định.",
                   expected=f"{'giảm' if bad[0] < 0 else 'tăng'} {cv._fmt(abs(bad[0]))}%")
        else:
            _claim(out, sent, "TREND", cv.SUPPORTED, "Mức thay đổi nhỏ.")
        return
    want_up = op == "increase"
    if all((p < -1) if want_up else (p > 1) for p in pcts):
        _claim(out, sent, "TREND", cv.CONTRADICTED, f"Dữ liệu: {'giảm' if pcts[0] < 0 else 'tăng'} {cv._fmt(abs(pcts[0]))}% — ngược chiều.",
               expected=f"{'giảm' if pcts[0] < 0 else 'tăng'} {cv._fmt(abs(pcts[0]))}%")
    elif any((p > 0) if want_up else (p < 0) for p in pcts):
        _claim(out, sent, "TREND", cv.SUPPORTED, "Cùng chiều với dữ liệu.")


def _peer_values(metric: str, sheet: cv.Sheet) -> dict:
    if metric in _WH_FIELD:
        return {n: r.get(_WH_FIELD[metric]) for n, r in sheet.warehouses.items()}
    if metric in _TITLE_FIELD:
        return {sheet.titles[k]["name"]: _title_value(sheet.titles[k], _TITLE_FIELD[metric]) for k in sheet.titles}
    return {}


def _check_rank(out, sent, metric, claim, op, sheet) -> None:
    if metric == "warehouse.risk":
        if not sheet.ranking or len(sheet.ranking) < 2:
            return
        w = _find_warehouse(claim.get("entity"), sheet)
        other = _find_warehouse(claim.get("compared_entity"), sheet)
        if not w:
            return
        pos = sheet.ranking.index(w) if w in sheet.ranking else None
        if pos is None:
            return
        # op high/max/gt = riskier; low/min/lt = safer
        riskier = op in ("max", "high", "gt")
        if op in ("max", "min"):
            target = sheet.ranking[0] if riskier else sheet.ranking[-1]
            ok = w == target or sheet.tie and riskier and _same_risk(w, sheet.ranking[0], sheet)
        elif other and other in sheet.ranking:
            ok = (pos < sheet.ranking.index(other)) if riskier else (pos > sheet.ranking.index(other))
            if _same_risk(w, other, sheet):
                return
        else:
            return
        _claim(out, sent, "RANKING", cv.SUPPORTED if ok else cv.CONTRADICTED,
               "Khớp xếp hạng rủi ro." if ok else f"Thứ tự rủi ro theo dữ liệu: {' > '.join(sheet.ranking)}.",
               expected=None if ok else f"rủi ro cao nhất: {sheet.ranking[0]}")
        return
    values = {k: v for k, v in _peer_values(metric, sheet).items() if isinstance(v, (int, float))}
    if len(values) < 2:
        return
    name = None
    if metric in _WH_FIELD:
        name = _find_warehouse(claim.get("entity"), sheet)
    elif metric in _TITLE_FIELD:
        t = _find_title(claim.get("entity"), sheet)
        name = sheet.titles[t]["name"] if t else None
    if not name or name not in values:
        return
    if op in ("max", "min"):
        target = max(values.values()) if op == "max" else min(values.values())
        ok = values[name] == target
        expected = None if ok else ", ".join(k for k, v in values.items() if v == target)
    else:
        if metric in _WH_FIELD:
            other = _find_warehouse(claim.get("compared_entity"), sheet)
        else:
            t2 = _find_title(claim.get("compared_entity"), sheet)
            other = sheet.titles[t2]["name"] if t2 else None
        if not other or other not in values or values[other] == values[name]:
            return
        ok = (values[name] > values[other]) if op == "gt" else (values[name] < values[other])
        expected = None if ok else f"{other}: {cv._fmt(values[other])}, {name}: {cv._fmt(values[name])}"
    _claim(out, sent, "RANKING", cv.SUPPORTED if ok else cv.CONTRADICTED,
           "Khớp dữ liệu." if ok else f"Theo dữ liệu, {expected}.", expected=expected)


def _same_risk(a: str, b: str, sheet: cv.Sheet) -> bool:
    from copilot_tools import _risk_key
    ra, rb = sheet.warehouses.get(a), sheet.warehouses.get(b)
    return bool(ra and rb and _risk_key(ra) == _risk_key(rb))


def _all_titles(collected: dict) -> set[str]:
    """Normalized keys of every title string anywhere in the tool data."""
    found: set[str] = set()

    def walk(v):
        if isinstance(v, dict):
            for k, x in v.items():
                if k == "title" and isinstance(x, str):
                    found.add(cv._title_key(x))
                else:
                    walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(collected)
    return found


def _in_titles(name, keys: set[str]) -> bool:
    key = cv._title_key(name)
    return bool(key) and any(key == k or (len(key) >= 5 and (key in k or k in key)) for k in keys)


def _check_title_status(out, sent, metric, claim, op, sheet, collected) -> None:
    """A title named as funded / unfunded / present: checked against the
    scenario's funded list and against every title the tool data holds. A
    title the data does not contain at all is UNSUPPORTED (named from nowhere)."""
    name = claim.get("entity")
    if not name:
        return
    if not _in_titles(name, _all_titles(collected)):
        _claim(out, sent, "ENTITY", cv.UNSUPPORTED, f"\"{name}\" không có trong dữ liệu đã truy xuất.")
        return
    if metric != "budget.title_status" or op not in ("funded", "unfunded"):
        return
    s = _scenario(claim, sheet)
    if not s or not s.get("funded_titles"):
        return
    funded = _in_titles(name, set(s["funded_titles"]))
    ok = funded == (op == "funded")
    _claim(out, sent, "ENTITY", cv.SUPPORTED if ok else cv.CONTRADICTED,
           "Khớp danh sách duyệt." if ok else
           f"{name} {'nằm trong' if funded else 'không nằm trong'} danh sách được duyệt của {s['label']}.",
           expected=None if ok else ("được duyệt" if funded else "chưa được duyệt"))


def _check_absent(out, sent, metric, claim, sheet, collected) -> None:
    """"Dữ liệu chưa có X" while the tool data holds X: the answer withholds a
    figure it had (MISSING_DATA, the inverse of treating a gap as 0)."""
    if metric in _TITLE_FIELD or metric in _WH_FIELD or metric in _SCEN_FIELD:
        return  # entity-level absence is too often true for one entity
    found = _truth(metric, claim, sheet, collected)
    if metric == "title.wishlist" or (found is None and metric == "title.in_data"):
        return
    if found and found[0] is not None:
        _claim(out, sent, "MISSING_DATA", cv.CONTRADICTED,
               f"Dữ liệu có {found[1]}: {cv._fmt(float(found[0]))}.", expected=cv._fmt(float(found[0])))


_DIFF_QUOTE = re.compile(r"\b(them|tang them|chi them|nhieu hon|it hon|chenh lech|so voi|giam|tang|bot|tu .{1,30} len)\b")


def _sentence_budget_vs_cost(out: list, claims: list[dict], answer: str) -> None:
    """Within one sentence, an approved cost written larger than the budget
    written next to it ("còn 8.000.000 ₫, hệ thống duyệt 68.576.100 ₫") cannot
    both be one scenario's figures."""
    by_sent: dict = {}
    for c in claims or []:
        if not isinstance(c, dict) or c.get("metric") not in ("budget.amount", "budget.approved_cost"):
            continue
        sent = _locate(c.get("quote") or "", answer)
        m = _written(c, _n(c.get("quote"))) if sent else None
        if m and str(c.get("operator") or "eq") == "eq":
            by_sent.setdefault(sent, {}).setdefault(c["metric"], []).append(abs(m.values[0]))
    for sent, vals in by_sent.items():
        budgets, costs = vals.get("budget.amount") or [], vals.get("budget.approved_cost") or []
        if len(budgets) == 1 and costs and all(cost > budgets[0] * 1.0001 for cost in costs):
            _claim(out, sent, "BUDGET", cv.CONTRADICTED,
                   f"Chi phí duyệt {cv._fmt(costs[0], 'đ')} lớn hơn ngân sách {cv._fmt(budgets[0], 'đ')} nêu cùng câu — "
                   "hai số không thuộc cùng một phương án.", expected="chi phí duyệt ≤ ngân sách")


def validate(claims: list[dict], answer: str, sheet: cv.Sheet, collected: dict) -> list[cv.Claim]:
    """Layer 3: a verdict per extracted claim from the tool data only. A claim
    whose quote is not in the answer, whose value is not written in its quote,
    or whose metric / entity / scenario the data does not hold yields nothing."""
    out: list[cv.Claim] = []
    for c in claims or []:
        try:
            metric, op = str(c.get("metric") or ""), str(c.get("operator") or "eq")
            if metric not in METRICS or op not in OPERATORS:
                continue
            sent = _locate(c.get("quote") or "", answer)
            if not sent:
                continue
            norm = _n(sent)
            q = _n(c.get("quote"))
            hedged = str(c.get("kind") or "FACT").upper() != "FACT"
            if op == "absent":  # "dữ liệu chưa cho biết lý do" acknowledges a gap - never a cause / optimality claim
                _check_absent(out, sent, metric, c, sheet, collected)
                continue
            if metric == "cause":
                factor = str(c.get("cause_factor") or "other")
                if hedged or factor in _MEASURED_CAUSES or cf._negated(norm, max(0, norm.find(q))):
                    continue
                _claim(out, sent, "CAUSALITY", cv.UNSUPPORTED,
                       "Dữ liệu hệ thống không ghi nhận yếu tố này, nên không thể khẳng định đây là nguyên nhân.")
                continue
            if metric == "optimality":
                if hedged or re.search(r"\b(theo (thu tu|muc) uu tien|thu tu cua he thong|xep hang cua he thong)\b", norm):
                    continue
                _claim(out, sent, "OPTIMALITY", cv.UNSUPPORTED,
                       "Hệ thống xếp thứ tự theo quy tắc, không tối ưu hóa toàn cục — không thể gọi là tối ưu/tốt nhất.")
                continue
            if metric == "title.stock_level" and op == "out_of_stock":
                t = _find_title(c.get("entity"), sheet)
                avail = _title_value(sheet.titles[t], "available_qty") if t else None
                if isinstance(avail, (int, float)):
                    ok = avail <= 0
                    _claim(out, sent, "ENTITY", cv.SUPPORTED if ok else cv.CONTRADICTED,
                           "Khớp: đầu sách hết hàng." if ok else
                           f"{sheet.titles[t]['name']} còn {cv._fmt(avail)} bản khả dụng — không phải hết hàng.",
                           expected=None if ok else f"còn {cv._fmt(avail)} bản")
                continue
            if metric in ("budget.title_status", "title.in_data"):
                _check_title_status(out, sent, metric, c, op, sheet, collected)
                continue
            if metric == "budget.compliance" and op in ("within", "exceeds"):
                if not re.search(r"\b(duyet|chi phi duoc duyet|da chi|su dung)\b", q) or _DIFF_QUOTE.search(q):
                    continue  # about the full need vs the budget, or a difference - not the approved cost
                s = _scenario(c, sheet)
                pool = [s] if s else sheet.scenarios
                pool = [x for x in pool if x and x.get("budget") and x.get("cost") is not None]
                if not pool:
                    continue
                over = [x for x in pool if x["cost"] > x["budget"]]
                ok = (not over) if op == "within" else bool(over)
                _claim(out, sent, "BUDGET", cv.SUPPORTED if ok else cv.CONTRADICTED,
                       "Khớp dữ liệu ngân sách." if ok else "Chi phí duyệt của phương án không vượt ngân sách.",
                       expected=None if ok else "không vượt ngân sách")
                continue
            if metric == "budget.coverage" or op == "covers_all":
                if op == "covers_all" and sheet.coverage_incomplete and not re.search(
                        r"\b(chua|khong|khong the|chi)\b[^.]{0,25}\b(bu|dap ung|bao phu|giai quyet)\b", norm):
                    _claim(out, sent, "COVERAGE", cv.CONTRADICTED,
                           "Dữ liệu cho thấy vẫn còn đầu sách ưu tiên cao chưa được duyệt.", expected="chưa đáp ứng toàn bộ")
                continue
            if metric == "reorder.first" or op == "first":
                t = _find_title(c.get("entity"), sheet)
                first = cv._title_key(sheet.first_recommended) if sheet.first_recommended else None
                if t and first:
                    ok = t == first
                    rank = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
                    if not ok and rank.get(_title_value(sheet.titles[t], "priority"), 3) <= rank.get(
                            _title_value(sheet.titles.get(first, {}), "priority"), 3):
                        continue  # same priority as the system's first: an alternative order, not a contradiction
                    _claim(out, sent, "RECOMMENDATION", cv.SUPPORTED if ok else cv.CONTRADICTED,
                           "Khớp thứ tự đề xuất." if ok else f"Đầu sách đứng đầu thứ tự đề xuất là {sheet.first_recommended}.",
                           expected=None if ok else sheet.first_recommended)
                continue
            if metric == "title.stock_level" and op in ("low", "high"):
                t = _find_title(c.get("entity"), sheet)
                if not t:
                    continue
                e = sheet.titles[t]
                avail, rp = _title_value(e, "available_qty"), _title_value(e, "reorder_point")
                days, lt = _title_value(e, "estimated_days_until_stockout"), _title_value(e, "lead_time_days") or 14
                if op == "low" and isinstance(avail, (int, float)) and isinstance(rp, (int, float)) and avail > rp \
                        and isinstance(days, (int, float)) and days > 2 * lt:
                    _claim(out, sent, "ASSESSMENT", cv.CONTRADICTED,
                           f"{e['name']}: còn {cv._fmt(avail)} bản, trên ngưỡng {cv._fmt(rp)} và ước tính {cv._fmt(days)} ngày mới hết.",
                           expected="tồn kho không thấp so với ngưỡng")
                continue
            if op in ("increase", "decrease", "stable") and metric in ("loans.change", "returns.change",
                                                                        "reservations.change", "title.trend"):
                if not c.get("value"):
                    _check_trend(out, sent, metric, c, op, sheet, collected)
                    continue
            if op in ("max", "min", "gt", "lt", "high", "low") and (metric in _WH_FIELD or metric in _TITLE_FIELD
                                                                    or metric == "warehouse.risk"):
                if op in ("high", "low") and metric != "warehouse.risk":
                    continue
                _check_rank(out, sent, metric, c, op, sheet)
                continue
            if op == "part_of":
                total_metric = str(c.get("total_metric") or "")
                m = _written(c, q)
                if not m or total_metric not in METRICS:
                    continue
                part = _truth(metric, c, sheet, collected)
                total = _truth(total_metric, {**c, "entity": None}, sheet, collected)
                if total and isinstance(total[0], (int, float)) and m.values[0] > float(total[0]) * 1.001:
                    _claim(out, sent, _category(total_metric), cv.CONTRADICTED,
                           f"{cv._fmt(m.values[0])} lớn hơn tổng ({total[1]}: {cv._fmt(float(total[0]))}), không thể là một phần của nó"
                           + (f"; đó là {part[1]}." if part and isinstance(part[0], (int, float)) and cv._matches(m, float(part[0])) else "."),
                           expected=f"≤ {cv._fmt(float(total[0]))}")
                continue
            if op in ("eq", "increase", "decrease") and METRICS[metric][0]:
                m = _written(c, q)
                if m is None or m.unit in ("months", "years", "weeks") and metric not in ("period.days",):
                    continue
                if metric.endswith(".change") or metric == "title.trend":
                    pcts = _change(metric, c, sheet, collected)
                    if not pcts or m.unit != "%":
                        continue
                    sign = -1 if op == "decrease" or m.raw.startswith(("-", "−")) else 1
                    same = [p for p in pcts if cv._pct_close(m, abs(m.values[0]), p) and (p > 0) == (sign > 0)]
                    flipped = [p for p in pcts if cv._pct_close(m, abs(m.values[0]), p) and (p > 0) != (sign > 0) and p]
                    if same or op == "eq" and any(cv._pct_close(m, abs(m.values[0]), p) for p in pcts):
                        _claim(out, sent, "PERCENT", cv.SUPPORTED, "Khớp mức thay đổi.")
                    elif flipped:
                        _claim(out, sent, "PERCENT", cv.CONTRADICTED, f"Dữ liệu: {'giảm' if flipped[0] < 0 else 'tăng'} "
                               f"{cv._fmt(abs(flipped[0]))}% — ngược chiều.", expected=f"{cv._fmt(flipped[0])}%")
                    elif op != "eq":
                        _claim(out, sent, "PERCENT", cv.CONTRADICTED,
                               "Mức thay đổi trong dữ liệu: " + ", ".join(f"{cv._fmt(p)}%" for p in pcts[:3]) + ".",
                               expected=f"{cv._fmt(pcts[0])}%")
                    continue
                if metric.startswith(("budget.", "reorder.")) and _DIFF_QUOTE.search(q):
                    # "thêm 3 đầu sách", "giảm 22 đầu sách bỏ lại": a difference between
                    # scenarios, never a total - only a known difference supports it
                    diffs = _scenario_diffs(sheet)
                    if any(cv._matches(m, d) for d in diffs):
                        _claim(out, sent, _category(metric), cv.SUPPORTED, "Khớp chênh lệch giữa các phương án.")
                    continue
                _check_value(out, sent, metric, c, m, sheet, collected)
        except Exception:  # noqa: BLE001 - one odd claim is skipped, never fails the answer
            logger.debug("semantic claim skipped", exc_info=True)
    try:
        _sentence_budget_vs_cost(out, claims, answer)
    except Exception:  # noqa: BLE001
        logger.debug("budget/cost cross-check skipped", exc_info=True)
    return out


def _scenario_diffs(sheet: cv.Sheet) -> list[float]:
    out = []
    for f in ("titles", "copies", "cost", "remaining", "hp_funded", "hp_unfunded", "budget"):
        vals = [s[f] for s in sheet.scenarios if s.get(f) is not None]
        out += [abs(b - a) for i, a in enumerate(vals) for b in vals[i + 1:]]
    for s in sheet.scenarios:
        out += [abs(v) for v in (s.get("diff") or {}).values() if isinstance(v, (int, float))]
    return out
