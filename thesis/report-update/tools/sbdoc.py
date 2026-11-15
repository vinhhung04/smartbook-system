"""Minimal, format-preserving editor for the SmartBook thesis DOCX (Google-Docs export).

Edits word/document.xml in place with lxml: paragraphs/tables are cloned from
existing ones so every new element inherits the original direct formatting.
"""
import copy, re, zipfile, shutil, os
from lxml import etree
from PIL import Image, PngImagePlugin  # noqa: F401

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
PR = 'http://schemas.openxmlformats.org/package/2006/relationships'
ns = {'w': W, 'r': R, 'wp': WP, 'a': A}
EMU_CM = 360000


def q(tag):
    p, t = tag.split(':')
    return '{%s}%s' % (ns[p], t)


def text_of(e):
    return ''.join(t.text or '' for t in e.iter(q('w:t')))


class Doc:
    def __init__(self, src):
        self.src = src
        self.z = zipfile.ZipFile(src)
        self.root = etree.fromstring(self.z.read('word/document.xml'))
        self.rels = etree.fromstring(self.z.read('word/_rels/document.xml.rels'))
        self.body = self.root.find('w:body', ns)
        self.new_media = {}  # zip name -> bytes
        self.bm_id = 900000
        self.docpr_id = 5000
        self.rid_n = 9000
        self.new_keys = {}   # placeholder key -> caption paragraph
        self.T = {}
        self._templates()

    # ---------- lookup ----------
    def top_pars(self):
        return [e for e in self.body if e.tag == q('w:p')]

    def find(self, prefix, nth=0, start_after=None):
        hits = []
        started = start_after is None
        for e in self.body:
            if not started:
                if e is start_after:
                    started = True
                continue
            if e.tag == q('w:p') and text_of(e).startswith(prefix):
                hits.append(e)
        if len(hits) <= nth:
            raise KeyError(prefix)
        return hits[nth]

    def tables(self):
        return [e for e in self.body if e.tag == q('w:tbl')]

    def table_after(self, p):
        e = p.getnext()
        while e is not None and e.tag != q('w:tbl'):
            e = e.getnext()
        return e

    def style(self, p):
        s = p.find('w:pPr/w:pStyle', ns)
        return s.get(q('w:val')) if s is not None else None

    # ---------- templates ----------
    def _templates(self):
        f = self.find
        self.T['body'] = f('Hệ thống kết hợp ba kiểu giao tiếp')
        self.T['bullet'] = f('Tuyến lưu thông phục vụ bạn đọc')
        self.T['h1'] = f('GIỚI THIỆU')
        self.T['h2'] = f('Kiến trúc tổng thể')
        self.T['h3'] = f('Định tuyến tại API Gateway')
        self.T['h4'] = f('Nhóm use case chung')
        self.T['capfig'] = f('Hình 4.1 Kiến trúc tổng thể')
        self.T['captab'] = f('Bảng 4.1 Bảng định tuyến')
        self.T['image'] = self.T['capfig'].getprevious()
        self.T['code'] = f('pnpm install --frozen-lockfile')
        self.T['appx'] = f('A.1. Yêu cầu')
        self.T['empty'] = self.table_after(self.T['captab']).getnext()
        for k, v in list(self.T.items()):
            self.T[k] = copy.deepcopy(v)

    # ---------- runs ----------
    def _run_template(self, p):
        for r in p.iter(q('w:r')):
            if r.find('w:t', ns) is not None:
                return r
        return None

    def set_text(self, p, text, template=None):
        """Replace the visible text of p; '**x**' marks bold segments. Bookmarks are kept."""
        src = template if template is not None else p
        rt = self._run_template(src)
        rpr = copy.deepcopy(rt.find('w:rPr', ns)) if rt is not None and rt.find('w:rPr', ns) is not None else None
        lead_bold = False
        if rpr is not None:
            b = rpr.find('w:b', ns)
            lead_bold = b is not None and b.get(q('w:val')) in ('1', 'true', None)
        if not lead_bold:
            text = text.replace('**', '')
        markers = '**' in text
        for child in list(p):
            if child.tag in (q('w:pPr'), q('w:bookmarkStart'), q('w:bookmarkEnd')):
                continue
            p.remove(child)
        parts = re.split(r'(\*\*.+?\*\*)', text)
        for part in parts:
            if not part:
                continue
            bold = part.startswith('**') and part.endswith('**')
            s = part[2:-2] if bold else part
            r = etree.SubElement(p, q('w:r'))
            if rpr is not None:
                rp = copy.deepcopy(rpr)
                for tag in (('w:b', 'w:bCs') if markers else ()):
                    el = rp.find(tag, ns)
                    if el is None:
                        el = etree.SubElement(rp, q(tag))
                    el.set(q('w:val'), '1' if bold else '0')
                r.append(rp)
            t = etree.SubElement(r, q('w:t'))
            t.text = s
            t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        return p

    def _bookmark(self, p, name=None):
        for b in p.findall('w:bookmarkStart', ns):
            p.remove(b)
        for b in p.findall('w:bookmarkEnd', ns):
            p.remove(b)
        self.bm_id += 1
        name = name or '_sb_%d' % self.bm_id
        bs = etree.Element(q('w:bookmarkStart'))
        bs.set(q('w:id'), str(self.bm_id)); bs.set(q('w:name'), name)
        be = etree.Element(q('w:bookmarkEnd'))
        be.set(q('w:id'), str(self.bm_id))
        ppr = p.find('w:pPr', ns)
        idx = 1 if ppr is not None else 0
        p.insert(idx, bs); p.insert(idx + 1, be)
        return name

    def new_par(self, kind, text=''):
        p = copy.deepcopy(self.T[kind])
        for b in p.findall('w:bookmarkStart', ns) + p.findall('w:bookmarkEnd', ns):
            p.remove(b)
        if kind == 'image':
            return p
        self.set_text(p, text)
        if kind == 'bullet' and '**' not in text:
            for rp in p.iter(q('w:rPr')):
                for tag in ('w:b', 'w:bCs'):
                    el = rp.find(tag, ns)
                    if el is not None:
                        el.set(q('w:val'), '0')
        if kind in ('h1', 'h2', 'h3', 'h4', 'capfig', 'captab'):
            self._bookmark(p)
        return p

    def add_after(self, ref, kind, text=''):
        p = self.new_par(kind, text)
        ref.addnext(p)
        return p

    def add_seq(self, ref, items):
        """items: list of (kind, text) or ('image', path) / ('table', spec). Returns last element."""
        cur = ref
        for it in items:
            kind = it[0]
            if kind == 'image':
                cur = self.add_image_after(cur, it[1], it[2] if len(it) > 2 else 15.5)
            elif kind == 'table':
                cur = self.add_table_after(cur, **it[1])
            else:
                cur = self.add_after(cur, kind, it[1])
        return cur

    def delete(self, e):
        e.getparent().remove(e)

    # ---------- images ----------
    def _add_media(self, path):
        self.rid_n += 1
        rid = 'rIdSB%d' % self.rid_n
        name = 'sb_%d%s' % (self.rid_n, os.path.splitext(path)[1].lower())
        self.new_media['word/media/' + name] = open(path, 'rb').read()
        rel = etree.SubElement(self.rels, '{%s}Relationship' % PR)
        rel.set('Id', rid)
        rel.set('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image')
        rel.set('Target', 'media/' + name)
        return rid, name

    def _size(self, path, width_cm, max_h_cm=21.0):
        im = Image.open(path)
        w, h = im.size
        wc = width_cm
        hc = wc * h / w
        if hc > max_h_cm:
            hc = max_h_cm
            wc = hc * w / h
        return int(wc * EMU_CM), int(hc * EMU_CM)

    def _set_drawing(self, p, path, width_cm):
        rid, name = self._add_media(path)
        cx, cy = self._size(path, width_cm)
        p.find('.//a:blip', ns).set(q('r:embed'), rid)
        for ext in p.iter(q('wp:extent')):
            ext.set('cx', str(cx)); ext.set('cy', str(cy))
        for ext in p.iter(q('a:ext')):
            if ext.get('cx') is not None:
                ext.set('cx', str(cx)); ext.set('cy', str(cy))
        self.docpr_id += 1
        for d in p.iter(q('wp:docPr')):
            d.set('id', str(self.docpr_id)); d.set('name', name)
        for c in p.iter('{http://schemas.openxmlformats.org/drawingml/2006/picture}cNvPr'):
            c.set('name', name)

    def add_image_after(self, ref, path, width_cm=15.5):
        p = self.new_par('image')
        self._set_drawing(p, path, width_cm)
        ref.addnext(p)
        return p

    def replace_image(self, caption_prefix, path, width_cm=15.5):
        cap = self.find(caption_prefix)
        img = cap.getprevious()
        assert img.find('.//a:blip', ns) is not None, caption_prefix
        self._set_drawing(img, path, width_cm)
        return cap

    # ---------- tables ----------
    def cell(self, tbl, r, c):
        rows = tbl.findall('w:tr', ns)
        cells = rows[r].findall('w:tc', ns)
        return cells[c]

    def set_cell(self, tc, text):
        ps = tc.findall('w:p', ns)
        for extra in ps[1:]:
            tc.remove(extra)
        tpl = None
        if self._run_template(ps[0]) is None:
            for other in tc.getparent().findall('w:tc', ns):
                for op in other.findall('w:p', ns):
                    if self._run_template(op) is not None:
                        tpl = op
                        break
                if tpl is not None:
                    break
        self.set_text(ps[0], text, template=tpl)

    def rows(self, tbl):
        return tbl.findall('w:tr', ns)

    def add_row(self, tbl, values, clone_index=-1, after_index=None):
        rows = self.rows(tbl)
        nr = copy.deepcopy(rows[clone_index])
        cells = nr.findall('w:tc', ns)
        for tc, v in zip(cells, values):
            self.set_cell(tc, v)
        if after_index is None:
            tbl.append(nr)
        else:
            rows[after_index].addnext(nr)
        return nr

    def set_row(self, tbl, r, values):
        for c, v in enumerate(values):
            if v is not None:
                self.set_cell(self.cell(tbl, r, c), v)

    def add_table_after(self, ref, template, rows):
        """template: an existing table element; rows[0] = header texts; data rows cloned from template row 1."""
        t = copy.deepcopy(template)
        trs = self.rows(t)
        for tr in trs[2:]:
            t.remove(tr)
        self.set_row(t, 0, rows[0])
        self.set_row(t, 1, rows[1])
        for vals in rows[2:]:
            self.add_row(t, vals, clone_index=1)
        ref.addnext(t)
        e = copy.deepcopy(self.T['empty'])
        t.addnext(e)
        return e

    # ---------- save ----------
    def save(self, out):
        tmp = out + '.tmp'
        with zipfile.ZipFile(self.src) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == 'word/document.xml':
                    zout.writestr(item, etree.tostring(self.root, xml_declaration=True, encoding='UTF-8', standalone=True))
                elif item.filename == 'word/_rels/document.xml.rels':
                    zout.writestr(item, etree.tostring(self.rels, xml_declaration=True, encoding='UTF-8', standalone=True))
                else:
                    zout.writestr(item, zin.read(item.filename))
            for name, data in self.new_media.items():
                zout.writestr(name, data)
        shutil.move(tmp, out)
