"""Extraction prompt (version in schemas.PROMPT_VERSION). One prompt for 1-3 labelled images;
the model transcribes, it does not judge: no confidence numbers are asked for,
and every value must come with the exact text it was read from so the server
can check it (validation.py)."""
from __future__ import annotations

from .schemas import PROMPT_VERSION

_IMAGE_NAMES = {
    "front_cover": "bìa trước",
    "back_cover": "bìa sau",
    "copyright_page": "trang thông tin xuất bản (trang bản quyền / lưu chiểu)",
}

_PROMPT = """Bạn là công cụ CHÉP LẠI chữ in trên ảnh sách cho thư viện ({version}).
Ảnh được gửi kèm, mỗi ảnh có nhãn "Image label: <source>". Ảnh có trong yêu cầu này: {images}.

NGUYÊN TẮC BẮT BUỘC
1. Chỉ ghi thông tin NHÌN THẤY trong ảnh. Không suy đoán, không dùng hiểu biết bên ngoài, không tự sửa chính tả, không dịch.
2. Giữ nguyên tiếng Việt có dấu đúng như in. Không đọc được chắc chắn thì BỎ QUA trường đó (không ghi gì).
3. Mỗi lần đọc là một observation: {{"source": "<nhãn ảnh>", "value": ..., "observedText": "<dòng chữ nguyên văn trong ảnh, gồm cả nhãn như 'Dịch giả:'>"}}.
   Cùng một trường thấy ở nhiều ảnh thì ghi một observation cho MỖI ảnh. "source" chỉ được là một trong: {sources}.
4. ISBN: chỉ ghi khi có chữ "ISBN" hoặc là dãy 13 số bắt đầu 978/979 in ngay dưới mã vạch. Ghi đúng các chữ số đã thấy.
   Mã sản phẩm, mã vạch bắt đầu 893, SKU, mã nội bộ, giá... KHÔNG phải ISBN: ghi vào "otherCodes".
5. Năm: "publicationYear" chỉ khi ghi rõ năm xuất bản. Năm in / "in xong và nộp lưu chiểu năm" -> "printYear". Năm sau © / Copyright -> "copyrightYear".
   Năm nằm trong số ĐKXB/QĐXB thì không ghi. "Tái bản lần thứ...", "In lần thứ...", "Xuất bản lần thứ..." -> "editionStatement".
6. "authors" là tác giả / nguyên tác; người dịch -> "translators" (không lẫn hai vai trò). Người minh họa / họa sĩ KHÔNG phải tác giả: bỏ qua.
   "publisher" là nhà xuất bản (NXB ...); công ty liên kết/phát hành -> "distributor". "otherCodes" chỉ dành cho MÃ SỐ, không ghi tên người hay chữ.
7. "description": đoạn giới thiệu nội dung in trên bìa sau, chép nguyên văn (tối đa 1200 ký tự), không tóm tắt; với trường này "observedText" để null.
8. "subtitle" là tựa phụ tiếng Việt in kèm tên sách. Tên gốc tiếng nước ngoài của sách dịch, số tập ("Vol. 1", "Tập 2") không phải tựa phụ: bỏ qua.
9. "pageCount": chỉ khi ghi rõ số trang. "coverPrice": giá bìa đúng như in (ví dụ "89.000đ").

CHỈ trả về MỘT đối tượng JSON, không markdown. Mỗi phần tử trong mảng của "observations" PHẢI là object
{{"source", "value", "observedText"}} - KHÔNG được là chuỗi trần. Trường không thấy thì để mảng rỗng [].
Ví dụ đúng định dạng (giá trị chỉ minh họa, không phải của sách này):
{{
  "images": [{{"source": "copyright_page", "legible": true, "issue": null}}],
  "observations": {{
    "title": [{{"source": "copyright_page", "value": "Tên sách", "observedText": "TÊN SÁCH"}}],
    "authors": [{{"source": "copyright_page", "value": ["Tên tác giả"], "observedText": "Tác giả: Tên tác giả"}}],
    "translators": [{{"source": "copyright_page", "value": ["Tên dịch giả"], "observedText": "Người dịch: Tên dịch giả"}}],
    "publicationYear": [{{"source": "copyright_page", "value": 2024, "observedText": "Xuất bản năm 2024"}}],
    "subtitle": [], "publisher": [], "distributor": [], "isbn": [], "printYear": [], "copyrightYear": [],
    "editionStatement": [], "pageCount": [], "coverPrice": [], "description": []
  }},
  "otherCodes": [{{"source": "back_cover", "label": "Mã vạch", "value": "8935000000000", "observedText": "8935000000000"}}]
}}
"authors"/"translators" có value là mảng tên; năm và số trang là số nguyên; các trường khác là chuỗi."""


def build_prompt(kinds: list[str]) -> str:
    images = ", ".join(f"{kind} = {_IMAGE_NAMES[kind]}" for kind in kinds)
    return _PROMPT.format(version=PROMPT_VERSION, images=images, sources=", ".join(kinds))
