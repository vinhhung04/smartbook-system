# Chat answer evaluation — 20261112_231216

```json
{
 "mode": "rescore",
 "source_report": "chat_answers_20261112_192035.json",
 "dataset_version": "v2-2026-11-13",
 "old_summary": {
  "cases": 32,
  "answer_accuracy": 0.875,
  "by_category": {
   "full_evidence": "4/4",
   "partial_evidence": "2/4",
   "no_evidence": "4/4",
   "false_premise": "4/4",
   "contradicts_kb": "4/4",
   "dynamic_data": "4/4",
   "multi_source": "4/4",
   "near_miss": "2/4"
  },
  "abstention_accuracy": 0.75,
  "false_refusal_rate": 0.0,
  "unsupported_claim_cases": 0,
  "citation_precision": 0.64,
  "citation_completeness": 0.95,
  "grounding_warning_rate": 0.125,
  "throttled": 0
 }
}
```

Deterministic scoring (see eval_chat_answers.py). UNVERIFIABLE is never counted as PASS.

## Summary

```json
{
 "cases": 32,
 "verdicts": {
  "PASS": 24,
  "FAIL": 4,
  "UNVERIFIABLE": 4
 },
 "answer_accuracy": 0.857,
 "by_category": {
  "full_evidence": "4/4",
  "partial_evidence": "2/4",
  "no_evidence": "4/4",
  "false_premise": "4/4",
  "contradicts_kb": "4/4",
  "dynamic_data": "0/4 (+4 unverifiable)",
  "multi_source": "4/4",
  "near_miss": "2/4"
 },
 "abstention_accuracy": 0.75,
 "false_refusal_rate": 0.0,
 "unsupported_claims": {
  "CONTRADICTION": 2,
  "INSUFFICIENT_EVIDENCE": 0,
  "UNCITED": 2
 },
 "unsupported_claim_cases": 2,
 "citation_precision": 0.667,
 "citation_relevance": 0.65,
 "citation_recall": 0.875,
 "citation_completeness": 0.8,
 "numeric_claim_support": 0.957,
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
| ans-part-01 | partial_evidence | partial | PASS | True | - | - | ai-assistant-scope, branches-opening-hours, reader-features | openrouter |
| ans-part-02 | partial_evidence | partial | PASS | True | - | - | borrowing-process, reservation-hold | openrouter |
| ans-part-03 | partial_evidence | partial | FAIL | True | - | - | - | abstention |
| ans-part-04 | partial_evidence | partial | FAIL | False | - | - | fines-payment, lost-item-fee | openrouter |
| ans-none-01 | no_evidence | abstain | PASS | True | - | - | - | abstention |
| ans-none-02 | no_evidence | abstain | PASS | True | - | - | - | openrouter |
| ans-none-03 | no_evidence | abstain | PASS | True | - | - | - | abstention |
| ans-none-04 | no_evidence | abstain | PASS | True | - | - | - | abstention |
| ans-false-01 | false_premise | correct_premise | PASS | False | - | - | fine-calculation, fines-payment | openrouter |
| ans-false-02 | false_premise | correct_premise | PASS | False | - | - | account-security | openrouter |
| ans-false-03 | false_premise | correct_premise | PASS | False | - | - | membership-loan-limit, membership-plans-overview, renewal-count | openrouter |
| ans-false-04 | false_premise | correct_premise | PASS | False | - | - | account-security, fines-payment, wallet-vnpay | openrouter |
| ans-contra-01 | contradicts_kb | correct_premise | PASS | False | - | - | book-care, lost-item-fee | openrouter |
| ans-contra-02 | contradicts_kb | correct_premise | PASS | False | - | - | fines-payment, wallet-vnpay | openrouter |
| ans-contra-03 | contradicts_kb | correct_premise | PASS | False | - | - | fines-payment, lost-item-fee | openrouter |
| ans-contra-04 | contradicts_kb | correct_premise | PASS | False | - | - | fines-payment, lost-item-fee | openrouter |
| ans-dyn-01 | dynamic_data | dynamic | UNVERIFIABLE | False | - | - | borrowing-process, membership-plans-overview, reader-features | openrouter |
| ans-dyn-02 | dynamic_data | dynamic | UNVERIFIABLE | False | - | - | fines-payment | openrouter |
| ans-dyn-03 | dynamic_data | dynamic | UNVERIFIABLE | False | - | - | - | openrouter |
| ans-dyn-04 | dynamic_data | dynamic | UNVERIFIABLE | False | - | - | roles-permissions, warehouse-operations | openrouter |
| ans-multi-01 | multi_source | answer | PASS | False | - | - | fine-calculation, fines-payment | openrouter |
| ans-multi-02 | multi_source | answer | PASS | False | - | - | membership-loan-limit, membership-plans-overview, renewal-count | openrouter |
| ans-multi-03 | multi_source | answer | PASS | False | - | - | fines-payment, lost-item-fee | openrouter |
| ans-multi-04 | multi_source | answer | PASS | False | - | - | borrowing-process, reservation-hold | openrouter |
| ans-near-01 | near_miss | abstain | PASS | True | - | - | branches-opening-hours, membership-plans-overview, reader-features | openrouter |
| ans-near-02 | near_miss | abstain | FAIL | False | khong the thuc hien qua tin nhan sms | - | membership-plans-overview, renewal-count | openrouter |
| ans-near-03 | near_miss | abstain | PASS | True | - | - | - | abstention |
| ans-near-04 | near_miss | abstain | FAIL | False | bi han che | - | book-care, membership-plans-overview, reader-features | openrouter |

## Dynamic-data checks

- `ans-dyn-01` UNVERIFIABLE: {"truth_source": null, "truth_error": "truth not fetched"}
- `ans-dyn-02` UNVERIFIABLE: {"truth_source": null, "truth_error": "truth not fetched"}
- `ans-dyn-03` UNVERIFIABLE: {"truth_source": null, "truth_error": "truth not fetched"}
- `ans-dyn-04` UNVERIFIABLE: {"truth_source": null, "truth_error": "truth not fetched"}
