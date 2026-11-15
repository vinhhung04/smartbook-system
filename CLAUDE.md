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

Công cụ thứ ba — **Diagram Design** (plugin, thiết kế lại và xuất hình cuối cho báo cáo) — và quy tắc phối hợp ba công cụ: xem **mục 7**.

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

- Thư mục bổ sung cho Diagram Design: `designed/<loại>/` (HTML nguồn), `design-profile/` (bản sao profile), `tests/` (sơ đồ kiểm thử) — xem mục 7.5.
- Tên file kebab-case tiếng Anh theo module: `<module>-<luồng>.mmd`, ví dụ `auth-login-email-otp.mmd`; file xuất cùng tên, cùng thư mục con.
- Ưu tiên SVG; PNG khi cần chèn vào Word; PDF chỉ khi được yêu cầu.
- Luôn giữ file nguồn (`.mmd`, `.drawio`) cạnh bản xuất. Khi cập nhật, sửa file nguồn rồi render lại; không xóa hoặc thay thế bản nguồn cũ khi chưa được đồng ý — nếu nội dung thay đổi lớn, tạo file mới (ví dụ hậu tố `-v2`).

---

## 7. QUY TẮC THIẾT KẾ VÀ KIỂM TRA SƠ ĐỒ KỸ THUẬT

Bổ sung cho mục 6. Ba công cụ phối hợp, không thay thế nhau: **Mermaid** và **Next AI Draw.io** là nơi mô hình hóa và lưu nguồn chỉnh sửa được; **Diagram Design** là lớp trình bày, thiết kế lại sơ đồ đã đúng nội dung thành hình chuyên nghiệp cho báo cáo.

**Diagram Design** là plugin Claude Code `diagram-design@diagram-design` (repo `cathrynlavery/diagram-design`, MIT), khai báo ở scope project trong `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`). Đây không phải trình render Mermaid/Draw.io: nó vẽ lại sơ đồ thành một file HTML tự chứa (SVG inline) theo hệ thẩm mỹ riêng, rồi xuất SVG/PNG. Skill tự kích hoạt khi được yêu cầu vẽ/thiết kế lại sơ đồ; lệnh trực tiếp: `/diagram-design:import-mermaid`, `/diagram-design:import-drawio`, `/diagram-design:export-diagram`, `/diagram-design:profile`, `/diagram-design:doctor`.

### 7.1. Lựa chọn công cụ

| Công cụ | Dùng cho |
|---|---|
| Mermaid | Sequence, Activity/Flowchart, sơ đồ dạng code cần cập nhật thường xuyên theo mã nguồn — **nguồn sự thật** của luồng tương tác |
| Next AI Draw.io | Use Case, ERD phức tạp, Architecture, Component, Deployment, sơ đồ cần chỉnh tay trực quan |
| Diagram Design | Thiết kế lại sơ đồ Mermaid/Draw.io đã đúng nội dung; tạo mới sơ đồ trực quan (architecture, flowchart, sequence nhỏ, state, ER nhỏ, data flow, layer, deployment…); chuẩn hóa bố cục, khoảng cách, màu, typography; xuất SVG/PNG cuối cho báo cáo |

Giới hạn của Diagram Design (kiểm chứng ngày 2026-11-06, v2.6.141) — vượt giới hạn thì **giữ công cụ UML phù hợp** hoặc tách sơ đồ, không ép dùng Diagram Design:

- Không có kiểu **Use Case** → luôn dùng Draw.io.
- Sequence: tối đa 5 lifeline, 12 thông điệp, 1 combined fragment (2 chỉ khi đều là `opt`/`loop` một vùng), `alt` tối đa 2 nhánh, không lồng, không hỗ trợ `break`/`par`/`critical`/`ref`. Sequence đầy đủ (ví dụ 7 participant, `alt` lồng) giữ Mermaid làm hình chính thức, hoặc tách thành các phần theo 7.3.
- ER tối đa 8 thực thể; DB schema 5 bảng / 8 cột hiển thị / 6 FK; UML class 7 lớp / 8 quan hệ; architecture 9 nút / 12 cạnh (faithful: ≤ 24 nút, bắt buộc chia zone).
- ER ghi cardinality bằng chữ (`1`, `N`, `0..1`, `1..*`) ở hai đầu quan hệ, không dùng ký hiệu chân quạ; nếu báo cáo cần ký pháp khác thì giữ Mermaid/Draw.io. Luôn đọc `type-*.md` tương ứng để kiểm tra ký pháp trước khi dùng.

### 7.2. Nguồn thông tin bắt buộc

Áp dụng toàn bộ mục 6.2. Trước khi vẽ sơ đồ chính thức phải đọc phần mã liên quan: frontend routes/components, gateway, controllers/services, API endpoints, Prisma models/migrations, xác thực/phân quyền (seed quyền), quy trình nghiệp vụ, tích hợp AI, cấu hình triển khai khi liên quan. Không dùng dữ liệu tự tưởng tượng; báo cáo cũ hoặc sơ đồ cũ mâu thuẫn với mã thì mã thắng. Khi thiết kế lại một sơ đồ có sẵn, coi file nguồn là đầu vào nhưng vẫn đối chiếu lại với mã nếu sơ đồ dùng cho báo cáo.

### 7.3. Bảo toàn nội dung (bắt buộc)

- Mức chi tiết mặc định cho báo cáo: **`faithful`**. Không tự chuyển sang `balanced`/`simplified`; chỉ dùng khi người dùng yêu cầu rõ.
- Không âm thầm lược bỏ actor, use case, bảng, cột, khóa, API, thông điệp, nhánh điều kiện, mã lỗi. Không gộp thành phần có nghĩa nghiệp vụ khác nhau. Không đổi thứ tự thông điệp, hướng dữ liệu, quan hệ phụ thuộc, cardinality.
- Vượt giới hạn → tách thành tổng quan + chi tiết (hoặc các phần nối tiếp), đặt tên `<base>-overview`, `<base>-<phần>`; tập các phần phải chứa toàn bộ thông tin của nguồn, đánh số thông điệp giữ nguyên số của nguồn.
- Nội dung kỹ thuật quá dài cho nhãn mũi tên được chuyển vào ghi chú cạnh đó, giữ nguyên văn.
- Mỗi lần import/thiết kế lại phải có **bảng đối chiếu trước/sau** (nguồn → sau thiết kế → thay đổi → lý do), đặt cạnh sơ đồ hoặc trong README của thư mục, và chạy `python scripts/diagrams/check-fidelity.py <nguồn.mmd> <file.svg>...` — mọi mục báo "MISSING" phải được sửa hoặc giải thích trong bảng đối chiếu.
- Với nguồn Draw.io: trích IR bằng `drawio_extract.py` của skill, đối chiếu thủ công từng nút/cạnh vào bảng (script fidelity chỉ hỗ trợ Mermaid).

### 7.4. Phong cách SmartBook (profile `smartbook`)

- Profile lưu tại `~/.diagram-design/profiles/smartbook.md` (bản sao theo dõi bằng Git: `docs/diagrams/design-profile/smartbook.md`); file marker `.diagram-design` ở gốc repo (`profile: smartbook`) chọn profile, nên không sửa `style-guide.md` trong thư mục plugin. Máy mới: chép bản sao vào `~/.diagram-design/profiles/`.
- Màu: nền trắng `#ffffff`, chữ/nét chính navy `#1f3864`, phụ slate `#475569`, liên kết HTTP `#2f5597` (trùng viền Mermaid), nhấn hổ phách `#b45309` cho tối đa 2 phần tử. Đã qua `verify-contrast.py` (WCAG) ở cả hai skin.
- Font hệ thống, không tải Google Fonts: Arial (tên, tiếng Việt), Consolas (endpoint, bảng, mã), Times New Roman (tiêu đề, callout). Không đặt chữ tiếng Việt trong font mono, không viết hoa toàn bộ chữ tiếng Việt.
- Thang chữ khóa luận: `viewBox` rộng ≤ 800, tên nút 14px, nhãn/ghi chú 12px (sàn), tag Latin 11px; cao ≤ ~1200 cho một trang A4. Chi tiết trong mục *SmartBook thesis output* của profile.
- Bố cục: lưới 4px, đường nối vuông góc bo `r=8`, không chéo, không chồng, nhãn trên plate mờ đục cách đường 8px, mũi tên vẽ trước node, chú giải là dải ngang dưới cùng.

### 7.5. Lưu trữ

```
docs/diagrams/
├── source/            # .mmd (Mermaid) — nguồn
├── drawio/            # .drawio — nguồn
├── designed/<loại>/   # .html Diagram Design — nguồn của hình đã thiết kế
├── design-profile/    # bản sao profile smartbook
├── exports/{svg,png}/<loại>/   # hình chính thức chèn báo cáo (cùng tên với nguồn)
└── tests/             # sơ đồ kiểm thử, không dùng cho báo cáo
```

Hình chính thức thiết kế bằng Diagram Design: `designed/<loại>/<tên>.html` → `exports/svg/<loại>/<tên>.svg` + `exports/png/<loại>/<tên>.png`. Không ghi đè bản xuất Mermaid/Draw.io cũ khi chưa được đồng ý — dùng hậu tố `-dd` hoặc `-v2`. Giữ file `.mmd`/`.drawio` gốc làm nguồn nội dung.

### 7.6. Kiểm tra đầu ra (không tuyên bố hoàn thành nếu chưa chạy)

Trên máy này dùng `python` (Python 3.14 có Playwright + Chromium); `python3` là bản khác không có Playwright. `<skill>` = `~/.claude/plugins/cache/diagram-design/diagram-design/<phiên bản>/skills/diagram-design`.

1. Cấu trúc/cú pháp: `python <skill>/scripts/self_check.py --offline <file.html>` (hợp đồng SVG truy cập được, an toàn một file, không Google Fonts, nội dung trong viewBox).
2. Chữ bị cắt, plate chồng nhau, lề 40px, font thực dùng: `python scripts/diagrams/check-text-fit.py <file.html> --word-png <ảnh-16cm.png>`.
3. Đường nối (nếu có bản clone repo diagram-design): `python <repo>/scripts/verify-geometry.py <file.html>` — chéo, chồng, điểm gắn, đi sau node.
4. Xuất: `python <skill>/scripts/export_svg.py <file.html> <out.svg> --system-fonts` và `python <skill>/scripts/export_png.py <file.html> <out.png> 3`.
5. Mở PNG xuất và PNG cỡ 16cm, kiểm tra trực quan: chữ cắt, phần tử chạm/chồng, đường cắt qua chữ hoặc node, khả năng đọc khi thu nhỏ.
6. Nội dung: `python scripts/diagrams/check-fidelity.py` (nguồn Mermaid) + bảng đối chiếu; đối chiếu lại với mã nguồn.
7. Sửa và chạy lại đến khi đạt. Báo cáo rõ bước nào đã chạy, bước nào chưa chạy được.

Quy trình mẫu đã kiểm chứng: `docs/diagrams/tests/diagram-design/README.md`.
