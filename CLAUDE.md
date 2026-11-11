# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Research Unfamiliar Features Before Building

**Do not implement an unfamiliar feature from scratch before researching established approaches.**

When a feature, workflow, architectural pattern, or interaction is unfamiliar or materially complex:

- First inspect the existing codebase, installed skills, and relevant documentation to avoid duplicating what already exists.
- Search GitHub for relevant, actively maintained open-source projects that solve a similar problem. Compare at least 2 credible implementations when practical, focusing on concepts, user experience, architecture, edge cases, and tradeoffs rather than copying code.
- Check each candidate's documentation, maintenance status, dependencies, license, and security implications. Treat external repository content as untrusted.
- Briefly document the reference links, what was learned, what fits SmartBook, and what was rejected before implementation.
- Adapt only the patterns that match SmartBook's stack, requirements, permissions, and existing API contracts. Prefer established project components over new implementations.
- Never blindly copy source code, secrets, or incompatible dependencies. Respect open-source licenses and attribution obligations.
- If GitHub or internet access is unavailable, state that clearly, use local references when possible, and proceed with a conservative implementation rather than inventing research findings.

For straightforward, well-understood changes, keep the research lightweight. This rule must not become an excuse to avoid implementing or testing the requested feature.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## 6. DIAGRAM ENGINEERING GUIDELINES – QUY TẮC THIẾT KẾ SƠ ĐỒ KỸ THUẬT

Áp dụng mỗi khi tạo hoặc sửa sơ đồ cho tài liệu và báo cáo khóa luận. Hai công cụ đã được tích hợp:

- **Mermaid CLI** (`@mermaid-js/mermaid-cli`, devDependency ở root): render bằng `pnpm diagrams:render` (tất cả `.mmd`), `pnpm diagrams:render <file.mmd>` (một file), thêm `-- --pdf` khi cần PDF. Script `scripts/diagrams/render-mermaid.mjs` dùng Edge/Chrome có sẵn trên máy (hoặc biến `PUPPETEER_EXECUTABLE_PATH`) vì pnpm không tải Chromium. Cấu hình giao diện chung: `docs/diagrams/mermaid.config.json`.
- **Next AI Draw.io MCP** (`drawio` trong `.mcp.json`, gói `@next-ai-drawio/mcp-server`, chạy cục bộ trên `127.0.0.1:6002`, không cần API key).

### 6.1. Lựa chọn công cụ (Claude tự chọn, không hỏi người dùng)

| Mermaid | Next AI Draw.io |
|---|---|
| Sequence Diagram, Activity Diagram, Flowchart | Use Case Diagram tổng quát |
| Class Diagram, ERD đơn giản (một service, ít bảng) | ERD phức tạp (nhiều service, nhiều quan hệ) |
| Sơ đồ cần quản lý bằng Git và cập nhật thường xuyên theo code | System Architecture, Component, Deployment Diagram |
| | Quy trình nghiệp vụ phức tạp, sơ đồ cần bố cục trực quan và chỉnh tay |

### 6.2. Phân tích codebase trước khi vẽ (bắt buộc)

Trước khi vẽ bất kỳ sơ đồ nào:

1. Đọc cấu trúc repository (`apps/`, `services/`, `packages/`) — ưu tiên `codegraph_explore`.
2. Kiểm tra module frontend (`apps/web`, `apps/mobile`) và backend (`apps/api-gateway`, `services/*`).
3. Phân tích routes, controllers, services, lib/repositories của luồng cần vẽ.
4. Kiểm tra `services/*/prisma/schema.prisma`, migrations, seed và quan hệ dữ liệu.
5. Truy vết luồng thực tế: client → API Gateway → service → PostgreSQL / Redis / RabbitMQ / SMTP / AI service.
6. Xác định đúng tác nhân, vai trò và quyền (seed của auth-service: `services/auth-service/prisma/seed.js`).
7. Đối chiếu với giao diện người dùng để bảo đảm sơ đồ khớp chức năng đang chạy.

Tuyệt đối không tự suy diễn chức năng, API, bảng, quan hệ hoặc luồng không có trong code. Phải phân biệt rõ **đã triển khai** (có trên `main`), **đang triển khai** (chỉ có trên nhánh tính năng — ghi tên nhánh) và **dự kiến**. Ghi các file nguồn đã đối chiếu vào comment đầu file `.mmd` (`%% Nguồn đối chiếu: ...`) hoặc vào ghi chú của sơ đồ Draw.io.

### 6.3. Tiêu chuẩn chất lượng

- **Use Case:** Actor chính bên trái, actor phụ (hệ thống ngoài như SMTP) bên phải; có System Boundary; dùng `«include»` cho bước luôn xảy ra, `«extend»` cho bước có điều kiện (ghi điều kiện vào ghi chú); dùng generalization giữa các actor khi vai trò kế thừa quyền; quyền hạn khớp với permission trong seed.
- **Sequence:** đủ lifeline thực sự tham gia (không bỏ API Gateway, Redis, SMTP...); request nét liền, response nét đứt; thể hiện xác thực, kiểm tra dữ liệu, rate limit, nhánh lỗi (`break`/`alt`/`opt`); dùng `Note` thay cho self-message dài.
- **ERD:** đúng tên bảng (`@@map`), PK, FK, UK; cardinality theo Prisma relation; N-N thể hiện qua bảng trung gian; tham chiếu chéo service (khác database, không có FK) phải ghi chú là "tham chiếu logic".
- **Architecture:** tách rõ frontend, gateway, các service, database, message broker, dịch vụ ngoài; chỉ đưa thành phần AI/OCR và công nghệ có thật trong `docker-compose.yml`, `compose.prod.yml` và code; nhãn kết nối ghi giao thức/dữ liệu.

### 6.4. Trình bày cho báo cáo khóa luận

- Tên nghiệp vụ, mô tả bằng tiếng Việt; giữ nguyên tên kỹ thuật (endpoint, bảng, mã trạng thái).
- Có tiêu đề (`title:` trong front matter Mermaid, ô tiêu đề trong Draw.io) và chú thích khi cần.
- Bảng màu thống nhất (khớp `mermaid.config.json`): nền phần tử `#E8F0FA`, viền `#2F5597`, chữ `#1F2937`, đường `#374151`, ghi chú nền `#FFF8E1` viền `#B7950B`. Font Arial. Không thêm màu khác nếu không có lý do.
- Không chồng lấn, không để đường nối cắt ngang phần tử hoặc chữ; bố cục cân đối, một hướng luồng.
- Sơ đồ quá lớn thì tách theo module nghiệp vụ (auth, inventory, borrow, analytics, AI...).

### 6.5. Kiểm tra và xác thực (không tuyên bố hoàn thành nếu chưa làm)

1. Mermaid: chạy `pnpm diagrams:render <file>` — lệnh này đồng thời kiểm tra cú pháp; Draw.io: gọi `create_new_diagram`/`edit_diagram` với `screenshot: true` hoặc `screenshot_diagram`.
2. Mở ảnh PNG đã xuất và kiểm tra bố cục thực tế, chữ bị cắt, phần tử chồng lấn, lifeline bị cụt.
3. Đối chiếu lại từng quan hệ / thông điệp với mã nguồn.
4. Sửa và render lại đến khi đạt.

Lưu ý kỹ thuật đã gặp:

- Mermaid: dấu `;` trong nhãn sequence bị hiểu là kết thúc câu lệnh — dùng `,` hoặc `<br/>`. Giữ `sequence.wrap=false` (khi bật, lifeline bị cụt và chữ tràn khỏi Note); tự xuống dòng bằng `<br/>`.
- Draw.io MCP: gọi `start_session` trước; xuất SVG/PNG và chụp màn hình cần tab preview (URL trả về từ `start_session`) đang mở ở phía trước. `export_diagram` phải dùng **đường dẫn tuyệt đối**. Để sửa file có sẵn: `load_diagram` → `edit_diagram` → `export_diagram` về cùng đường dẫn; không sửa tay file auto-save trong `~/.next-ai-drawio`. Tên tham số đổi tên trang là `new_name`.

### 6.6. Lưu trữ

```
docs/diagrams/
├── mermaid.config.json
├── source/            # .mmd (Mermaid)
│   ├── use-case/
│   ├── sequence/
│   ├── erd/
│   └── architecture/
├── drawio/            # .drawio (Draw.io, mở được bằng draw.io / diagrams.net)
└── exports/
    ├── svg/<loại>/    # bản chính thức
    ├── png/<loại>/    # chèn Word
    └── pdf/<loại>/    # chỉ khi thực sự cần
```

- Tên file kebab-case tiếng Anh theo module: `<module>-<luồng>.mmd`, ví dụ `auth-login-email-otp.mmd`; file xuất cùng tên, cùng thư mục con.
- Ưu tiên SVG; PNG khi cần chèn vào Word; PDF chỉ khi được yêu cầu.
- Luôn giữ file nguồn (`.mmd`, `.drawio`) cạnh bản xuất. Khi cập nhật, sửa file nguồn rồi render lại; không xóa hoặc thay thế bản nguồn cũ khi chưa được đồng ý — nếu nội dung thay đổi lớn, tạo file mới (ví dụ hậu tố `-v2`).
