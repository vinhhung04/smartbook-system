import unittest
import unicodedata

import httpx

import library_providers as lp

# Trimmed from live responses (2026-11-16): LoC marcxml for 9780132350884.
LOC_SRU = """<?xml version="1.0"?>
<zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/"><zs:numberOfRecords>1</zs:numberOfRecords>
<zs:records><zs:record><zs:recordData><record xmlns="http://www.loc.gov/MARC21/slim">
<controlfield tag="001">15315370</controlfield>
<controlfield tag="008">080604s2009    njua     b    001 0 eng  </controlfield>
<datafield tag="020" ind1=" " ind2=" "><subfield code="a">0132350882</subfield><subfield code="q">pbk. : alk. paper</subfield></datafield>
<datafield tag="020" ind1=" " ind2=" "><subfield code="a">9780132350884</subfield><subfield code="q">(pbk. : alk. paper)</subfield></datafield>
<datafield tag="245" ind1="1" ind2="0"><subfield code="a">Clean code :</subfield><subfield code="b">a handbook of agile software craftsmanship /</subfield><subfield code="c">Robert C. Martin ... [et al.].</subfield></datafield>
<datafield tag="260" ind1=" " ind2=" "><subfield code="a">Upper Saddle River, NJ :</subfield><subfield code="b">Prentice Hall,</subfield><subfield code="c">c2009.</subfield></datafield>
<datafield tag="300" ind1=" " ind2=" "><subfield code="a">xxix, 431 p. :</subfield><subfield code="b">ill. ;</subfield></datafield>
<datafield tag="650" ind1=" " ind2="0"><subfield code="a">Agile software development.</subfield></datafield>
<datafield tag="700" ind1="1" ind2=" "><subfield code="a">Martin, Robert C.</subfield></datafield>
</record></zs:recordData></zs:record></zs:records></zs:searchRetrieveResponse>"""

# A Vietnamese LoC record: decomposed diacritics with the tone mark before the circumflex.
LOC_VI = """<zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/"><zs:records><zs:record><zs:recordData>
<record xmlns="http://www.loc.gov/MARC21/slim">
<controlfield tag="001">15699893</controlfield>
<controlfield tag="008">090415s2008    vm l         f000 0 vie d</controlfield>
<datafield tag="245" ind1="0" ind2="0"><subfield code="a">Gia&#x301; &#x111;a&#x301;&#x302;t mo&#x31B;&#x301;i /</subfield></datafield>
<datafield tag="264" ind1=" " ind2="1"><subfield code="b">Nha&#x300; xua&#x301;&#x302;t ba&#x309;n Lao &#x111;o&#x323;&#x302;ng,</subfield><subfield code="c">2008.</subfield></datafield>
<datafield tag="700" ind1="1" ind2=" "><subfield code="a">Pha&#x323;m, Gia &#x110;u&#x31B;&#x301;c,</subfield><subfield code="e">editor.</subfield></datafield>
<datafield tag="700" ind1="1" ind2=" "><subfield code="a">Nguye&#x302;&#x303;n, Va&#x306;n A,</subfield><subfield code="e">author.</subfield></datafield>
<datafield tag="700" ind1="1" ind2=" "><subfield code="a">Le&#x302;, Thi&#x323; B,</subfield><subfield code="e">translator.</subfield></datafield>
</record></zs:recordData></zs:record></zs:records></zs:searchRetrieveResponse>"""

# DNB MARC21-xml for 9780132350884.
DNB_SRU = """<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><records><record><recordData>
<record xmlns="http://www.loc.gov/MARC21/slim" type="Bibliographic">
<controlfield tag="001">1293907995</controlfield>
<controlfield tag="008">230625s2008    xxu||||| |||| 00||||eng  </controlfield>
<datafield tag="020" ind1=" " ind2=" "><subfield code="a">9780132350884</subfield><subfield code="9">978-0-13-235088-4</subfield></datafield>
<datafield tag="100" ind1="1" ind2=" "><subfield code="a">Martin, Robert</subfield><subfield code="e">Verfasser</subfield><subfield code="4">aut</subfield></datafield>
<datafield tag="245" ind1="1" ind2="0"><subfield code="a">Clean Code: A Handbook of Agile Software Craftsmanship</subfield></datafield>
<datafield tag="264" ind1=" " ind2="1"><subfield code="a">London</subfield><subfield code="b">Pearson Education Limited</subfield><subfield code="c">2008</subfield></datafield>
<datafield tag="300" ind1=" " ind2=" "><subfield code="a">464 Seiten</subfield></datafield>
</record></recordData></record></records></searchRetrieveResponse>"""

# PPDVN lưu chiểu result table (one book filed twice, plus the header row).
PPDVN_PAGE = """<html><body><table cellpadding="0"><thead><tr><th>STT</th><th>Mã ISBN</th></tr></thead><tbody>
<tr> <td class="txt-center"> 1</td> <td class="txt-left">978-604-53-9639-1</td> <td class="txt-left">Nhà giả Kim</td>
<td class="txt-left">Paulo Coelho</td> <td class="txt-left">Nguyễn Chí Hoan</td> <td class="txt-left"> Hội Nhà văn </td>
<td class="txt-left">LK với Công ty CP Văn hóa và Truyền thông Nhã Nam</td> <td class="txt-left">CTY In &amp; TM</td> <td class="txt-center">27/05/2026</td> </tr>
<tr> <td class="txt-center"> 2</td> <td class="txt-left">978-604-53-9639-1</td> <td class="txt-left">Nhà giả Kim</td>
<td class="txt-left">Paulo Coelho</td> <td class="txt-left">Nguyễn Chí Hoan</td> <td class="txt-left"> Hội Nhà văn </td>
<td class="txt-left"></td> <td class="txt-left">CTY ITAXA</td> <td class="txt-center">27/05/2026</td> </tr>
<tr> <td> 3</td> <td>978-604-923-963-2</td> <td>Giáo trình Sinh lý vật nuôi</td>
<td>TS. Nguyễn Thị Thanh (chủ biên), PGS.TS. Hoàng Thị Mai và ThS. Trương Thị Thành Vinh</td>
<td>Cao Thị Anh Tú</td> <td>Đại học Vinh</td> <td></td> <td>Cty in Hà Tĩnh</td> <td>06/11/2026</td> </tr>
</tbody></table></body></html>"""
PPDVN_EMPTY = """<table><tr><th>STT</th></tr><tr><td colspan="9">Không tìm thấy dữ liệu</td></tr></table>"""


def mock_client(body: str, seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=body)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class MarcParsingTests(unittest.TestCase):
    def test_loc_record_maps_to_the_lookup_shape(self):
        [record] = lp.parse_sru_response(LOC_SRU, lp._loc_url)
        self.assertEqual(record["title"], "Clean code")
        self.assertEqual(record["subtitle"], "a handbook of agile software craftsmanship")
        self.assertEqual(record["authors"], ["Robert C. Martin"])
        self.assertEqual(record["publisher"], "Prentice Hall")
        self.assertEqual(record["publishedDate"], "2009")
        self.assertEqual(record["pageCount"], 431)
        self.assertEqual(record["language"], "en")
        self.assertEqual(record["categories"], ["Agile software development"])
        self.assertEqual(record["identifiers"], ["0132350882", "9780132350884"])
        self.assertEqual(record["sourceUrl"], "https://lccn.loc.gov/15315370")

    def test_vietnamese_record_is_composed_keeps_name_order_and_splits_roles(self):
        [record] = lp.parse_sru_response(LOC_VI, lp._loc_url)
        self.assertEqual(record["title"], "Giá đất mới")
        self.assertTrue(unicodedata.is_normalized("NFC", record["title"]))
        self.assertEqual(record["publisher"], "Nhà xuất bản Lao động")
        self.assertEqual(record["authors"], ["Nguyễn Văn A"])  # the editor is not an author
        self.assertEqual(record["translator"], ["Lê Thị B"])
        self.assertEqual(record["language"], "vi")
        self.assertEqual(record["identifiers"], [])

    def test_dnb_record_reads_264_and_german_extent(self):
        [record] = lp.parse_sru_response(DNB_SRU, lp._dnb_url)
        self.assertEqual(record["authors"], ["Robert Martin"])
        self.assertEqual(record["publisher"], "Pearson Education Limited")
        self.assertEqual(record["pageCount"], 464)
        self.assertEqual(record["sourceUrl"], "https://d-nb.info/1293907995")

    def test_broken_xml_yields_no_records(self):
        self.assertEqual(lp.parse_sru_response("<html>rate limited", lp._loc_url), [])


class PpdvnParsingTests(unittest.TestCase):
    def test_rows_become_candidates_one_per_isbn(self):
        records = lp.parse_ppdvn_results(PPDVN_PAGE, "https://ppdvn.test")
        self.assertEqual([r["identifiers"] for r in records], [["9786045396391"], ["9786049239632"]])
        first, second = records
        self.assertEqual(first["publisher"], "NXB Hội Nhà văn")
        self.assertEqual(first["authors"], ["Paulo Coelho"])
        self.assertIsNone(first["publishedDate"])  # a deposit date is not the publication date
        self.assertEqual(second["authors"], ["Nguyễn Thị Thanh", "Hoàng Thị Mai", "Trương Thị Thành Vinh"])
        self.assertEqual(second["publisher"], "NXB Đại học Vinh")

    def test_no_data_row_is_not_a_record(self):
        self.assertEqual(lp.parse_ppdvn_results(PPDVN_EMPTY, "u"), [])


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_loc_code_search_queries_the_isbn_index(self):
        seen = []
        async with mock_client(LOC_SRU, seen) as client:
            record = await lp.loc_by_code(client, "9780132350884")
        self.assertIn("9780132350884", record["identifiers"])
        self.assertEqual(seen[0].url.params["query"], "bath.isbn=9780132350884")
        self.assertEqual(seen[0].url.params["recordSchema"], "marcxml")

    async def test_dnb_title_search_quotes_title_and_author(self):
        seen = []
        async with mock_client(DNB_SRU, seen) as client:
            records = await lp.dnb_by_title(client, 'Clean "Code"', "Robert Martin")
        self.assertEqual(len(records), 1)
        self.assertEqual(seen[0].url.params["query"], 'tit="Clean  Code" and per="Robert Martin"')

    async def test_ppdvn_searches_by_title(self):
        seen = []
        async with mock_client(PPDVN_PAGE, seen) as client:
            records = await lp.ppdvn_by_title(client, "Nhà giả kim", None)
        self.assertEqual(seen[0].url.params["query"], "Nhà giả kim")
        self.assertEqual(records[0]["title"], "Nhà giả Kim")


if __name__ == "__main__":
    unittest.main()
