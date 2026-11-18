"""Adapters for Đinh Tị / Nhã Nam / Thái Hà / Văn Lang - offline.

The fixtures below reproduce the markup/JSON structure observed live on
2026-11-12 (field labels, element classes, JSON keys) with shortened content;
they are not copies of the sites' pages. Live checks: eval/live_book_sources.py.
"""
import asyncio
import unittest
from unittest.mock import patch

import httpx

import bookstore_providers as bp
import isbn_rounds

DINHTI_SEARCH = """<div class="item"><a href="https://dinhtibooks.com.vn/sach-am-thanh-be-ngoan-hoc-le-phep-dp4412.html">
<img src="x.jpg"></a></div>
<a href="https://dinhtibooks.com.vn/sach-am-thanh-be-ngoan-hoc-le-phep-dp4412.html">Bé ngoan học lễ phép</a>"""

DINHTI_PRODUCT = """<html><head>
<meta property="og:image" content="https://dinhtibooks.com.vn/images/products/original/le-phep.jpg" />
</head><body>
<div class="gallery"><img class="mySlides" src="https://dinhtibooks.com.vn/images/products/large/le-phep.webp" style="width:100%;"></div>
<div class="info-prd"><div class="left">
  <h1 class="name">Sách tương tác - Sách âm thanh - Bé ngoan học lễ phép</p>
  <ul>
    <li>Mã sản phẩm: 8935212359658</li>
    <li>Tác giả:
        Biên soạn: Khánh Vân; Minh họa: Quỳnh Rùa      </li>
    <li>Dịch giả: Hà Giang</li>
    <li>Độ tuổi: 0-6 tuổi </li>
    <li>Nhà xuất bản:
        NXB Hà Nội      </li>
    <li>Năm xuất bản: 2021</li>
    <li>Số trang: 10</li>
  </ul>
  <div class="price-share"><p class="price">Giá: 194,650đ</p></div>
</div></div>
<div class="block-description row"><div class="col-md-12"><div class="outer-title">
<p class="title">Mô tả sản phẩm</p></div>
<p><em>Cuốn sách âm thanh giúp bé học cách cư xử lễ phép.</em></p><p>Có 10 nút âm thanh.</p>
</div></div><div class="block-related">Sách liên quan</div>
</body></html>"""

NHANAM_JSON = {
    "name": "[ĐẶT TRƯỚC] Nhà giả kim (TB 79.000)", "vendor": "Nhã Nam", "product_type": "Văn học hiện đại",
    "tags": ["1561", "Tác giả Paulo Coelho", "Số trang 228", "Ngày phát hành 2020", "Nhà xuất bản Hội Nhà Văn"],
    "content": "<p><em>Santiago</em> đi tìm kho báu.</p>", "featured_image": "//bizweb.test/nhagiakim.jpg",
    "variants": [{"sku": "8935235226272", "barcode": "8935235226272"}],
}
VANLANG_JSON = {
    "title": "Tự Đổ Tách Trà Trước Khi Tràn Ly - Yong Kang Chan  - Vanlangbooks", "vendor": "Văn Lang",
    "type": "Kỹ Năng Sống", "description": "<p>Giới thiệu sách</p>", "featured_image": "//cdn.hstatic.test/a.jpg",
    "variants": [{"sku": "8935074130020", "barcode": "8935074130020"}],
}
THAIHA_JSON = {
    "title": "Chú thỏ muốn đi ngủ", "vendor": "Carl-Johan Forssén Ehrlin", "type": "Sách",
    "description": "<p>Truyện ru ngủ.</p>", "featured_image": "https://product.hstatic.test/t.jpg",
    "variants": [{"sku": None, "barcode": None}],
}
SITEMAP_INDEX = """<?xml version="1.0"?><sitemapindex>
<sitemap><loc>https://store.test/sitemap_products_1.xml?from=1&amp;to=2</loc></sitemap>
<sitemap><loc>https://store.test/sitemap_blogs_1.xml</loc></sitemap></sitemapindex>"""
SITEMAP_PRODUCTS = """<urlset>
<url><loc>https://store.test/</loc></url>
<url><loc>https://store.test/products/chu-tho-muon-di-ngu</loc>
  <image:image><image:loc>https://img/1.jpg</image:loc><image:title>Chú thỏ muốn đi ngủ</image:title></image:image></url>
<url><loc>https://store.test/products/chu-voi-con</loc>
  <image:image><image:title>Chú voi con ở Bản Đôn</image:title></image:image></url>
</urlset>"""


def client_for(routes: dict, calls: list | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(str(request.url))
        for prefix, response in routes.items():
            if str(request.url).startswith(prefix):
                return response() if callable(response) else response
        return httpx.Response(404, text="not found")
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class DinhTiTests(unittest.IsolatedAsyncioTestCase):
    def test_product_page_is_parsed(self):
        data = bp.parse_dinhti_product(DINHTI_PRODUCT, "https://dinhtibooks.com.vn/x-dp4412.html")
        self.assertEqual(data["title"], "Sách tương tác - Sách âm thanh - Bé ngoan học lễ phép")
        self.assertEqual(data["identifiers"], ["8935212359658"])
        self.assertEqual(data["authors"], ["Khánh Vân", "Quỳnh Rùa"])
        self.assertEqual(data["translator"], ["Hà Giang"])
        self.assertEqual(data["publisher"], "NXB Hà Nội")
        self.assertEqual(data["publishedDate"], "2021")
        self.assertEqual(data["pageCount"], 10)
        self.assertIn("lễ phép", data["description"])
        self.assertNotIn("Sách liên quan", data["description"])
        # gallery image wins over og:image (whose /original/ file is often missing)
        self.assertEqual(data["thumbnail"], "https://dinhtibooks.com.vn/images/products/large/le-phep.webp")

    def test_og_image_is_the_fallback_cover(self):
        page = DINHTI_PRODUCT.replace("<img class=\"mySlides\"", "<img class=\"other\"")
        data = bp.parse_dinhti_product(page, "u")
        self.assertTrue(data["thumbnail"].endswith("le-phep.jpg"))

    def test_page_without_product_title_is_rejected(self):
        self.assertIsNone(bp.parse_dinhti_product("<html><h2>404</h2></html>", "u"))

    async def test_search_by_code_returns_the_verified_product(self):
        calls = []
        routes = {"https://dinhtibooks.com.vn/search/8935212359658.html": httpx.Response(200, text=DINHTI_SEARCH),
                  "https://dinhtibooks.com.vn/sach-am-thanh": httpx.Response(200, text=DINHTI_PRODUCT)}
        async with client_for(routes, calls) as client:
            data = await bp.dinhti_by_code(client, "8935212359658")
        self.assertEqual(data["identifiers"], ["8935212359658"])
        self.assertEqual(len(calls), 2)  # one search, one product page (duplicate links collapsed)

    async def test_empty_search_is_not_found(self):
        routes = {"https://dinhtibooks.com.vn/search/": httpx.Response(200, text="<p>Không có sản phẩm</p>")}
        async with client_for(routes) as client:
            self.assertIsNone(await bp.dinhti_by_code(client, "9780132350884"))

    async def test_title_search_url_uses_plus_for_spaces(self):
        calls = []
        async with client_for({"https://dinhtibooks.com.vn/search/": httpx.Response(200, text="")}, calls) as client:
            await bp.dinhti_by_title(client, "Bé ngoan học lễ phép", None)
        self.assertIn("/search/B%C3%A9+ngoan+h%E1%BB%8Dc+l%E1%BB%85+ph%C3%A9p.html", calls[0])

    async def test_http_error_is_raised_for_the_round_to_record(self):
        async with client_for({"https://dinhtibooks.com.vn/": httpx.Response(503)}) as client:
            with self.assertRaises(httpx.HTTPStatusError):
                await bp.dinhti_by_code(client, "8935212359658")


class StoreJsonParserTests(unittest.TestCase):
    def test_nhanam(self):
        data = bp.parse_nhanam_product(NHANAM_JSON, "https://nhanam.vn/nha-gia-kim")
        self.assertEqual(data["title"], "Nhà giả kim")
        self.assertEqual(data["authors"], ["Paulo Coelho"])
        self.assertEqual((data["pageCount"], data["publishedDate"], data["publisher"]), (228, "2020", "Hội Nhà Văn"))
        self.assertEqual(data["identifiers"], ["8935235226272"])
        self.assertEqual(data["thumbnail"], "https://bizweb.test/nhagiakim.jpg")
        self.assertEqual(data["description"], "Santiago đi tìm kho báu.")

    def test_vanlang_barcode_and_title_suffix(self):
        data = bp.parse_vanlang_product(VANLANG_JSON, "https://vanlang.vn/products/x")
        self.assertEqual(data["title"], "Tự Đổ Tách Trà Trước Khi Tràn Ly - Yong Kang Chan")
        self.assertEqual(data["identifiers"], ["8935074130020"])
        self.assertEqual(data["authors"], [])  # only in free text - not guessed
        self.assertEqual(data["categories"], ["Kỹ Năng Sống"])

    def test_vanlang_labelled_spec_block_is_read_but_prose_is_not(self):
        product = {
            **VANLANG_JSON, "title": "Phật Giáo Có Là Tôn Giáo Không? - Vanlangbooks",
            "description": "<p>Tác giả Alan W. Watts – một trong những triết gia nổi bật</p>"
                           "<p>Mã sản phẩm:  8935074112750   Tác giả:  Alan Watts   Dịch giả:  Hạnh Duyên   "
                           "Nhà xuất bản:  NXB Hồng Đức   Nhà phát hành:  Công Ty Văn Lang   Số trang:  172   "
                           "Hình thức:  Bìa mềm</p>",
        }
        data = bp.parse_vanlang_product(product, "u")
        self.assertEqual(data["authors"], ["Alan Watts"])  # the labelled value, not "Alan W. Watts – ..." prose
        self.assertEqual(data["translator"], ["Hạnh Duyên"])
        self.assertEqual(data["publisher"], "NXB Hồng Đức")
        self.assertEqual(data["pageCount"], 172)
        self.assertEqual(bp.parse_vanlang_product(VANLANG_JSON, "u")["authors"], [])  # no block -> nothing guessed

    def test_a_lone_author_heading_over_a_biography_is_not_a_spec(self):
        bio = "<p>Tác giả: Là chuyên gia tiêu hóa nổi tiếng thế giới, ông đã khám cho hơn 300.000 người</p>"
        self.assertEqual(bp.labelled_specs(bp.html_to_text(bio)), {})
        data = bp.parse_thaiha_product({**THAIHA_JSON, "vendor": "Hiromi Shinya", "description": bio}, "u")
        self.assertEqual(data["authors"], ["Hiromi Shinya"])

    def test_preorder_prefix_is_removed_from_titles(self):
        data = bp.parse_thaiha_product({**THAIHA_JSON, "title": "[Đặt trước] - Sức sống bắt đầu từ đường ruột"}, "u")
        self.assertEqual(data["title"], "Sức sống bắt đầu từ đường ruột")

    def test_thaiha_vendor_is_the_author_and_no_barcode(self):
        data = bp.parse_thaiha_product(THAIHA_JSON, "https://nhasachthaiha.vn/products/x")
        self.assertEqual(data["authors"], ["Carl-Johan Forssén Ehrlin"])
        self.assertEqual(data["identifiers"], [])
        self.assertEqual(data["categories"], [])


class SitemapStoreTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        bp._sitemap_cache.clear()
        self.store = bp.SitemapStore("thaiHaTest", "https://store.test", bp.parse_thaiha_product)

    def tearDown(self):
        bp._sitemap_cache.clear()

    def test_sitemap_entries_and_ranking(self):
        entries = bp.parse_sitemap_entries(SITEMAP_PRODUCTS)
        self.assertEqual(len(entries), 2)  # the homepage <url> has no product title
        self.assertEqual(bp.rank_by_title(entries, "Chú Thỏ Muốn Đi Ngủ"),
                         ["https://store.test/products/chu-tho-muon-di-ngu"])
        self.assertEqual(bp.rank_by_title(entries, "Nhà giả kim"), [])

    async def test_title_search_reads_sitemap_once_then_product_json(self):
        calls = []
        routes = {"https://store.test/sitemap.xml": httpx.Response(200, text=SITEMAP_INDEX),
                  "https://store.test/sitemap_products_1.xml": httpx.Response(200, text=SITEMAP_PRODUCTS),
                  "https://store.test/products/chu-tho-muon-di-ngu.js": httpx.Response(200, json=THAIHA_JSON)}
        async with client_for(routes, calls) as client:
            first = await bp.sitemap_by_title(self.store, client, "Chú thỏ muốn đi ngủ", None)
            await bp.sitemap_by_title(self.store, client, "Chú thỏ muốn đi ngủ", None)
        self.assertEqual(first[0]["title"], "Chú thỏ muốn đi ngủ")
        self.assertEqual(sum("sitemap" in c for c in calls), 2)  # index + products, cached afterwards
        self.assertTrue(all("/search" not in c for c in calls))  # robots.txt disallows /search

    async def test_failed_sitemap_is_not_cached(self):
        async with client_for({"https://store.test/sitemap.xml": httpx.Response(500)}) as client:
            with self.assertRaises(httpx.HTTPStatusError):
                await bp.sitemap_entries(client, self.store)
        self.assertNotIn(self.store.name, bp._sitemap_cache)


HARAVAN_FEED = [
    {"id": 1, "handle": "phat-giao-co-la-ton-giao-khong-vanlangbooks", "title": "Phật Giáo Có Là Tôn Giáo Không?",
     "variants": [{"barcode": "8935074112750", "sku": "8935074112750"}]},
    {"id": 2, "handle": "bo-5-cuon", "title": "Bộ 5 cuốn", "variants": [{"barcode": None, "sku": "COMBO-01"}]},
]
SAPO_FEED = [{"id": 9, "alias": "nha-gia-kim-tb-79-000-1", "url": "/nha-gia-kim-tb-79-000-1",
              "variants": [{"barcode": "8935235226272", "sku": "8935235226272"}]}]


class CodeIndexTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        bp._code_index.clear()
        self._delay = patch("bookstore_providers.CODE_INDEX_PAGE_DELAY_SECONDS", 0)
        self._delay.start()

    def tearDown(self):
        self._delay.stop()
        bp._code_index.clear()

    def _feed(self, pages, calls=None):
        def handler(request):
            if calls is not None:
                calls.append(str(request.url))
            page = int(request.url.params.get("page", "1"))
            return httpx.Response(200, json={"products": pages[page - 1] if page <= len(pages) else []})
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def test_feed_is_read_until_the_empty_page_and_maps_codes_to_urls(self):
        calls = []
        async with self._feed([HARAVAN_FEED, [{"id": 3, "handle": "x", "variants": [{"barcode": "8935074130020"}]}]], calls) as client:
            built = await bp.build_code_index(client, bp.VANLANG)
        codes, seen = built["codes"], built["products"]
        self.assertIn(("https://vanlang.vn/products/bo-5-cuon", "Bộ 5 cuốn"), built["titles"])
        self.assertEqual(seen, 3)
        self.assertEqual(codes["8935074112750"], "https://vanlang.vn/products/phat-giao-co-la-ton-giao-khong-vanlangbooks")
        self.assertIn("8935074130020", codes)
        self.assertNotIn("COMBO-01", codes)
        self.assertEqual(len(calls), 3)  # two pages + the empty one
        self.assertTrue(all("/collections/all/products.json" in c for c in calls))
        self.assertTrue(all("/search" not in c for c in calls))

    async def test_sapo_products_use_their_own_url(self):
        async with self._feed([SAPO_FEED]) as client:
            codes = (await bp.build_code_index(client, bp.NHANAM))["codes"]
        self.assertEqual(codes["8935235226272"], "https://nhanam.vn/nha-gia-kim-tb-79-000-1")

    async def test_a_feed_that_repeats_its_last_page_stops(self):
        def handler(request):
            return httpx.Response(200, json={"products": HARAVAN_FEED})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            seen = (await bp.build_code_index(client, bp.VANLANG))["products"]
        self.assertEqual(seen, 2)

    async def test_code_search_before_the_index_exists_says_so(self):
        async with self._feed([]) as client:
            with self.assertRaises(bp.CodeIndexNotReady):
                await bp.code_search(bp.VANLANG)(client, "8935074112750")

    async def test_indexed_code_reads_only_that_product(self):
        bp._code_index["vanLang"] = {"codes": {"8935074112750": "https://vanlang.vn/products/phat-giao"}, "products": 1,
                                     "builtAt": 0}
        product = {**VANLANG_JSON, "title": "Phật Giáo Có Là Tôn Giáo Không? - Vanlangbooks",
                   "variants": [{"barcode": "8935074112750"}]}
        calls = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(200, json=product)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            data = await bp.code_search(bp.VANLANG)(client, "8935074112750")
            missing = await bp.code_search(bp.VANLANG)(client, "9780132350884")
        self.assertEqual(calls, ["https://vanlang.vn/products/phat-giao.js"])
        self.assertEqual(data["title"], "Phật Giáo Có Là Tôn Giáo Không?")
        self.assertEqual(data["identifiers"], ["8935074112750"])
        self.assertIsNone(missing)

    async def test_failed_or_empty_crawl_keeps_the_previous_index(self):
        bp._code_index["vanLang"] = {"codes": {"1": "u"}, "products": 1, "builtAt": 0}
        with patch("bookstore_providers.build_code_index", return_value={"codes": {}, "titles": [], "products": 0}):
            await bp.refresh_code_index(bp.VANLANG)
        self.assertEqual(bp._code_index["vanLang"]["codes"], {"1": "u"})


class FeedStoreParserTests(unittest.TestCase):
    """One parser for every Haravan/Sapo publisher store - shapes observed 2026-11-13."""

    def test_ipm_prefixed_tags(self):
        product = {"title": "Your Name", "vendor": "Khác", "product_type": "Khác",
                   "tags": "tacgia_Shinkai Makoto,Light Novel,namxb_2017,nhaxb_Hồng Đức,kichthuoc_13 x 18 cm",
                   "body_html": "<p>Giới thiệu sách: Your Name</p>", "image": {"src": "//cdn.hstatic.net/y.jpg"},
                   "variants": [{"barcode": "8935250722483"}]}
        data = bp.IPM.parse(product, "https://ipm.vn/products/your-name")
        self.assertEqual((data["title"], data["authors"], data["publisher"], data["publishedDate"]),
                         ("Your Name", ["Shinkai Makoto"], "Hồng Đức", "2017"))
        self.assertEqual(data["identifiers"], ["8935250722483"])
        self.assertEqual(data["categories"], [])  # "Khác" is not a category
        self.assertEqual(data["thumbnail"], "https://cdn.hstatic.net/y.jpg")

    def test_az_spec_table_and_book_prefix(self):
        product = {"title": "Sách - Trao Gửi Yêu Thương", "vendor": "Blue.Books", "product_type": "Phòng Daisy",
                   "body_html": "<table><tr><td>Tác giả</td><td>Naran</td></tr><tr><td>Dịch giả</td>"
                                "<td>Kyoyeon Duyên</td></tr><tr><td>Nhà xuất bản</td><td>Văn Học</td></tr>"
                                "<tr><td>Số trang</td><td>224 trang</td></tr></table>",
                   "variants": [{"barcode": "8935325012345"}]}
        data = bp.AZVIETNAM.parse(product, "u")
        self.assertEqual(data["title"], "Trao Gửi Yêu Thương")
        self.assertEqual((data["authors"], data["translator"], data["publisher"], data["pageCount"]),
                         (["Naran"], ["Kyoyeon Duyên"], "Văn Học", 224))

    def test_colon_labels_and_vendor_as_author_only_where_configured(self):
        body = "<p>Số trang: 356</p><p>NXB: Công Thương</p><p>Năm XB: 2026</p>"
        alpha = bp.ALPHABOOKS.parse({"name": "Quản Trị Hiệu Suất Cao", "vendor": "Andrew S. Grove",
                                     "content": body, "variants": [{"barcode": "8935251400000"}]}, "u")
        self.assertEqual((alpha["authors"], alpha["publisher"], alpha["publishedDate"], alpha["pageCount"]),
                         (["Andrew S. Grove"], "Công Thương", "2026", 356))
        omega = bp.OMEGAPLUS.parse({"name": "Ấn định ước mơ", "vendor": "Omega Plus Books", "content": body,
                                    "variants": []}, "u")
        self.assertEqual(omega["authors"], [])  # the brand is not an author

    def test_tan_viet_title_suffix_and_reprint_note(self):
        data = bp.TANVIET.parse({"name": "Bảng Âm Thanh Về Số Đếm - Tân Việt Books ( Tái Bản 2026 )",
                                 "variants": []}, "u")
        self.assertEqual(data["title"], "Bảng Âm Thanh Về Số Đếm")


class BookstoreChainTests(unittest.IsolatedAsyncioTestCase):
    """Phương Nam / Nhân Văn / Minh Long feeds and the Bizbooks Store API - shapes observed 2026-11-13."""

    def tearDown(self):
        bp._code_index.clear()

    def test_twelve_digit_barcodes_get_their_ean13_check_digit(self):
        self.assertEqual(bp.complete_ean13("978604239806"), "9786042398060")
        self.assertEqual(bp.complete_ean13("893523522627"), "8935235226272")
        self.assertEqual(bp.complete_ean13("9786042398060"), "9786042398060")  # already complete
        self.assertEqual(bp.complete_ean13("012345678905"), "012345678905")  # a UPC-A is another code

    async def test_phuong_nam_twelve_digit_barcode_is_indexed_and_verified_as_ean13(self):
        feed = [{"id": 1, "handle": "host-club-15", "title": "Host Club Trường Ouran - Tập 15",
                 "variants": [{"barcode": "978604239806", "sku": "3TT0001"}]}]

        def handler(request):
            page = int(request.url.params.get("page", "1"))
            return httpx.Response(200, json={"products": feed if page == 1 else []})
        with patch("bookstore_providers.CODE_INDEX_PAGE_DELAY_SECONDS", 0):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                built = await bp.build_code_index(client, bp.PHUONGNAM)
        self.assertEqual(built["codes"], {"9786042398060": "https://nhasachphuongnam.com/products/host-club-15"})
        self.assertFalse(built["truncated"])
        data = bp.PHUONGNAM.parse({**feed[0], "description": "<p>Truyện tranh.</p>"}, "u")
        self.assertEqual(data["identifiers"], ["9786042398060"])
        self.assertEqual(data["authors"], [])  # the vendor is the supplier, never the author

    async def test_a_feed_longer_than_the_page_cap_is_marked_truncated(self):
        def handler(request):
            page = int(request.url.params.get("page", "1"))
            return httpx.Response(200, json={"products": [{"id": page, "handle": f"p{page}", "variants": []}]})
        with patch("bookstore_providers.CODE_INDEX_PAGE_DELAY_SECONDS", 0), \
             patch("bookstore_providers.CODE_INDEX_MAX_PAGES", 3):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                built = await bp.build_code_index(client, bp.NHANVAN)
        self.assertTrue(built["truncated"])
        self.assertEqual(built["products"], 3)

    def test_nhan_van_spec_table(self):
        product = {"title": "Ultraman - Tập 2 - Tặng Kèm Card Metalize", "vendor": "NXB Kim Đồng",
                   "tags": ["tacgia: Eiichi Shimizu; Tomohiro Shimoguchi"],
                   "description": "<p>THÔNG TIN CHI TIẾT</p><table><tr><td>Mã sản phẩm</td><td>9786042425353</td></tr>"
                                  "<tr><td>Tác giả</td><td>Eiichi Shimizu, Tomohiro Shimoguchi</td></tr>"
                                  "<tr><td>Người dịch</td><td>Itsuwa Rei</td></tr><tr><td>NXB</td><td>Kim Đồng</td></tr>"
                                  "<tr><td>Năm XB</td><td>2026</td></tr><tr><td>Số trang</td><td>192</td></tr></table>",
                   "variants": [{"barcode": "9786042425353"}]}
        data = bp.NHANVAN.parse(product, "https://nhanvan.vn/products/ultraman-2")
        self.assertEqual((data["authors"], data["translator"], data["publisher"], data["publishedDate"], data["pageCount"]),
                         (["Eiichi Shimizu", "Tomohiro Shimoguchi"], ["Itsuwa Rei"], "Kim Đồng", "2026", 192))
        self.assertEqual(data["identifiers"], ["9786042425353"])

    def test_minh_long_book_prefix_with_colon(self):
        data = bp.MINHLONG.parse({"title": "Sách: Đánh Thức Khả Năng Quan Sát Và Ghi Nhớ", "vendor": "Khác",
                                  "variants": [{"barcode": "8936238103737"}]}, "u")
        self.assertEqual(data["title"], "Đánh Thức Khả Năng Quan Sát Và Ghi Nhớ")

    BIZBOOKS_ITEM = {
        "id": 1, "name": "Đắc Nhân Tâm: Bí quyết để thành công - Tinh hoa được chắt lọc", "sku": "#8935246945926",
        "permalink": "https://bizbooks.vn/san-pham/dac-nhan-tam/", "attributes": [],
        "description": "<p>Đắc Nhân Tâm dạy bạn hiểu con người sâu sắc.</p>",
        "categories": [{"name": "Kỹ năng giao tiếp"}], "images": [{"src": "https://bizbooks.vn/a.jpg"}],
    }

    def test_bizbooks_item_is_parsed(self):
        data = bp.parse_bizbooks_product(self.BIZBOOKS_ITEM)
        self.assertEqual(data["identifiers"], ["8935246945926"])  # "#" stripped from the SKU
        self.assertEqual(data["title"], "Đắc Nhân Tâm: Bí quyết để thành công - Tinh hoa được chắt lọc")
        self.assertEqual((data["categories"], data["thumbnail"]), (["Kỹ năng giao tiếp"], "https://bizbooks.vn/a.jpg"))
        self.assertEqual((data["authors"], data["publisher"]), ([], None))  # not in the API, never guessed
        self.assertIn("hiểu con người", data["description"])

    async def test_bizbooks_by_code_uses_the_store_api_and_prefers_the_matching_sku(self):
        other = {**self.BIZBOOKS_ITEM, "name": "Sách khác", "sku": "#8935246900000"}
        calls = []
        routes = {bp.BIZBOOKS_STORE_API: httpx.Response(200, json=[other, self.BIZBOOKS_ITEM])}
        async with client_for(routes, calls) as client:
            data = await bp.bizbooks_by_code(client, "8935246945926")
        self.assertEqual(data["identifiers"], ["8935246945926"])
        self.assertIn("search=8935246945926", calls[0])
        self.assertNotIn("/?s=", calls[0])  # the site search does not match SKUs

    async def test_bizbooks_without_the_code_returns_the_first_hit_or_nothing(self):
        other = {**self.BIZBOOKS_ITEM, "sku": "#8935246900000"}
        async with client_for({bp.BIZBOOKS_STORE_API: httpx.Response(200, json=[other])}) as client:
            self.assertEqual((await bp.bizbooks_by_code(client, "8935246945926"))["identifiers"], ["8935246900000"])
        async with client_for({bp.BIZBOOKS_STORE_API: httpx.Response(200, json=[])}) as client:
            self.assertIsNone(await bp.bizbooks_by_code(client, "8935246945926"))


class IndexTitleSearchTests(unittest.IsolatedAsyncioTestCase):
    def tearDown(self):
        bp._code_index.clear()

    async def test_title_search_uses_the_feed_names(self):
        bp._code_index["ipm"] = {"codes": {}, "titles": [("https://ipm.vn/products/your-name", "Your Name"),
                                                         ("https://ipm.vn/products/other", "Weathering With You")],
                                 "products": 2, "builtAt": 0}
        calls = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(200, json={"title": "Your Name", "tags": "tacgia_Shinkai Makoto",
                                             "variants": [{"barcode": "8935250722483"}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            found = await bp.index_title_search(bp.IPM)(client, "Your Name", "Shinkai Makoto")
        self.assertEqual(calls, ["https://ipm.vn/products/your-name.js"])
        self.assertEqual(found[0]["authors"], ["Shinkai Makoto"])

    async def test_title_search_before_the_index_exists_says_so(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(500))) as client:
            with self.assertRaises(bp.CodeIndexNotReady):
                await bp.index_title_search(bp.IPM)(client, "Your Name", None)


class ProviderIsolationTests(unittest.IsolatedAsyncioTestCase):
    """A site that does not answer only marks its own source TIMEOUT/ERROR."""

    async def test_unresponsive_site_times_out_alone(self):
        async def hang(_client, _code):
            await asyncio.sleep(1)
        with patch("isbn_rounds.RETRY_BACKOFF_SECONDS", 0):
            call = await isbn_rounds.call_with_retry(
                isbn_rounds.BookProvider("dinhTi", by_code=hang, timeout=0.05, retries=1),
                lambda client: hang(client, "x"),
            )
        self.assertEqual((call["status"], call["attempts"]), ("TIMEOUT", 2))

    async def test_connection_refused_is_an_error_not_a_crash(self):
        async def refuse(client, _code):
            raise httpx.ConnectError("refused")
        with patch("isbn_rounds.RETRY_BACKOFF_SECONDS", 0):
            call = await isbn_rounds.call_with_retry(
                isbn_rounds.BookProvider("vanLang", retries=1), lambda client: refuse(client, "x"))
        self.assertEqual(call["status"], "ERROR")
        self.assertIn("ConnectError", call["error"])


class LabelledIsbnTests(unittest.TestCase):
    """A store page that shows the retail EAN-13 as its barcode and "Mã ISBN ..." in
    its description states both codes of one edition (isbn_matching.cross_identify)."""

    def test_labelled_isbn_forms(self):
        self.assertEqual(bp.labelled_isbn("Mã code 8935325011894\nMã ISBN 9786043927436\nLoại bìa Bìa mềm"), "9786043927436")
        self.assertEqual(bp.labelled_isbn("ISBN: 978-604-392-743-6"), "9786043927436")
        self.assertEqual(bp.labelled_isbn("isbn-10: 0-13-235088-2"), "9780132350884")  # ISBN-10 -> its ISBN-13

    def test_no_label_bad_check_digit_or_several_isbns_give_none(self):
        self.assertIsNone(bp.labelled_isbn("Mã sản phẩm 9786043927436"))           # not labelled ISBN
        self.assertIsNone(bp.labelled_isbn("Mã ISBN 9786043927435"))               # wrong check digit
        self.assertIsNone(bp.labelled_isbn("ISBN 8935325011894"))                 # a retail EAN is not an ISBN
        self.assertIsNone(bp.labelled_isbn("Tập 1 ISBN 9786043927436, tập 2 ISBN 9786043757903"))  # a series
        self.assertEqual(bp.labelled_isbn("ISBN 9786043927436 ... ISBN: 978-604-392-743-6"), "9786043927436")  # repeated

    def test_store_record_carries_the_barcode_and_the_labelled_isbn(self):
        product = {"title": "Đắc Nhân Tâm", "variants": [{"barcode": "8935325011894"}],
                   "body_html": "<p>Mã code 8935325011894</p><p>Mã ISBN 9786043927436</p>"}
        data = bp.parse_feed_store_product(product, "https://store.test/p")
        self.assertEqual(data["identifiers"], ["8935325011894", "9786043927436"])
        no_isbn = bp.parse_feed_store_product({**product, "body_html": "<p>Sách hay</p>"}, "https://store.test/p")
        self.assertEqual(no_isbn["identifiers"], ["8935325011894"])

    def test_dinhti_and_bizbooks_records_read_it_too(self):
        biz = bp.parse_bizbooks_product({"name": "X", "sku": "8935325011894", "description": "<p>ISBN: 9786043927436</p>"})
        self.assertEqual(biz["identifiers"], ["8935325011894", "9786043927436"])


class CrossLookupFromStoreTextTests(unittest.IsolatedAsyncioTestCase):
    """End to end through main.lookup_book_by_isbn with one store stating both codes."""

    async def test_scanned_ean_gets_the_isbn_the_store_page_labels(self):
        from cache import isbn_lookup_cache
        from main import IsbnLookupRequest, lookup_book_by_isbn
        product = {"title": "Đắc Nhân Tâm", "variants": [{"barcode": "8935325011894"}],
                   "body_html": "<p>Mã code 8935325011894</p><p>Mã ISBN 9786043927436</p>"}

        async def by_code(_client, code):
            return bp.parse_feed_store_product(product, "https://store.test/p") if code == "8935325011894" else None
        store = isbn_rounds.BookProvider("azVietnam", by_code=by_code, round1=True, accepts_raw_barcode=True, retries=0)
        isbn_lookup_cache.clear()
        try:
            with patch("main.ENABLE_MARKETPLACE_LOOKUP", True), patch("main._book_providers", return_value=[store]), \
                 patch("main.ISBN_ROUND1_ORDER", "azVietnam"), patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", False):
                result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="8935325011894"))
        finally:
            isbn_lookup_cache.clear()
        self.assertIsNone(result["isbn13"])  # still offered only, never filled in as the ISBN
        cross = result["crossLookup"]
        self.assertEqual((cross["status"], cross["value"]), ("REVIEW_REQUIRED", "9786043927436"))
        self.assertEqual(cross["evidence"][0]["source"], "azVietnam")

    async def test_ean_no_page_links_gets_the_register_isbn_by_title_publisher_and_author(self):
        import library_providers
        from cache import isbn_lookup_cache
        from main import IsbnLookupRequest, lookup_book_by_isbn
        product = {"title": "[Phiên chợ sách cũ] NVIDIA - Cỗ Máy Tư Duy Vĩ Đại", "variants": [{"barcode": "8936230471834"}],
                   "body_html": "<p>Tác giả: Stephen Witt</p><p>Nhà xuất bản: Công Thương</p>"}

        async def by_code(_client, code):
            return bp.parse_feed_store_product(product, "https://store.test/p") if code == "8936230471834" else None
        queries = []

        nvidia = {"title": "NVIDIA: Cỗ máy tư duy vĩ đại: Jensen Huang và cuộc cách mạng chip AI toàn cầu",
                  "publisher": "NXB Công Thương", "authors": ["Stephen Witt"], "identifiers": ["9786326120363"],
                  "sourceUrl": "https://ppdvn.test"}
        other_book = {**nvidia, "title": "NVIDIA và những điều chưa kể", "identifiers": ["9786043927436"]}

        async def search(_client, query):
            # The register answers the listing title with another book; only the main part finds this one.
            queries.append(query)
            return [nvidia] if query == "Cỗ Máy Tư Duy Vĩ Đại" else [other_book] if query.startswith("[") else []

        async def register(_client, _title, _author):
            return []
        providers = [isbn_rounds.BookProvider("azVietnam", by_code=by_code, round1=True, accepts_raw_barcode=True, retries=0),
                     isbn_rounds.BookProvider("ppdvn", by_title=register, retries=0)]
        isbn_lookup_cache.clear()
        try:
            with patch("main.ENABLE_MARKETPLACE_LOOKUP", True), patch("main._book_providers", return_value=providers), \
                 patch("main.ISBN_ROUND1_ORDER", "azVietnam"), patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", False), \
                 patch.object(library_providers, "ppdvn_search", search):
                result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="8936230471834"))
        finally:
            isbn_lookup_cache.clear()
        self.assertEqual(queries[-1], "Cỗ Máy Tư Duy Vĩ Đại")  # an answer about another book did not stop the search
        cross = result["crossLookup"]
        self.assertIsNone(result["isbn13"])
        self.assertEqual((cross["status"], cross["value"]), ("REVIEW_REQUIRED", "9786326120363"))
        self.assertEqual(cross["evidence"][0]["basis"], "TITLE_PUBLISHER_AUTHOR")
        self.assertIn("LEGAL_DEPOSIT_TITLE_MATCH", cross["reasons"])

    async def test_scanned_isbn_gets_the_ean_a_store_lists_the_same_edition_under(self):
        from cache import isbn_lookup_cache
        from main import IsbnLookupRequest, lookup_book_by_isbn
        isbn, ean = "9786043757903", "8935325018732"
        identity = {"title": "Hoàng Tử Bé", "subtitle": None, "authors": ["Antoine de Saint-Exupéry"], "translator": [],
                    "publisher": "NXB Phụ Nữ Việt Nam", "publishedDate": "2022", "description": None, "categories": [],
                    "language": "vi", "pageCount": 104, "thumbnail": None, "sourceUrl": "https://vanlang.test/p"}

        async def by_isbn(_client, code):
            return {**identity, "identifiers": [isbn]} if code == isbn else None

        async def by_title(_client, _title, _author):  # the store sells it under its retail EAN-13
            return [{**identity, "identifiers": [ean], "sourceUrl": "https://store.test/hoang-tu-be"}]
        providers = [isbn_rounds.BookProvider("vanLang", by_code=by_isbn, round1=True, accepts_raw_barcode=True, retries=0),
                     isbn_rounds.BookProvider("tiki", by_title=by_title, retries=0)]
        isbn_lookup_cache.clear()
        try:
            with patch("main.ENABLE_MARKETPLACE_LOOKUP", True), patch("main._book_providers", return_value=providers), \
                 patch("main.ISBN_ROUND1_ORDER", "vanLang"), patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", False):
                result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=isbn))
        finally:
            isbn_lookup_cache.clear()
        cross = result["crossLookup"]
        self.assertEqual(result["isbn13"], isbn)
        self.assertEqual((cross["direction"], cross["status"], cross["value"]), ("ISBN_TO_EAN", "REVIEW_REQUIRED", ean))
        self.assertEqual(cross["candidates"][0]["sources"], ["tiki"])

    async def test_an_unreachable_register_is_reported_and_cached_briefly_not_as_not_found(self):
        import library_providers
        from cache import isbn_lookup_cache
        from main import ISBN_INCOMPLETE_CACHE_TTL_SECONDS, IsbnLookupRequest, _isbn_cache_ttl, lookup_book_by_isbn
        product = {"title": "NVIDIA - Cỗ Máy Tư Duy Vĩ Đại", "variants": [{"barcode": "8936230471834"}],
                   "body_html": "<p>Tác giả: Stephen Witt</p><p>Nhà xuất bản: Công Thương</p>"}

        async def by_code(_client, code):
            return bp.parse_feed_store_product(product, "https://store.test/p") if code == "8936230471834" else None
        calls = []

        async def overloaded(_client, query):
            calls.append(query)
            request = httpx.Request("GET", "https://ppdvn.test")
            raise httpx.HTTPStatusError("busy", request=request, response=httpx.Response(429, request=request))
        providers = [isbn_rounds.BookProvider("azVietnam", by_code=by_code, round1=True, accepts_raw_barcode=True, retries=0),
                     isbn_rounds.BookProvider("ppdvn", by_title=None, retries=0)]
        isbn_lookup_cache.clear()
        isbn_rounds.reset_politeness_state()
        try:
            with patch("main.ENABLE_MARKETPLACE_LOOKUP", True), patch("main._book_providers", return_value=providers), \
                 patch("main.ISBN_ROUND1_ORDER", "azVietnam"), patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", False), \
                 patch.object(library_providers, "ppdvn_search", overloaded):
                result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="8936230471834"))
        finally:
            isbn_lookup_cache.clear()
            isbn_rounds.reset_politeness_state()
        cross = result["crossLookup"]
        self.assertEqual(cross["status"], "NOT_FOUND")
        self.assertIn("REGISTRY_UNAVAILABLE", cross["reasons"])
        self.assertEqual(len(calls), 1)  # a 429 pauses the register: no further title variant is sent
        self.assertEqual(_isbn_cache_ttl(result), ISBN_INCOMPLETE_CACHE_TTL_SECONDS)


if __name__ == "__main__":
    unittest.main()
