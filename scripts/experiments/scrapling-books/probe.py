"""Thử nghiệm Scrapling cho tra cứu sách theo mã (ISBN/EAN) trên các nguồn SmartBook đang dùng.

Mỗi nguồn là một adapter, chạy song song; mọi kết quả đều qua cùng một phép kiểm:
chỉ CODE_MATCH khi mã in trên trang/bản ghi đúng bằng mã đang tra.

  fahasa       StealthyFetcher mở /searchengine?q=<mã> (robots cho phép), Fetcher đọc trang sản phẩm
  dinhTi       Fetcher mở /search/<mã>.html rồi đọc trang sản phẩm ("Mã sản phẩm")
  bizbooks     Fetcher gọi Store API công khai của WooCommerce (search khớp cả SKU)
  googleBooks  Fetcher gọi Books API (q=isbn:<mã>), dùng GOOGLE_BOOKS_API_KEY nếu có
  openLibrary  Fetcher gọi /isbn/<mã>.json
  12 nhà sách  robots.txt cấm /search nên chỉ đọc feed /collections/all/products.json:
               dựng chỉ mục mã vạch một lần, cache 24 giờ trong /cache
               (9 nguồn ai-service đang dùng + Phương Nam, Nhân Văn, Minh Long)
  tiki         chỉ tìm được theo tên: chạy sau, với tên sách các nguồn trên đã xác minh

Không bắt API nội bộ, không giải Cloudflare (solve_cloudflare=False). Mọi trang web đều
được kiểm robots.txt trước khi đọc; mỗi host được giãn cách tối thiểu HOST_DELAY_SECONDS.

Cách chạy: xem README.md cùng thư mục.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote, urlparse

from protego import Protego
from scrapling.fetchers import Fetcher, StealthyFetcher

HOST_DELAY_SECONDS = 1.5   # khoảng cách tối thiểu giữa hai request tới cùng một host
MAX_PAGES = 4              # số trang sản phẩm tối đa đọc cho mỗi nguồn, mỗi mã
CACHE_DIR = Path(os.getenv("PROBE_CACHE_DIR", "/cache"))
FEED_TTL_SECONDS = 24 * 3600
FEED_MAX_PAGES = 400
GOOGLE_BOOKS_API_KEY = os.getenv("GOOGLE_BOOKS_API_KEY", "")

FEED_STORES = {
    "nhanam": "https://nhanam.vn", "thaiHa": "https://nhasachthaiha.vn", "vanLang": "https://vanlang.vn",
    "ipm": "https://ipm.vn", "kimDong": "https://nxbkimdong.com.vn", "azVietnam": "https://azvietnam.vn",
    "omegaPlus": "https://omegaplus.vn", "tanViet": "https://tanvietbooks.vn", "alphaBooks": "https://alphabooks.vn",
    # Nguồn mới (chưa có trong ai-service), cùng kiểu feed Haravan/Sapo:
    "phuongNam": "https://nhasachphuongnam.com", "nhanVan": "https://nhanvan.vn", "minhLong": "https://minhlongbook.vn",
}
SOURCES = ["fahasa", "dinhTi", "bizbooks", "googleBooks", "openLibrary", *FEED_STORES]

FAHASA_LABELS = {
    "mã hàng": "code", "tác giả": "authors", "người dịch": "translator", "nxb": "publisher",
    "năm xb": "publishedDate", "số trang": "pageCount",
}
DINHTI_LABELS = {
    "mã sản phẩm": "code", "tác giả": "authors", "dịch giả": "translator",
    "nhà xuất bản": "publisher", "năm xuất bản": "publishedDate", "số trang": "pageCount",
}


class Blocked(Exception):
    """403/429/503 hoặc trang kiểm tra Cloudflare."""


class RobotsDisallowed(Exception):
    """robots.txt của site cấm đường dẫn này."""


# ── HTTP lịch sự: robots.txt + giãn cách theo host ─────────────────────────────

_robots: dict[str, Protego | None] = {}
_host_locks: dict[str, threading.Lock] = {}
_host_last: dict[str, float] = {}
_registry_lock = threading.Lock()


def _wait_turn(host: str) -> None:
    with _registry_lock:
        lock = _host_locks.setdefault(host, threading.Lock())
    with lock:
        delay = _host_last.get(host, 0) + HOST_DELAY_SECONDS - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        _host_last[host] = time.monotonic()


def _check_robots(url: str) -> None:
    parts = urlparse(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    with _registry_lock:
        known = origin in _robots
    if not known:
        _wait_turn(parts.netloc)
        resp = Fetcher.get(f"{origin}/robots.txt", impersonate="chrome", timeout=15)
        # RFC 9309: 4xx = không có giới hạn; 5xx = coi như cấm toàn bộ.
        if resp.status == 200:
            rules = Protego.parse(resp.body.decode("utf-8", "replace"))
        else:
            rules = Protego.parse("User-agent: *\nDisallow: /") if resp.status >= 500 else None
        with _registry_lock:
            _robots[origin] = rules
    rules = _robots[origin]
    if rules is not None and not rules.can_fetch(url, "*"):
        raise RobotsDisallowed(url)


def _blocked(page) -> bool:
    title = _clean(page.css("title::text").get()).lower()
    return page.status in (403, 429, 503) or "just a moment" in title or "attention required" in title


def get(url: str, *, robots: bool = True, **kwargs):
    """Fetcher.get có kiểm robots.txt và giãn cách; 403/429/503 thành Blocked."""
    if robots:
        _check_robots(url)
    _wait_turn(urlparse(url).netloc)
    page = Fetcher.get(url, impersonate="chrome", timeout=20, **kwargs)
    if page.status in (403, 429, 503) or (page.status == 200 and _blocked(page)):
        raise Blocked(f"HTTP {page.status}")
    return page


def browser_get(url: str, wait_selector: str):
    _check_robots(url)
    _wait_turn(urlparse(url).netloc)
    page = StealthyFetcher.fetch(url, headless=True, wait_selector=wait_selector, disable_resources=True,
                                 timeout=45_000, solve_cloudflare=False)
    if _blocked(page):
        raise Blocked(f"HTTP {page.status}")
    return page


# ── Tiện ích ────────────────────────────────────────────────────────────────────

def _clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _text(node) -> str:
    return _clean(" ".join(node.xpath(".//text()").getall()))


def _fold(text: str | None) -> str:
    """So khớp tên không dấu, không phân biệt hoa thường."""
    text = unicodedata.normalize("NFD", (text or "").lower().replace("đ", "d"))
    return _clean(re.sub(r"[^a-z0-9 ]", " ", "".join(c for c in text if not unicodedata.combining(c))))


def _ean13(value: str) -> str:
    """Phương Nam lưu nhiều mã vạch 12 số (thiếu số kiểm tra cuối): tính lại theo EAN-13."""
    if len(value) != 12 or not value.isdigit():
        return value
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(value))
    return value + str((10 - total % 10) % 10)


def _verdict(code: str, record: dict) -> dict:
    record["status"] = "CODE_MATCH" if code in record.get("codes", []) else "MISMATCH"
    return record


def _first_match(code: str, records: list[dict]) -> dict:
    """Bản ghi khớp mã; nếu không có thì bản ghi đầu tiên (MISMATCH); rỗng thì NOT_FOUND."""
    checked = [_verdict(code, r) for r in records]
    return next((r for r in checked if r["status"] == "CODE_MATCH"), checked[0] if checked else {"status": "NOT_FOUND"})


# ── Adapter từng nguồn ──────────────────────────────────────────────────────────

def fahasa(code: str) -> dict:
    page = browser_get(f"https://www.fahasa.com/searchengine?q={quote(code)}", "ul.products-grid")
    hrefs = page.css('ul.products-grid a[href*="fhs_campaign=SEARCH"]::attr(href)').getall()
    urls = list(dict.fromkeys(page.urljoin(h).split("?")[0] for h in hrefs))[:MAX_PAGES]
    records = []
    for url in urls:  # Fahasa luôn kèm sách gợi ý; kết quả khớp mã đứng đầu
        product = get(url)
        specs = {}
        for th in product.xpath('//th[contains(@class, "table-label")]'):
            key = FAHASA_LABELS.get(_text(th).lower())
            value = _clean(" ".join(th.xpath("following-sibling::td[1]//text()").getall()))
            if key and value:
                specs.setdefault(key, value)
        records.append({"url": url, "title": _text(product.xpath("//h1")[0]) if product.xpath("//h1") else None,
                        "codes": [specs.pop("code")] if specs.get("code") else [], **specs})
        if code in records[-1]["codes"]:
            break
    return _first_match(code, records)


def dinhti(code: str) -> dict:
    page = get(f"https://dinhtibooks.com.vn/search/{quote(code)}.html")
    urls = [u for u in dict.fromkeys(page.css("a::attr(href)").getall()) if re.search(r"-dp\d+\.html$", u)]
    records = []
    for url in urls[:2]:
        product = get(page.urljoin(url))
        specs = {}
        for li in product.css(".info-prd li"):
            label, _, value = _text(li).partition(":")
            key = DINHTI_LABELS.get(label.strip().lower())
            if key and value.strip():
                specs.setdefault(key, value.strip())
        records.append({"url": page.urljoin(url), "title": _clean(product.css("h1.name::text").get()),
                        "codes": [specs.pop("code")] if specs.get("code") else [], **specs})
        if code in records[-1]["codes"]:
            break
    return _first_match(code, records)


def bizbooks(code: str) -> dict:
    """Store API công khai của WooCommerce: tham số search khớp cả SKU ("#8935...")."""
    data = get("https://bizbooks.vn/wp-json/wc/store/v1/products", params={"search": code, "per_page": 5}).json()
    records = []
    for item in data if isinstance(data, list) else []:
        attrs = {a.get("name", "").lower(): ", ".join(t.get("name", "") for t in a.get("terms") or [])
                 for a in item.get("attributes") or []}
        records.append({"url": item.get("permalink"), "title": item.get("name"),
                        "authors": attrs.get("tác giả"), "publisher": attrs.get("nhà xuất bản") or attrs.get("nxb"),
                        "codes": [re.sub(r"\D", "", item.get("sku") or "")]})
    return _first_match(code, records)


def google_books(code: str) -> dict:
    params = {"q": f"isbn:{code}", "maxResults": 3}
    if GOOGLE_BOOKS_API_KEY:
        params["key"] = GOOGLE_BOOKS_API_KEY
    data = get("https://www.googleapis.com/books/v1/volumes", robots=False, params=params).json() or {}
    records = []
    for item in data.get("items") or []:
        info = item.get("volumeInfo") or {}
        records.append({
            "url": info.get("infoLink"), "title": info.get("title"), "authors": ", ".join(info.get("authors") or []),
            "publisher": info.get("publisher"), "publishedDate": info.get("publishedDate"),
            "pageCount": info.get("pageCount"),
            "codes": [i.get("identifier") for i in info.get("industryIdentifiers") or []],
        })
    return _first_match(code, records)


def open_library(code: str) -> dict:
    page = get(f"https://openlibrary.org/isbn/{code}.json", robots=False, follow_redirects=True)
    if page.status == 404:
        return {"status": "NOT_FOUND"}
    data = page.json() or {}
    return _first_match(code, [{
        "url": f"https://openlibrary.org{data['key']}" if data.get("key") else None, "title": data.get("title"),
        "publisher": ", ".join(data.get("publishers") or []), "publishedDate": data.get("publish_date"),
        "pageCount": data.get("number_of_pages"), "codes": (data.get("isbn_13") or []) + (data.get("isbn_10") or []),
    }])


def _feed_index(name: str, base: str, refresh: bool) -> dict:
    """{mã: {url, title, vendor}} từ feed products.json của cửa hàng (Haravan/Sapo), cache 24 giờ."""
    path = CACHE_DIR / f"{name}.json"
    if not refresh and path.exists() and time.time() - path.stat().st_mtime < FEED_TTL_SECONDS:
        return json.loads(path.read_text(encoding="utf-8"))
    index: dict[str, dict] = {}
    previous_first = None
    for page_no in range(1, FEED_MAX_PAGES + 2):
        if page_no > FEED_MAX_PAGES:
            print(f"Cảnh báo: feed {name} dài hơn {FEED_MAX_PAGES} trang, chỉ mục bị cắt và có thể thiếu sách",
                  file=sys.stderr)
            break
        products = (get(f"{base}/collections/all/products.json", params={"limit": 250, "page": page_no}).json()
                    or {}).get("products") or []
        if not products or products[0].get("id") == previous_first:
            break  # hết trang (một số feed lặp lại trang cuối)
        previous_first = products[0].get("id")
        for product in products:
            handle = product.get("handle")
            path_part = f"/products/{handle}" if handle else product.get("url") or (
                f"/{product['alias']}" if product.get("alias") else None)
            entry = {"url": f"{base}{path_part}" if path_part else None,
                     "title": product.get("title") or product.get("name"), "vendor": product.get("vendor")}
            for variant in product.get("variants") or []:
                for key in ("barcode", "sku"):
                    value = _ean13(re.sub(r"[^0-9Xx]", "", str(variant.get(key) or "")))
                    if len(value) in (10, 13):
                        index.setdefault(value, entry)
    if index:  # feed lỗi/rỗng không ghi đè cache tốt
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    return index


def feed_store(name: str, base: str, code: str, refresh: bool) -> dict:
    hit = _feed_index(name, base, refresh).get(code)
    if not hit:
        return {"status": "NOT_FOUND"}
    return {"status": "CODE_MATCH", "codes": [code], **hit}


def tiki_by_title(title: str) -> dict:
    """Tiki không tìm được theo mã: chỉ báo các sản phẩm trùng tên (không xác minh được mã)."""
    data = get("https://tiki.vn/api/v2/products", params={"q": title, "limit": 5, "category": 8322}).json() or {}
    wanted = _fold(title)
    hits = [i for i in data.get("data") or [] if wanted and wanted in _fold(i.get("name"))]
    if not hits:
        return {"status": "NOT_FOUND"}
    return {"status": "TITLE_MATCH", "title": hits[0].get("name"), "candidates": len(hits),
            "url": f"https://tiki.vn/{hits[0]['url_path']}" if hits[0].get("url_path") else None}


# ── Điều phối ───────────────────────────────────────────────────────────────────

def run_source(source: str, code: str, refresh: bool) -> dict:
    start = time.monotonic()
    try:
        if source in FEED_STORES:
            result = feed_store(source, FEED_STORES[source], code, refresh)
        else:
            result = {"fahasa": fahasa, "dinhTi": dinhti, "bizbooks": bizbooks, "googleBooks": google_books,
                      "openLibrary": open_library}[source](code)
    except RobotsDisallowed as exc:
        result = {"status": "ROBOTS_DISALLOWED", "error": str(exc)}
    except Blocked as exc:
        result = {"status": "BLOCKED", "error": str(exc)}
    except Exception as exc:
        result = {"status": "ERROR", "error": f"{type(exc).__name__}: {exc}"[:300]}
    return {"source": source, **result, "ms": int((time.monotonic() - start) * 1000)}


def probe(code: str, sources: list[str], refresh: bool) -> dict:
    with ThreadPoolExecutor(max_workers=len(sources)) as pool:
        results = list(pool.map(lambda s: run_source(s, code, refresh), sources))
    matches = [r for r in results if r["status"] == "CODE_MATCH"]
    title = next((r["title"] for r in matches if r.get("title")), None)
    if title:  # vòng theo tên, giống Round 2 của ai-service
        start = time.monotonic()
        try:
            tiki = tiki_by_title(title)
        except RobotsDisallowed as exc:
            tiki = {"status": "ROBOTS_DISALLOWED", "error": str(exc)}
        except Exception as exc:
            tiki = {"status": "ERROR", "error": f"{type(exc).__name__}: {exc}"[:300]}
        results.append({"source": "tiki", **tiki, "ms": int((time.monotonic() - start) * 1000)})
    return {"code": code, "verdict": "FOUND" if matches else "NOT_FOUND", "title": title,
            "foundIn": [r["source"] for r in matches], "results": results}


def print_table(report: dict) -> None:
    print(f"\n=== {report['code']}  →  {report['verdict']}  {report['title'] or ''}")
    for r in report["results"]:
        detail = r.get("title") or r.get("error") or ""
        print(f"  {r['source']:<12} {r['status']:<18} {r['ms']:>6} ms  {_clean(str(detail))[:70]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Thử Scrapling trên các nguồn sách của SmartBook")
    parser.add_argument("codes", nargs="+", help="mã ISBN/EAN cần tra")
    parser.add_argument("--sources", help=f"chỉ chạy các nguồn này, cách nhau bằng dấu phẩy ({','.join(SOURCES)})")
    parser.add_argument("--json", action="store_true", help="in JSON đầy đủ thay vì bảng")
    parser.add_argument("--refresh-feeds", action="store_true", help="dựng lại chỉ mục feed, bỏ qua cache")
    args = parser.parse_args()

    sources = args.sources.split(",") if args.sources else SOURCES
    unknown = [s for s in sources if s not in SOURCES]
    if unknown:
        parser.error(f"nguồn không có: {', '.join(unknown)}")

    reports = []
    for code in args.codes:
        reports.append(probe(re.sub(r"[^0-9Xx]", "", code), sources, args.refresh_feeds))
        if args.json:
            print(json.dumps(reports[-1], ensure_ascii=False, indent=2), flush=True)
        else:
            print_table(reports[-1])
    found = sum(r["verdict"] == "FOUND" for r in reports)
    print(f"\nTóm tắt: {found}/{len(reports)} mã tìm thấy", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
