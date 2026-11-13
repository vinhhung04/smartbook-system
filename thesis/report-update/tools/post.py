# -*- coding: utf-8 -*-
"""Renumber figure/table captions + references, then rebuild TOC / list of figures / list of tables."""
import copy, re, json
from lxml import etree
from sbdoc import ns, q, text_of, W

CAP_RE = re.compile(r'^(Hình|Bảng) (\d+\.\d+|\{(?:FIG|TAB):\w+\})(?=\s)')
REF_RE = re.compile(r'(Hình|Bảng) (\d+)\.(\d+)')
PH_RE = re.compile(r'\{(FIG|TAB):(\w+)\}')


def style(p):
    s = p.find('w:pPr/w:pStyle', ns)
    return s.get(q('w:val')) if s is not None else None


def centered(p):
    j = p.find('w:pPr/w:jc', ns)
    return j is not None and j.get(q('w:val')) == 'center'


def bookmark(p):
    b = p.find('w:bookmarkStart', ns)
    return b.get(q('w:name')) if b is not None else None


def renumber(d):
    body = d.body
    chapter = 0
    counters = {}
    oldmap = {}   # ('Hình','4.17') -> '4.19'
    keymap = {}   # 'FIG:reg' -> '4.6'
    captions = []
    for e in body:
        if e.tag != q('w:p'):
            continue
        st = style(e)
        if st == 'Heading1':
            chapter += 1
            continue
        if chapter == 0:
            continue
        m = CAP_RE.match(text_of(e))
        if not m or not centered(e):
            continue
        kind, num = m.group(1), m.group(2)
        counters[(kind, chapter)] = counters.get((kind, chapter), 0) + 1
        new = '%d.%d' % (chapter, counters[(kind, chapter)])
        if num.startswith('{'):
            keymap[num[1:-1]] = new
        else:
            if (kind, num) in oldmap:
                raise SystemExit('duplicate caption %s %s' % (kind, num))
            oldmap[(kind, num)] = new
        captions.append(e)

    def fix(s):
        s = REF_RE.sub(lambda m: '%s %s' % (m.group(1), oldmap.get((m.group(1), m.group(2) + '.' + m.group(3)), m.group(2) + '.' + m.group(3))), s)
        s = PH_RE.sub(lambda m: keymap['%s:%s' % (m.group(1), m.group(2))], s)
        return s
    for e in body:
        if e.tag == q('w:sdt'):
            continue
        for t in e.iter(q('w:t')):
            if t.text and ('Hình' in t.text or 'Bảng' in t.text or '{' in t.text):
                t.text = fix(t.text)
    leftover = [text_of(e)[:80] for e in body if e.tag != q('w:sdt') and ('{FIG:' in text_of(e) or '{TAB:' in text_of(e))]
    if leftover:
        raise SystemExit('unresolved placeholders: %s' % leftover)
    changed = {'%s %s' % k: v for k, v in oldmap.items() if k[1] != v}
    return captions, keymap, changed


def _entry(tpl_par, anchor, parts, page):
    p = etree.Element(q('w:p'))
    p.append(copy.deepcopy(tpl_par.find('w:pPr', ns)))
    hl = etree.SubElement(p, q('w:hyperlink'))
    hl.set(q('w:anchor'), anchor)
    rt = None
    for r in tpl_par.iter(q('w:r')):
        if r.find('w:t', ns) is not None:
            rt = r
            break
    r = etree.SubElement(hl, q('w:r'))
    if rt is not None and rt.find('w:rPr', ns) is not None:
        r.append(copy.deepcopy(rt.find('w:rPr', ns)))
    for i, s in enumerate(parts + [page]):
        if i:
            etree.SubElement(r, q('w:tab'))
        t = etree.SubElement(r, q('w:t'))
        t.text = s
        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    return p


def _rebuild_sdt(sdt, entries):
    """entries: list of (template_par, anchor, parts, page)."""
    content = sdt.find('w:sdtContent', ns)
    paras = content.findall('w:p', ns)
    first, last = paras[0], paras[-1]
    lead = []
    for child in first:
        if child.tag == q('w:pPr'):
            continue
        if child.tag == q('w:hyperlink'):
            break
        lead.append(copy.deepcopy(child))
    for p in paras[:-1]:
        content.remove(p)
    news = [_entry(*e) for e in entries]
    ppr = news[0].find('w:pPr', ns)
    idx = list(news[0]).index(ppr) + 1
    for k, el in enumerate(lead):
        news[0].insert(idx + k, el)
    for n in news:
        last.addprevious(n)


def collect_templates(d):
    sdts = [e for e in d.body if e.tag == q('w:sdt')][:3]
    toc_pars = sdts[0].find('w:sdtContent', ns).findall('w:p', ns)
    tpl = {}
    specials = set()
    for p in toc_pars:
        hl = p.find('w:hyperlink', ns)
        if hl is None:
            continue
        t = text_of(p)
        a = hl.get(q('w:anchor'))
        if t.startswith('CHƯƠNG'):
            tpl.setdefault(1, p)
        elif re.match(r'^\d+\.\d+\.\d+', t):
            tpl.setdefault(3, p)
        elif re.match(r'^\d+\.\d+', t):
            tpl.setdefault(2, p)
        else:
            tpl.setdefault('s', p)
            specials.add(a)
    fig_tpl = [p for p in sdts[1].find('w:sdtContent', ns).findall('w:p', ns) if p.find('w:hyperlink', ns) is not None][0]
    tab_tpl = [p for p in sdts[2].find('w:sdtContent', ns).findall('w:p', ns) if p.find('w:hyperlink', ns) is not None][0]
    return sdts, {k: copy.deepcopy(v) for k, v in tpl.items()}, specials, copy.deepcopy(fig_tpl), copy.deepcopy(tab_tpl)


def entries(d, specials):
    """Ordered list of dicts: kind toc/fig/tab, anchor, parts, search text."""
    out = []
    c1 = c2 = c3 = 0
    for e in d.body:
        if e.tag != q('w:p'):
            continue
        st = style(e)
        txt = text_of(e).strip()
        bm = bookmark(e)
        if st in ('Heading1', 'Heading2', 'Heading3'):
            if bm is None:
                bm = d._bookmark(e)
            if st == 'Heading1':
                c1 += 1; c2 = c3 = 0
                out.append(dict(kind='toc', level=1, anchor=bm, parts=['CHƯƠNG %d' % c1, txt], search=txt))
            elif st == 'Heading2':
                c2 += 1; c3 = 0
                out.append(dict(kind='toc', level=2, anchor=bm, parts=['%d.%d' % (c1, c2), txt], search=txt))
            else:
                c3 += 1
                out.append(dict(kind='toc', level=3, anchor=bm, parts=['%d.%d.%d' % (c1, c2, c3), txt], search=txt))
        elif bm in specials:
            out.append(dict(kind='toc', level='s', anchor=bm, parts=[txt], search=txt))
        elif c1 > 0 and CAP_RE.match(txt) and centered(e) and not txt.startswith(('Hình A', 'Bảng A', 'Bảng B')):
            if bm is None:
                bm = d._bookmark(e)
            out.append(dict(kind='fig' if txt.startswith('Hình') else 'tab', anchor=bm, parts=[txt], search=txt))
    return out


def _level_tpl(base2, own, left, first, tabpos):
    """Paragraph = level-2 pPr (renders correctly) with another indent/left tab; runs styled like `own`."""
    p = copy.deepcopy(own)
    old = p.find('w:pPr', ns)
    new = copy.deepcopy(base2.find('w:pPr', ns))
    ind = new.find('w:ind', ns)
    ind.set(q('w:left'), str(left)); ind.set(q('w:firstLine'), str(first))
    tabs = new.find('w:tabs', ns)
    lefts = [t for t in tabs.findall('w:tab', ns) if t.get(q('w:val')) == 'left']
    for t in lefts:
        t.set(q('w:pos'), str(tabpos))
    p.replace(old, new)
    return p


def keep_with_next(d):
    """Headings and table captions must not end a page alone (Google export sets keepNext=0)."""
    n = 0
    for e in d.body:
        if e.tag != q('w:p'):
            continue
        st = style(e)
        t = text_of(e)
        nxt = e.getnext()
        is_tabcap = t.startswith('Bảng ') and centered(e) and nxt is not None and nxt.tag == q('w:tbl')
        if st in ('Heading1', 'Heading2', 'Heading3', 'Heading4') or is_tabcap:
            ppr = e.find('w:pPr', ns)
            kn = ppr.find('w:keepNext', ns)
            if kn is None:
                kn = etree.Element(q('w:keepNext'))
                st_el = ppr.find('w:pStyle', ns)
                (st_el.addnext(kn) if st_el is not None else ppr.insert(0, kn))
            if kn.get(q('w:val')) != '1':
                kn.set(q('w:val'), '1'); n += 1
    return n


def rebuild_lists(d, pages=None):
    pages = pages or {}
    sdts, tpl, specials, fig_tpl, tab_tpl = collect_templates(d)
    base2 = tpl[2]
    i2 = base2.find('w:pPr/w:ind', ns)
    l2 = int(float(i2.get(q('w:left')))) + int(float(i2.get(q('w:firstLine')) or 0))
    tpl[1] = _level_tpl(base2, tpl[1], 0, 0, 1680)
    tpl[3] = _level_tpl(base2, tpl[3], l2, 0, l2 + 900)
    ents = entries(d, specials)
    toc = [(tpl[e['level']], e['anchor'], e['parts'], pages.get(e['anchor'], '0')) for e in ents if e['kind'] == 'toc']
    figs = [(fig_tpl, e['anchor'], e['parts'], pages.get(e['anchor'], '0')) for e in ents if e['kind'] == 'fig']
    tabs = [(tab_tpl, e['anchor'], e['parts'], pages.get(e['anchor'], '0')) for e in ents if e['kind'] == 'tab']
    _rebuild_sdt(sdts[0], toc)
    _rebuild_sdt(sdts[1], figs)
    _rebuild_sdt(sdts[2], tabs)
    return ents
