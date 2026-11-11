# Sơ đồ kỹ thuật SmartBook

Quy tắc vẽ, chọn công cụ và kiểm tra: xem mục 6 trong [`CLAUDE.md`](../../CLAUDE.md).

```bash
pnpm diagrams:render                      # render mọi .mmd trong source/ ra exports/svg và exports/png
pnpm diagrams:render <file.mmd> -- --pdf  # một file, kèm PDF
```

Sơ đồ Draw.io (`drawio/*.drawio`) mở bằng draw.io / diagrams.net hoặc qua MCP `drawio` (`load_diagram`).

## Danh mục

| Sơ đồ | Nguồn | Bản xuất | Trạng thái chức năng | Đối chiếu mã nguồn |
|---|---|---|---|---|
| Sequence: Đăng nhập Web có OTP qua email | `source/sequence/auth-login-email-otp.mmd` | `exports/{svg,png}/sequence/` | Đang triển khai (nhánh `feature/email-otp-auth`) | `auth.controller.js`, `email-otp.js`, `apps/web/src/services/auth.ts` |
| ERD: Xác thực và phân quyền (auth-service) | `source/erd/auth-service-iam.mmd` | `exports/{svg,png}/erd/` | `email_otp_challenges` thuộc nhánh `feature/email-otp-auth`; phần còn lại đã triển khai | `services/auth-service/prisma/schema.prisma` |
| Use Case: Xác thực và Tài khoản | `drawio/use-case-auth-account.drawio` | `exports/{svg,png}/use-case/` | Đã triển khai; xác minh email OTP và 2FA thuộc nhánh `feature/email-otp-auth` | `auth.routes.js`, `iam.routes.js`, `prisma/seed.js` |
