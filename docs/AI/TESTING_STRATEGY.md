# Chiến lược kiểm thử AI

> Cập nhật 2026-11-12. Mọi test dưới đây đều có trong repo và đã chạy; số liệu kết quả nằm trong `docs/AI/SMARTBOOK_AI_REMEDIATION_REPORT.md`.

## Nguyên tắc

- **Giả lập ở biên, không giả lập nghiệp vụ.** Test vòng đời action chạy handler `/actions/confirm`, `agent_store`, `action_guard` và `agent_executor` thật; chỉ thay danh tính (auth-service), DB (SQLite trong bộ nhớ) và service đích (httpx `MockTransport` ghi lại đúng request đã gửi).
- **Fixture quyền theo dữ liệu thật.** Quyền của từng role trong test lấy từ `auth_db` (`role_permissions`), không tự đặt cho dễ qua.
- **Truy xuất ≠ câu trả lời.** `eval_rag.py` đo việc tìm đúng tài liệu; `eval_chat_answers.py` đo câu trả lời cuối qua chatbot thật.
- **Không báo số liệu chưa chạy.** Eval trực tiếp (LLM, embedding) ghi báo cáo vào `services/ai-service/eval/reports/`.

## Các tầng

| Tầng | File | Chạy bằng | Phụ thuộc ngoài |
|---|---|---|---|
| Unit — vòng đời, quyền, phạm vi kho, độ tin cậy, tool registry, rate limit, prompt | `test_action_lifecycle.py`, `test_permission_matrix.py`, `test_warehouse_scope.py`, `test_retrieval_confidence.py`, `test_ai_core.py`, `test_calibrate_rag.py`, `test_eval_chat_answers.py`, `test_agent_store.py` | `pnpm test:ai` (CI: `pnpm verify`) | không |
| Integration trong service — đặt chỗ, xác nhận/hủy, hội thoại, truy xuất, dữ liệu hiện hành, đồng bộ corpus | `test_reservation_actions.py`, `test_action_lifecycle.py`, `test_assistant_conversation_access.py`, `test_retrieval.py`, `test_ingestion.py`, `test_chat_pipeline.py` | như trên | không |
| Integration với Postgres + pgvector | `test_agent_store_pg.py`, `test_pgvector_store.py` | CI job `ai-postgres` | Postgres (bị bỏ qua khi không có `DATABASE_URL`) |
| Bảo mật | `test_copilot_security.py`, `test_permission_matrix.py`, `test_action_lifecycle.py`, `test_reservation_actions.py`, `test_ai_core.py`, `apps/api-gateway/test/gateway-contract.test.js` | như trên + `pnpm --filter api-gateway test` | không |
| Đồng thời / tải trong tiến trình | `test_concurrency.py` (40 yêu cầu một user, 200 yêu cầu 20 user, 50 stream song song) | `pnpm test:ai` | không (model giả) |
| E2E giao diện | `apps/web/e2e/ai-chat-streaming.spec.ts`, `ai-copilot-decision.spec.ts`, `ai-copilot-visualization.spec.ts` | Playwright với stack đang chạy | gateway (đăng nhập) |
| Eval trực tiếp — truy xuất | `eval/eval_rag.py`, `eval/calibrate_rag.py` | trong container ai-service | OpenRouter embedding, pgvector |
| Eval trực tiếp — câu trả lời | `eval/eval_chat_answers.py` (32 câu, 8 nhóm) | `python eval/eval_chat_answers.py --password <demo>` | stack + OpenRouter |
| Đo độ trễ trực tiếp | `eval/measure_assistant_latency.py` | như trên | stack + OpenRouter |

## Kịch bản bắt buộc trước khi sửa phần AI

1. `pnpm test:ai` — toàn bộ test ai-service.
2. `pnpm --filter api-gateway test` khi sửa gateway.
3. `pnpm --filter web test:unit` và typecheck web khi sửa giao diện.
4. Khi sửa corpus hoặc truy xuất: `eval_rag.py` (và `--abstention off --dump-signals` + `calibrate_rag.py --split=hash` nếu định đổi ngưỡng). `calibrate_rag.py` không bao giờ tự đổi ngưỡng production; `NO_VALID_CANDIDATE` nghĩa là giữ nguyên.
5. Khi sửa prompt hoặc quy tắc grounding: `eval_chat_answers.py`; `/health` cho biết phiên bản prompt đang chạy.

## Những gì chưa được test tự động

- Thực thi action thật vào inventory-service (đề xuất nhập, cảnh báo, staff task) trong CI: chỉ kiểm bằng MockTransport. Đặt chỗ đã được kiểm trực tiếp một lần với borrow-service (xem báo cáo).
- Ngắt kết nối giữa chừng ở mức mạng thật cho SSE.
- Nhiều instance ai-service chạy song song.
