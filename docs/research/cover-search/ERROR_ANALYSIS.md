# Error Analysis

Source: `results_main_test/errors.md` (automatic category per query, full list of non-OK queries and the first 5 successes per method/track by query id — not hand-picked), `results_main_test/per_query_errors.json`, `results_main_test/fusion_diagnostics.json`. Test split unless stated.

## 1. Error categories (test split)

| Method | Track | OK | Main error categories |
|---|---|---|---|
| CLIP-only | A (25) | 11 | 6 gate-rejected correct top-1 (cos 0.68–0.75 < 0.80), 6 other no-result (correct book not ranked first by cosine; 5 of them different-cover queries), 2 wrong book above the gate (Q-EN-0019 → *The Man Who Died Twice* 0.846; Q-EN-0038 American 1899 *Dracula* → same) |
| CLIP-only | B (1,143) | 1,079 | 40 gate-rejected correct top-1, 9 no result, 9 wrong book, 6 correct but not top-1 |
| CLIP-only | OOC (27) | 24 rejected | 3 false accepts (cos 0.822, 0.835, 0.841) |
| OCR-only | A (25) | 24 | 1 no text (C-MD-0004, 1975 *Jaws* paperback art with no title) |
| OCR-only | B (1,143) | 1,022 | 82 no text (72 on covers whose title is not printed or illegible), 38 wrong book (22 Hán-Nôm), 1 same-author confusion |
| OCR-only | OOC (27) | 0 rejected | 27 false accepts, all at confidence 0.5 |
| Hybrid | A (25) | 23 | 1 wrong book (Q-EN-0019, fusion demotion), 1 no text + visual below gate (C-MD-0004) |
| Hybrid | B (1,143) | 1,055 | 40 wrong book (35 Hán-Nôm), 42 correct but not top-1 (27 Hán-Nôm), 5 no result |
| Hybrid | OOC (27) | 0 rejected | 27 false accepts (24 at 0.5, plus 0.693, 0.835, 0.841) |

Model/API failures: 1 of 1,459 Qwen calls returned truncated JSON (`'{\n"title":'`, G-EN-0098 mild crop) → `MODEL_FAILURE_OCR_INVALID_JSON`; production degraded it to "no OCR signal" (OCR-only: no result; Hybrid: still correct via CLIP). No timeouts, no HTTP errors, no CLIP failures, no endpoint exceptions.

## 2. Failure mechanisms

### 2.1 Fixed visual gate (CLIP-only, Hybrid)
The 0.80 cosine gate removes correct matches whose similarity is lowered by an independent scan, photo lighting, wear or cropping: 46 of 78 CLIP-only misses (A + B, test) are a correct book that cosine ranked first. Conversely three out-of-catalog covers (cloth bindings with large lettering) pass the gate at 0.82–0.84, overlapping the range of correct independent scans (0.83–0.92 on test Track A). A single global cosine threshold cannot separate them on this data.

### 2.2 Text score at the acceptance boundary (OCR-only, Hybrid)
A book that is rank 1 in only one text branch scores exactly 0.5 = the 0.5 acceptance threshold. Effects: (a) every legible out-of-catalog cover returns its nearest catalog neighbour (27/27); (b) correct OCR answers that miss the full-text branch also sit at 0.5 (e.g. Q-EN-0019: OCR read "Katherine M. Yates", the catalog says "Katherine Merritte Yates"; the single letter "M" breaks the all-terms-must-match full-text query), so they cannot be separated from false accepts by confidence.

### 2.3 Non-monotonic fusion (Hybrid)
When the correct book carries both signals, its confidence is 0.6·v + 0.4·o; a competitor with only one signal keeps its raw score. 61 Track B queries lost rank 1 this way. Typical Hán-Nôm case (C-VN-0019 *Nam Kỳ lục tỉnh địa dư chí*, 8 of its 9 perturbations): Qwen reads 南圻六省地輿誌 correctly; Qwen3-Embedding matches it cross-lingually to the quốc-ngữ catalog title (o = 0.5); CLIP gives v = 0.93–0.98; fused 0.76–0.79 < 0.92–0.93 for *Ấu học ngũ ngôn thi*, another Hán woodblock cover with only a visual score. CLIP-only answered all of these correctly (Hán-Nôm Track B: CLIP 0.972, Hybrid 0.139). The same mechanism explains Q-EN-0019 in Track A (correct: v 0.801, o 0.5 → 0.68; five unrelated cloth covers at 0.80–0.85 outrank it and push it out of the top 5).

### 2.4 OCR reading errors
On title-legible queries, Qwen's title matched after normalization in 83 % (Track A) / 82 % (Track B) and within fuzzy ratio 0.85 in 96 % / 86 %. Exact raw match is low (50 % / 36 %) because covers are printed in capitals or with line breaks ("The CLANSMAN", "THOMAS DIXON JR"). Observed reading errors: "Đường Kích mệnh" for *Đường kách mệnh* (archaic spelling normalised by the model), "The Gnome King of Z" (stylised Oz logo), "The MoonMaid" (missing space), subtitle appended ("How the Other Half Lives: Studies Among the Tenements of New York"), diacritic changes in Vietnamese ("TIÊN-NGUYỄN LOÁT-YỂU PHỒ" for *Tiên-Nguyên loát-yếu phổ*, "Huyện" for "Huyên"). Author accuracy (normalized exact 75 % / 63 %) is lower than title accuracy: honorifics and initials ("Mrs. George Corbett", "J·H·Fabre", "A. Merritt") and multiple authors break exact matching. Normalized matching tolerates case and diacritics; a misread letter usually still reaches the right book through the semantic branch.

### 2.5 Wrong-edition and similar-cover confusion
- Different-cover queries (other edition, jacket vs. cloth): CLIP 0/11; OCR-only and Hybrid 10/11 (the miss is the untitled *Jaws* paperback art). Edition-level identity is therefore only as good as the visual branch: when OCR alone finds the book, the returned `variant_id` is the catalog's default variant, not the depicted edition.
- Series and same-author confusion: Oz books (11 in the catalog) and Thomas Dixon's *The Clansman* / *The Traitor* (identical red cloth design) were resolved by OCR; the OOC hard negatives of the same author/series were *not* rejected (§2.2).
- Visually generic covers (plain cloth with small lettering) attract each other: *The Man Who Died Twice*, *Afloat and Ashore* and *Aladdin O'Brien* appear repeatedly as wrong visual matches (see `errors.md`).

### 2.6 Catalog / data issues
No catalog-missing-image errors occurred (gallery 154/154 embedded). One catalog title conflict was documented during annotation (*A Month in Honolulu* vs. Wikidata *Diary of One Month in Honolulu*); the printed title was used and OCR matched it.

## 3. Success examples (first by query id per stratum, not selected)

- Track A, same edition, photo: Q-EN-0037 (*Dracula* 1897, photo of a worn yellow copy) → all three methods rank *Dracula* first (CLIP 0.908).
- Track A, different cover: Q-EN-0029 (*The Sun Also Rises*, later paperback) → OCR-only and Hybrid first (OCR "The Sun Also Rises" / "Ernest Hemingway"); CLIP no result.
- Track B, Vietnamese Latin, occlusion: C-VN-0045 *Đất rừng phương Nam* → OCR-only and Hybrid first through the text signal alone (0.5); CLIP-only no result (cosine below the gate).
- Track A, Vietnamese: C-VN-0064 (*Đường kách mệnh*, angled museum photo in a display case) → OCR-only and Hybrid first despite the misread "Kích"; CLIP cosine 0.69 (rank 3).
