# RAG retrieval eval — 20261113_032136 (abstention=on, split=all, label=phase-e-before-head)

- Catalog: 135 sach; embedding: qwen/qwen3-embedding-8b@768; BOOK_CONF tau=0.66/0.25, DOC_CONF tau=0.66/0.4
- Query embedding cache: {'hits': 184, 'misses': 42, 'retries': 0, 'failures': 0}; case khong co tin hieu semantic (provider loi -> keyword-only, KHONG so sanh duoc): 0 []
- Tong: 226 case
- Recall@1 0.4142 / Recall@3 0.4324 / Recall@5 0.4349
- MRR 0.4327
- Answerable Recall@1/3/5: 0.6986 / 0.7293 / 0.7334 (134 case co dap an)
- Selective Accuracy@1 (chi tinh tren case he thong CHON tra loi): 0.6412

## Abstention
- **Overall** — No-answer Accuracy: 0.7935 (92 case) | FPR: 0.2065 | FNR: 0.0522 (134 case answerable)
  Coverage: 0.646 | Abstention P/R/F1: 0.9125 / 0.7935 / 0.8488
- **BOOK_METADATA** — No-answer Accuracy: 0.8654 (52 case) | FPR: 0.1346 | FNR: 0.1273 (55 case answerable)
  Coverage: 0.514 | Abstention P/R/F1: 0.8654 / 0.8654 / 0.8654
- **INTERNAL_DOC** — No-answer Accuracy: 0.7 (40 case) | FPR: 0.3 | FNR: 0.0 (79 case answerable)
  Coverage: 0.7647 | Abstention P/R/F1: 1.0 / 0.7 / 0.8235

## Theo corpus (Recall/MRR)
- **BOOK_METADATA** (107): R@1 0.1926, R@3 0.203, R@5 0.2082, MRR 0.2177
- **INTERNAL_DOC** (119): R@1 0.6134, R@3 0.6387, R@5 0.6387, MRR 0.6261

## Phase E — theo loai truy van (Recall/Precision/MRR/abstention)

UNREACHABLE = case co dap an nhung expected id KHONG co trong catalog/corpus dang danh gia (drift du lieu/ground truth, khong phai loi xep hang). Cot `reachable` chi tinh case con tim duoc.

| loai | case | co dap an | unreachable | R@1 (all) | R@5 (all) | MRR (all) | R@5 (reachable) | MRR (reachable) | P@5 | no-answer acc | FPR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTHOR | 6 | 6 | 2 | 0.1019 | 0.3796 | 0.5278 | 0.5694 | 0.7917 | 0.48 | - | - |
| CATEGORY | 7 | 5 | 5 | 0.0 | 0.0 | 0.0 | - | - | 0.0 | 1.0 | 0.0 |
| DESCRIPTION | 77 | 28 | 17 | 0.3571 | 0.3571 | 0.3616 | 0.9091 | 0.9205 | 0.0833 | 0.8571 | 0.1429 |
| ISBN | 11 | 11 | 5 | 0.5455 | 0.5455 | 0.5455 | 1.0 | 1.0 | 0.1091 | - | - |
| TITLE | 6 | 5 | 1 | 0.8 | 0.8 | 0.8 | 1.0 | 1.0 | 0.16 | 1.0 | 0.0 |
| INTERNAL_DOC | 119 | 79 | 0 | 0.9241 | 0.962 | 0.943 | 0.962 | 0.943 | 0.4958 | 0.7 | 0.3 |

Case BOOK_METADATA unreachable: 30 — `bm-001`, `bm-002`, `bm-003`, `bm-006`, `bm-007`, `bm-016`, `bm-017`, `bm-018`, `bm-019`, `bm-020`, `bm-021`, `bm-022`, `bm-023`, `bm-024`, `bm-025`, `bm-030`, `bm-031`, `bm-032`, `bm-033`, `bm-036`, `bm-037`, `bm-043`, `bm-044`, `bm-046`, `bm-047`, `bm-048`, `bm-049`, `bm-050`, `bm-053`, `bm-054`

## Case truot (khong co expected nao trong top-5)

- `bm-001` Tìm sách ISBN 9786041234567 — mong ['699f3d1e-7133-4fd2-8ebe-27fc627f6922'], nhan ['b4079b3f-3308-41a1-8ca3-a78e3294c41d', '062c9e98-b9a9-5716-ade0-3c320415442a', 'fa33ebc6-f95b-5f56-9c8a-5ec43860b0d4', '3e341be8-df3f-5190-98a9-6b0d9b9c7d21', 'fa3ab34a-41b8-59e8-9694-1181247f35d6'] (decision=UNCERTAIN)
- `bm-002` Tìm sách ISBN 9786041234570 — mong ['6a7ea5dd-e577-40a4-9463-8187f00ce04d'], nhan ['b4079b3f-3308-41a1-8ca3-a78e3294c41d', '062c9e98-b9a9-5716-ade0-3c320415442a', 'fa33ebc6-f95b-5f56-9c8a-5ec43860b0d4', '3e341be8-df3f-5190-98a9-6b0d9b9c7d21', '3d1c247f-1103-520d-91ee-f748f6cfeaa4'] (decision=UNCERTAIN)
- `bm-003` Tìm sách ISBN 9786041234572 — mong ['12976f9f-fd46-47ed-8ea1-4a93579311c7'], nhan ['b4079b3f-3308-41a1-8ca3-a78e3294c41d', '062c9e98-b9a9-5716-ade0-3c320415442a', '3e341be8-df3f-5190-98a9-6b0d9b9c7d21', 'fa33ebc6-f95b-5f56-9c8a-5ec43860b0d4', 'fe14f5f0-e17f-4466-a38a-236343fa559f'] (decision=UNCERTAIN)
- `bm-006` Tìm sách ISBN 9786041234574 — mong ['f1931d86-1aa7-41f6-99f7-8ad1695605e7'], nhan ['062c9e98-b9a9-5716-ade0-3c320415442a', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d', 'fa33ebc6-f95b-5f56-9c8a-5ec43860b0d4', '3e341be8-df3f-5190-98a9-6b0d9b9c7d21', 'fe14f5f0-e17f-4466-a38a-236343fa559f'] (decision=UNCERTAIN)
- `bm-007` Tìm sách ISBN 9786042389001 — mong ['1b12d33e-9e08-4a2d-84d5-47e54cd40a2d'], nhan ['b4079b3f-3308-41a1-8ca3-a78e3294c41d', '062c9e98-b9a9-5716-ade0-3c320415442a', '3e341be8-df3f-5190-98a9-6b0d9b9c7d21', '2782b784-e025-5946-b8ac-435e8c11246e', '56d3541c-b609-5d62-80de-91acaaff0606'] (decision=UNCERTAIN)
- `bm-016` Có sách nào viết về đói nghèo và bất công xã hội thời phong kiến không? — mong ['699f3d1e-7133-4fd2-8ebe-27fc627f6922'], nhan ['ebdc4714-1060-51d7-a3e8-d9dda087aa95', 'bd4f36f9-6298-49b3-b903-12c89835d8c3', '534d52b3-cb9a-5859-95de-6e988cbee729', '205ec491-f420-4209-b811-e78d509ef66b', 'c77943f6-1433-5b95-8b47-3ff41f6bbe5a'] (decision=UNCERTAIN)
- `bm-017` Sách nào kể về một nhân vật nông thôn cố thoát khỏi cuộc sống nghèo khó nhưng cuối cùng thất bại? — mong ['699f3d1e-7133-4fd2-8ebe-27fc627f6922'], nhan ['ebdc4714-1060-51d7-a3e8-d9dda087aa95', 'ea1cd72d-e95a-577b-a888-0b08551bbecc', '831b7fc9-a6bb-4918-8770-b29b77217c9a', 'de549bfe-8ce9-53b5-93e1-04ac9c8c798d', '4f7d054e-d031-5a7c-8b79-57885b32d249'] (decision=UNCERTAIN)
- `bm-018` Sách nào kể một bí mật đau lòng trong một gia đình Việt Nam trước cách mạng? — mong ['8b34c2ea-5a03-4bdc-94e2-5be56fcf9a3d'], nhan ['67f9a4b5-0469-5b61-a071-d28af25508b8', '14f4f082-74d9-4b4e-8067-97c0b6745719', '534d52b3-cb9a-5859-95de-6e988cbee729', '1ece2b63-d5bd-4132-a99e-42926849a019', 'ebdc4714-1060-51d7-a3e8-d9dda087aa95'] (decision=UNCERTAIN)
- `bm-019` Truyện ngắn nào nói về một gia đình phải đối mặt với sự thật đau lòng về chính mình? — mong ['8b34c2ea-5a03-4bdc-94e2-5be56fcf9a3d'], nhan ['701ef460-8590-4fc8-a73c-16eaa661a5d9', '1ece2b63-d5bd-4132-a99e-42926849a019', 'a4468945-8101-44d9-a957-ccc46866f294', '29697aed-d5f7-41cc-a550-5c354c4694e4', 'ea1cd72d-e95a-577b-a888-0b08551bbecc'] (decision=UNCERTAIN)
- `bm-020` Tập thơ nào viết về tình yêu và quê hương đất nước? — mong ['6a7ea5dd-e577-40a4-9463-8187f00ce04d'], nhan [] (decision=NO_EVIDENCE)
- `bm-021` Có tập thơ nào nói về đời sống và con người Việt Nam không? — mong ['6a7ea5dd-e577-40a4-9463-8187f00ce04d'], nhan ['1ece2b63-d5bd-4132-a99e-42926849a019', '534d52b3-cb9a-5859-95de-6e988cbee729', 'ebdc4714-1060-51d7-a3e8-d9dda087aa95', '7bb64de7-087e-4d58-af51-236e1c2d1fa8', '8e51e48a-5837-4fb3-b22e-32380196564d'] (decision=UNCERTAIN)
- `bm-022` Câu chuyện cổ tích Việt Nam nào nói về hóa thân và giấc mơ sau khi chết? — mong ['7b38dc79-fe24-45ed-9014-fbfe570e88e4'], nhan [] (decision=NO_EVIDENCE)
- `bm-023` Sách nào kể sự tích cổ tích với motif tình yêu bị trả thù? — mong ['7b38dc79-fe24-45ed-9014-fbfe570e88e4'], nhan [] (decision=NO_EVIDENCE)
- `bm-024` Cuốn sách nào kể về tuổi thơ nông thôn Việt Nam đầy biến động, gia đình và hy vọng? — mong ['12976f9f-fd46-47ed-8ea1-4a93579311c7'], nhan ['534d52b3-cb9a-5859-95de-6e988cbee729', 'ebdc4714-1060-51d7-a3e8-d9dda087aa95', 'ea1cd72d-e95a-577b-a888-0b08551bbecc', 'de549bfe-8ce9-53b5-93e1-04ac9c8c798d', '67f9a4b5-0469-5b61-a071-d28af25508b8'] (decision=UNCERTAIN)
- `bm-025` Tiểu thuyết nào nói về đời sống nông thôn với nhiều biến động về tình yêu? — mong ['12976f9f-fd46-47ed-8ea1-4a93579311c7'], nhan ['ea1cd72d-e95a-577b-a888-0b08551bbecc', 'ebdc4714-1060-51d7-a3e8-d9dda087aa95', 'de549bfe-8ce9-53b5-93e1-04ac9c8c798d', '1ece2b63-d5bd-4132-a99e-42926849a019', '8f823d9f-b14e-4d79-b78a-7060a76eb55a'] (decision=UNCERTAIN)
- `bm-030` Sách nào viết về tuổi học trò với nhiều sự trớ trêu và hạnh phúc? — mong ['ffb24f62-48e3-4075-8374-df0fd16096d2'], nhan ['534d52b3-cb9a-5859-95de-6e988cbee729', '26b85215-358d-4302-8eeb-574553866b22', '47b3acaa-496a-4a80-a426-f0ffa9d3b337', '1f444016-a3aa-498c-b406-1b2db4aca9cc', 'ea72ef14-a4bf-5b88-9ea7-a717757f6595'] (decision=UNCERTAIN)
- `bm-031` Tiểu thuyết nào kể về thanh niên sống ở đô thị với những kỷ niệm vui buồn? — mong ['ffb24f62-48e3-4075-8374-df0fd16096d2'], nhan ['8635f1e6-de10-431d-ba2d-0ac3028e3977', '534d52b3-cb9a-5859-95de-6e988cbee729', '67f9a4b5-0469-5b61-a071-d28af25508b8', 'eefc9e17-7846-48dc-8f72-ba7de01d5b2a', '14a22cde-bee6-4590-a0b8-df26877d45d6'] (decision=UNCERTAIN)
- `bm-032` Sách nào phân tích tâm lý và tính cách của người Việt trong đời sống hiện đại? — mong ['f1931d86-1aa7-41f6-99f7-8ad1695605e7'], nhan [] (decision=NO_EVIDENCE)
- `bm-033` Có cuốn sách nào nghiên cứu về hành vi và tính cách con người Việt Nam không? — mong ['f1931d86-1aa7-41f6-99f7-8ad1695605e7'], nhan ['7bb64de7-087e-4d58-af51-236e1c2d1fa8', 'e16c5805-e27e-4d8c-bf90-136b1892e474', '0d3fbad3-d2b8-48b5-b58a-c73ad70cbdab', 'ff530ce0-b493-464d-b48e-4fb70c01f1bb', '67f9a4b5-0469-5b61-a071-d28af25508b8'] (decision=UNCERTAIN)
- `bm-036` Sách nào của tác giả Nam Cao? — mong ['699f3d1e-7133-4fd2-8ebe-27fc627f6922', '8b34c2ea-5a03-4bdc-94e2-5be56fcf9a3d', 'f1931d86-1aa7-41f6-99f7-8ad1695605e7', '1b12d33e-9e08-4a2d-84d5-47e54cd40a2d'], nhan ['1b06c832-2f82-53d5-bd3a-e6293baf38a9', '4fb66846-c1a5-5531-8cdf-48aa4c70b243', '7bb64de7-087e-4d58-af51-236e1c2d1fa8', '47b3acaa-496a-4a80-a426-f0ffa9d3b337', '8702650d-2a96-42fc-8e5c-9872ad55400e'] (decision=UNCERTAIN)
- `bm-037` Tác phẩm nào của Xuân Diệu? — mong ['6a7ea5dd-e577-40a4-9463-8187f00ce04d', 'c3b888e3-9a25-408d-91e9-4639c2d82f1c'], nhan [] (decision=NO_EVIDENCE)
- `bm-038` Sách nào của nhà văn Tô Hoài? — mong ['7b38dc79-fe24-45ed-9014-fbfe570e88e4', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d'], nhan ['ea72ef14-a4bf-5b88-9ea7-a717757f6595', '47b3acaa-496a-4a80-a426-f0ffa9d3b337', 'fde4387f-783f-484d-9863-1454ecf2dbc6', '14a22cde-bee6-4590-a0b8-df26877d45d6', '8702650d-2a96-42fc-8e5c-9872ad55400e'] (decision=UNCERTAIN)
- `bm-043` Có tuyển tập thơ nào trong thư viện không? — mong ['6a7ea5dd-e577-40a4-9463-8187f00ce04d'], nhan [] (decision=NO_EVIDENCE)
- `bm-044` Có sách nào là truyện cổ tích dân gian Việt Nam không? — mong ['7b38dc79-fe24-45ed-9014-fbfe570e88e4'], nhan ['7bb64de7-087e-4d58-af51-236e1c2d1fa8', '1ece2b63-d5bd-4132-a99e-42926849a019', '8f823d9f-b14e-4d79-b78a-7060a76eb55a', '47b3acaa-496a-4a80-a426-f0ffa9d3b337', 'afa04903-053e-4248-af61-da2e37a848b5'] (decision=UNCERTAIN)
- `bm-046` sach nao viet ve doi ngheo bat cong thoi phong kien — mong ['699f3d1e-7133-4fd2-8ebe-27fc627f6922'], nhan ['701ef460-8590-4fc8-a73c-16eaa661a5d9', 'fa3ab34a-41b8-59e8-9694-1181247f35d6', '1ece2b63-d5bd-4132-a99e-42926849a019', '790d978e-fb9d-42a4-b7e3-d021c941062b', 'a7407d48-1e4f-45d8-ac77-bb53fce549f6'] (decision=UNCERTAIN)
- `bm-047` tim sach chiec la cuoi cung — mong ['8b34c2ea-5a03-4bdc-94e2-5be56fcf9a3d'], nhan ['062c9e98-b9a9-5716-ade0-3c320415442a', 'fe14f5f0-e17f-4466-a38a-236343fa559f', '790d978e-fb9d-42a4-b7e3-d021c941062b', '701ef460-8590-4fc8-a73c-16eaa661a5d9', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d'] (decision=UNCERTAIN)
- `bm-048` tho xuan dieu noi ve tinh yeu que huong — mong ['6a7ea5dd-e577-40a4-9463-8187f00ce04d'], nhan ['701ef460-8590-4fc8-a73c-16eaa661a5d9', 'fde4387f-783f-484d-9863-1454ecf2dbc6', '062c9e98-b9a9-5716-ade0-3c320415442a', '790d978e-fb9d-42a4-b7e3-d021c941062b', 'a4468945-8101-44d9-a957-ccc46866f294'] (decision=UNCERTAIN)
- `bm-049` chuyen co tich tam cam — mong ['7b38dc79-fe24-45ed-9014-fbfe570e88e4'], nhan ['7bb64de7-087e-4d58-af51-236e1c2d1fa8', 'fde4387f-783f-484d-9863-1454ecf2dbc6', '062c9e98-b9a9-5716-ade0-3c320415442a', '701ef460-8590-4fc8-a73c-16eaa661a5d9', '790d978e-fb9d-42a4-b7e3-d021c941062b'] (decision=UNCERTAIN)
- `bm-050` sach ke chuyen tuoi tho o vung que day hy vong — mong ['12976f9f-fd46-47ed-8ea1-4a93579311c7'], nhan [] (decision=NO_EVIDENCE)
- `bm-052` sach ke gia toc bay doi qua thi tran hu cau macondo — mong ['e1184385-1e57-4e2a-a9f0-919a8d41c9e3'], nhan ['062c9e98-b9a9-5716-ade0-3c320415442a', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d', '44d1360d-1974-4e8e-8ce9-04e35facedec', 'fa3ab34a-41b8-59e8-9694-1181247f35d6', 'a7407d48-1e4f-45d8-ac77-bb53fce549f6'] (decision=UNCERTAIN)
- `bm-053` tieu thuyet nguyen nhat anh ve tuoi hoc tro thanh thi — mong ['ffb24f62-48e3-4075-8374-df0fd16096d2'], nhan ['47b3acaa-496a-4a80-a426-f0ffa9d3b337', '062c9e98-b9a9-5716-ade0-3c320415442a', '56d3541c-b609-5d62-80de-91acaaff0606', 'ccfeb71b-dae8-4bd0-93fa-591ace5f682d', '6dadf91b-a007-4f56-976a-0049a776d3d3'] (decision=UNCERTAIN)
- `bm-054` sach phan tich tam ly tinh cach nguoi viet — mong ['f1931d86-1aa7-41f6-99f7-8ad1695605e7'], nhan ['7bb64de7-087e-4d58-af51-236e1c2d1fa8', 'e16c5805-e27e-4d8c-bf90-136b1892e474', '062c9e98-b9a9-5716-ade0-3c320415442a', '701ef460-8590-4fc8-a73c-16eaa661a5d9', '56d3541c-b609-5d62-80de-91acaaff0606'] (decision=UNCERTAIN)
- `doc-027` Trả sách trễ thì bị sao? — mong ['fine-calculation'], nhan ['fines-payment', 'lost-item-fee'] (decision=UNCERTAIN)
- `doc-032` Khi sách trong kho sắp hết thì quy trình đặt hàng thêm diễn ra ra sao? — mong ['purchase-order-flow'], nhan ['warehouse-operations'] (decision=UNCERTAIN)
- `doc-097` Hạng Vàng Hoàng được giữ chỗ đặt trước bao nhiêu giờ và phạt bao nhiêu mỗi ngày? — mong ['membership-plans-overview'], nhan ['reservation-hold', 'fine-calculation', 'borrowing-process'] (decision=UNCERTAIN)

## Case khong dap an nhung he thong van tra ket qua (false positive)

- `bm-056` Có sách nào dạy lập trình Python cơ bản không? — tra ['3e341be8-df3f-5190-98a9-6b0d9b9c7d21', 'fa33ebc6-f95b-5f56-9c8a-5ec43860b0d4', '646f7364-013d-4848-aa62-b1f2b2099544', '8702650d-2a96-42fc-8e5c-9872ad55400e', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d', '6dadf91b-a007-4f56-976a-0049a776d3d3', 'fa3ab34a-41b8-59e8-9694-1181247f35d6', '3d1c247f-1103-520d-91ee-f748f6cfeaa4'] (decision=UNCERTAIN, confidence=0.305)
- `bm-057` Sách nào hướng dẫn nấu ăn món Việt truyền thống không? — tra ['7bb64de7-087e-4d58-af51-236e1c2d1fa8', '10c718ff-e5d8-4b12-b56a-5f40afe9bb12', '1ece2b63-d5bd-4132-a99e-42926849a019', '47b3acaa-496a-4a80-a426-f0ffa9d3b337', 'ccfeb71b-dae8-4bd0-93fa-591ace5f682d', 'eefc9e17-7846-48dc-8f72-ba7de01d5b2a', '8f823d9f-b14e-4d79-b78a-7060a76eb55a', '4ac8d302-8574-4cb7-bd44-b60b25255bd9'] (decision=UNCERTAIN, confidence=0.273)
- `doc-037` Thư viện có dịch vụ giao sách tận nhà không? — tra ['reader-features', 'branches-opening-hours'] (decision=UNCERTAIN, confidence=0.469)
- `doc-040` Có thể đổi trả sách đã mua tại quầy sách không? — tra ['borrowing-process', 'branches-opening-hours'] (decision=UNCERTAIN, confidence=0.5)
- `bm-061` Sách dạy lập trình Rust cho người mới bắt đầu? — tra ['3e341be8-df3f-5190-98a9-6b0d9b9c7d21', 'fa33ebc6-f95b-5f56-9c8a-5ec43860b0d4', '6dadf91b-a007-4f56-976a-0049a776d3d3', '56e789b9-d356-4c4f-910d-6751d4b98c31', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d', '8702650d-2a96-42fc-8e5c-9872ad55400e', 'd561495e-986e-5f00-b22e-077a87ae7d64', 'ca3d510f-69b9-4477-a51d-a0b775536230'] (decision=UNCERTAIN, confidence=0.34)
- `bm-074` Có sách nào về tâm lý học tội phạm không? — tra ['f3699258-5ed4-409b-8f5b-c7809b77ef00', 'e16c5805-e27e-4d8c-bf90-136b1892e474', '062c9e98-b9a9-5716-ade0-3c320415442a', '56d3541c-b609-5d62-80de-91acaaff0606', '14f4f082-74d9-4b4e-8067-97c0b6745719', '3e341be8-df3f-5190-98a9-6b0d9b9c7d21', '0d3fbad3-d2b8-48b5-b58a-c73ad70cbdab', '6046b4ff-d0fd-591d-a458-c2cebf1a4036'] (decision=UNCERTAIN, confidence=0.326)
- `doc-053` Thư viện đóng cửa vào những ngày lễ nào trong năm? — tra ['branches-opening-hours', 'account-security', 'renewal-count'] (decision=UNCERTAIN, confidence=0.496)
- `bm-093` Có cuốn Harry Potter và Hòn đá Phù thủy không? — tra ['3d1c247f-1103-520d-91ee-f748f6cfeaa4', 'b4079b3f-3308-41a1-8ca3-a78e3294c41d', '93f99f2a-c970-569e-9382-4d595be5ec5a', '5b1493c9-fc87-4fb9-b29d-e71242f0243e', 'f4f0e7d0-ee28-4acd-a70c-4f1707325352', '8702650d-2a96-42fc-8e5c-9872ad55400e', 'afa04903-053e-4248-af61-da2e37a848b5', '790d978e-fb9d-42a4-b7e3-d021c941062b'] (decision=UNCERTAIN, confidence=0.388)
- `bm-094` Thư viện có sách Đắc Nhân Tâm của Dale Carnegie không? — tra ['dd94f886-e05c-5b06-8e8b-db203317072c', 'e16c5805-e27e-4d8c-bf90-136b1892e474', '82902b9d-5f42-4f3b-af11-4afc43a8da20', 'de712574-7a17-401b-9cf6-16aa0e3d4f51', '234068a3-3910-44bd-8574-0c521a440b14', 'a65444e4-b725-411b-9886-b8b6837e53b7', '47b3acaa-496a-4a80-a426-f0ffa9d3b337', '7bb64de7-087e-4d58-af51-236e1c2d1fa8'] (decision=UNCERTAIN, confidence=0.305)
- `bm-096` Có sách Atomic Habits - Thay đổi tí hon hiệu quả bất ngờ không? — tra ['56d3541c-b609-5d62-80de-91acaaff0606', '6a5ab918-e542-4fb5-b355-a219e899f616', '09a20151-b666-42a3-b84d-122edad76333', 'dd94f886-e05c-5b06-8e8b-db203317072c', '3e341be8-df3f-5190-98a9-6b0d9b9c7d21', '6dadf91b-a007-4f56-976a-0049a776d3d3', 'de712574-7a17-401b-9cf6-16aa0e3d4f51', 'a8efb6b2-7751-4dc5-9c3e-54a4b0b00cab'] (decision=UNCERTAIN, confidence=0.5)
- `doc-056` Thư viện có cho thuê máy tính xách tay không? — tra ['branches-opening-hours', 'reader-features', 'borrowing-process'] (decision=UNCERTAIN, confidence=0.403)
- `doc-057` Có được mang thú cưng vào thư viện không? — tra ['membership-plans-overview', 'book-care', 'reader-features'] (decision=UNCERTAIN, confidence=0.45)
- `doc-058` Quy định về trang phục khi đến thư viện là gì? — tra ['library-law-reading-culture', 'book-care', 'membership-plans-overview'] (decision=UNCERTAIN, confidence=0.5)
- `doc-060` Lương nhân viên kho được trả vào ngày nào trong tháng? — tra ['warehouse-operations', 'roles-permissions', 'goods-receipt-process'] (decision=UNCERTAIN, confidence=0.5)
- `doc-061` Thư viện có cho mượn sách nói (audiobook) không? — tra ['reader-features', 'branches-opening-hours', 'membership-plans-overview'] (decision=UNCERTAIN, confidence=0.5)
- `doc-071` Quy trình xử lý khi có hỏa hoạn trong kho là gì? — tra ['warehouse-operations'] (decision=UNCERTAIN, confidence=0.483)
- `doc-072` Thư viện có cho phép mượn sách liên thư viện với nơi khác không? — tra ['branches-opening-hours', 'borrowing-process', 'membership-plans-overview'] (decision=UNCERTAIN, confidence=0.5)
- `doc-073` Có thể gia hạn thẻ hội viên qua tin nhắn SMS không? — tra ['renewal-count', 'membership-plans-overview'] (decision=UNCERTAIN, confidence=0.5)
- `doc-077` Có dịch vụ bọc bìa sách cho bạn đọc không? — tra ['reader-features', 'branches-opening-hours'] (decision=UNCERTAIN, confidence=0.484)
