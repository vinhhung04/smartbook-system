# Phase F — Tham chiếu thiết kế (UI/UX AI)

> Ngày 2026-11-13. Theo CLAUDE.md §5. **Ghi chú trung thực:** phần tra cứu GitHub/web được làm **sau** khi đã dựng
> giao diện (dùng để đối chiếu, không phải nguồn sao chép). Không sao chép mã từ dự án nào; chỉ so sánh mẫu tương tác.

## 1. Nguồn đã xem

| Nguồn | Nội dung liên quan | Bảo trì / giấy phép | Ghi chú |
|---|---|---|---|
| Vercel template “Multi-modal chatbot” → repo `vercel-labs/ai-sdk-preview-attachments` ([trang template](https://vercel.com/templates/ai/multi-modal-chatbot)) | Chat gửi kèm ảnh: chọn file, xem trước, gửi cùng tin nhắn | Template chính thức của Vercel; **giấy phép chưa xác nhận** (trang chỉ có liên kết “View License”) | Chỉ tham khảo mẫu tương tác “chọn ảnh → preview → gửi” |
| LibreChat ([github.com/danny-avila/librechat](https://github.com/danny-avila/librechat)) | Trích dẫn nguồn trong câu trả lời (`getCitations.js`, xem qua bản mirror cũ trên Hugging Face) | Dự án đang hoạt động; giấy phép không kiểm tra lại trong lần tra này | Trích dẫn dạng liên kết/markdown, chủ yếu cho tìm web |
| Open WebUI (changelog 0.4.3, [mirror changelog](https://fatihky.github.io/clhub/pypi/open-webui/0.4.3)) | Trích dẫn nội dòng cho kết quả RAG | Đang hoạt động | Không xác nhận được “source panel” từ kết quả tra cứu |
| Mã có sẵn trong repo | `ai-assistant/conversation-sidebar.tsx` đã ghi chú theo mẫu Vercel ai-chatbot / LibreChat / Open WebUI; `ai-copilot-*` đã có panel “Vì sao AI đưa ra nhận định này?” | — | Ưu tiên tái sử dụng ngôn ngữ thiết kế hiện có |

## 2. Rút ra và áp dụng cho SmartBook

| Mẫu | Áp dụng | Lý do |
|---|---|---|
| Đính kèm ảnh: nút trong composer → xem trước → gửi kèm câu hỏi | `ai-experience/photo-composer.tsx`, dùng chung cho chatbot nổi và trang Decision Assistant | Quen thuộc với người dùng chat hiện đại |
| Trích dẫn nội dòng (Open WebUI) | **Không** chèn số trích dẫn vào văn bản; dùng panel thu gọn “Vì sao AI đưa ra kết quả này?” | Chatbot nổi chỉ rộng 400 px; câu trả lời ngắn phải giữ ngắn (yêu cầu §8.2.E) |
| Trích dẫn = liên kết (LibreChat) | Mỗi nhận định liên kết tới **bằng chứng có kiểm chứng** (verdict + nguồn + thời điểm + đoạn tài liệu) | Yêu cầu F4: trích dẫn tồn tại không đồng nghĩa nội dung đúng |
| Tiến trình xử lý | Chỉ hiện các giai đoạn backend thực sự báo (SSE `status`: nhận ảnh, đọc chữ, so khớp ảnh, tải danh mục, đối chiếu) | Yêu cầu §6.6: không tạo tiến trình giả |
| Thông báo xử lý ảnh ngoài | Hộp thoại xác nhận một lần trước khi chọn ảnh; backend từ chối (428) nếu thiếu xác nhận | Quyền riêng tư (§6.3) |

## 3. Bị loại

- Kéo-thả nhiều file, ghi âm, tìm web: API không hỗ trợ; ngoài phạm vi.
- Hiển thị “độ tin cậy %” cho nhận diện ảnh: điểm tương đồng không được hiệu chỉnh thành xác suất (§6.4, §7.7).
- Vòng 1 không thêm `expo-image-picker`; vòng 2 đã thêm (gói Expo chính chủ, `~58.0.10`, theo tài liệu Expo SDK 58) để chọn ảnh có sẵn — mở thư viện không cần xin quyền, phải bắt đầu từ thao tác của người dùng.

## 4. Accessibility (skill `accessibility` của repo)

Nút chỉ có biểu tượng đều có `aria-label`; ảnh có `alt`; tiến trình dùng `aria-live="polite"`; lỗi dùng `role="alert"`;
panel giải thích dùng nút `aria-expanded`; animation tắt khi `prefers-reduced-motion`; vùng chạm ≥ 24 px (mobile ≥ 44 px).
Kiểm tra bằng Playwright ở bề rộng 390 px: không tràn ngang.
