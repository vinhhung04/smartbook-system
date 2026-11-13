# SmartBook CLIP + Qwen — Seed Dataset v0.1

## What is included
- `dataset_manifest.csv`: 16 source-image candidates (8 Vietnamese, 8 English/international).
- `ground_truth.csv`: provisional title/author/edition labels.
- `rights_audit.csv`: per-image source-page license claims and jurisdiction notes.
- `dataset_manifest.json`: machine-readable dataset description and limitations.
- `download_and_transform.py`: local downloader, SHA-256 recorder and controlled perturbation generator.

## Important status
This is a **seed collection**, not a completed benchmark. The source pages and image URLs were reviewed, but the image binaries have **not** been downloaded in this ChatGPT environment. No image hash is claimed. Run the included script locally after reviewing each source page.

## Ground Truth and ISBN
No ISBN-13 values have been invented. The selected cover editions are historical/pre-ISBN editions. Ground Truth uses stable internal `ground_truth_book_id` and `ground_truth_edition_id` values. The labels are `PROVISIONAL_SOURCE_VERIFIED`: they come from the source file pages and cover descriptions, not an independent inspection of physical copies.

## 50/50 balance
- Vietnamese: 8 records.
- English/international: 8 records.

This balance applies to the seed list, not necessarily to the final eligible test set after image-quality and rights exclusions.

## Image roles and experiment design
1. Original online cover images are intended as catalog/gallery reference assets.
2. The script creates controlled query variants from each downloaded original:
   - rotation +4 degrees;
   - Gaussian blur;
   - low-light brightness reduction;
   - JPEG compression.
3. These are **controlled image perturbations**, not real smartphone photographs.
4. Because each query derivative comes from its gallery source image, this benchmark measures robustness to controlled transformations and may overestimate performance relative to independent real-world photos.
5. Keep the original gallery image, every derivative, transform parameters and SHA-256 hashes.

## Rights and attribution
Each image's source-page license claim is recorded in `rights_audit.csv`. The audit does **not** independently establish legal clearance in every jurisdiction. Wikimedia Commons and Wikisource pages can state Public Domain for Vietnam, the US, or the country of origin; these are not interchangeable. Some pages explicitly warn that reuse may be restricted in jurisdictions with longer copyright terms.

Before public redistribution or publication of the image binaries:
- revisit each source page;
- verify the current license statement and jurisdiction;
- preserve the requested attribution;
- check whether the source has changed;
- consult your institution's copyright guidance if uncertain.

Google Books and Open Library can be used later for bibliographic metadata discovery, but their API access does not itself grant copyright in third-party cover images. Open Library also says its Covers API is not for bulk crawling/download; use its documented access rules and bulk-data guidance rather than scraping it.

## Known image-specific caveats
- `VN005` (Dế Mèn Phiêu Lưu Ký) is a composite showing two volume covers side by side. Crop into volume-specific derivatives only with crop coordinates and separate edition labels; do not score the composite as a normal single cover.
- `VN006` (Thề non nước) appears to be an illustration/cover image without clear title text. Include in visual retrieval, but do not include in OCR title accuracy if the title is not visible.
- `VN007` (Nam ngạn chích cẩm) is low contrast and small. Apply a pre-registered legibility rule before counting OCR failure.
- `VN008` (Phan Trần Truyện) is in Hán-Nôm script; report separately from Vietnamese Latin-script OCR.
- `VN004` (Lịch sử nước ta) is only 300x391 pixels; do not upscale before the baseline.

## Suggested next steps
1. Run `python download_and_transform.py --contact-email YOUR_EMAIL --accept-source-license-claims`.
2. Inspect downloaded files and verify each image is the expected cover.
3. Review `downloaded_manifest.csv` and `derived_manifest.csv`.
4. Mark unusable, duplicate, or misidentified records as excluded with a reason; do not silently delete them.
5. Expand beyond this seed before treating results as a final scientific benchmark. Aim for the previously proposed larger dataset only if enough verified, appropriately licensed images can be found.

## Source API notes
- Google Books Volume API provides bibliographic metadata and imageLinks, but Google states that third-party content accessible through APIs may remain subject to intellectual-property rights.
- Open Library Search API distinguishes works from editions; the edition level is important for book-cover matching.
- Open Library Covers API asks users not to crawl it and says bulk downloads should use its data-dump route.
