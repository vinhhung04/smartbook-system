#!/usr/bin/env python3
"""
Download the source-page-reviewed cover images and create controlled perturbations.
This script does not create or invent book metadata or Ground Truth.
Requires: Python 3.9+, Pillow (pip install Pillow).
Run from this directory:
  python download_and_transform.py --contact-email you@example.org --accept-source-license-claims
"""
import argparse, csv, hashlib, io, json, time, urllib.request
from pathlib import Path
from PIL import Image, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "dataset_manifest.csv"
RAW_DIR = ROOT / "assets" / "raw"
DERIVED_DIR = ROOT / "assets" / "derived"

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def safe_ext(url):
    path = url.split("?", 1)[0].lower()
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        if path.endswith(ext):
            return ext
    return ".img"

def download(url, destination, user_agent):
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(req, timeout=45) as response:
        content_type = response.headers.get("Content-Type", "")
        data = response.read()
    if not content_type.startswith("image/"):
        raise RuntimeError(f"Unexpected Content-Type {content_type!r} for {url}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return content_type, len(data), sha256_file(destination)

def save_rgb(image, path, fmt=None, quality=90):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format=fmt, quality=quality, optimize=True)

def create_variants(source_path, record):
    image = Image.open(source_path).convert("RGB")
    variants = []
    rid = record["record_id"]

    # Controlled transformations only. These are not represented as real camera photos.
    rot = image.rotate(4, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(245,245,245))
    p = DERIVED_DIR / f"{rid}__rot_p4.jpg"
    save_rgb(rot, p, "JPEG", 92)
    variants.append(("rot_p4", "rotation_degrees=+4; expand=true; fill=(245,245,245)", p))

    blur = image.filter(ImageFilter.GaussianBlur(radius=1.2))
    p = DERIVED_DIR / f"{rid}__gaussian_blur_r1p2.jpg"
    save_rgb(blur, p, "JPEG", 92)
    variants.append(("gaussian_blur_r1p2", "gaussian_blur_radius=1.2", p))

    low = ImageEnhance.Brightness(image).enhance(0.70)
    p = DERIVED_DIR / f"{rid}__brightness_0p70.jpg"
    save_rgb(low, p, "JPEG", 92)
    variants.append(("brightness_0p70", "brightness_factor=0.70", p))

    # JPEG compression variant. Re-open the compressed bytes so the stored image is exactly
    # the degraded image evaluated later.
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=45, optimize=True)
    buf.seek(0)
    compressed = Image.open(buf).convert("RGB")
    p = DERIVED_DIR / f"{rid}__jpeg_q45.jpg"
    save_rgb(compressed, p, "JPEG", 95)
    variants.append(("jpeg_q45", "jpeg_quality=45; re-encoded output quality=95", p))

    return variants

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--contact-email", required=True, help="Contact email to identify this research downloader in User-Agent.")
    parser.add_argument("--accept-source-license-claims", action="store_true",
                        help="Confirm you reviewed the per-record rights_audit.csv and accept responsibility for local use.")
    args = parser.parse_args()
    if not args.accept_source_license_claims:
        parser.error("Review rights_audit.csv and pass --accept-source-license-claims before downloading.")
    if "@" not in args.contact_email:
        parser.error("--contact-email must be a valid-looking email address.")

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader(open(MANIFEST, newline="", encoding="utf-8-sig")))
    user_agent = f"SmartBookResearchCoverDataset/0.1 (contact: {args.contact_email})"

    downloaded, derived, failures = [], [], []
    for idx, row in enumerate(rows):
        url = row["source_image_url"]
        ext = safe_ext(url)
        raw_path = RAW_DIR / f'{row["record_id"]}{ext}'
        try:
            content_type, nbytes, digest = download(url, raw_path, user_agent)
            row["local_asset_path"] = str(raw_path.relative_to(ROOT))
            row["sha256"] = digest
            row["content_type"] = content_type
            row["bytes"] = str(nbytes)
            row["download_status"] = "DOWNLOADED"
            downloaded.append(row.copy())

            for variant, params, path in create_variants(raw_path, row):
                derived.append({
                    "query_asset_id": f'{row["record_id"]}__{variant}',
                    "parent_gallery_record_id": row["record_id"],
                    "ground_truth_book_id": row["ground_truth_book_id"],
                    "ground_truth_edition_id": row["ground_truth_edition_id"],
                    "language_group": row["language_group"],
                    "language": row["language"],
                    "variant": variant,
                    "transform_parameters": params,
                    "asset_path": str(path.relative_to(ROOT)),
                    "sha256": sha256_file(path),
                    "query_type": "CONTROLLED_IMAGE_PERTURBATION_NOT_REAL_PHOTO"
                })
        except Exception as exc:
            failures.append({"record_id": row["record_id"], "url": url, "error": repr(exc)})
        time.sleep(1.1)  # courteous low-volume request pacing

    def write_csv(path, data):
        if not data:
            return
        fields = list(dict.fromkeys(k for row in data for k in row.keys()))
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            writer.writerows(data)

    write_csv(ROOT / "downloaded_manifest.csv", downloaded)
    write_csv(ROOT / "derived_manifest.csv", derived)
    write_csv(ROOT / "download_failures.csv", failures)

    summary = {
        "source_records": len(rows),
        "downloaded_records": len(downloaded),
        "derived_query_images": len(derived),
        "failures": len(failures),
        "note": "Controlled derivatives are synthetic perturbations, not real-world photographs."
    }
    (ROOT / "download_run_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))

if __name__ == "__main__":
    main()
