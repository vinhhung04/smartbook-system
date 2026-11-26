"""Decision object and execution timeline of an inventory-rebalancing turn,
built from analyze_inventory_rebalancing results only (never the model's
text). A what-if turn carries two results (the scenario it changes, then the
new one); the difference between them is computed here."""
from __future__ import annotations

import re

from copilot_decision import _n, _pct, _vnd

TOOL = "analyze_inventory_rebalancing"
_METRICS = ("total_shortage_qty", "transfer_qty", "purchase_qty", "covered_qty", "remaining_shortage_qty",
            "remaining_high_priority_qty", "shortage_covered_pct", "purchase_cost_vnd", "transfer_cost_vnd",
            "budget_vnd", "remaining_budget_vnd", "collaborative_transfer_lines", "collaborative_transfer_qty",
            "unpriced_qty", "transfer_lead_time_days", "purchase_lead_time_days", "response_days", "risk_level", "risks")
_DIFF = ("shortage_covered_pct", "remaining_shortage_qty", "remaining_high_priority_qty", "purchase_cost_vnd",
         "transfer_qty", "purchase_qty", "remaining_budget_vnd")
_TIMELINE = (("permission", "Xác minh quyền kho"), ("inventory", "Thu thập tồn kho"), ("demand", "Phân tích nhu cầu"),
             ("shortage", "Phát hiện thiếu / dư"), ("transfer", "Phân tích điều chuyển"),
             ("procurement", "Tối ưu mua mới"), ("scenario", "Mô phỏng kịch bản"),
             ("verification", "Kiểm chứng câu trả lời"), ("result", "Tạo kết quả"))
_ANALYTICS_STAGES = ("inventory", "demand", "shortage", "transfer", "procurement", "scenario")


def results(collected: dict) -> list:
    """The rebalancing results of the turn in call order (base first, current last)."""
    keys = sorted((k for k in (collected or {}) if k.split("#")[0] == TOOL),
                  key=lambda k: int(k.split("#")[1]) if "#" in k else 1)
    return [collected[k] for k in keys]


def _best(result: dict) -> dict:
    rec = result.get("recommendation") or {}
    return (result.get("options") or {}).get(rec.get("best_business_option")) or {}


def _executable(result: dict) -> dict:
    rec = result.get("recommendation") or {}
    return (result.get("options") or {}).get(rec.get("executable_option")) or {}


def _diff(b: dict, c: dict) -> dict:
    out = {}
    for k in _DIFF:
        x, y = b.get(k), c.get(k)
        out[k] = round(y - x, 2) if isinstance(x, (int, float)) and isinstance(y, (int, float)) else None
    return out


def _comparison(base: dict, current: dict) -> dict:
    b, c = _best(base), _best(current)

    def side(result, opt):
        return {"budget_vnd": result.get("budget_vnd"), "what_if": result.get("what_if") or {},
                "best_option": (result.get("recommendation") or {}).get("best_business_option"),
                **{k: opt.get(k) for k in _DIFF}}

    out = {"base": side(base, b), "current": side(current, c), "diff": _diff(b, c)}
    # the plan the user can carry out alone often moves when the best one does not
    # (live 2026-11-26: budget 15 M -> 12 M left the hybrid at 100 %, the executable one fell to 88 %)
    eb, ec = _executable(base), _executable(current)
    if eb and ec and (eb is not b or ec is not c):
        out["executable"] = {"label": ec.get("label"), "code": ec.get("code"),
                             "base": {k: eb.get(k) for k in _DIFF}, "current": {k: ec.get(k) for k in _DIFF},
                             "diff": _diff(eb, ec)}
    return out


def build(plan, collected: dict, verification: dict | None = None) -> dict | None:
    found = results(collected)
    if not found:
        return None
    current = found[-1] if isinstance(found[-1], dict) else {"error": "no result"}
    if current.get("error"):
        return {"kind": "rebalance", "error": current.get("error"),
                "permission_denied": bool(current.get("permission_denied")),
                "scope_unavailable": bool(current.get("scope_unavailable"))}
    rec = current.get("recommendation") or {}
    options = current.get("options") or {}
    best, executable = rec.get("best_business_option"), rec.get("executable_option")
    diag = current.get("diagnosis") or []
    best_opt = options.get(best) or {}
    conclusion = None
    if best_opt:
        conclusion = (f"{best_opt.get('label')}: đáp ứng {_pct(best_opt.get('shortage_covered_pct'))} thiếu hụt "
                      f"({_n(best_opt.get('covered_qty'))}/{_n(best_opt.get('total_shortage_qty'))} bản), chi phí mua "
                      f"mới {_vnd(best_opt.get('purchase_cost_vnd'))}, rủi ro {best_opt.get('risk_level')}.")
        if executable and executable != best:
            ex = options.get(executable) or {}
            conclusion += f" Phần bạn tự thực hiện được: {ex.get('label')}, đáp ứng {_pct(ex.get('shortage_covered_pct'))}."
    base = found[0] if len(found) >= 2 and isinstance(found[0], dict) and not found[0].get("error") else None
    reb = (getattr(plan, "entities", None) or {}).get("rebalance") or {}
    return {
        "kind": "rebalance",
        "focus": reb.get("focus") or [],
        "conclusion": conclusion,
        "scope": current.get("scope") or [],
        "notice": current.get("notice"),
        "diagnosis": {
            "warehouses_analyzed": len(diag),
            "shortage_variants": sum(d.get("shortage_variants") or 0 for d in diag),
            "surplus_variants": sum(d.get("surplus_variants") or 0 for d in diag),
            "shortage_qty": sum(d.get("shortage_qty") or 0 for d in diag),
            "surplus_qty": sum(d.get("surplus_qty") or 0 for d in diag),
            "forecast_demand_qty": round(sum(d.get("forecast_demand_qty") or 0 for d in diag), 1),
            "per_warehouse": diag,
        },
        "options": [{"code": code, "label": o.get("label"), "is_best": code == best, "is_executable": code == executable,
                     **{k: o.get(k) for k in _METRICS}} for code, o in options.items()],
        "recommendation": {"best_business_option": best, "executable_option": executable, "rule": rec.get("rule"),
                           "best_label": rec.get("best_business_label"), "executable_label": rec.get("executable_label")},
        "transfers": best_opt.get("transfers") or [],
        "purchases": best_opt.get("purchases") or [],
        "top_shortages": current.get("top_shortages") or [],
        "top_surpluses": current.get("top_surpluses") or [],
        "budget_vnd": current.get("budget_vnd"),
        "what_if": current.get("what_if") or {},
        "comparison": _comparison(base, current) if base else None,
        "assumptions": current.get("assumptions") or [],
        "data_quality": current.get("data_quality") or {},
        "evidence": {"source": current.get("source"), "retrieved_at": current.get("retrieved_at")},
        "verification": (verification or {}).get("status"),
    }


def timeline(plan, collected: dict, verification: dict | None = None) -> list[dict]:
    """The stages the turn really went through: an analytics stage is "done"
    only when the result came back; a failed or skipped stage says so.
    [] for a turn that is not a rebalancing one."""
    found = results(collected)
    if not found:
        return []
    current = found[-1] if isinstance(found[-1], dict) else {"error": "no result"}
    status: dict[str, str] = {}
    if current.get("error"):
        denied = current.get("permission_denied") or current.get("scope_unavailable")
        status["permission"] = "failed" if denied else "done"
        status.update({k: "skipped" if denied else "failed" for k in _ANALYTICS_STAGES})
    elif not current.get("scope"):
        status["permission"] = "done"  # verified: the account reads no warehouse
        status.update({k: "skipped" for k in _ANALYTICS_STAGES})
    else:
        status.update({k: "done" for k in ("permission", *_ANALYTICS_STAGES[:-1])})
        status["scenario"] = "done" if len(found) >= 2 or current.get("what_if") else "skipped"
    v = (verification or {}).get("status")
    status["verification"] = {"BLOCKED": "failed", "WARNING": "warning"}.get(v, "done" if v else "skipped")
    status["result"] = "done"
    at = current.get("retrieved_at")
    return [{"key": key, "label": label, "status": status[key],
             **({"at": at} if at and status[key] == "done" and key in ("permission", *_ANALYTICS_STAGES) else {})}
            for key, label in _TIMELINE]


def _direction(value, unit: str = "") -> str:
    if not isinstance(value, (int, float)):
        return "không có dữ liệu"
    if value == 0:
        return "không đổi"
    text = f"{abs(value):,.1f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{'tăng' if value > 0 else 'giảm'} {text}{unit}"


def numbers_in(collected: dict) -> list[float]:
    """The what-if differences comparison_brief shows the model (e.g. "giảm 15,3 điểm %"),
    so quoting them is grounded (live 2026-11-26: 15,3 was flagged)."""
    found = results(collected)
    if len(found) < 2 or not all(isinstance(r, dict) and not r.get("error") for r in (found[0], found[-1])):
        return []
    cmp = _comparison(found[0], found[-1])
    diffs = [cmp["diff"], (cmp.get("executable") or {}).get("diff") or {}]
    for code, option in (found[-1].get("options") or {}).items():
        diffs.append(_diff((found[0].get("options") or {}).get(code) or {}, option))
    return [abs(v) for d in diffs for v in d.values() if isinstance(v, (int, float))]


def comparison_brief(collected: dict) -> str | None:
    """The old -> new difference of a what-if turn, with its direction already
    worded, so the answer copies "tăng / giảm" instead of inferring it."""
    found = results(collected)
    if len(found) < 2 or not all(isinstance(r, dict) and not r.get("error") for r in (found[0], found[-1])):
        return None
    cmp = _comparison(found[0], found[-1])
    d = cmp["diff"]
    lines = ["## Chênh lệch giữa kịch bản trước và kịch bản mới (đã tính sẵn, dùng đúng chiều tăng/giảm này)",
             f"- Phương án tốt nhất: {cmp['base']['best_option']} → {cmp['current']['best_option']}",
             f"- Mức đáp ứng thiếu hụt: {_direction(d['shortage_covered_pct'], ' điểm %')}",
             f"- Số bản còn thiếu: {_direction(d['remaining_shortage_qty'], ' bản')}",
             f"- Chi phí mua mới: {_direction(d['purchase_cost_vnd'], ' ₫')}",
             f"- Ngân sách còn lại: {_direction(d['remaining_budget_vnd'], ' ₫')}",
             f"- Số bản điều chuyển: {_direction(d['transfer_qty'], ' bản')}"]
    best, budget = _best(found[-1]), found[-1].get("budget_vnd")
    cost = best.get("purchase_cost_vnd")
    if d["shortage_covered_pct"] == 0 and isinstance(cost, (int, float)) and isinstance(budget, (int, float)) and cost <= budget:
        lines.append(f"- Phương án tốt nhất không bị ngân sách mới giới hạn (chi phí mua {_vnd(cost)} ≤ ngân sách {_vnd(budget)}), "
                     "nên mức đáp ứng của nó không đổi; nói rõ điều này.")
    ex = cmp.get("executable")
    if ex:
        e = ex["diff"]
        lines.append(f"- Phương án bạn tự thực hiện được ({ex['label']}): mức đáp ứng {ex['base']['shortage_covered_pct']}% → "
                     f"{ex['current']['shortage_covered_pct']}% ({_direction(e['shortage_covered_pct'], ' điểm %')}); còn thiếu "
                     f"{ex['base']['remaining_shortage_qty']} → {ex['current']['remaining_shortage_qty']} bản; chi phí mua "
                     f"{_vnd(ex['base']['purchase_cost_vnd'])} → {_vnd(ex['current']['purchase_cost_vnd'])}")
    for code, option in (found[-1].get("options") or {}).items():
        base = (found[0].get("options") or {}).get(code) or {}
        new, old = option.get("shortage_covered_pct"), base.get("shortage_covered_pct")
        if isinstance(new, (int, float)) and isinstance(old, (int, float)):
            lines.append(f"- {option.get('label')} ({code}): mức đáp ứng {old}% → {new}% ({_direction(new - old, ' điểm %')}); "
                         f"chi phí mua {_vnd(base.get('purchase_cost_vnd'))} → {_vnd(option.get('purchase_cost_vnd'))}")
    lines.append("- Mỗi con số trên thuộc đúng phương án ghi cạnh nó; không gán số của phương án này cho phương án khác.")
    return "\n".join(lines)


def confirm_timeline(execution: dict) -> list[dict]:
    """Stages of a "Tôi xác nhận" turn, from the executor's outcome only."""
    if execution.get("action_id") is None:
        return []
    status, result = execution.get("status"), execution.get("result") or {}
    ran = status in ("EXECUTED", "RECONCILE_REQUIRED")
    created = bool(result.get("created_transfers") or result.get("created_purchase_requests"))
    stock_checked = ran and bool(result.get("created_transfers") or result.get("skipped"))
    steps = (("permission", "Kiểm tra lại quyền (không dùng cache)", "done" if ran else "failed"),
             ("dedupe", "Chống tạo trùng", "done" if ran else "skipped"),
             ("stock", "Kiểm tra tồn kho kho nguồn", "done" if stock_checked else "skipped"),
             ("execute", "Tạo yêu cầu theo quy trình", "done" if created else ("warning" if ran else "skipped")),
             ("result", "Tạo kết quả", "done"))
    return [{"key": k, "label": label, "status": st} for k, label, st in steps]


_NEEDS_OTHER = re.compile(r"(manager|quản lý|quan ly|người quản lý)\s+(của\s+)?(các\s+)?(kho\s+)?([^.;:\n]{0,60})", re.IGNORECASE)


def _write_aliases(collected: dict) -> dict[str, str]:
    """Normalized names of the warehouses the user may WRITE (the ones nobody else must act on)."""
    from copilot_plan import normalize_query
    found = results(collected)
    current = found[-1] if found and isinstance(found[-1], dict) else {}
    aliases = {}
    for w in current.get("scope") or []:
        if w.get("access") != "WRITE" or not w.get("warehouse"):
            continue
        name = normalize_query(w["warehouse"])
        aliases[name] = w["warehouse"]
        short = re.sub(r"^(kho|chi nhanh) ", "", name)
        if len(short) >= 2:
            aliases[short] = w["warehouse"]
    return aliases


def permission_issues(answer: str, collected: dict) -> list[str]:
    """Sentences saying a manager of a warehouse the user fully controls has to
    approve / coordinate (live run 2026-11-20: "cần Manager kho Hà Nội/Đà Nẵng
    phê duyệt" while Đà Nẵng is FULL). Checked from the scope, not from wording."""
    from copilot_plan import normalize_query
    aliases = _write_aliases(collected)
    if not aliases or not answer:
        return []
    out = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", answer):
        for m in _NEEDS_OTHER.finditer(sentence):
            # the warehouses named right after "manager / quản lý (kho)", up to the first verb
            target = re.split(r"\b(phe duyet|phoi hop|de|xin|tao|ho tro|giup|chuyen|ve|cho|neu|thi|khi)\b",
                              normalize_query(m.group(5)))[0]
            if any(re.search(rf"\b{re.escape(a)}\b", target) for a in aliases):
                out.append(sentence)
                break
    return out


def permission_instruction(sentences: list[str], collected: dict) -> str | None:
    if not sentences:
        return None
    own = sorted(set(_write_aliases(collected).values()))
    return ("Sai về quyền: người dùng có toàn quyền tại " + ", ".join(own) + ", nên không cần Manager hay quản lý nào "
            "phối hợp / phê duyệt ở các kho này; chỉ kho \"chỉ xem\" mới cần phối hợp. Viết lại các câu: "
            + " | ".join(s.strip()[:160] for s in sentences))


def strip_sentences(answer: str, sentences: list[str]) -> str:
    for s in sentences:
        answer = answer.replace(s, "")
    return re.sub(r"\n{3,}", "\n\n", answer).strip()


# a recommendation, or naming the option as THE way to act alone / without waiting
# (a plain description "bạn tự thực hiện được nhưng còn thiếu 10 bản" is fine)
_RECOMMEND = re.compile(r"\b(nen|de xuat|khuyen nghi|kha thi|toi uu|hop ly nhat)\b|"
                        r"\bla (phuong an|giai phap|lua chon)\b.{0,50}\b(tu thuc hien|tu chu|doc lap|khong (can|cho|phu thuoc))\b")
_OPTION_WORDS = {
    "PROCUREMENT_ONLY": re.compile(r"procurement_only|\bchi mua moi\b"),
    "TRANSFER_ONLY": re.compile(r"transfer_only|\bchi dieu chuyen\b"),
}


def option_issues(answer: str, collected: dict) -> list[str]:
    """Sentences recommending an option the plan's own figures show is worse
    than one the user can carry out themselves (live run 2026-11-20: "chỉ mua
    mới, 84,1 %" recommended while the self-executable hybrid covered 100 %
    within the same budget). Conditional wording does not excuse it: the
    self-executable option already covers "if you want to act alone".
    A dominated option merely described ("chỉ đáp ứng 84,1%") passes."""
    from copilot_plan import normalize_query
    found = results(collected)
    current = found[-1] if found and isinstance(found[-1], dict) else {}
    options = current.get("options") or {}
    rec = current.get("recommendation") or {}
    allowed = {rec.get("best_business_option"), rec.get("executable_option")}
    ref = options.get(rec.get("executable_option")) or options.get(rec.get("best_business_option")) or {}
    if not answer or not ref:
        return []
    dominated = {code for code, pattern in _OPTION_WORDS.items()
                 if code not in allowed and code in options
                 and (options[code].get("shortage_covered_pct") or 0) < (ref.get("shortage_covered_pct") or 0)}
    out = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", answer):
        text = normalize_query(sentence)
        if not text or not _RECOMMEND.search(text):
            continue
        if any(_OPTION_WORDS[code].search(text) for code in dominated):
            out.append(sentence)
    return out


def answer_issues(answer: str, collected: dict) -> list[str]:
    return permission_issues(answer, collected) + option_issues(answer, collected)


def answer_instruction(sentences: list[str], collected: dict) -> str | None:
    if not sentences:
        return None
    parts = []
    if permission_issues(" ".join(sentences), collected):
        parts.append(permission_instruction(sentences, collected))
    current = (results(collected) or [{}])[-1] or {}
    rec = current.get("recommendation") or {}
    ex = (current.get("options") or {}).get(rec.get("executable_option")) or {}
    if option_issues(" ".join(sentences), collected) and ex:
        parts.append(f"Sai khuyến nghị: phương án người dùng tự thực hiện được là {ex.get('label')} "
                     f"(đáp ứng {ex.get('shortage_covered_pct')}%, chi phí mua {ex.get('purchase_cost_vnd')} ₫); "
                     f"tốt nhất về nghiệp vụ là {rec.get('best_business_label') or rec.get('best_business_option')}. "
                     "Không đề xuất phương án có mức đáp ứng thấp hơn hai phương án này. Viết lại: "
                     + " | ".join(x.strip()[:160] for x in sentences))
    return " ".join(p for p in parts if p) or None



def recommendation_sentence(collected: dict) -> str | None:
    """The recommendation in the plan's own terms, put back when a wrong one had
    to be removed from the answer."""
    found = results(collected)
    current = found[-1] if found and isinstance(found[-1], dict) else {}
    options = current.get("options") or {}
    rec = current.get("recommendation") or {}
    best, ex = options.get(rec.get("best_business_option")), options.get(rec.get("executable_option"))
    if not best:
        return None

    def money(v):
        return f"{int(v or 0):,}".replace(",", ".") + " ₫"

    text = (f"Phương án tốt nhất về nghiệp vụ là **{best.get('label')}**: đáp ứng {best.get('shortage_covered_pct')}% thiếu hụt, "
            f"chi phí mua mới {money(best.get('purchase_cost_vnd'))}.")
    if ex and ex is not best:
        text += (f" Nếu bạn muốn tự thực hiện toàn bộ, không chờ kho khác phối hợp: **{ex.get('label')}**, đáp ứng "
                 f"{ex.get('shortage_covered_pct')}%, chi phí mua mới {money(ex.get('purchase_cost_vnd'))}.")
    return text
