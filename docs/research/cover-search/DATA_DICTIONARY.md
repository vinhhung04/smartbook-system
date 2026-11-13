# Data Dictionary — Cover-Search Research Dataset

Root: `research-inputs/cover-search-dataset/`. All CSV files are UTF-8, comma-separated, header row first. Vietnamese text is stored with full diacritics (NFC); normalized forms are computed at evaluation time and never overwrite the raw value.

## Entity model

| Concept | Identifier | Meaning |
|---|---|---|
| Work | `book_id` (`SB-EN-0001`, `SB-VN-0001`) | An intellectual work as a catalog **book** entry (production `books.id`). Retrieval is scored at this level, because the production endpoint dedupes on book id. |
| Edition | `edition_id` (`<book_id>-E1`) | A specific published edition/printing whose cover is in the gallery (production `book_variants.id`). |
| ISBN | `isbn13` + `isbn_status` | Identifier of an edition, only when one exists and was verified. |
| Physical copy | — | Not modelled: no physical copies were handled in this study. |
| Image asset | `asset_id` | One image file (original download or derived perturbation). |

## `metadata/catalog_books.csv` — catalog snapshot (one row per gallery edition)

| Column | Description |
|---|---|
| `book_id`, `edition_id` | See above. |
| `title`, `author` | Raw title/author as printed or as given by the bibliographic source (Wikidata label / Wikipedia infobox); several authors separated by `;`. |
| `publisher`, `edition_year`, `work_year` | Edition publisher and year if documented; work first-publication year. Empty = not documented (never guessed). |
| `language`, `language_group`, `script` | ISO 639-1 language of the title; `VIETNAMESE` / `INTERNATIONAL`; `Latin`, `Han-Nom`, … |
| `isbn13`, `isbn_status` | `VALID` (checksum verified) · `NOT_ASSIGNED_PRE_ISBN` (edition predates ISBN, ≈ before 1970) · `NOT_FOUND` (searched, none found) · `UNKNOWN` (not searched) · `UNVERIFIED` (found but not confirmed for this edition). |
| `category` | Coarse genre passed to the catalog text index (same field production indexes). |
| `gallery_asset_id` | Asset used as the edition's catalog cover image. |
| `wikidata_qid`, `bibliographic_source` | Evidence for title/author/year. |
| `status` | `INCLUDED` / `EXCLUDED` / `NEEDS_REVIEW` (excluded rows are kept, never deleted). |
| `split` | `dev` (pilot / protocol shake-down) or `test` (main results), assigned per book. |
| `verification_status` | `SINGLE_ANNOTATOR_SOURCE_AND_VISUAL` — identity checked against the source page metadata and by visually reading the cover; one annotator (an AI research agent), no inter-annotator agreement. |

## `manifest/dataset_manifest.csv` — every image asset

| Column | Description |
|---|---|
| `asset_id` | `G-…` gallery, `Q-…` independent query, `O-…` out-of-catalog, `<parent>__<transform>` derived. |
| `role` | `gallery` · `query_independent` (Track A) · `out_of_catalog` (E5) · `query_perturbation` (Track B). |
| `status`, `exclusion_reason` | `INCLUDED`, `EXCLUDED`, `NEEDS_REVIEW`, `DOWNLOAD_FAILED` + reason. |
| `book_id`, `edition_id` | Ground-truth identity of the depicted cover (empty for out-of-catalog). |
| `relation_to_gallery` | Track A only: `same_edition_independent_image` (another scan/photo of the same edition's cover) or `different_cover_same_work` (a different cover design of a catalog work: another edition, or dust jacket vs. cloth binding). |
| `commons_file`, `source_platform`, `source_page_url`, `direct_image_url`, `downloaded_url`, `rendition` | Provenance. `rendition=thumb2000` = Commons' 2000-px rendering used because the original was > 15 MB or not JPEG/PNG/WebP. |
| `local_path`, `mime`, `width`, `height`, `bytes`, `sha256`, `phash` | Integrity: MIME sniffed from magic bytes; image fully decoded with Pillow; 64-bit DCT perceptual hash (imagehash). |
| `commons_sha1_of_original` | SHA-1 Commons publishes for the original file. |
| `retrieved_or_created_at_utc` | Download or transformation time. |
| `image_condition` | `scan`, `photo`, `photo_angled`, `low_resolution`, … for originals; transform name for derived. |
| `title_visible` | `yes` / `partial` / `no` — whether the title is legible on the image; `no` excludes the query from OCR-accuracy metrics (not from retrieval metrics). |
| `query_type` | `GALLERY_REFERENCE`, `INDEPENDENT_ONLINE_IMAGE`, `OUT_OF_CATALOG_ONLINE_IMAGE`, `CONTROLLED_IMAGE_PERTURBATION`. |
| `parent_asset_id`, `transform_name`, `transform_parameters`, `random_seed` | Derived assets only. |

## `ground_truth/ground_truth.csv` — one row per evaluation query

| Column | Description |
|---|---|
| `query_id`, `query_asset_id` | Query and its image asset. |
| `query_track` | `A` (independent online image), `B` (controlled perturbation), `OOC` (out-of-catalog). |
| `expected_outcome` | `MATCH` (book is in catalog) or `NO_MATCH`. |
| `ground_truth_book_id`, `ground_truth_edition_id`, `gallery_image_id` | Correct answer (book) and the edition/gallery image it corresponds to (`gallery_image_id` empty when the query shows a different edition). |
| `title`, `author`, `language`, `language_group`, `script`, `isbn13`, `publisher`, `edition_year` | Copied from the catalog row of the ground-truth edition (for OCR accuracy). |
| `relation_to_gallery`, `image_condition`, `title_visible` | Strata. |
| `source_url`, `image_source`, `license`, `sha256` | Provenance of the query image. |
| `split` | Inherited from the book. |
| `verification_status`, `status` | As above. |

## `rights/rights_audit.csv` — one row per original image

| Column | Description |
|---|---|
| `license_name`, `license_url`, `usage_terms`, `attribution_required` | From the Commons file page's machine-readable license block (extmetadata). |
| `creator`, `credit`, `image_description` | Attribution evidence from the file page. |
| `license_evidence_categories` | License template categories on the file page (e.g. `PD-US-expired`, `PD-old-70`, `CC-BY-SA-4.0`). |
| `rights_jurisdiction` | Jurisdictions the page itself names. A Vietnam-only public-domain claim is **not** treated as worldwide. |
| `permission_status` | `VERIFIED_OPEN_LICENSE` (CC0 / CC BY / CC BY-SA / GFDL stated) · `VERIFIED_PUBLIC_DOMAIN` (page states PD for the US **and** on a source-country / life+70 / ineligible basis) · `SOURCE_CLAIM_ONLY` (PD claimed for one jurisdiction only, or basis unclear) · `RESTRICTED` · `UNKNOWN` · `EXCLUDED`. "Verified" means *verified that the source page states it*; it is not legal advice. |
| `redistribution_status` | `PUBLIC_OK`, `PUBLIC_OK_WITH_ATTRIBUTION`, `PUBLIC_OK_ATTRIBUTION_RECOMMENDED`, `NOT_FOR_PUBLIC_DISTRIBUTION_PENDING_REVIEW` (+ `RESTRICTIONS:` note, e.g. trademark). |
| `retrieval_timestamp_utc` | When the page was read. |

## Run outputs (`services/ai-service/eval/cover_search/runs/<run_id>/`)

| File | Content |
|---|---|
| `predictions.jsonl` | One JSON per (query, method): production response (ranked candidates with confidence + evidence), `rank` of the ground-truth book, `outcome` (`CORRECT_TOP1`, `CORRECT_TOP5`, `INCORRECT`, `NO_RESULT`, `CORRECT_REJECTION`, `FALSE_ACCEPT`), `failure_flags` (`TIMEOUT`, `API_FAILURE`, `MODEL_FAILURE_*`, `ENDPOINT_ERROR`), timings, OCR raw output + usage. |
| `run_manifest_<ts>.json` | Exact configuration, production parameters, git HEAD, dataset file hashes, library versions, provider-reported API cost/tokens. |
| `_cache/ocr_responses.jsonl` | Append-only record of every paid vision call (raw JSON + usage), reused by later runs. Git-ignored. |
