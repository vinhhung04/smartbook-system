# Sơ đồ kỹ thuật SmartBook

Quy tắc vẽ, chọn công cụ và kiểm tra: xem mục 6 trong [`CLAUDE.md`](../../CLAUDE.md).

```bash
pnpm diagrams:render                      # render mọi .mmd trong source/ ra exports/svg và exports/png
pnpm diagrams:render <file.mmd> -- --pdf  # một file, kèm PDF
```

Sơ đồ Draw.io (`drawio/*.drawio`) mở bằng draw.io / diagrams.net hoặc qua MCP `drawio` (`load_diagram`).

## Diagram Design (thiết kế lại cho báo cáo)

Plugin Claude Code `diagram-design@diagram-design` (scope project) vẽ lại sơ đồ đã đúng nội dung thành HTML tự chứa theo profile `smartbook` (marker `.diagram-design` ở gốc repo, bản sao profile trong `design-profile/`), rồi xuất SVG/PNG. Quy tắc chọn công cụ, bảo toàn nội dung và kiểm tra: mục 7 của [`CLAUDE.md`](../../CLAUDE.md).

```bash
python scripts/diagrams/check-text-fit.py <file.html> --word-png <ảnh.png>   # chữ bị cắt, plate chồng, lề, cỡ Word 16cm
python scripts/diagrams/check-fidelity.py <nguồn.mmd> <file.svg>...          # nhãn nguồn còn nguyên văn
```

- `designed/<loại>/` — HTML nguồn của các hình đã thiết kế lại cho báo cáo; danh sách hình cần thay trong DOCX và bảng đối chiếu: [`designed/README.md`](designed/README.md). Tái tạo: `bash scripts/diagrams/diagram-design/build.sh`.
- `tests/diagram-design/` — 3 sơ đồ kiểm thử tích hợp và kết quả: [`README.md`](tests/diagram-design/README.md).

## Danh mục

| Sơ đồ | Nguồn | Bản xuất | Trạng thái chức năng | Đối chiếu mã nguồn |
|---|---|---|---|---|
| Sequence: Đăng nhập Web có OTP qua email | `source/sequence/auth-login-email-otp.mmd` | `exports/{svg,png}/sequence/` | Đang triển khai (nhánh `feature/email-otp-auth`) | `auth.controller.js`, `email-otp.js`, `apps/web/src/services/auth.ts` |
| ERD: Xác thực và phân quyền (auth-service) | `source/erd/auth-service-iam.mmd` | `exports/{svg,png}/erd/` | `email_otp_challenges` thuộc nhánh `feature/email-otp-auth`; phần còn lại đã triển khai | `services/auth-service/prisma/schema.prisma` |
| Sequence: Thanh toán phí phạt qua VNPay | `source/sequence/borrow-vnpay-fine-payment.mmd` | `exports/{svg,png}/sequence/` (+ bản thiết kế `-dd-p1`, `-dd-p2`) | Đã triển khai (sandbox) | `vnpay-payment.controller.js`, `vnpay-webhook.controller.js`, `vnpay-payment.service.js`, `vnpay.service.js`, `fine-item.tsx` |
| Use Case: Xác thực và Tài khoản | `drawio/use-case-auth-account.drawio` | `exports/{svg,png}/use-case/` | Đã triển khai; xác minh email OTP và 2FA thuộc nhánh `feature/email-otp-auth` | `auth.routes.js`, `iam.routes.js`, `prisma/seed.js` |
