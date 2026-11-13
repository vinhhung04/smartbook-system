"""E6 (local part): CLIP cold-start vs warm-start latency of the production
cover_embeddings.embed_image(), measured in FRESH processes so the cold number
really includes model loading (weights already in the local HF cache; no
download is counted).

    python latency_benchmark.py --images 20 --cold-runs 3

Writes runs/E6_latency_<ts>/latency.json. Uses CPU only (production ai-service
container has no GPU).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time

from common import RUNS_DIR

CHILD = r"""
import json, sys, time
t0 = time.perf_counter()
from common import setup_environment
setup_environment(load_secrets=False)
import cover_embeddings
t_import = time.perf_counter()
data = open(sys.argv[1], 'rb').read()
t1 = time.perf_counter()
vec = cover_embeddings.embed_image(data)
t2 = time.perf_counter()
print(json.dumps({"import_ms": (t_import - t0) * 1000, "first_embed_ms_incl_model_load": (t2 - t1) * 1000, "ok": vec is not None}))
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", type=int, default=20)
    parser.add_argument("--cold-runs", type=int, default=3)
    args = parser.parse_args()

    from common import setup_environment
    setup_environment(load_secrets=False)
    from dataset_loader import load_dataset
    import retrieval_metrics as rm

    ds = load_dataset()
    queries = [q for q in ds.included_queries() if q["query_track"] in ("A", "B")][: args.images]
    paths = [ds.asset_path(q["query_asset_id"]) for q in queries]

    cold = []
    for i in range(args.cold_runs):
        out = subprocess.run([sys.executable, "-c", CHILD, str(paths[i % len(paths)])], capture_output=True, text=True,
                             cwd=str(RUNS_DIR.parent))
        cold.append(json.loads(out.stdout.strip().splitlines()[-1]))

    import cover_embeddings
    cover_embeddings.embed_image(paths[0].read_bytes())  # warm the model in this process
    warm = []
    for path in paths:
        data = path.read_bytes()
        started = time.perf_counter()
        cover_embeddings.embed_image(data)
        warm.append((time.perf_counter() - started) * 1000)

    result = {
        "device": "cpu", "measured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cold_runs": cold,
        "cold_first_embed_ms": {"p50": rm.percentile([c["first_embed_ms_incl_model_load"] for c in cold], 50),
                                "max": max(c["first_embed_ms_incl_model_load"] for c in cold)},
        "warm_embed_ms": {"n": len(warm), "p50": rm.percentile(warm, 50), "p95": rm.percentile(warm, 95),
                          "mean": sum(warm) / len(warm)},
    }
    out_dir = RUNS_DIR / f"E6_latency_{time.strftime('%Y%m%dT%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "latency.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
