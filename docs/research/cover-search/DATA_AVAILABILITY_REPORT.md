# Data Availability Report (Phase 1)

Status: **PARTIALLY_COMPLETED** — a verified, rights-audited benchmark exists (154 catalog books, 1,459 queries), but the collection targets were not all met. Numbers below are counts of files actually downloaded and decoded, not targets.

## Targets vs. achieved

| Target (prompt) | Achieved | Gap / reason |
|---|---|---|
| 150 book titles | **154** catalog books (+ 36 out-of-catalog titles) | met |
| 75 Vietnamese titles | **40** catalog + 8 out-of-catalog = 48 | Openly licensed Vietnamese cover images on Wikimedia Commons are scarce: 72 candidates found by category + 14 searches; 24 excluded (wrap-around jackets, composites, maps, title/text pages, illustration-only interior images) |
| 75 international titles | **114** catalog + 28 out-of-catalog | exceeded (from a seeded random sample of 363 eligible Wikidata works) |
| ~3 independent query images per book | **37** Track A queries for **29** books (0.24 per catalog book) | Most works have only one cover image on Commons; 70 candidate files were reviewed, 13 rejected (same scan as gallery, title pages, cut-outs, translations, wrap-arounds) |
| One reference image per catalog edition | 154/154 | met |
| Out-of-catalog group | 36 | met (28 sampled works never in the catalog + 8 Vietnamese covers held out by seeded draw) |

## Sources used / not used

| Source | Used for | Notes |
|---|---|---|
| Wikimedia Commons | all 274 downloaded images; license evidence | file-page license templates read through the API (`extmetadata`, license categories) |
| Wikidata (SPARQL) | candidate discovery; title, author (P50), first publication (P577), publisher (P123) | 5,000 literary works with images → 824 cover-like → 632 works → 363 eligible English works with author/date |
| Seed v0.1 (16 records) | re-verified; 13 used as catalog books, 1 as query, 1 as out-of-catalog, 1 excluded | seed claims re-checked against current file pages |
| Open Library / Google Books | **not used** | no post-1970 editions needing ISBN look-up remained in scope; their cover images carry no reuse grant and Open Library forbids bulk cover crawling |
| Internet Archive | **not used** | scans found on Commons already mirror many IA items; no separate rights check was performed for IA |
| Retail / publisher websites | **not used** | terms do not permit scraping |

## Access incidents (reported, not worked around)

1. **en.wikipedia API throttling** (HTTP 429) during the first harvest — replaced by a single Wikidata SPARQL query.
2. **upload.wikimedia.org refused requests** (HTTP 429 *"Your request does not comply with our robot policy"*) because the User-Agent had no contact information. Collection was **stopped**; it resumed only after the repository owner approved adding the public repository URL to the User-Agent. No request was made with a disguised or browser User-Agent.
3. Full-resolution originals were throttled (Retry-After 600 s); the largest Commons *standard* thumbnail width below the original was downloaded instead (recorded per file as `rendition`; Commons' SHA-1 of the original is kept).
4. 36 lower-priority candidates (20 out-of-catalog EN, 16 post-1930 covers) were deferred during the throttling period and never collected (`selection.csv`, role `deferred_not_collected`).

## What a second collection round would need

More Vietnamese covers with clear licences (e.g. direct permission from publishers or a library's own photography of its holdings), real smartphone photographs taken under a documented protocol for Track A, and a second annotator.
