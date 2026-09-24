import time

from .schemas import VERSION, FieldProvenance
from .structured import extract_rules, json_ld_documents
from .verification import verify_candidates, canonical_isbn
from .field_fusion import fuse
from .llm_extractor import extract


async def run_pipeline(documents, target_isbn=None, provider=None, mode='B5', budget=60,
                       evidence_gate=True, edition_gate=True, fusion_policy='consensus'):
    started = time.monotonic()
    deadline = started + budget
    docs = list(documents[:5])
    warnings = ['SOURCE_LIMIT'] if len(documents) > 5 else []
    # JSON-LD children share provider/domain votes with their parent.
    for doc in list(docs):
        docs.extend(json_ld_documents(doc)[:max(0, 5 - len(docs))])
    if mode == 'B1':
        docs = [d for d in docs if d['provider'] == 'googleBooks'][:1]
    candidates, evidence, calls = [], [], []
    llm_docs = 0
    for doc in docs:
        rule_candidates, rule_evidence = extract_rules(doc)
        if mode != 'B3':
            candidates.extend(rule_candidates)
            evidence.extend(rule_evidence)
        rule_fields = {c['field'] for c in rule_candidates if c['eligibleForFusion']}
        # Text rules remain the baseline. A model is only worth paying for when a
        # factual core field is absent; optional subtitles/translators/categories
        # do not force a call on a complete labelled record.
        needs_llm = bool({'title', 'authors', 'publisher', 'publishedDate', 'isbn', 'pageCount', 'description'} - rule_fields)
        should_llm = mode == 'B3' or (mode in {'B4', 'B5'} and needs_llm)
        if should_llm and doc['kind'] in {'html', 'text'} and provider and llm_docs < 3:
            llm_docs += 1
            cs, es, usage, ws = await extract(doc, provider, deadline)
            # Hybrid: only use LLM for fields absent from valid rule extraction in this record.
            filled = {c['field'] for c in rule_candidates if c['eligibleForFusion']} if mode != 'B3' else set()
            for c in cs:
                if c['field'] in filled:
                    c['eligibleForFusion'] = False
                    c['rejectionReasons'].append('RULE_FIELD_ALREADY_PRESENT')
            candidates.extend(cs)
            evidence.extend(es)
            calls.extend(usage)
            warnings.extend(ws)
        elif should_llm and doc['kind'] in {'html', 'text'}:
            warnings.append('LLM_SKIPPED:' + doc['id'])
    # IDs identify facts, not retries or repeated chunks.
    candidates = list({c['id']: c for c in candidates}.values())
    evidence = list({e['id']: e for e in evidence}.values())
    if not evidence_gate:
        for c in candidates:
            if c['normalizedValue'] is not None and 'RULE_FIELD_ALREADY_PRESENT' not in c['rejectionReasons']:
                c['eligibleForFusion'] = True
    target = canonical_isbn(target_isbn)
    observed = {c['normalizedValue'] for c in candidates if c['field'] == 'isbn' and c['eligibleForFusion']}
    if not target and len(observed) == 1:
        target = next(iter(observed))
        # Self-inferred target: any resulting 'verified' status only means the record
        # matches itself, not that an independent source confirmed the edition.
        warnings.append('TARGET_ISBN_INFERRED_FROM_SINGLE_SOURCE')
    verify_candidates(candidates, target)
    if not edition_gate:
        for c in candidates:
            c['editionStatus'] = 'verified'
            c['eligibleForFusion'] = c['normalizedValue'] is not None and not any(
                not reason.startswith('EDITION_') for reason in c['rejectionReasons'])
    selected = candidates
    if mode in {'B1', 'B2', 'B3', 'B4'}:
        # Frozen single-record policy: eligible field coverage, then stable source/record ID.
        records = {(c['sourceDocumentId'], c['sourceRecordId']) for c in candidates}
        if records:
            record = sorted(records, key=lambda r: (-len({c['field'] for c in candidates
                if (c['sourceDocumentId'], c['sourceRecordId']) == r and c['eligibleForFusion']}), r))[0]
            selected = [c for c in candidates if (c['sourceDocumentId'], c['sourceRecordId']) == record]
    decisions = fuse(selected, docs, fusion_policy)
    provenance = {}
    for field, decision in decisions.items():
        related = [c for c in candidates if c['field'] == field]
        provenance[field] = FieldProvenance(
            field=field, sourceDocumentIds=sorted({c['sourceDocumentId'] for c in related}),
            candidateIds=[c['id'] for c in related], evidenceIds=[e for c in related for e in c['evidenceIds']],
            events=[{'stage': stage, 'actorType': 'LLM' if stage == 'EXTRACTION' and c['origin'] == 'LLM_EXTRACTED' else 'RULE',
                     'candidateId': c['id'], 'version': VERSION,
                     'outputValue': c['rawValue'] if stage == 'EXTRACTION' else c['editionStatus'] if stage == 'VERIFICATION' else c['normalizedValue']}
                    for c in related for stage in ('EXTRACTION', 'VERIFICATION', 'NORMALIZATION')]
                   + [{'stage': 'FUSION', 'actorType': 'RULE', 'selectedCandidateIds': decision['selectedCandidateIds'], 'version': VERSION}],
        ).model_dump()
    return {'schemaVersion': VERSION, 'targetIsbn': target, 'mode': mode,
            'metadata': {f: d['proposedValue'] for f, d in decisions.items()},
            'documents': docs, 'candidates': candidates, 'evidence': evidence,
            'decisions': decisions, 'provenance': provenance, 'warnings': sorted(set(warnings)),
            'usage': calls, 'processingTimeMs': round((time.monotonic() - started) * 1000),
            'cacheHit': False}


def legacy_projection(bundle):
    metadata = bundle['metadata']
    docs = {d['id']: d for d in bundle['documents']}
    cs = {c['id']: c for c in bundle['candidates']}
    evidence, conflicts = {}, []
    for field, d in bundle['decisions'].items():
        selected = [cs[i] for i in d['selectedCandidateIds']]
        alternatives = [{'source': docs[cs[i]['sourceDocumentId']]['provider'], 'value': cs[i]['normalizedValue']}
                        for i in d['alternativeCandidateIds']]
        evidence[field] = {'selectedValue': d['proposedValue'],
                           'selectedSource': docs[selected[0]['sourceDocumentId']]['provider'] if selected else None,
                           'confirmations': [{'source': docs[c['sourceDocumentId']]['provider'], 'value': c['normalizedValue']} for c in selected],
                           'selectionReason': {'agreementCount': d['agreementGroups'], 'conflictCount': d['conflictGroups'],
                                               'sourceReliability': d['confidenceComponents'].get('bestSourcePrior', 0)}}
        if alternatives:
            conflicts.append({'field': field, 'selectedValue': d['proposedValue'], 'alternatives': alternatives})
    found = bool(metadata.get('title') or metadata.get('authors'))
    confidence = {f: d['confidence'] for f, d in bundle['decisions'].items()}
    quality = sum(confidence.values()) / len(confidence)
    providers = ('googleBooks', 'openLibrary', 'worldCat', 'fahasa', 'tiki', 'vinabook', 'webSearch')
    return {**metadata, 'isbn': bundle['targetIsbn'] or '', 'isbn13': bundle['targetIsbn'],
            'success': found, 'found': found, 'source': {**{p: any(d['provider'] == p for d in docs.values()) for p in providers}, 'aiSummary': 'none'},
            'confidence': {'overall': quality, **{p: 0 for p in providers}}, 'fieldConfidence': confidence,
            'fieldEvidence': evidence, 'conflicts': conflicts, 'metadataQualityScore': quality,
            'sources': [{'name': p, 'enabled': True, 'status': 'SUCCESS', 'durationMs': 0} for p in sorted({d['provider'] for d in docs.values()})],
            'summaryVi': None, 'keywords': [], 'manualEntryRequired': not found,
            'processingTimeMs': bundle['processingTimeMs'], 'intelligence': bundle}
