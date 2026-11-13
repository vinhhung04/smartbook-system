# SmartBook – Báo cáo dọn thay đổi nghiên cứu (Chude1_NCKH, Chude5_NCKH)

Ngày thực hiện: 2026-11-12 · Nhánh: `khoa` · Không commit, không push lên `khoa`.

## Kết luận nhanh

- Cả hai nghiên cứu được làm ngày 2026-11-12 và **chưa từng được commit**. Mọi thay đổi nghiên cứu đều nằm trong working tree: 8 file tracked bị sửa và 423 file untracked. Lịch sử commit của `khoa` không có commit nào của Chude1 hay Chude5, nên không phải revert commit nào.
- VNPay đã nằm trọn trong commit `5688de6 cập nhật VNpay` (người dùng tự commit), cộng với 3 thay đổi chưa commit chỉ thuộc VNPay. Toàn bộ phần VNPay được giữ nguyên, không sửa dòng nào.
- Cách xử lý:
  - Chủ đề 1: đưa 8 file tracked về đúng bản ở HEAD, theo lựa chọn "Hoàn tác toàn bộ".
  - Thư mục và sơ đồ nghiên cứu: chuyển nguyên vẹn (không xóa) ra `C:\Users\vongd\Khoa\Doc\NCKH\smartbook-research-archive\`, theo lựa chọn "Chuyển ra ngoài repo".
- Trước khi làm, đã tạo nhánh backup cục bộ `backup/khoa-before-research-cleanup` (commit `2b9fb6e`). Nhánh này chứa nguyên trạng thái ban đầu, kể cả file chưa commit.

## 1. Git audit

| Mục | Giá trị |
|---|---|
| Repository | `https://github.com/vinhhung04/smartbook-system` (remote `origin`) |
| Nhánh ban đầu / cuối | `khoa` / `khoa` |
| HEAD ban đầu | `5688de6cb123c2edc73ebb3dda0fc4219d3f5422` ("cập nhật VNpay") |
| HEAD cuối | `5688de6` (không đổi, không có commit mới trên `khoa`) |
| Staged ban đầu | không có |
| Unstaged ban đầu | 10 file (8 Chủ đề 1, 2 VNPay) |
| Untracked ban đầu | 424 file (423 nghiên cứu, 1 VNPay: `apps/web/e2e/vnpay-sandbox.spec.ts`) |
| Stash | `stash@{0}: backup/pre-typecheck-docker-2026-08-13` (có từ trước, không động tới) |
| Nhánh backup | `backup/khoa-before-research-cleanup` → `2b9fb6e`, cha là `5688de6`. Chưa push. |
| Commit Chude1 | không có (toàn bộ chưa commit) |
| Commit Chude5 | không có (toàn bộ chưa commit) |
| Commit VNPay | `5688de6` (66 file: VNPay, tiền cọc, sửa ô nhập số, công cụ vẽ sơ đồ) |

**Cách xác định nguồn gốc** (không chỉ dựa vào ngày tháng):
- `git log` của `khoa`: commit gần nhất là `5688de6`. Tìm theo từ khóa nckh/research/risk/logistic/abstention/ground truth/synthetic/rag/simulation chỉ ra các commit cũ của khóa luận (mô hình rủi ro `049d09d`, RAG abstention `509ee7a`, simulation `eb8e360`…). Đây là chức năng đã có và đang dùng trong UI, nên không thuộc phạm vi dọn.
- Nội dung diff từng file: 8 file tracked của Chủ đề 1 không chứa chữ nào liên quan VNPay, ví, cọc hay nạp tiền (`grep -ciE 'vnpay|wallet|deposit|topup'` = 0).
- Tiêu đề từng sơ đồ `.mmd` mới (đều là "khung nghiên cứu", "thực nghiệm", "dự báo…" dùng cho bài báo).
- Ghi chú dự án của hai nghiên cứu: cả hai làm ngày 2026-11-12, chưa commit.
- Không file tracked nào tham chiếu tới `research/`, `research-inputs/`, `docs/research/` hay `eval/rag_abstention` (`git grep` rỗng).

**Bản backup đã được kiểm chứng:**
- 10 file đang sửa giống hệt bản trong backup (diff 0 dòng).
- Số file trong backup khớp số file trên đĩa: `research` 107, `research-inputs` 66, `docs/research` 37, `eval/rag_abstention` 171.
- `.env` không nằm trong backup (bị gitignore).
- File `.cache/embeddings.jsonl` (117 MB) đã bị gitignore sẵn nên không vào backup; file này chỉ còn trong thư mục lưu trữ.

## 2. Bảng phân loại và danh sách file đã xử lý

| ID | File/module | Thay đổi ban đầu | Nguồn gốc | Loại | Hành động |
|---|---|---|---|---|---|
| 1 | `services/analytics-service/src/utils/risk-model.js` | Chia 60/20/20, ngưỡng chọn trên validation, `purge`, `chronologicalSplit`, `purgeUnresolved` | Chưa commit | RESEARCH_ONLY (Chude1) | Về bản HEAD |
| 2 | `services/analytics-service/src/utils/classification-metrics.js` | `topKMetrics`, `averagePrecision`, `thresholdMetrics`, `pr_auc`, `recall_at_k`, ngưỡng cố định | Chưa commit | RESEARCH_ONLY (Chude1) | Về bản HEAD |
| 3 | `services/analytics-service/src/utils/risk-features.js` | `outcomeAt`; no-show tính từ `pickup_code_issued_at`; nhãn `null` cho đơn đang chờ | Chưa commit | RESEARCH_ONLY (Chude1) | Về bản HEAD |
| 4 | `services/analytics-service/src/controllers/analytics.controller.js` | SQL gia hạn trước ngày mượn; SQL no-show theo thời điểm cấp mã; lọc nhãn null | Chưa commit | RESEARCH_ONLY (Chude1) | Về bản HEAD |
| 5 | `services/analytics-service/test/{classification-metrics,risk-features,risk-model}.test.js` | Test cho các thay đổi 1–4 | Chưa commit | RESEARCH_ONLY (Chude1) | Về bản HEAD |
| 6 | `services/borrow-service/prisma/simulation/evaluation.js` | Đối chiếu point-in-time cho thực nghiệm | Chưa commit | RESEARCH_ONLY (Chude1) | Về bản HEAD |
| 7 | `research/risk-prediction/` (107 file) | Pipeline, kết quả, bài báo Chủ đề 1 | Untracked | RESEARCH_ONLY (Chude1) | Chuyển vào thư mục lưu trữ |
| 8 | `services/ai-service/eval/rag_abstention/` (171 file + `.cache`) | Pipeline thực nghiệm RAG có tự từ chối | Untracked | RESEARCH_ONLY (Chude5) | Chuyển vào thư mục lưu trữ |
| 9 | `research-inputs/rag-abstention-dataset/` (66 file) | Dữ liệu, Ground Truth, snapshot corpus | Untracked | RESEARCH_ONLY (Chude5) | Chuyển vào thư mục lưu trữ |
| 10 | `docs/research/rag-abstention/` (37 file, có `ChuDe5_NCKH.docx`) | Báo cáo, bài báo Chủ đề 5 | Untracked | RESEARCH_ONLY (Chude5), tài liệu khoa học | Chuyển nguyên vẹn, không sửa nội dung |
| 11 | `docs/diagrams/{source,exports}/…` (42 file: 14 `.mmd` + 14 `.svg` + 14 `.png`) | Sơ đồ cho hai bài báo | Untracked | RESEARCH_ONLY (Chude1: 5 sơ đồ; Chude5: 9 sơ đồ) | Chuyển vào thư mục lưu trữ |
| 12 | `apps/web/e2e/vnpay-sandbox.spec.ts` | E2E VNPay sandbox thật | Untracked | VNPAY | Giữ |
| 13 | `apps/web/e2e/README.md` | Mô tả `vnpay-sandbox.spec.ts` | Chưa commit | VNPAY | Giữ |
| 14 | `docs/SERVICES/BORROW_SERVICE.md` | Link đăng ký merchant sandbox, trang thẻ test | Chưa commit | VNPAY | Giữ |
| 15 | Toàn bộ 66 file trong `5688de6` | VNPay, tiền cọc, ô nhập số, công cụ sơ đồ | Commit `5688de6` | VNPAY / UNRELATED_CHANGE | Giữ, không sửa |
| 16 | Mô hình rủi ro, RAG abstention, simulation đã commit trước đó | Chức năng khóa luận đang dùng | Commit cũ | EXISTING_FEATURE | Giữ |

Không có mục SHARED_DEPENDENCY: VNPay không import gì từ analytics-service hay các thư mục nghiên cứu.

Sơ đồ đã chuyển:
- Chủ đề 1: `du-bao-tra-sach-tre`, `du-bao-khong-den-nhan-sach`, `khung-nghien-cuu-du-bao-rui-ro-luu-thong`, `khung-nghien-cuu-du-bao-rui-ro-luu-thong-v2`, `quy-trinh-xu-ly-du-lieu-rui-ro`.
- Chủ đề 5: `khung-nghien-cuu-rag-revision2`, `khung-thuc-nghiem-rag-abstention`, `kien-truc-c-v2-revision2`, `kien-truc-tro-ly-ai-hien-tai`, `kien-truc-tro-ly-ai-hien-tai-v2`, `pham-vi-thuc-nghiem-rag-revision3`, `quy-trinh-rag-abstention-de-xuat`, `quy-trinh-rag-abstention-de-xuat-v2`, `quy-trinh-xay-dung-dataset-rag`.

## 3. Các thay đổi đã loại bỏ

**Chude1_NCKH (dự báo rủi ro trả trễ và không đến nhận sách):**
- Phương pháp đánh giá: chia train/validation/test 60/20/20 thay cho 75/25; ngưỡng HIGH chọn trên validation; tùy chọn `purge`; các chỉ số PR-AUC, recall@k, top-k xử lý điểm bằng nhau; khối `validation` trong kết quả huấn luyện.
- Sửa đặc trưng và SQL:
  - `prior_renewal_count` chỉ tính các lần gia hạn trước ngày mượn;
  - no-show tính tại thời điểm cấp mã nhận sách;
  - đơn READY_FOR_PICKUP đang chờ được chấm điểm;
  - lọc nhãn null khi huấn luyện.
- Đối chiếu tương ứng trong `prisma/simulation/evaluation.js`, cùng toàn bộ pipeline `research/risk-prediction/` và 5 sơ đồ.
- Hệ quả (người dùng đã chọn hoàn tác toàn bộ): analytics-service quay về đúng hành vi đã commit. Lỗi cũ "đơn READY_FOR_PICKUP đang chờ không được chấm điểm no-show" vẫn còn. Bản sửa lỗi này nằm trong nhánh backup nếu sau này muốn đưa vào như một thay đổi nghiệp vụ riêng.

**Chude5_NCKH (RAG có tự từ chối khi thiếu bằng chứng):**
- Pipeline offline `services/ai-service/eval/rag_abstention/`, bộ dữ liệu và Ground Truth `research-inputs/`, báo cáo và bài báo `docs/research/rag-abstention/`, 9 sơ đồ.
- Chủ đề 5 không sửa file nào của ai-service. Trợ lý AI, chatbot, RAG và cơ chế abstention có sẵn (`faq_retrieval.py`, `eval/eval_rag.py`…) vẫn nguyên vẹn.

## 4. Các thay đổi đã giữ lại

**VNPay, toàn bộ, không sửa dòng nào** (ngoài 3 file chưa commit ở mục 2, tất cả nằm trong `5688de6`):

- Backend `services/borrow-service`:
  - Tạo link và ký HMAC-SHA512: `src/services/vnpay-payment.service.js` (trả phạt) và `src/services/wallet-topup.service.js` (nạp ví, `finalizeVnpayTopup`, khóa idempotency `vnpay-topup:<txn_ref>`).
  - Tạo giao dịch nạp ví và xem trạng thái: `src/controllers/wallet-topup.controller.js`. Chỉ nhận 5 mức tiền, sai mức trả `INVALID_TOPUP_AMOUNT`.
  - Return URL và IPN: `src/controllers/vnpay-webhook.controller.js`. Có kiểm chữ ký, claim PENDING→PROCESSING chống callback trùng, trang kết quả có CSP nonce.
  - Khóa dòng phạt `FOR UPDATE`: `src/controllers/fine.controller.js`.
  - Sổ cái và ví: `src/services/account.service.js`. Gồm `WALLET_TOPUP_AMOUNTS_VND`, `ON CONFLICT`, đối soát.
  - Routes: `my.routes.js`, `customer.routes.js`.
- Database:
  - migration `20261111090000_add_loan_item_deposits` (có `vnp_response_code` VARCHAR(20));
  - migration `20261112090000_add_wallet_topup_intents`;
  - `prisma/schema.prisma`.
- Frontend web:
  - `customer/fines.tsx`: chọn mức nạp, nút "Nạp qua VNPay", "Thanh toán online qua VNPay".
  - `lib/wallet-topup.ts`, `services/customer-borrow.ts`, `services/borrow.ts`, `lib/status-registry.ts`.
  - `borrow-customers.tsx`: nạp tại quầy.
- Kiểm thử:
  - `apps/web/e2e/vnpay-payment.spec.ts`, `vnpay-sandbox.spec.ts`;
  - `test/vnpay-payment.service.test.js`, `vnpay-topup.db.test.js`, `wallet-topup-amounts.test.js`, `deposit.db.test.js`.
- Công cụ và tài liệu: `scripts/vnpay-simulator.mjs`, script `pnpm vnpay:simulator`, `docs/SERVICES/BORROW_SERVICE.md`, `docs/SERVICES/BOOK_DEPOSIT.md`.
- Cấu hình: các biến `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_PAYMENT_URL`, `VNPAY_RETURN_URL` trong `.env`. File này không đụng tới và được gitignore; không có secret nào xuất hiện trong báo cáo hay trong nhánh backup.

**Khác:** toàn bộ chức năng đã có (auth, kho, mượn/trả, đặt chỗ, ví/cọc, trợ lý AI, AI Import/OCR, analytics/dashboard, mobile), commit `5688de6` và các commit trước đó. Ngoài 8 file ở mục 2, không file tracked nào bị sửa.

## 5. Kiểm thử

Toàn bộ chạy trên working tree **sau khi dọn**. `pnpm verify` được chạy từng bước, riêng bước Python chạy trong Docker vì máy không có Python.

| Test | Kết quả | Ghi chú |
|---|---|---|
| Lint (`pnpm lint:ci`) | PASS | 0 cảnh báo |
| Typecheck (`pnpm typecheck`, web + mobile) | PASS | |
| Build (`pnpm build`) | PASS | web build 40,7 s |
| Unit tests Node (`pnpm test:node`) | PASS | shared 30, api-gateway 13, auth 86, inventory 206, borrow 156, analytics 137 (134 đạt, 3 bỏ qua có chủ đích) |
| Unit tests web (`pnpm test:web`) | PASS | 46/46 |
| Mobile (`pnpm test:mobile`, `check:mobile-config`) | PASS | 216/216, 33 suite |
| Workspace config (`pnpm test:workspace-config`) | PASS | 74/74 |
| ai-service (`pytest services/ai-service`, chạy trong image `smartbook-system-ai-service`) | PASS | 1210 đạt, 8 bỏ qua |
| Integration DB VNPay + cọc (`deposit.db.test.js`, `vnpay-topup.db.test.js`) | PASS | 31/31, trên Postgres 15 tạm (container `--rm`, đã dừng) sau `prisma migrate deploy` toàn bộ migration |
| Migration borrow-service | PASS | Toàn bộ migration áp dụng thành công trên DB trống; không migration nào bị thêm, sửa hay xóa |
| VNPay sandbox thật (`vnpay-sandbox.spec.ts`, `VNPAY_SANDBOX=1`) | PASS | 3/3: thẻ NCB thành công cộng ví đúng một lần, return URL phát lại không cộng thêm, thẻ thiếu số dư và hủy thanh toán không cộng |
| VNPay API trên stack đang chạy | PASS | Tạo link nạp 10.000đ: host `sandbox.vnpayment.vn`, `vnp_Amount=1000000`, chữ ký 128 ký tự hex. Mức 15.000đ → 400 `INVALID_TOPUP_AMOUNT`. `txnRef` không tồn tại → 404. Return URL giả chữ ký → 400. IPN giả chữ ký → `RspCode 97 Invalid signature` |
| VNPay: sai số tiền, callback lặp, return + IPN đồng thời, giao dịch không tồn tại, trạng thái nhất quán | PASS | Có test riêng trong `vnpay-topup.db.test.js` và `vnpay-payment.service.test.js` |
| Regression | PASS | Container analytics-service và borrow-service đang chạy có code runtime trùng hash với HEAD, nên code nghiên cứu chưa từng chạy ở runtime. Không có tham chiếu treo tới code đã gỡ (`git grep` các hàm `topKMetrics`, `chronologicalSplit`, `purgeUnresolved`, `pr_auc`…, chỉ còn tên biến `outcomeAt` có sẵn từ trước trong simulation) |

**So với trước khi dọn:**
- analytics-service giảm từ 156 xuống 137 test. 19 test bị gỡ là test của chính các thay đổi Chủ đề 1.
- Không có test nào trước đây đạt mà nay thất bại.

## 6. Những vấn đề còn tồn tại

1. **Lỗi cũ còn lại theo lựa chọn hoàn tác toàn bộ:**
   - Đơn READY_FOR_PICKUP đang chờ nhận vẫn không được chấm điểm no-show.
   - Đặc trưng `prior_renewal_count` vẫn đếm cả lần gia hạn xảy ra sau ngày mượn.
   - Bản sửa có trong nhánh backup, các file `risk-features.js` và `analytics.controller.js`.
2. **Image borrow-service đang chạy** (build lúc 2026-11-12 15:48) còn chứa bản nghiên cứu của `prisma/simulation/evaluation.js`.
   - File này không thuộc runtime, chỉ dùng cho script đánh giá simulation, nên VNPay và nghiệp vụ không bị ảnh hưởng.
   - Muốn image khớp hẳn với repo thì chạy `docker compose up -d --build borrow-service`. Chưa làm, để không khởi động lại service VNPay đang chạy.
3. **Docker còn sót từ trước:** các container `smartbook-research-20261108_134702-db/-redis` (đã dừng) và volume `smartbook-research-20261108_134702-data`.
   - Chúng có từ 2026-11-08, trước cả hai nghiên cứu này, nên không được phân loại là Chude1/Chude5.
   - Chưa xóa vì có thể chứa dữ liệu.
4. **Pipeline nghiên cứu trong thư mục lưu trữ** không tự chạy được vì cần analytics-service bản nghiên cứu. Muốn chạy lại thì dùng `git worktree add ../smartbook-research backup/khoa-before-research-cleanup`.
5. **Nhánh backup** chỉ có ở máy này, chưa push. Không được xóa nhánh này.
6. **IPN thật từ VNPay chưa kiểm** vì chưa có URL public: chưa cấu hình tunnel, IPN URL cấu hình bên merchant VNPay.
   - Logic IPN đã được kiểm bằng test DB, bao gồm return URL và IPN đến cùng lúc.
   - Đã kiểm IPN giả chữ ký bị từ chối.
7. **Chưa commit:**
   - Trên `khoa` còn 3 thay đổi VNPay chưa commit (`apps/web/e2e/README.md`, `docs/SERVICES/BORROW_SERVICE.md`, `apps/web/e2e/vnpay-sandbox.spec.ts`) và báo cáo này.
   - Chờ người dùng cho phép mới commit.
8. **Dữ liệu thử:** lần chạy sandbox sau khi dọn đã cộng thêm 50.000đ (tiền thử) vào ví `customer01`.
   - Còn một intent nạp 10.000đ ở trạng thái PENDING, tạo lúc kiểm API. Intent này sẽ tự hết hạn.
