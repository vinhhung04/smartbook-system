"""Semantic faithfulness evaluation (AI Copilot 3.1).

    python services/ai-service/eval/eval_faithfulness.py \
        --answers services/ai-service/eval/faithfulness_answers_live.json \
        --labels services/ai-service/eval/faithfulness_labels.json

Three sets, reported separately:

DEV       the examples the rules were written against (DEV_CASES below, the
          same ones as test_copilot_faithfulness.py). Reported for
          completeness only - it says nothing about unseen answers.
REAL      the model's FIRST answers (debug.draft_answer, before any check) to
          questions written before the validator existed (XAI 2.0 set + live
          Copilot 3.0 chart questions), collected by
          collect_faithfulness_answers.py, each labelled by hand with the issue
          types it really contains (faithfulness_labels.json). The labels were
          written by the same person who wrote the rules (no second annotator).
MUTATED   the REAL answers labelled clean, each with ONE injected error of one
          type, phrased in several ways - some deliberately outside the rules'
          vocabulary - so recall is measured, not assumed.

For each set: per-type precision / recall, false-positive rate on clean
answers, and the same numbers for the Explainable AI 2.0 checker
(copilot_explain.overclaims + copilot_visualization.consistency_issues), plus
validator latency. From the live collection: how many answers needed the
retry, the final status distribution, LLM calls per answer.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from collections import Counter, defaultdict

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(EVAL_DIR))

import copilot_faithfulness as cf  # noqa: E402
from copilot_explain import overclaims  # noqa: E402
from copilot_visualization import consistency_issues  # noqa: E402

TYPES = [t for t in cf.ISSUE_TYPES]

DEV_CTX = cf.Context(trend="giảm", trend_pct=-25.0, riskiest="Kho HCM Chinh", warehouses=["Kho HCM Chinh", "Kho Ha Noi"],
                     borrow_data=True, explanation={"certainty": "TRUNG BÌNH", "mode": "analysis", "flags": []})
DEV_CASES = [
    ("Lượt mượn có xu hướng tăng trong các tháng trọn kỳ.", {cf.CONTRADICTION}),
    ("Lượt mượn tăng 25% so với tháng 5.", {cf.CONTRADICTION}),
    ("Lượt mượn có xu hướng giảm 25%.", set()),
    ("Lượt mượn không tăng mà giảm dần.", set()),
    ("Lượt mượn tăng ở tháng 8 nhưng xu hướng chung vẫn giảm.", set()),
    ("Kho Ha Noi rủi ro thiếu sách cao hơn Kho HCM Chinh.", {cf.RANKING_INCONSISTENCY}),
    ("Kho HCM Chinh có rủi ro thiếu sách thấp hơn Kho Ha Noi.", {cf.RANKING_INCONSISTENCY}),
    ("Kho HCM Chinh rủi ro thiếu sách cao hơn Kho Ha Noi.", set()),
    ("Kho Hà Nội rủi ro cao nhất.", {cf.RANKING_INCONSISTENCY}),
    ("Có 5.445 lượt mượn tại kho Hà Nội trong kỳ.", {cf.SCOPE_CONFUSION}),
    ("Kho HCM Chinh có 5.445 lượt mượn trong kỳ.", {cf.SCOPE_CONFUSION}),
    ("Toàn hệ thống có 5.445 lượt mượn trong kỳ.", set()),
    ("Thiếu hàng là do nhu cầu tăng.", {cf.UNSUPPORTED_CAUSAL}),
    ("Nguyên nhân chính là thời gian chờ hàng dài.", {cf.UNSUPPORTED_CAUSAL}),
    ("Thiếu hàng có thể là do nhu cầu tăng, nhưng dữ liệu chưa đủ để khẳng định.", set()),
    ("Ngân sách 20 triệu là phương án tối ưu nhất.", {cf.UNSUPPORTED_RECOMMENDATION}),
    ("Không có phương án nào tối ưu tuyệt đối.", set()),
    ("Chắc chắn lượt mượn sẽ còn giảm.", {cf.REASONING_OVERCLAIM}),
    ("Ý nghĩa: cần theo dõi thêm.", {cf.INTERNAL_LABEL}),
]

# Injected errors: several phrasings per type. Marked (*) are phrasings the
# rules were NOT written for; they are kept to measure recall honestly.
MUTATIONS = {
    cf.CONTRADICTION: [
        "Nhìn chung, lượt mượn có xu hướng {opp} trong kỳ.",
        "Số lượt mượn đang {opp} dần qua các tháng.",
        "Hoạt động mượn sách {opp_move} so với đầu kỳ.",
        "Nhu cầu mượn ngày càng {opp_adj}.",  # (*)
    ],
    cf.RANKING_INCONSISTENCY: [
        "{other} đang có rủi ro thiếu sách cao hơn {riskiest}.",
        "Tình trạng thiếu hàng ở {other} nghiêm trọng hơn ở {riskiest}.",
        "{other} là kho đáng lo ngại nhất hiện nay.",  # (*)
        "So với {other}, {riskiest} ít rủi ro hơn.",  # (*)
    ],
    cf.SCOPE_CONFUSION: [
        "Lượt mượn tại kho {wh_short} trong kỳ là {n} lượt.",
        "{wh} ghi nhận {n} lượt mượn trong kỳ.",
        "Nhu cầu mượn ở chi nhánh {wh_short} đang cao.",
        "Riêng {wh} đã cho mượn {n} lượt.",  # (*)
    ],
    cf.UNSUPPORTED_CAUSAL: [
        "Nguyên nhân chính là nhu cầu mượn tăng mạnh.",
        "Việc thiếu hàng là do lượt đặt chỗ tăng.",
        "Thời gian chờ hàng dài đã gây ra tình trạng thiếu sách.",
        "Tình trạng này xuất phát từ việc nhà cung cấp giao chậm.",  # (*)
    ],
    cf.UNSUPPORTED_RECOMMENDATION: [
        "Đây là phương án tối ưu nhất cho thư viện.",
        "Mức này là lựa chọn tốt nhất về chi phí.",
        "Phương án này hiệu quả nhất trong các lựa chọn.",
        "Không cần cân nhắc thêm, đây là quyết định đúng đắn nhất.",  # (*)
    ],
    cf.REASONING_OVERCLAIM: [
        "Chắc chắn tình hình này sẽ còn tiếp diễn.",
        "Rõ ràng là cần hành động ngay.",
        "Không còn nghi ngờ gì về kết luận này.",
        "Dữ liệu đã chứng minh hoàn toàn điều đó.",  # (*)
    ],
    cf.INTERNAL_LABEL: ["Ý nghĩa: {first}", "[DỮ KIỆN] {first}", "Cơ sở: {first}", "{first} (theo trường variant_id)"],
}
OPP = {"tăng": ("giảm", "đi xuống", "thấp"), "giảm": ("tăng", "đi lên", "cao")}


def context_for(row: dict) -> cf.Context:
    return cf.build_context(row.get("data") or {}, row.get("explanation"), row.get("visualizations") or [])


def applicable(kind: str, ctx: cf.Context) -> bool:
    expl = ctx.explanation or {}
    return {
        cf.CONTRADICTION: ctx.trend in ("tăng", "giảm"),
        cf.RANKING_INCONSISTENCY: bool(ctx.riskiest) and len(ctx.warehouses) >= 2,
        cf.SCOPE_CONFUSION: ctx.borrow_data and bool(ctx.warehouses),
        cf.UNSUPPORTED_CAUSAL: True,
        cf.UNSUPPORTED_RECOMMENDATION: True,
        # the certainty check only applies where the evidence is not CAO
        cf.REASONING_OVERCLAIM: bool(expl) and (expl.get("certainty") in ("TRUNG BÌNH", "THẤP")
                                                or expl.get("mode") in ("causal", "what_if")),
        cf.INTERNAL_LABEL: True,
    }[kind]


def mutate(answer: str, kind: str, variant: int, ctx: cf.Context) -> str:
    template = MUTATIONS[kind][variant % len(MUTATIONS[kind])]
    opp = OPP.get(ctx.trend or "", ("", "", ""))
    others = [w for w in ctx.warehouses if w != ctx.riskiest]
    wh = ctx.warehouses[0] if ctx.warehouses else "Kho Ha Noi"
    first, _, rest = answer.partition("\n")
    sentence = template.format(opp=opp[0], opp_move=opp[1], opp_adj=opp[2], other=others[0] if others else "",
                               riskiest=ctx.riskiest or "", wh=wh, wh_short=wh.replace("Kho ", "").replace("Chi Nhanh ", ""),
                               n="1.234", first=first)
    if kind == cf.INTERNAL_LABEL:
        return sentence + ("\n" + rest if rest else "")
    return answer.rstrip() + "\n" + sentence


def detect(answer: str, ctx: cf.Context) -> set[str]:
    cleaned, labels = cf.strip_internal_labels(answer)
    return {i.type for i in labels} | {i.type for i in cf.validate(cleaned, ctx)}


def detect_xai2(answer: str, ctx: cf.Context) -> set[str]:
    """What Explainable AI 2.0 could catch: overclaims() + chart consistency."""
    out = set()
    for flag in overclaims(answer, ctx.explanation):
        out.add(cf.UNSUPPORTED_CAUSAL if "nguyên nhân" in flag["reason"] else
                cf.UNSUPPORTED_RECOMMENDATION if "tối ưu" in flag["reason"] else cf.REASONING_OVERCLAIM)
    if consistency_issues(ctx.visualizations, ctx.explanation):
        out.add(cf.EXPLANATION_CHART_MISMATCH)
    return out


def score(items: list[dict], detector) -> dict:
    tp, fp, fn = Counter(), Counter(), Counter()
    clean_flagged = clean = 0
    latencies = []
    for item in items:
        t0 = time.perf_counter()
        found = detector(item["answer"], item["ctx"])
        latencies.append((time.perf_counter() - t0) * 1000)
        expected = set(item["expected"])
        for t in found & expected:
            tp[t] += 1
        for t in found - expected:
            fp[t] += 1
        for t in expected - found:
            fn[t] += 1
        if not expected:
            clean += 1
            clean_flagged += bool(found)
    per_type = {}
    for t in TYPES:
        p = tp[t] / (tp[t] + fp[t]) if tp[t] + fp[t] else None
        r = tp[t] / (tp[t] + fn[t]) if tp[t] + fn[t] else None
        per_type[t] = {"tp": tp[t], "fp": fp[t], "fn": fn[t],
                       "precision": round(p, 3) if p is not None else None, "recall": round(r, 3) if r is not None else None}
    block = sorted(cf.BLOCKING)
    btp, bfp, bfn = (sum(c[t] for t in block) for c in (tp, fp, fn))
    all_tp, all_fp, all_fn = sum(tp.values()), sum(fp.values()), sum(fn.values())
    return {
        "items": len(items), "per_type": per_type,
        "contradiction_class": {"types": block, "precision": round(btp / (btp + bfp), 3) if btp + bfp else None,
                                "recall": round(btp / (btp + bfn), 3) if btp + bfn else None, "tp": btp, "fp": bfp, "fn": bfn},
        "overall": {"precision": round(all_tp / (all_tp + all_fp), 3) if all_tp + all_fp else None,
                    "recall": round(all_tp / (all_tp + all_fn), 3) if all_tp + all_fn else None,
                    "tp": all_tp, "fp": all_fp, "fn": all_fn},
        "false_positive_rate_on_clean": round(clean_flagged / clean, 3) if clean else None, "clean_items": clean,
        "latency_ms": {"p50": round(statistics.median(latencies), 3), "max": round(max(latencies), 3)} if latencies else {},
    }


def live_outcomes(rows: list[dict]) -> dict:
    ok = [r for r in rows if r.get("status") == 200 and r.get("faithfulness")]
    statuses = Counter(r["faithfulness"]["status"] for r in ok)
    final_clean = sum(1 for r in ok if not (detect(r["answer"], context_for(r)) - {cf.INTERNAL_LABEL}))
    return {
        "answers": len(ok), "status": dict(statuses),
        "retry_rate": round(sum(1 for r in ok if r["faithfulness"]["retried"]) / len(ok), 3) if ok else None,
        "final_answers_without_findings": f"{final_clean}/{len(ok)}",
        "llm_calls_mean": round(statistics.mean(r["llm_calls"] for r in ok), 2) if ok else None,
        "validator_latency_ms_p50": round(statistics.median(r["faithfulness"]["latency_ms"] for r in ok), 2) if ok else None,
        "turn_seconds_p50": round(statistics.median(r["seconds"] for r in ok), 2) if ok else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--answers", default=os.path.join(EVAL_DIR, "faithfulness_answers_live.json"))
    parser.add_argument("--labels", default=os.path.join(EVAL_DIR, "faithfulness_labels.json"))
    parser.add_argument("--out", default=os.path.join(EVAL_DIR, "reports", "faithfulness_eval.json"))
    args = parser.parse_args()
    with open(args.answers, encoding="utf-8") as fh:
        rows = json.load(fh)["rows"]
    with open(args.labels, encoding="utf-8") as fh:
        labels = json.load(fh)["labels"]

    dev = [{"answer": a, "ctx": DEV_CTX, "expected": e} for a, e in DEV_CASES]
    real, mutated = [], []
    variant = defaultdict(int)
    for r in rows:
        key = f"{r['case']}#{r['turn']}"
        if r.get("status") != 200 or key not in labels or not r.get("draft_answer"):
            continue
        ctx = context_for(r)
        expected = set(labels[key])
        real.append({"key": key, "answer": r["draft_answer"], "ctx": ctx, "expected": expected})
        if expected:
            continue  # only clean answers are mutated: one known error each
        for kind in MUTATIONS:
            if applicable(kind, ctx):
                mutated.append({"key": f"{key}+{kind}", "answer": mutate(r["draft_answer"], kind, variant[kind], ctx),
                                "ctx": ctx, "expected": {kind}, "variant": variant[kind] % len(MUTATIONS[kind])})
                variant[kind] += 1
    heldout = real + mutated
    report = {
        "sizes": {"dev": len(dev), "real": len(real), "mutated": len(mutated), "heldout": len(heldout)},
        "dev": score(dev, detect),
        "real": {"v3_1": score(real, detect), "xai2": score(real, detect_xai2)},
        "mutated": {"v3_1": score(mutated, detect), "xai2": score(mutated, detect_xai2)},
        "heldout": {"v3_1": score(heldout, detect), "xai2": score(heldout, detect_xai2)},
        "live": live_outcomes(rows),
        "real_findings": [{"key": i["key"], "expected": sorted(i["expected"]), "found": sorted(detect(i["answer"], i["ctx"]))}
                          for i in real if detect(i["answer"], i["ctx"]) or i["expected"]],
        "missed_mutations": [{"key": i["key"], "variant": i["variant"], "answer_tail": i["answer"][-160:]}
                             for i in mutated if not (set(i["expected"]) & detect(i["answer"], i["ctx"]))],
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1, default=sorted)
    print(json.dumps({k: report[k] for k in ("sizes", "live")}, ensure_ascii=False, indent=1))
    for name in ("dev", "real", "mutated", "heldout"):
        block = report[name]
        for version, s in ([("v3_1", block)] if name == "dev" else block.items()):
            print(f"{name:8} {version:5} overall P={s['overall']['precision']} R={s['overall']['recall']} "
                  f"| contradiction-class P={s['contradiction_class']['precision']} R={s['contradiction_class']['recall']} "
                  f"| FP-rate clean={s['false_positive_rate_on_clean']} (n={s['clean_items']}) | {s['latency_ms']}")
    print("per type (held-out, v3.1):")
    for t, v in report["heldout"]["v3_1"]["per_type"].items():
        print(f"  {t:28} P={v['precision']} R={v['recall']}  tp={v['tp']} fp={v['fp']} fn={v['fn']}")
    print("report:", args.out)


if __name__ == "__main__":
    main()
