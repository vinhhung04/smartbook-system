# AI Inventory Rebalancing — Chatbox Test Report

Ngày chạy: 20/11/2026, stack dev cục bộ (Docker), analytics-service và ai-service build lại từ nhánh `hungg` (ảnh cũ giữ tag `:pre-rebalancing`), web Vite dev :5174, LLM thật theo cấu hình hiện có. Fixture: `pnpm demo:rebalancing:seed`.

## 1. Chatbox E2E — 7 câu demo qua giao diện thật

| Test | Lệnh | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| `e2e/ai-rebalancing-demo.spec.ts` lần 1 | `BASE_URL=http://localhost:5174 PLAYWRIGHT_CHANNEL=chrome npx playwright test e2e/ai-rebalancing-demo.spec.ts` | 7 bước, mỗi bước hiện đúng thẻ, bước 7 trả mã TO/PR thật | 1 passed (1,3 phút) | PASS |
| Lần 2 (reset + seed lại, chạy lại) | `pnpm test:e2e:ai-rebalancing-demo` (cùng biến môi trường) | Lặp lại được | 1 passed (1,4 phút) | PASS |

Không có route nào bị stub: câu hỏi đi qua gateway → ai-service → analytics / inventory thật.

Các khẳng định của spec theo bước:

| Bước | Khẳng định |
|---|---|
| 1 | Thẻ Chẩn đoán hiện, Hà Nội gắn nhãn "Chỉ xem", timeline có bước "done" |
| 2 | Thẻ Cơ hội điều chuyển có dòng "Cần Manager kho nguồn" |
| 3 | Bảng có TRANSFER_ONLY, PROCUREMENT_ONLY, HYBRID và nhãn "tốt nhất về nghiệp vụ" |
| 4 | Thẻ Ngân sách có "15.000.000 ₫" |
| 5 | Thẻ So sánh kịch bản có 15.000.000 ₫ và 12.000.000 ₫ |
| 6 | Thẻ bản nháp "Bản nháp điều chuyển và mua mới"; xem trước có "Chỉ đề xuất — cần Manager khác" |
| 7 | Thẻ Kết quả: trạng thái EXECUTED, mã bắt đầu TO- / PR-, có mục "Cần Manager khác xử lý" |

## 2. Cùng 7 câu qua API Copilot (`POST /ai/assistant`), lần chạy 2

| Bước | Thời gian | Tool + tham số (planner) | Focus | Kiểm chứng | Kết quả chính |
|---|---|---|---|---|---|
| 1 | 17,1 s | `analyze_inventory_rebalancing {}` | SURPLUS, SHORTAGE, DEMAND, DIAGNOSIS | PASSED | HCM thiếu 5 đầu sách / 62 bản |
| 2 | 9,6 s | `{destination: Kho HCM Chinh}` | TRANSFER_QUANTITY, TRANSFER_OPPORTUNITY | PASSED | Nêu từng dòng, số an toàn, quyền |
| 3 | 16,5 s | như trên | DECISION_COMPARISON, HYBRID_DECISION, … | PASSED | best HYBRID, executable HYBRID_EXECUTABLE |
| 4 | 13,0 s | `+ budget 15.000.000` | BUDGET_OPTIMIZATION | PASSED | Còn 10.527.000 ₫ |
| 5 | 13,4 s | 2 lần gọi: 15 tr và 12 tr | WHAT_IF, BUDGET, DEMAND | PASSED | "giảm 3.000.000 ₫" đúng chiều |
| 6 | 4,4 s | `+ budget 15.000.000` (kịch bản #3 khôi phục) | CREATE_DRAFT, … | PASSED | Pending CREATE_REBALANCE_DRAFT, câu trả lời dựng từ bản nháp |
| 7 | 2,3 s | (không gọi tool đọc) | CONFIRM_ACTION | — | EXECUTED: 1 TO + 4 PR |

Lần chạy 1 (trước khi sửa) phát hiện và đã sửa: bước 2 lặp lại câu trả lời bước 1; bước 5 LLM viết sai chiều ("tăng" thay vì "giảm"); bước 6 LLM mô tả số của HYBRID thay vì bản nháp; bước 1 truyền cả ba kho làm kho đích. Cách sửa: hướng dẫn theo focus, chênh lệch do code tính sẵn chiều, câu trả lời bản nháp dựng từ chính bản nháp, "tất cả các kho" không thành danh sách kho đích.

## 3. Kiểm tra giao diện

Ảnh chụp Playwright (sáng / tối × 1440 / 390) của hội thoại mở lại từ lịch sử: thẻ Chẩn đoán, Cơ hội điều chuyển, So sánh phương án, So sánh kịch bản, Kết quả thực hiện hiển thị đúng. Đã sửa: tên sách trong thẻ điều chuyển bị cắt ("C."), số tiền trong bảng phương án xuống dòng, nhãn quyền xuống dòng trên điện thoại. Bảng phương án cuộn ngang trên điện thoại, trang không cuộn ngang.

## 4. Hồi quy e2e

| Test | Kết quả |
|---|---|
| `ai-chat-streaming.spec.ts` (3) | PASS |
| `ai-copilot-decision.spec.ts` (4) | PASS |
| `ai-copilot-visualization.spec.ts` (8) | PASS |
| `reorder-budget.spec.ts` (1) | PASS |
| `warehouse-transfer-lifecycle.spec.ts` | **Không chạy**: spec tự từ chối ngoài stack cô lập (`pnpm test:stack e2e`) |

## 5. Chưa kiểm thử

- Nhánh semantic planner LLM với các câu ngoài bộ dữ liệu (chỉ có hành vi end-to-end của 7 câu demo).
- Ứng dụng di động và widget chat nổi (`ai-chatbot.tsx`) không hiển thị thẻ rebalancing; chỉ trang `/ai-assistant` được nâng cấp.
- Vòng đời transfer sau REQUESTED (duyệt, lấy hàng, nhận hàng) không chạy trong demo vì là bước của người duyệt.
