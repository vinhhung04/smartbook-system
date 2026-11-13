"""Phase 1: download curated Wikimedia Commons files and record provenance,
integrity and rights evidence for each one.

Input  : research-inputs/cover-search-dataset/manifest/selection.csv
         (curated list: asset_id, commons_file, role, book_id, edition_id, ...)
Output : assets/raw/<asset_id>.<ext>       immutable original bytes
         manifest/dataset_manifest.csv     (merged, existing rows kept)
         rights/rights_audit.csv           (merged, existing rows kept)
         reports/collect_log.jsonl         one line per attempt

Access rules followed: MediaWiki API for metadata (the same file description
page a human reads, via extmetadata + license categories), upload.wikimedia.org
for bytes, identifying research User-Agent, >= 1 s between requests, Retry-After
honoured on HTTP 429, no login, no scraping of non-API pages.
Every file is fetched as Commons' largest *standard* thumbnail width (1280/960/
500/330 px) strictly below the original width (`rendition=<w>px_thumbnail`;
the original only when narrower than 330 px). Reason: full originals on
upload.wikimedia.org were throttled (HTTP 429, Retry-After 600 s) on
2026-11-12. Never upscaled; Commons' SHA-1 of the original is recorded.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from common import DATASET_DIR
from dataset_loader import read_csv, write_csv

# Contact URL approved by the repository owner on 2026-11-12 (Wikimedia robot policy
# requires contact information; requests without it were refused with HTTP 429).
UA = "BookCoverRetrievalResearch/0.1 (https://github.com/vinhhung04/smartbook-system; non-commercial academic research)"
API = "https://commons.wikimedia.org/w/api.php"
DELAY_S = 2.0
# Standard Commons thumbnail step: served from the media cache; full originals
# triggered HTTP 429 with Retry-After: 600 on upload.wikimedia.org (2026-11-12).
THUMB_WIDTH = 1280
# Pacing for upload.wikimedia.org (one request at a time).
MEDIA_DELAY_S = 3.0


def http_get(url: str, accept_json: bool = False) -> tuple[bytes, dict]:
    last = None
    for attempt in range(8):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                headers = {k.lower(): v for k, v in response.headers.items()}
            time.sleep(DELAY_S if "api.php" in url else MEDIA_DELAY_S)
            return body, headers
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code in (429, 503):
                retry = exc.headers.get("Retry-After")
                wait = int(retry) if retry and retry.isdigit() else 20 * (attempt + 1)
                print(f"HTTP {exc.code}, waiting {wait}s ({url[:80]})", file=sys.stderr, flush=True)
                time.sleep(wait)
                continue
            raise
        except Exception as exc:  # noqa: BLE001
            last = exc
            print(f"{type(exc).__name__} on {url[:80]}, retrying", file=sys.stderr, flush=True)
            time.sleep(5 * (attempt + 1))
    raise last


def api(**params) -> dict:
    params.update(format="json", formatversion="2")
    body, _ = http_get(API + "?" + urllib.parse.urlencode(params))
    return json.loads(body)


def file_info(titles: list[str]) -> dict[str, dict]:
    out = {}
    for start in range(0, len(titles), 20):
        chunk = titles[start:start + 20]
        print(f"file_info {start}/{len(titles)}", file=sys.stderr, flush=True)
        data = api(action="query", titles="|".join(chunk), prop="imageinfo|categories",
                   iiprop="url|size|mime|sha1|extmetadata|timestamp|user", iiurlwidth=str(THUMB_WIDTH),
                   clshow="hidden", cllimit="max")
        normalized = {n["to"]: n["from"] for n in data["query"].get("normalized", [])}
        for page in data["query"]["pages"]:
            key = normalized.get(page["title"], page["title"])
            out[key] = page
    return out


def _meta(ext: dict, name: str) -> str:
    value = (ext.get(name) or {}).get("value", "")
    return re.sub(r"<[^>]+>", "", str(value)).strip()


US_PD = re.compile(r"PD[- ]US|PD[- ]1923|PD[- ]1996|Public domain in the United States|PD-US-expired|PD-US-no notice|PD-US-not renewed", re.I)
# Bases that hold beyond one jurisdiction: life+70/100 expiry, ineligible/simple
# works. "PD-Art" is only a wrapper (faithful reproduction) and "PD Old auto:
# author died LESS than ..." is explicitly not an expiry, so neither counts.
WORLD_PD = re.compile(r"PD[- ]old(?![- ]auto: author died less)|PD-old-(70|80|90|100)|Author died more than (70|80|100) years ago|"
                      r"PD[- ]ineligible|PD[- ]textlogo|PD[- ]shape|PD[- ]simple|PD-anon-70|PD-anon-expired", re.I)


def classify_rights(ext: dict, categories: list[str]) -> dict:
    short = _meta(ext, "LicenseShortName")
    cats = " | ".join(categories)
    jurisdictions = sorted(set(re.findall(r"PD[- ]([A-Z][A-Za-z]+(?:-[a-z]+)?)", cats)))
    if re.search(r"\bCC0\b", short, re.I):
        status, redistribution = "VERIFIED_OPEN_LICENSE", "PUBLIC_OK"
    elif re.search(r"CC[ -]BY|GFDL|FAL|Attribution", short, re.I):
        status, redistribution = "VERIFIED_OPEN_LICENSE", "PUBLIC_OK_WITH_ATTRIBUTION"
    elif re.search(r"public domain|^PD", short, re.I) or "Public domain" in cats or "PD" in cats:
        if US_PD.search(cats) and WORLD_PD.search(cats):
            status, redistribution = "VERIFIED_PUBLIC_DOMAIN", "PUBLIC_OK_ATTRIBUTION_RECOMMENDED"
        else:
            status, redistribution = "SOURCE_CLAIM_ONLY", "NOT_FOR_PUBLIC_DISTRIBUTION_PENDING_REVIEW"
    else:
        status, redistribution = "UNKNOWN", "NOT_FOR_PUBLIC_DISTRIBUTION_PENDING_REVIEW"
    restrictions = _meta(ext, "Restrictions")
    if restrictions and redistribution.startswith("PUBLIC_OK"):
        redistribution += f"; RESTRICTIONS:{restrictions}"
    license_cats = [c for c in categories if re.search(r"PD|CC-|CC0|GFDL|Public domain|License|FAL", c, re.I)]
    return {
        "license_name": short or "UNSTATED",
        "license_url": _meta(ext, "LicenseUrl"),
        "usage_terms": _meta(ext, "UsageTerms"),
        "attribution_required": _meta(ext, "AttributionRequired"),
        "creator": _meta(ext, "Artist")[:300],
        "credit": _meta(ext, "Credit")[:300],
        "license_evidence_categories": "; ".join(license_cats)[:800],
        "rights_jurisdiction": ("US+source-country/worldwide basis stated" if status == "VERIFIED_PUBLIC_DOMAIN"
                                else ("jurisdictions named: " + ", ".join(jurisdictions) if jurisdictions else "not stated")),
        "permission_status": status,
        "redistribution_status": redistribution,
    }


STANDARD_WIDTHS = (1280, 960, 500, 330)


def standard_thumb_url(info: dict) -> str:
    """Largest standard Commons thumbnail width strictly below the original
    width (never upscaled); the original only if it is narrower than 330 px.
    Originals on upload.wikimedia.org were throttled (HTTP 429, Retry-After 600)."""
    width = int(info.get("width") or 0)
    step = next((w for w in STANDARD_WIDTHS if w < width), None)
    original = info["url"].split("?", 1)[0]  # drop the API's utm_* tracking query
    if step is None:
        return original
    head, name = original.rsplit("/", 1)
    head = head.replace("/wikipedia/commons/", "/wikipedia/commons/thumb/", 1)
    suffix = ".jpg" if name.lower().endswith((".tif", ".tiff", ".pdf")) else ""
    return f"{head}/{name}/{step}px-{name}{suffix}"


def _sniff(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def main() -> None:
    from PIL import Image
    import imagehash

    selection = read_csv(DATASET_DIR / "manifest" / "selection.csv")
    manifest_path = DATASET_DIR / "manifest" / "dataset_manifest.csv"
    rights_path = DATASET_DIR / "rights" / "rights_audit.csv"
    manifest = {row["asset_id"]: row for row in read_csv(manifest_path)}
    rights = {row["asset_id"]: row for row in read_csv(rights_path)}
    raw_dir = DATASET_DIR / "assets" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    log = open(DATASET_DIR / "reports" / "collect_log.jsonl", "a", encoding="utf-8")

    selection = [row for row in selection if row["role"] != "deferred_not_collected"]
    todo = [row for row in selection if row["asset_id"] not in manifest or manifest[row["asset_id"]].get("status") == "DOWNLOAD_FAILED"]
    priority = [p for p in (sys.argv[1].split(",") if len(sys.argv) > 1 else [])]
    todo.sort(key=lambda r: next((i for i, p in enumerate(priority) if r["asset_id"].startswith(p)), len(priority)))
    print(f"selection={len(selection)} todo={len(todo)}", file=sys.stderr)
    infos = file_info([row["commons_file"] for row in todo])
    for row in todo:
        title = row["commons_file"]
        page = infos.get(title) or {}
        retrieved = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        base = {**row, "source_platform": "Wikimedia Commons",
                "source_page_url": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
                "retrieved_or_created_at_utc": retrieved}
        if page.get("missing") or not page.get("imageinfo"):
            manifest[row["asset_id"]] = {**base, "status": "EXCLUDED", "exclusion_reason": "SOURCE_FILE_MISSING"}
            log.write(json.dumps({"asset_id": row["asset_id"], "result": "missing"}) + "\n")
            continue
        info = page["imageinfo"][0]
        rights_row = classify_rights(info.get("extmetadata") or {}, [c["title"] for c in page.get("categories", [])])
        url = standard_thumb_url(info)
        use_thumb = "/thumb/" in url
        existing = [f for f in raw_dir.glob(f"{row['asset_id']}.*") if f.stat().st_size > 0]
        try:
            if existing:  # downloaded by an earlier interrupted run from the same deterministic URL
                data = existing[0].read_bytes()
                headers = {"content-type": "image/" + existing[0].suffix.lstrip(".").replace("jpg", "jpeg")}
                retrieved = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(existing[0].stat().st_mtime))
                base["retrieved_or_created_at_utc"] = retrieved
            else:
                data, headers = http_get(url)
        except Exception as exc:  # noqa: BLE001
            manifest[row["asset_id"]] = {**base, "status": "DOWNLOAD_FAILED", "exclusion_reason": f"{type(exc).__name__}"}
            log.write(json.dumps({"asset_id": row["asset_id"], "result": "download_failed", "error": repr(exc)}) + "\n")
            continue
        sniffed = _sniff(data)
        reason = None
        width = height = None
        phash = ""
        if not headers.get("content-type", "").startswith("image/") or sniffed is None:
            reason = f"NOT_AN_IMAGE ({headers.get('content-type')})"
        else:
            try:
                with Image.open(io.BytesIO(data)) as image:
                    image.load()
                    width, height = image.size
                    phash = str(imagehash.phash(image.convert("RGB")))
            except Exception as exc:  # noqa: BLE001
                reason = f"CORRUPT_IMAGE ({type(exc).__name__})"
        sha_original = info.get("sha1", "")
        ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(sniffed or "", ".bin")
        local = raw_dir / f"{row['asset_id']}{ext}"
        if reason is None:
            local.write_bytes(data)
        manifest[row["asset_id"]] = {
            **base,
            "status": "EXCLUDED" if reason else row.get("status") or "INCLUDED",
            "exclusion_reason": reason or row.get("exclusion_reason", ""),
            "direct_image_url": info["url"].split("?", 1)[0], "downloaded_url": url,
            "rendition": (url.rsplit("/", 1)[-1].split("px-")[0] + "px_thumbnail") if use_thumb else "original",
            "commons_sha1_of_original": sha_original,
            "commons_upload_user": info.get("user", ""), "commons_timestamp": info.get("timestamp", ""),
            "local_path": str(local.relative_to(DATASET_DIR)).replace("\\", "/") if reason is None else "",
            "mime": sniffed or "", "width": str(width or ""), "height": str(height or ""),
            "bytes": str(len(data)), "sha256": hashlib.sha256(data).hexdigest(), "phash": phash,
            "query_type": {"query_independent": "INDEPENDENT_ONLINE_IMAGE", "gallery": "GALLERY_REFERENCE",
                           "out_of_catalog": "OUT_OF_CATALOG_ONLINE_IMAGE"}.get(row["role"], ""),
        }
        rights[row["asset_id"]] = {
            "asset_id": row["asset_id"], "source_page_url": base["source_page_url"],
            "direct_image_url": info["url"].split("?", 1)[0], "source_platform": "Wikimedia Commons",
            **rights_row, "retrieval_timestamp_utc": retrieved,
            "image_description": _meta(info.get("extmetadata") or {}, "ImageDescription")[:400],
        }
        print(row["asset_id"], "ok" if reason is None else reason, file=sys.stderr, flush=True)
        log.write(json.dumps({"asset_id": row["asset_id"], "result": "ok" if reason is None else reason,
                              "bytes": len(data), "rendition": "thumbnail" if use_thumb else "original"}) + "\n")
        log.flush()
        write_csv(manifest_path, list(manifest.values()))  # incremental: an interruption loses nothing
        write_csv(rights_path, list(rights.values()))
    log.close()
    write_csv(manifest_path, list(manifest.values()))
    write_csv(rights_path, list(rights.values()))
    print(f"manifest rows={len(manifest)} rights rows={len(rights)}", file=sys.stderr)


if __name__ == "__main__":
    main()
