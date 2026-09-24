import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from metadata_intelligence.sources import document
from metadata_intelligence.structured import extract_rules
from metadata_intelligence.evidence_validation import extract_llm_candidates
from metadata_intelligence.verification import verify_candidates, canonical_isbn
from metadata_intelligence.field_fusion import fuse


class MetadataIntelligenceTests(unittest.TestCase):
    def test_isbn_equivalence_and_checksum(self):
        self.assertEqual(canonical_isbn('0-439-70818-4'), '9780439708180')
        self.assertIsNone(canonical_isbn('9780439708181'))

    def test_api_pointer_and_wrong_edition(self):
        doc = document('googleBooks', 'json', {'volumeInfo': {
            'title': 'A book', 'industryIdentifiers': [{'identifier': '9780439708180'}]}})
        candidates, evidence = extract_rules(doc)
        verify_candidates(candidates, '9780061120084')
        self.assertTrue(all(not c['eligibleForFusion'] for c in candidates))
        self.assertEqual(evidence[0]['jsonPointer'], '/volumeInfo/title')

    def test_reject_invented_value_even_when_quote_exists(self):
        doc = document('pasted', 'text', 'Tác giả: Nguyễn Nhật Ánh')
        candidates, evidence = extract_llm_candidates(doc, {'fields': {
            'authors': {'value': ['Harper Lee'], 'evidence': [
                {'blockId': 'b0', 'quote': 'Tác giả: Nguyễn Nhật Ánh', 'itemIndex': 0}]}}})
        self.assertFalse(candidates[0]['eligibleForFusion'])
        self.assertFalse(evidence[0]['supportValidation']['supportsValue'])

    def test_translator_is_not_author(self):
        doc = document('pasted', 'text', 'Dịch giả: Nguyễn Văn A')
        candidates, _ = extract_llm_candidates(doc, {'fields': {
            'authors': {'value': ['Nguyễn Văn A'], 'evidence': [
                {'blockId': 'b0', 'quote': 'Dịch giả: Nguyễn Văn A', 'itemIndex': 0}]}}})
        self.assertFalse(candidates[0]['eligibleForFusion'])

    def test_rule_extracts_translator_and_keeps_partial_date(self):
        doc = document('pasted', 'text', 'ISBN: 9780439708180\nDịch giả: Nguyễn Văn A\nNăm xuất bản: 2020')
        candidates, _ = extract_rules(doc)
        values = {c['field']: c['normalizedValue'] for c in candidates}
        self.assertEqual(values['translator'], ['Nguyễn Văn A'])
        self.assertEqual(values['publishedDate'], '2020')

    def test_two_extractors_are_not_two_sources(self):
        doc = document('googleBooks', 'json', {'volumeInfo': {
            'title': 'A book', 'industryIdentifiers': [{'identifier': '9780439708180'}]}})
        candidates, _ = extract_rules(doc)
        verify_candidates(candidates, '9780439708180')
        copy = {**candidates[0], 'id': 'other-extractor', 'origin': 'LLM_EXTRACTED'}
        result = fuse(candidates + [copy], [doc])
        self.assertEqual(result['title']['agreementGroups'], 1)
        self.assertEqual(result['title']['confidenceComponents']['corroboration'], .85)

    def test_recommendation_isbn_does_not_verify_product(self):
        doc = document('pasted', 'html', '<main><h1>Book A</h1><p>Tác giả: A</p></main>'
                       '<aside>ISBN: 9780439708180</aside>')
        candidates, _ = extract_rules(doc)
        verify_candidates(candidates, '9780439708180')
        self.assertTrue(all(c['editionStatus'] != 'verified' for c in candidates))

    def test_description_survives_wrong_edition_but_title_does_not(self):
        doc = document('googleBooks', 'json', {'volumeInfo': {
            'title': 'A book', 'description': 'A great read',
            'industryIdentifiers': [{'identifier': '9780439708180'}]}})
        candidates, _ = extract_rules(doc)
        verify_candidates(candidates, '9780061120084')
        by_field = {c['field']: c for c in candidates}
        self.assertEqual(by_field['title']['editionStatus'], 'rejected')
        self.assertFalse(by_field['title']['eligibleForFusion'])
        self.assertEqual(by_field['description']['editionStatus'], 'rejected')
        self.assertTrue(by_field['description']['eligibleForFusion'])

    def test_fusion_fallback_prefers_reliable_source_over_extraction_order(self):
        # openLibrary candidate is extracted (and inserted) first, but googleBooks
        # has the higher publisher reliability prior and should still win.
        doc_ol = document('openLibrary', 'json', {'publishers': ['OpenLib Publisher']})
        doc_gb = document('googleBooks', 'json', {'volumeInfo': {'publisher': 'GB Publisher'}})
        candidates = extract_rules(doc_ol)[0] + extract_rules(doc_gb)[0]
        verify_candidates(candidates, None)
        result = fuse(candidates, [doc_ol, doc_gb])
        self.assertEqual(result['publisher']['proposedValue'], 'GB Publisher')


if __name__ == '__main__':
    unittest.main()


class PipelineTests(unittest.IsolatedAsyncioTestCase):
    async def test_structured_does_not_call_llm(self):
        from metadata_intelligence.pipeline import run_pipeline
        provider = SimpleNamespace(model='test', chat=AsyncMock())
        doc = document('googleBooks', 'json', {'volumeInfo': {'title': 'Book',
            'industryIdentifiers': [{'identifier': '9780439708180'}]}})
        result = await run_pipeline([doc], '9780439708180', provider)
        self.assertEqual(result['metadata']['title'], 'Book')
        self.assertEqual(result['usage'], [])
        provider.chat.assert_not_awaited()

    async def test_complete_labelled_text_does_not_call_llm_in_hybrid(self):
        from metadata_intelligence.pipeline import run_pipeline
        provider = SimpleNamespace(model='test', chat=AsyncMock())
        text = ('Tên sách: Book\nTác giả: A\nNhà xuất bản: NXB\nNăm xuất bản: 2020\n'
                'ISBN: 9780439708180\nSố trang: 100\nMô tả: A description')
        result = await run_pipeline([document('pasted', 'text', text)], '9780439708180', provider, mode='B4')
        self.assertEqual(result['metadata']['pageCount'], 100)
        provider.chat.assert_not_awaited()

    async def test_llm_extracts_with_span_and_usage(self):
        from metadata_intelligence.pipeline import run_pipeline
        from llm_provider import ChatUsage
        provider = SimpleNamespace(model='test', chat=AsyncMock(return_value=SimpleNamespace(
            text='{"fields":{"title":{"value":"Book A","evidence":[{"blockId":"b0","quote":"Book A"}]}}}',
            usage=ChatUsage('fake', 'test', 1, 20, 10, 0))))
        result = await run_pipeline([document('pasted', 'text', 'Book A\nISBN: 9780439708180')], None, provider)
        self.assertEqual(result['metadata']['title'], 'Book A')
        self.assertEqual(result['usage'][0]['model'], 'test')
        self.assertTrue(all(e['locatorValid'] for e in result['evidence']))

    async def test_model_failure_keeps_rule_fields(self):
        from metadata_intelligence.pipeline import run_pipeline
        provider = SimpleNamespace(model='test', chat=AsyncMock(side_effect=RuntimeError('offline')))
        result = await run_pipeline([document('pasted', 'text', 'Tên sách: Book A')], provider=provider)
        self.assertEqual(result['metadata']['title'], 'Book A')
        self.assertTrue(result['warnings'])

    async def test_fusion_consensus_can_override_highest_single_prior(self):
        from metadata_intelligence.pipeline import run_pipeline
        docs = [document(p, 'json', {'title': title, 'isbn': '9780439708180'})
                for p, title in [('googleBooks', 'Wrong'), ('fahasa', 'Right'), ('tiki-other', 'Right')]]
        result = await run_pipeline(docs, '9780439708180', mode='B5')
        # Identical payloads are copies, so add independent contextual content.
        docs[2] = document('openLibrary-other', 'json', {'title': 'Right', 'isbn': '9780439708180', 'note': 'independent'})
        result = await run_pipeline(docs, '9780439708180', mode='B5')
        self.assertEqual(result['metadata']['title'], 'Right')
        self.assertEqual(result['decisions']['title']['status'], 'REVIEW_REQUIRED')

    async def test_auto_inferred_target_isbn_warns(self):
        from metadata_intelligence.pipeline import run_pipeline
        doc = document('pasted', 'text', 'Book A\nISBN: 9780439708180')
        result = await run_pipeline([doc])
        self.assertIn('TARGET_ISBN_INFERRED_FROM_SINGLE_SOURCE', result['warnings'])
