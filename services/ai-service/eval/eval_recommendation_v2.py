"""Recommendation V2 evaluation on the SYNTHETIC behavioural dataset.

    node services/borrow-service/prisma/simulation/seed-simulation.js --dry-run
    python services/ai-service/eval/eval_recommendation_v2.py [--write-weights]

Protocol (all cutoffs are quantiles of loan-item times, as in evaluation.js):
    train       history <  p60           -> features for validation
    validation  loans in [p60, p80)      -> weight / hyperparameter selection
    test        loans in [p80, end]      -> reported once, features refit on history < p80

Reads prisma/simulation/output/recommendation-events.json (observable rows only)
and, only for the ORACLE_TRUE_PREFERENCE ceiling, recommendation-oracle.json.
Writes eval/reports/recommendation_v2_report.{json,md}; with --write-weights also
services/ai-service/recommendation_v2_weights.json (the production config).
Offline, deterministic, no LLM, no network.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
AI_ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(AI_ROOT))
sys.path.insert(0, AI_ROOT)
sys.path.insert(0, HERE)

import recommendation as v1  # noqa: E402
import recommendation_v2 as v2  # noqa: E402
import recsys_protocol as proto  # noqa: E402
import recsys_tuning as tuning  # noqa: E402

SIM_OUTPUT = os.path.join(REPO, "services", "borrow-service", "prisma", "simulation", "output")
SIM_REPORT = os.path.join(REPO, "services", "borrow-service", "prisma", "simulation", "simulation-report.json")
DEFAULT_EVENTS = os.path.join(SIM_OUTPUT, "recommendation-events.json")
DEFAULT_ORACLE = os.path.join(SIM_OUTPUT, "recommendation-oracle.json")
REPORT_DIR = os.path.join(HERE, "reports")

VALIDATION_QUANTILE = 0.6
TEST_QUANTILE = 0.8
MIN_TRAIN_LOANS = 3
KS = (5, 10)
CORE_METRICS = ("ndcg@10", "recall@10", "mrr")
BOOTSTRAP_METRICS = (("hit_rate@10", 10), ("ndcg@10", 10), ("recall@10", 10), ("mrr", 10))
ITEM_COLD_SHARE_MOD = 10  # books with sha1(id) % 10 == 0 are treated as new
CATEGORY_CAP = 3
RANDOM_SEED = 0xE7A1

ABLATION_ORDER = ("collaborative", "semantic", "preference", "popularity", "quality", "availability", "recency")
ONLY_VARIANTS = {
    "CONTENT_ONLY": ("preference", "author", "semantic"),
    "CF_ONLY": ("collaborative",),
}


def log(msg):
    print(msg, flush=True)


def iso(t):
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat().replace("+00:00", "Z")


# ── Baselines ────────────────────────────────────────────────────────────────

def candidates_for(split, catalog_keys, uid):
    seen = split["users"][uid]["seen"]
    return [b for b in catalog_keys if b not in seen]


def popularity_counts(interactions, cutoff, exclude_books=()):
    counts = {}
    for r in interactions:
        if r["kind"] == "LOAN" and r["at"] < cutoff and r["book_id"] not in exclude_books:
            counts[r["book_id"]] = counts.get(r["book_id"], 0) + 1
    return counts


def popularity_rankings(split, catalog_keys, counts):
    return {
        uid: sorted(candidates_for(split, catalog_keys, uid), key=lambda b: (-counts.get(b, 0), b))
        for uid in split["users"]
    }


def random_rankings(split, catalog_keys):
    rng = random.Random(RANDOM_SEED)
    out = {}
    for uid in sorted(split["users"]):
        c = candidates_for(split, catalog_keys, uid)
        rng.shuffle(c)
        out[uid] = c
    return out


def oracle_rankings(split, catalog_keys, oracle):
    scores = (oracle or {}).get("scores") or {}
    out = {}
    for uid in split["users"]:
        row = scores.get(uid)
        if row is None:
            continue
        out[uid] = sorted(candidates_for(split, catalog_keys, uid), key=lambda b: (-row.get(b, 0.0), b))
    return out


def v1_rankings(catalog, interactions, split, availability, protocol):
    """The production V1 path (recommendation.py) exactly as eval_recommendation_synthetic.py
    runs it: semantic=[] (no embeddings offline)."""
    cutoff = split["cutoff"]
    cat = [{**b, "available_quantity": availability.get(b["id"], 1.0)} for b in catalog]
    stats = {}
    for r in interactions:
        if r["kind"] == "REVIEW" and r["at"] < cutoff:
            s = stats.setdefault(r["book_id"], {"sum": 0.0, "totalReviews": 0})
            s["sum"] += r["rating"]
            s["totalReviews"] += 1
    rating_stats = {k: {"averageRating": s["sum"] / s["totalReviews"], "totalReviews": s["totalReviews"]} for k, s in stats.items()}
    by_user = {}
    for r in interactions:
        if r["at"] < cutoff:
            by_user.setdefault(r["user"], []).append(r)
    out = {}
    for uid, x in split["users"].items():
        rows = by_user.get(uid, [])
        loans, seen_loans = [], set()
        for r in sorted((r for r in rows if r["kind"] == "LOAN"), key=lambda r: -r["at"]):
            if r["book_id"] not in seen_loans:
                seen_loans.add(r["book_id"])
                loans.append(r["book_id"])
        if protocol == "legacy":
            wish = [r["book_id"] for r in rows if r["kind"] == "WISHLIST" and r["until"] is None]
        else:
            wish = [r["book_id"] for r in rows if r["kind"] == "WISHLIST" and v2.active_at(r, cutoff)]
        rated = [(b, r["rating"]) for r in rows if r["kind"] == "REVIEW" for b in v1.books_from_ids([r["book_id"]], cat)]
        signals = v1.collect_signals(v1.books_from_ids(loans, cat), v1.books_from_ids(wish, cat), rated)
        profile = v1.build_taste_profile(signals)
        candidates = v1.select_candidates(cat, profile)
        ranked = v1.rank_candidates(candidates, profile, rating_stats, semantic=[], limit=len(candidates))
        out[uid] = [e["book_id"] for e in ranked if e["book_id"] not in x["seen"]]
    return out


# ── Evaluation helpers ───────────────────────────────────────────────────────

def all_metrics(rankings, split, catalog, extra=None):
    out = {}
    for k in KS:
        out.update(proto.ranking_metrics(rankings, split, len(catalog), k))
    if extra:
        out.update(proto.beyond_accuracy(rankings, split, *extra))
    return out


def per_user(rankings, split):
    return {m: proto.per_user_vector(rankings, split, m, k) for m, k in BOOTSTRAP_METRICS}


def restricted_recall(rankings, split, subset, k=10):
    """Recall@k over the targets that fall in `subset` (users with such targets)."""
    total = 0.0
    n = 0
    for uid, x in split["users"].items():
        t = x["targets"] & subset
        if not t:
            continue
        top = rankings.get(uid, [])[:k]
        total += sum(1 for b in top if b in t) / len(t)
        n += 1
    return {"users": n, f"recall@{k}": proto.r4(total / n) if n else None}


def segment_metrics(models, split, catalog, lo, hi):
    seg = proto.segment(split, lo, hi)
    return {
        "users": len(seg["users"]),
        "models": {name: proto.ranking_metrics(r, seg, len(catalog), 10) for name, r in models.items()},
    }


def item_is_masked(book_id):
    return int(hashlib.sha1(book_id.encode("utf-8")).hexdigest(), 16) % ITEM_COLD_SHARE_MOD == 0


# ── Main ─────────────────────────────────────────────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--events", default=DEFAULT_EVENTS)
    ap.add_argument("--oracle", default=DEFAULT_ORACLE)
    ap.add_argument("--out-dir", default=REPORT_DIR)
    ap.add_argument("--write-weights", action="store_true", help="write recommendation_v2_weights.json for production")
    ap.add_argument("--bootstrap", type=int, default=1000)
    args = ap.parse_args(argv)

    t0 = time.time()
    with open(args.events, encoding="utf-8") as handle:
        raw = handle.read()
    data = json.loads(raw)
    if not data.get("synthetic"):
        print("refusing: input is not marked synthetic", file=sys.stderr)
        return 1
    oracle = None
    if os.path.exists(args.oracle):
        with open(args.oracle, encoding="utf-8") as handle:
            oracle = json.load(handle)

    catalog = data["catalog"]
    catalog_keys = sorted(b["id"] for b in catalog)
    category_of = {b["id"]: v2.book_category(b) for b in catalog}
    copies = data.get("copies") or {}
    interactions = v2.normalize_interactions(data["events"])
    dropped = len(data["events"]) - len(interactions)
    end = v2.parse_time(data.get("window_end")) or (max(r["at"] for r in interactions) + 1)
    t_val = proto.loan_time_quantile(interactions, VALIDATION_QUANTILE)
    t_test = proto.loan_time_quantile(interactions, TEST_QUANTILE)
    log(f"[v2-eval] {len(interactions)} interactions ({dropped} malformed dropped), {len(catalog)} books")
    log(f"[v2-eval] validation cutoff {iso(t_val)}, test cutoff {iso(t_test)}, end {iso(end)}")

    # ── 1. Tuning on validation (the tuner never receives anything >= t_test) ──
    val_interactions = [r for r in interactions if r["at"] < t_test]
    val_split_all = proto.make_split(val_interactions, t_val, t_test, "audited")
    val_split = proto.segment(val_split_all, MIN_TRAIN_LOANS)
    val_avail = proto.availability_at(catalog, copies, val_interactions, t_val)
    val_harness = tuning.Harness(catalog, val_interactions, val_split, val_avail)
    log(f"[v2-eval] tuning V2 on {len(val_split['users'])} validation users")
    full = tuning.tune(val_harness, log=log)
    log(f"[v2-eval] V2 validation {full['objective']}={full['validation_objective']} weights={full['weights']} params={full['params']}")

    configs = {"V2": full}
    for group in ABLATION_ORDER:
        fixed = v2.ABLATION_GROUPS[group]
        fixed_params = {"half_life_days": None} if group == "recency" else {}
        start = {"weights": full["weights"], "params": {**full["params"], **fixed_params}}
        log(f"[v2-eval] ablation V2-{group}")
        configs[f"V2-{group}"] = tuning.tune(val_harness, fixed_zero=fixed, fixed_params=fixed_params, start=start, passes=3)
    for name, keep in ONLY_VARIANTS.items():
        log(f"[v2-eval] {name}")
        fixed = tuple(f for f in v2.FEATURES if f not in keep)
        fixed_params = {"half_life_days": None} if "recency" in fixed else {}
        configs[name] = tuning.tune(val_harness, fixed_zero=fixed, fixed_params=fixed_params, passes=3)
    cap_val = val_harness.objective(full["params"], full["weights"], max_per_category=CATEGORY_CAP)
    max_per_category = CATEGORY_CAP if cap_val > full["validation_objective"] + 1e-9 else None

    # ── 2. Test: refit features on history < t_test, score once ──
    test_split_all = proto.make_split(interactions, t_test, end, "audited")
    test_split = proto.segment(test_split_all, MIN_TRAIN_LOANS)
    test_avail = proto.availability_at(catalog, copies, interactions, t_test)
    test_harness = tuning.Harness(catalog, interactions, test_split_all, test_avail)
    full_catalog_harness = tuning.Harness(catalog, interactions, test_split_all, test_avail, use_pool=False)
    pop = popularity_counts(interactions, t_test)
    extra = (pop, category_of, catalog_keys, 10)

    def v2_rank(cfg, harness=test_harness, cap=None, new_arrival=None):
        return harness.rankings(cfg["params"], cfg["weights"], cfg["feature_scale"], cap, new_arrival)

    models = {
        "RANDOM": random_rankings(test_split_all, catalog_keys),
        "POPULARITY": popularity_rankings(test_split_all, catalog_keys, pop),
        "V1_PRODUCTION": v1_rankings(catalog, interactions, test_split_all, test_avail, "audited"),
        "V2": v2_rank(full),
        "V2+CATEGORY_CAP3": v2_rank(full, cap=CATEGORY_CAP),
        "V2_NO_CANDIDATE_PRUNING": v2_rank(full, full_catalog_harness),
        "CONTENT_ONLY": v2_rank(configs["CONTENT_ONLY"]),
        "CF_ONLY": v2_rank(configs["CF_ONLY"]),
    }
    orc = oracle_rankings(test_split_all, catalog_keys, oracle)
    if orc:
        models["ORACLE_TRUE_PREFERENCE"] = orc
    ablations = {name: v2_rank(cfg) for name, cfg in configs.items() if name.startswith("V2-")}

    results = {name: all_metrics(r, test_split, catalog, extra) for name, r in models.items()}
    ablation_results = {"V2 full": results["V2"], **{
        name.replace("V2-", "V2 - "): all_metrics(r, test_split, catalog, extra) for name, r in ablations.items()
    }}
    vectors = {name: per_user(r, test_split) for name, r in {**models, **ablations}.items()}

    def paired(a, b):
        return {m: proto.paired_bootstrap(vectors[a][m], vectors[b][m], resamples=args.bootstrap) for m, _ in BOOTSTRAP_METRICS}

    bootstrap = {name: {m: proto.bootstrap_ci(list(vectors[name][m].values()), resamples=args.bootstrap) for m, _ in BOOTSTRAP_METRICS}
                 for name in models}
    comparisons = {
        "V2_vs_V1": paired("V2", "V1_PRODUCTION"),
        "V2_vs_POPULARITY": paired("V2", "POPULARITY"),
        "V1_vs_POPULARITY": paired("V1_PRODUCTION", "POPULARITY"),
    }
    ablation_deltas = {name.replace("V2-", "V2 - "): paired("V2", name) for name in ablations}
    distributions = {name: proto.quartiles(list(vectors[name]["ndcg@10"].values())) for name in models}

    # ── 3. Cold start ──
    cold = {
        "new_users_0_train_loans": segment_metrics(models, test_split_all, catalog, 0, 0),
        "sparse_users_1_2_train_loans": segment_metrics(models, test_split_all, catalog, 1, 2),
        "regular_users_3plus_train_loans": segment_metrics(models, test_split_all, catalog, MIN_TRAIN_LOANS, None),
    }
    empty_lists = {name: sum(1 for u in test_split_all["users"] if not r.get(u)) for name, r in models.items() if name != "ORACLE_TRUE_PREFERENCE"}
    masked = {b for b in catalog_keys if item_is_masked(b)}
    masked_interactions = [r for r in interactions if not (r["book_id"] in masked and r["at"] < t_test)]
    masked_harness = tuning.Harness(catalog, masked_interactions, test_split, test_avail, new_books=set())
    masked_imputed_harness = tuning.Harness(catalog, masked_interactions, test_split, test_avail, new_books=masked)
    masked_pop = popularity_counts(interactions, t_test, exclude_books=masked)
    item_cold = {
        "masked_books": len(masked),
        "rule": f"sha1(book_id) % {ITEM_COLD_SHARE_MOD} == 0; all their interactions before the test cutoff removed from features (targets unchanged). "
                "zero_evidence = popularity/CF/recency left at 0; neutral_imputation = those features set to the mean of the reader's other candidates; "
                "new_arrival_slot = additionally the best-scoring new title is guaranteed one of the top-10 places (production policy: both)",
        "V2_with_history": restricted_recall(models["V2"], test_split, masked),
        "V2_as_new_books_zero_evidence": restricted_recall(v2_rank(full, masked_harness), test_split, masked),
        "V2_as_new_books_neutral_imputation": restricted_recall(v2_rank(full, masked_imputed_harness), test_split, masked),
        "V2_as_new_books_imputation_plus_new_arrival_slot": restricted_recall(
            v2_rank(full, masked_imputed_harness, new_arrival=(masked, 10, full["params"].get("new_arrival_slots", 1))), test_split, masked),
        "POPULARITY_as_new_books": restricted_recall(popularity_rankings(test_split, catalog_keys, masked_pop), test_split, masked),
        "V1_PRODUCTION": restricted_recall(models["V1_PRODUCTION"], test_split, masked),
        "RANDOM": restricted_recall(models["RANDOM"], test_split, masked),
    }

    # ── 4. Legacy protocol (parity with simulation-report.json) ──
    legacy_split_all = proto.make_split(interactions, t_test, end, "legacy")
    legacy_split = proto.segment(legacy_split_all, MIN_TRAIN_LOANS)
    ones = {b: 1.0 for b in catalog_keys}
    legacy_models = {
        "POPULARITY": popularity_rankings(legacy_split, catalog_keys, pop),
        "V1_PRODUCTION": v1_rankings(catalog, interactions, legacy_split, ones, "legacy"),
        "V2": v2_rank(full, tuning.Harness(catalog, interactions, legacy_split, ones)),
        "V2_LEGACY_EXCLUSIONS": v2_rank(full, tuning.Harness(catalog, interactions, legacy_split, ones, production_exclusions=False)),
    }
    orc_legacy = oracle_rankings(legacy_split, catalog_keys, oracle)
    if orc_legacy:
        legacy_models["ORACLE_TRUE_PREFERENCE"] = orc_legacy
    legacy = {name: all_metrics(r, legacy_split, catalog) for name, r in legacy_models.items()}
    parity = legacy_parity(legacy)

    # ── 5. Error analysis ──
    head_n = max(1, round(len(catalog_keys) * 0.2))
    head = set(sorted(catalog_keys, key=lambda b: (-pop.get(b, 0), b))[:head_n])
    tail = set(catalog_keys) - head
    loans = sorted(x["train_loans"] for x in test_split["users"].values())
    t1, t2 = loans[len(loans) // 3], loans[2 * len(loans) // 3]
    pool_hits = pool_total = 0
    pool_sizes = []
    for uid, u in test_harness.matrix(full["params"])["users"].items():
        if uid not in test_split["users"]:
            continue
        pool_sizes.append(len(u["keys"]))
        pool_hits += len(test_split["users"][uid]["targets"] & set(u["keys"]))
        pool_total += len(test_split["users"][uid]["targets"])
    error = {
        "v2_vs_popularity_ndcg@10_per_user": comparisons["V2_vs_POPULARITY"]["ndcg@10"],
        "v2_vs_v1_ndcg@10_per_user": comparisons["V2_vs_V1"]["ndcg@10"],
        "by_activity_tertile": {
            f"low (<= {t1} train loans)": segment_metrics(models, test_split, catalog, MIN_TRAIN_LOANS, t1),
            f"mid ({t1 + 1}-{t2})": segment_metrics(models, test_split, catalog, t1 + 1, t2),
            f"high (> {t2})": segment_metrics(models, test_split, catalog, t2 + 1, None),
        },
        "head_vs_tail_targets": {
            "head_definition": f"top {head_n} books by train loan count",
            **{name: {"head": restricted_recall(r, test_split, head), "tail": restricted_recall(r, test_split, tail)}
               for name, r in models.items()},
        },
        "candidate_pool": {
            "mean_pool_size": proto.r4(sum(pool_sizes) / len(pool_sizes)) if pool_sizes else None,
            "per_source_k": full["params"]["per_source_k"],
            "target_recall_of_pool": proto.r4(pool_hits / pool_total) if pool_total else None,
        },
    }

    # ── 6. Acceptance + report ──
    acceptance = decide_acceptance(comparisons)
    dataset = {
        "source": os.path.relpath(args.events, REPO).replace("\\", "/"),
        "sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        "seed": data.get("seed"),
        "synthetic": True,
        "users": len(data.get("customers") or []),
        "books": len(catalog),
        "interactions": len(interactions),
        "interactions_by_kind": {k: sum(1 for r in interactions if r["kind"] == k) for k in v2.KINDS},
        "malformed_dropped": dropped,
        "train_range": [data.get("window_start"), iso(t_val)],
        "validation_range": [iso(t_val), iso(t_test)],
        "test_range": [iso(t_test), iso(end)],
        "validation_eligible_users": len(val_split["users"]),
        "test_eligible_users": len(test_split["users"]),
        "test_users_all_segments": len(test_split_all["users"]),
        "min_train_loans": MIN_TRAIN_LOANS,
        "protocol": "audited point-in-time (see recsys_protocol.py)",
    }
    report = {
        "title": "Recommendation V2 Evaluation",
        "dataset": dataset,
        "model_configuration": {name: public_config(cfg) for name, cfg in configs.items()},
        "selected_max_per_category": max_per_category,
        "category_cap_validation": {"without": full["validation_objective"], f"cap{CATEGORY_CAP}": round(cap_val, 5)},
        "results": results,
        "bootstrap_95ci": bootstrap,
        "comparisons": comparisons,
        "per_user_ndcg@10_distribution": distributions,
        "ablation": ablation_results,
        "ablation_paired_delta_full_minus_ablated": ablation_deltas,
        "cold_start": {**cold, "empty_recommendation_lists": empty_lists, "item_cold_start": item_cold},
        "legacy_protocol": {"results": legacy, "parity_with_simulation_report": parity},
        "error_analysis": error,
        "acceptance": acceptance,
        "runtime_seconds": round(time.time() - t0, 1),
    }
    report["conclusion"] = conclusion(report)
    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "recommendation_v2_report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out_dir, "recommendation_v2_report.md"), "w", encoding="utf-8") as handle:
        handle.write(render_markdown(report))
    if args.write_weights:
        write_weights(full, max_per_category, dataset, acceptance, results)
    log(f"[v2-eval] done in {report['runtime_seconds']}s -> {args.out_dir}")
    for line in report["conclusion"]:
        log("  - " + line)
    return 0


def public_config(cfg):
    return {k: cfg[k] for k in ("weights", "params", "feature_scale", "validation_objective", "objective", "evaluations")}


def legacy_parity(legacy):
    if not os.path.exists(SIM_REPORT):
        return {"status": "simulation-report.json not found"}
    with open(SIM_REPORT, encoding="utf-8") as handle:
        rep = json.load(handle)
    js = ((rep.get("evaluation") or {}).get("recommendation") or {}).get("models") or {}
    names = {"POPULARITY": "POPULARITY", "V1_PRODUCTION": "SMARTBOOK_PRODUCTION_RANKER", "ORACLE_TRUE_PREFERENCE": "ORACLE_TRUE_PREFERENCE"}
    out = {}
    for py_name, js_name in names.items():
        if py_name not in legacy or js_name not in js:
            continue
        diffs = {m: proto.r4(abs((legacy[py_name].get(m) or 0) - (js[js_name].get(m) or 0)))
                 for m in ("hit_rate@10", "ndcg@10", "mrr", "users")}
        out[py_name] = {"max_abs_diff": max(v for k, v in diffs.items() if k != "users"), "diffs": diffs}
    return out


def decide_acceptance(comparisons):
    """Passed only if V2 beats BOTH V1 and POPULARITY on every core metric with a
    paired 95% bootstrap CI entirely above zero."""
    checks = {}
    for vs in ("V2_vs_V1", "V2_vs_POPULARITY"):
        for m in CORE_METRICS:
            ci = comparisons[vs][m]
            checks[f"{vs}:{m}"] = bool(ci["low"] is not None and ci["low"] > 0)
    return {
        "rule": "V2 - baseline > 0 with paired 95% bootstrap CI above zero, for NDCG@10, Recall@10 and MRR, against V1_PRODUCTION and POPULARITY",
        "checks": checks,
        "passed": all(checks.values()),
    }


def verdict(ci):
    if ci["low"] is not None and ci["low"] > 0:
        return "better"
    if ci["high"] is not None and ci["high"] < 0:
        return "worse"
    return "not significantly different"


def conclusion(report):
    r = report["results"]
    c = report["comparisons"]
    lines = []
    for vs, label in (("V2_vs_V1", "V1_PRODUCTION"), ("V2_vs_POPULARITY", "POPULARITY")):
        parts = [f"{m} {verdict(c[vs][m])} (Δ={c[vs][m]['mean']:+.4f}, 95% CI [{c[vs][m]['low']:+.4f}, {c[vs][m]['high']:+.4f}])"
                 for m in ("hit_rate@10",) + CORE_METRICS]
        lines.append(f"V2 vs {label} on {report['dataset']['test_eligible_users']} test users: " + "; ".join(parts) + ".")
    if "ORACLE_TRUE_PREFERENCE" in r:
        gap_pop = r["ORACLE_TRUE_PREFERENCE"]["ndcg@10"] - r["POPULARITY"]["ndcg@10"]
        gap_v2 = r["V2"]["ndcg@10"] - r["POPULARITY"]["ndcg@10"]
        if gap_pop > 0:
            lines.append(f"V2 closes {100 * gap_v2 / gap_pop:.1f}% of the NDCG@10 gap between POPULARITY and the latent-truth ORACLE ceiling.")
    cov = ("catalog_coverage@10", "personalization@10")
    lines.append("Coverage@10 / Personalization@10: " + ", ".join(
        f"{name} {r[name][cov[0]]}/{r[name][cov[1]]}" for name in ("POPULARITY", "V1_PRODUCTION", "V2")) + ".")
    helps = [n for n, d in report["ablation_paired_delta_full_minus_ablated"].items() if verdict(d["ndcg@10"]) == "better"]
    hurts = [n for n, d in report["ablation_paired_delta_full_minus_ablated"].items() if verdict(d["ndcg@10"]) == "worse"]
    neutral = [n for n in report["ablation_paired_delta_full_minus_ablated"] if n not in helps and n not in hurts]
    lines.append("Ablation (NDCG@10, paired CI): removing " + (", ".join(g.replace("V2 - ", "") for g in helps) or "no group")
                 + " significantly hurts; " + (", ".join(g.replace("V2 - ", "") for g in neutral) or "none")
                 + " show no significant effect" + (("; removing " + ", ".join(g.replace("V2 - ", "") for g in hurts) + " would help") if hurts else "") + ".")
    ic = report["cold_start"]["item_cold_start"]
    lines.append(f"Item cold start: Recall@10 on masked new books - V2 with imputation + new-arrival slot {ic['V2_as_new_books_imputation_plus_new_arrival_slot']['recall@10']}, "
                 f"imputation only {ic['V2_as_new_books_neutral_imputation']['recall@10']}, "
                 f"zero evidence {ic['V2_as_new_books_zero_evidence']['recall@10']}, POPULARITY {ic['POPULARITY_as_new_books']['recall@10']}, "
                 f"RANDOM {ic['RANDOM']['recall@10']} (V2 when their history is known: {ic['V2_with_history']['recall@10']}).")
    for key, label in (("new_users_0_train_loans", "new users"), ("sparse_users_1_2_train_loans", "sparse users")):
        seg = report["cold_start"][key]
        v, p = seg["models"]["V2"].get("ndcg@10"), seg["models"]["POPULARITY"].get("ndcg@10")
        if v is not None and p is not None:
            size = f"n={seg['users']}" + (", small sample - indicative only" if seg["users"] < 30 else "")
            lines.append(f"Cold start, {label} ({size}): NDCG@10 V2 {v} vs POPULARITY {p} ({'V2 higher' if v > p else 'POPULARITY higher' if p > v else 'equal'}).")
    lines.append("Acceptance " + ("PASSED - V2 may become the production default." if report["acceptance"]["passed"]
                                   else "NOT passed - keep V1 as the production default; V2 stays behind RECOMMENDATION_MODEL=v2."))
    return lines


def write_weights(full, max_per_category, dataset, acceptance, results):
    payload = {
        "model": "v2",
        "note": "Selected by eval/eval_recommendation_v2.py on the validation window of the synthetic dataset. Do not edit by hand.",
        "weights": full["weights"],
        "feature_scale": {k: round(v, 6) for k, v in full["feature_scale"].items()},
        "params": full["params"],
        "max_per_category": max_per_category,
        "provenance": {
            "dataset_sha256": dataset["sha256"],
            "dataset_seed": dataset["seed"],
            "train_range": dataset["train_range"],
            "validation_range": dataset["validation_range"],
            "objective": full["objective"],
            "validation_objective": full["validation_objective"],
            "test_ndcg@10": results["V2"]["ndcg@10"],
        },
        "acceptance": acceptance,
    }
    path = v2.WEIGHTS_PATH
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    log(f"[v2-eval] wrote {path}")


# ── Markdown ─────────────────────────────────────────────────────────────────

def md_table(rows, columns):
    if not rows:
        return "_no data_\n"
    out = ["| " + " | ".join(c[0] for c in columns) + " |", "| " + " | ".join("---" for _ in columns) + " |"]
    for r in rows:
        out.append("| " + " | ".join("" if (v := (c[1](r) if callable(c[1]) else r.get(c[1]))) is None else str(v) for c in columns) + " |")
    return "\n".join(out) + "\n"


ACC_COLS = [("model", "model"), ("users", "users"), ("HR@5", "hit_rate@5"), ("Recall@5", "recall@5"), ("NDCG@5", "ndcg@5"),
            ("HR@10", "hit_rate@10"), ("Recall@10", "recall@10"), ("NDCG@10", "ndcg@10"), ("MRR", "mrr")]
DIV_COLS = [("model", "model"), ("Coverage@10", "catalog_coverage@10"), ("Personalization@10", "personalization@10"),
            ("Novelty@10", "novelty@10"), ("Pop. bias (ARP)@10", "popularity_bias_arp@10"), ("Category diversity@10", "category_diversity@10")]


def ci_str(ci):
    return f"{ci['mean']:+.4f} [{ci['low']:+.4f}, {ci['high']:+.4f}]" if ci.get("mean") is not None else "n/a"


def render_markdown(rep):
    d = rep["dataset"]
    r = rep["results"]
    o = ["# Recommendation V2 Evaluation\n",
         "> Synthetic behavioural dataset (simulation, not real users). All numbers below are generated by "
         "`services/ai-service/eval/eval_recommendation_v2.py`; the conclusion is derived from them, not written by hand.\n"]
    o.append("## Dataset\n")
    o.append(md_table([
        {"k": "source", "v": f"`{d['source']}` (seed {d['seed']}, sha256 `{d['sha256'][:12]}…`)"},
        {"k": "users / books / interactions", "v": f"{d['users']} / {d['books']} / {d['interactions']}"},
        {"k": "interactions by kind", "v": ", ".join(f"{k} {v}" for k, v in d["interactions_by_kind"].items())},
        {"k": "malformed rows dropped", "v": d["malformed_dropped"]},
        {"k": "train range", "v": " → ".join(d["train_range"])},
        {"k": "validation range (tuning)", "v": " → ".join(d["validation_range"])},
        {"k": "test range (reported)", "v": " → ".join(d["test_range"])},
        {"k": "eligible users (≥ 3 train loans, ≥ 1 target)", "v": f"validation {d['validation_eligible_users']}, test {d['test_eligible_users']}"},
        {"k": "test users incl. cold-start segments", "v": d["test_users_all_segments"]},
        {"k": "protocol", "v": d["protocol"]},
    ], [("item", "k"), ("value", "v")]))
    o.append("Relevance = books first borrowed inside the window that were not borrowed, rated, wishlisted (as of the cutoff) or under an active reservation before it. "
             "Features for validation use history before the validation cutoff only; for test they are refit on history before the test cutoff with the weights chosen on validation.\n")

    o.append("## Model Configuration\n")
    cfg = rep["model_configuration"]["V2"]
    o.append(f"Selected by deterministic coordinate ascent on validation {cfg['objective']} ({cfg['evaluations']} evaluations, validation {cfg['objective']} = {cfg['validation_objective']}). "
             "Weights multiply features divided by their SD on the tuning matrix (`feature_scale`).\n")
    o.append(md_table([{"f": f, "w": cfg["weights"][f], "s": round(cfg["feature_scale"][f], 4)} for f in v2.FEATURES],
                      [("feature", "f"), ("weight", "w"), ("scale (SD)", "s")]))
    o.append("Hyperparameters: " + ", ".join(f"`{k}`={v}" for k, v in cfg["params"].items()) + f". Category cap selected: {rep['selected_max_per_category']} "
             f"(validation {rep['category_cap_validation']}).\n")

    o.append("## Baselines\n")
    o.append("- **RANDOM** – seeded shuffle of eligible books.\n- **POPULARITY** – train-window loan count.\n"
             "- **V1_PRODUCTION** – current `recommendation.py` (hardcoded weights; semantic=[] offline, as before).\n"
             "- **V2** – this work. **V2+CATEGORY_CAP3** – diversity constraint. **V2_NO_CANDIDATE_PRUNING** – ranks every eligible book.\n"
             "- **CONTENT_ONLY** (preference+author+semantic) and **CF_ONLY** (item-item collaborative) – single-family variants, tuned the same way.\n"
             "- **ORACLE_TRUE_PREFERENCE** – reads the simulator's latent truth (static category preference × popularity × favourite author); a reference ceiling, not deployable. "
             "It is not Bayes-optimal: it ignores habit momentum, wishlist boosts and stock, so an observable-data model can approach or exceed it on some metrics.\n")

    o.append("## Accuracy Metrics (test)\n")
    o.append(md_table([{"model": n, **m} for n, m in r.items()], ACC_COLS))
    o.append("Bootstrap 95% CI (per-user resampling, " + str(rep["bootstrap_95ci"]["V2"]["ndcg@10"]["n"]) + " users):\n")
    o.append(md_table([{"model": n, **{m: f"{b[m]['mean']} [{b[m]['low']}, {b[m]['high']}]" for m in b}} for n, b in rep["bootstrap_95ci"].items()],
                      [("model", "model"), ("HR@10", "hit_rate@10"), ("NDCG@10", "ndcg@10"), ("Recall@10", "recall@10"), ("MRR", "mrr")]))
    o.append("Per-user NDCG@10 distribution:\n")
    o.append(md_table([{"model": n, **q} for n, q in rep["per_user_ndcg@10_distribution"].items()],
                      [("model", "model"), ("min", "min"), ("Q1", "q1"), ("median", "median"), ("Q3", "q3"), ("max", "max"), ("share = 0", "share_zero")]))

    o.append("## Coverage / Diversity Metrics (test)\n")
    o.append(md_table([{"model": n, **m} for n, m in r.items()], DIV_COLS))

    o.append("## Cold-start Evaluation\n")
    cs = rep["cold_start"]
    for key, label in (("new_users_0_train_loans", "New users (0 train loans)"), ("sparse_users_1_2_train_loans", "Sparse users (1–2 train loans)"),
                       ("regular_users_3plus_train_loans", "Regular users (≥ 3 train loans)")):
        seg = cs[key]
        o.append(f"**{label}** – {seg['users']} users\n")
        o.append(md_table([{"model": n, **m} for n, m in seg["models"].items()],
                          [("model", "model"), ("HR@10", "hit_rate@10"), ("Recall@10", "recall@10"), ("NDCG@10", "ndcg@10"), ("MRR", "mrr")]))
    o.append("Empty recommendation lists: " + ", ".join(f"{k} {v}" for k, v in cs["empty_recommendation_lists"].items()) + ".\n")
    ic = cs["item_cold_start"]
    o.append(f"**New books** – {ic['masked_books']} books masked ({ic['rule']}). Recall@10 restricted to targets among them:\n")
    o.append(md_table([{"m": k, **v} for k, v in ic.items() if isinstance(v, dict)], [("model", "m"), ("users", "users"), ("Recall@10", "recall@10")]))

    o.append("## Ablation Study\n")
    o.append("Each row removes one signal group and re-tunes the remaining weights on validation (same grids), then scores test once.\n")
    o.append(md_table([{"model": n, **m} for n, m in rep["ablation"].items()], [("variant", "model"), ("HR@10", "hit_rate@10"), ("Recall@10", "recall@10"),
                                                                              ("NDCG@10", "ndcg@10"), ("MRR", "mrr"), ("Coverage@10", "catalog_coverage@10")]))
    o.append("Paired Δ (full − ablated), mean [95% CI]:\n")
    o.append(md_table([{"v": n, **{m: ci_str(d[m]) for m in d}} for n, d in rep["ablation_paired_delta_full_minus_ablated"].items()],
                      [("variant", "v"), ("HR@10", "hit_rate@10"), ("NDCG@10", "ndcg@10"), ("Recall@10", "recall@10"), ("MRR", "mrr")]))

    o.append("## Comparison V1 vs V2\n")
    rows = []
    for vs, c in rep["comparisons"].items():
        rows.append({"cmp": vs, **{m: ci_str(c[m]) for m in c}, "wlt": f"{c['ndcg@10']['wins']}/{c['ndcg@10']['losses']}/{c['ndcg@10']['ties']}"})
    o.append(md_table(rows, [("comparison", "cmp"), ("ΔHR@10", "hit_rate@10"), ("ΔNDCG@10", "ndcg@10"), ("ΔRecall@10", "recall@10"), ("ΔMRR", "mrr"),
                             ("NDCG@10 wins/losses/ties", "wlt")]))
    lp = rep["legacy_protocol"]
    o.append("Legacy protocol (identical to `evaluation.js`: end-of-window wishlist snapshot, no reservation exclusion, availability constant 1 for every model). "
             "Here books saved or reserved at the cutoff can be targets; **V2** still applies its production rule and never recommends them, "
             "**V2_LEGACY_EXCLUSIONS** excludes exactly what the legacy protocol excludes (same candidate set as the baselines):\n")
    o.append(md_table([{"model": n, **m} for n, m in lp["results"].items()], ACC_COLS + [("Coverage@10", "catalog_coverage@10")]))
    o.append("Reading this table: the legacy protocol rewards recommending a book the reader already saved (its own category/content then counts towards the match), "
             "which V2's production rule forbids. V2_LEGACY_EXCLUSIONS therefore measures that protocol difference, not a better model; the audited tables above are the result.\n")
    o.append("Parity with `simulation-report.json` (max |Δ| over HR@10/NDCG@10/MRR): " + (", ".join(
        f"{k} {v['max_abs_diff']}" for k, v in lp["parity_with_simulation_report"].items() if isinstance(v, dict)) or str(lp["parity_with_simulation_report"])) + ".\n")

    o.append("## Error Analysis\n")
    ea = rep["error_analysis"]
    o.append(f"- Per-user NDCG@10, V2 vs POPULARITY: {ea['v2_vs_popularity_ndcg@10_per_user']['wins']} wins / {ea['v2_vs_popularity_ndcg@10_per_user']['losses']} losses / {ea['v2_vs_popularity_ndcg@10_per_user']['ties']} ties.")
    o.append(f"- Per-user NDCG@10, V2 vs V1: {ea['v2_vs_v1_ndcg@10_per_user']['wins']} wins / {ea['v2_vs_v1_ndcg@10_per_user']['losses']} losses / {ea['v2_vs_v1_ndcg@10_per_user']['ties']} ties.")
    cp = ea["candidate_pool"]
    o.append(f"- Candidate pool: mean size {cp['mean_pool_size']} (per_source_k={cp['per_source_k']}); share of test targets inside the pool {cp['target_recall_of_pool']}.\n")
    o.append("NDCG@10 by user activity (test, ≥ 3 train loans):\n")
    act_rows = []
    for label, seg in ea["by_activity_tertile"].items():
        act_rows.append({"seg": f"{label} – {seg['users']} users", **{n: seg["models"][n].get("ndcg@10") for n in ("POPULARITY", "V1_PRODUCTION", "V2")}})
    o.append(md_table(act_rows, [("segment", "seg"), ("POPULARITY", "POPULARITY"), ("V1", "V1_PRODUCTION"), ("V2", "V2")]))
    ht = ea["head_vs_tail_targets"]
    o.append(f"Recall@10 on head vs tail targets ({ht['head_definition']}):\n")
    o.append(md_table([{"model": n, "head": v["head"]["recall@10"], "tail": v["tail"]["recall@10"]} for n, v in ht.items() if isinstance(v, dict)],
                      [("model", "model"), ("head", "head"), ("tail", "tail")]))

    o.append("## Limitations\n")
    o.append("- The data is synthetic: the simulator's choice model (category preference × Zipf popularity × author affinity) favours signals of that shape; results show what V2 recovers from observable rows, not real-user accuracy.\n"
             "- 113 books / 11 categories: the candidate pool covers most of the catalog, so candidate generation is exercised but rarely decisive; item-item CF is estimated on a small item set.\n"
             "- Semantic similarity is TF-IDF over title/author/category/description (same code offline and online); production V1's Qwen embeddings are not evaluated offline.\n"
             "- Availability is the point-in-time state at the cutoff, while targets span the whole test window.\n"
             "- Weights are tuned on one validation window of one seed; the bootstrap CI covers user sampling, not dataset/seed variance.\n"
             "- `feature_scale` is fixed from tuning; in production the popularity/recency count ranges drift as history grows.\n")

    o.append("## Conclusion\n")
    for line in rep["conclusion"]:
        o.append(f"- {line}")
    o.append("")
    o.append("## Reproduce\n")
    o.append("```bash\nnode services/borrow-service/prisma/simulation/seed-simulation.js --dry-run\npython services/ai-service/eval/eval_recommendation_v2.py --write-weights\n```\n")
    return "\n".join(o)


if __name__ == "__main__":
    raise SystemExit(main())
