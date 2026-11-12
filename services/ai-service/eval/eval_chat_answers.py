"""End-to-end answer evaluation of the General AI Chatbot (Phase B2).

Retrieval accuracy (eval_rag.py) says whether the right document was FOUND;
this says whether the final ANSWER is right. Every case in
chat_answer_dataset.json is sent to the live /ai/chat through the gateway as a
real demo user, and the reply is scored deterministically:

- correctness   every `must_include` fact is in the reply, no `must_not_include`
                phrase is (invented policies, false "not supported" claims);
- abstention    out-of-scope cases must say the information is missing, and
                answerable ones must not (false refusal);
- partial       half-answerable cases must answer the known half AND say the
                other half is not known;
- false premise / contradiction   the reply must state the correct value;
- dynamic data  the user's own live data must be answered, not refused;
- citation      correctness = share of cited documents that are acceptable,
                completeness = at least one acceptable document cited;
- grounding     no numeric-grounding warning (a number the data does not have).

A citation is never taken as proof the content is right: correctness is
scored on the reply text only. Numbers are compared without thousands
separators, text without diacritics.

    python eval/eval_chat_answers.py --password <demo password> [--gateway http://localhost:3000]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone

import httpx

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
REPORTS_DIR = os.path.join(EVAL_DIR, "reports")
ABSTAIN_MARKERS = ("chua co thong tin", "chua co du thong tin", "chua tim thay thong tin", "khong co thong tin",
                   "chua co du lieu", "chua du thong tin", "chua co quy dinh", "chua xac minh duoc", "khong tim thay thong tin")
GROUNDING_WARNING = "không khớp trực tiếp với dữ liệu"


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", (text or "").lower().replace("đ", "d"))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"(?<=\d)[.,](?=\d{3}\b)", "", text)


def abstained(body: dict) -> bool:
    return body.get("ai_provider") == "abstention" or any(m in normalize(body.get("reply", "")) for m in ABSTAIN_MARKERS)


def score(case: dict, body: dict) -> dict:
    reply = normalize(body.get("reply", ""))
    facts_ok = all(normalize(f) in reply for f in case["must_include"])
    forbidden = [p for p in case["must_not_include"] if normalize(p) in reply]
    gave_up = abstained(body)
    expect = case["expect"]
    if expect == "abstain":
        correct = gave_up and not forbidden
    elif expect == "partial":
        correct = facts_ok and gave_up and not forbidden
    elif expect == "dynamic":
        # the user's own data reaches the prompt through the personal context
        # whatever the intent; what matters is an answer, not a refusal
        correct = not gave_up and body.get("ai_provider") not in ("fallback", "abstention")
    else:  # answer, correct_premise
        correct = facts_ok and not forbidden and not gave_up
    cited = {s.get("endpoint", "")[len("faq://"):] for s in body.get("context_sources") or []
             if str(s.get("endpoint", "")).startswith("faq://")}
    expected = set(case["expected_docs"])
    return {
        "correct": correct, "facts_ok": facts_ok, "forbidden_hits": forbidden, "abstained": gave_up,
        "false_refusal": gave_up and expect in ("answer", "correct_premise"),
        "cited": sorted(cited),
        "citation_precision": (len(cited & expected) / len(cited)) if cited and expected else None,
        "citation_complete": bool(cited & expected) if expected else None,
        "grounding_warning": any(GROUNDING_WARNING in w for w in body.get("retrieval_warnings") or []),
    }


def ask(client: httpx.Client, gateway: str, token: str, question: str) -> dict:
    for attempt in range(4):
        r = client.post(f"{gateway}/ai/chat", json={"message": question, "conversation_history": []},
                        headers={"Authorization": f"Bearer {token}"})
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        # 429 from ai-service, or the model fell back because OpenRouter throttled: wait, ask again
        if r.status_code != 429 and body.get("ai_provider") != "fallback":
            return {"status": r.status_code, **body}
        time.sleep(25 * (attempt + 1))
    return {"status": r.status_code, **body, "throttled": True}


def summarize(rows: list[dict]) -> dict:
    def rate(items, key):
        values = [i[key] for i in items if i[key] is not None]
        return round(sum(1 for v in values if v) / len(values), 3) if values else None

    by_category = {}
    for row in rows:
        by_category.setdefault(row["category"], []).append(row)
    answerable = [r for r in rows if r["expect"] in ("answer", "correct_premise")]
    abstain = [r for r in rows if r["expect"] == "abstain"]
    precisions = [r["citation_precision"] for r in rows if r["citation_precision"] is not None]
    return {
        "cases": len(rows),
        "answer_accuracy": rate(rows, "correct"),
        "by_category": {c: f"{sum(r['correct'] for r in items)}/{len(items)}" for c, items in by_category.items()},
        "abstention_accuracy": rate(abstain, "correct"),
        "false_refusal_rate": rate(answerable, "false_refusal"),
        "unsupported_claim_cases": sum(1 for r in rows if r["forbidden_hits"]),
        "citation_precision": round(sum(precisions) / len(precisions), 3) if precisions else None,
        "citation_completeness": rate([r for r in rows if r["citation_complete"] is not None], "citation_complete"),
        "grounding_warning_rate": rate(rows, "grounding_warning"),
        "throttled": sum(1 for r in rows if r.get("throttled")),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default=os.getenv("EVAL_GATEWAY_URL", "http://localhost:3000"))
    parser.add_argument("--password", default=os.getenv("EVAL_PASSWORD", ""))
    parser.add_argument("--delay", type=float, default=6.0)
    args = parser.parse_args()
    if not args.password:
        parser.error("--password (or EVAL_PASSWORD) is required")
    with open(os.path.join(EVAL_DIR, "chat_answer_dataset.json"), encoding="utf-8") as fh:
        cases = json.load(fh)

    rows, tokens = [], {}
    with httpx.Client(timeout=180) as client:
        for case in cases:
            user = case["user"]
            if user not in tokens:
                tokens[user] = client.post(f"{args.gateway}/auth/login",
                                           json={"identifier": user, "password": args.password}).json()["token"]
            body = ask(client, args.gateway, tokens[user], case["question"])
            row = {**case, **score(case, body), "reply": body.get("reply"), "intent": body.get("intent"),
                   "provider": body.get("ai_provider"), "throttled": body.get("throttled", False)}
            rows.append(row)
            print(f"{case['id']:14s} {'OK ' if row['correct'] else 'BAD'} provider={row['provider']} "
                  f"abst={row['abstained']} forbidden={row['forbidden_hits']}", flush=True)
            time.sleep(args.delay)

    summary = summarize(rows)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    os.makedirs(REPORTS_DIR, exist_ok=True)
    with open(os.path.join(REPORTS_DIR, f"chat_answers_{stamp}.json"), "w", encoding="utf-8") as fh:
        json.dump({"summary": summary, "rows": rows}, fh, ensure_ascii=False, indent=1)
    lines = [f"# Chat answer evaluation — {stamp}", "", "Live /ai/chat through the gateway; deterministic scoring "
             "(see eval_chat_answers.py).", "", "## Summary", "", "```json", json.dumps(summary, ensure_ascii=False, indent=1),
             "```", "", "## Cases", "", "| id | category | expect | correct | abstained | forbidden | cited | provider |",
             "|---|---|---|---|---|---|---|---|"]
    lines += [f"| {r['id']} | {r['category']} | {r['expect']} | {'yes' if r['correct'] else 'NO'} | {r['abstained']} | "
              f"{', '.join(r['forbidden_hits']) or '-'} | {', '.join(r['cited']) or '-'} | {r['provider']} |" for r in rows]
    with open(os.path.join(REPORTS_DIR, f"chat_answers_{stamp}.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
