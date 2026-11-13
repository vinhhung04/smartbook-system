# Annotation Guide — Cover-Search Ground Truth

Applies to every row of `catalog_books.csv` and `ground_truth.csv`. Written before annotation started; changes are logged at the end.

## 1. Who annotates

A single annotator (the AI research agent that ran this study), working from source-page metadata and from viewing each image. There is **no second annotator** and therefore **no inter-annotator agreement** figure; every row carries `verification_status = SINGLE_ANNOTATOR_SOURCE_AND_VISUAL`. Rows the annotator could not settle are `NEEDS_REVIEW`, never guessed.

## 2. Evidence hierarchy (strongest first)

1. Text printed on the cover itself, read from the image.
2. ISBN printed on the item (none of the historical covers here carry one).
3. Publisher / edition statement on the source page (Commons file description, Wikipedia infobox caption such as "First edition cover").
4. Wikidata item of the work (title label, author P50, publication date P577, publisher P123).
5. Open Library / Google Books records — used only to look for an ISBN for post-1970 editions; never used to re-label a historical cover.

When two sources disagree, the conflict and both values are written into `annotation_note`, and the row is `NEEDS_REVIEW` unless the printed cover text settles it.

## 3. Identity rules

- **Work vs edition.** Two images are the *same edition* only if the cover design (artwork, layout, lettering) is the same printing design. Same title with a different design = different edition. A dust jacket and the cloth binding underneath it are different covers and are not mixed.
- **Book id** is assigned per work as it would appear once in a library catalog; translations are separate works only when the catalog would list them separately (not applicable in this dataset).
- **Title** = title as printed/known for that edition, original orthography and diacritics; subtitles omitted unless they are part of the commonly catalogued title.
- **Author** = author(s) of the text; illustrators are not authors. Multiple authors joined by `;`.
- **Year**: `edition_year` only if the source documents the depicted edition's year; otherwise empty with a note (e.g. VN002 "sixth printing, year not stated"). Never back-fill with the work's first-publication year.

## 4. ISBN rules

- Only for editions that have one; checksum must validate (`dataset_validator.py`).
- Editions before ISBN introduction (≈1970) → `NOT_ASSIGNED_PRE_ISBN`. Not searched → `UNKNOWN`. Searched but nothing found → `NOT_FOUND`. Found but not tied to the depicted edition → `UNVERIFIED`. No fabricated or "representative" ISBNs.

## 5. Image role rules

- **Gallery (catalog cover).** The cleanest available front-cover image of the edition, as a library would attach to its catalog record.
- **Track A query (independent).** A *different file* from a different scan or photograph than the gallery image, of the same edition's front cover (`same_edition_independent_image`) or of another edition of the same catalog work (`different_cover_same_work`, reported as a separate stratum because the visual signal is not expected to transfer). A file that is a crop, re-encode or resize of the gallery file is **not** independent; candidate pairs with pHash distance ≤ 6 are inspected and dropped if they are the same scan.
- **Out-of-catalog.** Front covers of works that are not in the catalog under any edition.
- **Excluded** (kept in the manifest with a reason): not a front cover (spine, back, title page, interior page, advertisement), several books in one image (composite), image does not show what the source page says, unreadable/broken file, duplicate.

## 6. Per-image attributes

- `image_condition`: `scan` (flat scan or flat reproduction), `photo` (camera photo of a physical book, roughly frontal), `photo_angled` (visible perspective / background), `low_resolution` (short side < 300 px).
- `title_visible`: `yes` if the full title is legible in the image at its stored resolution; `partial`; `no` (no title on the cover, illegible, or non-Latin script the OCR task does not target). `no` removes the query from OCR-accuracy metrics only.
- `script`: `Latin`, `Han-Nom`, … (Hán-Nôm covers are analysed separately from Latin-script Vietnamese).

## 7. Rights rules

See `DATA_DICTIONARY.md` (`rights_audit.csv`). Only Wikimedia Commons files are used: Commons hosts only content its uploaders declare freely licensed or public domain, and the declaration (license template + jurisdiction) is recorded per file. A page that claims public domain for one jurisdiction only is `SOURCE_CLAIM_ONLY`. Covers from Google Books / Open Library / retailers are **not** downloaded.

## Change log

- 2026-11-12: guide created before annotation.
