# -*- coding: utf-8 -*-
import sys, json, re, unicodedata
import pymupdf as fitz

pdf, entries_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
doc = fitz.open(pdf)


def norm(s):
    s = unicodedata.normalize('NFC', s).replace('​', '').replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', s).strip()


def roman(n):
    vals = [(1000, 'm'), (900, 'cm'), (500, 'd'), (400, 'cd'), (100, 'c'), (90, 'xc'), (50, 'l'), (40, 'xl'), (10, 'x'), (9, 'ix'), (5, 'v'), (4, 'iv'), (1, 'i')]
    s = ''
    for v, r in vals:
        while n >= v:
            s += r; n -= v
    return s


foot_digits, lines = [], []
for p in doc:
    h = p.rect.height
    foot = ' '.join(norm(b[4]) for b in p.get_text('blocks') if b[1] > h * 0.88)
    m = re.search(r'Khoa\s*(\d+)\s*$', foot)
    foot_digits.append(int(m.group(1)) if m else None)
    ls = []
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            t = norm(''.join(s['text'] for s in l['spans']))
            if t and '.....' not in t:
                ls.append(t)
    lines.append(ls)
body_start = next(i for i, v in enumerate(foot_digits) if v is not None)
labels, last = [], None
for i, v in enumerate(foot_digits):
    if i < body_start:
        labels.append(roman(i + 1))
    elif v is not None:
        labels.append(str(v)); last = (i, v)
    else:
        labels.append(str(last[1] + (i - last[0])))

ents = json.load(open(entries_path, encoding='utf-8'))
res, missing, cur = {}, [], body_start
for e in ents:
    parts = e['parts']
    title = norm(e['search'])
    front = e['kind'] == 'toc' and len(parts) == 1 and title.startswith('DANH MỤC')
    if front:
        rng = range(0, body_start)
        match = lambda l: l == title
    else:
        keys = [title[:28]]
        if e['kind'] == 'toc' and len(parts) == 2:
            keys.append(norm(parts[0] + ' ' + title)[:28])
        rng = range(cur, len(lines))
        match = lambda l: any(l.startswith(k) for k in keys)
    hits = [i for i in rng if any(match(l) for l in lines[i])]
    found = (hits[-1] if front else hits[0]) if hits else None
    if found is None:
        missing.append(title[:60]); continue
    if not front:
        cur = found
    res[e['anchor']] = labels[found]
json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
print('pages', len(labels), 'body_start', body_start, 'found', len(res), 'missing', len(missing))
for m in missing[:20]:
    print('  MISSING', m)
print('labels', labels[body_start - 2:body_start + 2], labels[-4:])
