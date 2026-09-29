"""Rank books with the production recommender over the SYNTHETIC behavioural dataset.

Input: the JSON written by services/borrow-service/prisma/simulation (seed-simulation.js
--dry-run or a DB run): a catalog in inventory-service's shape plus, for every eligible
customer, only the interactions that happened BEFORE the temporal hold-out cutoff.
Output: {customer_id: [book_id, ...]} ranked by recommendation.py - the same
collect_signals -> build_taste_profile -> select_candidates -> rank_candidates path
main.py uses. The simulation then scores these rankings against books borrowed after
the cutoff (HitRate/Recall/NDCG@K, MRR, coverage, personalization).

Offline and deterministic: no DB, no LLM, no embeddings (semantic=[] - the other
three score components still rank, exactly as production does when embeddings are
unavailable). The input is synthetic data, never real users.

    python eval/eval_recommendation_synthetic.py <input.json> <output.json>
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import recommendation  # noqa: E402


def rank_user(user: dict, catalog: list[dict], rating_stats: dict) -> list[str]:
    loan_books = recommendation.books_from_loans(user.get("loans") or [], catalog)
    wishlist_books = recommendation.books_from_ids(user.get("wishlist_book_ids") or [], catalog)
    rated_books = [
        (book, review.get("rating"))
        for review in user.get("reviews") or []
        for book in recommendation.books_from_ids([review.get("book_id")], catalog)
    ]
    signals = recommendation.collect_signals(loan_books, wishlist_books, rated_books)
    profile = recommendation.build_taste_profile(signals)
    candidates = recommendation.select_candidates(catalog, profile)
    ranked = recommendation.rank_candidates(candidates, profile, rating_stats, semantic=[], limit=len(candidates))
    return [entry["book_id"] for entry in ranked]


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)
    if not data.get("synthetic"):
        print("refusing: input is not marked synthetic", file=sys.stderr)
        return 1
    catalog = data["catalog"]
    rating_stats = data.get("rating_stats") or {}
    rankings = {user["customer_id"]: rank_user(user, catalog, rating_stats) for user in data["users"]}
    with open(sys.argv[2], "w", encoding="utf-8") as handle:
        json.dump(rankings, handle)
    print(f"ranked {len(rankings)} synthetic users over {len(catalog)} books -> {sys.argv[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
