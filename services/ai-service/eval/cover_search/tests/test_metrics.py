import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import retrieval_metrics as metrics  # noqa: E402
import statistical_analysis as sa  # noqa: E402


class RetrievalMetricTests(unittest.TestCase):
    def test_rank_of(self):
        self.assertEqual(metrics.rank_of(["a", "b", "c"], "b"), 2)
        self.assertIsNone(metrics.rank_of(["a"], "z"))
        self.assertIsNone(metrics.rank_of([], "z"))

    def test_recall_and_mrr(self):
        ranks = [1, 2, None, 5, 6]
        self.assertAlmostEqual(metrics.recall_at_k(ranks, 1), 0.2)
        self.assertAlmostEqual(metrics.recall_at_k(ranks, 5), 0.6)
        self.assertAlmostEqual(metrics.mean_reciprocal_rank(ranks), (1 + 0.5 + 0 + 0.2 + 1 / 6) / 5)
        self.assertTrue(math.isnan(metrics.recall_at_k([], 1)))

    def test_abstention_metrics(self):
        # in-catalog: 3 answered, 1 abstained (FP); OOC: 2 abstained (TP), 1 answered (FN)
        result = metrics.abstention_metrics([True, True, True, False], [False, False, True])
        self.assertEqual((result["tp"], result["fp"], result["fn"]), (2, 1, 1))
        self.assertAlmostEqual(result["no_match_precision"], 2 / 3)
        self.assertAlmostEqual(result["no_match_recall"], 2 / 3)
        self.assertAlmostEqual(result["false_positive_rate"], 1 / 3)
        self.assertAlmostEqual(result["false_abstention_rate"], 1 / 4)

    def test_percentile_matches_linear_interpolation(self):
        self.assertAlmostEqual(metrics.percentile([1, 2, 3, 4], 50), 2.5)
        self.assertAlmostEqual(metrics.percentile([10], 95), 10)
        self.assertAlmostEqual(metrics.percentile([0, 100], 95), 95)


class TextMatchTests(unittest.TestCase):
    def test_vietnamese_normalization_keeps_raw_distinct(self):
        self.assertEqual(metrics.normalize_title("Số Đỏ"), "so do")
        scores = metrics.title_scores("Số đỏ", "SO DO")
        self.assertFalse(scores["exact_raw"])
        self.assertTrue(scores["exact_normalized"])

    def test_leading_article_and_punctuation(self):
        self.assertTrue(metrics.title_scores("The Jungle Book", "Jungle Book.")["exact_normalized"])

    def test_missing_prediction_is_wrong(self):
        self.assertFalse(metrics.title_scores("Dracula", None)["fuzzy"])

    def test_author_any_of_several(self):
        self.assertTrue(metrics.author_scores("Mark Twain; Charles Dudley Warner", "MARK TWAIN")["exact_normalized"])
        self.assertTrue(metrics.author_scores("L. Frank Baum", "By L. Frank Baum")["fuzzy"])
        self.assertIsNone(metrics.author_scores("", "x")["fuzzy"])


class StatisticsTests(unittest.TestCase):
    def test_cluster_bootstrap_degenerate(self):
        result = sa.cluster_bootstrap_ci([1, 1, 1, 1], ["a", "a", "b", "c"], resamples=200)
        self.assertEqual((result["ci_low"], result["ci_high"], result["clusters"]), (1, 1, 3))

    def test_cluster_bootstrap_is_seeded(self):
        values, clusters = [1, 0, 1, 0, 1, 1], ["a", "a", "b", "c", "d", "d"]
        self.assertEqual(sa.cluster_bootstrap_ci(values, clusters, resamples=500),
                         sa.cluster_bootstrap_ci(values, clusters, resamples=500))

    def test_mcnemar_exact(self):
        a = [True] * 10 + [False] * 0
        b = [False] * 10
        result = sa.mcnemar_exact(a, b)
        self.assertEqual((result["b10"], result["b01"]), (10, 0))
        self.assertAlmostEqual(result["p_value"], 2 * (0.5 ** 10))
        self.assertEqual(sa.mcnemar_exact([True], [True])["p_value"], 1.0)

    def test_cohens_h_sign(self):
        self.assertGreater(sa.cohens_h(0.2, 0.8), 0)
        self.assertAlmostEqual(sa.cohens_h(0.5, 0.5), 0.0)


if __name__ == "__main__":
    unittest.main()
