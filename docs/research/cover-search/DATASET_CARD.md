# Dataset Card — SmartBook Cover-Search Benchmark v1.0

Location: `research-inputs/cover-search-dataset/` (CSVs, scripts and hashes in Git; image binaries git-ignored and re-creatable with `collect.py` + `perturb.py`). Built 2026-11-12. Field definitions: `DATA_DICTIONARY.md`; labelling rules: `ANNOTATION_GUIDE.md`; checks: `DATASET_VALIDATION_REPORT.md`.

## Purpose

Evaluate in-catalog retrieval of a book from an image of its cover with SmartBook's production pipeline (CLIP visual matching, Qwen vision OCR, fusion), and rejection of covers that are not in the catalog. Not intended for training.

## Composition

| Part | Count | Notes |
|---|---|---|
| Catalog books (= gallery editions, one cover each) | **154** | 114 international (Latin script; English except 1 French), 40 Vietnamese (31 Latin-script quốc ngữ, 9 Hán-Nôm) |
| Track A — independent online images | **37** queries / 29 books | 23 `same_edition_independent_image` (another scan or photo of the same cover), 14 `different_cover_same_work` (other edition, or jacket vs. cloth binding). 35 international, **2 Vietnamese** |
| Track B — controlled perturbations | **1,386** queries (154 × 9) | rotation ±4°, perspective, Gaussian blur, low light, low contrast, JPEG q20, 20 % occlusion, mild crop. Labelled `CONTROLLED_IMAGE_PERTURBATION`; not real photographs |
| Out-of-catalog (E5) | **36** queries | 28 international + 8 Vietnamese covers of works not in the catalog. Includes deliberately hard negatives: same author or same series as a catalog book (Zane Grey, L. Frank Baum, Hardy Boys, L. M. Montgomery) |
| Split | dev 27 books / test 127 books | per-book hash threshold (15 %), not stratified (dev = 22 international + 5 Vietnamese books); OOC split per query by hash |

Image conditions of gallery covers: 131 flat scans, 13 photos, 1 angled photo, 9 low-resolution (< 300 px short side). Title legible on 121 covers, partially on 14, not at all on 19 (illustration-only covers, cloth bindings without lettering, Hán-Nôm titles).

Editions date from 1714 to 2007; 152/154 predate ISBN (`NOT_ASSIGNED_PRE_ISBN`), 2 (1974 US first editions) have `UNKNOWN` ISBN status (not searched). **No valid ISBN-13 exists in this dataset**, so the production ISBN fast-path is never exercised.

## Sources and collection

- All images: Wikimedia Commons, via the MediaWiki API (metadata) and upload.wikimedia.org (bytes), User-Agent identifying the research with the repository URL (approved by the repository owner), sequential requests, Retry-After honoured. Commons' standard thumbnail width below the original was downloaded (1280/960/500/330 px; 14 originals narrower than 330 px), never upscaled.
- Candidate discovery: Wikidata SPARQL (literary works 1840–1930 whose `P18` image is a cover-like Commons file; seeded random sample), Commons categories/search for Vietnamese covers, the 16-record seed v0.1, and Commons searches for other images of sampled works (Track A).
- Bibliographic metadata: Wikidata (label, P50, P577) for international works; Commons file descriptions + printed cover text for Vietnamese works; seed v0.1 for its records. Printed text wins on conflict (documented per row).

## Rights

| Status (included originals, n = 227) | Count |
|---|---|
| `SOURCE_CLAIM_ONLY` | 207 |
| `VERIFIED_PUBLIC_DOMAIN` (PD stated for the US **and** life+70/ineligible) | 10 |
| `VERIFIED_OPEN_LICENSE` (CC0/CC BY/CC BY-SA stated, uploader plausibly entitled) | 10 |

Most historical covers carry a US-only public-domain basis (pre-1931 publication) on their Commons page; that is recorded as `SOURCE_CLAIM_ONLY`, not as worldwide public domain. Sixteen Vietnamese covers uploaded under a CC licence by accounts with no evident claim to the cover rights were downgraded to `SOURCE_CLAIM_ONLY` (`rights/rights_overrides.csv`, reason per file). **Images are therefore not redistributed**; only URLs, hashes and metadata are versioned.

## Known limitations

- Vietnamese target (75 titles) not reached: 40 catalog books + 8 negatives; only 2 Vietnamese Track A queries. Openly licensed Vietnamese cover images are scarce on Commons, and many modern ones are wrap-around designs (excluded).
- Historical bias: most covers are 1850–1930 cloth bindings or dust jackets, unlike today's photo-heavy retail covers.
- Track A queries are online scans/photos by different contributors, not smartphone photographs taken by library users.
- Single annotator (AI research agent); no inter-annotator agreement.
- Seed v0.1: 13 of 16 records used as catalog books; VN002 became an out-of-catalog query by the seeded draw, VN005 (two-volume composite) excluded, EN004 (a later grey-cloth Dracula) used as a Track A different-cover query.
