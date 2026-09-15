"""Standalone CloakBrowser worker for Fahasa scraping — run as a SUBPROCESS by main.py
(never imported directly), so a hang inside cloakbrowser's launch()/goto() can be
killed from outside.

Why a subprocess instead of asyncio.to_thread: a real production hang was traced to
launch(headless=True) itself blocking for 34+ minutes with no browser child process
even created yet (apparently a stalled browser-binary download - cloakbrowser tries a
download and falls back to "GitHub Releases" on failure, per its own log line, with no
timeout around either attempt). Python threads cannot be forcibly stopped once
started - asyncio.wait_for cancelling the awaiting coroutine only stops main.py from
waiting on it, it does NOT stop the thread, which keeps running (and keeps a browser
process alive) for however long the underlying call actually takes. An OS process CAN
be forcibly killed (SIGKILL) regardless of what it's blocked on, which is the only
reliable way to bound a call that might hang inside third-party native/download code.

Invoked as a subprocess (see main.py's _run_fahasa_browser_worker):
    python fahasa_browser.py <mode> <json-args>
Modes:
    discover_url    {"barcode": "..."}                      -> {"url": str|null, "meta": dict}
    enhance_metadata {"product_url": "..."}                  -> dict
    fetch_html      {"url": "...", "search_code": "..."|null} -> str|null

Prints exactly one JSON line to stdout: {"ok": true, "result": ...} on success, or
{"ok": false, "error": "..."} on failure (still exit code 0 for expected failures -
main.py treats a well-formed {"ok": false} the same as a raised exception). A
non-JSON stdout or non-zero exit with empty stdout means the process crashed/was
killed - main.py's caller handles that case using stderr instead.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

BOOK_BROWSER_TIMEOUT_SECONDS = float(os.getenv("BOOK_BROWSER_TIMEOUT_SECONDS", "20"))
FAHASA_SEARCH_RESPONSE_WAIT_SECONDS = float(os.getenv("FAHASA_SEARCH_RESPONSE_WAIT_SECONDS", "8"))


def _evaluate_fahasa_product_metadata(page) -> dict:
    """
    Run JavaScript in a rendered Fahasa product page to extract book metadata
    from the DOM. Uses multiple selector fallbacks for each field.
    Returns a (possibly partial) dict — caller must handle empty/None values.
    """
    try:
        data = page.evaluate("""() => {
            const h1 = document.querySelector('h1.page-title span')
                    || document.querySelector('h1.page-title')
                    || document.querySelector('h1[itemprop="name"]')
                    || document.querySelector('h1');
            let title = h1 ? h1.innerText.trim() : null;
            if (!title) {
                title = document.title
                    .replace(/ - FAHASA\\.COM$/i, '')
                    .replace(/^Sách\\s+/i, '')
                    .trim() || null;
            }

            const allImgs = Array.from(document.querySelectorAll('img'));
            const coverImg = allImgs.find(img =>
                img.src && img.src.includes('cdn1.fahasa.com/media/catalog/product')
            );
            const thumbnail = coverImg ? coverImg.src : null;

            const descEl = document.querySelector('#desc_content')
                        || document.querySelector('#product_tabs_description_contents')
                        || document.querySelector('.product-description .value')
                        || document.querySelector('#description .std')
                        || document.querySelector('[itemprop="description"]')
                        || document.querySelector('.product.description .value')
                        || document.querySelector('.product-info-description p');
            const description = descEl ? descEl.innerText.trim() || null : null;

            const attrs = {};
            const rows = document.querySelectorAll(
                '.product-attribute, .product-info-attributes tr, ' +
                'table.data.additional-attributes tr, .attributes-table tr, table tr'
            );
            rows.forEach(row => {
                const labelEl = row.querySelector('.attribute-label, th, td:first-child, .label');
                const valueEl = row.querySelector('.attribute-value, td:last-child, .value');
                if (labelEl && valueEl) {
                    const lbl = labelEl.innerText.trim().toLowerCase();
                    const val = valueEl.innerText.trim();
                    if (lbl && val) attrs[lbl] = val;
                }
            });

            return { title, thumbnail, description, attrs };
        }""")
    except Exception:
        return {}

    if not isinstance(data, dict):
        return {}

    attrs = data.get("attrs") or {}
    authors: list[str] = []
    publisher = None
    published_date = None
    page_count = None
    language = None

    for lbl, val in attrs.items():
        if not val:
            continue
        lbl_lower = lbl.lower()
        if any(k in lbl_lower for k in ("tác giả", "tac gia", "author")):
            authors = [v.strip() for v in val.replace(";", ",").split(",") if v.strip()]
        elif any(k in lbl_lower for k in ("nhà xuất bản", "nha xuat ban", "nxb", "publisher")):
            publisher = val.strip() or None
        elif any(k in lbl_lower for k in ("năm xb", "năm xuất bản", "nam xuat ban", "ngày xuất bản", "year")):
            published_date = val.strip() or None
        elif any(k in lbl_lower for k in ("số trang", "so trang", "page")):
            try:
                page_count = int("".join(filter(str.isdigit, val))) or None
            except (ValueError, TypeError):
                pass
        elif any(k in lbl_lower for k in ("ngôn ngữ", "ngon ngu", "language")):
            raw_lang = val.strip().lower()
            if "việt" in raw_lang or "viet" in raw_lang:
                language = "vi"
            elif "anh" in raw_lang or "english" in raw_lang:
                language = "en"
            else:
                language = val.strip() or None

    raw_desc = data.get("description")
    clean_desc = _clean_fahasa_description(raw_desc, data.get("title"))

    return {
        "title": data.get("title"),
        "thumbnail": data.get("thumbnail"),
        "description": clean_desc,
        "authors": authors,
        "publisher": publisher,
        "publishedDate": published_date,
        "pageCount": page_count,
        "language": language,
    }


def _clean_fahasa_description(desc: str | None, title: str | None) -> str | None:
    """Strip leading lines that repeat the book title from Fahasa description.
    Checks both directions: title fragment in line, and line fragment in title —
    because Fahasa h1 sometimes has a 'Bộ ' prefix not present in #desc_content.
    """
    if not desc:
        return desc
    title_lower = (title or "").strip().lower()
    title_fragment = title_lower[:30]
    lines = desc.split("\n")
    start = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            start = i + 1
            continue
        stripped_lower = stripped.lower()
        stripped_fragment = stripped_lower[:40]
        is_title_line = (
            (title_fragment and title_fragment in stripped_lower)
            or (stripped_fragment and title_lower and stripped_fragment in title_lower)
        )
        if is_title_line:
            start = i + 1
        else:
            break
    cleaned = "\n".join(lines[start:]).strip()
    return cleaned or desc


def fetch_html(url: str, search_code: str | None = None) -> str | None:
    from cloakbrowser import launch

    browser = launch(headless=True)
    try:
        page = browser.new_page()
        page.goto(
            url,
            wait_until="domcontentloaded",
            timeout=int(BOOK_BROWSER_TIMEOUT_SECONDS * 1000),
        )
        page.wait_for_timeout(1200)
        html_text = page.content()

        if search_code and search_code not in html_text:
            return None

        return html_text
    finally:
        try:
            browser.close()
        except Exception:
            pass


def enhance_metadata(product_url: str) -> dict:
    from cloakbrowser import launch

    browser = launch(headless=True)
    try:
        page = browser.new_page()
        page.goto(
            product_url,
            wait_until="domcontentloaded",
            timeout=int(BOOK_BROWSER_TIMEOUT_SECONDS * 1000),
        )
        page.wait_for_timeout(1500)
        return _evaluate_fahasa_product_metadata(page)
    finally:
        try:
            browser.close()
        except Exception:
            pass


def discover_url(barcode: str) -> tuple[str | None, dict]:
    """
    Load Fahasa search page via CloakBrowser, intercept the internal Elastic search
    API response to find the product URL, then navigate to that page and extract
    metadata via DOM evaluation — all in one browser session.
    """
    from cloakbrowser import launch

    browser = launch(headless=True)
    try:
        page = browser.new_page()
        found_url: list[str] = []

        def _on_response(resp):
            if found_url:
                return
            if "elsearch" in resp.url and "search.json" in resp.url:
                try:
                    data = resp.json()
                    for result in data.get("results") or []:
                        sku = str((result.get("sku") or {}).get("raw", "")).strip()
                        if sku == barcode:
                            link = str((result.get("link") or {}).get("raw", "")).strip()
                            if link:
                                found_url.append("https://www.fahasa.com" + link)
                                return
                except Exception:
                    pass

        page.on("response", _on_response)
        # domcontentloaded (not networkidle): the product URL comes from the
        # intercepted AJAX response above, not from the page finishing loading -
        # "networkidle" waits for ALL background network activity (chat widget,
        # analytics) to stop, which this page's chat widget/analytics never actually
        # let happen. Poll for the intercepted response instead, bounded by
        # FAHASA_SEARCH_RESPONSE_WAIT_SECONDS - the search API itself typically
        # responds in 1-3s once the page starts loading.
        page.goto(
            f"https://www.fahasa.com/catalogsearch/result/?q={barcode}",
            wait_until="domcontentloaded",
            timeout=int(BOOK_BROWSER_TIMEOUT_SECONDS * 1000),
        )
        deadline = time.monotonic() + FAHASA_SEARCH_RESPONSE_WAIT_SECONDS
        while not found_url and time.monotonic() < deadline:
            page.wait_for_timeout(200)

        if not found_url:
            return None, {}

        product_url = found_url[0]

        # Navigate to product page in the same browser session to extract metadata
        page2 = browser.new_page()
        dom_meta: dict = {}
        try:
            page2.goto(
                product_url,
                wait_until="domcontentloaded",
                timeout=int(BOOK_BROWSER_TIMEOUT_SECONDS * 1000),
            )
            page2.wait_for_timeout(1500)

            dom_meta = _evaluate_fahasa_product_metadata(page2)

            # Fallback: extract title from <title> tag if DOM gave nothing
            if not dom_meta.get("title"):
                html = page2.content()
                m = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE)
                if m:
                    raw_title = m.group(1)
                    raw_title = re.sub(r"\s*-\s*FAHASA\.COM\s*$", "", raw_title, flags=re.IGNORECASE).strip()
                    raw_title = re.sub(r"^Sách\s+", "", raw_title, flags=re.IGNORECASE).strip()
                    if raw_title:
                        dom_meta["title"] = raw_title

            # Fallback: extract CDN thumbnail from raw HTML if DOM gave nothing
            if not dom_meta.get("thumbnail"):
                html = page2.content()
                m = re.search(
                    r"(https://cdn1\.fahasa\.com/media/catalog/product/[^\s\"']+\.(?:jpg|jpeg|png|webp))",
                    html,
                    re.IGNORECASE,
                )
                if m:
                    dom_meta["thumbnail"] = m.group(1)

        except Exception:
            pass
        finally:
            try:
                page2.close()
            except Exception:
                pass

        return product_url, dom_meta
    finally:
        try:
            browser.close()
        except Exception:
            pass


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: fahasa_browser.py <mode> <json-args>"}))
        sys.exit(1)

    mode = sys.argv[1]
    try:
        args = json.loads(sys.argv[2])
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"bad json args: {exc}"}))
        sys.exit(1)

    try:
        if mode == "discover_url":
            url, meta = discover_url(args["barcode"])
            result = {"url": url, "meta": meta}
        elif mode == "enhance_metadata":
            result = enhance_metadata(args["product_url"])
        elif mode == "fetch_html":
            result = fetch_html(args["url"], args.get("search_code"))
        else:
            raise ValueError(f"unknown mode: {mode}")
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
