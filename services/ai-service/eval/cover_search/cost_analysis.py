"""E6 (API part): provider-reported cost/tokens of every recorded vision call,
and a clearly-labelled ESTIMATE for runs that have not happened yet.

    python cost_analysis.py --planned-calls 600

ACTUAL numbers come only from OpenRouter's usage.cost / token counts stored in
runs/_cache/ocr_responses.jsonl. The estimate = planned_calls x observed mean
cost per call (with the observed min/max as a range); it is never reported as
actual cost.
"""
from __future__ import annotations

import argparse
import json

from common import RUNS_DIR


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--planned-calls", type=int, default=0)
    args = parser.parse_args()

    path = RUNS_DIR / "_cache" / "ocr_responses.jsonl"
    entries = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()] if path.exists() else []
    usages = [e["usage"] for e in entries if e.get("usage")]
    costs = [u["cost_usd"] for u in usages if u.get("cost_usd") is not None]
    prompt = [u["prompt_tokens"] for u in usages if u.get("prompt_tokens") is not None]
    completion = [u["completion_tokens"] for u in usages if u.get("completion_tokens") is not None]
    result = {
        "ACTUAL_provider_reported": {
            "vision_calls_recorded": len(entries),
            "outcomes": {o: sum(1 for e in entries if e["outcome"] == o) for o in sorted({e["outcome"] for e in entries})},
            "calls_with_cost": len(costs), "total_cost_usd": sum(costs),
            "mean_cost_usd": sum(costs) / len(costs) if costs else None,
            "min_cost_usd": min(costs) if costs else None, "max_cost_usd": max(costs) if costs else None,
            "mean_prompt_tokens": sum(prompt) / len(prompt) if prompt else None,
            "mean_completion_tokens": sum(completion) / len(completion) if completion else None,
        },
    }
    if args.planned_calls and costs:
        mean = sum(costs) / len(costs)
        result["ESTIMATE_not_actual"] = {
            "planned_vision_calls": args.planned_calls,
            "estimated_cost_usd": args.planned_calls * mean,
            "range_usd": [args.planned_calls * min(costs), args.planned_calls * max(costs)],
            "basis": f"observed mean of {len(costs)} pilot calls; excludes text-embedding calls (reported separately in run manifests)",
        }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
