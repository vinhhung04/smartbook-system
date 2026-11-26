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
        if current.get("book"):
            conclusion = f"Riêng cuốn \"{current['book'].get('title')}\" — {conclusion}"
    base = found[0] if len(found) >= 2 and isinstance(found[0], dict) and not found[0].get("error") else None
    reb = (getattr(plan, "entities", None) or {}).get("rebalance") or {}
    return {
        "kind": "rebalance",
        "focus": reb.get("focus") or [],
        "conclusion": conclusion,
        "book": current.get("book"),
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


_COPIES = re.compile(r"(\d+(?:[.,]\d+)?)\s*ban\b")


def _demand_and_shortage(collected: dict) -> tuple[set[int], set[int]]:
    found = results(collected)
    current = found[-1] if found and isinstance(found[-1], dict) else {}
    demand = {round(d.get("forecast_demand_qty") or 0) for d in current.get("diagnosis") or []} - {0}
    shortage = {round(o.get(k) or 0) for o in (current.get("options") or {}).values()
                for k in ("total_shortage_qty", "covered_qty", "transfer_qty", "purchase_qty", "remaining_shortage_qty")}
    shortage |= {round(d.get(k) or 0) for d in current.get("diagnosis") or [] for k in ("shortage_qty", "surplus_qty")}
    return demand, shortage


def demand_issues(answer: str, collected: dict) -> list[str]:
    """Sentences giving the forecast demand as what the plan covers (live 2026-11-26: "đáp ứng
    100% nhu cầu dự kiến (6 bản)" while the plan covers a shortage of 11 = lead-time demand +
    safety stock). "Đáp ứng X%" is a share of the shortage, never of the forecast demand."""
    from copilot_plan import normalize_query
    demand, shortage = _demand_and_shortage(collected)
    if not answer or not demand:
        return []
    out = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", answer):
        text = normalize_query(sentence)
        if "dap ung" not in text or "nhu cau" not in text:
            continue
        cited = {round(float(m.group(1).replace(",", "."))) for m in _COPIES.finditer(text)}
        if cited & (demand - shortage):
            out.append(sentence)
    return out


def _current(collected: dict) -> dict:
    found = results(collected)
    return found[-1] if found and isinstance(found[-1], dict) else {}


def _wh_key(name: str) -> str:
    from copilot_plan import normalize_query
    return re.sub(r"^(kho|chi nhanh) ", "", normalize_query(name or "")).strip()


def _title_key(title: str) -> str:
    """The first words of a title, as the model shortens it ("Chiến Lược Mua Bán...")."""
    from copilot_plan import normalize_query
    return " ".join(normalize_query(title or "").split()[:3])


_DENY_TRANSFER = re.compile(r"\b(khong|chua) (co )?(co so|nguon|the|du)\b[^.]{0,30}\b(dieu chuyen|chuyen)\b")


def transfer_issues(answer: str, collected: dict) -> list[str]:
    """Sentences naming a transfer the plan does not hold (live 2026-11-26: the "thiếu nhiều
    nhất" list given as transfers with invented sources, "Chiến Lược … 10 bản từ Đà Nẵng"
    while the plan moves 3 from Đà Nẵng and 18 from Hà Nội), or saying a warehouse cannot
    supply while the plan moves stock from it. Checked against every option's lines."""
    from copilot_plan import normalize_query
    current = _current(collected)
    options = current.get("options") or {}
    lines = [t for o in options.values() for t in o.get("transfers") or []]
    if not answer or not current.get("scope"):
        return []
    pairs: dict[tuple[str, str], set[int]] = {}
    for t in lines:
        pairs.setdefault((_title_key(t.get("title")), _wh_key(t.get("from_warehouse"))), set()).add(round(t.get("quantity") or 0))
    known_titles = {_title_key(x.get("title")) for x in [*lines, *(current.get("top_shortages") or []),
                                                          *(current.get("top_surpluses") or [])]} - {""}
    dests = {_wh_key(w.get("warehouse_name") or w.get("name")) for w in current.get("destinations") or []}
    whs = {_wh_key(w.get("warehouse")) for w in current.get("scope") or []} - {""}
    supplying = {_wh_key(s.get("warehouse")) for o in options.values() for s in o.get("transfers_by_source") or []
                 if (s.get("quantity") or 0) > 0}
    movable: dict[str, set[int]] = {}
    for o in options.values():
        for s in o.get("transfers_by_source") or []:
            movable.setdefault(_wh_key(s.get("warehouse")), set()).add(round(s.get("quantity") or 0))
    out = []
    # a wrong line goes whole: removing only its first sentence left "Số bản an toàn: 2 (…)" behind
    for line in answer.split("\n"):
        if _line_transfer_wrong(line, normalize_query, whs, dests, supplying, movable, known_titles, pairs):
            out.append(line)
    return out


_MOVED_QTY = re.compile(r"\b(chuyen|lay|tan dung)\b\D{0,25}?(\d+(?:[.,]\d+)?)\s*ban\b")
_CAN_MOVE = re.compile(r"\b(co the|duoc phep) (dieu )?chuyen\b|\b(dieu )?chuyen (di )?duoc\b")


def _line_transfer_wrong(line, normalize_query, whs, dests, supplying, movable, known_titles, pairs) -> bool:
    for sentence in re.split(r"(?<=[.!?])\s+", line):
        text = normalize_query(sentence)
        if "chuyen" not in text and "→" not in sentence and "->" not in sentence:
            continue
        named = {w for w in whs if re.search(rf"\b{re.escape(w)}\b", text)}
        if _DENY_TRANSFER.search(text) and named & supplying:
            return True
        if len(named - dests) == 1 and not any(k in text for k in known_titles):
            # a warehouse-level amount: "Kho Hà Nội có thể điều chuyển 126 bản dư" (its surplus), "chuyển 47
            # bản từ Kho Đà Nẵng" (the plan's total, of which Đà Nẵng gives 15) - what one source gives
            # is its "Điều chuyển theo kho nguồn" figure
            source = next(iter(named - dests))
            # only an amount said to move ("chuyển 47 bản", "lấy 47 bản"), not "với 120 bản dư thừa"
            qtys = {round(float(m.group(2).replace(",", "."))) for m in _MOVED_QTY.finditer(text)}
            if qtys and source in movable and not qtys & movable[source] \
                    and (_CAN_MOVE.search(text) or re.search(rf"\btu (kho )?{re.escape(source)}\b", text)):
                return True
    # one bullet = one transfer line: the title, its source and its quantity may sit in
    # different sentences of it ("**X**: Điều chuyển từ Hà Nội về HCM. Số bản an toàn: 18 (…)")
    text = normalize_query(line)
    if "chuyen" not in text and "→" not in line and "->" not in line:
        return False
    named = {w for w in whs if re.search(rf"\b{re.escape(w)}\b", text)}
    titles = [k for k in known_titles if k and k in text]
    sources = named - dests
    if len(titles) != 1 or not sources:
        return False  # several books, or only the destination named ("… về kho HCM là chỉ mua mới"): not one line
    qtys = {round(float(m.group(1).replace(",", "."))) for m in _COPIES.finditer(text)}
    if not qtys:  # "số bản an toàn **10**": the bare numbers, once the title's own ("7 Thói Quen") is gone
        qtys = {int(n) for n in re.findall(r"\b\d+\b", text.replace(titles[0], " "))}
    held = [pairs[(titles[0], s)] for s in sources if (titles[0], s) in pairs]
    return not held or bool(qtys and not any(qtys & q for q in held))


_OPTION_HINT = (("HYBRID_EXECUTABLE", re.compile(r"hybrid_executable|(ket hop|phuong an)\b.{0,40}\btu (thuc hien|thao tac)")),
                ("TRANSFER_ONLY", re.compile(r"transfer_only|transfer only|\bchi dieu chuyen\b")),
                ("PROCUREMENT_ONLY", re.compile(r"procurement_only|procurement only|\bchi mua moi\b")),
                ("HYBRID", re.compile(r"\bhybrid\b|\bket hop\b")))
_PCT = re.compile(r"(\d+(?:[.,](\d+))?)\s*%")
_VND = re.compile(r"(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*(?:₫|đ\b|đồng|vnđ|vnd)", re.IGNORECASE)
_DIFF_BEFORE = re.compile(r"\b(giam|tang|cat|them|chenh|tiet kiem|bot)\b")


def _mentions(text: str) -> list[tuple[int, str]]:
    """(position, option code) of every option the normalized line names, in order;
    the executable hybrid wins over the plain hybrid at the same place."""
    found = []
    for code, pattern in _OPTION_HINT:
        for m in pattern.finditer(text):
            if code == "HYBRID" and any(c == "HYBRID_EXECUTABLE" and abs(p - m.start()) < 45 for p, c in found):
                continue
            found.append((m.start(), code))
    return sorted(found)


def _option_figure_scan(answer: str, collected: dict) -> list[tuple[str, str | None]]:
    """(line, option it was about) for lines giving one option another option's coverage or
    cost (live 2026-11-26: "Chỉ mua mới … 44.464.490 ₫" - the hybrid's cost; "chỉ điều chuyển …
    31,66%"). The option is the one the line names, or the one named by the line opening its
    bullet group. Every scenario of the turn counts (a what-if quotes the old and the new figure)."""
    from copilot_plan import normalize_query
    from number_grounding import scaled_amounts
    found = [r for r in results(collected) if isinstance(r, dict) and not r.get("error")]
    if not answer or not found:
        return []
    allowed_pct: dict[str, list[float]] = {}
    allowed_vnd: dict[str, list[float]] = {}
    for r in found:
        for code, o in (r.get("options") or {}).items():
            allowed_pct.setdefault(code, []).append(float(o.get("shortage_covered_pct") or 0))
            allowed_vnd.setdefault(code, []).extend(float(v) for v in (
                o.get("purchase_cost_vnd"), o.get("remaining_budget_vnd"), r.get("budget_vnd"),
                *[p.get("cost_vnd") for p in o.get("purchases") or []]) if isinstance(v, (int, float)))
    allowed_pct["ANY"] = [v for vs in list(allowed_pct.values()) for v in vs]
    allowed_vnd["ANY"] = [v for vs in list(allowed_vnd.values()) for v in vs]
    out, context, columns = [], None, None
    for line in answer.split("\n"):
        if line.lstrip().startswith("|"):
            # a comparison table: each column belongs to the option its header names (live 2026-11-26:
            # the "Chỉ mua mới" column carried the hybrid's 44.554.270 ₫)
            cells = [c for c in line.strip().strip("|").split("|")]
            if columns is None:
                heads = [_mentions(_fold(c)) for c in cells]
                if sum(1 for h in heads if len({x for _p, x in h}) == 1) >= 2:
                    columns = [h[0][1] if len({x for _p, x in h}) == 1 else None for h in heads]
                continue
            if len(cells) == len(columns) and any(_table_cell_wrong(c, col, allowed_pct, allowed_vnd, scaled_amounts)
                                                  for c, col in zip(cells, columns) if col):
                out.append((line, None))
            continue
        columns = None
        if not line.strip() or line.lstrip().startswith("#"):
            context = None
            continue
        mentions = _mentions(_fold(line))
        stops = [m.end() for m in re.finditer(r"[.;!?](?=\s)", line)]
        # a line that opens with one option ("* **Phương án 2: Chỉ mua mới**", "* **Kết hợp:** …")
        # owns its later sentences and sets the bullet group below it
        head = [c for p, c in mentions if p <= 40]
        if len({c for _p, c in mentions}) == 1 and head:
            context = head[0]

        def owner(pos: int) -> str | None:
            """The option named closest before `pos` in the same sentence; a line with no option
            named takes its bullet group's; a later sentence of a line that names one may be about
            any option ("… (TRANSFER_ONLY) 12,2%. Để lấp phần còn lại cần 44.199.490 ₫")."""
            start = max([s for s in stops if s <= pos], default=0)
            before = [c for p, c in mentions if start <= p <= pos]
            if before:
                return before[-1]
            return context if (not mentions or start == 0) else "ANY"

        checks = []  # (option, value, allowed difference, kind)
        for m in _PCT.finditer(line):
            decimals = len(m.group(2) or "")
            checks.append((m.start(), float(m.group(1).replace(",", ".")), 0.5 * 10 ** -decimals + 0.05, "pct"))
        for m in _VND.finditer(line):
            value = float(re.sub(r"[.,]", "", m.group(1)))
            checks.append((m.start(), value, _EXACT_VND_TOL, "vnd"))
        for m in _SCALED.finditer(line):
            for _n, value, tol in scaled_amounts(m.group(0)):
                if value >= 100_000:
                    checks.append((m.start(), value, tol, "vnd"))
        bad = None
        for pos, value, tol, kind in checks:
            if _DIFF_BEFORE.search(normalize_query(line[max(0, pos - 18):pos])):
                continue  # "giảm 20%", "giảm 1.622.470 ₫": a change, not an option's own figure
            option = owner(pos)
            pool = (allowed_pct if kind == "pct" else allowed_vnd).get(option)
            if pool is not None and not any(abs(value - a) <= tol for a in pool):
                bad = bad or option
        if bad:
            out.append((line, bad))
    return out


def option_figure_issues(answer: str, collected: dict) -> list[str]:
    """Lines giving one option another option's coverage or cost (see _option_figure_scan)."""
    return [line for line, _option in _option_figure_scan(answer, collected)]


def option_figure_replacements(answer: str, collected: dict) -> dict[str, str]:
    """A wrong option line replaced by that option's own figures instead of being dropped (live
    audit 2026-11-26: dropping "* **Chi phí:** 44.464.490 ₫" left "Chỉ mua mới" with no figure).
    Table rows and lines whose option is unclear are not replaced."""
    options = _current(collected).get("options") or {}
    out = {}
    for line, option in _option_figure_scan(answer, collected):
        o = options.get(option)
        if line.lstrip().startswith("|") or not o:
            continue
        bullet = re.match(r"\s*(?:[*\-]|\d+\.)?\s*", line).group(0)
        out[line] = (f"{bullet}**{o.get('label')}:** đáp ứng {_pct(o.get('shortage_covered_pct'))} số thiếu "
                     f"({_n(o.get('covered_qty'))}/{_n(o.get('total_shortage_qty'))} bản), điều chuyển "
                     f"{_n(o.get('transfer_qty'))} bản, mua mới {_n(o.get('purchase_qty'))} bản, chi phí mua mới "
                     f"{_vnd(o.get('purchase_cost_vnd'))}.")
    return out


_SCALED = re.compile(r"\d[\d.,]*\s*(?:triệu|trieu|tr|tỷ|tỉ)\b", re.IGNORECASE)
# an amount written to the đồng ("44.554.270 ₫") is a copied figure, so it must be that figure; a
# rounded one ("~44,5 triệu") gets its own rounding through scaled_amounts
_EXACT_VND_TOL = 1000


def _table_cell_wrong(cell: str, option: str, allowed_pct: dict, allowed_vnd: dict, scaled_amounts) -> bool:
    for m in _PCT.finditer(cell):
        value, tol = float(m.group(1).replace(",", ".")), 0.5 * 10 ** -len(m.group(2) or "") + 0.05
        if not any(abs(value - a) <= tol for a in allowed_pct.get(option, [])):
            return True
    amounts = [(float(re.sub(r"[.,]", "", m.group(1))), None) for m in _VND.finditer(cell)]
    amounts += [(v, tol) for m in _SCALED.finditer(cell) for _n, v, tol in scaled_amounts(m.group(0)) if v >= 100_000]
    return any(not any(abs(v - a) <= (tol if tol is not None else _EXACT_VND_TOL) for a in allowed_vnd.get(option, []))
               for v, tol in amounts)


def _fold(line: str) -> str:
    """Lower-case, accents off, ONE character per character, so a match position is the same
    position in the raw line (normalize_query also drops punctuation and shifts them)."""
    import unicodedata
    return "".join((unicodedata.normalize("NFD", ch)[0] if ch not in "đĐ" else "d").lower() for ch in line)


# ── answers written by the system (no LLM) ────────────────────────────────────
# Live audits 2026-11-26: on the diagnosis / transfer turn and the option comparison the
# model kept inventing transfer lines, moving one option's figures to another and giving
# wrong reasons, in a new way each run. These two turns are lists of figures, so the
# system writes them from the plan itself - like the draft reply - and the text can never
# disagree with the cards.

_ACCESS = {"WRITE": "toàn quyền", "READ": "chỉ xem"}
_PERMISSION = {"EXECUTABLE": "bạn tự tạo được", "COLLABORATIVE": "cần Manager kho nguồn phối hợp",
               "PROPOSAL_ONLY": "chỉ đề xuất"}
_RISK = {"LOW": "thấp", "MEDIUM": "vừa", "HIGH": "cao"}
_WRITTEN_FOCUS = {"INVENTORY_DIAGNOSIS", "SHORTAGE_DETECTION", "SURPLUS_DETECTION", "DEMAND_ANALYSIS",
                  "TRANSFER_OPPORTUNITY", "TRANSFER_QUANTITY", "DECISION_COMPARISON", "HYBRID_DECISION"}
# (PROCUREMENT_OPTIMIZATION comes with every "chỉ mua mới / kết hợp" comparison, so it does not mark a budget turn)
_LLM_FOCUS = {"WHAT_IF", "BUDGET_OPTIMIZATION", "CREATE_DRAFT", "CONFIRM_ACTION", "DECISION_EXPLANATION"}
_COMPARE_FOCUS = {"DECISION_COMPARISON", "HYBRID_DECISION"}


def _option_line(o: dict, tags: list[str]) -> str:
    tag = f" ({', '.join(tags)})" if tags else ""
    left = f"còn thiếu {_n(o.get('remaining_shortage_qty'))} bản"
    if o.get("remaining_high_priority_qty"):
        left += f", trong đó {_n(o.get('remaining_high_priority_qty'))} bản ưu tiên cao"
    return (f"- **{o.get('label')}**{tag}: đáp ứng {_pct(o.get('shortage_covered_pct'))} số thiếu "
            f"({_n(o.get('covered_qty'))}/{_n(o.get('total_shortage_qty'))} bản); điều chuyển {_n(o.get('transfer_qty'))} "
            f"bản, mua mới {_n(o.get('purchase_qty'))} bản, chi phí mua mới {_vnd(o.get('purchase_cost_vnd'))}; "
            f"{left}; rủi ro {_RISK.get(o.get('risk_level'), o.get('risk_level') or 'không rõ')}.")


def _transfer_lines(best: dict, dest: str) -> list[str]:
    lines = [f"**Điều chuyển an toàn về {dest}:**"]
    shown = best.get("transfers") or []
    if not shown:
        return [f"**Điều chuyển về {dest}:** không có đầu sách nào vừa thiếu ở kho đích vừa dư ở kho nguồn, "
                "nên phần thiếu phải bù bằng mua mới."]
    for t in shown:
        lines.append(f"- {t.get('title')}: {_n(t.get('quantity'))} bản từ {t.get('from_warehouse')} (sau khi chuyển "
                     f"kho nguồn còn {_n(t.get('source_available_after'))} bản, mức cần giữ "
                     f"{_n(t.get('source_protected_qty'))}) — {_PERMISSION.get(t.get('permission'), t.get('permission'))}.")
    more = (best.get("transfer_lines_total") or 0) - len(shown)
    if more > 0:
        lines.append(f"- … và {more} dòng khác (xem thẻ Cơ hội điều chuyển).")
    by_source = best.get("transfers_by_source") or []
    if by_source:
        lines.append("Tổng theo kho nguồn: " + "; ".join(
            f"{s.get('warehouse')} {_n(s.get('quantity'))} bản ({_PERMISSION.get(s.get('permission'), s.get('permission'))})"
            for s in by_source) + ".")
    return lines


def system_answer(plan, collected: dict) -> str | None:
    """The reply to a diagnosis / transfer question or an option comparison, written from
    the plan; None for any other turn (budget, what-if, draft, confirm, explanation: the
    model's text, which the checks above still guard)."""
    reb = (getattr(plan, "entities", None) or {}).get("rebalance") or {}
    focus = set(reb.get("focus") or [])
    found = results(collected)
    current = found[-1] if found and isinstance(found[-1], dict) else {}
    # (a comparison may also re-run the previous scenario first: the plan's own call is the last one)
    if current.get("error") or not current.get("scope") or not (focus & _WRITTEN_FOCUS) or focus & _LLM_FOCUS:
        return None
    options = current.get("options") or {}
    rec = current.get("recommendation") or {}
    best_code, ex_code = rec.get("best_business_option"), rec.get("executable_option")
    best = options.get(best_code) or {}
    if not best:
        return None
    dest = ", ".join(d.get("warehouse_name") for d in current.get("destinations") or [] if d.get("warehouse_name")) \
        or "kho đang thiếu"
    book = (current.get("book") or {}).get("title")
    out = [f"*Phạm vi: chỉ cuốn \"{book}\" — các số dưới đây không phải của cả kho.*", ""] if book else []
    compare = bool(focus & _COMPARE_FOCUS)

    if not compare:
        out.append("**Tồn kho theo kho bạn được xem:**")
        for d in current.get("diagnosis") or []:
            out.append(f"- **{d.get('warehouse')}** ({_ACCESS.get(d.get('access'), d.get('access') or '')}): thiếu "
                       f"{_n(d.get('shortage_variants'))} đầu sách / {_n(d.get('shortage_qty'))} bản; dư "
                       f"{_n(d.get('surplus_variants'))} đầu sách / {_n(d.get('surplus_qty'))} bản.")
        t = current.get("diagnosis_totals") or {}
        if t:
            out.append(f"Kho đang thiếu: {', '.join(t.get('short_warehouses') or []) or 'không có'}. Kho đang dư: "
                       f"{', '.join(t.get('surplus_warehouses') or []) or 'không có'}"
                       + (f" (tổng dư {_n(t.get('surplus_qty_surplus_warehouses'))} bản)" if t.get("surplus_warehouses") else "")
                       + ". Số dư của một kho không phải số chuyển được: chỉ đầu sách kho đích đang thiếu mới chuyển.")
        out += ["", *_transfer_lines(best, dest), ""]
        out.append(f"**Phương án tốt nhất về nghiệp vụ:** {best.get('label')} — đáp ứng "
                   f"{_pct(best.get('shortage_covered_pct'))} số thiếu ({_n(best.get('covered_qty'))}/"
                   f"{_n(best.get('total_shortage_qty'))} bản), điều chuyển {_n(best.get('transfer_qty'))} bản và mua mới "
                   f"{_n(best.get('purchase_qty'))} bản, chi phí mua mới {_vnd(best.get('purchase_cost_vnd'))}. "
                   "Hỏi \"so sánh ba phương án\" để xem chi tiết từng phương án.")
    else:
        out.append(f"**Phương án tốt nhất về nghiệp vụ: {best.get('label')}.** So sánh theo dữ liệu của hệ thống:")
        for code in rec.get("ranking") or list(options):
            o = options.get(code)
            if not o:
                continue
            tags = (["tốt nhất về nghiệp vụ"] if code == best_code else []) + \
                   (["bạn tự thực hiện được"] if code == ex_code else [])
            out.append(_option_line(o, tags))
        reason = transfer_only_reason(collected)
        if reason:
            out.append(f"Chỉ điều chuyển không đủ: {reason}")
        if rec.get("rule"):
            out.append(f"Quy tắc xếp hạng: {rec['rule']}")
    collab = [s for s in best.get("transfers_by_source") or [] if s.get("permission") != "EXECUTABLE"]
    if collab:
        out.append(f"Dòng điều chuyển từ {', '.join(s.get('warehouse') for s in collab)} cần Manager kho đó phối hợp "
                   "(bạn chỉ có quyền xem kho nguồn); dòng từ kho bạn toàn quyền thì bạn tự tạo được.")
    if not any("Chi phí điều chuyển" in line for line in out):
        out.append("Chi phí điều chuyển chưa có dữ liệu nên không được tính.")
    return "\n".join(out)


_REASON = re.compile(r"\b(ly do|vi|do|han che|khong kha thi|khong du|khong dap ung du|thap hon|it hon|so voi|chi co)\b")


def transfer_only_reason(collected: dict) -> str | None:
    """Why moving stock alone falls short, from the plan's own figures."""
    o = (_current(collected).get("options") or {}).get("TRANSFER_ONLY") or {}
    if not o or (o.get("shortage_covered_pct") or 0) >= 100:
        return None
    if not o.get("transfer_qty"):
        return ("không kho nguồn nào dư đầu sách mà kho đích đang thiếu (sau khi giữ mức cần giữ), nên không có gì "
                "để chuyển.")
    return (f"chỉ chuyển được {_n(o.get('transfer_qty'))} bản thuộc {_n(o.get('transfer_titles'))} đầu sách, vì chỉ đầu "
            "sách vừa thiếu ở kho đích vừa dư ở kho nguồn mới chuyển được và kho nguồn phải giữ mức cần giữ; phần dư "
            "còn lại ở kho nguồn là các đầu sách kho đích không thiếu.")


def reason_issues(answer: str, collected: dict) -> list[str]:
    """Lines explaining the transfer-only shortfall with a warehouse's surplus or every warehouse's
    shortage (live audit 2026-11-26: "Lý do: tổng lượng sách dư (chủ yếu Đà Nẵng 120 bản) là hạn
    chế", "dư 120 bản so với nhu cầu hệ thống 548 bản"): the reason is which titles match."""
    from copilot_plan import normalize_query
    current = _current(collected)
    if not answer or not transfer_only_reason(collected):
        return []
    t = current.get("diagnosis_totals") or {}
    wrong_figures = {round(d.get("surplus_qty") or 0) for d in current.get("diagnosis") or []} - {0}
    wrong_figures |= {round(t.get(k) or 0) for k in ("surplus_qty_surplus_warehouses", "shortage_qty_all")} - {0}
    # a surplus that IS what moves (one book: "Đà Nẵng chỉ dư 10 bản" and 10 are moved) is the right reason
    tr = (current.get("options") or {}).get("TRANSFER_ONLY") or {}
    wrong_figures -= {round(tr.get(k) or 0) for k in ("transfer_qty", "covered_qty")}
    wrong_figures -= {round(s.get("quantity") or 0) for s in tr.get("transfers_by_source") or []}
    out, context = [], None
    for line in answer.split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            context = None
            continue
        mentions = _mentions(_fold(line))
        head = [c for p, c in mentions if p <= 40]
        if len({c for _p, c in mentions}) == 1 and head:
            context = head[0]
        about = context == "TRANSFER_ONLY" or any(c == "TRANSFER_ONLY" for _p, c in mentions)
        text = normalize_query(line)
        cited = {round(float(m.group(1).replace(",", "."))) for m in _COPIES.finditer(text)}
        if about and _REASON.search(text) and cited & wrong_figures:
            out.append(line)
    return out


def reason_replacements(answer: str, collected: dict) -> dict[str, str]:
    reason = transfer_only_reason(collected)
    out = {}
    for line in reason_issues(answer, collected):
        bullet = re.match(r"\s*(?:[*\-]|\d+\.)?\s*", line).group(0)
        out[line] = f"{bullet}**Lý do chỉ điều chuyển không đủ:** {reason}"
    return out


def answer_issues(answer: str, collected: dict) -> list[str]:
    return (permission_issues(answer, collected) + option_issues(answer, collected) + demand_issues(answer, collected)
            + transfer_issues(answer, collected) + option_figure_issues(answer, collected)
            + reason_issues(answer, collected))


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
    joined = "\n".join(sentences)
    if transfer_issues(joined, collected):
        lines = [t for t in ((current.get("options") or {}).get(rec.get("best_business_option")) or {}).get("transfers") or []]
        parts.append("Sai dòng điều chuyển: chỉ nêu đúng các dòng có trong dữ liệu (sách — kho nguồn — số bản): "
                     + "; ".join(f"{t.get('title')} — {t.get('from_warehouse')} — {t.get('quantity')} bản" for t in lines[:10])
                     + ". Danh sách \"thiếu nhiều nhất\" không phải dòng điều chuyển; kho nào có trong các dòng trên thì "
                     "kho đó có điều chuyển. Viết lại: " + " | ".join(x.strip()[:160] for x in transfer_issues(joined, collected)))
    if option_figure_issues(joined, collected):
        opts = current.get("options") or {}
        parts.append("Sai số của phương án: mỗi phương án chỉ dùng số của chính nó — "
                     + "; ".join(f"{o.get('label')}: đáp ứng {o.get('shortage_covered_pct')}% số thiếu, chi phí mua "
                                 f"{_vnd(o.get('purchase_cost_vnd'))}" for o in opts.values())
                     + ". Viết lại: " + " | ".join(x.strip()[:160] for x in option_figure_issues(joined, collected)))
    if reason_issues(joined, collected):
        parts.append("Sai lý do: chỉ điều chuyển không đủ vì " + (transfer_only_reason(collected) or "")
                     + " Không giải thích bằng tổng số dư của kho hay tổng thiếu mọi kho. Viết lại: "
                     + " | ".join(x.strip()[:160] for x in reason_issues(joined, collected)))
    wrong_demand = demand_issues(" ".join(sentences), collected)
    if wrong_demand:
        best = (current.get("options") or {}).get(rec.get("best_business_option")) or {}
        parts.append(f"Sai số: \"đáp ứng X%\" là phần trăm của SỐ THIẾU ({best.get('total_shortage_qty')} bản = nhu cầu trong "
                     "thời gian chờ hàng + tồn an toàn), không phải của nhu cầu dự kiến; không ghi số nhu cầu dự kiến cạnh "
                     "mức đáp ứng. Viết lại: " + " | ".join(x.strip()[:160] for x in wrong_demand))
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
