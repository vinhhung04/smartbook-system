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

Áp dụng mỗi khi tạo hoặc cập nhật sơ đồ kỹ thuật (đặc biệt cho báo cáo khóa luận).

### 6.1. Công cụ và cách chọn

Claude tự chọn công cụ, không bắt người dùng chỉ định mỗi lần vẽ.

| Dùng **Mermaid** (`.mmd`, render bằng `mmdc`) | Dùng **Next AI Draw.io** (MCP server `drawio`) |
|---|---|
| Sequence Diagram | Use Case Diagram tổng quát |
| Activity Diagram, Flowchart | ERD phức tạp (nhiều bảng, nhiều service) |
| Class Diagram | System Architecture Diagram |
| ERD đơn giản | Component Diagram, Deployment Diagram |
| Sơ đồ cần quản lý bằng Git và cập nhật thường xuyên | Quy trình nghiệp vụ phức tạp; sơ đồ cần bố cục trực quan hoặc chỉnh tay |

**Mermaid CLI** (devDependency gốc `@mermaid-js/mermaid-cli`, dùng chung theme `docs/diagrams/mermaid.config.json`):

```bash
pnpm exec mmdc -c docs/diagrams/mermaid.config.json -b white -i docs/diagrams/source/<loại>/<tên>.mmd -o docs/diagrams/exports/svg/<tên>.svg
pnpm exec mmdc -c docs/diagrams/mermaid.config.json -b white -s 2 -i docs/diagrams/source/<loại>/<tên>.mmd -o docs/diagrams/exports/png/<tên>.png
```

Lần đầu trên một máy mới, nếu `mmdc` báo thiếu trình duyệt (pnpm 10 không chạy script tải trình duyệt của puppeteer), tải trình duyệt headless vào cache người dùng (ngoài repo):

```bash
node node_modules/.pnpm/puppeteer@*/node_modules/puppeteer/lib/puppeteer/node/cli.js browsers install chrome-headless-shell
```

**Next AI Draw.io** (`.mcp.json`, server `drawio`, gói `@next-ai-drawio/mcp-server` ghim phiên bản): không cần API key hay nhà cung cấp AI, vì Claude tự sinh XML draw.io. Quy trình: `start_session` (mở canvas xem trước tại `http://localhost:6002`) → `create_new_diagram` / `edit_diagram` → `screenshot_diagram` để tự kiểm tra → `export_diagram` ra `.drawio`, `.svg`, `.png` bằng **đường dẫn tuyệt đối**. Việc xuất ảnh và chụp màn hình cần tab xem trước đang mở và ở phía trước.

### 6.2. Phân tích codebase trước khi vẽ (bắt buộc)

Trước khi tạo bất kỳ sơ đồ nào, Claude phải:

1. Đọc cấu trúc repository (`apps/`, `services/`, `packages/`, `docker-compose.yml`, `deploy/`).
2. Kiểm tra các module frontend (`apps/web`, `apps/mobile`) và backend (`apps/api-gateway`, `services/*`).
3. Phân tích routes, controllers, services/lib và lớp truy cập dữ liệu thực tế.
4. Kiểm tra `prisma/schema.prisma`, `prisma/migrations/`, `db-init/` và quan hệ dữ liệu; bảng thuộc service khác chỉ là tham chiếu logic, không phải khóa ngoại.
5. Truy vết luồng thực tế frontend → API Gateway → service → database → dịch vụ ngoài (SMTP, AI service, OCR…).
6. Xác định chính xác tác nhân, vai trò, quyền hạn (seed role/permission), nghiệp vụ và thành phần.
7. Đối chiếu với giao diện (trang/màn hình gọi API tương ứng) để bảo đảm chức năng thực sự đang được dùng.

Tuyệt đối không tạo ra chức năng, API, bảng dữ liệu hay quan hệ không có trong codebase, và không mô tả luồng dự kiến như chức năng đã hoàn thành. Luôn phân biệt rõ **đã triển khai**, **đang triển khai** và **dự kiến phát triển** (ghi chú hoặc đánh dấu khác kiểu trên sơ đồ). Hành vi phụ thuộc cấu hình (biến môi trường, feature flag) phải ghi rõ điều kiện.

### 6.3. Tiêu chuẩn chất lượng sơ đồ

- **Use Case:** Actor chính xác (kể cả actor phụ như dịch vụ email); System Boundary rõ ràng; các Use Case chính; phân biệt `«include»` (luôn xảy ra) và `«extend»` (có điều kiện, ghi điều kiện); thể hiện đúng quyền hạn từng nhóm người dùng.
- **Sequence:** Lifeline chính xác; thứ tự theo thời gian; mũi tên liền cho request, nét đứt cho response; thể hiện kiểm tra dữ liệu, xác thực, xử lý nghiệp vụ; dùng `alt`/`opt`/`loop` cho nhánh điều kiện, ngoại lệ, luồng thay thế; không bỏ qua thành phần trung gian thực sự tham gia (API Gateway, rate limiter, transaction…).
- **ERD:** Entity đúng tên bảng; ghi PK, FK, UK; cardinality đúng; phân biệt 1-1, 1-N, N-N (N-N qua bảng trung gian); khớp với schema và migrations hiện tại.
- **Architecture:** Phân biệt frontend, backend, database, dịch vụ ngoài; chỉ đưa thành phần AI/OCR/tích hợp nếu thực sự tồn tại; kết nối và luồng dữ liệu chính xác; không đưa công nghệ chưa sử dụng vào kiến trúc hiện tại.

### 6.4. Quy chuẩn trình bày cho báo cáo khóa luận

- Tên nghiệp vụ và mô tả bằng tiếng Việt; giữ nguyên tên kỹ thuật (tên bảng, endpoint, class) khi cần.
- Bố cục rõ ràng, cân đối; không chồng lấn thành phần; hạn chế đường nối cắt ngang nội dung.
- Bảng màu tối giản và nhất quán giữa các sơ đồ: viền/nhấn `#2F5D8A`, nền thành phần `#EAF2FB`, nền phụ `#F5F7FA`, đường nối `#4A5568`, chữ `#1F2933`, ghi chú `#FFF8E1`. Mermaid lấy từ `docs/diagrams/mermaid.config.json`; draw.io dùng cùng mã màu.
- Mọi sơ đồ có tiêu đề (dạng “Sơ đồ … – …”) và chú thích khi cần.
- Phong cách học thuật, chuyên nghiệp. Sơ đồ quá lớn thì chia theo module nghiệp vụ thay vì dồn vào một hình.

### 6.5. Kiểm tra và xác thực

Sau khi tạo sơ đồ, Claude phải: (1) kiểm tra cú pháp Mermaid (render không lỗi); (2) render ra ảnh; (3) xem ảnh thực tế để kiểm tra bố cục; (4) kiểm tra quan hệ và luồng xử lý; (5) đối chiếu lại với mã nguồn; (6) kiểm tra chữ bị cắt, tràn khung, thành phần chồng lấn; (7) sửa và render lại nếu có vấn đề. Không tuyên bố sơ đồ hoàn thành khi chưa xem kết quả đầu ra.

### 6.6. Lưu trữ

```
docs/diagrams/
├── mermaid.config.json        # theme dùng chung cho Mermaid
├── source/                    # mã nguồn Mermaid (.mmd)
│   ├── use-case/
│   ├── sequence/
│   ├── erd/
│   └── architecture/
├── drawio/                    # file draw.io có thể chỉnh sửa (.drawio)
└── exports/
    ├── svg/                   # bản xuất chính thức (ưu tiên)
    ├── png/                   # khi cần chèn vào Word/công cụ soạn thảo
    └── pdf/                   # chỉ khi thực sự cần
```

- Tên file dạng kebab-case không dấu, mô tả nội dung (ví dụ `xac-thuc-email-otp.mmd`); file xuất trùng tên với file nguồn.
- Luôn giữ file nguồn có thể chỉnh sửa (`.mmd`, `.drawio`) cạnh bản xuất.
- Khi cập nhật, không xóa hoặc ghi đè tùy tiện bản nguồn cũ: thay đổi lớn về cấu trúc thì tạo phiên bản mới (ví dụ hậu tố `-v2`) hoặc dựa vào lịch sử Git, và báo cho người dùng.
