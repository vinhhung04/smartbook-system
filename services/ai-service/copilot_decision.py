"""Structured decision response (Copilot Phase 6).

For a decision or what-if question about reorder budgets, the answer carries a
`decision` object built ONLY from tool data (simulate_reorder_budget, i.e. the
analytics service's own allocation) - never from the model's text:

    conclusion       one sentence from the first scenario
    data_points      the figures it rests on, with source and read time
    options          every scenario: cost, titles / copies, expected service,
                     HIGH-priority titles left out, deterministic pros / cons
    risks            what the data says can go wrong
    assumptions      what the figures assume (model, lead time, returns...)
    recommendation   CONDITIONAL ("nếu ưu tiên ... thì ...; nếu ... thì ...")
                     - SmartBook does not optimise, it states trade-offs
    evidence         sources + read time
    verification     the verification status of the written answer (main.py)
    next_step        a draft purchase request the user may ask for - only when
                     the answer is safe to act on; creating the draft still
                     goes through the usual confirm dialog, nothing is created
                     or approved automatically.

Simple lookups get no decision object (build() returns None).
"""
from __future__ import annotations

DECISION_ANALYSES = ("decision", "what_if")
_SRC = "analytics/reorder-suggestions?budgetVnd"


def _vnd(value) -> str:
    if value is None:
        return "không có dữ liệu"
    return f"{int(round(float(value))):,} ₫".replace(",", ".")


def _n(value) -> str:
    if value is None:
        return "không có dữ liệu"
    v = float(value)
    return f"{int(v):,}".replace(",", ".") if v.is_integer() else f"{v:.1f}".replace(".", ",")


def _pct(value) -> str:
    return "không có dữ liệu" if value is None else f"{_n(value)}%"


def _option(s: dict, ok: list[dict], least: str | None) -> dict:
    costs = [o.get("funded_cost") or 0 for o in ok]
    services = [o["expected_service_pct"] for o in ok if o.get("expected_service_pct") is not None]
    pros, cons = [], []
    cost = s.get("funded_cost") or 0
    svc = s.get("expected_service_pct")
    if len(ok) >= 2 and cost == min(costs):
        pros.append("Chi phí thấp nhất trong các phương án")
    if len(ok) >= 2 and services and svc is not None and svc == max(services):
        pros.append("Đáp ứng nhiều nhu cầu dự kiến nhất trong thời gian chờ hàng")
    if s.get("unfunded_high_priority") == 0:
        pros.append("Không bỏ lại đầu sách ưu tiên cao nào cần nhập")
    if s.get("covers_need_with_position"):
        pros.append("Duyệt đủ toàn bộ nhu cầu tính theo tồn dự kiến")
    remaining = s.get("remaining_vnd") or 0
    if s.get("budget_vnd") and remaining > 0.05 * float(s["budget_vnd"]):
        pros.append(f"Còn dư {_vnd(remaining)}")
    if s.get("unfunded_high_priority"):
        cons.append(f"Còn {_n(s['unfunded_high_priority'])} đầu sách ưu tiên cao chưa được nhập")
    if svc is not None and svc < 90:
        cons.append(f"Chỉ đáp ứng khoảng {_pct(svc)} nhu cầu dự kiến trong thời gian chờ hàng")
    if len(ok) >= 2 and cost == max(costs) and cost > min(costs):
        cons.append("Chi phí cao nhất trong các phương án")
    if s.get("lead_time_delay_days"):
        diff = (s.get("vs_first_scenario") or {}).get("expected_service_pct")
        cons.append(f"Nhà cung cấp giao chậm thêm {_n(s['lead_time_delay_days'])} ngày"
                    + (f" làm mức đáp ứng thay đổi {diff:+.1f} điểm %".replace(".", ",") if diff is not None else ""))
    if s.get("priority_warehouse") and s.get("priority_lines") is not None:
        (pros if s.get("priority_lines_funded") else cons).append(
            f"{s['priority_warehouse']}: {_n(s.get('priority_lines_funded'))}/{_n(s['priority_lines'])} dòng đang thiếu được duyệt")
    if s.get("partially_funded_lines"):
        cons.append(f"{_n(s['partially_funded_lines'])} đầu sách chỉ được duyệt một phần số bản đề xuất")
    return {
        "label": s.get("label"), "budget_vnd": s.get("budget_vnd"), "funded_cost": s.get("funded_cost"),
        "remaining_vnd": s.get("remaining_vnd"), "funded_lines": s.get("funded_lines"), "funded_qty": s.get("funded_qty"),
        "expected_service_pct": svc, "unfunded_high_priority": s.get("unfunded_high_priority"),
        "funded_items": [{"title": x.get("title"), "funded_qty": x.get("funded_qty"), "estimated_cost": x.get("estimated_cost")}
                         for x in (s.get("funded_items") or [])[:5]],
        "pros": pros, "cons": cons, "is_least_risk": least is not None and s.get("label") == least,
        "kind": s.get("kind") or "choice",
    }


def _recommendation(all_options: list[dict], least: dict | None) -> dict:
    options = [o for o in all_options if o.get("kind") != "condition"] or all_options[:1]
    conditions = [o for o in all_options if o.get("kind") == "condition"]
    if conditions and len(options) == 1:
        o, c = options[0], conditions[0]
        diff = None
        if o.get("expected_service_pct") is not None and c.get("expected_service_pct") is not None:
            diff = c["expected_service_pct"] - o["expected_service_pct"]
        return {"option": o["label"], "condition": (
            f"“{c['label']}” là điều kiện giả định, không phải lựa chọn"
            + (f": cùng số tiền, mức đáp ứng thay đổi {diff:+.1f} điểm %".replace(".", ",") if diff is not None else "")
            + ". Nếu rủi ro giao chậm là thật, cân nhắc tăng ngân sách hoặc đặt sớm hơn; nếu không, giữ phương án hiện tại."),
            "basis": "So sánh tác động của điều kiện, không xếp hạng phương án"}
    if len(options) == 1:
        o = options[0]
        return {"option": o["label"], "condition": (
            f"Nếu chấp nhận {'; '.join(o['cons']).lower() or 'các giới hạn nêu ở phần rủi ro'}, có thể dùng phương án này; "
            "nếu cần đáp ứng nhiều hơn, hãy so sánh thêm một mức ngân sách khác."), "basis": "Một phương án duy nhất"}
    cheapest = min(options, key=lambda o: o.get("funded_cost") or 0)
    safest = next((o for o in options if o["is_least_risk"]), None) or max(
        options, key=lambda o: (o.get("expected_service_pct") or 0, -(o.get("unfunded_high_priority") or 0)))
    if safest["label"] == cheapest["label"]:
        return {"option": safest["label"], "condition": (
            f"“{safest['label']}” vừa rẻ nhất vừa đáp ứng nhiều nhất trong các phương án đã so sánh; vẫn cần xem phần rủi ro "
            "trước khi lập phiếu."), "basis": (least or {}).get("rule")}
    return {"option": safest["label"], "condition": (
        f"Nếu ưu tiên giảm rủi ro hết sách: chọn “{safest['label']}” (đáp ứng {_pct(safest.get('expected_service_pct'))}). "
        f"Nếu ưu tiên chi phí: chọn “{cheapest['label']}” ({_vnd(cheapest.get('funded_cost'))}), đổi lại "
        f"{'; '.join(cheapest['cons']).lower() or 'mức đáp ứng thấp hơn'}."), "basis": (least or {}).get("rule")}


def build(plan, collected: dict, verification: dict | None = None) -> dict | None:
    """The decision object of one turn, or None when the turn is not a reorder
    decision / what-if (simple questions keep the plain answer)."""
    analysis = getattr(plan, "requested_analysis", None)
    sim = (collected or {}).get("simulate_reorder_budget")
    if analysis not in DECISION_ANALYSES or not isinstance(sim, dict) or sim.get("error"):
        return None
    ok = [s for s in sim.get("scenarios") or [] if isinstance(s, dict) and not s.get("error")]
    if not ok:
        return None
    least = sim.get("least_risk_scenario") or None
    options = [_option(s, ok, (least or {}).get("label")) for s in ok]
    first = ok[0]
    need = sim.get("full_need") or {}
    conclusion = (f"{first.get('label')}: duyệt {_vnd(first.get('funded_cost'))} cho {_n(first.get('funded_lines'))} đầu "
                  f"sách / {_n(first.get('funded_qty'))} bản"
                  + (f", đáp ứng khoảng {_pct(first.get('expected_service_pct'))} nhu cầu dự kiến trong thời gian chờ hàng"
                     if first.get("expected_service_pct") is not None else "")
                  + f"; {_n(first.get('unfunded_high_priority'))} đầu sách ưu tiên cao chưa được nhập.")
    data_points = [
        {"label": "Nhu cầu nhập đầy đủ", "value": need.get("estimated_total_cost"), "unit": "đ", "source": _SRC},
        {"label": "Nhu cầu theo tồn dự kiến (gồm bản đang về / dự kiến trả)", "value": need.get("need_with_position_vnd"),
         "unit": "đ", "source": _SRC},
        {"label": "Số đầu sách cần xem xét", "value": need.get("total_candidates"), "unit": "đầu sách", "source": _SRC},
    ]
    curve = sim.get("service_curve") or {}
    points = curve.get("cost_for_service_pct") or {}
    for pct in ("95", "99"):
        if points.get(pct) is not None:
            data_points.append({"label": f"Chi phí tối thiểu để đạt {pct}% mức phục vụ của toàn bộ kế hoạch",
                                "value": points[pct], "unit": "đ", "source": _SRC})
    risks = []
    worst = max(ok, key=lambda s: s.get("unfunded_high_priority") or 0)
    if worst.get("unfunded_high_priority"):
        names = ", ".join(x.get("title") for x in (worst.get("unfunded_high_examples") or [])[:3] if x.get("title"))
        risks.append(f"{worst.get('label')}: {_n(worst['unfunded_high_priority'])} đầu sách ưu tiên cao chưa được nhập"
                     + (f" (ví dụ {names})" if names else "") + ".")
    if any(s.get("lead_time_delay_days") for s in ok):
        risks.append("Giao hàng chậm làm nhu cầu trong thời gian chờ tăng; cùng số tiền sẽ phục vụ được ít hơn.")
    if sim.get("items_not_listed"):
        risks.append(f"{_n(sim['items_not_listed'])} đầu sách ngoài danh sách được liệt kê chưa được đếm số dòng/số lượng.")
    assumptions = list(sim.get("budget_assumptions") or [])
    if sim.get("scenarios_are_assumed"):
        assumptions.insert(0, "Chưa nêu ngân sách: các mức là giả định theo % nhu cầu.")
    assumptions.append("Mức đáp ứng là ước lượng theo mô hình Poisson của nhu cầu trong thời gian chờ hàng, không phải cam kết.")
    assumptions += list(sim.get("limitations") or [])
    verification = verification or {}
    safe = bool(verification.get("safe_to_act", True)) and not sim.get("scenarios_are_assumed")
    recommendation = _recommendation(options, least)
    chosen = next((o for o in options if o["label"] == recommendation["option"]), options[0])
    decision = {
        "kind": "BUDGET_DECISION",
        "conclusion": conclusion,
        "data_points": [d for d in data_points if d["value"] is not None],
        "options": options,
        "risks": risks,
        "assumptions": assumptions,
        "recommendation": recommendation,
        "evidence": [{"source": _SRC, "as_of": sim.get("retrieved_at"), "rule": sim.get("funding_rule")}],
        "verification": {"status": verification.get("status"), "safe_to_act": bool(verification.get("safe_to_act", False))},
        "next_step": ({"type": "CREATE_REORDER_DRAFT", "option": recommendation["option"],
                       "label": "Lập phiếu đề xuất nháp",
                       # the draft is built from the analytics allocation for this budget
                       "message": f"Lập phiếu đề xuất nhập nháp với ngân sách {_vnd(chosen.get('budget_vnd'))}",
                       "note": "Hệ thống chỉ tạo bản nháp sau khi bạn xác nhận; không tự tạo hay duyệt phiếu nhập."}
                      if safe else None),
    }
    return decision
