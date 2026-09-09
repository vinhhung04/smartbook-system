# Labeled evals: extraction accuracy, tool selection & answer quality

Three standalone, manually-run scripts that measure the AI service against a
labeled ground truth, for the experimental-results chapter. None of them are
part of CI: all three call out to live systems (public book APIs, a running
Ollama, or the full running stack) that are slow and non-deterministic, so a
red/green pass/fail in CI would be noise, not signal. Run them yourself
whenever you want a number.

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

For every labeled question in `assistant_dataset.json`, runs the exact same
system prompt and tool schemas `/assistant` uses (imported from `main.py`)
against Ollama directly, and compares the set of tools the model chose to
call against the expected set. This isolates the model's tool-selection
decision from the rest of the endpoint (auth, conversation history, caching)
— those are exercised by `eval_assistant_answers.py` (below) and
`docs/TEST_GUIDES/` manual flows instead.

Reports **two** numbers per run: `round1` (a single tool-calling round —
directly comparable to the original single-round baseline report) and
`multi_round` (continues the loop up to `ASSISTANT_MAX_TOOL_ROUNDS`, feeding
back a stub tool result after each round so the model can call more tools in
a later round). `ask_once` measures the fast case; `ask_multi_round` measures
whether the loop's later rounds recover from a first-round miss — a compound
question that round 1 misses can still succeed in `multi_round`.

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

34 Vietnamese questions covering all 11 analytics tools, eight multi-tool
questions, and three questions that should call **no** tool (greetings,
thanks, an unrelated question) — a model that over-calls tools on those
tanks precision just as much as picking the wrong tool would.

## 3. Assistant answer quality — `eval_assistant_answers.py`

Unlike the two evals above, this one drives the **real, running** `/assistant`
endpoint end-to-end (fast path, LLM tool-calling loop, tool execution,
evidence extraction, grounding) via the gateway, and scores the *answer
text* itself — not just which tools got called.

**Requirements:** the full stack running (`docker compose up`) — gateway,
auth-service, ai-service, Ollama. It logs itself in (`ASSISTANT_EVAL_USERNAME`
/ `ASSISTANT_EVAL_PASSWORD`, default `manager01` / `123456`) and calls
`POST /ai/assistant` through `SMARTBOOK_GATEWAY_URL` (default
`http://localhost:3000`).

```bash
cd services/ai-service
python eval/eval_assistant_answers.py
```

Reports `number_recall`, `fact_recall`, `citation_rate`, `refusal_accuracy`,
`hallucinated_number_rate`, and `overall_pass_rate`, and writes
`eval/reports/assistant_answers_<timestamp>.md` with a per-question table
plus a **Misses** section naming exactly which number/fact was missing (or
which forbidden content/hallucinated number appeared) so a failure is
diagnosable, not just counted.

### Design: `required_numbers` are JSON paths, not hardcoded values

Each dataset entry names a path into the tool result the run actually
fetches — e.g. `"get_overdue_summary.total_overdue_loans"` — resolved at run
time via `resolve_path()`, never hardcoded as a literal number in the
dataset. Hardcoding "27 phiếu quá hạn" would break the moment the database
changes and would be unrunnable on anyone else's data — fatal for a
reproducible thesis artifact. The tool result **is** the source of truth the
answer must stay faithful to; that's the methodological point this eval
makes, not an incidental implementation detail.

### `hallucinated_numbers` vs. the production `verify_numeric_grounding`

`scoring.hallucinated_numbers` (used by every entry, not just the two probes
at the end of the dataset) is a stricter, value-and-tolerance based
hallucination check than `rag.verify_numeric_grounding`'s production
digit-substring heuristic, and it sees the *whole* tool-result payload rather
than a 9000-char truncated slice. It is intentionally **not** used to change
production behaviour — see "Things NOT done" below — only to measure it.

### `answer_dataset.json`

30 entries: 18 grounded analytics questions (covering all 11 tools), 4
compound questions, 4 out-of-scope refusals (weather, stock prices, a
customer's phone number, "write me a poem"), 2 unanswerable-from-data
refusals (next quarter's revenue, whether to open a new branch — probing
whether the model invents a forecast instead of declining), and 2
hallucination probes (a warehouse that doesn't exist in the seed catalog; a
sales-revenue figure this lending-library system has no endpoint for).

## Things intentionally NOT done here (see the design doc for the full reasoning)

- The flat `collected_data` dict in `main.py` is not restructured — a second
  call to the same tool with different arguments is stored under
  `f"{name}#2"` rather than overwriting the first, which is enough for every
  case in these datasets without the wider blast radius of a shape change.
- `rag.verify_numeric_grounding` is not rewritten to use the stricter
  value-based check — `hallucinated_numbers` above **is** that stricter
  check, deliberately kept at the measurement layer first. If a future run
  shows its false-positive/negative rate diverging badly from the production
  warning, that's the evidence to justify changing the production function.

## Scoring internals

`scoring.py` holds every comparison function as a pure, unit-tested unit (see
`../test_eval_scoring.py`) — no I/O, no dependency on `main.py` — so the
matching logic itself is verified independently of whether the live services
happen to be reachable when you run the scripts.
