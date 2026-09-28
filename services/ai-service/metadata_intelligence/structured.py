"""Deterministic source adapters. Pointers refer to the preserved raw payload."""
import json
import re

from .evidence_validation import candidate, text_evidence, ROLE_LABELS
from .schemas import ExtractionEvidence, LIST_FIELDS
from .sources import digest


def pointer(payload, path):
    value = payload
    for segment in path.strip('/').split('/'):
        segment = segment.replace('~1', '/').replace('~0', '~')
        value = value[int(segment)] if isinstance(value, list) else value[segment]
    return value


def extract_rules(doc):
    candidates, evidence = [], []

    def emit(field, value, paths, record=None, origin='SOURCE_DIRECT'):
        if value in (None, '', []):
            return
        ev = []
        for index, path in enumerate(paths):
            raw = pointer(doc['payload'], path)
            ev.append(ExtractionEvidence(
                id=digest([doc['id'], field, path])[:24], sourceDocumentId=doc['id'],
                sourceRecordId=record or doc['recordId'], snapshotHash=doc['snapshotHash'],
                kind='JSON_POINTER', jsonPointer=path, rawJsonValue=raw,
                itemIndex=index if isinstance(value, list) else None, locatorValid=True,
                supportValidation={'supportsValue': True, 'supportsRole': True, 'method': 'adapter-v1'},
            ).model_dump())
        candidates.append(candidate(doc, field, value, origin, ev, record))
        evidence.extend(ev)

    def object_fields(obj, base='', names=False, record=None):
        fields = {'title': 'title', 'subtitle': 'subtitle', 'publisher': 'publisher',
                  'publishedDate': 'publishedDate', 'description': 'description',
                  'pageCount': 'pageCount', 'language': 'language', 'isbn': 'isbn'}
        if names:
            fields.update(title='name', publishedDate='datePublished', pageCount='numberOfPages', language='inLanguage')
        for field, source in fields.items():
            value = obj.get(source)
            if isinstance(value, (str, int)) and not isinstance(value, bool):
                emit(field, value, [base + '/' + source], record)
            elif isinstance(value, dict):
                prop = 'value' if field == 'description' else 'name'
                if isinstance(value.get(prop), str):
                    emit(field, value[prop], [base + '/' + source + '/' + prop], record)
        for field, source in [('authors', 'author' if names else 'authors'),
                              ('translator', 'translator'), ('categories', 'genre' if names else 'categories')]:
            raw = obj.get(source)
            values = raw if isinstance(raw, list) else [raw] if raw else []
            result, paths = [], []
            for i, item in enumerate(values):
                path = base + '/' + source + (f'/{i}' if isinstance(raw, list) else '')
                value = item.get('name') if isinstance(item, dict) else item
                if isinstance(value, str):
                    result.append(value)
                    paths.append(path + '/name' if isinstance(item, dict) else path)
            emit(field, result, paths, record)

    payload = doc['payload']
    if doc['kind'] == 'json' and isinstance(payload, dict):
        if 'volumeInfo' in payload:
            obj = payload['volumeInfo']
            object_fields(obj, '/volumeInfo')
            for i, item in enumerate(obj.get('industryIdentifiers') or []):
                if isinstance(item, dict):
                    emit('isbn', item.get('identifier'), [f'/volumeInfo/industryIdentifiers/{i}/identifier'])
            images = obj.get('imageLinks') or {}
            for size in ('thumbnail', 'smallThumbnail'):
                if images.get(size):
                    emit('thumbnail', images[size], ['/volumeInfo/imageLinks/' + size])
                    break
        elif doc['provider'] == 'openLibrary':
            object_fields(payload)
            for field, source in [('publishedDate', 'publish_date'), ('pageCount', 'number_of_pages')]:
                emit(field, payload.get(source), ['/' + source])
            for source in ('isbn_13', 'isbn_10'):
                for i, isbn in enumerate(payload.get(source) or []):
                    emit('isbn', isbn, [f'/{source}/{i}'])
            for source, values in (payload.get('identifiers') or {}).items():
                if source in {'isbn_13', 'isbn_10'}:
                    for i, isbn in enumerate(values):
                        emit('isbn', isbn, [f'/identifiers/{source}/{i}'])
            pubs = payload.get('publishers') or []
            if pubs:
                value = pubs[0].get('name') if isinstance(pubs[0], dict) else pubs[0]
                emit('publisher', value, ['/publishers/0' + ('/name' if isinstance(pubs[0], dict) else '')])
            subjects = payload.get('subjects') or []
            vals, paths = [], []
            for i, item in enumerate(subjects):
                val = item.get('name') if isinstance(item, dict) else item
                if isinstance(val, str):
                    vals.append(val)
                    paths.append(f'/subjects/{i}' + ('/name' if isinstance(item, dict) else ''))
            emit('categories', vals, paths)
        elif doc['provider'] == 'vinabook':
            emit('title', payload.get('title'), ['/title'])
            for i, variant in enumerate(payload.get('variants') or []):
                for attr in ('barcode', 'sku'):
                    emit('isbn', variant.get(attr), [f'/variants/{i}/{attr}'])
            for i, option in enumerate(payload.get('options') or []):
                label = str(option.get('name', '')).casefold()
                values = option.get('values') or []
                if not values:
                    continue
                for field, pattern in ROLE_LABELS.items():
                    if re.fullmatch(pattern, label, re.I):
                        emit(field, values if field in LIST_FIELDS else values[0],
                             [f'/options/{i}/values/{j}' for j in range(len(values) if field in LIST_FIELDS else 1)],
                             origin='RULE_EXTRACTED')
            if isinstance(payload.get('description'), str) and '<' not in payload['description']:
                emit('description', payload['description'], ['/description'])
        elif doc['provider'] == 'tiki':
            emit('title', payload.get('name'), ['/name'])
            # SKU is not an ISBN identity assertion. Only explicitly labelled ISBNs qualify.
            mapping = {'author': 'authors', 'tac_gia': 'authors', 'publisher': 'publisher',
                       'nha_xuat_ban': 'publisher', 'isbn': 'isbn', 'number_of_page': 'pageCount',
                       'translator': 'translator', 'publication_date': 'publishedDate'}
            for i, group in enumerate(payload.get('specifications') or []):
                for j, attr in enumerate(group.get('attributes') or []):
                    field = mapping.get(attr.get('code'))
                    if field and isinstance(attr.get('value'), (str, int)):
                        value = [attr['value']] if field in LIST_FIELDS else attr['value']
                        emit(field, value, [f'/specifications/{i}/attributes/{j}/value'], origin='RULE_EXTRACTED')
        else:
            object_fields(payload, names=payload.get('@type') in ('Book', 'Product'))
    elif doc['kind'] in {'html', 'text'}:
        for block in doc['blocks']:
            for field, label in ROLE_LABELS.items():
                match = re.match(rf'^\s*(?:{label})\s*[:：]\s*(.+)$', block['text'], re.I)
                if not match:
                    continue
                value = match[1].strip()
                values = [v.strip() for v in value.split(';') if v.strip()] if field in LIST_FIELDS else value
                ev = [text_evidence(doc, field, v, {'blockId': block['id'], 'quote': block['text'],
                      'itemIndex': i if isinstance(values, list) else None})
                      for i, v in enumerate(values if isinstance(values, list) else [values])]
                candidates.append(candidate(doc, field, values, 'RULE_EXTRACTED', ev))
                evidence.extend(ev)
    return candidates, evidence


def json_ld_documents(doc):
    """Separate JSON-LD records; never associate a recommendation ISBN with primary text."""
    from .sources import document
    result = []
    if doc['kind'] != 'html':
        return result
    for match in re.finditer(r'<script[^>]*type=[\"\']application/ld\+json[\"\'][^>]*>(.*?)</script>', str(doc['payload']), re.I | re.S):
        try:
            data = json.loads(match[1])
        except ValueError:
            continue
        queue = data if isinstance(data, list) else [data]
        for obj in queue:
            if not isinstance(obj, dict):
                continue
            if isinstance(obj.get('@graph'), list):
                queue.extend(obj['@graph'])
            if obj.get('@type') in ('Book', 'Product'):
                child = document(doc['provider'], 'json', obj, doc['url'], 'ld-' + str(len(result)))
                child['parentDocumentId'] = doc['id']
                result.append(child)
    return result
