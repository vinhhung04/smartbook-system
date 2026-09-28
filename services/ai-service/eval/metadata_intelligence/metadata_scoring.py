"""Pure scoring for B1–B5. Unknown gold values are deliberately excluded."""
from __future__ import annotations

import statistics
from collections import defaultdict

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from metadata_intelligence.normalization import key, normalize  # noqa: E402

FIELDS = ('title', 'subtitle', 'authors', 'translator', 'publisher', 'publishedDate',
          'isbn', 'pageCount', 'categories', 'description')
LIST_FIELDS = {'authors', 'translator', 'categories'}


def known(entry):
    return isinstance(entry, dict) and entry.get('status') == 'known'


def values_equal(field, expected, actual):
    if field in LIST_FIELDS:
        return set(key(normalize(field, v)) for v in (expected or [])) == set(key(normalize(field, v)) for v in (actual or []))
    return key(normalize(field, expected)) == key(normalize(field, actual))


def list_counts(expected, actual):
    expected = {key(v) for v in (expected or [])}
    actual = {key(v) for v in (actual or [])}
    return len(expected & actual), len(actual - expected), len(expected - actual)


def score_run(entry, bundle):
    gold = entry['editionGold']['fields']
    metadata = bundle.get('metadata') or bundle
    decisions = bundle.get('decisions') or {}
    candidates = {c['id']: c for c in bundle.get('candidates', [])}
    evidence = {e['id']: e for e in bundle.get('evidence', [])}
    per_field, totals = {}, {'tp': 0, 'fp': 0, 'fn': 0, 'correct': 0, 'eligible': 0,
                               'supported': 0, 'emitted': 0, 'edition_contaminated': 0}
    for field in FIELDS:
        label = gold.get(field, {'status': 'unknown'})
        if not known(label):
            continue
        expected = label.get('value')
        actual = metadata.get(field)
        decision = decisions.get(field, {})
        is_emitted = actual not in (None, '', [])
        selected = [candidates[c] for c in decision.get('selectedCandidateIds', []) if c in candidates]
        support = bool(selected) and all(
            any(evidence.get(e, {}).get('locatorValid') and evidence.get(e, {}).get('supportValidation', {}).get('supportsValue')
                and evidence.get(e, {}).get('supportValidation', {}).get('supportsRole') for e in c.get('evidenceIds', [])) for c in selected)
        contaminated = any(c.get('editionStatus') in {'rejected', 'conflicting'} for c in selected)
        if field in LIST_FIELDS:
            tp, fp, fn = list_counts(expected, actual)
        elif expected in (None, '', []):
            tp, fp, fn = (0, 0, 0) if not is_emitted else (0, 1, 0)
        elif values_equal(field, expected, actual):
            tp, fp, fn = 1, 0, 0
        elif is_emitted:
            tp, fp, fn = 0, 1, 1
        else:
            tp, fp, fn = 0, 0, 1
        exact = values_equal(field, expected, actual)
        totals['tp'] += tp; totals['fp'] += fp; totals['fn'] += fn
        totals['eligible'] += 1
        totals['correct'] += int(exact)
        totals['emitted'] += int(is_emitted)
        totals['supported'] += int(is_emitted and support)
        totals['edition_contaminated'] += int(contaminated)
        per_field[field] = {'exact': exact, 'emitted': is_emitted, 'supported': support,
                            'editionContaminated': contaminated, 'tp': tp, 'fp': fp, 'fn': fn}
    # The pipeline's own review flag, independent of whether gold is known yet.
    review_required = any(decisions.get(field, {}).get('status') == 'REVIEW_REQUIRED' for field in FIELDS)
    return {'editionId': entry['editionId'], 'workGroup': entry['workGroup'], 'perField': per_field,
            'reviewRequired': review_required,
            'latencyMs': bundle.get('processingTimeMs', 0), 'usage': bundle.get('usage', []), **totals}


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def percentile(values, point):
    if not values:
        return None
    values = sorted(values)
    return values[min(len(values) - 1, max(0, int((len(values) - 1) * point)))]


def aggregate(results):
    totals = {name: sum(item[name] for item in results) for name in ('tp', 'fp', 'fn', 'correct', 'eligible', 'supported', 'emitted', 'edition_contaminated')}
    precision = ratio(totals['tp'], totals['tp'] + totals['fp'])
    recall = ratio(totals['tp'], totals['tp'] + totals['fn'])
    costs = [call.get('costUsd') for r in results for call in r['usage']]
    return {
        'editions': len(results), 'precision': precision, 'recall': recall,
        'f1': ratio(2 * precision * recall, precision + recall) if precision is not None and recall is not None else None,
        'correctFieldCoverage': ratio(totals['correct'], totals['eligible']),
        'rawCoverage': ratio(totals['emitted'], totals['eligible']),
        'hallucinationRate': ratio(totals['emitted'] - totals['supported'], totals['emitted']),
        'evidenceSupportedExtractionRate': ratio(totals['supported'], totals['emitted']),
        'editionContaminationRate': ratio(totals['edition_contaminated'], totals['emitted']),
        'reviewRate': ratio(sum(r['reviewRequired'] for r in results), len(results)),
        'latencyMs': {'p50': percentile([r['latencyMs'] for r in results], .5), 'p95': percentile([r['latencyMs'] for r in results], .95)},
        'tokenUsage': {'prompt': sum((call.get('prompt_tokens') or 0) for r in results for call in r['usage']),
                       'completion': sum((call.get('completion_tokens') or 0) for r in results for call in r['usage'])},
        # A provider that omits cost is not free. Preserve that experimental limitation.
        'apiCostUsd': 0 if not costs else sum(costs) if all(cost is not None for cost in costs) else None,
        'apiCostAvailable': not costs or all(cost is not None for cost in costs),
        'denominators': totals,
    }


def paired_delta(left, right):
    left_by_work, right_by_work = defaultdict(list), defaultdict(list)
    for item in left: left_by_work[item['workGroup']].append(item)
    for item in right: right_by_work[item['workGroup']].append(item)
    rows = []
    for work in sorted(set(left_by_work) & set(right_by_work)):
        l, r = left_by_work[work], right_by_work[work]
        rows.append((ratio(sum(x['correct'] for x in r), sum(x['eligible'] for x in r)) or 0) -
                    (ratio(sum(x['correct'] for x in l), sum(x['eligible'] for x in l)) or 0))
    return {'workGroups': len(rows), 'meanCorrectFieldCoverageDelta': statistics.mean(rows) if rows else None}
