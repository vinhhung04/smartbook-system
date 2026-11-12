# Báo cáo khắc phục và hoàn thiện hệ thống AI — SmartBook

> Branch `hungg`, nền commit `03c9119`, thực hiện 2026-11-12 → 13. Chưa commit, chưa push. Mọi số liệu dưới đây là kết quả chạy thật; mục nào chưa chạy được ghi rõ.

## A. Tóm tắt

**Đã khắc phục**

1. Action không còn kẹt ở `CONFIRMED`: lỗi đích từ chối → `FAILED` (xác nhận lại an toàn); không xác định được kết quả → `RECONCILE_REQUIRED` (không bao giờ tự chạy lại), trừ loại idempotent; action mồ côi khi service khởi động lại được giải phóng; có endpoint đối chiếu cho admin.
2. Quyền xác nhận action theo đúng guard của service đích (Role **và** Permission), kiểm tra lại theo cấu hình hiện hành lúc xác nhận. Cổng Decision Assistant thống nhất với web.
3. Bạn đọc xác nhận được đặt chỗ sách: trước đây **mọi** đặt chỗ bạn đọc xác nhận đều bị 403 vì bị đòi phạm vi ghi kho mà bạn đọc không có. Đã kiểm trực tiếp với borrow-service.
4. Rate limit ẩn danh theo IP thật do gateway xác nhận, không còn chia chung IP của gateway; header IP của client bị ghi đè.
5. `calibrate_rag.py` không còn tự chọn ngưỡng không hợp lệ (`NO_VALID_CANDIDATE`), và loại ứng viên làm tắt nhánh dự phòng keyword.
6. Tri thức lai: giá trị cấu hình (hạn mức gói thẻ, mức phí, địa chỉ, giờ mở cửa) đọc trực tiếp từ API khi tài liệu chính sách được tìm thấy; đồng bộ tài liệu không cần restart.
7. Chatbot không còn từ chối nhầm câu hỏi chính sách của bạn đọc (định tuyến sai sang analytics bị chặn); tên sách trong phiếu mượn của bạn đọc không còn hiển thị `"?"`.
8. Shared AI Core: `ai_core/` (policy, tools, prompts, observability) được cả hai trải nghiệm dùng thật; tool đọc có một đường thực thi duy nhất có kiểm tra, timeout, log; prompt có phiên bản; log có `request_id` từ gateway.

**Còn tồn tại** (chi tiết ở mục H): một số lỗi phân loại câu hỏi của NLU; 1/4 câu "gần nghĩa" vẫn khẳng định phủ định; OpenRouter trả 429 làm `/chat/stream` rơi về chế độ không stream lúc kiểm tra; rate limit/cache trong bộ nhớ một process; executor ghi vào inventory chỉ kiểm bằng HTTP giả lập.

## B. Khắc phục quan trọng (Phase A)

| # | Vấn đề | Nguyên nhân gốc (đã xác minh trong code) | Giải pháp | File | Kiểm thử |
|---|---|---|---|---|---|
| A1 | Action kẹt `CONFIRMED` | `confirm_action` có `except HTTPException: raise` không cập nhật trạng thái; lỗi khác → `FAILED` dù có thể đã ghi, và `FAILED` lại cho xác nhận lại → nguy cơ trùng | Phân loại: `HTTPException` (đích từ chối/điều kiện cục bộ) → `FAILED`; `ActionOutcomeUnknown` (timeout, mất kết nối, 5xx) hoặc lỗi bất ngờ → `RECONCILE_REQUIRED` (loại idempotent → `FAILED`); kết quả nhiều dòng có dòng không xác định → `RECONCILE_REQUIRED`; chuyển trạng thái có điều kiện; quét action `CONFIRMED` quá 900s; `POST /actions/reconcile`; nhãn trạng thái mới ở web | `agent_actions.py`, `agent_store.py`, `agent_executor.py`, `main.py`, `apps/web/src/components/ai-action-card.tsx`, `lib/ai-action-labels.ts`, `lib/status-registry.ts` | `test_action_lifecycle.py` (14), `test_agent_store.py` |
| A2 | RBAC lệch FE/BE | Web dùng `hasAnyRole && hasAnyPermission`; ai-service dùng OR cho cổng assistant và xác nhận action, đọc danh sách role lưu trên action lúc tạo; cấu hình dựa vào `borrow.reservation.write` — quyền không role nào có | Chính sách theo loại action (danh sách phương án Role AND Permission) sao chép guard của service đích; `can_confirm_action` đọc cấu hình hiện hành; `can_use_assistant` AND, `main` dùng chung định nghĩa | `agent_actions.py`, `agent_permissions.py`, `routes_conversations.py`, `main.py` | `test_permission_matrix.py` (8 test, 39 subtest) |
| A3 | Bạn đọc không đặt chỗ được | `action_guard._WRITES_WAREHOUSE` chứa `CREATE_RESERVATION_DRAFT`; bạn đọc và thủ thư có 0 phạm vi kho (`user_warehouse_scopes`) → 403 | Bỏ đặt chỗ khỏi nhóm ghi kho; borrow-service tự kiểm role/permission, tồn kho, thẻ, nợ phạt. Bạn đọc đi `/my/reservations` (không gửi `customer_id`), quầy đi `/borrow/reservations` | `action_guard.py` | `test_reservation_actions.py` (7) + kiểm trực tiếp (dưới) |
| A4 | Bảo mật action | — | Các kịch bản yêu cầu đều có test (xem mục E) | — | `test_copilot_security.py`, `test_action_lifecycle.py`, `test_reservation_actions.py`, `test_permission_matrix.py` |

**Kiểm trực tiếp A3** (stack Docker, borrow-service thật): tạo bản nháp đặt chỗ "Norwegian Wood" tại Chi nhánh Thủ Đức cho `customer01` → xác nhận bằng token khách qua gateway → `EXECUTED`, `mode: real_api`, reservation `PENDING` được tạo; xác nhận lần hai → trả kết quả cũ (idempotent); reservation kiểm thử sau đó được hủy (`CANCELLED`) để không để lại dữ liệu.

**Nhận định audit được xác minh lại:** cả bốn nhận định của đề bài đều đúng với code tại `03c9119`. Riêng rate limiter: comment nhắc X-Forwarded-For nhưng code dùng `request.client.host` cho người ẩn danh — đúng; nay đã thay bằng header do gateway đặt.

## C. RAG (Phase B)

**Dữ liệu dùng thật:** `eval/rag_dataset.json` (226 câu: 107 sách, 119 tài liệu nội bộ; 92 câu không có đáp án), `eval/chat_answer_dataset.json` (32 câu, 8 nhóm, mới), corpus 22 tài liệu / 64 đoạn, danh mục 135 sách.

**Hiệu chỉnh** (`calibration_20261112_151704.md`, chia val/test bằng hash):

| Corpus | Kết quả | Quyết định |
|---|---|---|
| BOOK_METADATA | `NO_VALID_CANDIDATE` (không ngưỡng nào giữ answerable Recall@5 trong ±0,06 của baseline) | Giữ 0,25 — script cũ (`pool = eligible or table`) sẽ tự chọn một ngưỡng không hợp lệ |
| INTERNAL_DOC | Chọn 0,35 (calib No-answer 0,647); trên test: answerable R@5 0,959, No-answer 0,522, FPR 0,478, FNR 0, Abstention F1 0,686 | Giữ 0,40: bằng 0,35 trên calib, và là trần để nhánh keyword-only còn hoạt động |

**Truy xuất** (`rag_20261112_151714.md`): INTERNAL_DOC R@1 0,605 / R@5 0,6387 / MRR 0,6218, No-answer 0,70; BOOK_METADATA R@5 0,2082, No-answer 0,865.

**Câu trả lời cuối** (live `/ai/chat`, chấm xác định):

| Lần chạy | Đúng | Từ chối đúng | Từ chối nhầm | Khẳng định cấm | Trích dẫn precision / đủ | Cảnh báo grounding |
|---|---|---|---|---|---|---|
| `chat_answers_20261112_153018` (trước sửa định tuyến) | 23/32 | 0,875 | 0,188 | 0 | 0,6 / 0,7 | 0,25 |
| `chat_answers_20261112_155422` (sau) | **28/32** | 0,875 | 0,062 | 0 | 0,639 / 0,9 | 0,125 |

Ghi chú trung thực: ở lần đầu, 2 câu "dữ liệu động" bị chấm sai do tiêu chí chấm của tôi giả định sai (đòi intent khác `GENERAL_QUERY`, trong khi dữ liệu cá nhân luôn được nạp); tiêu chí đã sửa và có test. 4 câu còn sai ở lần sau: `ans-full-01` (NLU xếp câu hỏi hạng thẻ thành tìm sách), `ans-part-03` (câu hỏi nửa có nửa không bị từ chối cả câu), `ans-part-04` (trả lời đúng phần có nhưng không nói phần chưa có), `ans-near-02` (khẳng định "không thể gia hạn qua SMS").

**Grounding và từ chối** (`rag.RAG_SYSTEM_RULES`): giá trị hiện hành thắng tài liệu và phải nói khi khác; số liệu động chỉ từ dữ liệu hệ thống; nói rõ phần chưa xác minh; chỉ ra thông tin sai trong câu hỏi; không suy ra "không hỗ trợ" từ thiếu thông tin. Với bạn đọc, câu hỏi chính sách bị xếp nhầm vào intent analytics nay vẫn tra tài liệu (không gửi token bạn đọc tới analytics).

**Đồng bộ tài liệu:** `POST /internal/corpus-sync` (kiểm trực tiếp: khóa đúng → `{documents: 22, chunks_embedded: 0, chunks_skipped: 64, removed: 0}`, khóa sai → 403); `INTERNAL_DOC_DIR` cho phép mount; hash từng đoạn; thư mục rỗng không xóa corpus.

**Giới hạn:** Recall sách (BOOK_METADATA) thấp sẵn từ trước (R@5 ≈ 0,21) và không thay đổi trong đợt này; No-answer Accuracy ở tầng truy xuất giảm khi corpus lớn hơn — được bù ở tầng câu trả lời, không phải ở ngưỡng.

## D. Shared AI Core (Phase C)

Chi tiết và sơ đồ: `docs/AI/AI_ARCHITECTURE.md`.

| Module dùng chung | Trước | Sau |
|---|---|---|
| `ai_core/policy.py` | Quyết định quyền rải rác ở `main`, `agent_permissions`, `routes_conversations`, `action_guard`, `warehouse_scope` | Một bề mặt import; khóa rate limit tin IP do gateway đặt |
| `ai_core/tools.py` | 3 chỗ gọi thẳng `TOOL_FUNCTIONS` | `run_read_tool`: kiểm tên, lọc/ép kiểu tham số theo schema, timeout tổng, log audit; registry READ / DRAFT_THEN_CONFIRM / FORBIDDEN |
| `ai_core/prompts.py` | Prompt chatbot là hằng trong `main.py` | Prompt có tên + phiên bản cho chatbot, assistant, NLU, RAG; `/health.prompt_versions` |
| `ai_core/observability.py` | Không có id liên kết | Middleware ASGI giữ `x-request-id`; log `llm_call`/`tool_call` có `request_id` (kiểm trực tiếp: `remediation-check-01` xuất hiện ở log NLU và chat) |
| `llm_provider.py` | Đã dùng chung | Thêm `request_id` vào log |

**Giữ độc lập:** bộ điều phối chat và copilot, system prompt, conversation store, cache, cổng truy cập, chuỗi kiểm chứng copilot. **API tương thích:** không xóa/đổi endpoint; chỉ thêm (`/actions/reconcile`, `/internal/corpus-sync`, trường `reconcile_required`, `prompt_versions`, header `x-request-id`).

## E. Bảo mật

Ma trận quyền đầy đủ: `docs/AI/PERMISSION_MATRIX.md`.

| Kịch bản | Kết quả | Bằng chứng |
|---|---|---|
| User A xác nhận action của B | 403, action giữ nguyên | `test_another_users_action_cannot_be_confirmed` |
| User A xem hội thoại của B | 403 | `test_assistant_conversation_access` |
| Kho A ghi vào kho B / phạm vi bị thu hồi | 403; không đọc được phạm vi → 503 | `test_copilot_security` |
| Token bị thu hồi / không xác minh được | 401 / 503 | `test_copilot_security`, `test_unverified_token_revocation_refuses_the_write` |
| Quyền bị thu hồi sau khi tạo bản nháp | Kiểm theo cấu hình hiện hành | `test_the_role_list_stored_on_an_old_action_is_not_trusted` |
| Sửa `warehouse_id`/payload/`customer_id` qua override | 400 cho trường không cho phép; kho đích kiểm lại phạm vi | `test_payload_tampering_through_override_is_rejected`, `test_customer_cannot_retarget_the_reservation_through_override` |
| Hai người cùng xác nhận | Chỉ một lần thực thi, lần kia 409 | `test_two_concurrent_confirms_execute_once` |
| Action hết hạn | 410 | `test_expired_action_cannot_be_confirmed` |
| Tool injection | Tool lạ bị từ chối; tham số lạ bị bỏ | `test_ai_core.RunReadToolTest` |
| Prompt injection qua lịch sử | Role ≠ user/assistant → 422 | `test_history_accepts_only_conversational_roles` |
| Giả mạo IP | Header client bị ghi đè; XFF client không được đọc | `test_ai_core.RateLimitKeyTest`, `gateway-contract.test.js`, kiểm trực tiếp (dưới) |
| Lộ thông tin nội bộ | `/ai/metrics`, `/ai/docs`, `/ai/redoc`, `/ai/openapi.json`, `/ai/internal/*` → 404 | kiểm trực tiếp qua gateway mới |

**Kiểm trực tiếp rate limit/IP** (gateway mã nguồn trên cổng phụ, ai-service giả ghi header): client gửi `x-smartbook-client-ip: 6.6.6.6` → ai-service nhận `127.0.0.1`; sau proxy biên (`X-Forwarded-For: 203.0.113.9`) → `203.0.113.9`; client giả `1.1.1.1` phía trước → vẫn `203.0.113.9`. Phát hiện trong lúc kiểm: hook `proxyReq` chạy sau khi thư viện proxy đã nối IP gateway vào XFF → đã chuyển việc xác định IP lên trước mọi proxy.

## F. Kiểm thử

| Test Suite | Total | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| Unit (ai-service, phần còn lại) | 1209 | 1209 | 0 | 0 |
| Integration trong service (`test_action_lifecycle`, `test_reservation_actions`, `test_chat_pipeline`, `test_retrieval`, `test_ingestion`) | 57 | 57 | 0 | 0 |
| Integration Postgres (`test_agent_store_pg`, `test_pgvector_store`) | 8 | 0 | 0 | 8 (không có Postgres cục bộ; chạy ở CI job `ai-postgres`) |
| Security (`test_copilot_security`, `test_permission_matrix`, `test_assistant_conversation_access`, `test_warehouse_scope`) | 43 | 43 | 0 | 0 |
| Performance/đồng thời trong tiến trình (`test_concurrency`) | 3 | 3 | 0 | 0 |
| **ai-service tổng (`python -m pytest services/ai-service`)** | **1320** | **1312** | **0** | **8** |
| api-gateway (`node --test`) | 15 | 15 | 0 | 0 |
| web unit (`pnpm --filter web test:unit`) | 49 | 49 | 0 | 0 |
| web typecheck (`tsc --noEmit`) | — | sạch | — | — |
| E2E Playwright AI (Edge, dev server 5174) | 15 | 15 | 0 | 0 |
| Eval câu trả lời live | 32 | 28 | 4 | 0 |

Số liệu đồng thời (model/truy xuất giả, đo luồng xử lý): 200 yêu cầu `/chat` đồng thời của 20 user ~1,5 giây, không lỗi; 40 yêu cầu của một user → đúng 15 nhận / 25 bị 429; 50 stream song song không lẫn token. Không đo tải với LLM thật (giới hạn OpenRouter).

**Kiểm trực tiếp streaming:** `/assistant/stream` — token đầu 3,39s, tổng 5,94s, 68 token, kiểm chứng `PASSED`. `/chat/stream` — hai lần thử đều bị OpenRouter trả 429 ở lời gọi stream, đường dự phòng không-stream trả lời đúng (1 token, ~11–13s); stream token-by-token của chatbot đã được đo ở phiên trước (token đầu 0,75–4,0s) nhưng không tái hiện được lần này.

## G. File thay đổi

**Sửa:** `apps/api-gateway/src/index.js` (IP client cho proxy AI), `apps/api-gateway/test/gateway-contract.test.js`, `apps/web/src/components/ai-action-card.tsx` (không báo "đã xác nhận" khi chờ đối chiếu, thêm thông điệp), `apps/web/src/lib/ai-action-labels.ts`, `apps/web/src/lib/status-registry.ts` (nhãn/màu `RECONCILE_REQUIRED`), `services/ai-service/{action_guard, agent_actions, agent_executor, agent_permissions, agent_store, ingestion, llm_provider, main, rag, retrieval, routes_conversations, user_personal_context}.py`, `services/ai-service/eval/calibrate_rag.py`, `docs/SERVICES/AI_SERVICE.md`; test cập nhật: `test_agent_store.py` (FAILED chỉ sau CONFIRMED — theo máy trạng thái mới), `test_copilot_security.py` (patch lệnh quét mới; fixture WM có `inventory.purchase.request` như seed), `test_chat_pipeline.py`, `test_ingestion.py`, `test_rag.py`, `test_retrieval.py`.

**Tạo:** `services/ai-service/ai_core/{__init__, policy, tools, prompts, observability}.py`; test `test_action_lifecycle.py`, `test_reservation_actions.py`, `test_permission_matrix.py`, `test_ai_core.py`, `test_calibrate_rag.py`, `test_concurrency.py`, `test_eval_chat_answers.py`; `eval/eval_chat_answers.py`, `eval/chat_answer_dataset.json`; báo cáo `eval/reports/{chat_answers_20261112_153018, chat_answers_20261112_155422}.{md,json}`, `rag_20261112_151714.md`, `calibration_20261112_151704.md`; tài liệu `docs/AI/{AI_ARCHITECTURE, RAG_PIPELINE, ACTION_LIFECYCLE, PERMISSION_MATRIX, TESTING_STRATEGY, SMARTBOOK_AI_REMEDIATION_REPORT}.md`.

**Xóa:** không có file nào. Trong `main.py`: `_filter_tool_args` (thay bằng `ai_core.tools`), import `inspect` không còn dùng; prompt chatbot chuyển sang `ai_core/prompts.py` (nội dung giữ nguyên).

Không thay đổi UI/UX ngoài nhãn và thông điệp cho trạng thái mới. Không thay đổi schema DB.

## H. Rủi ro còn lại

| Rủi ro | Mức | Hướng xử lý |
|---|---|---|
| NLU xếp sai một số câu hỏi chính sách (vd hạng thẻ → tìm sách) | Trung bình | Thêm từ khóa chính sách vào bộ phân loại luật hoặc cho mọi intent tra thêm FAQ khi kết quả nghiệp vụ rỗng; đo bằng `eval_chat_answers.py` |
| Câu hỏi nửa có nửa không bị từ chối cả câu khi truy xuất `NO_EVIDENCE` | Trung bình | Tách câu hỏi nhiều ý trước khi truy xuất |
| Mô hình đôi khi khẳng định phủ định ("không thể … qua SMS") | Thấp–Trung bình | Kiểm tra hậu kỳ cụm phủ định khi kết quả `UNCERTAIN` |
| OpenRouter 429 làm chatbot mất stream | Trung bình (vận hành) | Retry stream một lần có backoff, hoặc nâng hạn mức API key |
| Rate limit và cache trong bộ nhớ, một process | Thấp (cấu hình hiện tại 1 instance) | Chuyển sang Redis (đã có trong stack) khi chạy nhiều instance |
| `GATEWAY_TRUSTED_PROXY_HOPS=1` mà không có proxy biên (dev) → XFF client được tin | Thấp (giống bộ giới hạn hiện có của gateway) | Đặt `0` khi gateway nhận trực tiếp Internet |
| Đề xuất nhập và staff task không idempotent ở inventory-service | Trung bình | Đã chặn trùng bằng `RECONCILE_REQUIRED`; triệt để cần inventory-service đọc `Idempotency-Key` (cần migration) |
| Executor ghi vào inventory chưa kiểm trực tiếp trong đợt này | Thấp | Kiểm thủ công một lần trên môi trường demo |
| Recall truy xuất sách thấp (R@5 ≈ 0,21) | Trung bình (có từ trước) | Ngoài phạm vi đợt này |
| Lịch sử chatbot ở client | Thấp | Lưu phía server khi cần |

## I. Triển khai

- **Biến môi trường mới (đều có mặc định, không bắt buộc):** ai-service `ACTION_STALE_CONFIRMED_SECONDS=900`, `TOOL_TOTAL_TIMEOUT_SECONDS=30`, `TRUST_GATEWAY_CLIENT_IP=true`, `INTERNAL_DOC_DIR` (mặc định `corpus/` trong image); api-gateway `GATEWAY_TRUSTED_PROXY_HOPS=1`.
- **Database:** không có migration. Trạng thái mới `RECONCILE_REQUIRED` (18 ký tự) vừa cột `status VARCHAR(32)`, không có CHECK constraint.
- **Redis/service mới:** không.
- **Docker:** build lại `ai-service` và `api-gateway`. Ở máy này đã build từ context chỉ gồm file git theo dõi vì `services/ai-service/.dockerignore` không loại `.venv` (nhiều GB).
- **Thứ tự deploy:** ai-service trước hoặc cùng lúc gateway (gateway mới chỉ thêm header; ai-service mới vẫn chạy được với gateway cũ — người ẩn danh khi đó tính theo IP gateway như trước).
- **Rollback:** trên máy demo có các tag `smartbook-system-api-gateway-pre-ai-remediation:latest`, `smartbook-system-ai-service:pre-corpus-expansion`; trạng thái mã nguồn trước đợt này là commit `03c9119` — build lại từ commit đó. Action đã ở `RECONCILE_REQUIRED` vẫn đọc được bằng code cũ (chỉ hiện chuỗi trạng thái thô).
