# Tiền cọc theo từng cuốn sách (Book Deposit)

Khi mượn sách, hệ thống giữ một khoản cọc cho **từng cuốn** trong ví của bạn đọc. Khi sách được trả, khoản cọc được quyết toán đúng một lần:
- trước hết dùng để trả các khoản phạt của **chính cuốn đó** (quá hạn, hư hỏng, mất);
- phần còn lại hoàn về số dư khả dụng.

Phần phạt vượt quá tiền cọc trở thành khoản phạt còn mở, thanh toán bằng các kênh đang có (VNPay hoặc tại quầy).

Chức năng này **không** tạo hệ thống ví thứ hai và **không** dùng blockchain. Toàn bộ dữ liệu nằm trong PostgreSQL của borrow-service: `customer_accounts`, `account_ledger`, `fines` và `fine_payments` có sẵn, cộng thêm bảng mới `loan_item_deposits`.

## Chính sách

| Quy tắc | Nguồn |
|---|---|
| Mức cọc mỗi cuốn | `membership_plans.deposit_per_item`, cấu hình trong trang Gói hội viên. Mặc định `0` nghĩa là không cọc, nên mọi gói hiện có giữ nguyên hành vi cũ. |
| Mức phạt hư hỏng / mất / quá hạn | Chính sách sẵn có, không đổi: `DAMAGED_ITEM_FEE`, `LOST_ITEM_BASE_FEE` × `lost_item_fee_multiplier`, `fine_per_day`. |
| Cọc bù những khoản phạt nào | Mọi khoản phạt còn mở của chính cuốn đó, theo thứ tự phát sinh. |
| Công thức | `Hoàn = max(Cọc − Phạt, 0)`; `Còn phải thu = max(Phạt − Cọc, 0)`. |
| Xác nhận | Một bước, do nhân viên có quyền `borrow.write` (LIBRARIAN/ADMIN) thực hiện. Hộp xác nhận hiển thị trước tiền cọc, phạt dự kiến, số khấu trừ, số hoàn và số còn phải thu. Khi sách hư hỏng hoặc mất mà có cọc, bắt buộc nhập lý do. Hệ thống lưu người xác nhận và thời điểm. Khách hàng không tự xác nhận được. |
| Nạp ví | Chỉ 5 mức: 10.000, 20.000, 50.000, 100.000, 200.000 VND (`WALLET_TOPUP_AMOUNTS_VND`, kiểm ở backend cho cả hai kênh). Tại quầy: nhân viên ghi nhận tiền mặt hoặc chuyển khoản (`POST /borrow/customers/:id/account/topups`). Online: bạn đọc nạp qua VNPay ở trang Tiền phạt & ví (`POST /borrow/my/account/topups/vnpay/create`). Ví chỉ được cộng khi callback VNPay có chữ ký xác nhận, ghi bút toán `CREDIT` (`VNPAY_TOPUP`) với khóa `vnpay-topup:<txn_ref>`, nên callback lặp không cộng hai lần. |

Nếu ví không đủ tiền cho phí mượn cộng toàn bộ tiền cọc, phiếu mượn bị từ chối (`409 INSUFFICIENT_DEPOSIT_FUNDS`) **trước** khi giữ hoặc trừ kho.

## Dữ liệu

`loan_item_deposits`: mỗi `loan_item` có tối đa một dòng (`UNIQUE loan_item_id`).

| Cột | Ý nghĩa |
|---|---|
| `customer_id`, `account_id`, `loan_id`, `loan_item_id`, `variant_id`, `inventory_unit_id` | Liên kết với khách, ví, phiếu mượn, cuốn sách |
| `amount` | Tiền cọc |
| `captured_amount` / `refunded_amount` | Phần dùng trả phạt / phần hoàn về ví |
| `status` | `HELD` → `RELEASED` (hoàn hết), `PARTIALLY_REFUNDED` (khấu trừ một phần), `CAPTURED` (khấu trừ hết) |
| `return_condition`, `settlement_reason`, `settled_by_user_id`, `settled_at` | Tình trạng sách khi trả, lý do, người và thời điểm quyết toán |

Ràng buộc trong DB:
- `CHECK` bảo đảm `HELD` thì chưa khấu trừ hay hoàn đồng nào; đã quyết toán thì `captured + refunded = amount`.
- Trigger chặn sửa dòng đã quyết toán và chặn xóa.
- Khóa ngoại dùng `RESTRICT`, nên xóa khách hàng, phiếu mượn hay cuốn sách không thể kéo theo lịch sử cọc.

`account_ledger` có sẵn được ghi thêm ba loại bút toán:

| `entry_type` | Ví thay đổi thế nào |
|---|---|
| `HOLD` | khả dụng −, đang giữ + |
| `RELEASE` | đang giữ −, khả dụng + (hoàn cọc hoặc phần cọc còn lại) |
| `CAPTURE` | đang giữ −, `total_debited` + (cọc dùng trả phạt) |

`balance_before/after` luôn là số dư khả dụng, như với `DEBIT`/`CREDIT`. Số dư đang giữ trước và sau được ghi trong `metadata`.
- Cột mới `entry_seq` (SERIAL) xác định thứ tự ghi tuyệt đối. Cần cột này vì nhiều bút toán trong cùng một transaction có chung `created_at`.
- Trigger biến `account_ledger` thành bảng **chỉ ghi thêm**: không `UPDATE`, không `DELETE`. Sai sót được sửa bằng một bút toán mới.

Khoản cọc dùng trả phạt được ghi vào `fine_payments` với `payment_method = 'DEPOSIT'` và `transaction_reference = <deposit id>`. Nhờ vậy, số còn nợ của khoản phạt luôn tính được bằng cùng một công thức như trước.

## Luồng

### Mượn sách

```mermaid
sequenceDiagram
    autonumber
    actor NV as Nhân viên
    participant B as borrow-service
    participant I as inventory-service
    participant DB as PostgreSQL (borrow)
    NV->>B: POST /borrow/loans/direct (hoặc chuyển từ đặt trước)
    B->>DB: Đọc gói hội viên (deposit_per_item) và số dư ví
    alt Không đủ phí mượn + cọc
        B-->>NV: 409 INSUFFICIENT_DEPOSIT_FUNDS (kho chưa bị đụng tới)
    else Đủ tiền
        B->>I: Giữ và trừ kho
        B->>DB: BEGIN, tạo phiếu mượn và loan_items
        loop Mỗi cuốn
            B->>DB: SELECT customer_accounts FOR UPDATE
            B->>DB: available −= cọc, held += cọc, ghi HOLD, tạo loan_item_deposits (HELD)
        end
        B->>DB: COMMIT
        B-->>NV: 201 (deposit_total)
    end
```

### Trả sách và quyết toán

```mermaid
sequenceDiagram
    autonumber
    actor NV as Nhân viên
    participant B as borrow-service
    participant I as inventory-service
    participant DB as PostgreSQL (borrow)
    NV->>B: GET /borrow/loans/:id/return-preview
    B-->>NV: Cọc, phạt dự kiến, khấu trừ, hoàn, còn phải thu
    NV->>B: POST /borrow/loans/:id/return (+ settlement_reason nếu hư hỏng/mất)
    alt Hư hỏng/mất, có cọc, thiếu lý do
        B-->>NV: 400 SETTLEMENT_REASON_REQUIRED (kho chưa bị đụng tới)
    else Có lý do, hoặc không cần lý do
        B->>I: Trả sách về kho
        B->>DB: BEGIN, cập nhật loan_items, tạo/cập nhật fines theo chính sách
        B->>DB: SELECT loan_item_deposits FOR UPDATE (chỉ xử lý nếu HELD)
        B->>DB: SELECT fines của cuốn đó FOR UPDATE
        B->>DB: fine_payments (DEPOSIT) cho phần khấu trừ
        B->>DB: Ví: CAPTURE phần khấu trừ, RELEASE phần hoàn
        B->>DB: loan_item_deposits → RELEASED / PARTIALLY_REFUNDED / CAPTURED, COMMIT
        B-->>NV: 200 deposit_settlements
    end
```

Phần còn phải thu là phần chưa trả của khoản phạt. Bạn đọc thanh toán qua VNPay (`/borrow/my/fines/payments/vnpay/create`, server xác minh chữ ký và số tiền trong IPN) hoặc tại quầy (`POST /borrow/fines/:id/payments`).

## API mới hoặc mở rộng

| Method | Endpoint | Quyền | Ghi chú |
|---|---|---|---|
| POST | /borrow/loans/direct, /borrow/loans/from-reservation/:id, /borrow/reservations/pickup/convert-to-loan | borrow write | Thêm `deposit_count`, `deposit_total` vào kết quả; 409 `INSUFFICIENT_DEPOSIT_FUNDS` |
| POST | /borrow/loans/:id/return | borrow write | Thêm trường `settlement_reason` (tùy chọn); kết quả thêm `deposit_settlements` |
| GET | /borrow/loans/:id/return-preview | borrow read | `loan_item_id`, `item_condition_on_return`, `mark_lost` |
| GET | /borrow/loans/:id | borrow read | `loan_items[].loan_item_deposits` |
| GET | /borrow/customers/:id/account | borrow read | Số dư, cọc đang giữ, `reconciliation`, ledger |
| POST | /borrow/customers/:id/account/topups | borrow write | `{ amount, method: CASH\|TRANSFER, reference?, note? }`, `Idempotency-Key` bắt buộc |
| GET | /borrow/my/loans/:id | bạn đọc | `loan_items[].deposit`, `loan_items[].outstanding_fine_amount` |
| POST/PATCH | /borrow/membership-plans | borrow write | Trường `deposit_per_item` |

Mọi thay đổi đều là **thêm trường**; không trường hay endpoint cũ nào đổi ý nghĩa.

## Bảo đảm tính nhất quán tài chính

- **Nguyên tử:** số dư ví, bút toán ledger, dòng cọc và thanh toán phạt được ghi trong cùng một transaction với việc tạo phiếu mượn hoặc trả sách.
- **Khóa dòng:** mọi thay đổi số dư (HOLD/RELEASE/CAPTURE, cùng với `DEBIT`/`CREDIT` có sẵn) đều khóa `customer_accounts` bằng `FOR UPDATE` trước khi đọc. Quyết toán khóa dòng cọc, rồi đến các khoản phạt, rồi mới đến ví. Thanh toán phạt bằng VNPay và tại quầy giờ cũng khóa dòng `fines`. Thứ tự khóa luôn là phạt rồi đến ví, nên không thể deadlock và không thể trả vượt một khoản phạt.
- **Idempotency:**
  - Mỗi bút toán có `idempotency_key` duy nhất theo khách (`deposit-hold:<loan_item>`, `deposit-capture:<deposit>`, `deposit-release:<deposit>`, `counter-topup:<header>`).
  - Gọi lại với cùng key trả về bút toán cũ. Cùng key nhưng khác loại hoặc khác số tiền trả về `IDEMPOTENCY_CONFLICT`.
  - Quyết toán chỉ chạy khi cọc còn `HELD`, nên gọi lần hai sẽ không làm gì.
- **Không âm:** HOLD cần đủ số dư khả dụng; RELEASE/CAPTURE cần đủ số dư đang giữ.
- **Không dùng số thực:** tiền được tính bằng `Prisma.Decimal` và cộng trừ trong SQL `numeric`.
- **Đối soát:** `reconcileCustomerAccount` kiểm tra hai điều.
  - `held_balance = Σ HOLD − Σ RELEASE − Σ CAPTURE`.
  - Chuỗi `balance_before/after` theo `entry_seq` liền mạch, và bút toán cuối khớp `available_balance`.
  - Kết quả hiển thị trong ví ở phía nhân viên.

## Migration

`services/borrow-service/prisma/migrations/20261111090000_add_loan_item_deposits` chỉ **thêm**, không viết lại dòng dữ liệu cũ nào:
- cột `membership_plans.deposit_per_item` (mặc định 0);
- cột `account_ledger.entry_seq`;
- bảng `loan_item_deposits`;
- trigger chỉ-ghi-thêm cho `account_ledger` và trigger khóa dòng cọc đã quyết toán;
- nới `fine_payment_intents.vnp_response_code` lên `VARCHAR(20)`. Đây là sửa một lỗi có sẵn: giá trị `'STALE_INTENT'` (12 ký tự) không vừa `VARCHAR(10)`, nên nhánh an toàn "khoản phạt đã trả bằng cách khác" của VNPay bị lỗi thay vì ghi nhận thất bại.

Cách rollback thủ công nằm ở đầu file migration. Chỉ an toàn khi chưa có khoản cọc nào được giữ.

Lưu ý: trigger chỉ-ghi-thêm khiến việc xóa một khách hàng đã có bút toán ví bị từ chối. Đây là chủ ý, để lịch sử tiền không bị xóa theo dây chuyền.

## Kiểm thử

- `services/borrow-service/test/deposit.db.test.js` chạy với PostgreSQL thật, gồm 22 tình huống: mượn, trả, đồng thời, idempotency, trigger, VNPay lặp/thất bại, VNPay chạy song song với quyết toán, đối soát. Bộ test bỏ qua khi không có `DEPOSIT_TEST_DATABASE_URL`. Cách chạy:

  ```bash
  DEPOSIT_TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/borrow_test node --test test/deposit.db.test.js
  ```

  Database phải là DB **dùng một lần**, đã chạy `prisma migrate deploy` và có extension `citext`, `pgcrypto`.
- Công thức hoàn/còn phải thu được test thuần, không cần DB.
