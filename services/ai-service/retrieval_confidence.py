"""Retrieval confidence / abstention layer, sitting AFTER hybrid retrieval + RRF
(faq_retrieval.py, assistant_tools._score_and_rank_books) and BEFORE the answer
is shown to a user or handed to the LLM.

Why this exists: lowering FAQ_MATCH_THRESHOLD/BOOK_SEMANTIC_THRESHOLD from
0.75/0.6 to 0.3 (see faq_retrieval.py, book_index.py comments) raised Recall@5
a lot but also means the semantic arm almost always clears the gate - so a
question with genuinely no answer in the corpus still comes back with "the
nearest thing we have" instead of nothing (eval/reports/rag_20260925_041036.md:
no-answer correctly-empty 0/10). A single "top1 cosine > threshold" cannot fix
this without re-raising the threshold and losing the recall gain back.

Design: combine the semantic score with a SECOND, independent signal (does the
fused top-1 document also rank well on the keyword/full-text arm?) plus a
handful of deterministic hard-match rules (ISBN, exact title) that are strong
enough to skip scoring entirely. This mirrors how the pipeline already treats
semantic + keyword as two independent arms merged by RRF - the confidence
layer just asks "how much do the two arms agree", instead of trusting either
one alone.

Pure module - no I/O, no import of main.py/embeddings.py. Deliberately does
NOT gate on RRF's own fused score: RRF scores (sum of 1/(k+rank)) are only
comparable to each other's rank, never across queries, so they cannot be
threshold-calibrated the way a cosine or a rank position can (see fusion.py's
own docstring on why it avoids score blending).
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

from metrics import ai_retrieval_decisions_total
from vector_store import Hit

logger = logging.getLogger("uvicorn.error")

CONFIDENT_MATCH = "CONFIDENT_MATCH"
UNCERTAIN = "UNCERTAIN"
NO_EVIDENCE = "NO_EVIDENCE"


@dataclass(frozen=True)
class ConfidenceConfig:
    """cos_floor/cos_ceil map the corpus's own cosine distribution to 0..1
    (see faq_retrieval.py / book_index.py comments for the measured ranges
    this is seeded from); tau_confident/tau_evidence are cut points on the
    resulting 0..1 confidence score. w_semantic/w_keyword/w_agree must sum to
    1.0 - semantic is the primary signal (it is what BOOK_SEMANTIC_THRESHOLD/
    FAQ_MATCH_THRESHOLD already gate on), keyword-rank agreement is
    corroboration, matching RRF's own two-arms-independent design.
    """
    cos_floor: float
    cos_ceil: float
    tau_confident: float
    tau_evidence: float
    w_semantic: float = 0.5
    w_keyword: float = 0.4
    w_agree: float = 0.1


def _config_from_env(prefix: str, defaults: ConfidenceConfig) -> ConfidenceConfig:
    def _f(name: str, default: float) -> float:
        return float(os.getenv(f"{prefix}_{name}", str(default)))

    return ConfidenceConfig(
        cos_floor=_f("COS_FLOOR", defaults.cos_floor),
        cos_ceil=_f("COS_CEIL", defaults.cos_ceil),
        tau_confident=_f("TAU_CONFIDENT", defaults.tau_confident),
        tau_evidence=_f("TAU_EVIDENCE", defaults.tau_evidence),
        w_semantic=_f("W_SEMANTIC", defaults.w_semantic),
        w_keyword=_f("W_KEYWORD", defaults.w_keyword),
        w_agree=_f("W_AGREE", defaults.w_agree),
    )


# Calibrated against a live run of eval/eval_rag.py on 2026-09-25 (130-case
# rag_dataset.json, real Postgres + OpenRouter - see
# eval/reports/rag_20260925_082047.md and the per-threshold trade-off table in
# docs/SERVICES/AI_SERVICE.md's calibration section).
#
# INTERNAL_DOC: tau_evidence=0.35 gives No-answer Accuracy 1.0 AND zero recall
# cost (Answerable Recall@5 stays 1.0 across the whole 0.15-0.40 range tested)
# - no trade-off to make here.
#
# BOOK_METADATA has a real trade-off (author-only queries like "Tác phẩm nào
# của Xuân Diệu?" carry a weak semantic signal that's hard to tell apart from
# a genuine no-answer case): 0.35 reaches 100% No-answer Accuracy but costs
# 0.132 off Answerable Recall@5 (0.884 baseline -> 0.753); 0.25 keeps the cost
# to 0.054 (0.884 -> 0.830) while still reaching 75% No-answer Accuracy (15/20)
# - chosen per Chức năng 1.8's guardrail ("không được làm Recall@5 tụt mạnh
# chỉ để tăng no-answer"). Re-run eval/calibrate_rag.py if the corpus or
# embedding model changes enough to shift this trade-off.
_BOOK_DEFAULTS = ConfidenceConfig(cos_floor=0.30, cos_ceil=0.60, tau_confident=0.66, tau_evidence=0.25)
_DOC_DEFAULTS = ConfidenceConfig(cos_floor=0.30, cos_ceil=0.55, tau_confident=0.66, tau_evidence=0.35)

BOOK_CONFIDENCE = _config_from_env("BOOK_CONF", _BOOK_DEFAULTS)
DOC_CONFIDENCE = _config_from_env("DOC_CONF", _DOC_DEFAULTS)


@dataclass(frozen=True)
class RetrievalSignals:
    """Everything the confidence decision is computed from, kept around on the
    result for logging/eval - never recomputed from raw text, only from the
    hit lists retrieval already produced."""
    corpus: str
    result_count: int
    semantic_available: bool
    semantic_top1: float
    semantic_rank: int | None
    keyword_rank: int | None
    top1_agree: bool
    hard_match: str | None = None


@dataclass(frozen=True)
class RetrievalConfidence:
    decision: str
    confidence: float
    reason_codes: list[str]
    signals: RetrievalSignals

    def to_dict(self) -> dict:
        return {"decision": self.decision, "confidence": self.confidence, "reasonCodes": list(self.reason_codes)}


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _rank_of(hits: list[Hit], source_id: str | None) -> int | None:
    if source_id is None:
        return None
    for rank, hit in enumerate(hits, start=1):
        if hit.source_id == source_id:
            return rank
    return None


def _keyword_signal(rank: int | None) -> float:
    """Rank-based, not score-based: ts_rank (Postgres) has no upper bound while
    the in-memory keyword scorer is 0..1 (vector_store.py) - a rank position is
    the one thing both backends agree on the meaning of."""
    if rank is None:
        return 0.0
    if rank == 1:
        return 1.0
    if rank <= 3:
        return 0.6
    return 0.3


def extract_signals(
    corpus: str,
    semantic_hits: list[Hit],
    keyword_hits: list[Hit],
    fused_hits: list[Hit],
    semantic_available: bool,
    hard_match: str | None = None,
) -> RetrievalSignals:
    """`semantic_hits`/`keyword_hits` are the two arms BEFORE fusion (already
    filtered by the corpus's own semantic threshold), `fused_hits` is the RRF
    output. `hard_match` short-circuits everything else (e.g. an ISBN or exact
    title match found outside the vector store) - the caller passes it in
    rather than this module re-deriving it, since what counts as an "exact"
    match is corpus-specific (main.py/assistant_tools.py already have it)."""
    if hard_match is not None:
        return RetrievalSignals(corpus, max(len(fused_hits), 1), semantic_available, 0.0, None, None, False, hard_match)
    if not fused_hits:
        return RetrievalSignals(corpus, 0, semantic_available, 0.0, None, None, False, None)

    top_id = fused_hits[0].source_id
    semantic_rank = _rank_of(semantic_hits, top_id)
    keyword_rank = _rank_of(keyword_hits, top_id)
    semantic_top1 = next((hit.score for hit in semantic_hits if hit.source_id == top_id), 0.0)
    return RetrievalSignals(
        corpus=corpus, result_count=len(fused_hits), semantic_available=semantic_available,
        semantic_top1=semantic_top1, semantic_rank=semantic_rank, keyword_rank=keyword_rank,
        top1_agree=(semantic_rank == 1 and keyword_rank == 1),
    )


def evaluate(signals: RetrievalSignals, cfg: ConfidenceConfig) -> RetrievalConfidence:
    """Three-way decision. CONFIDENT_MATCH/UNCERTAIN/NO_EVIDENCE instead of a
    binary match/no-match: a caller that only wants a hard yes/no can still
    treat UNCERTAIN as "yes, with a caveat" or "no" depending on how much risk
    it can tolerate - collapsing that choice into one threshold would hide it."""
    if signals.hard_match:
        return RetrievalConfidence(CONFIDENT_MATCH, 1.0, [signals.hard_match], signals)
    if signals.result_count == 0:
        return RetrievalConfidence(NO_EVIDENCE, 0.0, ["EMPTY_RESULT"], signals)

    sem_norm = 0.0
    if signals.semantic_available and signals.semantic_rank is not None:
        span = cfg.cos_ceil - cfg.cos_floor
        sem_norm = _clamp01((signals.semantic_top1 - cfg.cos_floor) / span) if span > 0 else 0.0
    kw_norm = _keyword_signal(signals.keyword_rank)
    agree_bonus = cfg.w_agree if signals.top1_agree else 0.0
    confidence = _clamp01(cfg.w_semantic * sem_norm + cfg.w_keyword * kw_norm + agree_bonus)

    reasons: list[str] = []
    if not signals.semantic_available:
        reasons += ["EMBEDDING_UNAVAILABLE", "KEYWORD_ONLY_FALLBACK"]
    elif signals.semantic_rank is None:
        reasons.append("SEMANTIC_BELOW_THRESHOLD")
    else:
        reasons.append("SEMANTIC_STRONG" if sem_norm >= 0.66 else "SEMANTIC_WEAK")
    reasons.append("KEYWORD_AGREEMENT" if kw_norm > 0 else "NO_KEYWORD_SUPPORT")
    if signals.top1_agree:
        reasons.append("SIGNALS_AGREE")

    if confidence >= cfg.tau_confident:
        decision = CONFIDENT_MATCH
    elif confidence >= cfg.tau_evidence:
        decision = UNCERTAIN
    else:
        decision = NO_EVIDENCE
        reasons.append("LOW_OVERALL_CONFIDENCE")
    return RetrievalConfidence(decision, round(confidence, 3), reasons, signals)


def log_decision(result: RetrievalConfidence) -> None:
    """One structured log line + a Prometheus counter increment per retrieval
    decision (called by faq_retrieval.py/assistant_tools.py right after
    evaluate()). Deliberately omits question/document text - only the
    numeric/categorical signals a dashboard or a `jq`-based log search needs,
    never anything that could leak corpus content."""
    ai_retrieval_decisions_total.labels(result.signals.corpus, result.decision).inc()
    logger.info("retrieval_decision %s", json.dumps({
        "corpus": result.signals.corpus, "decision": result.decision, "confidence": result.confidence,
        "semantic_top1": round(result.signals.semantic_top1, 3), "semantic_rank": result.signals.semantic_rank,
        "keyword_rank": result.signals.keyword_rank, "top1_agree": result.signals.top1_agree,
        "abstained": result.decision == NO_EVIDENCE, "reason_codes": result.reason_codes,
    }))
