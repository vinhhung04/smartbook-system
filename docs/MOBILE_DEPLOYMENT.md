# SmartBook Mobile — triển khai Android / iOS

Ứng dụng: `apps/mobile` (Expo SDK 58, React Native 0.88, Expo Router). Dùng chung backend
production `https://api.smartbook.io.vn` với website — không có backend riêng cho mobile.

| Mục | Giá trị |
| --- | --- |
| Tên hiển thị | SmartBook |
| Android application ID | `com.smartbook.picking` (giữ nguyên ID đã dùng từ trước) |
| iOS bundle identifier | `com.smartbook.picking` |
| Deep link scheme | `smartbookpicking://` |
| EAS project | `@hungxh2982004/smartbook` — https://expo.dev/accounts/hungxh2982004/projects/smartbook |
| Version | `version` trong `app.json` (hiện `1.0.0`); build number/versionCode do EAS quản lý (`appVersionSource: remote`) |
| Runtime version (EAS Update) | policy `appVersion` → runtime = `version` |
| Kênh EAS Update | `development`, `preview`, `production` (trùng tên build profile) |

## Trạng thái (2026-10-29)

| Hạng mục | Trạng thái |
| --- | --- |
| APK preview đầu tiên | Đã build trên EAS: https://expo.dev/accounts/hungxh2982004/projects/smartbook/builds/8e5d03b0-83c6-4019-90fb-2e67650688e9 (version 1.0.0, versionCode 1, runtime 1.0.0, kênh `preview`) |
| Kiểm tra tĩnh APK | Đã ký (APK Signature v2/v3), package `com.smartbook.picking`, bundle trỏ `https://api.smartbook.io.vn`, không có IP LAN, không bật cleartext HTTP |
| Cài và chạy trên điện thoại thật | **Chưa kiểm chứng** — cần làm theo checklist cuối tài liệu |
| Bản APK đầu còn quyền thừa | `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE` (mặc định của template Expo, app không xin lúc chạy). Đã chặn trong `app.json` cho các binary sau |
| iOS | Đã cấu hình; **chưa build** (cần Apple Developer Program) |
| Google Play / App Store | Chưa nộp |

## Cấu hình môi trường

| Profile | Bản build | API | Phân phối |
| --- | --- | --- | --- |
| `development` | APK dev client (có `expo-dev-client`) | IP LAN của máy dev (`apps/mobile/.env`) hoặc tự suy ra từ Metro, cổng 3000 | nội bộ |
| `preview` | APK ký bằng keystore trên EAS | `https://api.smartbook.io.vn` | nội bộ (link tải / QR) |
| `production` | AAB (Android), IPA (iOS) | `https://api.smartbook.io.vn` | Google Play / App Store |

- `EXPO_PUBLIC_API_BASE_URL` của preview/production nằm trong **EAS Environment** của project
  (`eas env:list --environment production`), không nằm trong git. Cả `eas build` lẫn
  `eas update --environment ...` đều đọc từ đó.
- `EXPO_PUBLIC_*` được nhúng thẳng vào bundle JS — ai có APK cũng đọc được. **Không bao giờ**
  đặt API key, mật khẩu, token vào biến `EXPO_PUBLIC_*`. App mobile hiện không chứa secret nào:
  mọi khóa AI/thanh toán nằm ở backend.
- `app.config.js` chặn build preview/production nếu URL thiếu, còn là placeholder, dùng `http://`
  hoặc trỏ về localhost. Trên máy, `src/api/config.ts` áp dụng cùng quy tắc: bản release cấu hình
  sai sẽ hiện lỗi cấu hình ở màn hình đăng nhập thay vì âm thầm gọi nhầm server.

## 1. Chạy bằng Expo Go

Expo Go chỉ chạy được khi phiên bản Expo Go trên điện thoại hỗ trợ **SDK 58** (Expo Go chỉ hỗ
trợ SDK mới nhất). Nếu Expo Go báo "incompatible SDK", dùng APK preview/development thay thế.

```bash
pnpm install
```

```bash
cd apps/mobile && npx expo start --go
```

- Dự án đã cài `expo-dev-client`, nên `expo start` mặc định mở chế độ dev build; thêm `--go`
  để QR mở bằng Expo Go.
- Điện thoại và máy tính phải chung Wi-Fi. Gateway local chạy ở cổng 3000 (`docker compose up`).
  Đặt `EXPO_PUBLIC_API_BASE_URL=http://<IP-LAN-máy-tính>:3000` trong `apps/mobile/.env`, hoặc
  để trống: app tự dùng IP của máy chạy Metro.
- Muốn Expo Go gọi thẳng production: `EXPO_PUBLIC_API_BASE_URL=https://api.smartbook.io.vn`
  trong `.env` rồi chạy lại `expo start --go -c`. Lưu ý: dữ liệu là dữ liệu thật trên production.
- iPhone: cài Expo Go từ App Store, quét QR bằng app Camera. Không cần Apple Developer Program.

## 2. Tạo Android APK (preview)

Cần: tài khoản Expo (đã đăng nhập `eas login` với `hungxh2982004`).

```bash
cd apps/mobile && npx eas-cli@latest build -p android --profile preview
```

- Keystore Android được tạo và lưu trên EAS (`eas credentials -p android` để xem/tải bản sao
  lưu). **Không làm mất keystore**: mọi bản cập nhật sau phải ký cùng keystore.
- Kết quả: link `.apk` trên trang build (expo.dev → Builds) kèm QR.
- Hoặc từ GitHub: Actions → **Mobile release** → Run workflow → `build` / `preview` / `android`.

## 3. Cài APK lên điện thoại Android

1. Mở link build trên điện thoại (hoặc quét QR ở trang build) → tải `.apk`.
2. Android hỏi "Cài ứng dụng không rõ nguồn gốc" → cho phép trình duyệt cài.
3. Mở **SmartBook**. Lần đầu dùng camera, app xin quyền Camera.
4. Có thể cài qua USB: `adb install smartbook.apk`.

Bản preview cài song song được với bản production sau này? **Không** — cùng application ID
`com.smartbook.picking`, nên bản mới ghi đè bản cũ (dữ liệu đăng nhập được giữ nếu cùng chữ ký).

## 4. Tạo Android AAB (Google Play)

```bash
cd apps/mobile && npx eas-cli@latest build -p android --profile production
```

- `autoIncrement` tăng `versionCode` trên EAS mỗi lần build production.
- Nộp lên Play (chỉ khi đã duyệt phát hành): `npx eas-cli@latest submit -p android --latest`.
  Cấu hình mặc định nộp vào track `internal` ở trạng thái `draft`; cần tạo app trên Play Console
  và upload Google Service Account key vào EAS (`eas credentials -p android`) trước.
- Lần đầu Google Play bắt buộc upload AAB thủ công một lần qua Play Console.
- Trước khi tạo app trên Play: kiểm tra `com.smartbook.picking` chưa bị ai đăng ký. Một khi
  đã phát hành trên Play, application ID **không đổi được nữa**.

## 5. Build iOS

Build iOS chạy trên máy Mac của EAS — không cần Mac/Xcode tại máy Windows. Nhưng **bản cài lên
iPhone thật cần Apple Developer Program** (99 USD/năm). Chưa có tài khoản thì chỉ dùng Expo Go.

Khi đã có Apple Developer Program:

```bash
cd apps/mobile && npx eas-cli@latest credentials -p ios
```

Đăng nhập Apple ID khi được hỏi; EAS tạo Distribution Certificate, Provisioning Profile và đăng
ký bundle ID `com.smartbook.picking`. Sau đó:

```bash
cd apps/mobile && npx eas-cli@latest build -p ios --profile preview
```

Đã kiểm tra cho iOS: camera permission string (tiếng Việt) qua plugin `expo-camera`, không xin
microphone/photo library (app không dùng), `ITSAppUsesNonExemptEncryption=false` (chỉ dùng HTTPS
chuẩn), `supportsTablet=false` (giao diện dọc cho điện thoại, tránh bắt buộc ảnh chụp iPad khi lên
App Store), không có entitlement đặc biệt (không push, không associated domains).

## 6. Cài ứng dụng trên iPhone (ad hoc / internal)

1. Đăng ký thiết bị: `npx eas-cli@latest device:create` → mở link/QR trên iPhone bằng Safari →
   cài profile → thiết bị được thêm vào tài khoản Apple.
2. Build lại profile `preview` (provisioning profile phải chứa UDID thiết bị mới).
3. Mở link build trên iPhone bằng Safari → Install.
4. iOS 16+: bật **Settings → Privacy & Security → Developer Mode**, khởi động lại máy.

## 7. TestFlight

```bash
cd apps/mobile && npx eas-cli@latest build -p ios --profile production
```

```bash
cd apps/mobile && npx eas-cli@latest submit -p ios --latest
```

- Lần submit đầu, EAS hỏi Apple ID và tạo app trên App Store Connect (có thể ghi `ascAppId`
  vào `eas.json → submit.production.ios` để lần sau không hỏi lại).
- Sau khi Apple xử lý xong (5–30 phút), vào App Store Connect → TestFlight → thêm tester nội bộ
  (tối đa 100, không cần review) hoặc tester ngoài (cần Beta App Review).
- Tester cài app **TestFlight** trên iPhone và nhận lời mời qua email.
- Phát hành App Store: điền metadata, ảnh chụp màn hình, chính sách quyền riêng tư, tài khoản
  demo cho reviewer (app yêu cầu đăng nhập) → Submit for Review.

## 8. EAS Update (cập nhật qua mạng)

`expo-updates` đã có trong binary. App tải bản JS mới khi khởi động và áp dụng ở lần mở sau.

```bash
cd apps/mobile && npx eas-cli@latest update --channel preview --environment preview --message "Sửa lỗi màn hình mượn sách"
```

- Kênh `production` cho app phát hành; `preview` cho APK thử nghiệm.
- Hoặc GitHub: Actions → **Mobile release** → `update` / `preview|production`.
- Update chỉ đến được các bản binary có **cùng runtime version** (= `version` trong `app.json`).

**Dùng EAS Update được khi** chỉ đổi: code TypeScript/JSX, style, chữ, ảnh/font trong `assets`,
gọi API mới.

**Bắt buộc build binary mới (và tăng `version` trong `app.json`) khi**: thêm/xóa/nâng thư viện
có mã native (`expo-*`, `react-native-*`), đổi quyền (camera…), đổi `app.json` phần native (icon,
splash, scheme, bundle ID, plugin), nâng Expo SDK. Nếu quên tăng `version`, update JS mới có thể
gọi module native không có trong bản cũ và làm app crash.

Rollback: `npx eas-cli@latest update:republish --group <id-bản-tốt>` hoặc
`npx eas-cli@latest update:rollback`.

## 9. Kết nối production API

- URL: `https://api.smartbook.io.vn` (Caddy + Let's Encrypt, HSTS bật). Đã kiểm tra ngày
  2026-10-29: `/health` 200, chứng chỉ hợp lệ đến 26/01/2027 (Caddy tự gia hạn).
- Xem/đổi giá trị: `npx eas-cli@latest env:list --environment production`. Đổi URL → build lại
  (hoặc publish EAS Update, vì biến `EXPO_PUBLIC_*` nằm trong bundle JS).
- Mobile không dùng WebSocket/Socket.IO; chỉ REST.
- Đăng nhập gửi `client: "mobile"` → auth-service trả thêm refresh token xoay vòng. Token lưu
  trong `expo-secure-store` (Keychain iOS / Keystore Android). Access token hết hạn → app tự refresh
  một lần (single-flight); refresh token cũ dùng lại bị server từ chối `REFRESH_TOKEN_REUSED`.
- Xử lý lỗi trong `src/api/client.ts`: mất mạng (GET tự thử lại 2 lần, banner offline), timeout
  15 s (AI/OCR 150 s), 401/403 hết phiên → refresh rồi mới đăng xuất, 403 thiếu quyền → báo lỗi,
  429 → "thao tác quá nhanh", 5xx/502/504 → "máy chủ đang gặp sự cố". Ghi (POST/PATCH) bị mất kết
  nối được báo là "chưa rõ đã ghi nhận" để không bấm lặp.
- Giới hạn của gateway: đăng nhập 10 lần / 15 phút / IP. Nhiều người dùng chung một Wi-Fi (cùng
  IP công cộng) có thể chạm giới hạn này khi test đồng loạt.

## 10. Xử lý lỗi build và runtime

| Lỗi | Nguyên nhân / cách xử lý |
| --- | --- |
| `ERR_PNPM_OUTDATED_LOCKFILE` trên EAS | `pnpm-lock.yaml` lệch `package.json`. Chạy `pnpm install` ở root (pnpm 10.6.2), commit lockfile. Root `package.json` có `pnpm.overrides` (`@types/react`), vì vậy `apps/mobile/package.json` loại `@types/react` khỏi `expo install --fix` (`expo.install.exclude`). |
| `EPERM: operation not permitted, symlink ...skills...` khi upload | Thư mục `.claude/skills` có junction Windows. Đã loại bằng `.easignore` ở root repo. |
| `[app.config] EXPO_PUBLIC_API_BASE_URL ...` | Biến môi trường EAS thiếu/sai. Kiểm tra `eas env:list --environment <profile>`. |
| App mở ra báo lỗi cấu hình API | Bản build không có URL hợp lệ — build lại sau khi sửa EAS env. |
| Đăng nhập báo "Mất kết nối mạng" | Kiểm tra `https://api.smartbook.io.vn/health` từ trình duyệt điện thoại; kiểm tra VPS (`docs/DEPLOYMENT.md`). |
| "Bạn thao tác quá nhanh" khi đăng nhập | Rate limit gateway (429). Đợi 15 phút. |
| Expo Go báo SDK không tương thích | Expo Go trên máy không hỗ trợ SDK 58 → dùng APK preview/development. |
| Build iOS hỏi Apple ID trong CI | Chạy `eas credentials -p ios` ở máy local một lần trước. |
| Archive upload lớn (~200 MB) | EAS tải lên cả monorepo; thêm thư mục không cần cho mobile vào `.easignore` nếu cần (giữ `package.json` của mọi workspace để `pnpm install --frozen-lockfile` chạy được). |

Xem log: `npx eas-cli@latest build:list`, `npx eas-cli@latest build:view <id>` hoặc trang build
trên expo.dev.

## 11. Quy trình cập nhật app khi sửa code

1. Phát triển trên nhánh `hungg`; push → `ci.yml` chạy typecheck, lint, test cho cả mobile.
2. Chỉ sửa JS/giao diện → kiểm tra bằng Expo Go/dev build → publish EAS Update lên `preview`,
   thử trên APK preview → publish lên `production`.
3. Có thay đổi native → tăng `version` trong `app.json` (vd. 1.0.0 → 1.1.0) → build preview APK,
   kiểm thử → tag `mobile-v1.1.0` để build production AAB (workflow `mobile-release.yml`), iOS
   chạy tay từ tab Actions.
4. Nộp store (`eas submit`) là bước thủ công sau khi được duyệt — workflow không tự nộp.
5. Sửa backend không kích hoạt build mobile (workflow mobile chỉ chạy khi được gọi hoặc khi có
   tag `mobile-v*`). Backend deploy (`deploy-production.yml`) không phụ thuộc mobile.
6. GitHub cần secret `EXPO_TOKEN` (expo.dev → Account settings → Access tokens) cho workflow.

## 12. Tài khoản và chi phí

| Dịch vụ | Khi nào cần | Chi phí |
| --- | --- | --- |
| Expo / EAS (gói Free) | Build cloud, EAS Update | Miễn phí với giới hạn số build mỗi tháng, hàng đợi chậm hơn, giới hạn người dùng hoạt động của EAS Update. Xem https://expo.dev/pricing |
| Google Play Console | Phát hành lên Google Play | 25 USD, trả một lần. Tài khoản cá nhân mới phải chạy closed test (nhiều tester, nhiều ngày) trước khi lên production |
| Apple Developer Program | Cài lên iPhone thật ngoài Expo Go, TestFlight, App Store | 99 USD/năm |
| APK cài trực tiếp | Phân phối nội bộ Android | Miễn phí |

## Kiểm thử trên điện thoại

Phạm vi mobile hiện có (đối chiếu với route trong `apps/mobile/app`):

- **Bạn đọc (CUSTOMER):** trang chủ + gợi ý, tìm kiếm/duyệt catalog, chi tiết sách + đánh giá,
  tìm sách bằng ảnh bìa (AI), trợ lý tìm sách, đặt trước, sách đang mượn/lịch sử, phiếu nhận sách
  (QR), ví/phí phạt + thanh toán (mở trang thanh toán bên ngoài), danh sách yêu thích, thông báo,
  hồ sơ.
- **Nhân viên kho (WAREHOUSE_STAFF/MANAGER, ADMIN):** bảng điều khiển, công việc của tôi,
  quét mã, picking, putaway, xuất kho (outbound), nhận hàng chuyển kho, kiểm kê, báo cáo sự cố
  (chụp ảnh bằng chứng), tra cứu sách.
- **Chỉ có trên web:** quản trị người dùng/vai trò, nhập sách bằng AI/OCR (AI import), phân tích,
  gợi ý nhập hàng, AI Copilot/Action Center, cấu hình hệ thống, thủ thư xử lý mượn/trả tại quầy.
  Tài khoản không có vai trò mobile (vd. SUPPLIER, ACCOUNTANT) thấy màn hình "chưa hỗ trợ".

Checklist (làm trên cả Android và iOS; ghi kết quả ✅/❌ và ghi chú):

| # | Kịch bản | Kỳ vọng |
| --- | --- | --- |
| 1 | Mở app lần đầu | Splash nền tím than + logo S, vào màn hình đăng nhập |
| 2 | Đăng nhập tài khoản bạn đọc | Vào khu Bạn đọc (tab Trang chủ, Sách của tôi, Ví, Hồ sơ) |
| 3 | Đăng nhập nhân viên kho | Vào khu Nhân viên (Tổng quan, Công việc, Quét, Hồ sơ); chỉ hiện chức năng có quyền |
| 4 | Đăng nhập sai mật khẩu | Báo "Invalid credentials", không crash |
| 5 | Catalog: tìm kiếm, cuộn trang, mở chi tiết | Dữ liệu trùng với https://smartbook.io.vn |
| 6 | Đặt trước một sách, xem trong "Sách của tôi" | Web (tài khoản đó) thấy cùng đặt trước |
| 7 | Hủy đặt trước | Trạng thái đồng bộ trên web |
| 8 | Phiếu nhận sách hiển thị QR | Thủ thư quét được trên web/kho |
| 9 | Ví: xem phí phạt, bấm thanh toán | Mở trang thanh toán; quay lại app trạng thái cập nhật |
| 10 | Tìm sách bằng ảnh bìa | Xin quyền camera, chụp, trả kết quả trong ≤150 s |
| 11 | Nhân viên: nhận việc picking, quét mã kệ/sách, xác nhận dòng | Tiến độ hiện trên web kho |
| 12 | Putaway: nhận phiếu, quét vị trí, xác nhận | Tồn kho vị trí cập nhật trên web |
| 13 | Xuất kho, nhận chuyển kho, kiểm kê | Hoàn tất được, số liệu khớp web |
| 14 | Báo cáo sự cố có ảnh | Ảnh upload thành công, quản lý thấy trên web |
| 15 | Từ chối quyền camera, rồi mở lại | App hướng dẫn mở Cài đặt, không crash |
| 16 | Bật chế độ máy bay khi đang xem danh sách | Banner offline; tắt máy bay → "Thử lại" hoạt động |
| 17 | Mất mạng khi đang xác nhận picking | Báo "chưa rõ đã ghi nhận", kiểm tra lại trước khi bấm lần nữa |
| 18 | Để app quá 2 giờ (`JWT_EXPIRES_IN=2h`) rồi thao tác — access token đã hết hạn | Tự làm mới phiên, không bị đăng xuất |
| 19 | Đăng xuất trên app, đăng nhập lại | Không còn dữ liệu tài khoản trước |
| 20 | Tắt hẳn app, mở lại | Vẫn đăng nhập (token trong SecureStore) |
| 21 | Chạy trên Wi-Fi và trên 4G/5G | Cả hai đều gọi được API |
| 22 | Android: nút Back hệ thống ở màn hình con / màn hình gốc | Quay lại màn trước / thoát app, không mất dữ liệu đang nhập |
| 23 | iOS: vuốt cạnh trái để quay lại | Quay lại màn trước |
| 24 | Bàn phím ở form đăng nhập, hồ sơ, báo cáo sự cố | Ô nhập không bị bàn phím che |
| 25 | Màn hình nhỏ (≤ 5,5") và lớn, có tai thỏ | Không tràn chữ, nút không bị che bởi notch/thanh điều hướng |
| 26 | Publish EAS Update lên `preview`, mở app 2 lần | Lần mở thứ hai chạy bản JS mới |
