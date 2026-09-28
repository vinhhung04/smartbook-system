from source_reliability import reliability

from .normalization import key
from .schemas import FIELDS, LIST_FIELDS, WORK_SCOPE_FIELDS, FieldDecision
from urllib.parse import urlsplit


def fuse(candidates, documents, policy='consensus'):
    docs = {doc['id']: doc for doc in documents}
    # Union duplicate payloads, providers and domains, including transitive copies.
    parents = {doc['id']: doc['id'] for doc in documents}
    def root(value):
        while parents[value] != value:
            value = parents[value]
        return value
    owners = {}
    for doc in documents:
        tokens = [('provider', doc['provider']), ('hash', doc['snapshotHash'])]
        if doc.get('url'):
            tokens.append(('domain', urlsplit(doc['url']).hostname))
        for token in tokens:
            if token in owners:
                parents[root(doc['id'])] = root(owners[token])
            owners[token] = doc['id']
    result = {}
    for field in FIELDS:
        entries = [c for c in candidates if c['field'] == field]
        eligible = [c for c in entries if c['eligibleForFusion']]
        def weight(c):
            return reliability(docs[c['sourceDocumentId']]['provider'], field) or .65
        if field not in WORK_SCOPE_FIELDS:
            verified = [c for c in eligible if c['editionStatus'] == 'verified']
            if verified:
                eligible = verified
            elif eligible:
                # Do not combine unverified records from different editions/sources;
                # keep the most reliable source's record, not just the first extracted.
                best_source = max(eligible, key=lambda c: (weight(c), c['id']))
                record = (best_source['sourceDocumentId'], best_source['sourceRecordId'])
                eligible = [c for c in eligible if (c['sourceDocumentId'], c['sourceRecordId']) == record]
        # Work-scope fields (e.g. description) are edition-invariant, so every eligible
        # candidate can corroborate regardless of which record/edition it came from.
        groups = {}
        for c in eligible:
            groups.setdefault(key(c['normalizedValue']), []).append(c)
        def support(group):
            weights = {}
            for c in group:
                source = root(c['sourceDocumentId'])
                weights[source] = max(weights.get(source, 0), weight(c))
            return sum(weights.values()), len(weights)
        ordered = sorted(groups.values(), key=lambda g: (
            -(support(g)[0] if policy == 'consensus' else max(weight(c) for c in g)),
            -max(weight(c) for c in g), min(c['id'] for c in g)))
        decision = FieldDecision(field=field, proposedValue=[] if field in LIST_FIELDS else None).model_dump()
        chosen_ids = {c['id'] for c in eligible}
        decision['excludedCandidates'] = [{'id': c['id'], 'reasons': c['rejectionReasons'] or ['EDITION_NOT_ELIGIBLE']}
                                           for c in entries if c['id'] not in chosen_ids]
        if ordered:
            winner = ordered[0]
            best = sorted(winner, key=lambda c: (-weight(c), c['id']))[0]
            amount, count = support(winner)
            ratio = amount / sum(support(group)[0] for group in ordered)
            corroboration = .85 if count == 1 else 1.
            score = round(weight(best) * ratio * corroboration, 4)
            reasons = []
            if len(ordered) > 1:
                reasons.append('SOURCE_CONFLICT')
            if best['editionStatus'] != 'verified':
                reasons.append('EDITION_UNVERIFIED')
            if score < .8:
                reasons.append('LOW_CONFIDENCE')
            decision.update(proposedValue=best['normalizedValue'], selectedCandidateIds=[c['id'] for c in winner],
                            alternativeCandidateIds=[c['id'] for group in ordered[1:] for c in group],
                            confidenceComponents={'bestSourcePrior': weight(best), 'supportRatio': ratio,
                                                  'corroboration': corroboration}, confidence=score,
                            reasonCodes=reasons, status='REVIEW_REQUIRED' if reasons else 'PROPOSED',
                            agreementGroups=count, conflictGroups=len(ordered) - 1)
        result[field] = decision
    return result
