"""Phase F explainability benchmark on the existing chat answer dataset
(eval/chat_answer_dataset.json, 33 cases, verified ground truth: expected
documents, answer vs abstain). Runs the REAL /chat through the gateway with the
case's demo user and scores the `explainability` contract the reply carries.

Metrics
  evidence_coverage        answer cases whose contract lists >= 1 evidence item
  claim_support_rate       SUPPORTED / claims that received a verdict
  unsupported_claim_rate   UNSUPPORTED / claims that received a verdict
  citation_precision       DOCUMENT evidence that is one of the case's expected docs
  citation_recall          expected docs present as DOCUMENT evidence
  abstention_accuracy      abstain cases answered with NO_EVIDENCE (or the fixed refusal)
  passed_with_unsupported  answers marked PASSED while a claim is UNSUPPORTED/CONTRADICTED (must be 0)

Baseline: before Phase F, /chat returned no claim-level contract at all (only
`context_sources`), so every contract metric is 0 / not available by construction.

    python eval/phase_f_explainability_eval.py
"""
from __future__ import annotations

import json
import os
import sys
import time

import httpx

GW = os.getenv("SMARTBOOK_GATEWAY", "http://localhost:3000")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "chat_answer_dataset.json")
OUT = os.path.join(HERE, "reports", "phase_f_explainability.json")


def main() -> None:
    if "--rescore" in sys.argv:  # recompute the summary from the saved rows, no API call
        saved = json.load(open(OUT, encoding="utf-8"))
        summarize(saved["rows"], saved["run_at"])
        return
    cases = json.load(open(DATA, encoding="utf-8"))["cases"]
    c = httpx.Client(base_url=GW, timeout=180)
    tokens = {}
    for user in sorted({x.get("user") for x in cases if x.get("user")}):
        tokens[user] = c.post("/auth/login", json={"username": user, "password": "123456"}).json()["token"]
        time.sleep(1.2)
    rows = []
    for case in cases:
        headers = {"Authorization": f"Bearer {tokens[case['user']]}"} if case.get("user") else {}
        started = time.perf_counter()
        r = c.post("/ai/chat", headers=headers, json={"message": case["question"]})
        body = r.json() if r.status_code == 200 else {}
        x = body.get("explainability") or {}
        docs = [e.get("source_ref", "")[len("faq://"):] for e in x.get("evidence", []) if e.get("source_type") == "DOCUMENT"]
        verdicts = [cl.get("verdict") for cl in x.get("claims", []) if cl.get("verdict")]
        rows.append({"id": case["id"], "category": case["category"], "expect": case["expect"], "http": r.status_code,
                     "latency_ms": round((time.perf_counter() - started) * 1000), "status": (x.get("verification") or {}).get("status"),
                     "evidence": len(x.get("evidence", [])), "docs": docs, "expected_docs": case.get("expected_docs") or [],
                     "verdicts": verdicts, "provider": body.get("ai_provider")})
        print(case["id"], r.status_code, rows[-1]["status"], verdicts)
        time.sleep(4.5)  # stay under the per-user 15 requests/min
    summarize(rows, time.strftime("%Y-%m-%dT%H:%M:%S%z"))


def summarize(rows: list[dict], run_at: str) -> None:
    # expect: answer | dynamic | partial | correct_premise -> an answer is due; abstain -> refusal is due
    answer = [r for r in rows if r["expect"] != "abstain" and r["http"] == 200]
    abstain = [r for r in rows if r["expect"] == "abstain" and r["http"] == 200]
    verdicts = [v for r in rows for v in r["verdicts"]]
    cited = [d for r in rows for d in r["docs"]]
    cited_ok = [d for r in rows for d in r["docs"] if d in r["expected_docs"]]
    expected = [(r["id"], d) for r in rows for d in r["expected_docs"]]
    recalled = [(r["id"], d) for r in rows for d in r["expected_docs"] if d in r["docs"]]
    summary = {
        "cases": len(rows), "http_errors": sum(1 for r in rows if r["http"] != 200),
        "evidence_coverage": f"{sum(1 for r in answer if r['evidence'] > 0)}/{len(answer)}",
        "claims_with_verdict": len(verdicts),
        "claim_support_rate": round(verdicts.count("SUPPORTED") / len(verdicts), 3) if verdicts else None,
        "unsupported_claim_rate": round(verdicts.count("UNSUPPORTED") / len(verdicts), 3) if verdicts else None,
        "contradicted_claims": verdicts.count("CONTRADICTED"),
        "unverifiable_rate": round(verdicts.count("UNVERIFIABLE") / len(verdicts), 3) if verdicts else None,
        "citation_precision": f"{len(cited_ok)}/{len(cited)}",
        "citation_recall": f"{len(recalled)}/{len(expected)}",
        "abstention_accuracy": f"{sum(1 for r in abstain if r['status'] == 'NO_EVIDENCE' or r['provider'] == 'abstention')}/{len(abstain)}",
        "passed_with_unsupported": sum(1 for r in rows if r["status"] == "PASSED"
                                       and ({"UNSUPPORTED", "CONTRADICTED"} & set(r["verdicts"]))),
        "status_distribution": {s: sum(1 for r in rows if r["status"] == s) for s in sorted({str(r["status"]) for r in rows})},
        "latency_ms_p50": sorted(r["latency_ms"] for r in rows)[len(rows) // 2],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"run_at": run_at, "summary": summary, "rows": rows},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
