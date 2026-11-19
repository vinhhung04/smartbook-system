# /dashboard: bản trình diễn cho buổi bảo vệ (hướng A)

Ngày: 2026-11-19 · Nhánh: `hungg`

## Mục đích

Trang `/dashboard` là màn hình đầu tiên hội đồng nhìn thấy khi demo. Trang phải gây ấn tượng nhờ **AI và dữ liệu sống**, hiệu ứng chỉ là lớp hoàn thiện. Trang vẫn phải dùng được hằng ngày cho admin / quản lý và giữ cùng phong cách với các trang đã thiết kế lại (xem tracker).

- **Mục tiêu:** khoe được mô hình dự báo rủi ro; số liệu "sống" (chạy số, dòng hoạt động realtime); hết các khối trống (top sách 1 cuốn, biểu đồ gai nhọn).
- **Không làm:** backend mới; nền WebGL, thêm thư viện (`ogl`, …); đổi logic tải dữ liệu, quyền, realtime hiện có.
- **Thất bại nếu:** trang lệch hẳn phong cách các trang khác; hiệu ứng làm giật hoặc làm số hiển thị sai; khối mới hiện số liệu không có thật; vai trò không có quyền xem mượn trả (`manager01`) thấy khối lỗi hoặc trống.

## Các hướng đã cân nhắc

| Hướng | Đánh đổi | Kết quả |
|---|---|---|
| A. Bảng điều hành, hiệu ứng tiết chế + khối AI / hoạt động / chọn kỳ | Ấn tượng nhờ nội dung, đồng bộ hệ thống | **Chọn** |
| B. Showcase WebGL (Aurora/Particles), bento | Lóa nhất, thêm `ogl`, dễ giật, lệch phong cách | Bỏ |
| C. Chỉ đồng bộ phong cách + CountUp | Ít công, ít điểm nhấn, không khai thác AI | Bỏ |

## Thiết kế

### 1. Đầu trang
`PageHeader` dùng chung (Fraunces) thay cho h1 tự viết; lede giữ nguyên câu "x đầu việc đang mở…" (`headerFinding`). Các nút Làm mới / Báo cáo, banner "Có thay đổi mới", lỗi làm mới giữ nguyên.

### 2. Hiệu ứng (phỏng theo React Bits, không chép nguyên file)
React Bits (`DavidHDev/react-bits`, MIT + Commons Clause, 52k sao, cập nhật 2026-11-16) có bản TS-Tailwind của `CountUp` (497 dòng), `SpotlightCard` (340), `AnimatedList` (641). Các bản này quá lớn so với nhu cầu, nên mỗi cái được viết lại gọn bằng `motion` (đã cài), có ghi nguồn trong comment:

- `CountUp`: số KPI chạy từ 0 khi tải lần đầu (`animate` của motion, ~0,8 s). Định dạng bằng `formatNumber` sẵn có, số cuối luôn đúng. Không chạy lại khi làm mới.
- `SpotlightCard`: vầng sáng `radial-gradient` màu primary nhạt bám theo chuột trên các ô KPI "Tình hình thư viện". Chỉ dùng CSS variable và `pointermove`.
- `AnimatedList`: mục mới trượt vào đầu dòng hoạt động (`AnimatePresence` + `layout`).
- Mọi hiệu ứng tắt khi `prefers-reduced-motion`.

### 3. Khối mới "AI dự báo rủi ro"
- **Dữ liệu:** `getLateReturnRisk({ limit: 5 })` và `getReservationNoShowRisk({ limit: 5 })`, gọi cùng lúc với các khối khác (`fetchDashboard`), chỉ khi có `analytics.borrow.read`.
- **Hiển thị:** hai cột (trả trễ / bỏ đặt trước). Mỗi dòng gồm độc giả, sách, điểm rủi ro (thanh đo), mức rủi ro và yếu tố ảnh hưởng mạnh nhất. Dưới khối ghi "Mô hình hồi quy logistic · huấn luyện lúc … trên N mẫu · AUC …" (từ `model` / `evaluation`).
- **Tái dùng:** nhãn yếu tố `factorLabels` đang nằm trong `reorder-suggestions.tsx`; chuyển hai config `LATE_RETURN` / `NO_SHOW` ra một file dùng chung để hai trang cùng import.
- **Liên kết:** "Xem phân tích đầy đủ" mở `/reorder-suggestions?tab=late-return|no-show`. Trang đó thêm đọc `?tab=` làm tab ban đầu (1 dòng).
- **Trạng thái:** `INSUFFICIENT_DATA` hiện câu giải thích; lỗi hiện nút thử lại như các khối khác.

### 4. Khối mới "Hoạt động trực tiếp"
- **Ban đầu:** 8 bản ghi mới nhất từ `GET /borrow/audit-logs?limit=8`, đặt ở cột phải cạnh "Việc cần xử lý". Nhãn hành động lấy từ `ACTION_LABELS` của `/audit-trail` (chuyển sang file dùng chung). Kèm thời gian tương đối (`timeAgo` sẵn có).
- **Realtime:** mỗi sự kiện từ `useBorrowRealtime` / `useInventoryRealtime` (đang có) chèn một dòng lên đầu (giữ tối đa 8) với nhãn theo nguồn, ví dụ "Phiếu mượn vừa thay đổi". Banner "Có thay đổi mới" vẫn giữ.
- **Quyền:** chỉ hiện với người có quyền xem mượn trả. Khi demo, thao tác mượn/trả ở tab khác sẽ thấy dòng trượt vào.

### 5. Chọn kỳ cho phân tích
- `SegmentedControl` (sẵn có): 30 ngày / 90 ngày / 12 tháng. (Ban đầu là "Toàn bộ" thay cho 90 ngày; đã bỏ vì API trả hơn 300 tháng trống kể từ năm 2000.)
- Kỳ chỉ áp cho biểu đồ mượn trả (`granularity` day/month, `from`) và top sách (`from`). Đổi kỳ chỉ tải lại hai khối này. Mặc định 12 tháng (đổi từ 30 ngày khi làm: dữ liệu ngày ở dev thưa, 12 tháng là bức tranh đầy đủ nhất cho buổi demo).
- Biểu đồ đổi sang vùng (`AreaChart` của recharts, `type="monotone"`) với gradient nhạt theo màu hiện có.

### 6. Giữ nguyên
Toàn bộ logic `fetchDashboard`, `buildDecisionItems`, quyền, chuyển hướng `WAREHOUSE_STAFF`, các khối rủi ro tồn kho / quá hạn / đặt trước / tiền phạt (chỉ chỉnh trình bày nếu cần cho bố cục mới).

## Kiểm tra
Theo memory `redesign-verify-backend`:
- diff phần state/handler;
- `fullhd-layout` và `redesign-backend-smoke` trên :5174, xem với `hung` (admin) và `manager01` (không có quyền mượn trả);
- tsc, eslint, unit, build;
- chụp màn hình 1440, phiên bản điện thoại và reduced-motion.

## Để người làm tự quyết
Khoảng cách, thứ tự lưới chi tiết ở 1440 / điện thoại, câu chữ phụ, thời lượng hiệu ứng.
