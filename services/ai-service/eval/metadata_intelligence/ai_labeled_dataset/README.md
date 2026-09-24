# AI-labeled 120-edition dataset (Claude, NOT human-annotated)

**⚠️ `labelProvenance` in `dataset.json` = `ai_generated_claude_not_human_annotated`.
Do not cite this as the protocol's human-annotated 120-edition dataset or as a
source of double-annotation agreement figures.** It exists to give the
`run_experiments.py` harness real signal before the actual human annotation
pass happens, and to catch pipeline/harness bugs against real data.

## Scope
- 120 real editions (real, valid ISBN-13, live Google Books API lookups), split
  40 `development` / 80 `test` per the original protocol's split sizes.
- `languageGroup` is **29 `vi` / 91 `international`**, not the protocol's 60/60 —
  Vietnamese-title search against Google Books has a much higher failure/
  mismatch rate than English titles (many attempted titles returned nothing
  usable, e.g. "Vợ chồng A Phủ", "Cánh đồng bất tận", "Lục Vân Tiên"). Reaching
  60/60 needs another source (publisher catalogs, Tiki/Fahasa) or a dedicated
  follow-up pass.
- Every candidate edition was manually checked against the actual novel/work
  (not a study guide, companion, anthology, or unrelated book by the same
  author) before being added — several early candidates were rejected for
  exactly this reason (a "Vũ Trọng Phụng" search returned a biography *about*
  him, not his novel *Số Đỏ*; a "Catcher in the Rye" search returned a 3-author
  study guide, not the novel).
- Gold fields marked `known`: `title`, `authors`, `isbn`, `language` for all
  120 editions, plus `translator` for 2 editions independently verified via
  web search against an authoritative source (Nhà giả kim → Lê Chu Cầu; Rừng
  Na Uy → Trịnh Lữ — vi.wikipedia.org, cantholib.org.vn). All other original-
  language editions have `translator: not_applicable`. Every other field
  (`subtitle`, `publisher`, `publishedDate`, `pageCount`, `categories`,
  `description`) is honestly `unknown` — no independent per-edition
  verification was done, so it isn't scored (see `metadata_scoring.py`'s
  "unknown gold values are deliberately excluded" contract).
- `titleCorrections` at the dataset root documents 4 titles that were cleaned
  from noisy Google Books text (e.g. "The Adventures of Tom Sawyer by Mark
  Twain (Annotated) Classic Book" → "The Adventures of Tom Sawyer") after B3's
  LLM extraction correctly produced the clean title and was scored as a false
  positive against the original noisy gold.

## Real results (B1–B5 against real OpenRouter/Qwen + real Google Books data)
Report: `report.json` (raw `run_experiments.py` output).

| Metric | B1/B2/B4/B5 | B3 (LLM-only ablation) |
|---|---|---|
| Precision | 0.989 | 1.0 |
| Recall | 0.981 | 0.102 |
| Hallucination rate | 0.0 | 0.0 |
| Evidence-supported extraction rate | 1.0 | 1.0 |
| Edition contamination rate | 0.0 | 0.0 |
| API cost (real) | ~$0.0018 total across 120 editions × 4 modes | |

### Findings worth keeping in mind
1. **B3's low recall is a mode-definition limitation, not a bug.** B3 discards
   all rule-extracted candidates (`if mode != 'B3'` in `pipeline.py`) and only
   ever calls the LLM on `html`/`text` documents, never `json`. Since most of
   these 120 editions have a single Google Books JSON source, B3 extracts
   almost nothing for them.
2. **The B1/B2/B4/B5 vs. B3 precision numbers trade off against each other
   depending on the gold title's cleanliness**, and this is a genuine,
   reproducible finding, not an artifact of one gold choice being "wrong":
   the rule extractor copies the JSON source's title field verbatim (never
   strips subtitle/annotation noise baked into it), while the LLM path
   (reading a paraphrased prose description) naturally produces the clean
   canonical title. With noisy gold, rule-based scores higher; with clean
   gold, LLM-based scores higher. Cleaning the gold (the current state) is
   the more defensible ground-truth choice, but it means 4/120 rule-based
   title "misses" are a real, disclosed limitation of the rule extractor
   (no title normalization pass), not evidence it read the wrong data.
3. **`test_22` (The Adventures of Sherlock Holmes)**: `isbn` is legitimately
   missing — that specific Google Books record's `industryIdentifiers` only
   lists a Stanford library catalog id (`type: OTHER`), no machine-readable
   ISBN at all. A genuine source-data gap, not a pipeline defect.
4. **Zero hallucination across all 120 editions in every mode** — every
   emitted value that had gold to compare against was evidence-supported.

## Known limitations
1. Not human-annotated (see the provenance warning above).
2. No double annotation / inter-rater agreement — one AI labeler, no second
   independent check.
3. `languageGroup` split (29/91) doesn't hit the protocol's 60 vi / 60
   international target.
4. Most editions have exactly one source document (Google Books JSON) — this
   does not exercise multi-source corroboration/fusion behavior.
5. Review rate is very high (~0.99) because single-source fusion always gets
   the `corroboration=.85` (not `1.0`) confidence penalty in
   `field_fusion.py` — expected given the single-source setup, not a defect.
