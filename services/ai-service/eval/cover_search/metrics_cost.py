"""Read the OpenRouter cost/token counters that production code itself
increments (metrics.ai_llm_cost_usd_total / ai_llm_tokens_total, fed from
OpenRouter's usage.cost). These are the provider-reported numbers, never an
estimate; an estimate is computed separately in cost_analysis.py and labelled
as such."""
from __future__ import annotations


def read_cost_counters() -> dict:
    import metrics as prod_metrics

    def collect(counter) -> dict:
        out = {}
        for family in counter.collect():
            for sample in family.samples:
                if sample.name.endswith("_total"):
                    label = "|".join(f"{k}={v}" for k, v in sorted(sample.labels.items()))
                    out[label] = sample.value
        return out

    return {
        "provider_reported_cost_usd": collect(prod_metrics.ai_llm_cost_usd_total),
        "provider_reported_tokens": collect(prod_metrics.ai_llm_tokens_total),
    }
