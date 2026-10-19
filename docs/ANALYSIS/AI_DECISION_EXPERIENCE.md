# SmartBook — Trải nghiệm ra quyết định với AI Copilot (Phase 6, 2026-10-18/19)

Ký hiệu: **[ĐO]** đã chạy trên stack thật với LLM thật · **[E2E-UI]** Playwright với API giả lập · **[UNIT]** test tự động.
**Không có điểm khảo sát người dùng nào trong tài liệu này** — chưa làm nghiên cứu người dùng (mục 7).

Tài liệu liên quan: [REORDER_OPTIMIZATION_EVALUATION.md](REORDER_OPTIMIZATION_EVALUATION.md) (thuật toán phân bổ ngân sách),
[AI_COPILOT_3_3_EVALUATION.md](AI_COPILOT_3_3_EVALUATION.md) (bộ xác minh), [SECURITY_COMPLETION.md](SECURITY_COMPLETION.md).

---

## 1. Nguyên tắc

1. **Mọi con số và mọi xếp hạng do backend tính.** LLM chỉ diễn đạt; phương án, ưu/nhược, "ít rủi ro nhất", chi phí cho từng mức
   phục vụ đều do analytics và `copilot_decision.py` tính từ dữ liệu.
2. **Khuyến nghị luôn có điều kiện** ("nếu ưu tiên… thì…; nếu ưu tiên… thì…"). SmartBook không có hàm mục tiêu chung nên
   không gọi phương án nào là "tối ưu"; bộ xác minh vẫn bắt chữ "tối ưu" trong câu trả lời.
3. **Không tự tạo hay duyệt phiếu nhập.** Nút trên thẻ quyết định chỉ gửi yêu cầu lập *bản nháp*; bản nháp là một AI Action
   `PENDING_CONFIRMATION` mà người dùng phải bấm xác nhận (và qua kiểm tra quyền + phạm vi kho ở bước xác nhận — Phase 5).
4. **Câu hỏi đơn giản giữ câu trả lời đơn giản** — chỉ câu hỏi quyết định / what-if về ngân sách nhập mới có thẻ quyết định.

## 2. Phản hồi quyết định có cấu trúc (`services/ai-service/copilot_decision.py`)

Trường `decision` (tùy chọn, bổ sung, cả `/assistant` và `/assistant/stream`):

| Phần | Nguồn |
|---|---|
| `conclusion` | câu tất định từ phương án đầu |
| `data_points` | nhu cầu đầy đủ, nhu cầu theo tồn dự kiến, số đầu sách cần xem xét, chi phí tối thiểu cho 95 %/99 % mức phục vụ |
| `options[]` | mỗi kịch bản: chi phí duyệt, đầu sách / bản, **mức đáp ứng** (`expected_service_pct`), ưu tiên cao bị bỏ lại, ưu/nhược tất định, `kind` = `choice` hoặc `condition` |
| `risks`, `assumptions` | từ dữ liệu (đầu sách ưu tiên cao bị bỏ lại, giao chậm, dòng ngoài danh sách) và giả định của mô hình |
| `recommendation` | có điều kiện; chỉ xếp hạng các `choice` — một kịch bản *giao chậm* là điều kiện bên ngoài, chỉ báo tác động |
| `evidence` | nguồn + thời điểm đọc |
| `verification` | trạng thái kiểm tra của câu trả lời (PASSED / REPAIRED / WARNING / BLOCKED) |
| `next_step` | chỉ khi `safe_to_act` và ngân sách không phải giả định: "Lập phiếu đề xuất nhập nháp với ngân sách X" |

"Mức đáp ứng" = phần nhu cầu dự kiến trong thời gian chờ hàng mà các bản được duyệt phục vụ, so với toàn bộ kế hoạch (mô
hình Poisson của analytics) — một ước lượng, ghi rõ trong `assumptions`.

## 3. Mô phỏng what-if do backend tính

| Câu hỏi | Tính ở đâu | Cách tính |
|---|---|---|
| "Nếu ngân sách giảm 20 %" | analytics `?budgetVnd=` | ngân sách của **lượt trước** × 0,8 (lỗi Phase 3 mt-08#1 — trước đây −20 % áp lên toàn bộ nhu cầu) |
| "Nếu nhà cung cấp giao chậm thêm 7 ngày" | analytics `?leadTimeDelayDays=7` (mới) | cộng vào thời gian chờ **của từng dòng**; so cùng ngân sách |
| "Nếu ưu tiên kho Hà Nội" | analytics `?priorityWarehouseId=` (mới, cần quyền đọc kho đó — ngoài phạm vi → 403) | dòng hết/dưới ngưỡng ở kho đó được cấp vốn trước, phần còn lại theo phân bổ biên |
| "Chỉ nhập sách ưu tiên cao" | `priority=HIGH` | lọc danh sách |
| "Giảm chi phí mà vẫn giữ mức phục vụ" | `budget.service_curve` (mới) | đường chi phí ↔ mức phục vụ từ chính thứ tự cấp vốn biên; ngân sách tối thiểu cho 99/95/90 % |
| "Phương án nào ít rủi ro hơn?" | `least_risk_scenario` | chạy lại các kịch bản lượt trước; xếp theo mức đáp ứng, hòa thì ít ưu tiên cao bị bỏ lại hơn |

Đo trên hệ thống dev (dữ liệu demo) [ĐO]: 15 triệu → 34 đầu sách / 166 bản, mức đáp ứng 91,9 %; cùng 15 triệu nhưng nhà cung
cấp chậm 7 ngày → 80,2 %; mức phục vụ 90 / 95 / 99 / 100 % cần 14,0 / 17,1 / 22,4 / 27,1 triệu (toàn bộ kế hoạch 31,8 triệu,
phần chênh là bản tồn an toàn mà mô hình Poisson coi là không cần). Thời gian phản hồi analytics 74–172 ms.

## 4. Câu hỏi nối tiếp theo ngữ cảnh (planner `copilot_plan.py`)

| Lượt sau | Hành vi |
|---|---|
| "Tại sao?" | giữ chủ đề + kỳ, chuyển sang phân tích nguyên nhân (đã có từ trước, kiểm tra lại) |
| "So với tháng trước?" | `compare_borrow_periods` với kỳ trước |
| "Nếu ngân sách còn 5 triệu?" | so 5 triệu với ngân sách lượt trước |
| "Nếu giảm 20 % …" / "nếu chậm 7 ngày" / "ưu tiên kho Hà Nội" | mang ngân sách lượt trước sang |
| "Còn kho Hà Nội?" | cùng câu hỏi cho kho mới |
| "Phương án nào ít rủi ro hơn?" / "cách nào an toàn hơn?" | chạy lại đúng các kịch bản vừa so sánh (không bị hiểu là chỉ số "rủi ro kho") |

## 5. Giao diện (`apps/web/src/components/ai-copilot-decision.tsx`)

Thẻ "Phân tích quyết định" dưới câu trả lời: nhãn trạng thái kiểm tra, kết luận, **bảng so sánh** (chi phí, đầu sách / bản,
mức đáp ứng, ưu tiên cao bị bỏ lại; nhãn "ít rủi ro nhất", "điều kiện giả định"), ưu/nhược từng phương án, khuyến nghị có
điều kiện, rủi ro, phần thu gọn "Giả định, số liệu và nguồn", và nút **Lập phiếu đề xuất nháp** (ẩn khi câu trả lời BLOCKED
hoặc ngân sách là giả định). Bảng cuộn ngang trên điện thoại, trang không tràn.

Lượt "Lập phiếu đề xuất nhập nháp với ngân sách X": planner nạp sẵn `get_reorder_suggestions(budget_vnd=X)`; **câu trả lời
tất định, không gọi LLM** (0,25 s): "…34 đầu sách / 166 bản… Bản nháp CHƯA được tạo: hãy kiểm tra… và bấm xác nhận". Trước khi
sửa, LLM tự viết "Phiếu… đã được tạo" và sai chi phí [ĐO, lần chạy trước sửa].

## 6. Kiểm thử

### 6.1 Tự động

- [UNIT] ai-service **1092 pass** (8 skip): `test_copilot_decision.py` (thẻ quyết định, khuyến nghị có điều kiện, không "tối ưu",
  nháp chỉ khi an toàn, what-if gọi đúng tham số analytics, kịch bản giao chậm là điều kiện, lượt nháp không gọi LLM trên cả hai
  endpoint), `Phase6DecisionPlannerTests`, test bộ xác minh cho các câu đúng từng bị chặn.
- [UNIT] analytics **134 pass** (trace + đường chi phí/mức phục vụ).
- [E2E-UI] Playwright `e2e/ai-copilot-decision.spec.ts` **4/4** + `ai-copilot-visualization.spec.ts` **8/8**, chạy 2 lần liên tiếp
  12/12. (Lần đầu ngay sau khi khởi động lại container UI có 1 test hình ảnh lỗi rồi tự qua khi chạy lại — ghi nhận là chập
  chờn lúc khởi động.)

### 6.2 E2E live với LLM thật [ĐO]

`node scripts/decision-experience-e2e.mjs` — manager01, 6 hội thoại / 15 lượt, kiểm tra **quyết định của backend** (tool, tham
số, kịch bản, thẻ quyết định, xếp hạng rủi ro, trạng thái kiểm tra, AI Action), không kiểm tra câu chữ:

| Lần | Kiểm tra cấu trúc | Trạng thái 15 lượt | p50 / max | Sau lần này đã sửa |
|---|---|---|---|---|
| 0 (chưa lưu file) | 12/13 | — | — | lượt lập nháp: mô hình không gọi tool → không có nháp → nạp sẵn tool |
| 1 | 13/13 | PASSED 14, BLOCKED 1 | 7,4 / 17,8 s | (không tái hiện được; thêm ghi bản nháp vào báo cáo) |
| 2 | 13/13 | PASSED 15 | 7,0 / 17,8 s | giao chậm = điều kiện; nhãn "Toàn bộ kế hoạch" |
| 3 | 13/13 | PASSED 11, WARNING 2, BLOCKED 2 | 2,9 / 16,4 s | 2 chặn oan: số dòng được liệt kê; câu so sánh hai phương án |
| 4 | 13/13 | PASSED 13, WARNING 1, BLOCKED 1 | 4,8 / 14,0 s | chặn oan: "tăng lên 59 (từ 36…)" |
| 5 | 13/13 | PASSED 13, REPAIRED 1, BLOCKED 1 | 5,5 / 16,3 s | chặn oan: "tiết kiệm khoảng 3 triệu" + "nhu cầu thực tế cao" |
| 6 | **13/13** | PASSED 11, **WARNING 4, BLOCKED 0** | 6,1 / 22,1 s | — |

Các WARNING ở lần 6 là lược bỏ câu có chữ "tối ưu", suy luận nhân quả không có dữ liệu ("mức ngân sách tối thiểu để giữ cho
một đầu sách 'nóng'…") và "toàn bộ nhu cầu" — câu còn lại vẫn hiển thị, không có AI Action. Không lượt nào tự tạo AI Action;
lượt lập nháp tạo đúng một action `PENDING_CONFIRMATION` (script hủy nó ở cuối, không bao giờ xác nhận).

**Diễn giải trung thực:** mỗi lần chạy tìm ra một cách diễn đạt mới mà quy tắc tất định chặn oan; sau 5 vòng sửa, lần 6 không
còn chặn oan, nhưng đây là **tinh chỉnh trên chính bộ câu hỏi này** (6 hội thoại), không phải đánh giá độc lập. Các sửa đổi
bộ xác minh không làm đổi số phát hiện trên dev/val của 3.3 (dev 6/15 · 0/29, val 4/14 · 0/19); trên tập test đóng băng, số
bắt được sau sửa là **4/19** (bản đóng băng 5/19) do mất một lượt bắt "đúng mục, sai lý do" (mt-08#1: OVERCLAIM trên câu trích
đúng chỉ số "100 % thiếu hụt dự kiến"; lỗi thật của lượt đó là ngữ cảnh ngân sách, nay planner đã sửa).

## 7. Giới hạn — chưa làm

1. **Chưa có nghiên cứu người dùng** (thử với quản lý kho thật, đo thời gian ra quyết định, mức hiểu, độ tin). Không có điểm
   SUS/khảo sát nào được báo cáo.
2. Đánh giá live là 6 hội thoại do người phát triển viết; bộ xác minh đã được chỉnh theo chính các lượt này.
3. "Mức đáp ứng" dựa trên mô hình Poisson và dự báo nhu cầu hiện tại; với dữ liệu demo, nhiều đầu sách ưu tiên cao có dự báo
   30 ngày = 0 nên phân bổ dồn vào vài đầu sách (xem REORDER_OPTIMIZATION_EVALUATION mục 4.1).
4. Kịch bản "ưu tiên kho" chỉ ưu tiên các dòng đang thiếu ở kho đó trong danh sách mua tập trung; chưa có ngân sách theo kho
   hay điều chuyển giữa kho.
5. Nháp lập từ thẻ quyết định chỉ mang ngân sách; kịch bản giao chậm / ưu tiên kho không được chuyển sang nháp.
6. Không có ràng buộc nhà cung cấp (MOQ, lịch giao).

## 8. Chạy lại

```bash
node scripts/decision-experience-e2e.mjs --out services/ai-service/eval/reports/phase6/decision_e2e_live_runN.json
cd apps/web && npx playwright test e2e/ai-copilot-decision.spec.ts
```
