"""POST /recommendations with the V1/V2 flag. No network: the gateway reads,
the borrow-service feed and the LLM are mocked at main's helpers."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import main
import recommendation_v2

CATALOG = [
    {"id": f"b{i}", "title": f"Sach {i}", "author": "Tac gia A" if i < 3 else f"Tac gia {i}",
     "category": "Cong nghe" if i % 2 else "Lich su", "available_quantity": 0 if i == 5 else 2,
     "variant_ids": [f"v{i}"], "description": "", "is_active": i != 6}
    for i in range(1, 8)
]
MY = {
    "/borrow/my/loans": [{"borrow_date": "2026-09-01T00:00:00Z", "loan_items": [{"variant_id": "v1"}]}],
    "/borrow/my/wishlists": [],
    "/borrow/my/reviews": [{"book_id": "b1", "rating": 5, "created_at": "2026-09-10T00:00:00Z", "status": "VISIBLE"}],
    "/borrow/my/reservations": [{"variant_id": "v3", "status": "PENDING", "reserved_at": "2026-09-20T00:00:00Z"}],
    "/api/books": CATALOG,
}
FEED = {"events": [
    {"kind": "LOAN", "u": u, "variant_id": v, "at": "2026-08-01T00:00:00Z"}
    for u in range(4) for v in ("v1", "v2", "v4")
]}


async def fake_fetch(client, endpoint, auth_header, params=None):
    if endpoint in MY:
        return {"data": MY[endpoint]} if endpoint != "/api/books" else MY[endpoint], 200
    return None, 404


def run(model_name, config, **extra):
    request = type("R", (), {"headers": {"authorization": "Bearer t"}})()
    patches = [
        patch.object(main, "RECOMMENDATION_MODEL", model_name),
        patch.object(main, "_rec_v2_config", config),
        patch.object(main, "_rec_fetch", side_effect=fake_fetch),
        patch.object(main, "_rec_fetch_global_interactions", AsyncMock(return_value=FEED)),
        patch.object(main, "_call_text_llm_json", AsyncMock(return_value=(None, False))),
        patch.object(main.book_index, "semantic_scores", AsyncMock(return_value=[])),
    ]
    for key, value in extra.items():
        patches.append(patch.object(main, key, value))
    for p in patches:
        p.start()
    main._rec_v2_cache.clear()
    try:
        return asyncio.run(main.get_recommendations(request, main.RecommendationRequest(limit=4)))
    finally:
        for p in reversed(patches):
            p.stop()


CONFIG = {
    "weights": dict(recommendation_v2.DEFAULT_WEIGHTS),
    "feature_scale": {k: 1.0 for k in recommendation_v2.FEATURES},
    "params": dict(recommendation_v2.DEFAULT_PARAMS),
    "max_per_category": None,
}


class RecommendationsEndpointTests(unittest.TestCase):
    def test_v2_ranks_in_code_excludes_seen_reserved_inactive_and_explains_with_rules(self):
        out = run("v2", CONFIG)
        self.assertEqual(out["model"], "v2")
        ids = [e["book_id"] for e in out["recommendations"]]
        self.assertTrue(ids)
        self.assertNotIn("b1", ids)   # borrowed + rated
        self.assertNotIn("b3", ids)   # active reservation
        self.assertNotIn("b6", ids)   # inactive
        self.assertTrue(set(ids) <= {b["id"] for b in CATALOG})
        self.assertTrue(out["personalized"])
        self.assertEqual(out["basis"]["global_interactions"], 12)
        self.assertEqual(out["ai_provider"], "rules")  # LLM unavailable -> rule-based reasons
        for e in out["recommendations"]:
            self.assertTrue(e["reason"])
            self.assertIn(e["tier"], ("STRONG", "GOOD", "EXPLORE"))
            self.assertNotRegex(e["reason"], r"\d+\s*%")

    def test_llm_reasons_are_accepted_only_for_chosen_books_and_never_reorder(self):
        base = run("v2", CONFIG)
        chosen = base["recommendations"][0]["book_id"]
        llm = AsyncMock(return_value=({chosen: "Ly do tu mo hinh.", "b999": "sach bia"}, True))
        provider = type("P", (), {"name": "openrouter"})()
        out = run("v2", CONFIG, _call_text_llm_json=llm, _get_text_llm_provider=lambda: provider)
        self.assertEqual([e["book_id"] for e in out["recommendations"]], [e["book_id"] for e in base["recommendations"]])
        self.assertEqual(out["recommendations"][0]["reason"], "Ly do tu mo hinh.")
        self.assertNotIn("b999", [e["book_id"] for e in out["recommendations"]])

    def test_flag_v1_uses_the_previous_ranker(self):
        out = run("v1", CONFIG)
        self.assertEqual(out["model"], "v1")
        self.assertNotIn("tier", out["recommendations"][0])

    def test_v2_without_weights_file_rolls_back_to_v1(self):
        self.assertEqual(run("v2", None)["model"], "v1")

    def test_v2_failure_rolls_back_to_v1(self):
        broken = AsyncMock(side_effect=RuntimeError("boom"))
        with self.assertLogs(main.logger, level="ERROR"):
            out = run("v2", CONFIG, _get_recommendations_v2=broken)
        self.assertEqual(out["model"], "v1")

    def test_feed_outage_still_returns_recommendations(self):
        out = run("v2", CONFIG, _rec_fetch_global_interactions=AsyncMock(return_value=None))
        self.assertEqual(out["model"], "v2")
        self.assertTrue(out["recommendations"])
        self.assertEqual(out["basis"]["global_interactions"], 0)


if __name__ == "__main__":
    unittest.main()
