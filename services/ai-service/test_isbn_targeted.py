import unittest

from isbn_targeted import MAX_ROUNDS, ProviderLedger, plan_targeted_retrieval

ALL = {"tiki", "vinabook", "fahasa", "webSearch"}


def gap(field, status="MISSING", tier="high"):
    return {"field": field, "status": status, "reason": None, "tier": tier, "weight": 1.0}


def providers(plan):
    return [item["provider"] for item in plan]


class PlannerTests(unittest.TestCase):
    def test_round0_batches_cheap_providers_once_each_and_skips_expensive(self):
        gaps = [gap("description"), gap("pageCount"), gap("publisher")]
        plan = plan_targeted_retrieval(gaps, ProviderLedger(), ALL, 0, 40)

        self.assertEqual(providers(plan), ["tiki", "vinabook"])
        tiki = plan[0]
        self.assertEqual(sorted(tiki["reasons"]), ["MISSING:description", "MISSING:publisher"])  # tiki has no pageCount
        vina = plan[1]
        self.assertEqual(sorted(vina["reasons"]), ["MISSING:description", "MISSING:pageCount", "MISSING:publisher"])

    def test_round1_picks_fahasa_only_if_cheap_providers_already_called(self):
        ledger = ProviderLedger()
        ledger.record("tiki", "SUCCESS", "TARGETED", [], 900)
        ledger.record("vinabook", "NOT_FOUND", "TARGETED", [], 900)
        plan = plan_targeted_retrieval([gap("pageCount")], ledger, ALL, 1, 40)
        self.assertEqual(providers(plan), ["fahasa"])

    def test_web_search_last_round_only_for_fields_it_can_parse(self):
        ledger = ProviderLedger()
        self.assertEqual(providers(plan_targeted_retrieval([gap("publisher")], ledger, ALL, 2, 40)), ["webSearch"])
        self.assertEqual(plan_targeted_retrieval([gap("description")], ledger, ALL, 2, 40), [])
        self.assertEqual(plan_targeted_retrieval([gap("pageCount")], ledger, ALL, 2, 40), [])

    def test_called_providers_are_never_planned_again(self):
        ledger = ProviderLedger()
        ledger.record("tiki", "TIMEOUT", "TARGETED", [], 3000)
        plan = plan_targeted_retrieval([gap("publisher")], ledger, ALL, 0, 40)
        self.assertEqual(providers(plan), ["vinabook"])

    def test_disabled_providers_are_excluded(self):
        plan = plan_targeted_retrieval([gap("publisher")], ProviderLedger(), {"tiki"}, 0, 40)
        self.assertEqual(providers(plan), ["tiki"])
        self.assertEqual(plan_targeted_retrieval([gap("publisher")], ProviderLedger(), set(), 0, 40), [])

    def test_low_remaining_budget_skips_expensive_provider(self):
        self.assertEqual(plan_targeted_retrieval([gap("pageCount")], ProviderLedger(), ALL, 1, 4), [])
        self.assertEqual(providers(plan_targeted_retrieval([gap("pageCount")], ProviderLedger(), ALL, 1, 25)), ["fahasa"])

    def test_no_gaps_means_no_calls(self):
        self.assertEqual(plan_targeted_retrieval([], ProviderLedger(), ALL, 0, 40), [])

    def test_reason_includes_gap_status(self):
        plan = plan_targeted_retrieval([gap("publisher", "CONFLICTED")], ProviderLedger(), ALL, 0, 40)
        self.assertIn("CONFLICTED:publisher", plan[0]["reasons"])

    def test_round_index_out_of_range_returns_empty(self):
        self.assertEqual(plan_targeted_retrieval([gap("publisher")], ProviderLedger(), ALL, MAX_ROUNDS, 40), [])


class LedgerTests(unittest.TestCase):
    def test_records_and_counts_calls(self):
        ledger = ProviderLedger()
        ledger.record("googleBooks", "SUCCESS", "INITIAL", [], 800)
        ledger.record("tiki", "SUCCESS", "TARGETED", ["MISSING:publisher"], 1200)
        self.assertTrue(ledger.called("tiki"))
        self.assertFalse(ledger.called("fahasa"))
        self.assertEqual(ledger.provider_call_count, 2)
        self.assertEqual(ledger.get("tiki")["reasons"], ["MISSING:publisher"])
        self.assertEqual(ledger.get("tiki")["durationMs"], 1200)
        self.assertIsNone(ledger.get("fahasa"))


if __name__ == "__main__":
    unittest.main()
