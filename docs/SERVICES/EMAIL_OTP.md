# Xác thực bằng mã OTP qua email

Tài liệu kỹ thuật cho tính năng mã xác thực 6 chữ số gửi qua email của SmartBook:

- **Giai đoạn 1 — bắt buộc khi đăng ký bạn đọc:** tài khoản mới ở trạng thái `PENDING_VERIFICATION`, không nhận được JWT/refresh token cho tới khi nhập đúng mã.
- **Giai đoạn 2 — xác thực hai lớp (2FA) cho nhân viên:** tuỳ chọn, bật theo từng tài khoản hoặc toàn bộ nhân viên qua feature flag. Mặc định **tắt**.

Không thêm dịch vụ hay nhà cung cấp định danh mới: tất cả nằm trong `auth-service` (Express + Prisma + Redis + Nodemailer sẵn có), đi qua API Gateway như mọi route `/auth/*`.

## 1. Tham khảo trước khi làm

| Dự án | Học được | Áp dụng / không áp dụng |
|---|---|---|
| [better-auth/better-auth — plugin `email-otp`](https://github.com/better-auth/better-auth/tree/main/packages/better-auth/src/plugins/email-otp) (MIT, đang phát triển tích cực) | Mã 6 số, hết hạn 300 s, số lần thử lưu cùng bản ghi, rate limit riêng cho từng endpoint OTP | Giữ 6 số / 5 phút / đếm lần thử. **Không** theo mặc định `storeOTP: "plain"` (lưu mã thô). |
| [supabase/auth — `internal/api/verify.go`](https://github.com/supabase/auth/blob/master/internal/api/verify.go) (MIT) | Hash mã gắn với email, kiểm tra hết hạn theo thời điểm gửi, mã dùng một lần, giới hạn tần suất gửi | Gắn hash với mục đích + challenge; dùng HMAC có khoá thay vì SHA-256 trần (mã 6 số băm SHA-256 có thể dò ngược offline trong vài giây). |

Đã loại: dùng LLM/OpenRouter sinh mã (không phải nguồn ngẫu nhiên an toàn), lưu challenge trong JWT (không thu hồi/đếm lần thử được), thư viện 2FA bên ngoài (không cần cho email OTP).

## 2. Chính sách mã

| Quy tắc | Giá trị | Nơi thực thi |
|---|---|---|
| Độ dài | 6 chữ số, `crypto.randomInt` | `lib/email-otp.js` |
| Hiệu lực | 5 phút kể từ lần gửi gần nhất | cột `expires_at` |
| Số lần nhập sai | 5 / challenge (lần thứ 5 sai → khoá challenge) | `UPDATE … SET attempts = attempts + 1 WHERE attempts < 5` |
| Gửi lại | sau 60 s; tối đa 5 lần / challenge; challenge sống tối đa 30 phút | `resend()` |
| Theo tài khoản | tối đa 10 mã / giờ (cộng mọi challenge) | `countRecentSends()` |
| Theo IP | verify 30 / 15 phút, resend 10 / 15 phút (cấu hình được) | `routes/auth.routes.js` |
| Mã mới | resend thay mã trên cùng challenge (mã cũ hết hiệu lực ngay); challenge mới vô hiệu các challenge cũ cùng mục đích | `replaceCode()`, `createChallenge()` |
| Dùng một lần | `UPDATE … SET consumed_at WHERE consumed_at IS NULL AND code_hash = $hash` trong cùng transaction với tác động (kích hoạt tài khoản) | `consume()` |

Nhiều request đúng chạy song song: chỉ một request thắng (đã kiểm tra cả bằng unit test lẫn với Postgres thật — `scripts/email-otp-integration.mjs`).

## 3. Quyết định bảo mật

- **Chỉ lưu verifier:** `code_hash = HMAC-SHA256(OTP_HMAC_SECRET, "smartbook-otp:v1|<purpose>|<challenge id>|<code>")`. Hash của mục đích này không dùng được cho mục đích hay challenge khác. So sánh bằng `crypto.timingSafeEqual`.
- **Khoá riêng:** `OTP_HMAC_SECRET` (≥ 32 ký tự) bắt buộc ở production — thiếu thì auth-service không khởi động, `compose.prod.yml` cũng từ chối render. Ngoài production, nếu thiếu thì dẫn xuất bằng HKDF từ `JWT_SECRET` với nhãn riêng.
- **Challenge id không phải credential:** UUID ngẫu nhiên, chỉ dùng để chỉ ra challenge nào; không có mã đúng thì vô dụng; không đổi được thành refresh token (đã có test).
- **Không có token trước OTP:** `/auth/login` trả `202` không kèm `token`/`refresh_token` khi cần mã; tài khoản `PENDING_VERIFICATION` không bao giờ được cấp JWT. Mobile chỉ nhận refresh token ở `/auth/login/verify-otp`.
- **Không lách qua refresh:** refresh-token family ghi `mfa: true` khi bắt đầu bằng OTP. Nếu tài khoản cần 2FA (bật sau, hoặc nâng `STAFF_EMAIL_OTP_MODE`) mà family không có `mfa` → `/auth/refresh` thu hồi family và trả `401`.
- **Phiên cũ khi bật 2FA:** admin bật 2FA cho một tài khoản → ghi mốc thu hồi (`user:tokens-valid-after`) như khi khoá/đổi vai trò, mọi JWT cũ hết hiệu lực.
- **Khoá / đổi mật khẩu giữa hai bước:** bước 2 đọc lại user (phải `ACTIVE`) và mốc thu hồi; đổi mật khẩu/khoá sau bước 1 thì challenge bị từ chối.
- **Lỗi email → đóng an toàn:** SMTP từ chối thì trả `503 EMAIL_DELIVERY_UNAVAILABLE`, không bao giờ cấp phiên thay thế. `deliverEmail()` ném lỗi thay vì trả `false` âm thầm; danh sách `rejected` của SMTP cũng tính là lỗi.
- **Chống dò tài khoản:** sai mật khẩu luôn là `401 Invalid credentials` như cũ; chỉ khi đúng mật khẩu mới thấy “cần xác thực”. Email luôn được che (`n********a@gmail.com`); response không chứa user id. *Giới hạn còn lại:* `/auth/register` vẫn trả `409` khi username/email đã tồn tại (hành vi cũ, xem §9).
- **Không ghi log mã, mật khẩu SMTP hay secret.** Log email chỉ ghi tên miền người nhận (`***@gmail.com`). Có test kiểm tra mã không xuất hiện trong response/log.
- **Đổi email:** địa chỉ mới bắt đầu ở trạng thái chưa xác thực (`email_verified_at = NULL`, cả `PATCH /auth/me` lẫn `PATCH /iam/users/:id`). Mã gửi tới địa chỉ cũ không xác thực được địa chỉ mới. Tài khoản đang dùng 2FA không tự đổi email được (`403 EMAIL_CHANGE_REQUIRES_ADMIN`) — tránh việc phiên bị đánh cắp chuyển mã sang hộp thư kẻ gian.
- **Trang `/register` cũ của nhân viên** chỉ gọi đúng endpoint đăng ký bạn đọc (luôn gán `CUSTOMER`). Đã bỏ trang này, `/register` chuyển sang `/customer/register`; tài khoản nhân viên chỉ do admin tạo qua IAM.

## 4. Dữ liệu và chính sách chuyển đổi

Migration `services/auth-service/prisma/migrations/20261029090000_add_email_otp` **chỉ thêm**:

- bảng `email_otp_challenges` (id, user_id, purpose, email, code_hash, attempts, send_count, expires_at, last_sent_at, consumed_at, invalidated_at, created_at);
- cột `users.email_otp_2fa_enabled BOOLEAN NOT NULL DEFAULT false`.

Không cập nhật dòng nào có sẵn. Chính sách:

| Nhóm tài khoản | Trạng thái sau triển khai |
|---|---|
| Tài khoản đã có (kể cả demo) | Giữ nguyên `status` và `email_verified_at` (đa số `NULL`). **Không** tự đánh dấu đã xác thực. Vẫn đăng nhập bình thường; có thể tự xác thực ở trang Tài khoản (`/auth/resend-verification` → mã). |
| Bạn đọc đăng ký sau triển khai | `PENDING_VERIFICATION` → `ACTIVE` khi nhập đúng mã. |
| Nhân viên | Không đổi gì khi `STAFF_EMAIL_OTP_MODE=off` (mặc định). |

Bảng `email_verification_tokens` (xác thực bằng link cũ) giữ lại để migration không phá huỷ; không còn được ghi. Endpoint `POST /auth/verify-email` (link) đã bỏ — frontend chưa từng có trang `/verify-email`, nên link trong email cũ vốn đã không dùng được.

Tài khoản `PENDING_VERIFICATION` không bao giờ xác thực sẽ nằm lại (kèm hồ sơ bạn đọc ở Borrow Service). Người dùng quay lại chỉ cần đăng nhập bằng mật khẩu để nhận mã mới. Admin có thể kích hoạt thủ công (đặt `ACTIVE`) trong trang Người dùng.

## 5. API

Mọi route đi qua gateway `https://api.smartbook.io.vn` (dev: `http://localhost:3000`). Lỗi luôn có dạng `{ "message": "...", "code": "..." , ...chi tiết }`.

Đối tượng `challenge` dùng chung:

```json
{
  "id": "6f1d2c1e-8b0a-4c55-9a0b-1f6e2a7d9c11",
  "purpose": "EMAIL_VERIFICATION",
  "masked_email": "n********a@gmail.com",
  "code_length": 6,
  "expires_at": "2026-10-29T08:05:00.000Z",
  "resend_available_at": "2026-10-29T08:01:00.000Z",
  "attempts_remaining": 5
}
```

### `POST /auth/register`

```json
{ "username": "nguyenvana", "email": "nguyenvana@gmail.com", "password": "******", "full_name": "Nguyễn Văn A" }
```

| HTTP | Body |
|---|---|
| 201 | `{ "status": "VERIFICATION_REQUIRED", "email_delivery": "SENT", "challenge": {…} }` |
| 201 | `{ "status": "VERIFICATION_REQUIRED", "email_delivery": "FAILED", "challenge": {…} }` — tài khoản đã tạo, gửi lại được ngay |
| 201 | `{ "status": "REGISTERED" }` — chỉ khi `REGISTRATION_EMAIL_VERIFICATION=off` |
| 400 / 409 | thiếu trường / username hoặc email đã tồn tại (như cũ) |
| 503 | `EMAIL_DELIVERY_UNAVAILABLE` — chưa cấu hình SMTP, **không** tạo tài khoản |

Response không còn trường `user` (không cần và không nên trả id).

### `POST /auth/login`

Body như cũ (`identifier`/`username`/`email`, `password`, `client: "mobile"` để xin refresh token).

| HTTP | Body |
|---|---|
| 200 | Như cũ: `{ "status": "AUTHENTICATED", "token", "refresh_token"?, "user" }` (thêm `status`, không bỏ trường nào) |
| 202 | `{ "status": "EMAIL_VERIFICATION_REQUIRED", "challenge": {…} }` — đúng mật khẩu, email chưa xác thực |
| 202 | `{ "status": "OTP_REQUIRED", "challenge": {…} }` — tài khoản cần mã đăng nhập |
| 401 / 403 | như cũ (sai thông tin / bị khoá) |
| 429 | `OTP_SEND_LIMIT` (10 mã/giờ) hoặc `RATE_LIMITED` |
| 503 | `EMAIL_DELIVERY_UNAVAILABLE` — không cấp phiên |

Bấm đăng nhập lại trong vòng 60 s trả về đúng challenge đang chạy, không gửi thêm email.

### `POST /auth/email-otp/verify`

```json
{ "challenge_id": "6f1d…", "code": "482913" }
```

`200 { "status": "VERIFIED" }` — không cấp phiên; client đăng nhập lại (web/mobile tự làm việc này bằng mật khẩu còn trong bộ nhớ).

### `POST /auth/login/verify-otp`

```json
{ "challenge_id": "6f1d…", "code": "482913", "client": "mobile" }
```

`200` = đúng response đăng nhập thành công (`token`, `refresh_token` nếu mobile, `user` với roles/permissions do server quyết định).

### `POST /auth/email-otp/resend`

```json
{ "challenge_id": "6f1d…", "purpose": "EMAIL_VERIFICATION" }
```

`200 { "status": "OTP_SENT", "challenge": {…} }` (cùng id, mã mới, 5 lần thử mới).

### `POST /auth/resend-verification` (cần đăng nhập)

Cho tài khoản đã hoạt động nhưng chưa xác thực email (tài khoản cũ, hoặc vừa đổi email): `200 { "status": "OTP_SENT", "challenge" }` hoặc `{ "status": "ALREADY_VERIFIED" }`. Mã nhập qua `/auth/email-otp/verify`.

### Mã lỗi OTP

| HTTP | `code` | Ý nghĩa | Trường thêm |
|---|---|---|---|
| 400 | `OTP_FORMAT` | không phải 6 chữ số (không tính lần thử) | |
| 400 | `OTP_INVALID` | sai mã | `attempts_remaining`, `challenge` |
| 410 | `OTP_EXPIRED` | hết 5 phút | `challenge` |
| 410 | `OTP_CHALLENGE_INVALID` | không tồn tại / đã dùng / bị thay / quá 30 phút / sai mục đích — cùng một câu trả lời | |
| 429 | `OTP_TOO_MANY_ATTEMPTS` | đã sai 5 lần | `challenge` |
| 429 | `OTP_RESEND_COOLDOWN` | chưa đủ 60 s | `retry_after_seconds`, header `Retry-After` |
| 429 | `OTP_SEND_LIMIT` | quá 10 mã/giờ cho tài khoản | `retry_after_seconds` |
| 429 | `RATE_LIMITED` | giới hạn theo IP | |
| 403 | — | tài khoản bị khoá giữa hai bước | |
| 503 | `EMAIL_DELIVERY_UNAVAILABLE` | SMTP lỗi | `challenge` (nếu có) |
| 503 | `AUTH_STATE_UNAVAILABLE` | Redis không trả lời được mốc thu hồi ở bước 2 | |

### IAM

`PATCH /iam/users/:id` nhận thêm `email_otp_2fa_enabled: boolean` (quyền `auth.users.write`). Chỉ bật được khi email đã xác thực (`400 EMAIL_NOT_VERIFIED`). Bật lên sẽ thu hồi phiên hiện có. Danh sách user trả thêm `email_verified_at`, `email_otp_2fa_enabled`. Trạng thái mới `PENDING_VERIFICATION` lọc/sửa được như các trạng thái khác.

## 6. Feature flag

| Biến | Giá trị | Mặc định |
|---|---|---|
| `REGISTRATION_EMAIL_VERIFICATION` | `required` \| `off` (khẩn cấp: tài khoản mới hoạt động ngay) | `required` |
| `STAFF_EMAIL_OTP_MODE` | `off` \| `optional` (tài khoản có cờ) \| `required` (mọi tài khoản nội bộ: có vai trò khác `CUSTOMER`/`SUPPLIER`, hoặc superuser) | `off` |
| `OTP_HMAC_SECRET` | ≥ 32 ký tự ngẫu nhiên | bắt buộc ở production |
| `AUTH_OTP_VERIFY_RATE_LIMIT_MAX`, `AUTH_OTP_RESEND_RATE_LIMIT_MAX` | số request / IP / 15 phút | 30, 10 |

Lộ trình 2FA nhân viên: `off` → kiểm tra gửi mail + quy trình khôi phục (admin tắt cờ cho người mất hộp thư) → `optional` cho vài tài khoản quản trị → `required`. Khi chuyển sang `required`, access token cũ còn sống tối đa `JWT_EXPIRES_IN` (2 giờ); refresh token cũ của mobile bị từ chối ngay.

## 7. Email

- Template `EMAIL_OTP` (`services/auth-service/src/lib/email-sender.js`): tiêu đề `[SmartBook] Mã xác thực của bạn`, có phần text thuần, layout bảng + inline CSS (Gmail/Outlook/mobile), lời chào, mã cỡ lớn, mục đích (đăng ký / đăng nhập), hạn 5 phút, cảnh báo nếu không phải bạn yêu cầu. Mọi giá trị chèn vào đều được escape (đã escape thêm cho template đặt lại mật khẩu).
- Dev: `docker compose` có **Mailpit** (`http://localhost:8025`); auth-service gửi tới đó trừ khi `.env` đặt `SMTP_HOST` + `SMTP_PORT`. Test e2e/integration đọc mã qua API của Mailpit, không bao giờ qua log.
- Production: `SMTP_*` trong `/opt/smartbook/.env`, `SMTP_FROM=SmartBook <noreply@smartbook.io.vn>` (dùng địa chỉ thuộc domain mà nhà cung cấp SMTP được phép gửi thay).

### SPF / DKIM / DMARC cho `smartbook.io.vn`

Tuỳ nhà cung cấp (Amazon SES, Brevo, Mailgun, Postmark, Google Workspace…), nhưng luôn gồm:

1. **SPF** — một bản ghi TXT duy nhất ở `smartbook.io.vn`, ví dụ `v=spf1 include:<miền SPF của nhà cung cấp> ~all` (gộp vào bản ghi có sẵn nếu đã có, không tạo bản ghi SPF thứ hai).
2. **DKIM** — thêm CNAME/TXT `…._domainkey.smartbook.io.vn` do nhà cung cấp cấp, rồi bấm xác minh trong trang quản trị của họ.
3. **DMARC** — TXT ở `_dmarc.smartbook.io.vn`, bắt đầu ở chế độ theo dõi: `v=DMARC1; p=none; rua=mailto:dmarc@smartbook.io.vn; adkim=s; aspf=s`. Sau 1–2 tuần báo cáo sạch thì nâng `p=quarantine`, rồi `p=reject`.
4. Gửi thử tới Gmail/Outlook, mở “Show original”: `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.

## 8. Client

- **Web** (`apps/web`): `components/auth/otp-verification.tsx` — một `<input>` thật (`inputMode="numeric"`, `autocomplete="one-time-code"`) phủ lên 6 ô hiển thị: dán cả mã (kể cả “123 456”), tự gửi khi đủ 6 số, đếm ngược hạn mã và nút gửi lại, thông báo lỗi `aria-live`, focus vào ô mã khi mở và trở lại ô mật khẩu khi quay lại, dark mode, 375 px không cuộn ngang. Dùng ở `/customer/register`, `/customer/login`, `/login`, hộp thoại xác thực email ở trang Tài khoản. Challenge chỉ ở state React (không localStorage/sessionStorage); `returnUrl` giữ trên URL suốt quá trình. Diễn giải mã lỗi ở `src/lib/otp.ts`.
- **Mobile** (`apps/mobile`): `login()` trả `{ kind: 'challenge' }` thay vì lưu token; `OtpCodeForm` (bàn phím số, `textContentType="oneTimeCode"` / `autoComplete="one-time-code"` → `sms-otp` trên Android); token và refresh token chỉ lưu vào SecureStore sau `/auth/login/verify-otp`. Đếm ngược theo mốc thời gian của server nên đúng lại ngay khi app quay về foreground. Điều hướng theo vai trò giữ nguyên (root layout).
- Quy tắc OTP chỉ nằm ở server; hai client chỉ diễn giải mã lỗi (`apps/web/src/lib/otp.ts`, `apps/mobile/src/lib/otp.ts` — cùng câu chữ). Web và mobile không dùng chung package nên phần diễn giải nhỏ này được lặp lại có chủ đích.
- **App mobile phiên bản cũ** coi `202` là thành công nhưng không có token → lưu token thất bại, người dùng thấy lỗi đăng nhập (không có phiên — đóng an toàn). Chỉ bật 2FA cho nhân viên dùng mobile sau khi bản app mới đã phát hành.

## 9. Kiểm thử

| Lệnh | Phạm vi |
|---|---|
| `pnpm --filter auth-service test` | `test/email-otp.test.js` (20: sinh mã, HMAC, hết hạn, dùng lại, bị thay, song song, cooldown, 5 lần sai, SMTP lỗi, giới hạn gửi, secret) và `test/email-otp-auth-flow.test.js` (23: đăng ký, đăng nhập khi chờ xác thực, tài khoản cũ, 2FA nhân viên, không JWT trước OTP, refresh token mobile, khoá tài khoản, mốc thu hồi, phân tách vai trò khách/nhân viên, đổi email, không lộ mã trong log) |
| `node scripts/email-otp-integration.mjs [--staff]` | Gateway + Postgres + Mailpit thật; `--staff` cần `STAFF_EMAIL_OTP_MODE=optional` |
| `pnpm --filter web test:unit` | `tests/otp.test.mjs` |
| `pnpm --filter @smartbook/mobile test` | `src/lib/otp.test.ts` |
| `pnpm --filter web test:e2e` | `e2e/email-otp.spec.ts` (test 2FA nhân viên chạy khi `E2E_STAFF_OTP=1`) |

## 10. Triển khai production

Không thao tác gì trên VPS/DB production nếu chưa được duyệt. Thứ tự đề xuất:

1. **Chuẩn bị email:** tạo tài khoản SMTP, cấu hình SPF/DKIM/DMARC (§7), gửi thử.
2. **Thêm biến vào `/opt/smartbook/.env`** (không in ra màn hình):
   ```bash
   printf 'OTP_HMAC_SECRET=%s\n' "$(openssl rand -hex 32)" >> /opt/smartbook/.env
   ```
   rồi sửa `SMTP_HOST/PORT/USER/PASS/FROM`, `REGISTRATION_EMAIL_VERIFICATION=required`, `STAFF_EMAIL_OTP_MODE=off`. Thiếu `OTP_HMAC_SECRET` thì `deploy.sh` dừng ngay ở bước render compose — trước backup và migration.
3. **Deploy như thường lệ** (workflow “Deploy production” → `deploy.sh <sha>`): script tự backup DB (`backup.sh --label predeploy-… --db-only`), auth-service chạy `prisma migrate deploy` (migration chỉ thêm), healthcheck `/health`, smoke `https://api.smartbook.io.vn/ready`, tự rollback image nếu không khoẻ.
4. **Kiểm tra sau deploy:**
   - đăng ký một tài khoản thử bằng hộp thư thật → nhận email “[SmartBook] Mã xác thực của bạn”, header `SPF/DKIM/DMARC: PASS`;
   - đăng nhập tài khoản đó trước khi nhập mã → màn hình nhập mã, không có phiên;
   - nhập mã → vào cổng bạn đọc; đăng nhập tài khoản demo cũ vẫn bình thường;
   - `deploy/scripts/dc logs auth-service | grep EMAIL` chỉ thấy `***@domain`, không có mã.
5. **2FA nhân viên (sau):** đặt `STAFF_EMAIL_OTP_MODE=optional`, `deploy/scripts/dc up -d auth-service`, bật cờ cho 1–2 tài khoản admin trong trang Người dùng, thử cả web và app mobile mới.

### Rollback

| Tình huống | Cách xử lý |
|---|---|
| Email gặp sự cố, cần mở đăng ký ngay | `REGISTRATION_EMAIL_VERIFICATION=off` → `deploy/scripts/dc up -d auth-service` (tài khoản đang chờ vẫn cần mã, hoặc admin kích hoạt thủ công) |
| 2FA khoá nhầm nhân viên | `STAFF_EMAIL_OTP_MODE=off` hoặc admin tắt cờ của tài khoản đó |
| Lỗi code | `deploy/scripts/rollback.sh` về image trước. Migration chỉ thêm bảng/cột nên code cũ chạy được trên schema mới; **không** cần và **không nên** xoá bảng. Lưu ý: code cũ coi `PENDING_VERIFICATION` là “User is not active” — kích hoạt các tài khoản đó bằng `UPDATE users SET status='ACTIVE' WHERE status='PENDING_VERIFICATION'` chỉ khi chấp nhận bỏ xác thực email cho chúng. |
| Khôi phục dữ liệu | `deploy/scripts/restore.sh` với bản backup `predeploy-<sha>` (chỉ khi thật cần, vì mất dữ liệu sau thời điểm backup) |

## 11. Giới hạn đã biết

- `/auth/register` vẫn cho biết username/email đã tồn tại (`409`) — hành vi sẵn có; đổi sang phản hồi chung cần thiết kế lại UX đăng ký.
- Rate limit theo IP nằm trong bộ nhớ từng tiến trình (như rate limit đăng nhập hiện có); giới hạn theo tài khoản và theo challenge nằm trong Postgres nên không mất khi restart.
- Đổi email chưa có bước “xác nhận địa chỉ mới trước khi đổi” và chưa gửi thông báo tới địa chỉ cũ; địa chỉ mới chỉ được đánh dấu chưa xác thực.
- Tài khoản chờ xác thực không được dọn tự động.
- Mốc thu hồi token có độ phân giải 1 giây (thiết kế sẵn có).
- Đặt lại mật khẩu vẫn dùng link (giữ nguyên theo yêu cầu); OTP cho đặt lại mật khẩu là việc sau.
