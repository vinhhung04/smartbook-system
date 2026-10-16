"""Collects REAL copilot answers with their full context for the semantic
faithfulness evaluation (eval_faithfulness.py).

Questions come from sets written BEFORE the validator existed - the
Explainable AI 2.0 set (explain_dataset.json, 44 cases / 50 turns: lookup,
analysis, comparison, causal, decision, what-if, multi-turn...) and the chart
questions of the Copilot 3.0 set that run live - so the validator's rules were
not tuned on them. For every turn it keeps the model's first answer
(debug.draft_answer, before any check), the final answer, the explanation, the
visualizations and the tool data the answer was written from.

    EVAL_PASSWORD=<demo password> python services/ai-service/eval/collect_faithfulness_answers.py

ai-service allows 15 requests/minute per IP: requests are paced.
"""
from __future__ import annotations

import argparse
import json
import os
import time
import uuid
from datetime import datetime

import httpx

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
VIZ_CASES = ["tr-01", "tr-02", "cp-01", "cp-03", "cp-04", "cp-05", "cp-07", "bd-01", "bd-02", "kp-02", "rk-01", "fu-04"]
ROLE_USER = {"ADMIN": "hung", "WAREHOUSE_MANAGER": "manager01"}


def load_turns() -> list[dict]:
    with open(os.path.join(EVAL_DIR, "explain_dataset.json"), encoding="utf-8") as fh:
        explain = json.load(fh)["cases"]
    with open(os.path.join(EVAL_DIR, "visualization_dataset.json"), encoding="utf-8") as fh:
        viz = {c["id"]: c for c in json.load(fh)["cases"]}
    cases = [{"id": f"xai-{c['id']}", "category": c["category"], "user": ROLE_USER.get(c.get("role"), "hung"),
              "turns": [t["q"] for t in c["turns"]]} for c in explain]
    cases += [{"id": f"viz-{cid}", "category": viz[cid]["category"], "user": viz[cid]["user"],
               "turns": [t["q"] for t in viz[cid]["turns"]]} for cid in VIZ_CASES]
    return cases


def load_v32_turns() -> list[dict]:
    """Copilot 3.2 live held-out questions (decision_verification_live_questions.json)."""
    with open(os.path.join(EVAL_DIR, "decision_verification_live_questions.json"), encoding="utf-8") as fh:
        return [{"id": c["id"], "category": c["id"].split("-")[1], "user": c["user"], "turns": c["turns"]}
                for c in json.load(fh)["cases"]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default=os.getenv("EVAL_GATEWAY_URL", "http://localhost:3000"))
    parser.add_argument("--password", default=os.getenv("EVAL_PASSWORD", ""))
    parser.add_argument("--delay", type=float, default=4.5)
    parser.add_argument("--out", default="")
    parser.add_argument("--cases", choices=["v31", "v32"], default="v31",
                        help="v31: the 3.1 sets (XAI 2.0 + Copilot 3.0 charts); v32: the 3.2 live held-out questions")
    args = parser.parse_args()
    tokens: dict[str, str] = {}
    rows = []
    with httpx.Client(timeout=300) as client:
        def token(user: str) -> str:
            if user not in tokens:
                r = client.post(f"{args.gateway}/auth/login", json={"identifier": user, "password": args.password})
                r.raise_for_status()
                tokens[user] = r.json()["token"]
            return tokens[user]

        for case in (load_v32_turns() if args.cases == "v32" else load_turns()):
            cid = str(uuid.uuid4())
            for n, q in enumerate(case["turns"]):
                for attempt in range(6):
                    time.sleep(args.delay)
                    t0 = time.perf_counter()
                    r = client.post(f"{args.gateway}/ai/assistant", json={"message": q, "conversation_id": cid},
                                    headers={"Authorization": f"Bearer {token(case['user'])}"})
                    if r.status_code != 429:
                        break
                    time.sleep(60)
                seconds = time.perf_counter() - t0
                if r.status_code != 200:
                    rows.append({"case": case["id"], "turn": n, "q": q, "status": r.status_code})
                    continue
                b = r.json()
                rows.append({
                    "case": case["id"], "category": case["category"], "user": case["user"], "turn": n, "q": q,
                    "status": 200, "seconds": round(seconds, 2),
                    "draft_answer": (b.get("debug") or {}).get("draft_answer") or b.get("answer"),
                    "answer": b.get("answer"), "faithfulness": b.get("faithfulness"),
                    "verification": b.get("verification"), "pending_action": bool(b.get("pending_action")),
                    "llm_calls": len((b.get("debug") or {}).get("llm_calls") or []),
                    "explanation": b.get("explanation"), "visualizations": b.get("visualizations"),
                    "data": b.get("data"), "mode": (b.get("plan") or {}).get("answer_mode"),
                })
                print(case["id"], n, r.status_code, (b.get("faithfulness") or {}).get("status"), f"{seconds:.1f}s")
    out = args.out or os.path.join(EVAL_DIR, f"faithfulness_answers_{datetime.now():%Y%m%d_%H%M%S}.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"collected_at": datetime.now().isoformat(timespec="seconds"), "rows": rows}, fh, ensure_ascii=False, indent=1)
    print("saved", out, len(rows), "turns")


if __name__ == "__main__":
    main()
