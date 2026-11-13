# -*- coding: utf-8 -*-
"""demo6 -> demo7: every remaining PlantUML/Mermaid image is replaced by its Diagram Design redraw
(SmartBook profile) so all diagrams in the report share one drawing style. Figure numbers do not change;
figures that had to be split get (a)/(b)/(c) sub-labels and the parts are listed in the caption.

usage: python build7.py <demo6.docx> <demo7.docx> [pages.json]
Images come from docs/diagrams/exports/png/<type>/<name>.png (built by scripts/diagrams/diagram-design/build.sh).
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from sbdoc import Doc, ns, q, text_of
from lxml import etree
import post

src, out = sys.argv[1], sys.argv[2]
pages = json.load(open(sys.argv[3], encoding='utf-8')) if len(sys.argv) > 3 and os.path.exists(sys.argv[3]) else {}
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PNG = os.path.join(ROOT, 'docs', 'diagrams', 'exports', 'png')

d = Doc(src)
# demo6 already uses rIdSB9001-9032 and 9101-91xx, bookmarks up to ~950100, docPr up to ~8030
d.rid_n, d.bm_id, d.docpr_id = 9300, 960000, 8300
FULL = 15.5


def png(kind, name):
    p = os.path.join(PNG, kind, name + '.png')
    assert os.path.exists(p), p
    return p


def label(text):
    """Centered sub-figure label in the caption's formatting, no bookmark, kept with what follows."""
    p = d.new_par('capfig', text)
    for b in p.findall('w:bookmarkStart', ns) + p.findall('w:bookmarkEnd', ns):
        p.remove(b)
    ppr = p.find('w:pPr', ns)
    if ppr.find('w:keepNext', ns) is None:
        kn = etree.Element(q('w:keepNext'))
        ppr.insert(1 if ppr.find('w:pStyle', ns) is not None else 0, kn)
    return p


def cap(prefix):
    c = d.find(prefix)
    img = c.getprevious()
    assert img is not None and img.find('.//a:blip', ns) is not None, prefix
    return c, img


def single(prefix, kind, name, width=FULL):
    c, img = cap(prefix)
    d._set_drawing(img, png(kind, name), width)


def split(prefix, kind, parts):
    """parts: [(png name, label)]; the caption gets ': (a) ...; (b) ...' appended."""
    c, img = cap(prefix)
    d._set_drawing(img, png(kind, parts[0][0]), FULL)
    cur = img
    for i, (name, lab) in enumerate(parts):
        if i > 0:
            cur = d.add_image_after(cur, png(kind, name), FULL)
        letter = '(' + 'abcdef'[i] + ') '
        lp = label(letter + lab)
        cur.addnext(lp)
        cur = lp
    base = text_of(c).strip()
    d.set_text(c, base + ': ' + '; '.join('(' + 'abcdef'[i] + ') ' + lab[0].lower() + lab[1:] for i, (_, lab) in enumerate(parts)))


A, S, E, U, AC = 'architecture', 'sequence', 'erd', 'use-case', 'activity'
# ---- chapters 1-2
single('Hình 1.1 Tổng quan các phân hệ', A, 'overview-subsystems-actors-dd')
single('Hình 2.1 Mô hình kiến trúc microservices', A, 'microservices-gateway-pattern-dd')
single('Hình 2.2 Mẫu Transactional Outbox', S, 'transactional-outbox-pattern-dd')
single('Hình 2.3 Ba thành phần của hệ hỗ trợ', A, 'dss-components-mapping-dd')
single('Hình 2.4 Vòng lặp gọi công cụ', S, 'ai-tool-calling-loop-dd')
single('Hình 2.5 Quy trình truy xuất lai', AC, 'hybrid-retrieval-confidence-dd', 12.4)
single('Hình 2.6 Quy trình hợp nhất bằng chứng', AC, 'metadata-evidence-fusion-dd', 10.9)
# ---- chapter 3: activity and use case diagrams
single('Hình 3.1 Sơ đồ hoạt động', AC, 'activity-borrow-reservation-dd')
single('Hình 3.2 Sơ đồ hoạt động', AC, 'activity-purchase-receiving-dd')
single('Hình 3.3 Sơ đồ hoạt động', AC, 'activity-ai-cataloging-dd')
single('Hình 3.4 Sơ đồ hoạt động', AC, 'activity-ai-decision-support-dd')
single('Hình 3.5 Sơ đồ use case', U, 'usecase-overview-dd')
single('Hình 3.6 Sơ đồ use case', U, 'usecase-customer-dd')
single('Hình 3.7 Sơ đồ use case', U, 'usecase-librarian-dd')
single('Hình 3.8 Sơ đồ use case', U, 'usecase-warehouse-staff-dd')
single('Hình 3.9 Sơ đồ use case', U, 'usecase-warehouse-manager-dd')
single('Hình 3.10 Sơ đồ use case', U, 'usecase-ai-dd')
single('Hình 3.11 Sơ đồ use case', U, 'usecase-admin-scheduler-dd')
single('Hình 3.12 Sơ đồ use case', U, 'usecase-supplier-dd', 13.0)
# ---- chapter 4: domain models
split('Hình 4.3 Mô hình miền', A, [('domain-catalog-warehouse-dd-p1', 'Mua hàng và nhận hàng'),
                                   ('domain-catalog-warehouse-dd-p2', 'Kho và tồn kho'),
                                   ('domain-catalog-warehouse-dd-p3', 'Danh mục sách và xuất kho')])
split('Hình 4.4 Mô hình miền', A, [('domain-users-circulation-ai-dd-p1', 'Người dùng, quyền và AI'),
                                   ('domain-users-circulation-ai-dd-p2', 'Lưu thông của bạn đọc')])
# ---- chapter 4: sequences
split('Hình 4.7 Sơ đồ tuần tự đặt giữ', S, [('borrow-reservation-create-dd-p1', 'Bước 1–5: gửi yêu cầu, kiểm tra hội viên và giới hạn'),
                                            ('borrow-reservation-create-dd-p2', 'Bước 6–13: giữ tồn và ghi phiếu đặt giữ')])
single('Hình 4.8 Sơ đồ tuần tự nhận sách', S, 'borrow-pickup-convert-dd')
single('Hình 4.9 Sơ đồ tuần tự trả sách', S, 'borrow-loan-return-dd')
split('Hình 4.11 Sơ đồ tuần tự lập', S, [('inventory-purchase-order-dd-p1', 'Bước 1–11: lập, trình duyệt và duyệt đơn'),
                                        ('inventory-purchase-order-dd-p2', 'Bước 12–15: gửi đơn và phát sự kiện outbox'),
                                        ('inventory-purchase-order-dd-p3', 'Bước 16–18: nhà cung cấp xác nhận đơn')])
single('Hình 4.12 Sơ đồ tuần tự nhận hàng', S, 'inventory-goods-receipt-post-dd')
single('Hình 4.13 Sơ đồ tuần tự xếp kệ', S, 'inventory-putaway-suggestion-dd')
split('Hình 4.14 Sơ đồ tuần tự đóng gói', S, [('inventory-packing-evidence-dd-p1', 'Bước 1–12: quét và thu bằng chứng hình ảnh'),
                                              ('inventory-packing-evidence-dd-p2', 'Bước 13–16: hoàn tất đóng gói')])
split('Hình 4.15 Sơ đồ tuần tự biên mục', S, [('ai-metadata-cataloging-dd-p1', 'Bước 1–10: thu thập và hợp nhất metadata'),
                                              ('ai-metadata-cataloging-dd-p2', 'Bước 11–17: duyệt và áp dụng bản nháp')])
single('Hình 4.17 Sơ đồ tuần tự tìm sách', S, 'ai-find-book-by-cover-dd')
single('Hình 4.20 Sơ đồ tuần tự xác nhận', S, 'ai-action-confirm-dd')
single('Hình 4.21 Sơ đồ tuần tự bản tin', S, 'ai-nightly-briefing-dd')
single('Hình 4.22 Sơ đồ tuần tự nhắc hạn', S, 'borrow-due-reminder-dd')
# ---- chapter 4: ERDs
single('Hình 4.24 ERD auth_db', E, 'auth-token-audit-dd')
split('Hình 4.25 ERD inventory_db', E, [('inventory-catalog-dd-p1', 'Sách, ấn bản và nhà xuất bản'),
                                       ('inventory-catalog-dd-p2', 'Tác giả, thể loại và bảng nối')])
single('Hình 4.26 ERD inventory_db', E, 'inventory-metadata-dd')
split('Hình 4.27 ERD inventory_db', E, [('inventory-stock-dd-p1', 'Kho, vị trí và tồn theo vị trí'),
                                       ('inventory-stock-dd-p2', 'Đơn vị tồn, giữ tồn và biến động')])
single('Hình 4.28 ERD inventory_db', E, 'inventory-audit-task-dd')
split('Hình 4.29 ERD inventory_db', E, [('inventory-purchasing-dd-p1', 'Yêu cầu mua và đơn đặt hàng'),
                                       ('inventory-purchasing-dd-p2', 'Nhà cung cấp và ấn bản cung cấp')])
split('Hình 4.30 ERD inventory_db', E, [('inventory-receiving-dd-p1', 'Hóa đơn giao hàng và phiếu nhập'),
                                       ('inventory-receiving-dd-p2', 'Báo cáo thiếu hàng'),
                                       ('inventory-receiving-dd-p3', 'Bản nháp nhận hàng thông minh')])
split('Hình 4.31 ERD inventory_db', E, [('inventory-outbound-dd-p1', 'Đơn xuất kho và lấy hàng'),
                                       ('inventory-outbound-dd-p2', 'Đóng gói và bằng chứng hình ảnh')])
single('Hình 4.32 ERD inventory_db', E, 'inventory-transfer-dd')
single('Hình 4.33 ERD borrow_db', E, 'borrow-circulation-dd')
single('Hình 4.34 ERD borrow_db', E, 'borrow-fines-payments-dd')
single('Hình 4.35 ERD borrow_db', E, 'borrow-notifications-dd')
single('Hình 4.36 ERD ai_db', E, 'ai-db-dd')

caps, keymap, changed = post.renumber(d)
assert not changed, changed            # numbering must stay as in demo6
print('keepNext set', post.keep_with_next(d))
ents = post.rebuild_lists(d, pages)
d.save(out)
json.dump([{k: e[k] for k in ('kind', 'anchor', 'parts', 'search')} for e in ents],
          open(os.path.join(os.path.dirname(__file__), 'entries7.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('captions', len(caps), 'entries', len(ents))
