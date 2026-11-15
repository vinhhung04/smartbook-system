# -*- coding: utf-8 -*-
"""demo7 -> demo8: every sequence diagram switches to the black-and-white skin (PlantUML-like, as the
sequence figures of demo6). Only the images change: captions, sub-labels and figure numbers stay.

usage: python build8.py <demo7.docx> <demo8.docx> [pages.json]
Images: docs/diagrams/exports/png/sequence/*.png rendered with SEQ_SKIN=mono (the default of seqauto.py).
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from sbdoc import Doc, ns, text_of
import post

src, out = sys.argv[1], sys.argv[2]
pages = json.load(open(sys.argv[3], encoding='utf-8')) if len(sys.argv) > 3 and os.path.exists(sys.argv[3]) else {}
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SEQ = os.path.join(ROOT, 'docs', 'diagrams', 'exports', 'png', 'sequence')

d = Doc(src)
# demo7 used rIdSB9300-93xx, bookmarks 960000+, docPr 8300+
d.rid_n, d.bm_id, d.docpr_id = 9500, 970000, 8600


def parts(n, base):
    return [base] if n == 1 else [f'{base}-p{i}' for i in range(1, n + 1)]


FIGS = [
    ('Hình 2.2 Mẫu Transactional Outbox', parts(1, 'transactional-outbox-pattern-dd')),
    ('Hình 2.4 Vòng lặp gọi công cụ', parts(1, 'ai-tool-calling-loop-dd')),
    ('Hình 4.5 Sơ đồ tuần tự', parts(3, 'auth-login-email-otp-dd')),
    ('Hình 4.6 Sơ đồ tuần tự', parts(3, 'auth-register-email-otp-dd')),
    ('Hình 4.7 Sơ đồ tuần tự', parts(2, 'borrow-reservation-create-dd')),
    ('Hình 4.8 Sơ đồ tuần tự', parts(1, 'borrow-pickup-convert-dd')),
    ('Hình 4.9 Sơ đồ tuần tự', parts(1, 'borrow-loan-return-dd')),
    ('Hình 4.10 Sơ đồ tuần tự', parts(2, 'borrow-vnpay-fine-payment-dd')),
    ('Hình 4.11 Sơ đồ tuần tự', parts(3, 'inventory-purchase-order-dd')),
    ('Hình 4.12 Sơ đồ tuần tự', parts(1, 'inventory-goods-receipt-post-dd')),
    ('Hình 4.13 Sơ đồ tuần tự', parts(1, 'inventory-putaway-suggestion-dd')),
    ('Hình 4.14 Sơ đồ tuần tự', parts(2, 'inventory-packing-evidence-dd')),
    ('Hình 4.15 Sơ đồ tuần tự', parts(2, 'ai-metadata-cataloging-dd')),
    ('Hình 4.16 Sơ đồ tuần tự', parts(2, 'ai-book-ocr-multi-image-dd')),
    ('Hình 4.17 Sơ đồ tuần tự', parts(1, 'ai-find-book-by-cover-dd')),
    ('Hình 4.18 Sơ đồ tuần tự', parts(2, 'analytics-reorder-budget-dd')),
    ('Hình 4.19 Sơ đồ tuần tự', parts(3, 'ai-copilot-query-verification-dd')),
    ('Hình 4.20 Sơ đồ tuần tự', parts(1, 'ai-action-confirm-dd')),
    ('Hình 4.21 Sơ đồ tuần tự', parts(1, 'ai-nightly-briefing-dd')),
    ('Hình 4.22 Sơ đồ tuần tự', parts(1, 'borrow-due-reminder-dd')),
]


def figure_images(cap):
    """Image paragraphs of one figure, top to bottom: walk back over images and (a)/(b)/(c) labels."""
    imgs, p = [], cap.getprevious()
    while p is not None:
        if p.find('.//a:blip', ns) is not None:
            imgs.append(p)
        elif text_of(p).strip().startswith('(') and d.style(p) == cap_style:
            pass
        else:
            break
        p = p.getprevious()
    return imgs[::-1]


n_img = 0
for prefix, names in FIGS:
    cap = d.find(prefix)
    cap_style = d.style(cap)
    imgs = figure_images(cap)
    assert len(imgs) == len(names), (prefix, len(imgs), names)
    for img, name in zip(imgs, names):
        png = os.path.join(SEQ, name + '.png')
        assert os.path.exists(png), png
        d._set_drawing(img, png, 15.5)
        n_img += 1

caps, keymap, changed = post.renumber(d)
assert not changed, changed
post.keep_with_next(d)
ents = post.rebuild_lists(d, pages)
d.save(out)
json.dump([{k: e[k] for k in ('kind', 'anchor', 'parts', 'search')} for e in ents],
          open(os.path.join(os.path.dirname(__file__), 'entries8.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('figures', len(FIGS), 'images replaced', n_img, 'entries', len(ents))
