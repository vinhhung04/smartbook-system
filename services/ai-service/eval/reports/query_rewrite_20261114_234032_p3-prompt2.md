# Query rewrite eval — 20261114_234032 (p3-prompt2)

- Cases: 18 (control_complete 4, follow_up 11, no_answer_follow_up 3)
- Rewrite status: {'invalid': 1, 'not_eligible': 4, 'rewritten': 13}; eligible 14; failure rate (failed+invalid / eligible): 0.0714
- Controls left as typed: 4/4
- Rewrite latency ms (eligible): p50 728.5, max 1083

| variant | Ans R@1 | Ans R@3 | Ans R@5 | Ans MRR | no-answer acc | FPR | FNR |
|---|---|---|---|---|---|---|---|
| original | 0.6 | 0.6667 | 0.6667 | 0.6222 | 1.0 | 0.0 | 0.2 |
| rewritten | 1.0 | 1.0 | 1.0 | 1.0 | 0.3333 | 0.6667 | 0.0 |
| standalone | 1.0 | 1.0 | 1.0 | 1.0 | 0.3333 | 0.6667 | 0.0 |

| case | kind | status | typed | rewrite | expected | original top | rewritten top |
|---|---|---|---|---|---|---|---|
| cv-001 | follow_up | rewritten | Còn hạng Bạc Sĩ thì sao? | Mỗi hạng thành viên Bạc Sĩ được mượn tối đa bao nhiêu quyển sách? | ['membership-loan-limit'] | ['borrowing-process'] | ['membership-loan-limit'] |
| cv-002 | follow_up | rewritten | Còn hạng Bạc Sĩ thì sao? | Phí phạt trả sách trễ hạn của hạng Bạc Sĩ được tính như thế nào? | ['fine-calculation'] | ['borrowing-process'] | ['fine-calculation'] |
| cv-003 | follow_up | rewritten | Còn hạng Thẻ Đọc thì sao? | Hạng Thẻ Đọc làm mất sách đang mượn thì phải đền bao nhiêu? | ['lost-item-fee'] | ['borrowing-process'] | ['lost-item-fee'] |
| cv-004 | follow_up | rewritten | Còn hạng nào giữ lâu nhất? | Hạng thành viên nào được giữ chỗ sách đặt trước lâu nhất? | ['reservation-hold'] | NO_EVIDENCE | ['reservation-hold'] |
| cv-005 | follow_up | rewritten | Còn mỗi lần thêm bao lâu? | Mỗi lần gia hạn sách đã mượn thêm bao lâu? | ['renewal-count'] | ['renewal-count'] | ['renewal-count'] |
| cv-006 | follow_up | invalid | Cái đó có cần đăng nhập không? | Cái đó có cần đăng nhập không? | ['supplier-portal'] | ['supplier-portal'] | ['supplier-portal'] |
| cv-007 | follow_up | rewritten | Còn quên mật khẩu thì sao? | Quên mật khẩu thì sao? | ['account-security'] | ['account-security'] | ['account-security'] |
| cv-008 | follow_up | rewritten | Còn qua VNPay mà chưa cập nhật thì sao? | Qua VNPay mà chưa cập nhật thì sao? | ['fines-payment'] | ['fines-payment'] | ['fines-payment'] |
| cv-009 | follow_up | rewritten | Chủ nhật thì sao? | Giờ mở cửa của thư viện vào chủ nhật là mấy giờ? | ['branches-opening-hours'] | NO_EVIDENCE | ['branches-opening-hours'] |
| cv-010 | follow_up | rewritten | Còn Cần Thơ thì sao? | Chi nhánh SmartBook ở Cần Thơ nằm ở địa chỉ nào? | ['branches-opening-hours'] | NO_EVIDENCE | ['branches-opening-hours'] |
| cv-011 | follow_up | rewritten | Còn nhân viên kho thì sao? | Nhân viên kho có những quyền gì trong hệ thống? | ['roles-permissions'] | ['roles-permissions'] | ['roles-permissions'] |
| cv-012 | no_answer_follow_up | rewritten | Còn cho thuê máy tính xách tay thì sao? | Cho thuê máy tính xách tay thì sao? | - | NO_EVIDENCE | NO_EVIDENCE |
| cv-013 | no_answer_follow_up | rewritten | Còn ngày lễ thì sao? | Giờ mở cửa của thư viện vào ngày lễ là mấy giờ? | - | NO_EVIDENCE | ['branches-opening-hours'] |
| cv-014 | no_answer_follow_up | rewritten | Còn mang thú cưng vào thì sao? | Mang thú cưng vào thư viện thì sao? | - | NO_EVIDENCE | ['book-care'] |
| cv-015 | control_complete | not_eligible | Phí phạt trả sách trễ hạn được tính như thế nào? | Phí phạt trả sách trễ hạn được tính như thế nào? | ['fine-calculation'] | ['fine-calculation'] | ['fine-calculation'] |
| cv-016 | control_complete | not_eligible | Tôi quên mật khẩu đăng nhập thì phải làm gì? | Tôi quên mật khẩu đăng nhập thì phải làm gì? | ['account-security'] | ['account-security'] | ['account-security'] |
| cv-017 | control_complete | not_eligible | Còn nợ tiền phạt thì có mượn thêm sách được không? | Còn nợ tiền phạt thì có mượn thêm sách được không? | ['fines-payment'] | ['fines-payment'] | ['fines-payment'] |
| cv-018 | control_complete | not_eligible | Mã ISBN 13 số gồm những phần nào? | Mã ISBN 13 số gồm những phần nào? | ['isbn-classification'] | ['isbn-classification'] | ['isbn-classification'] |
