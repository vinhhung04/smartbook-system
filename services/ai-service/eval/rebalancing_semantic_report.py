"""Markdown table of the rebalancing semantic test set, planned by the real
copilot_plan.build_plan (rules only, no LLM): one row per question with the
expected intent, the focus the planner read, the tool call it chose and
PASS / FAIL against the dataset's expectations. Also runs the held-out
phrasings (written after the rules, never used to tune them in the first run).

    python services/ai-service/eval/rebalancing_semantic_report.py > report.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import test_rebalance_planner as t  # noqa: E402

HELD_OUT = [
    ("Kho Đà Nẵng có thể san sẻ sách cho HCM không?", None, "TRANSFER_OPPORTUNITY"),
    ("Muốn giảm tiền nhập hàng, tận dụng sách đang dư ở các kho khác", None, "TRANSFER_OPPORTUNITY"),
    ("Ngân sách còn 10 triệu thôi, tính lại phương án giúp tôi", "transfer", "BUDGET_OPTIMIZATION"),
    ("Chuyển sách từ Hà Nội về kho HCM được không?", None, "TRANSFER_OPPORTUNITY"),
    ("Dùng lại ngân sách ban đầu", "whatif12", "BUDGET_OPTIMIZATION"),
    ("Quay lại phương án trước", "whatif12", None),
    ("Chỉ thay đổi kho đích sang Đà Nẵng", "budget15", None),
    ("Có nên mua mới hết không hay chuyển từ kho khác?", None, "HYBRID_DECISION"),
    ("Kho nào đang ôm nhiều sách quá?", None, "SURPLUS_DETECTION"),
    ("Cân đối hàng giữa ba kho giúp tôi", None, "TRANSFER_OPPORTUNITY"),
    ("Nhu cầu tăng 20% thì cần chuyển thêm bao nhiêu?", "transfer", "WHAT_IF"),
    ("Lên bản nháp yêu cầu nhé", "budget15", "CREATE_DRAFT"),
]


def cell(text) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def tools_of(plan) -> str:
    if plan.clarification_needed:
        return "(hỏi lại) " + (plan.clarification_question or "")[:60]
    if not plan.required_tools:
        return "(không gọi tool)"
    return "; ".join(f"{c['name']} {json.dumps(c['args'], ensure_ascii=False)}" for c in plan.required_tools)


def main() -> None:
    rows, passed = [], 0
    for case in t.DATASET["cases"]:
        plan, failures = t.run_case(case)
        reb = (plan.entities or {}).get("rebalance") or {}
        ok = not failures
        passed += ok
        rows.append(f"| {case['id']} | {case['kind']} | {cell(case['q'])} | {case['intent']} | "
                    f"{cell(', '.join(reb.get('focus') or []) or '-')} | {cell(tools_of(plan))} | "
                    f"{'PASS' if ok else 'FAIL: ' + cell('; '.join(failures))} |")
    print(f"### Bộ biến thể ({passed}/{len(rows)} PASS)\n")
    print("| ID | Kiểu | Câu hỏi | Intent dự kiến | Intent thực tế (focus) | Tool được gọi | Kết quả |")
    print("|---|---|---|---|---|---|---|")
    print("\n".join(rows))

    print("\n### Hội thoại nhiều lượt\n")
    print("| Hội thoại | Lượt | Câu hỏi | Focus | Tool | Kết quả |")
    print("|---|---|---|---|---|---|")
    total = ok_count = 0
    for name, steps in t.DATASET["conversations"].items():
        plans, _state = t.converse([s["q"] for s in steps])
        for i, (plan, step) in enumerate(zip(plans, steps), 1):
            failures = t.check(plan, step["expect"])
            total += 1
            ok_count += not failures
            reb = (plan.entities or {}).get("rebalance") or {}
            print(f"| {name} | {i} | {cell(step['q'])} | {cell(', '.join(reb.get('focus') or []) or '-')} | "
                  f"{cell(tools_of(plan))} | {'PASS' if not failures else 'FAIL: ' + cell('; '.join(failures))} |")
    print(f"\n{ok_count}/{total} lượt PASS.")

    print("\n### Câu held-out (không dùng để chỉnh luật ở lần chạy đầu)\n")
    print("| Câu hỏi | Ngữ cảnh | Intent dự kiến | Focus thực tế | Tool | Kết quả |")
    print("|---|---|---|---|---|---|")
    good = 0
    for q, ctx, focus in HELD_OUT:
        plans, _state = t.converse(t.DATASET["contexts"].get(ctx, []) + [q])
        plan = plans[-1]
        reb = (plan.entities or {}).get("rebalance") or {}
        ok = bool(reb) and (focus is None or focus in (reb.get("focus") or []))
        good += ok
        print(f"| {cell(q)} | {ctx or '-'} | {focus or '(khôi phục kịch bản)'} | {cell(', '.join(reb.get('focus') or []) or '-')} | "
              f"{cell(tools_of(plan))} | {'PASS' if ok else 'FAIL'} |")
    print(f"\n{good}/{len(HELD_OUT)} câu held-out PASS (chạy hiện tại).")


if __name__ == "__main__":
    main()
