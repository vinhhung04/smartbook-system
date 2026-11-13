"""Annotator decisions (single annotator, visual review of contact sheets on
2026-11-12) written out as manifest/manual_annotations.csv. Kept as code so
every decision is reviewable in one place; the CSV is the artefact the
pipeline reads. Visual notes collected during review are in visual_notes.txt
(same folder).

Run: python reports/annotation_decisions.py   (from the dataset root)
"""
import collections
import csv
import hashlib
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "manifest") + os.sep
sel = {r["asset_id"]: r for r in csv.DictReader(open(D + "selection.csv", encoding="utf-8"))}
rows = {}


def put(aid, **kw):
    r = rows.setdefault(aid, {"asset_id": aid})
    r.update({k: v for k, v in kw.items() if v is not None})


# ---- visual notes taken while reviewing contact sheets
for line in open(os.path.join(ROOT, "reports", "visual_notes.txt"), encoding="utf-8"):
    if line.startswith("#") or not line.strip():
        continue
    aid, dec, cond, tv, note = line.rstrip("\n").split("|", 4)
    d = {"image_condition": cond, "title_visible": tv, "note": note}
    if dec.startswith("exclude:"):
        d.update(decision="exclude", exclusion_reason=dec.split(":", 1)[1])
    elif dec == "gallery":
        d.update(decision="gallery")
    elif dec.startswith("query_independent:"):
        _, rel, parent = dec.split(":")
        d.update(decision="query_independent", relation_to_gallery=rel, parent=parent)
    put(aid, **d)

# ---- EN gallery: printed text wins over the Wikidata label
put("G-EN-0077", title="The Roly-Poly Pudding", note="title as printed on the 1908 first edition; Wikidata label is the later title")
put("G-EN-0087", title="An Authentic Life of Billy the Kid, the Noted Desperado of the Southwest", author="Pat F. Garrett",
    note="printed title/author; Wikidata also lists a ghostwriter")
put("G-EN-0065", title="Fil and Filippa")
put("G-EN-0062", title="A Month in Honolulu", note='CONFLICT: printed "A Month in Honolulu" vs Wikidata "Diary of One Month in Honolulu"; printed used')
put("G-EN-0054", author="Šárka B. Hrbková", note="editor as printed; Wikidata lists 10 contributing authors")
put("G-EN-0031", author="Pierre Coalfleet; Frank Cyril Shaw Davison", note="printed pseudonym + Wikidata author")
put("G-EN-0099", title="Afloat and Ashore", title_visible="no", note="title only on the spine; front board is marbled")
put("G-EN-0100", decision="exclude", exclusion_reason="IDENTITY_MISMATCH",
    note="image shows the binding of the annual 'The Gift' (1842), not a cover of 'The Pit and the Pendulum' (Wikidata item)")
put("G-EN-0104", decision="exclude", exclusion_reason="NOT_FRONT_COVER_TITLE_PAGE")
put("G-EN-0106", decision="exclude", exclusion_reason="NOT_FRONT_COVER_TITLE_PAGE")
put("G-EN-0105", title_visible="partial", note="small stamped title")
put("G-EN-0102", image_condition="photo")

# ---- out-of-catalog exclusions
put("O-EN-0004", decision="exclude", exclusion_reason="NOT_FRONT_COVER_TITLE_PAGE")
put("O-EN-0027", decision="exclude", exclusion_reason="NOT_FRONT_COVER_TITLE_PAGE")

# ---- Track A (independent files)
SAME, DIFF = "same_edition_independent_image", "different_cover_same_work"
ta = {
    "Q-EN-0001": ("G-EN-0009", SAME, "low_resolution"), "Q-EN-0002": ("G-EN-0049", SAME, "scan"),
    "Q-EN-0005": ("G-EN-0083", DIFF, "scan"), "Q-EN-0006": ("G-EN-0038", SAME, "scan"),
    "Q-EN-0007": ("G-EN-0110", SAME, "low_resolution"), "Q-EN-0013": ("G-EN-0034", DIFF, "scan"),
    "Q-EN-0014": ("G-EN-0035", SAME, "scan"), "Q-EN-0015": ("G-EN-0041", DIFF, "low_resolution"),
    "Q-EN-0016": ("G-EN-0042", SAME, "scan"), "Q-EN-0017": ("G-EN-0042", SAME, "scan"),
    "Q-EN-0019": ("G-EN-0051", SAME, "scan"), "Q-EN-0020": ("G-EN-0052", DIFF, "scan"),
    "Q-EN-0022": ("G-EN-0055", SAME, "scan"), "Q-EN-0023": ("G-EN-0059", SAME, "scan"),
    "Q-EN-0024": ("G-EN-0066", SAME, "scan"), "Q-EN-0025": ("G-EN-0072", DIFF, "scan"),
    "Q-EN-0026": ("G-EN-0073", SAME, "scan"), "Q-EN-0027": ("G-EN-0078", SAME, "scan"),
    "Q-EN-0028": ("G-EN-0078", SAME, "scan"), "Q-EN-0029": ("G-EN-0080", DIFF, "scan"),
    "Q-EN-0032": ("G-EN-0091", SAME, "photo"), "Q-EN-0033": ("G-EN-0091", DIFF, "scan"),
    "Q-EN-0034": ("G-EN-0096", SAME, "scan"), "Q-EN-0035": ("G-EN-0102", DIFF, "scan"),
    "Q-EN-0036": ("G-EN-0102", SAME, "scan"), "Q-EN-0037": ("G-EN-0102", SAME, "photo"),
    "Q-EN-0038": ("G-EN-0102", DIFF, "scan"), "Q-EN-0039": ("G-EN-0109", SAME, "scan"),
    "Q-EN-0040": ("C-EN-EN002", SAME, "scan"), "Q-EN-0041": ("C-EN-EN002", DIFF, "photo"),
    "Q-EN-0042": ("C-EN-EN005", SAME, "photo"), "Q-EN-0043": ("C-EN-EN006", DIFF, "scan"),
    "Q-EN-0044": ("C-EN-EN007", SAME, "scan"), "C-EN-EN004": ("G-EN-0102", DIFF, "scan"),
    "C-MD-0004": ("C-MD-0003", DIFF, "scan"), "C-VN-0064": ("C-VN-0063", SAME, "photo_angled"),
}
title_vis = {"C-MD-0004": "no", "C-VN-0064": "partial", "Q-EN-0007": "partial"}
for q, (p, rel, cond) in ta.items():
    put(q, decision="query_independent", relation_to_gallery=rel, parent=p, image_condition=cond,
        title_visible=title_vis.get(q, "yes"),
        note=f"independent file of {'the same edition cover' if rel == SAME else 'a different cover of the same work'} as {p}")
for q, reason in [
    ("Q-EN-0003", "NOT_INDEPENDENT_SAME_SCAN_AS_GALLERY (pHash 8; gallery file is a retouch of this scan)"),
    ("Q-EN-0004", "NOT_INDEPENDENT_SAME_SCAN_AS_GALLERY (pHash 4; gallery file is a retouch of this scan)"),
    ("Q-EN-0009", "NOT_INDEPENDENT_SAME_SCAN_AS_GALLERY (pHash 2)"),
    ("Q-EN-0008", "NOT_FRONT_COVER_TITLE_PAGE"), ("Q-EN-0021", "NOT_FRONT_COVER_TITLE_PAGE"),
    ("Q-EN-0010", "NOT_FULL_COVER_LETTERING_FRAGMENT"), ("Q-EN-0011", "NOT_FULL_COVER_ILLUSTRATION_CUTOUT"),
    ("Q-EN-0031", "NOT_FULL_COVER_ILLUSTRATION_CUTOUT"), ("Q-EN-0012", "TRANSLATION_NOT_IN_CATALOG (German edition)"),
    ("Q-EN-0018", "FULL_WRAP_FRONT_SPINE_BACK"), ("Q-EN-0030", "FULL_WRAP_FRONT_SPINE_BACK"),
    ("C-MD-0002", "FULL_WRAP_FRONT_SPINE_BACK"), ("C-MD-0006", "FULL_WRAP_FRONT_SPINE_BACK"),
]:
    put(q, decision="exclude", exclusion_reason=reason)

# ---- seed v0.1 international records (metadata re-checked against the cover)
seedmeta = {
    "C-EN-EN001": ("Alice's Adventures in Wonderland", "Lewis Carroll", "1865"),
    "C-EN-EN002": ("The Jungle Book", "Rudyard Kipling", "1894"),
    "C-EN-EN003": ("The Wonderful Wizard of Oz", "L. Frank Baum", "1900"),
    "C-EN-EN005": ("Pride and Prejudice", "Jane Austen", "1894"),
    "C-EN-EN006": ("Little Women", "Louisa May Alcott", "1869"),
    "C-EN-EN007": ("Anne of Green Gables", "Lucy Maud Montgomery", "1908"),
    "C-EN-EN008": ("The Wind in the Willows", "Kenneth Grahame", "1908"),
}
for a, (t, au, y) in seedmeta.items():
    put(a, decision="gallery", title=t, author=au, edition_year=y, image_condition="scan", title_visible="yes",
        note="seed v0.1 record; title/author re-checked against the cover")
put("C-EN-EN001", title_visible="no", note="seed EN001; cloth cover shows a gilt medallion only, no title")
put("C-EN-EN004", title="Dracula", author="Bram Stoker",
    note="seed EN004 is a grey cloth binding with a title label, not the 1897 yellow first edition; used as a different-cover query for G-EN-0102")

# ---- post-1930 US covers
md = {
    "C-MD-0001": ("Carrie", "Stephen King", "", "1974", "UNKNOWN"),
    "C-MD-0003": ("Jaws", "Peter Benchley", "", "1974", "UNKNOWN"),
    "C-MD-0005": ("Midnight Cowboy", "James Leo Herlihy", "", "1965", "NOT_ASSIGNED_PRE_ISBN"),
    "C-MD-0007": ("Rosemary's Baby", "Ira Levin", "", "1967", "NOT_ASSIGNED_PRE_ISBN"),
    "C-MD-0010": ("Gone with the Wind", "Margaret Mitchell", "", "1936", "NOT_ASSIGNED_PRE_ISBN"),
    "C-MD-0011": ("To Kill a Mockingbird", "Harper Lee", "Lippincott", "1960", "NOT_ASSIGNED_PRE_ISBN"),
    "C-MD-0012": ("The Catcher in the Rye", "J. D. Salinger", "Little, Brown", "1951", "NOT_ASSIGNED_PRE_ISBN"),
}
for a, (t, au, pub, y, isb) in md.items():
    put(a, decision="gallery", title=t, author=au, publisher=pub, edition_year=y, work_year=y, isbn_status=isb,
        image_condition="scan", title_visible="yes", note="title/author as printed; year from the Commons file title")
put("C-MD-0004", title="Jaws", author="Peter Benchley", note="1975 paperback cover art without printed title")

# ---- Vietnamese metadata (file-page description + printed text; seed v0.1 for VN001-VN008)
vn = {
    "C-VN-0001": ("Số đỏ", "Vũ Trọng Phụng", "Lê Cường", "1938"), "C-VN-0002": ("Gia Long tẩu quốc", "Tân Dân Tử", "Bảo Tồn", ""),
    "C-VN-0003": ("Việt Nam sử lược", "Trần Trọng Kim", "Trung Bắc Tân Văn", "1920"),
    "C-VN-0004": ("Lịch sử nước ta", "Hồ Chí Minh", "Việt Minh Tuyên truyền Bộ", "1942"),
    "C-VN-0006": ("Thề non nước", "Tản Đà", "Hương Sơn", "1940"), "C-VN-0007": ("Nam ngạn chích cẩm", "Phạm Quang Sán", "", "1918"),
    "C-VN-0008": ("Phan Trần truyện", "", "", "1902"),
    "C-VN-0009": ("Biệt Động Quân, Quân lực Việt Nam Cộng hòa", "", "", ""),
    "C-VN-0010": ("Bí ẩn của những điềm chiêm bao", "Nguyễn Trí Hiếu", "", ""), "C-VN-0011": ("Cách đánh B-52", "", "", ""),
    "C-VN-0012": ("Chí Phèo", "Nam Cao", "Văn Nghệ", "1957"),
    "C-VN-0014": ("Đảng Công-Nông Việt-Nam: Tuyên ngôn, chính cương và điều lệ", "", "", ""),
    "C-VN-0015": ("Quảng Thuận đạo sử tập", "Nguyễn Huy Quýnh", "", ""),
    "C-VN-0016": ("Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn", "Bùi Minh Đường", "Imprimerie de l'Union", "1913"),
    "C-VN-0017": ("Lịch triều hiến chương loại chí", "Phan Huy Chú", "", "1957"),
    "C-VN-0018": ("Lịch triều hiến chương loại chí", "Phan Huy Chú", "", "1972"),
    "C-VN-0019": ("Nam Kỳ lục tỉnh địa dư chí", "", "", ""), "C-VN-0020": ("Tiên Nguyên loát yếu phổ (tiền biên)", "Tôn Thất Hân", "", ""),
    "C-VN-0021": ("Trung tiết anh hùng – Lịch sử ông Võ Tánh", "", "Tín Đức Thư Xã", "1930"),
    "C-VN-0022": ("Thiên hồ Đế hồ", "Phan Bội Châu", "", ""), "C-VN-0023": ("Đại Nam quốc ngữ", "", "", ""),
    "C-VN-0024": ("Lá vàng tình thơ", "Hà Tôn Thanh Hằng", "", ""),
    "C-VN-0026": ("Sự thật về quan hệ Việt Nam – Trung Quốc trong 30 năm qua", "", "Sự Thật", ""),
    "C-VN-0027": ("Huỳnh Thúc Kháng tự truyện", "Huỳnh Thúc Kháng", "Anh Minh", "1963"),
    "C-VN-0028": ("Dagestan của tôi", "Rasul Gamzatov", "Kim Đồng", ""), "C-VN-0029": ("Công giáo trên bờ vực thẳm", "Charlie Nguyễn", "", ""),
    "C-VN-0030": ("Công giáo huyền thoại và tội ác", "Charlie Nguyễn", "Giao Điểm", "2001"),
    "C-VN-0031": ("Cành hoa điểm tuyết", "Đặng Trần Phất", "", ""),
    "C-VN-0036": ("Những kinh nghiệm tiên tiến của nền giáo dục xã hội chủ nghĩa ở Cộng hòa Dân chủ Đức", "Nguyễn Văn Huyên; Nguyễn Sĩ Tỷ", "Giáo Dục", "1962"),
    "C-VN-0037": ("Tìm hiểu học thuyết Páp-lốp áp dụng vào giáo dục", "Nguyễn Sĩ Tỷ", "Giáo Dục", "1960"),
    "C-VN-0038": ("Vấn đề cải cách giáo dục ở Liên Xô", "Nguyễn Văn Huyên; Nguyễn Sĩ Tỷ", "Giáo Dục", "1962"),
    "C-VN-0039": ("Thi kinh giải âm", "", "", "1714"), "C-VN-0040": ("Những tìm sâu triết học", "Ludwig Wittgenstein", "", ""),
    "C-VN-0041": ("Giải mã điện mặt trời", "Nguyễn Hồng Phúc", "Khoa học và Kỹ thuật", ""),
    "C-VN-0042": ("Nàng mèo", "Colette", "Phụ Nữ", "2007"), "C-VN-0043": ("Thiên Nam dư hạ tập", "", "", ""),
    "C-VN-0044": ("Tôi là ai – và nếu vậy thì bao nhiêu?", "Richard David Precht", "", ""),
    "C-VN-0045": ("Đất rừng phương Nam", "Đoàn Giỏi", "Kim Đồng", "1975"), "C-VN-0046": ("Kinh tế phi nhân lực", "Hồ Hữu Lực", "", ""),
    "C-VN-0048": ("Trước giờ tổng khởi nghĩa", "Trần Quảng Vận", "Hội Văn hóa Cứu quốc", "1946"),
    "C-VN-0052": ("Người trong bóng tối", "Paul Auster", "", ""),
    "C-VN-0054": ("Hoàng tử Cảnh như Tây (Quyển 1)", "Tân Dân Tử", "", ""), "C-VN-0055": ("Hoàng tử Cảnh như Tây (Quyển 2)", "Tân Dân Tử", "", ""),
    "C-VN-0056": ("Gia Long phục quốc", "Tân Dân Tử", "", ""),
    "C-VN-0059": ("Chương trình quản lý kế toán MISA – Tài liệu hướng dẫn sử dụng", "MISA Group", "", "1995"),
    "C-VN-0063": ("Đường kách mệnh", "Nguyễn Ái Quốc", "", ""), "C-VN-0064": ("Đường kách mệnh", "Nguyễn Ái Quốc", "", ""),
    "C-VN-0065": ("Le Procès de la Colonisation Française", "Nguyễn Ái Quốc", "Librairie du Travail", ""),
    "C-VN-0069": ("Ấu học ngũ ngôn thi", "", "", "1863"), "C-VN-0070": ("Thực phổ bách thiên", "Trương Thị Bích", "", "1915"),
    "C-VN-0071": ("Đại Nam thực lục chính biên đệ nhị kỷ", "", "", ""),
}
han = {"C-VN-0008", "C-VN-0015", "C-VN-0019", "C-VN-0022", "C-VN-0023", "C-VN-0039", "C-VN-0043", "C-VN-0069", "C-VN-0071"}
for a, (t, au, pub, y) in vn.items():
    put(a, title=t, author=au, publisher=pub, edition_year=y, script="Han-Nom" if a in han else "Latin")
put("C-VN-0063", decision="gallery", image_condition="scan", title_visible="yes", note="cover of a copy with an owner inscription")
put("C-VN-0059", decision="gallery", image_condition="scan", title_visible="yes")
put("C-VN-0065", decision="gallery", image_condition="photo", title_visible="yes", language="fr",
    note="French-language book by a Vietnamese author; counted as INTERNATIONAL (title language)")
put("C-VN-0069", decision="gallery", image_condition="scan", title_visible="no", note="title in Han characters only")
put("C-VN-0070", decision="gallery", image_condition="low_resolution", title_visible="yes")
put("C-VN-0071", decision="gallery", image_condition="scan", title_visible="no", note="title in Han characters only")
for a, reason in [("C-VN-0057", "NOT_FRONT_COVER_INTERIOR_ILLUSTRATION"), ("C-VN-0058", "FULL_WRAP_FRONT_SPINE_BACK"),
                  ("C-VN-0060", "FULL_WRAP_FRONT_SPINE_BACK"), ("C-VN-0061", "FULL_WRAP_FRONT_SPINE_BACK"),
                  ("C-VN-0062", "FULL_WRAP_FRONT_SPINE_BACK"), ("C-VN-0066", "FULL_WRAP_FRONT_SPINE_BACK"),
                  ("C-VN-0067", "COMPOSITE_SEVERAL_PRINTS"), ("C-VN-0068", "NOT_FRONT_COVER_TEXT_PAGE"),
                  ("C-VN-0072", "NOT_A_BOOK_COVER_MAP")]:
    put(a, decision="exclude", exclusion_reason=reason)


# ---- book keys: a query points at its parent's key; gallery keyed by Wikidata QID or own asset id
def key_of(a):
    return sel[a]["wikidata_qid"] or a


for a, r in rows.items():
    if r.get("decision") == "query_independent":
        r["book_key"] = key_of(r["parent"])
        r["edition_key"] = "E1" if r["relation_to_gallery"] == SAME else "OTHER-" + a

# ---- out-of-catalog Vietnamese covers: seeded hash, Latin script, title visible, not part of a Track A pair
vn_cand = [a for a, r in rows.items() if a.startswith("C-VN") and r.get("decision") == "gallery"
           and a not in ("C-VN-0017", "C-VN-0063") and a not in han and r.get("title_visible") == "yes"]
vn_ooc = sorted(vn_cand, key=lambda a: hashlib.sha256(("ooc|" + a).encode()).hexdigest())[:8]
for a in vn_ooc:
    rows[a]["decision"] = "out_of_catalog"
    rows[a]["note"] = (rows[a].get("note", "") + " | assigned out-of-catalog by seeded hash (lowest 8 of sha256('ooc|'+asset_id))").strip(" |")

F = ["asset_id", "decision", "book_key", "edition_key", "relation_to_gallery", "parent", "title", "author", "publisher",
     "edition_year", "work_year", "language", "script", "isbn13", "isbn_status", "image_condition", "title_visible",
     "exclusion_reason", "note"]
with open(D + "manual_annotations.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=F, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows.values())
print("VN out-of-catalog:", vn_ooc)
print(len(rows), collections.Counter(r.get("decision") for r in rows.values()))
