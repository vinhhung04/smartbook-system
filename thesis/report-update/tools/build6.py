# -*- coding: utf-8 -*-
"""demo5 -> demo6: replace the unreadable diagrams with the Diagram Design redraws and add the VNPay figure.

usage: python build6.py <demo5.docx> <demo6.docx> [pages.json]
Images come from docs/diagrams/exports/png/<type>/<name>-dd*.png (see docs/diagrams/designed/README.md).
"""
import sys, os, json, copy
sys.path.insert(0, os.path.dirname(__file__))
from sbdoc import Doc, ns, q, text_of
from lxml import etree
import post

src, out = sys.argv[1], sys.argv[2]
pages = json.load(open(sys.argv[3], encoding='utf-8')) if len(sys.argv) > 3 and os.path.exists(sys.argv[3]) else {}
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PNG = os.path.join(ROOT, 'docs', 'diagrams', 'exports', 'png')

d = Doc(src)
# demo5 already uses rIdSB9001-9032 / sb_9001-9032 media, bookmarks up to 900034, docPr 5001-5032
d.rid_n, d.bm_id, d.docpr_id = 9100, 950000, 8000


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


def split(cap_prefix, kind, parts, caption):
    """parts: [(png name, label text)]. First part replaces the existing image."""
    cap = d.find(cap_prefix)
    img = cap.getprevious()
    assert img.find('.//a:blip', ns) is not None, cap_prefix
    d._set_drawing(img, png(kind, parts[0][0]), 15.5)
    cur = img
    for i, (name, lab) in enumerate(parts):
        if i > 0:
            cur = d.add_image_after(cur, png(kind, name), 15.5)
        lp = label(lab)
        cur.addnext(lp)
        cur = lp
    d.set_text(cap, caption)


def single(cap_prefix, kind, name):
    d.replace_image(cap_prefix, png(kind, name), 15.5)


A, S, E = 'architecture', 'sequence', 'erd'
single('Hình 4.1 Kiến trúc tổng thể', A, 'architecture-system-overview-dd')
single('Hình 4.2 Sơ đồ triển khai', A, 'deployment-production-dd')
split('Hình 4.5 Sơ đồ tuần tự đăng nhập', S, [
    ('auth-login-email-otp-dd-p1', '(a) Kiểm tra mật khẩu'),
    ('auth-login-email-otp-dd-p2', '(b) Gửi và nhập mã OTP'),
    ('auth-login-email-otp-dd-p3', '(c) Cấp phiên')],
    'Hình 4.5 Sơ đồ tuần tự đăng nhập, OTP hai lớp và kiểm tra quyền: (a) kiểm tra mật khẩu; (b) gửi và nhập mã OTP; (c) cấp phiên')
split('Hình 4.6 Sơ đồ tuần tự đăng ký', S, [
    ('auth-register-email-otp-dd-p1', '(a) Đăng ký và gửi mã'),
    ('auth-register-email-otp-dd-p2', '(b) Gửi lại mã'),
    ('auth-register-email-otp-dd-p3', '(c) Xác minh mã')],
    'Hình 4.6 Sơ đồ tuần tự đăng ký tài khoản và xác thực email bằng OTP: (a) đăng ký và gửi mã; (b) gửi lại mã; (c) xác minh mã')
split('Hình 4.15 Sơ đồ tuần tự nhập sách bằng OCR', S, [
    ('ai-book-ocr-multi-image-dd-p1', '(a) Kiểm tra quyền và đọc ảnh'),
    ('ai-book-ocr-multi-image-dd-p2', '(b) Đối chiếu, duyệt và lưu')],
    'Hình 4.15 Sơ đồ tuần tự nhập sách bằng OCR nhiều ảnh: (a) kiểm tra quyền và đọc ảnh; (b) đối chiếu, duyệt và lưu')
split('Hình 4.17 Sơ đồ tuần tự đề xuất nhập hàng', S, [
    ('analytics-reorder-budget-dd-p1', '(a) Yêu cầu và phạm vi kho'),
    ('analytics-reorder-budget-dd-p2', '(b) Dự báo và phân bổ ngân sách')],
    'Hình 4.17 Sơ đồ tuần tự đề xuất nhập hàng và phân bổ ngân sách: (a) yêu cầu và phạm vi kho; (b) dự báo và phân bổ ngân sách')
split('Hình 4.18 Sơ đồ tuần tự Trợ lý AI', S, [
    ('ai-copilot-query-verification-dd-p1', '(a) Kiểm tra vai trò và lập kế hoạch'),
    ('ai-copilot-query-verification-dd-p2', '(b) Bằng chứng, câu trả lời và kiểm chứng'),
    ('ai-copilot-query-verification-dd-p3', '(c) Lưu hội thoại và trả kết quả')],
    'Hình 4.18 Sơ đồ tuần tự Trợ lý AI: (a) kiểm tra vai trò và lập kế hoạch; (b) bằng chứng, câu trả lời và kiểm chứng; (c) lưu hội thoại và trả kết quả')
split('Hình 4.22 ERD auth_db', E, [
    ('auth-service-iam-dd-p1', '(a) Tài khoản, vai trò, quyền và phạm vi kho'),
    ('auth-service-iam-dd-p2', '(b) Token và mã OTP')],
    'Hình 4.22 ERD auth_db: (a) tài khoản, vai trò, quyền và phạm vi kho; (b) token và mã OTP')
single('Hình 5.1 Kiến trúc xử lý của Trợ lý AI', A, 'ai-copilot-pipeline-dd')
single('Hình 6.1 Quy trình CI/CD', A, 'deploy-ci-cd-pipeline-dd')

# ---- new figure: VNPay (section 4.4 "Thanh toán phí phạt qua VNPay" had no diagram)
vn = d.find('Thanh toán phí phạt qua VNPay').getnext()
assert text_of(vn).startswith('Bạn đọc thanh toán phí phạt trực tuyến qua cổng VNPay'), text_of(vn)[:60]
intro = d.add_after(vn, 'body', 'Hình {FIG:vnpay} mô tả luồng này: phần (a) tạo liên kết thanh toán, phần (b) xác nhận kết quả song song qua Return URL của trình duyệt và IPN của máy chủ VNPay; cả hai đường đều đi qua API Gateway và dùng chung hàm hoàn tất có khóa để không ghi nhận trùng.')
img_a = d.add_image_after(intro, png(S, 'borrow-vnpay-fine-payment-dd-p1'), 15.5)
la = label('(a) Tạo liên kết thanh toán'); img_a.addnext(la)
img_b = d.add_image_after(la, png(S, 'borrow-vnpay-fine-payment-dd-p2'), 15.5)
lb = label('(b) Xác nhận qua Return URL và IPN'); img_b.addnext(lb)
d.add_after(lb, 'capfig', 'Hình {FIG:vnpay} Sơ đồ tuần tự thanh toán phí phạt qua VNPay: (a) tạo liên kết thanh toán; (b) xác nhận qua Return URL và IPN')

caps, keymap, changed = post.renumber(d)
print('keepNext set', post.keep_with_next(d))
ents = post.rebuild_lists(d, pages)
d.save(out)
json.dump([{k: e[k] for k in ('kind', 'anchor', 'parts', 'search')} for e in ents],
          open(os.path.join(os.path.dirname(__file__), 'entries6.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('captions', len(caps), 'new keys', keymap)
print('renumbered', len(changed), dict(list(changed.items())[:8]))
print('entries', len(ents))
