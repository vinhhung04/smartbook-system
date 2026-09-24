import unittest
from metadata_scoring import aggregate, score_run


class MetadataScoringTests(unittest.TestCase):
    def entry(self):
        return {'editionId': 'e', 'workGroup': 'w', 'editionGold': {'fields': {
            'title': {'status': 'known', 'value': 'Book'},
            'authors': {'status': 'known', 'value': ['A']},
            'translator': {'status': 'unknown'},
        }}}

    def test_extra_author_is_false_positive(self):
        result = score_run(self.entry(), {'metadata': {'title': 'Book', 'authors': ['A', 'B']}})
        self.assertEqual((result['tp'], result['fp'], result['fn']), (2, 1, 0))

    def test_unknown_field_is_not_counted_as_correct(self):
        result = score_run(self.entry(), {'metadata': {'title': 'Book', 'authors': ['A'], 'translator': ['X']}})
        self.assertEqual(result['eligible'], 2)

    def test_unsupported_output_counts_as_hallucination(self):
        result = score_run(self.entry(), {'metadata': {'title': 'Book', 'authors': ['A']}, 'decisions': {
            'title': {'selectedCandidateIds': ['c']}, 'authors': {'selectedCandidateIds': []}},
            'candidates': [{'id': 'c', 'evidenceIds': []}], 'evidence': []})
        report = aggregate([result])
        self.assertEqual(report['evidenceSupportedExtractionRate'], 0)
        self.assertEqual(report['hallucinationRate'], 1)

    def test_review_rate_reflects_pipeline_flag_even_without_gold(self):
        entry = {'editionId': 'e', 'workGroup': 'w', 'editionGold': {'fields': {}}}
        flagged = score_run(entry, {'metadata': {}, 'decisions': {'title': {'status': 'REVIEW_REQUIRED'}}})
        clean = score_run(entry, {'metadata': {}, 'decisions': {'title': {'status': 'PROPOSED'}}})
        self.assertEqual(aggregate([flagged])['reviewRate'], 1.0)
        self.assertEqual(aggregate([clean])['reviewRate'], 0.0)


if __name__ == '__main__': unittest.main()
