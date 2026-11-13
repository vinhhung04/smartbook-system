"""Adapters for Vietnamese publisher/bookstore sites used by the two-round
ISBN search (isbn_rounds.py). Verified live on 2026-11-12 - see
BOOK_DATA_SOURCE_AUDIT.md for the evidence and the robots.txt review.

- Đinh Tị Books (dinhtibooks.com.vn): server-rendered site, no robots.txt.
  Its own search (/search/<keyword>.html) matches the printed barcode, and the
  product page lists "Mã sản phẩm" - so it can identify a book (Round 1).
- Nhã Nam (Sapo), Thái Hà and Văn Lang (Haravan): robots.txt disallows /search,
  so these are never searched. Their sitemap.xml (allowed, with the product
  name in <image:title>) is used to find a title, then the product's public
  `<url>.js` JSON (allowed) is read. Title search only -> Round 2.

Every function takes the caller's httpx client and raises on HTTP errors;
isbn_rounds.call_with_retry owns timeouts, retries and error isolation.
"""
from __future__ import annotations

import asyncio
import html as html_module
import os
import re
import time
from dataclasses import dataclass
from typing import Callable
from urllib.parse import quote

import httpx

import isbn_matching
from metadata_intelligence.capture import capture as capture_metadata_source

SITEMAP_TTL_SECONDS = int(os.getenv("BOOKSTORE_SITEMAP_TTL_SECONDS", "86400"))
TITLE_CANDIDATES = 3


def html_to_text(fragment: str | None, limit: int = 4000) -> str | None:
    if not fragment:
        return None
    text = re.sub(r"<(br|/p|/li|/div|/h\d)[^>]*>", "\n", str(fragment), flags=re.IGNORECASE)
    text = html_module.unescape(re.sub(r"<[^>]+>", " ", text)).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    text = "\n".join(line for line in lines if line).strip()
    return text[:limit] or None


def _split_names(value: str | None) -> list[str]:
    names = []
    for part in re.split(r"[;,]", value or ""):
        part = re.sub(r"^[^:]{1,20}:\s*", "", part.strip())  # "Biên soạn: X" -> "X"
        if part and part.lower() not in ("đang cập nhật", "nhiều tác giả"):
            names.append(part)
    return names


def _https(url: str | None) -> str | None:
    if isinstance(url, str) and url.startswith("//"):
        return "https:" + url
    return url or None


def _page_count(value) -> int | None:
    digits = "".join(filter(str.isdigit, str(value or "")))
    return int(digits) if digits and int(digits) < 20000 else None


def complete_ean13(code: str) -> str:
    """Phương Nam stores many barcodes as the first 12 digits of the EAN-13 (no check
    digit), e.g. 978604239806 for 9786042398060. Only book (978/979) and Vietnamese
    (893) prefixes are completed - a 12-digit UPC-A is a different code."""
    if len(code) != 12 or not code.isdigit() or code[:3] not in ("978", "979", "893"):
        return code
    total = sum(int(digit) * (3 if i % 2 else 1) for i, digit in enumerate(code))
    return code + str((10 - total % 10) % 10)


def _variant_codes(product: dict) -> list[str]:
    codes = []
    for variant in product.get("variants") or []:
        for key in ("barcode", "sku"):
            code = complete_ean13(isbn_matching.normalize_code(variant.get(key)))
            if len(code) in (10, 13) and code not in codes:
                codes.append(code)
    return codes


# ── Đinh Tị Books ─────────────────────────────────────────────────────────────

DINHTI_BASE_URL = "https://dinhtibooks.com.vn"
_DINHTI_PRODUCT_LINK = re.compile(r"https://dinhtibooks\.com\.vn/[^\"'\s<>]*-dp\d+\.html")
_DINHTI_SPECS = {
    "mã sản phẩm": "code", "tác giả": "authors", "dịch giả": "translator",
    "nhà xuất bản": "publisher", "năm xuất bản": "publishedDate", "số trang": "pageCount",
}


def parse_dinhti_product(page: str, url: str) -> dict | None:
    title_match = re.search(r'<h1 class="name">\s*([^<]+)', page)
    if not title_match:
        return None
    info = page[page.find('class="info-prd"'):page.find('class="price-share"')] if 'class="info-prd"' in page else page
    specs: dict = {}
    for label, value in re.findall(r"<li>\s*([^<:]{2,30}):\s*([^<]*?)\s*</li>", info, flags=re.DOTALL):
        key = _DINHTI_SPECS.get(re.sub(r"\s+", " ", label).strip().lower())
        if key:
            specs[key] = html_module.unescape(re.sub(r"\s+", " ", value)).strip()
    description = None
    marker = page.find("Mô tả sản phẩm</p>")
    if marker >= 0:
        block = page[marker + len("Mô tả sản phẩm</p>"):marker + 20000]
        block = re.split(r'<div class="block-|<div class="row (?:related|comment)', block)[0]
        description = html_to_text(block)
    # The gallery's first slide is the real cover; og:image often points at a
    # missing "/original/...png" file (404 on 2026-11-12), so it is only a fallback.
    image = (re.search(r'<img class="mySlides" src="([^"]+)"', page)
             or re.search(r'<meta property="og:image" content="([^"]+)"', page))
    code = isbn_matching.normalize_code(specs.get("code"))
    return {
        "title": html_module.unescape(title_match.group(1)).strip(),
        "subtitle": None,
        "authors": _split_names(specs.get("authors")),
        "translator": _split_names(specs.get("translator")),
        "publisher": specs.get("publisher") or None,
        "publishedDate": specs.get("publishedDate") or None,
        "description": description,
        "categories": [],
        "language": "vi",
        "pageCount": _page_count(specs.get("pageCount")),
        "thumbnail": image.group(1) if image else None,
        "identifiers": [code] if code else [],
        "sourceUrl": url,
        "sourceFetchMode": "html",
    }


async def _dinhti_search(client: httpx.AsyncClient, keyword: str, limit: int) -> list[str]:
    path = quote(re.sub(r"\s+", "+", keyword.strip()), safe="+")
    resp = await client.get(f"{DINHTI_BASE_URL}/search/{path}.html")
    resp.raise_for_status()
    return list(dict.fromkeys(_DINHTI_PRODUCT_LINK.findall(resp.text)))[:limit]


async def _dinhti_product(client: httpx.AsyncClient, url: str) -> dict | None:
    resp = await client.get(url)
    resp.raise_for_status()
    capture_metadata_source("dinhTi", "html", resp.text, url)
    return parse_dinhti_product(resp.text, url)


async def dinhti_by_code(client: httpx.AsyncClient, code: str) -> dict | None:
    """First search hit whose "Mã sản phẩm" is the code; else the first hit
    (so the caller can report a MISMATCH); None when the search is empty."""
    first = None
    for url in await _dinhti_search(client, code, 2):
        data = await _dinhti_product(client, url)
        if data and code in data["identifiers"]:
            return data
        first = first or data
    return first


async def dinhti_by_title(client: httpx.AsyncClient, title: str, author: str | None) -> list[dict]:
    results = []
    for url in await _dinhti_search(client, title, TITLE_CANDIDATES):
        data = await _dinhti_product(client, url)
        if data:
            results.append(data)
    return results


# ── Bizbooks (WooCommerce) ─────────────────────────────────────────────────────
# The public WooCommerce Store API (robots.txt allows /wp-json/, checked 2026-11-13)
# matches `search` against the SKU too, which Bizbooks sets to "#<barcode>". The
# site's own ?s= search does not. Items carry no author/publisher attributes.

BIZBOOKS_STORE_API = "https://bizbooks.vn/wp-json/wc/store/v1/products"


def parse_bizbooks_product(item: dict) -> dict:
    code = isbn_matching.normalize_code(item.get("sku"))
    images = item.get("images") or []
    categories = [c.get("name") for c in item.get("categories") or [] if c.get("name")]
    return {
        "title": html_module.unescape(item.get("name") or "").strip() or None,
        "subtitle": None,
        "authors": [],
        "translator": [],
        "publisher": None,
        "publishedDate": None,
        "description": html_to_text(item.get("description") or item.get("short_description")),
        "categories": categories,
        "language": "vi",
        "pageCount": None,
        "thumbnail": _https(images[0].get("src")) if images else None,
        "identifiers": [code] if len(code) in (10, 13) else [],
        "sourceUrl": item.get("permalink"),
        "sourceFetchMode": "json",
    }


async def _bizbooks_search(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
    resp = await client.get(BIZBOOKS_STORE_API, params={"search": query, "per_page": limit})
    resp.raise_for_status()
    items = resp.json()
    capture_metadata_source("bizbooks", "json", items, str(resp.url))
    return [parse_bizbooks_product(item) for item in items if isinstance(item, dict)] if isinstance(items, list) else []


async def bizbooks_by_code(client: httpx.AsyncClient, code: str) -> dict | None:
    """The item whose SKU is the code; else the first hit (reported as MISMATCH)."""
    results = await _bizbooks_search(client, code, 5)
    return next((r for r in results if code in r["identifiers"]), results[0] if results else None)


async def bizbooks_by_title(client: httpx.AsyncClient, title: str, author: str | None) -> list[dict]:
    return await _bizbooks_search(client, title, TITLE_CANDIDATES)


# ── Sitemap-indexed stores (Sapo / Haravan) ───────────────────────────────────

# Labels of the spec block some stores put in the product description, e.g.
# "Mã sản phẩm: 8935074112750 Tác giả: Alan Watts Dịch giả: Hạnh Duyên Nhà xuất bản:
# NXB Hồng Đức ... Số trang: 172". Only "Label:" pairs are read - never prose.
_SPEC_LABELS = {
    "mã sản phẩm": "code", "tác giả": "authors", "dịch giả": "translator", "người dịch": "translator",
    "nhà xuất bản": "publisher", "nxb": "publisher", "năm xuất bản": "publishedDate", "năm xb": "publishedDate",
    "số trang": "pageCount",
}
_ALL_SPEC_LABELS = (
    "Mã sản phẩm", "Tác giả", "Dịch giả", "Người dịch", "Nhà xuất bản", "Nhà phát hành", "Năm xuất bản",
    "Năm XB", "NXB", "Ngày xuất bản", "Số trang", "Trọng lượng", "Kích thước", "Hình thức", "Độ tuổi", "Loại bìa",
)
_SPEC_PATTERN = re.compile(
    r"(" + "|".join(map(re.escape, _ALL_SPEC_LABELS)) + r")\s*:\s*(.*?)(?=\s*(?:"
    + "|".join(map(re.escape, _ALL_SPEC_LABELS)) + r")\s*:|\n|$)",
    flags=re.IGNORECASE,
)


def labelled_specs(text: str | None) -> dict:
    """Values of a real spec block only: at least two different labels must be
    present (a lone "Tác giả:" heading over a biography is prose, not a spec),
    and names must be short enough to be names."""
    pairs = _SPEC_PATTERN.findall(text or "")
    if len({label.strip().lower() for label, _ in pairs}) < 2:
        return {}
    specs: dict = {}
    for label, value in pairs:
        key = _SPEC_LABELS.get(label.strip().lower())
        value = re.sub(r"\s+", " ", value).strip(" .;,")
        if not key or not value or key in specs:
            continue
        if key in ("authors", "translator", "publisher") and (len(value) > 80 or len(value.split()) > 10):
            continue
        specs[key] = value
    return specs


def spec_text(fragment: str | None) -> str | None:
    """Description HTML as text where a table row <td>Tác giả</td><td>Naran</td>
    reads "Tác giả: Naran", so labelled_specs() also understands spec tables."""
    if not fragment:
        return None
    fragment = re.sub(r"</t[dh]>\s*<t[dh][^>]*>", ": ", str(fragment), flags=re.IGNORECASE)
    return html_to_text(fragment, limit=20000)


# Tag conventions: IPM "tacgia_Shinkai Makoto" / "nhaxb_Hồng Đức" / "namxb_2017";
# Nhã Nam "Tác giả Paulo Coelho" / "Số trang 228" / "Ngày phát hành 2020".
_TAG_PREFIXES = (
    ("tacgia_", "authors"), ("dichgia_", "translator"), ("nhaxb_", "publisher"), ("namxb_", "publishedDate"),
    ("sotrang_", "pageCount"), ("tác giả ", "authors"), ("dịch giả ", "translator"),
    ("nhà xuất bản ", "publisher"), ("ngày phát hành ", "publishedDate"), ("số trang ", "pageCount"),
)


def _tags_list(tags) -> list[str]:
    if isinstance(tags, str):
        return [t.strip() for t in tags.split(",") if t.strip()]
    return [str(t).strip() for t in tags or [] if str(t).strip()]


def tag_specs(tags) -> dict:
    out: dict = {}
    for tag in _tags_list(tags):
        lowered = tag.lower()
        for prefix, key in _TAG_PREFIXES:
            if lowered.startswith(prefix) and key not in out:
                value = tag[len(prefix):].strip()
                if value:
                    out[key] = value
    return out


def _strip_title(name: str, suffix: str | None = None) -> str:
    name = re.sub(r"^\s*\[[^\]]*\]\s*[-–:]?\s*", "", str(name or ""))  # "[ĐẶT TRƯỚC] - ..."
    name = re.sub(r"^\s*Sách\s*[-:]\s*", "", name)  # "Sách - Trao Gửi Yêu Thương", "Sách: ..." (Minh Long)
    name = re.sub(r"\s*\(\s*(?:TB|tái bản)[^)]*\)\s*$", "", name, flags=re.IGNORECASE)
    if suffix:
        name = re.sub(rf"\s*-\s*{suffix}\s*$", "", name, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", name).strip()


def parse_nhanam_product(product: dict, url: str) -> dict:
    """Sapo product JSON; facts live in tags like "Tác giả X", "Số trang 228"."""
    tags = {"authors": [], "pageCount": None, "publishedDate": None, "publisher": None}
    for tag in product.get("tags") or []:
        text = str(tag).strip()
        lowered = text.lower()
        if lowered.startswith("tác giả "):
            tags["authors"].extend(_split_names(text[8:]))
        elif lowered.startswith("số trang "):
            tags["pageCount"] = _page_count(text[9:])
        elif lowered.startswith("ngày phát hành "):
            tags["publishedDate"] = text[15:].strip() or None
        elif lowered.startswith("nhà xuất bản "):
            tags["publisher"] = text[13:].strip() or None
    return {
        "title": _strip_title(product.get("name") or product.get("title")) or None,
        "subtitle": None,
        "authors": tags["authors"],
        "translator": [],
        "publisher": tags["publisher"],  # `vendor` is the distributor, not the NXB
        "publishedDate": tags["publishedDate"],
        "description": html_to_text(product.get("content") or product.get("description")),
        "categories": [product["product_type"]] if product.get("product_type") else [],
        "language": "vi",
        "pageCount": tags["pageCount"],
        "thumbnail": _https(product.get("featured_image")),
        "identifiers": _variant_codes(product),
        "sourceUrl": url,
        "sourceFetchMode": "json",
    }


def parse_vanlang_product(product: dict, url: str) -> dict:
    """Haravan JSON: real barcode in variants; author/translator/publisher/pages
    only when the description carries the labelled spec block (never from prose)."""
    category = product.get("type") or product.get("product_type")
    description = html_to_text(product.get("description") or product.get("body_html") or product.get("content"))
    specs = labelled_specs(description)
    return {
        "title": _strip_title(product.get("title") or product.get("name"), "vanlangbooks") or None,
        "subtitle": None,
        "authors": _split_names(specs.get("authors")),
        "translator": _split_names(specs.get("translator")),
        "publisher": specs.get("publisher"),
        "publishedDate": specs.get("publishedDate"),
        "description": description,
        "categories": [category] if category else [],
        "language": "vi", "pageCount": _page_count(specs.get("pageCount")),
        "thumbnail": _https(product.get("featured_image")),
        "identifiers": _variant_codes(product),
        "sourceUrl": url,
        "sourceFetchMode": "json",
    }


def parse_thaiha_product(product: dict, url: str) -> dict:
    """Haravan JSON: `vendor` holds the author names; no barcode on most products."""
    category = product.get("type") or product.get("product_type")
    description = html_to_text(product.get("description") or product.get("body_html") or product.get("content"))
    specs = labelled_specs(description)
    return {
        "title": _strip_title(product.get("title") or product.get("name")) or None,
        "subtitle": None,
        "authors": _split_names(product.get("vendor") or specs.get("authors")),  # vendor is the author here
        "translator": _split_names(specs.get("translator")),
        "publisher": specs.get("publisher"),
        "publishedDate": specs.get("publishedDate"),
        "description": description,
        "categories": [category] if category and category.lower() != "sách" else [],
        "language": "vi", "pageCount": _page_count(specs.get("pageCount")),
        "thumbnail": _https(product.get("featured_image")),
        "identifiers": _variant_codes(product),
        "sourceUrl": url,
        "sourceFetchMode": "json",
    }


def _first_image(product: dict) -> str | None:
    image = product.get("featured_image") or (product.get("image") or {}).get("src")
    if not image and product.get("images"):
        first = product["images"][0]
        image = first.get("src") if isinstance(first, dict) else first
    return _https(image)


def parse_feed_store_product(product: dict, url: str, *, title_suffix: str | None = None,
                             vendor_is_author: bool = False) -> dict:
    """Any Haravan/Sapo publisher store: facts from prefixed tags (IPM, Nhã Nam),
    a labelled spec block or spec table in the description, and - only for the
    stores where it is the author - the `vendor` field. Nothing is read from prose."""
    raw_description = product.get("description") or product.get("body_html") or product.get("content")
    specs = {**labelled_specs(spec_text(raw_description)), **tag_specs(product.get("tags"))}
    authors = specs.get("authors") or (product.get("vendor") if vendor_is_author else None)
    category = product.get("type") or product.get("product_type")
    return {
        "title": _strip_title(product.get("title") or product.get("name"), title_suffix) or None,
        "subtitle": None,
        "authors": _split_names(authors),
        "translator": _split_names(specs.get("translator")),
        "publisher": specs.get("publisher"),
        "publishedDate": specs.get("publishedDate"),
        "description": html_to_text(raw_description),
        "categories": [category] if category and category.lower() not in ("khác", "sách") else [],
        "language": "vi",
        "pageCount": _page_count(specs.get("pageCount")),
        "thumbnail": _first_image(product),
        "identifiers": _variant_codes(product),
        "sourceUrl": url,
        "sourceFetchMode": "json",
    }


def _feed_parser(**options):
    return lambda product, url: parse_feed_store_product(product, url, **options)


@dataclass(frozen=True)
class SitemapStore:
    name: str
    base_url: str
    parse: Callable[[dict, str], dict]


NHANAM = SitemapStore("nhanam", "https://nhanam.vn", parse_nhanam_product)
THAIHA = SitemapStore("thaiHa", "https://nhasachthaiha.vn", parse_thaiha_product)
VANLANG = SitemapStore("vanLang", "https://vanlang.vn", parse_vanlang_product)
# Publisher stores whose product feed carries barcodes (checked 2026-11-13; robots.txt
# allows /collections/all/products.json and the product JSON on every one of them).
IPM = SitemapStore("ipm", "https://ipm.vn", _feed_parser())
KIMDONG = SitemapStore("kimDong", "https://nxbkimdong.com.vn", _feed_parser())
AZVIETNAM = SitemapStore("azVietnam", "https://azvietnam.vn", _feed_parser())
OMEGAPLUS = SitemapStore("omegaPlus", "https://omegaplus.vn", _feed_parser())
TANVIET = SitemapStore("tanViet", "https://tanvietbooks.vn", _feed_parser(title_suffix="Tân Việt Books"))
ALPHABOOKS = SitemapStore("alphaBooks", "https://alphabooks.vn", _feed_parser(vendor_is_author=True))
# Bookstore chains (checked 2026-11-13, same robots rules: /search disallowed, feed and
# product JSON allowed). Their feeds also list stationery and toys; only a scanned
# code that is in the index is ever read. Vendor is the supplier there, not the author.
PHUONGNAM = SitemapStore("phuongNam", "https://nhasachphuongnam.com", _feed_parser())
NHANVAN = SitemapStore("nhanVan", "https://nhanvan.vn", _feed_parser())
MINHLONG = SitemapStore("minhLong", "https://minhlongbook.vn", _feed_parser())
FEED_ONLY_STORES = (IPM, KIMDONG, AZVIETNAM, OMEGAPLUS, TANVIET, ALPHABOOKS, PHUONGNAM, NHANVAN, MINHLONG)

_sitemap_cache: dict[str, tuple[float, list[tuple[str, str]]]] = {}
_sitemap_locks: dict[str, asyncio.Lock] = {}


def parse_sitemap_entries(xml: str) -> list[tuple[str, str]]:
    """[(product url, product name)] from a product sitemap with <image:title>."""
    entries = []
    for block in re.findall(r"<url>(.*?)</url>", xml, flags=re.DOTALL):
        loc = re.search(r"<loc>([^<]+)</loc>", block)
        title = re.search(r"<image:title>([^<]*)</image:title>", block)
        if loc and title and title.group(1).strip():
            entries.append((html_module.unescape(loc.group(1)).strip(), html_module.unescape(title.group(1)).strip()))
    return entries


async def sitemap_entries(client: httpx.AsyncClient, store: SitemapStore) -> list[tuple[str, str]]:
    cached = _sitemap_cache.get(store.name)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    lock = _sitemap_locks.setdefault(store.name, asyncio.Lock())
    async with lock:
        cached = _sitemap_cache.get(store.name)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        index = await client.get(f"{store.base_url}/sitemap.xml")
        index.raise_for_status()
        children = [html_module.unescape(u) for u in re.findall(r"<loc>([^<]+)</loc>", index.text)]
        entries: list[tuple[str, str]] = []
        for child in (u for u in children if "product" in u.lower()):
            resp = await client.get(child)
            resp.raise_for_status()
            entries.extend(parse_sitemap_entries(resp.text))
        if entries:  # never cache an empty/failed download
            _sitemap_cache[store.name] = (time.monotonic() + SITEMAP_TTL_SECONDS, entries)
        return entries


def rank_by_title(entries: list[tuple[str, str]], title: str, limit: int = TITLE_CANDIDATES) -> list[str]:
    scored = sorted(
        ((isbn_matching.title_similarity(title, name), url) for url, name in entries),
        key=lambda item: -item[0],
    )
    return [url for score, url in scored[:limit] if score >= 0.9]


async def sitemap_by_title(store: SitemapStore, client: httpx.AsyncClient, title: str, author: str | None) -> list[dict]:
    results = []
    for url in rank_by_title(await sitemap_entries(client, store), title):
        resp = await client.get(url + ".js")
        resp.raise_for_status()
        product = resp.json() or {}
        capture_metadata_source(store.name, "json", product, url + ".js")
        results.append(store.parse(product, url))
    return results


def title_search(store: SitemapStore):
    async def search(client: httpx.AsyncClient, title: str, author: str | None) -> list[dict]:
        return await sitemap_by_title(store, client, title, author)
    search.__name__ = f"{store.name}_by_title"
    return search


# ── Barcode index (Round 1 for the sitemap stores) ────────────────────────────
# /search is robots-disallowed on these stores, but their public product feed
# /collections/all/products.json (allowed; 50 products/page on Haravan, 250 on
# Sapo) lists every product with its variant barcode. A background job reads it
# once a day, slowly, and keeps only code -> product URL; a scanned code that is
# in the index costs one request for that product's JSON.

CODE_INDEX_ENABLED = os.getenv("ENABLE_BOOKSTORE_CODE_INDEX", "true").lower() == "true"
CODE_INDEX_TTL_SECONDS = int(os.getenv("BOOKSTORE_CODE_INDEX_TTL_SECONDS", "86400"))
CODE_INDEX_PAGE_DELAY_SECONDS = float(os.getenv("BOOKSTORE_CODE_INDEX_PAGE_DELAY_SECONDS", "1.0"))
CODE_INDEX_MAX_PAGES = 400
CODE_INDEX_STORES = (NHANAM, VANLANG, THAIHA) + FEED_ONLY_STORES

_code_index: dict[str, dict] = {}  # store -> {"codes": {code: url}, "titles": [(url, title)], "products", "builtAt"}


class CodeIndexNotReady(RuntimeError):
    """The store's barcode index has not been built yet (first minutes after start)."""


def _listing_url(store: SitemapStore, product: dict) -> str | None:
    if product.get("handle"):  # Haravan
        return f"{store.base_url}/products/{product['handle']}"
    path = product.get("url") or (f"/{product['alias']}" if product.get("alias") else None)  # Sapo
    return f"{store.base_url}{path}" if path and path.startswith("/") else None


async def build_code_index(client: httpx.AsyncClient, store: SitemapStore) -> dict:
    """{"codes": {code: url}, "titles": [(url, title)], "products": n} from the
    store's paginated product feed."""
    codes: dict[str, str] = {}
    titles: list[tuple[str, str]] = []
    seen, previous_first, truncated = 0, None, True
    for page in range(1, CODE_INDEX_MAX_PAGES + 1):
        resp = await client.get(f"{store.base_url}/collections/all/products.json", params={"limit": 250, "page": page})
        resp.raise_for_status()
        products = (resp.json() or {}).get("products") or []
        if not products or products[0].get("id") == previous_first:
            truncated = False
            break  # past the last page (or a feed that repeats its last page)
        previous_first = products[0].get("id")
        seen += len(products)
        for product in products:
            url = _listing_url(store, product)
            if not url:
                continue
            for code in _variant_codes(product):
                codes.setdefault(code, url)
            name = product.get("title") or product.get("name")
            if name:
                titles.append((url, str(name)))
        await asyncio.sleep(CODE_INDEX_PAGE_DELAY_SECONDS)
    # truncated: the feed is longer than CODE_INDEX_MAX_PAGES (Phương Nam, Nhân Văn:
    # ~20k products at 50/page), so the index may miss products past that page.
    return {"codes": codes, "titles": titles, "products": seen, "truncated": truncated}


async def refresh_code_index(store: SitemapStore, user_agent: str | None = None) -> dict:
    headers = {"User-Agent": user_agent} if user_agent else None
    async with httpx.AsyncClient(timeout=httpx.Timeout(30), headers=headers, follow_redirects=True) as client:
        built = await build_code_index(client, store)
    if built["codes"]:  # an empty/failed crawl never replaces a good index
        _code_index[store.name] = {**built, "builtAt": time.time()}
    return {"store": store.name, "codes": len(built["codes"]), "products": built["products"],
            "truncated": built.get("truncated", False)}


async def refresh_code_indexes_forever(user_agent: str | None, logger) -> None:
    """Background task started with the service: build every store index (stores
    in parallel - each host is still read one page at a time), then refresh
    daily. A store that blocks or fails keeps its previous index and is retried
    after an hour."""
    async def refresh(store: SitemapStore) -> bool:
        try:
            summary = await refresh_code_index(store, user_agent)
            logger.info("bookstore code index %s: %d codes from %d products%s",
                        store.name, summary["codes"], summary["products"],
                        f" (truncated at {CODE_INDEX_MAX_PAGES} pages)" if summary["truncated"] else "")
            return True
        except Exception as exc:  # noqa: BLE001 - one store must not stop the others
            logger.warning("bookstore code index %s not refreshed: %s", store.name, exc)
            return False

    while True:
        results = await asyncio.gather(*(refresh(store) for store in CODE_INDEX_STORES))
        await asyncio.sleep(CODE_INDEX_TTL_SECONDS if all(results) else 3600)


def code_index_status() -> dict:
    return {name: {"codes": len(entry["codes"]), "products": entry["products"], "builtAt": entry["builtAt"]}
            for name, entry in _code_index.items()}


def code_search(store: SitemapStore):
    async def search(client: httpx.AsyncClient, code: str) -> dict | None:
        index = _code_index.get(store.name)
        if index is None:
            raise CodeIndexNotReady(f"{store.name} barcode index is still being built")
        url = index["codes"].get(code)
        if not url:
            return None
        resp = await client.get(url + ".js")
        resp.raise_for_status()
        product = resp.json() or {}
        capture_metadata_source(store.name, "json", product, url + ".js")
        return store.parse(product, url)
    search.__name__ = f"{store.name}_by_code"
    return search


def index_title_search(store: SitemapStore):
    """Round 2 title search over the product names the feed index already holds
    (no sitemap needed); reads the JSON of at most TITLE_CANDIDATES products."""
    async def search(client: httpx.AsyncClient, title: str, author: str | None) -> list[dict]:
        index = _code_index.get(store.name)
        if index is None:
            raise CodeIndexNotReady(f"{store.name} product index is still being built")
        results = []
        for url in rank_by_title(index.get("titles") or [], title):
            resp = await client.get(url + ".js")
            resp.raise_for_status()
            product = resp.json() or {}
            capture_metadata_source(store.name, "json", product, url + ".js")
            results.append(store.parse(product, url))
        return results
    search.__name__ = f"{store.name}_by_title"
    return search
