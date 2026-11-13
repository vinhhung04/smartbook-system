"""End-to-end answer evaluation of the General AI Chatbot (Phase B2, revised Phase E).

Retrieval accuracy (eval_rag.py) says whether the right document was FOUND;
this says whether the final ANSWER is right. Every case in
chat_answer_dataset.json is sent to the live /ai/chat through the gateway as a
real demo user, and the reply is scored deterministically. Each case ends
PASS, FAIL or UNVERIFIABLE - a case is never PASS just because a reply exists.

Document cases (answer / correct_premise / partial / abstain):
- facts         every `must_include` fact, and one alternative of every
                `must_include_any` group, is in the reply;
- forbidden     no `must_not_include` phrase (curated contradictions and
                invented policies) - reported as a CONTRADICTION claim;
- abstention    abstain cases must say the information is missing, answerable
                ones must not (false refusal); partial cases need both the known
                half and the acknowledged gap.
Dynamic-data cases (the user's live records): the expected facts are read at
eval time from the authoritative service with the same user's token
(TRUTH_SOURCES); a case whose truth cannot be read is UNVERIFIABLE, never PASS.
- numeric       the expected count (or a "none" statement when it is 0) is there;
- entity        no record id the user does not have (fabricated ids);
- temporal      "today" questions are checked against the records' dates;
- scope / authorization   data the user may not see (a library-wide figure
                asked by a reader) must not appear.

Citations - kept as separate numbers, never folded into one score, and never
taken as proof the content is right:
- precision     share of cited documents that are in `expected_docs`;
- relevance     share of cited documents that are acceptable
                (`expected_docs` + `acceptable_docs`);
- recall        share of `expected_docs` that were cited;
- completeness  every expected document cited (recall == 1);
- numeric claim support   every number in the reply occurs in a cited
                document (rule-based: numbers only, not semantic entailment).

Unsupported claims are classified, not keyword-counted:
- CONTRADICTION         a forbidden phrase (curated per case) the reply asserts
                        (one offered as an alternative - "cho phép hay cấm" - is not);
- INSUFFICIENT_EVIDENCE a number that occurs in no corpus document at all - the
                        case is then UNVERIFIABLE (invented or derived: rules cannot tell);
- UNCITED               a number found in the corpus but not in a cited document;
Every other free-text claim is UNVERIFIABLE by this script (no semantic check).

    python eval/eval_chat_answers.py --password <demo password> [--gateway http://localhost:3000]
    python eval/eval_chat_answers.py --rescore eval/reports/chat_answers_<stamp>.json
        re-scores the replies stored in an old report with today's scorer
        (dynamic cases reuse the truth observed during that run when the report
        kept it - `truth_observed` - and are UNVERIFIABLE otherwise).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone

import httpx

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
REPORTS_DIR = os.path.join(EVAL_DIR, "reports")
CORPUS_DIR = os.path.join(os.path.dirname(EVAL_DIR), "corpus")
DATASET_PATH = os.path.join(EVAL_DIR, "chat_answer_dataset.json")
ABSTAIN_MARKERS = ("chua co thong tin", "chua co du thong tin", "chua tim thay thong tin", "khong co thong tin",
                   "chua co du lieu", "chua du thong tin", "chua co quy dinh", "chua xac minh duoc",
                   "khong tim thay thong tin", "chua de cap", "khong de cap", "chua duoc quy dinh",
                   "khong quy dinh", "chua mo ta")
NONE_MARKERS = ("khong co", "chua co", "khong con", "0 ", "khong dang", "khong ton tai", "da tra het",
                "khong phat sinh")
GROUNDING_WARNING = "không khớp trực tiếp với dữ liệu"
PASS, FAIL, UNVERIFIABLE = "PASS", "FAIL", "UNVERIFIABLE"


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", (text or "").lower().replace("đ", "d"))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    # thousands separators: "10.000đ" -> "10000d" (no \b after the digits: đ became d)
    return re.sub(r"(?<=\d)[.,](?=\d{3}(?!\d))", "", text)


def forbidden_hits(reply_norm: str, phrases: list[str]) -> list[str]:
    """Curated contradicting phrases asserted by the reply. A phrase offered as
    one side of an alternative ("cho phép hay cấm mang thú cưng") is not an
    assertion of it. Rule-based: other negations are not understood."""
    hits = []
    for phrase in phrases:
        target = normalize(phrase)
        for match in re.finditer(re.escape(target), reply_norm):
            before = reply_norm[max(0, match.start() - 6):match.start()]
            if not re.search(r"\b(hay|hoac)\s$", before):
                hits.append(phrase)
                break
    return hits


def abstained(body: dict) -> bool:
    return body.get("ai_provider") == "abstention" or any(m in normalize(body.get("reply", "")) for m in ABSTAIN_MARKERS)


# ── numbers ─────────────────────────────────────────────────────────────────

_LIST_MARKER = re.compile(r"(?m)^\s*\d+[.)]\s")
_NUMBER = re.compile(r"(?<![\d.,])\d+(?:[.,]\d+)?(?![\d])")
_TIME = re.compile(r"(?<!\d)\d{1,2}[:h]\d{2}(?!\d)")


def numbers_in(text: str) -> set[str]:
    """Numbers stated in a text, thousands separators removed, list markers
    ('1. ', '2) ') and ISO dates left out - those are formatting, not claims."""
    norm = normalize(text)
    norm = _LIST_MARKER.sub(" ", norm)
    norm = re.sub(r"\d{4}-\d{2}-\d{2}(t[\d:.]+z?)?", " ", norm)
    norm = _TIME.sub(" ", norm)
    norm = re.sub(r"\bx(?=\d)", " ", norm)                 # "x1.5" multiplier -> 1.5
    norm = re.sub(r"\b[a-z_]+\d+[a-z0-9_]*\b", " ", norm)  # usernames / codes: customer01, act_1a2b
    return {n.replace(",", ".") for n in _NUMBER.findall(norm)}


def load_corpus() -> dict[str, str]:
    docs = {}
    for path in glob.glob(os.path.join(CORPUS_DIR, "*.md")):
        with open(path, encoding="utf-8") as fh:
            docs[os.path.splitext(os.path.basename(path))[0]] = fh.read()
    return docs


def numeric_claims(reply: str, question: str, cited: set[str], corpus: dict[str, str],
                   verified: tuple[str, ...] = ()) -> dict:
    """Every number in the reply that the question did not already contain,
    checked against the cited documents, then the whole corpus. `verified` =
    the case's own expected facts (e.g. a fine computed from two documents,
    6000 = 2000 x 3): ground truth checked by hand, so supported though no
    document spells it out."""
    claims = sorted(numbers_in(reply) - numbers_in(question))
    verified_numbers = set().union(*(numbers_in(v) for v in verified)) if verified else set()
    cited_numbers = set().union(*(numbers_in(corpus.get(d, "")) for d in cited)) if cited else set()
    corpus_numbers = set().union(*(numbers_in(t) for t in corpus.values())) if corpus else set()
    supported = [n for n in claims if n in cited_numbers or n in verified_numbers]
    uncited = [n for n in claims if n not in supported and n in corpus_numbers]
    unsupported = [n for n in claims if n not in supported and n not in corpus_numbers]
    return {"claims": claims, "supported": supported, "uncited": uncited, "unsupported": unsupported,
            "support_rate": round(len(supported) / len(claims), 3) if claims else None}


# ── live truth for dynamic-data cases ───────────────────────────────────────

TERMINAL_TASK_STATUSES = {"POSTED", "CONVERTED", "WITHDRAWN", "COMPLETED", "CANCELLED", "CLOSED", "RESOLVED",
                          "DONE", "REJECTED"}


def _items(payload):
    data = payload.get("data") if isinstance(payload, dict) else payload
    if isinstance(data, dict):
        for key in ("items", "fines", "loans", "tasks"):
            if isinstance(data.get(key), list):
                return data[key]
    return data if isinstance(data, list) else []


def _truth_my_active_loans(get) -> dict:
    loans = _items(get("/borrow/my/loans"))
    active = [l for l in loans if l.get("status") in ("BORROWED", "OVERDUE")]
    ids = {str(l.get("id")) for l in loans} | {str(l.get("loan_number")) for l in loans}
    return {"count": len(active), "known_ids": ids, "source": "GET /borrow/my/loans (status BORROWED|OVERDUE)"}


def _truth_my_unpaid_fines(get) -> dict:
    payload = get("/borrow/my/fines")
    data = payload.get("data") if isinstance(payload, dict) else {}
    fines = data.get("fines") or [] if isinstance(data, dict) else []
    unpaid = [f for f in fines if f.get("status") not in ("PAID", "WAIVED")]
    balance = int(float(data.get("total_fine_balance") or 0)) if isinstance(data, dict) else 0
    return {"count": len(unpaid), "amount": balance, "known_ids": {str(f.get("id")) for f in fines},
            "source": "GET /borrow/my/fines (status not PAID|WAIVED, total_fine_balance)"}


def _truth_overdue_total(get) -> dict:
    payload = get("/borrow/loans", status="OVERDUE", pageSize=1)
    total = (payload.get("meta") or {}).get("total") if isinstance(payload, dict) else None
    if total is None:
        raise ValueError("no meta.total in /borrow/loans")
    return {"count": int(total), "known_ids": set(), "source": "GET /borrow/loans?status=OVERDUE meta.total"}


def _truth_my_open_tasks(get) -> dict:
    tasks = _items(get("/api/my-warehouse-tasks"))
    today = datetime.now(timezone.utc).date().isoformat()
    open_tasks = [t for t in tasks if str(t.get("status")).upper() not in TERMINAL_TASK_STATUSES]
    created_today = [t for t in tasks if str(t.get("created_at", ""))[:10] == today]
    ids = {str(t.get("id")) for t in tasks} | {str(t.get("title")) for t in tasks}
    return {"count": len(open_tasks), "total_all_statuses": len(tasks), "created_today": len(created_today),
            "known_ids": ids, "source": "GET /api/my-warehouse-tasks (non-terminal status; created_at for today)"}


TRUTH_SOURCES = {
    "my_active_loans": _truth_my_active_loans,
    "my_unpaid_fines": _truth_my_unpaid_fines,
    "overdue_loans_total": _truth_overdue_total,
    "my_open_tasks": _truth_my_open_tasks,
}

_HEX_ID = re.compile(r"\b[0-9a-f]{8}\b")
_CODE_ID = re.compile(r"\b(?:exc|pr|po|gr|rsv|loan|tsk|pk|pa)-[0-9a-z-]{6,}\b")


def _fabricated_ids(reply_norm: str, known_ids: set[str]) -> list[str]:
    known = {k.lower() for k in known_ids if k}
    found = set(_HEX_ID.findall(reply_norm)) | set(_CODE_ID.findall(reply_norm))
    return sorted(i for i in found if not any(k.startswith(i) or i.startswith(k) for k in known))


def _states_none(reply_norm: str) -> bool:
    return any(m in reply_norm for m in NONE_MARKERS)


def score_dynamic(case: dict, body: dict, truth: dict | None) -> dict:
    reply = normalize(body.get("reply", ""))
    spec = case.get("truth") or {}
    checks: dict = {"truth_source": (truth or {}).get("source")}
    if body.get("ai_provider") in ("fallback", "abstention") or abstained(body):
        checks["refused"] = True
        if spec.get("kind") != "must_not_reveal":
            return {"verdict": FAIL, "checks": checks}
    if truth is None or "error" in (truth or {}):
        checks["truth_error"] = (truth or {}).get("error", "truth not fetched")
        return {"verdict": UNVERIFIABLE, "checks": checks}

    numbers = numbers_in(body.get("reply", ""))
    count = truth["count"]
    if spec.get("kind") == "must_not_reveal":
        # authorization: a figure only another role may see must not reach this user
        checks["authorization"] = str(count) not in numbers or count == 0
        return {"verdict": PASS if checks["authorization"] else FAIL, "checks": checks}

    checks["numeric"] = (str(count) in numbers) if count else (_states_none(reply) or "0" in numbers)
    if count and _states_none(reply) and str(count) not in numbers:
        checks["numeric"] = False
    if "amount" in truth and truth["amount"]:
        checks["amount"] = str(truth["amount"]) in numbers
    if truth.get("known_ids") is None:  # rescore: ids not stored -> keep the live run's verdict
        checks["entity"] = truth.get("entity_live")
        checks["fabricated_ids"] = truth.get("fabricated_live") or []
    else:
        fabricated = _fabricated_ids(reply, truth["known_ids"])
        checks["entity"] = not fabricated
        checks["fabricated_ids"] = fabricated
    if spec.get("kind") == "tasks_today":
        # "today": nothing was created today -> the reply may say so, or give
        # the open count; presenting every task ever (all statuses) as today's
        # work is wrong.
        total_all = truth.get("total_all_statuses")
        checks["temporal"] = not (total_all and total_all != count and str(total_all) in numbers)
        checks["numeric"] = checks["numeric"] or (truth.get("created_today") == 0 and _states_none(reply))
    passed = all(v for k, v in checks.items() if k in ("numeric", "amount", "entity", "temporal") and v is not None)
    return {"verdict": PASS if passed else FAIL, "checks": checks}


# ── document cases ──────────────────────────────────────────────────────────

def score(case: dict, body: dict, truth: dict | None = None, corpus: dict[str, str] | None = None) -> dict:
    corpus = corpus if corpus is not None else {}
    reply = normalize(body.get("reply", ""))
    cited = {s.get("endpoint", "")[len("faq://"):] for s in body.get("context_sources") or []
             if str(s.get("endpoint", "")).startswith("faq://")}
    expected = set(case.get("expected_docs") or [])
    acceptable = expected | set(case.get("acceptable_docs") or [])
    gave_up = abstained(body)
    expect = case["expect"]
    result = {
        "abstained": gave_up, "cited": sorted(cited),
        "false_refusal": gave_up and expect in ("answer", "correct_premise"),
        "citation_precision": round(len(cited & expected) / len(cited), 3) if cited and expected else None,
        "citation_relevance": round(len(cited & acceptable) / len(cited), 3) if cited and acceptable else None,
        "citation_recall": round(len(cited & expected) / len(expected), 3) if expected else None,
        "citation_complete": (cited >= expected) if expected else None,
        "grounding_warning": any(GROUNDING_WARNING in w for w in body.get("retrieval_warnings") or []),
        "forbidden_hits": [], "facts_ok": None, "numeric_claims": None, "unsupported_claims": [],
    }

    if expect == "dynamic":
        dyn = score_dynamic(case, body, truth)
        result.update({"verdict": dyn["verdict"], "dynamic_checks": dyn["checks"]})
        result["correct"] = None if dyn["verdict"] == UNVERIFIABLE else dyn["verdict"] == PASS
        return result

    facts_ok = all(normalize(f) in reply for f in case.get("must_include") or []) and all(
        any(normalize(alt) in reply for alt in group) for group in case.get("must_include_any") or [])
    forbidden = forbidden_hits(reply, case.get("must_not_include") or [])
    if expect == "abstain":
        correct = gave_up and not forbidden and facts_ok
    elif expect == "partial":
        correct = facts_ok and gave_up and not forbidden
    else:  # answer, correct_premise
        correct = facts_ok and not forbidden and not gave_up

    claims = (numeric_claims(body.get("reply", ""), case.get("question", ""), cited or expected, corpus,
                             tuple(case.get("must_include") or [])) if corpus else None)
    unsupported = [{"type": "CONTRADICTION", "text": p} for p in forbidden]
    if claims:
        unsupported += [{"type": "INSUFFICIENT_EVIDENCE", "text": n} for n in claims["unsupported"]]
        unsupported += [{"type": "UNCITED", "text": n} for n in claims["uncited"]]
    # A number no document contains may be invented - or derived (21 + 10 + 10).
    # Rules cannot tell which, so an otherwise correct reply is UNVERIFIABLE (never PASS).
    verdict = PASS if correct else FAIL
    if correct and claims and claims["unsupported"]:
        verdict, correct = UNVERIFIABLE, None
    result.update({"correct": correct, "verdict": verdict, "facts_ok": facts_ok,
                   "forbidden_hits": forbidden, "numeric_claims": claims, "unsupported_claims": unsupported})
    return result


def ask(client: httpx.Client, gateway: str, token: str, question: str) -> dict:
    for attempt in range(4):
        r = client.post(f"{gateway}/ai/chat", json={"message": question, "conversation_history": []},
                        headers={"Authorization": f"Bearer {token}"})
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        # 429 from ai-service, or the model fell back because OpenRouter throttled: wait, ask again
        if r.status_code != 429 and body.get("ai_provider") != "fallback":
            return {"status": r.status_code, **body}
        time.sleep(25 * (attempt + 1))
    return {"status": r.status_code, **body, "throttled": True}


def fetch_truth(client: httpx.Client, gateway: str, token: str, spec: dict) -> dict:
    def get(endpoint, **params):
        response = client.get(f"{gateway}{endpoint}", params=params, headers={"Authorization": f"Bearer {token}"})
        response.raise_for_status()
        return response.json()
    try:
        return TRUTH_SOURCES[spec["source"]](get)
    except Exception as exc:  # noqa: BLE001 - recorded, and the case becomes UNVERIFIABLE
        return {"error": f"{type(exc).__name__}: {exc}"[:200]}


def summarize(rows: list[dict]) -> dict:
    def rate(items, key):
        values = [i[key] for i in items if i.get(key) is not None]
        return round(sum(1 for v in values if v) / len(values), 3) if values else None

    def mean(key):
        values = [r[key] for r in rows if r.get(key) is not None]
        return round(sum(values) / len(values), 3) if values else None

    by_category = {}
    for row in rows:
        by_category.setdefault(row["category"], []).append(row)
    verifiable = [r for r in rows if r["verdict"] != UNVERIFIABLE]
    answerable = [r for r in rows if r["expect"] in ("answer", "correct_premise")]
    abstain = [r for r in rows if r["expect"] == "abstain"]
    unsupported = [c for r in rows for c in r.get("unsupported_claims") or []]
    claims = [r["numeric_claims"] for r in rows if r.get("numeric_claims") and r["numeric_claims"]["claims"]]
    return {
        "cases": len(rows),
        "verdicts": {v: sum(1 for r in rows if r["verdict"] == v) for v in (PASS, FAIL, UNVERIFIABLE)},
        # over verifiable cases only; UNVERIFIABLE is reported, never counted as a pass
        "answer_accuracy": rate(verifiable, "correct"),
        "by_category": {c: f"{sum(r['verdict'] == PASS for r in items)}/{len(items)}"
                           + (f" (+{sum(r['verdict'] == UNVERIFIABLE for r in items)} unverifiable)"
                              if any(r['verdict'] == UNVERIFIABLE for r in items) else "")
                        for c, items in by_category.items()},
        "abstention_accuracy": rate(abstain, "correct"),
        "false_refusal_rate": rate(answerable, "false_refusal"),
        "unsupported_claims": {t: sum(1 for c in unsupported if c["type"] == t)
                               for t in ("CONTRADICTION", "INSUFFICIENT_EVIDENCE", "UNCITED")},
        "unsupported_claim_cases": sum(1 for r in rows if any(c["type"] != "UNCITED"
                                                              for c in r.get("unsupported_claims") or [])),
        "citation_precision": mean("citation_precision"),
        "citation_relevance": mean("citation_relevance"),
        "citation_recall": mean("citation_recall"),
        "citation_completeness": rate([r for r in rows if r.get("citation_complete") is not None], "citation_complete"),
        "numeric_claim_support": (round(sum(len(c["supported"]) for c in claims)
                                        / sum(len(c["claims"]) for c in claims), 3) if claims else None),
        "grounding_warning_rate": rate(rows, "grounding_warning"),
        "throttled": sum(1 for r in rows if r.get("throttled")),
        "method_note": "rule-based: fact phrases, curated contradictions, numeric support; free-text claims beyond "
                       "these are not semantically verified",
    }


def write_report(rows: list[dict], summary: dict, meta: dict, stamp: str, prefix: str = "chat_answers") -> str:
    os.makedirs(REPORTS_DIR, exist_ok=True)
    with open(os.path.join(REPORTS_DIR, f"{prefix}_{stamp}.json"), "w", encoding="utf-8") as fh:
        json.dump({"meta": meta, "summary": summary, "rows": rows}, fh, ensure_ascii=False, indent=1, default=sorted)
    lines = [f"# Chat answer evaluation — {stamp}", "", "```json", json.dumps(meta, ensure_ascii=False, indent=1), "```",
             "", "Deterministic scoring (see eval_chat_answers.py). UNVERIFIABLE is never counted as PASS.", "",
             "## Summary", "", "```json", json.dumps(summary, ensure_ascii=False, indent=1), "```", "", "## Cases", "",
             "| id | category | expect | verdict | abstained | contradictions | unsupported numbers | cited | provider |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        nums = r.get("numeric_claims") or {}
        lines.append(f"| {r['id']} | {r['category']} | {r['expect']} | {r['verdict']} | {r['abstained']} | "
                     f"{', '.join(r.get('forbidden_hits') or []) or '-'} | {', '.join(nums.get('unsupported') or []) or '-'} | "
                     f"{', '.join(r['cited']) or '-'} | {r.get('provider')} |")
    dyn = [r for r in rows if r.get("dynamic_checks")]
    if dyn:
        lines += ["", "## Dynamic-data checks", ""]
        lines += [f"- `{r['id']}` {r['verdict']}: {json.dumps(r['dynamic_checks'], ensure_ascii=False, default=sorted)}"
                  for r in dyn]
    path = os.path.join(REPORTS_DIR, f"{prefix}_{stamp}.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return path


def load_dataset() -> tuple[list[dict], str]:
    with open(DATASET_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        return data["cases"], data.get("version", "unversioned")
    return data, "v1"


def rescore(report_path: str) -> int:
    """Old replies, today's scorer and today's ground truth: shows what the old
    numbers were worth. Truth for dynamic cases is not reconstructed."""
    with open(report_path, encoding="utf-8") as fh:
        old = json.load(fh)
    cases, version = load_dataset()
    by_id = {c["id"]: c for c in cases}
    corpus = load_corpus()
    rows = []
    for old_row in old["rows"]:
        case = by_id.get(old_row["id"])
        if case is None:
            continue
        body = {"reply": old_row.get("reply") or "", "ai_provider": old_row.get("provider"),
                "context_sources": [{"endpoint": f"faq://{d}"} for d in old_row.get("cited") or []]}
        truth = None
        if old_row.get("truth_observed") and case.get("truth"):
            live = old_row.get("dynamic_checks") or {}
            truth = {**old_row["truth_observed"], "known_ids": None,
                     "entity_live": live.get("entity"), "fabricated_live": live.get("fabricated_ids")}
        rows.append({**case, **score(case, body, truth, corpus), "reply": body["reply"],
                     "provider": old_row.get("provider"), "truth_observed": old_row.get("truth_observed")})
    summary = summarize(rows)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    meta = {"mode": "rescore", "source_report": os.path.basename(report_path), "dataset_version": version,
            "old_summary": old.get("summary")}
    print(write_report(rows, summary, meta, stamp, prefix="chat_answers_rescore"))
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default=os.getenv("EVAL_GATEWAY_URL", "http://localhost:3000"))
    parser.add_argument("--password", default=os.getenv("EVAL_PASSWORD", ""))
    parser.add_argument("--delay", type=float, default=6.0)
    parser.add_argument("--rescore", help="re-score the replies stored in an old report JSON")
    parser.add_argument("--only", help="comma-separated case ids")
    args = parser.parse_args()
    if args.rescore:
        return rescore(args.rescore)
    if not args.password:
        parser.error("--password (or EVAL_PASSWORD) is required")
    cases, version = load_dataset()
    if args.only:
        wanted = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in wanted]
    corpus = load_corpus()

    rows, tokens = [], {}
    with httpx.Client(timeout=180) as client:
        def token_for(user):
            if user not in tokens:
                tokens[user] = client.post(f"{args.gateway}/auth/login",
                                           json={"identifier": user, "password": args.password}).json()["token"]
            return tokens[user]

        for case in cases:
            body = ask(client, args.gateway, token_for(case["user"]), case["question"])
            truth = None
            if case.get("truth"):
                spec = case["truth"]
                truth = fetch_truth(client, args.gateway, token_for(spec.get("as_user", case["user"])), spec)
            truth_record = {k: v for k, v in (truth or {}).items() if k != "known_ids"} if truth else None
            row = {**case, **score(case, body, truth, corpus), "truth_observed": truth_record,
                   "reply": body.get("reply"), "intent": body.get("intent"),
                   "provider": body.get("ai_provider"), "throttled": body.get("throttled", False)}
            rows.append(row)
            print(f"{case['id']:14s} {row['verdict']:12s} provider={row['provider']} abst={row['abstained']} "
                  f"forbidden={row['forbidden_hits']}", flush=True)
            time.sleep(args.delay)

    summary = summarize(rows)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    meta = {"mode": "live", "dataset_version": version, "gateway": args.gateway,
            "timestamp_utc": stamp, "cases": len(rows)}
    print(write_report(rows, summary, meta, stamp))
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
