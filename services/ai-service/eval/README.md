# Labeled evals: extraction accuracy & assistant tool selection

Two standalone, manually-run scripts that measure the AI service against a
labeled ground truth, for the experimental-results chapter. They are **not**
part of CI: both call out to live systems (public book APIs, a running
Ollama) that are slow and non-deterministic, so a red/green pass/fail in CI
would be noise, not signal. Run them yourself whenever you want a number.

## 1. ISBN extraction accuracy — `eval_isbn_extraction.py`

Calls `lookup_book_by_isbn()` from `main.py` in-process (real network calls
to Google Books / Open Library / marketplace scraping) for every entry in
`isbn_dataset.json`, and scores the result against the labeled ground truth
field by field (title, authors, publisher, year).

**Requirements:** the same Python environment the ai-service itself runs in
(`pip install -r requirements.txt` — this needs `sqlalchemy` etc. because it
imports `main.py`, same as `test_enrich_book_after_isbn.py` already does) and
outbound internet access.

```bash
cd services/ai-service
python eval/eval_isbn_extraction.py
```

Prints per-ISBN progress and a summary, and writes a full report to
`eval/reports/isbn_extraction_<timestamp>.md` (accuracy per field, per-ISBN
pass/fail table, and a list of every title/publisher mismatch so you can see
*why* a lookup was wrong, not just that it was).

### `isbn_dataset.json`

Each entry is one ground-truth record:

```json
{ "isbn13": "9780439708180", "title": "...", "authors": ["..."], "publisher": "...", "year": 1999 }
```

The 25 entries currently in the file are all internationally well-known
titles, and every `title`/`authors`/`publisher`/`year` value was cross-checked
against a live Open Library record for that exact ISBN13 before being written
down (a `publisher`/`year` was left `null` — meaning "don't check this field"
in `scoring.py` — wherever the fetched record looked like an unreliable
edition, e.g. a print-on-demand reprint). No Vietnamese titles are included:
several candidate ISBNs could not be verified against a live source from this
environment (network flakiness / not indexed), and an unverified guess is
worse than no entry. **Add real ISBNs from your own catalog** (with known-
correct metadata) to cover the Vietnamese-language case this system actually
serves day to day, and re-verify any entry here before treating results as
final — a wrong ISBN or ground-truth value would silently make a correct
lookup look wrong, or vice versa.

Matching is fuzzy for text fields (`difflib`, accent/case-insensitive,
threshold 0.85 — see `scoring.py`) so cosmetic differences ("NXB Trẻ" vs
"Nha Xuat Ban Tre") don't count as mismatches; year matching is exact.

## 2. Assistant tool-selection accuracy — `eval_assistant_tools.py`

For every labeled question in `assistant_dataset.json`, runs **one**
Ollama tool-calling round with the exact same system prompt and tool schemas
`/assistant` uses (imported from `main.py`), and compares the set of tools
the model chose to call against the expected set. This isolates the model's
tool-selection decision from the rest of the endpoint (auth, conversation
history, caching, multi-round follow-ups) — those are exercised by
`docs/TEST_GUIDES/` manual flows instead.

**Requirements:** a running Ollama with `ASSISTANT_MODEL` pulled (default
`llama3.1:8b-instruct-q4_0`). Set `OLLAMA_HOST` if Ollama isn't reachable at
the in-Docker default (`http://ollama:11434`) — e.g. from a host shell
against `docker compose`'s Ollama:

```bash
cd services/ai-service
OLLAMA_HOST=http://localhost:11434 python eval/eval_assistant_tools.py
```

Reports exact-match rate plus average precision/recall (a question expecting
one tool but getting two loses precision, not recall; missing a required
tool loses recall, not precision) and writes
`eval/reports/assistant_tools_<timestamp>.md`.

### `assistant_dataset.json`

28 Vietnamese questions covering all 11 analytics tools, two multi-tool
questions, and three questions that should call **no** tool (greetings,
thanks, an unrelated question) — a model that over-calls tools on those
tanks precision just as much as picking the wrong tool would.

## Scoring internals

`scoring.py` holds every comparison function as a pure, unit-tested unit (see
`../test_eval_scoring.py`) — no I/O, no dependency on `main.py` — so the
matching logic itself is verified independently of whether the live services
happen to be reachable when you run the scripts.
