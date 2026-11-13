# Chat answer evaluation — 20261112_231221

```json
{
 "mode": "rescore",
 "source_report": "chat_answers_20261112_211409.json",
 "dataset_version": "v2-2026-11-13",
 "old_summary": {
  "cases": 33,
  "verdicts": {
   "PASS": 26,
   "FAIL": 7,
   "UNVERIFIABLE": 0
  },
  "answer_accuracy": 0.788,
  "by_category": {
   "full_evidence": "4/4",
   "partial_evidence": "1/4",
   "no_evidence": "4/4",
   "false_premise": "4/4",
   "contradicts_kb": "3/4",
   "dynamic_data": "5/5",
   "multi_source": "3/4",
   "near_miss": "2/4"
  },
  "abstention_accuracy": 0.75,
  "false_refusal_rate": 0.0,
  "unsupported_claims": {
   "CONTRADICTION": 3,
   "INSUFFICIENT_EVIDENCE": 4,
   "UNCITED": 4
  },
  "unsupported_claim_cases": 5,
  "citation_precision": 0.633,
  "citation_relevance": 0.619,
  "citation_recall": 0.875,
  "citation_completeness": 0.8,
  "numeric_claim_support": 0.877,
  "grounding_warning_rate": 0.182,
  "throttled": 0,
  "method_note": "rule-based: fact phrases, curated contradictions, numeric support; free-text claims beyond these are not semantically verified"
 }
}
```

Deterministic scoring (see eval_chat_answers.py). UNVERIFIABLE is never counted as PASS.

## Summary

```json
{
 "cases": 33,
 "verdicts": {
  "PASS": 27,
  "FAIL": 4,
  "UNVERIFIABLE": 2
 },
 "answer_accuracy": 0.871,
 "by_category": {
  "full_evidence": "4/4",
  "partial_evidence": "1/4",
  "no_evidence": "4/4",
  "false_premise": "4/4",
  "contradicts_kb": "3/4 (+1 unverifiable)",
  "dynamic_data": "5/5",
  "multi_source": "3/4 (+1 unverifiable)",
  "near_miss": "3/4"
 },
 "abstention_accuracy": 0.875,
 "false_refusal_rate": 0.0,
 "unsupported_claims": {
  "CONTRADICTION": 2,
  "INSUFFICIENT_EVIDENCE": 4,
  "UNCITED": 2
 },
 "unsupported_claim_cases": 4,
 "citation_precision": 0.633,
 "citation_relevance": 0.619,
 "citation_recall": 0.875,
 "citation_completeness": 0.8,
 "numeric_claim_support": 0.903,
 "grounding_warning_rate": 0.0,
 "throttled": 0,
 "method_note": "rule-based: fact phrases, curated contradictions, numeric support; free-text claims beyond these are not semantically verified"
}
```

## Cases

| id | category | expect | verdict | abstained | contradictions | unsupported numbers | cited | provider |
|---|---|---|---|---|---|---|---|---|
| ans-full-01 | full_evidence | answer | PASS | False | - | - | membership-loan-limit, membership-plans-overview, renewal-count | openrouter |
| ans-full-02 | full_evidence | answer | PASS | False | - | - | account-security | openrouter |
| ans-full-03 | full_evidence | answer | PASS | False | - | - | fines-payment, wallet-vnpay | openrouter |
| ans-full-04 | full_evidence | answer | PASS | False | - | - | goods-receipt-process, warehouse-operations | openrouter |
| ans-part-01 | partial_evidence | partial | FAIL | False | co wifi mien phi | - | ai-assistant-scope, branches-opening-hours, reader-features | openrouter |
| ans-part-02 | partial_evidence | partial | PASS | True | - | - | borrowing-process, reservation-hold | openrouter |
| ans-part-03 | partial_evidence | partial | FAIL | True | - | - | library-law-reading-culture, membership-loan-limit, membership-plans-overview | openrouter |
| ans-part-04 | partial_evidence | partial | FAIL | False | co the tra gop | - | fines-payment, lost-item-fee | openrouter |
| ans-none-01 | no_evidence | abstain | PASS | True | - | - | - | abstention |
| ans-none-02 | no_evidence | abstain | PASS | True | - | - | - | abstention |
| ans-none-03 | no_evidence | abstain | PASS | True | - | - | - | abstention |
| ans-none-04 | no_evidence | abstain | PASS | True | - | - | - | abstention |
| ans-false-01 | false_premise | correct_premise | PASS | False | - | - | fine-calculation, fines-payment | openrouter |
| ans-false-02 | false_premise | correct_premise | PASS | False | - | - | account-security | openrouter |
| ans-false-03 | false_premise | correct_premise | PASS | False | - | - | membership-loan-limit, membership-plans-overview, renewal-count | openrouter |
| ans-false-04 | false_premise | correct_premise | PASS | False | - | - | account-security, fines-payment, wallet-vnpay | openrouter |
| ans-contra-01 | contradicts_kb | correct_premise | PASS | False | - | - | book-care, lost-item-fee | openrouter |
| ans-contra-02 | contradicts_kb | correct_premise | UNVERIFIABLE | False | - | 15000, 35, 40000 | fines-payment, wallet-vnpay | openrouter |
| ans-contra-03 | contradicts_kb | correct_premise | PASS | False | - | - | fines-payment, lost-item-fee | openrouter |
| ans-contra-04 | contradicts_kb | correct_premise | PASS | False | - | - | fines-payment, lost-item-fee | openrouter |
| ans-dyn-01 | dynamic_data | dynamic | PASS | False | - | - | borrowing-process, membership-plans-overview, reader-features | openrouter |
| ans-dyn-02 | dynamic_data | dynamic | PASS | False | - | - | fines-payment | openrouter |
| ans-dyn-03 | dynamic_data | dynamic | PASS | False | - | - | - | openrouter |
| ans-dyn-04 | dynamic_data | dynamic | PASS | False | - | - | branches-opening-hours, warehouse-operations | openrouter |
| ans-multi-01 | multi_source | answer | PASS | False | - | - | fine-calculation, fines-payment | openrouter |
| ans-multi-02 | multi_source | answer | UNVERIFIABLE | False | - | 41 | membership-loan-limit, membership-plans-overview, renewal-count | openrouter |
| ans-multi-03 | multi_source | answer | PASS | False | - | - | fines-payment, lost-item-fee | openrouter |
| ans-multi-04 | multi_source | answer | PASS | False | - | - | borrowing-process, reservation-hold | openrouter |
| ans-near-01 | near_miss | abstain | PASS | True | - | - | branches-opening-hours, membership-plans-overview, reader-features | openrouter |
| ans-near-02 | near_miss | abstain | FAIL | False | - | - | membership-plans-overview, renewal-count | openrouter |
| ans-near-03 | near_miss | abstain | PASS | True | - | - | borrowing-process, membership-plans-overview, reader-features | openrouter |
| ans-near-04 | near_miss | abstain | PASS | True | - | - | book-care, membership-plans-overview, reader-features | openrouter |
| ans-dyn-05 | dynamic_data | dynamic | PASS | False | - | - | fines-payment, renewal-count | openrouter |

## Dynamic-data checks

- `ans-dyn-01` PASS: {"truth_source": "GET /borrow/my/loans (status BORROWED|OVERDUE)", "numeric": true, "entity": true, "fabricated_ids": []}
- `ans-dyn-02` PASS: {"truth_source": "GET /borrow/my/fines (status not PAID|WAIVED, total_fine_balance)", "numeric": true, "entity": true, "fabricated_ids": []}
- `ans-dyn-03` PASS: {"truth_source": "GET /borrow/loans?status=OVERDUE meta.total", "numeric": true, "entity": true, "fabricated_ids": []}
- `ans-dyn-04` PASS: {"truth_source": "GET /api/my-warehouse-tasks (non-terminal status; created_at for today)", "numeric": true, "entity": true, "fabricated_ids": [], "temporal": true}
- `ans-dyn-05` PASS: {"truth_source": "GET /borrow/loans?status=OVERDUE meta.total", "authorization": true}
