import re

from .normalization import key, normalize
from .schemas import ExtractionEvidence, MetadataCandidate, FIELDS, LIST_FIELDS, WORK_SCOPE_FIELDS
from .sources import digest

ROLE_LABELS = {
    'authors': r'tác giả|author(?:s)?',
    'translator': r'dịch giả|người dịch|translator(?:s)?|translated by',
    'publisher': r'nhà xuất bản|nxb|publisher',
    'publishedDate': r'ngày xuất bản|năm xuất bản|publication date|published|datepublished',
    'pageCount': r'số trang|trang|pages?|numberofpages',
    'isbn': r'isbn|gtin13',
    'title': r'tên sách|nhan đề|title',
    'subtitle': r'phụ đề|subtitle',
    'categories': r'thể loại|chủ đề|categories|category|subjects?',
    'description': r'mô tả|giới thiệu|description|summary',
}


def candidate(doc, field, value, origin, evidence, record_id=None, model=None):
    normalized = normalize(field, value)
    errors = []
    items = value if isinstance(value, list) else [value]
    for index, _ in enumerate(items):
        supporting = [e for e in evidence if e.get('itemIndex') in (index, None)]
        if not any(e['locatorValid'] and e['supportValidation'].get('supportsValue')
                   and e['supportValidation'].get('supportsRole') for e in supporting):
            errors.append('UNSUPPORTED_ITEM:' + str(index))
    if normalized is None:
        errors.append('INVALID_VALUE')
    return MetadataCandidate(
        id=digest([doc['id'], record_id, field, value, origin, [e['id'] for e in evidence]])[:24],
        sourceDocumentId=doc['id'], sourceRecordId=record_id or doc['recordId'], field=field,
        rawValue=value, normalizedValue=normalized, origin=origin, model=model,
        scope='work' if field in WORK_SCOPE_FIELDS else 'edition',
        promptVersion='extract-v1' if origin == 'LLM_EXTRACTED' else None,
        evidenceIds=[e['id'] for e in evidence], eligibleForFusion=not errors,
        rejectionReasons=errors,
        normalizationSteps=[{'rule': 'canonical-v1', 'before': value, 'after': normalized}],
    ).model_dump()


def text_evidence(doc, field, value, item, record_id=None):
    block = next((b for b in doc['blocks'] if b['id'] == item.get('blockId')), None)
    quote = item.get('quote')
    quote = quote if isinstance(quote, str) else ''
    position = block['text'].find(quote) if block and quote else -1
    locator = position >= 0
    # Inspect the complete block, not a cropped quote hiding "translator:".
    context = block['text'] if block else ''
    supports = bool(locator and key(value) in key(quote))
    if field == 'isbn':
        from .verification import canonical_isbn
        supports = bool(locator and canonical_isbn(value) and any(
            canonical_isbn(match) == canonical_isbn(value)
            for match in re.findall(r'[0-9][0-9Xx\s-]{8,20}[0-9Xx]', quote)))
    role = True
    if field in ROLE_LABELS and field != 'title':
        role = bool(re.search(ROLE_LABELS[field], context, re.I))
    if field == 'authors' and re.search(ROLE_LABELS['translator'], context, re.I):
        role = False  # ambiguous mixed-role blocks require manual extraction/review
    if field == 'publisher' and re.search(r'nhà phát hành|distribut', context, re.I):
        role = False
    start = block['start'] + position if locator else None
    return ExtractionEvidence(
        id=digest([doc['id'], field, item, value])[:24], sourceDocumentId=doc['id'],
        sourceRecordId=record_id or doc['recordId'], snapshotHash=doc['snapshotHash'],
        kind='TEXT_SPAN', blockId=item.get('blockId'), quote=quote,
        start=start, end=start + len(quote) if start is not None else None,
        itemIndex=item.get('itemIndex'), locatorValid=locator,
        supportValidation={'supportsValue': supports, 'supportsRole': role,
                           'method': 'literal-and-role-v1'},
    ).model_dump()


def extract_llm_candidates(doc, response, model=None):
    candidates, all_evidence = [], []
    for field, entry in response.get('fields', {}).items():
        if field not in FIELDS or not isinstance(entry, dict):
            continue
        value = entry.get('value')
        if value in (None, '', []):
            continue
        if field in LIST_FIELDS and (not isinstance(value, list) or not all(isinstance(v, str) for v in value)):
            continue
        if field not in LIST_FIELDS and not isinstance(value, (str, int)):
            continue
        evidence = []
        for item in entry.get('evidence', []):
            if not isinstance(item, dict):
                continue
            index = item.get('itemIndex')
            if isinstance(value, list):
                if not isinstance(index, int) or not 0 <= index < len(value):
                    continue
                item_value = value[index]
            else:
                item_value = value
            evidence.append(text_evidence(doc, field, item_value, item))
        candidates.append(candidate(doc, field, value, 'LLM_EXTRACTED', evidence, model=model))
        all_evidence.extend(evidence)
    return candidates, all_evidence
