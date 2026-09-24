import hashlib
import json
import re
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit

MAX_SOURCE_CHARS = 100_000


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def public_url(value):
    try:
        parts = urlsplit(value or '')
        if parts.scheme not in {'http', 'https'} or not parts.hostname:
            return None
        return urlunsplit((parts.scheme, parts.hostname, parts.path, '', ''))
    except ValueError:
        return None


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        excluded = tag in {'script', 'style', 'nav', 'aside', 'footer', 'header'} or bool(
            re.search(r'recommend|related|upsell|cross.?sell', attrs.get('class', '') + attrs.get('id', ''), re.I))
        if tag not in {'br', 'img', 'meta', 'link', 'input', 'hr', 'source', 'wbr'}:
            self.stack.append((tag, excluded))
        if tag in {'p', 'div', 'tr', 'li', 'h1', 'h2', 'br'}:
            self.parts.append('\n')
        if tag in {'td', 'th'}:
            self.parts.append(' ')

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break
        if tag in {'p', 'div', 'tr', 'li', 'h1', 'h2'}:
            self.parts.append('\n')

    def handle_data(self, data):
        if not any(excluded for _, excluded in self.stack):
            self.parts.append(data)


def document(provider, kind, payload, url=None, record_id='primary'):
    raw = json.dumps(payload, ensure_ascii=False) if isinstance(payload, (dict, list)) else str(payload)
    if len(raw) > MAX_SOURCE_CHARS:
        raise ValueError('SOURCE_TOO_LARGE')
    if kind == 'html':
        parser = TextParser()
        parser.feed(raw)
        text = ''.join(parser.parts)
    elif kind == 'text':
        text = raw
    else:
        text = ''
    lines = [re.sub(r'\s+', ' ', line).strip() for line in text.splitlines() if line.strip()]
    text = '\n'.join(lines)
    blocks, offset = [], 0
    for index, line in enumerate(lines):
        blocks.append({'id': f'b{index}', 'text': line, 'start': offset})
        offset += len(line) + 1
    snapshot_hash = digest(payload)
    return {'id': digest([provider, public_url(url), snapshot_hash, record_id])[:24],
            'provider': provider, 'kind': kind, 'url': public_url(url),
            'recordId': record_id, 'snapshotHash': snapshot_hash,
            'payload': payload, 'cleanText': text, 'blocks': blocks, 'textVersion': 'blocks-v1'}
