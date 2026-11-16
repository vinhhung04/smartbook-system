# RAG retrieval eval — 20261114_232421 (abstention=on, split=all, label=p0-supplement-baseline)

- Catalog: 136 sach; embedding: qwen/qwen3-embedding-8b@768; BOOK_CONF tau=0.66/0.25, DOC_CONF tau=0.66/0.4
- Query embedding cache: {'hits': 0, 'misses': 39, 'retries': 0, 'failures': 0}; case khong co tin hieu semantic (provider loi -> keyword-only, KHONG so sanh duoc): 0 []
- Tong: 39 case
- Recall@1 0.6325 / Recall@3 0.7692 / Recall@5 0.7692
- MRR 0.7692
- Answerable Recall@1/3/5: 0.7475 / 0.9091 / 0.9091 (33 case co dap an)
- Selective Accuracy@1 (chi tinh tren case he thong CHON tra loi): 0.6667

## Abstention
- **Overall** — No-answer Accuracy: 0.1667 (6 case) | FPR: 0.8333 | FNR: 0.0303 (33 case answerable)
  Coverage: 0.9487 | Abstention P/R/F1: 0.5 / 0.1667 / 0.25
- **BOOK_METADATA** — No-answer Accuracy: 0.1667 (6 case) | FPR: 0.8333 | FNR: 0.0303 (33 case answerable)
  Coverage: 0.9487 | Abstention P/R/F1: 0.5 / 0.1667 / 0.25
- **INTERNAL_DOC** — No-answer Accuracy: None (0 case) | FPR: None | FNR: None (0 case answerable)
  Coverage: None | Abstention P/R/F1: None / None / None

## Theo corpus (Recall/MRR)
- **BOOK_METADATA** (39): R@1 0.6325, R@3 0.7692, R@5 0.7692, MRR 0.7692
- **INTERNAL_DOC** (0): R@1 0.0, R@3 0.0, R@5 0.0, MRR 0.0

## Phase E — theo loai truy van (Recall/Precision/MRR/abstention)

UNREACHABLE = case co dap an nhung expected id KHONG co trong catalog/corpus dang danh gia (drift du lieu/ground truth, khong phai loi xep hang). Cot `reachable` chi tinh case con tim duoc.

| loai | case | co dap an | unreachable | R@1 (all) | R@5 (all) | MRR (all) | R@5 (reachable) | MRR (reachable) | P@5 | no-answer acc | FPR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| author | 9 | 9 | 0 | 0.5185 | 1.0 | 1.0 | 1.0 | 1.0 | 0.4333 | - | - |
| author_near_miss | 2 | 0 | 0 | - | - | - | - | - | - | 0.5 | 0.5 |
| category | 2 | 2 | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | - | - |
| category_semantic | 1 | 1 | 0 | 0.5 | 1.0 | 1.0 | 1.0 | 1.0 | 0.4 | - | - |
| description | 5 | 5 | 0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 | - | - |
| isbn_exact | 5 | 5 | 0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 | - | - |
| isbn_near_miss | 1 | 0 | 0 | - | - | - | - | - | - | 0.0 | 1.0 |
| title | 10 | 10 | 0 | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 | 0.18 | - | - |
| title_multi_edition | 1 | 1 | 0 | 0.5 | 1.0 | 1.0 | 1.0 | 1.0 | 0.4 | - | - |
| title_near_miss | 3 | 0 | 0 | - | - | - | - | - | - | 0.0 | 1.0 |

Case BOOK_METADATA unreachable: 0 — 

## Phase 0 — integrity va tap trusted (rag_integrity.py)

Trusted = case con tim duoc (REACHABLE, hoac PARTIALLY_REACHABLE cham tren id con trong catalog) hoac NO_ANSWER, khong co co nao (rag_dataset_review.json + kiem tra tu dong). Nhan KHONG bi sua.

| corpus | tap | case | answerable | Ans R@1 | Ans R@3 | Ans R@5 | Ans MRR | no-answer | no-answer acc | FPR | FNR | coverage | abst F1 | selective acc@1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOOK_METADATA | all | 39 | 33 | 0.7475 | 0.9091 | 0.9091 | 0.9091 | 6 | 0.1667 | 0.8333 | 0.0303 | 0.9487 | 0.25 | 0.6667 |
| BOOK_METADATA | trusted | 30 | 27 | 0.7099 | 0.8889 | 0.8889 | 0.8889 | 3 | 0.3333 | 0.6667 | 0.037 | 0.9333 | 0.4 | 0.6845 |
| INTERNAL_DOC | all | 0 | 0 | 0.0 | 0.0 | 0.0 | 0.0 | - | - | - | - | - | - | None |
| INTERNAL_DOC | trusted | 0 | 0 | 0.0 | 0.0 | 0.0 | 0.0 | - | - | - | - | - | - | None |

BOOK_METADATA trusted theo loai truy van:

| loai | case | co dap an | R@1 | R@5 | MRR | P@5 | no-answer acc | FPR |
|---|---|---|---|---|---|---|---|---|
| author | 9 | 9 | 0.5185 | 1.0 | 1.0 | 0.4333 | - | - |
| author_near_miss | 2 | 0 | - | - | - | - | 0.5 | 0.5 |
| category | 2 | 2 | 0.0 | 0.0 | 0.0 | 0.0 | - | - |
| isbn_exact | 5 | 5 | 1.0 | 1.0 | 1.0 | 0.2 | - | - |
| isbn_near_miss | 1 | 0 | - | - | - | - | 0.0 | 1.0 |
| title | 10 | 10 | 0.9 | 0.9 | 0.9 | 0.18 | - | - |
| title_multi_edition | 1 | 1 | 0.5 | 1.0 | 1.0 | 0.4 | - | - |

Case ngoai tap trusted: 9 — `sp-018` (NO_ANSWER, UNVERIFIED_LABEL), `sp-019` (NO_ANSWER, UNVERIFIED_LABEL), `sp-020` (NO_ANSWER, UNVERIFIED_LABEL), `sp-034` (REACHABLE, UNVERIFIED_LABEL), `sp-035` (REACHABLE, UNVERIFIED_LABEL), `sp-036` (REACHABLE, UNVERIFIED_LABEL), `sp-037` (REACHABLE, UNVERIFIED_LABEL), `sp-038` (REACHABLE, UNVERIFIED_LABEL), `sp-039` (REACHABLE, UNVERIFIED_LABEL)

## Case truot (khong co expected nao trong top-5)

- `sp-008` tim sach mat biec — mong ['cb780777-916e-4d15-a3d7-a321436d9ea9'], nhan ['062c9e98-b9a9-5716-ade0-3c320415442a', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d', '790d978e-fb9d-42a4-b7e3-d021c941062b', 'fa3ab34a-41b8-59e8-9694-1181247f35d6', 'a7407d48-1e4f-45d8-ac77-bb53fce549f6'] (decision=UNCERTAIN)
- `sp-032` Có sách lịch sử chính trị nào không? — mong ['052f4e10-c2c4-5003-af54-058821070b61', '07585d3e-6990-5570-b371-8e26cd159405'], nhan [] (decision=NO_EVIDENCE)
- `sp-033` Có sách thiếu nhi nào không? — mong ['de549bfe-8ce9-53b5-93e1-04ac9c8c798d', 'ea72ef14-a4bf-5b88-9ea7-a717757f6595'], nhan ['77f6e125-fa10-4993-ba7e-666a48d21de7', 'af330707-b3db-4b09-b47b-a02686f7ee4f', '47b3acaa-496a-4a80-a426-f0ffa9d3b337', '701ef460-8590-4fc8-a73c-16eaa661a5d9', 'fe14f5f0-e17f-4466-a38a-236343fa559f'] (decision=UNCERTAIN)

## Case khong dap an nhung he thong van tra ket qua (false positive)

- `sp-006` Tìm sách ISBN 9780735211293 — tra ['3e341be8-df3f-5190-98a9-6b0d9b9c7d21', 'fa33ebc6-f95b-5f56-9c8a-5ec43860b0d4', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d', '062c9e98-b9a9-5716-ade0-3c320415442a', '56d3541c-b609-5d62-80de-91acaaff0606', '2782b784-e025-5946-b8ac-435e8c11246e', 'fa3ab34a-41b8-59e8-9694-1181247f35d6', 'dd94f886-e05c-5b06-8e8b-db203317072c'] (decision=UNCERTAIN, confidence=0.393)
- `sp-018` Có cuốn Harry Potter và Phòng Chứa Bí Mật không? — tra ['3d1c247f-1103-520d-91ee-f748f6cfeaa4', '14f4f082-74d9-4b4e-8067-97c0b6745719', '790d978e-fb9d-42a4-b7e3-d021c941062b', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d', '93f99f2a-c970-569e-9382-4d595be5ec5a', '9c7dce89-5f60-43ae-a0dc-e7e12aef6d6f', '5b1493c9-fc87-4fb9-b29d-e71242f0243e', 'ca3d510f-69b9-4477-a51d-a0b775536230'] (decision=UNCERTAIN, confidence=0.306)
- `sp-019` Có sách Children of Dune không? — tra ['8702650d-2a96-42fc-8e5c-9872ad55400e', '2f7a6bba-a705-41af-bc76-3297f8f3551a', 'af330707-b3db-4b09-b47b-a02686f7ee4f', '701ef460-8590-4fc8-a73c-16eaa661a5d9', 'd86ce9b1-48c8-4c19-8c87-ea7431bacc7b', '26b85215-358d-4302-8eeb-574553866b22', 'de549bfe-8ce9-53b5-93e1-04ac9c8c798d', '534d52b3-cb9a-5859-95de-6e988cbee729'] (decision=UNCERTAIN, confidence=0.4)
- `sp-020` Có Tuổi Thơ Dữ Dội tập 2 không? — tra ['534d52b3-cb9a-5859-95de-6e988cbee729', '871990a8-98e6-4325-8d56-690bb6f73ed7', '47b3acaa-496a-4a80-a426-f0ffa9d3b337', 'afa04903-053e-4248-af61-da2e37a848b5'] (decision=UNCERTAIN, confidence=0.313)
- `sp-031` Sách nào của nhà văn Nguyễn Huy Thiệp? — tra ['8702650d-2a96-42fc-8e5c-9872ad55400e', '419bd1ca-ad0d-4334-958b-c3eda948c11a', '47b3acaa-496a-4a80-a426-f0ffa9d3b337', '14a22cde-bee6-4590-a0b8-df26877d45d6', '7bb64de7-087e-4d58-af51-236e1c2d1fa8', 'ccfeb71b-dae8-4bd0-93fa-591ace5f682d', 'afa04903-053e-4248-af61-da2e37a848b5', '0820b86b-9deb-4713-bed9-d8f1a8bfc6f4'] (decision=UNCERTAIN, confidence=0.252)
