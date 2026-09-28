import re

from .schemas import WORK_SCOPE_FIELDS


def canonical_isbn(value):
    s = re.sub(r'[^0-9X]', '', str(value or '').upper())
    if len(s) == 10 and re.fullmatch(r'\d{9}[\dX]', s):
        if sum((10 - i) * (10 if c == 'X' else int(c)) for i, c in enumerate(s)) % 11:
            return None
        s = '978' + s[:9]
        s += str((-sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s))) % 10)
    if len(s) == 13 and s.isdigit() and s.startswith(('978', '979')):
        if sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s)) % 10 == 0:
            return s
    return None


def verify_candidates(candidates, target):
    target = canonical_isbn(target)
    by_record = {}
    for candidate in candidates:
        record = (candidate['sourceDocumentId'], candidate['sourceRecordId'])
        if candidate['field'] == 'isbn' and candidate['eligibleForFusion']:
            isbn = canonical_isbn(candidate['normalizedValue'])
            if isbn:
                by_record.setdefault(record, set()).add(isbn)
    for candidate in candidates:
        observed = sorted(by_record.get((candidate['sourceDocumentId'], candidate['sourceRecordId']), set()))
        candidate['observedIsbns'] = observed
        if not target or not observed:
            status = 'unverified'
        elif target not in observed:
            status = 'rejected'
        elif len(observed) > 1:
            status = 'conflicting'
        else:
            status = 'verified'
        candidate['editionStatus'] = status
        if status in {'rejected', 'conflicting'} and candidate['field'] not in WORK_SCOPE_FIELDS:
            candidate['eligibleForFusion'] = False
            candidate['rejectionReasons'].append('EDITION_' + status.upper())
