"""Same questions, same way, before and after a change: turn time, LLM calls,
retry/fallback, verification status (Copilot 3.2 before/after measurement).

    EVAL_PASSWORD=<demo password> python services/ai-service/eval/measure_assistant_latency.py --label before --out x.json

Every question goes to a NEW conversation (no answer-cache hit). ai-service
allows 15 requests/minute per IP: requests are paced. LLM latency varies run
to run; report medians and keep the raw rows.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import time
import uuid

import httpx

QUESTIONS = [
    "Với 7 triệu thì nhập được bao nhiêu đầu sách và hết bao nhiêu tiền?",
    "Có bao nhiêu đầu sách cần nhập và tổng chi phí ước tính là bao nhiêu?",
    "Tháng 9 so với tháng 8 lượt mượn thay đổi thế nào?",
    "Chi Nhanh District 1 và Kho Ha Noi kho nào cần quan tâm hơn?",
    "Tổng cộng các kho có bao nhiêu đầu sách hết hàng?",
    "Có bao nhiêu cuốn sách đang quá hạn và trễ trung bình bao lâu?",
    "Đầu sách nào nên nhập đầu tiên và vì sao?",
    "Lượt mượn tuần này so với tuần trước tăng hay giảm bao nhiêu phần trăm?",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default=os.getenv("EVAL_GATEWAY_URL", "http://localhost:3000"))
    parser.add_argument("--password", default=os.getenv("EVAL_PASSWORD", ""))
    parser.add_argument("--label", required=True)
    parser.add_argument("--delay", type=float, default=4.5)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    rows = []
    with httpx.Client(timeout=300) as client:
        token = client.post(f"{args.gateway}/auth/login", json={"identifier": "hung", "password": args.password}).json()["token"]
        for q in QUESTIONS:
            for _attempt in range(6):
                time.sleep(args.delay)
                t0 = time.perf_counter()
                r = client.post(f"{args.gateway}/ai/assistant", json={"message": q, "conversation_id": str(uuid.uuid4())},
                                headers={"Authorization": f"Bearer {token}"})
                if r.status_code != 429:
                    break
                time.sleep(60)
            seconds = time.perf_counter() - t0
            b = r.json() if r.status_code == 200 else {}
            rows.append({"q": q, "status": r.status_code, "seconds": round(seconds, 2),
                         "llm_calls": len((b.get("debug") or {}).get("llm_calls") or []),
                         "faithfulness": (b.get("faithfulness") or {}).get("status"),
                         "retried": (b.get("faithfulness") or {}).get("retried"),
                         "verification": (b.get("verification") or {}).get("status"),
                         "verification_ms": (b.get("verification") or {}).get("latency_ms"),
                         "check_ms": (b.get("faithfulness") or {}).get("latency_ms")})
            print(args.label, r.status_code, f"{seconds:.1f}s", rows[-1]["llm_calls"], rows[-1]["faithfulness"], rows[-1]["verification"])
    ok = [r for r in rows if r["status"] == 200]
    secs = sorted(r["seconds"] for r in ok)
    summary = {
        "label": args.label, "answers": len(ok), "errors": len(rows) - len(ok),
        "turn_seconds_p50": round(statistics.median(secs), 2) if secs else None,
        "turn_seconds_p95": secs[int(0.95 * (len(secs) - 1))] if secs else None,
        "llm_calls_mean": round(statistics.mean(r["llm_calls"] for r in ok), 2) if ok else None,
        "retry_rate": round(sum(1 for r in ok if r["retried"]) / len(ok), 3) if ok else None,
        "fallback_rate": round(sum(1 for r in ok if r["faithfulness"] == "fallback") / len(ok), 3) if ok else None,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"summary": summary, "rows": rows}, fh, ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
