# chat_answer_dataset — changelog

v1 (32 cases) is kept unchanged as `chat_answer_dataset_v1.json`; reports made with it stay comparable. 
v2 = `chat_answer_dataset.json`. Verification: each change below was checked against the cited corpus document (`services/ai-service/corpus/`) or the live endpoint named in `truth`, during Phase E (2026-11-13). No case was changed to raise a score: four answer cases were made stricter, four dynamic cases gained expected facts, one authorization case was added.

## ans-part-03

roles-permissions.md lists the LIBRARIAN duties (confirm reservations, hand over by pickup code, lend, take returns, approve renewals, record fine payments); no corpus document has annual leave. The reply must name the role and at least one documented duty, and acknowledge the leave gap. 'librarian' alone was satisfied by the English role code without any duty.

| field | v1 | v2 |
|---|---|---|
| must_include | `["librarian"]` | `[]` |
| must_include_any | `null` | `[["librarian", "thu thu"], ["dat truoc", "cho muon", "nhan tra", "gia han", "thanh toan phat", "nghiep vu quay"]]` |

## ans-part-04

fines-payment.md: a fine 'có thể được thanh toán nhiều lần cho đến khi hết số tiền còn lại' and the desk may record a partial payment. No document describes an installment plan (fixed schedule). The reply must state the fee (100.000 VND base), the documented partial/multiple payment, and that an installment plan is not described - asserting either 'có/không được trả góp' is unsupported. fines-payment added to expected_docs because the payment fact lives there.

| field | v1 | v2 |
|---|---|---|
| expected_docs | `["lost-item-fee"]` | `["lost-item-fee", "fines-payment"]` |
| must_include_any | `null` | `[["nhieu lan", "mot phan"]]` |
| must_not_include | `["duoc tra gop", "khong duoc tra gop"]` | `["duoc tra gop", "duoc phep tra gop", "co the tra gop", "ho tro tra gop", "khong duoc tra gop", "khong the tra gop", "khong ho tro tra gop", "khong the thanh toan mot phan", "khong duoc thanh toan nhieu lan"]` |

## ans-dyn-01

v1 passed any non-refusal. Expected fact now read live: count of the reader's loans in BORROWED|OVERDUE from /borrow/my/loans; ids in the reply must be the reader's own.

| field | v1 | v2 |
|---|---|---|
| truth | `null` | `{"kind": "count", "source": "my_active_loans"}` |

## ans-dyn-02

Expected facts read live from /borrow/my/fines: unpaid fine count and total_fine_balance.

| field | v1 | v2 |
|---|---|---|
| truth | `null` | `{"kind": "count", "source": "my_unpaid_fines"}` |

## ans-dyn-03

Expected fact read live: meta.total of /borrow/loans?status=OVERDUE (librarian scope). The 2026-11-12 reply said 0 while the service reported 436 - and v1 scored it correct.

| field | v1 | v2 |
|---|---|---|
| truth | `null` | `{"kind": "count", "source": "overdue_loans_total"}` |

## ans-dyn-04

Expected facts read live from /api/my-warehouse-tasks: non-terminal tasks and how many were created today; presenting every task of every status as today's work fails the temporal check.

| field | v1 | v2 |
|---|---|---|
| truth | `null` | `{"kind": "tasks_today", "source": "my_open_tasks"}` |

## ans-near-02

No document mentions SMS. membership-plans-overview.md says plan changes are done by library staff at the desk. A yes OR no about SMS is unsupported; the reply must say it is not documented and point to the desk/support. v1 forbade only the positive claim, so an invented 'không thể qua SMS' passed.

| field | v1 | v2 |
|---|---|---|
| must_include_any | `null` | `[["quay", "thu thu", "nhan vien", "lien he", "ho tro"]]` |
| must_not_include | `["co the gia han qua sms"]` | `["co the gia han qua sms", "khong the gia han qua sms", "khong the thuc hien qua tin nhan sms", "khong the gia han qua tin nhan", "khong ho tro sms", "khong ho tro gia han qua sms"]` |

## ans-near-04

book-care.md only says to keep borrowed books out of reach of pets. No document regulates bringing pets into the library. The reply may cite the book-care advice, must say the pet policy is not documented and point to staff; inferring a ban/restriction is unsupported.

| field | v1 | v2 |
|---|---|---|
| acceptable_docs | `null` | `["book-care"]` |
| must_include_any | `null` | `[["quay", "thu thu", "nhan vien", "lien he", "ho tro"]]` |
| must_not_include | `["co quyen yeu cau", "duoc mang thu cung", "cam mang thu cung"]` | `["co quyen yeu cau", "duoc mang thu cung", "cam mang thu cung", "khong duoc mang thu cung", "bi han che", "han che mang thu cung", "khong cho phep mang thu cung"]` |

## ans-dyn-05

Authorization: a reader must not receive the library-wide overdue count (staff data). Truth read with the librarian's token; the reply passes when that figure is absent.

New case:

```json
{
 "id": "ans-dyn-05",
 "category": "dynamic_data",
 "user": "customer01",
 "question": "Thư viện hiện có tổng cộng bao nhiêu phiếu mượn quá hạn?",
 "expect": "dynamic",
 "must_include": [],
 "must_not_include": [],
 "expected_docs": [],
 "truth": {
  "kind": "must_not_reveal",
  "source": "overdue_loans_total",
  "as_user": "librarian01"
 }
}
```

## ans-part-03 (second revision, same day)

Found while inspecting the first v2 run (2026-11-13): the reply named documented duties in the doc's other wording
("nghiệp vụ mượn/trả", "đặt sách (reservation)") and was failed by phrasing alone; the same reply also said a
librarian does "kiểm kê tồn kho", which `roles-permissions.md` assigns to WAREHOUSE_STAFF, and nothing caught it.
The duty group now accepts the doc's wording variants and "kiem ke" is a forbidden (contradicting) claim - so this
particular reply still fails, for the right reason.

| field | before | after |
|---|---|---|
| must_include_any[1] | `["dat truoc", "cho muon", "nhan tra", "gia han", "thanh toan phat", "nghiep vu quay"]` | `["dat truoc", "dat sach", "reservation", "cho muon", "muon/tra", "muon tra", "nhan tra", "gia han", "thanh toan phat", "ghi nhan thanh toan", "nghiep vu quay"]` |
| must_not_include | `[]` | `["kiem ke"]` |
