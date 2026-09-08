import type { Conversation, Message, StaffMember } from './types';

// Design-preview data only. Shaped to match the messaging-service API contract
// (see spec) so `use-messaging.ts` can swap this for real fetch/socket calls later
// without the components changing.

export const CURRENT_USER_ID = 'u-hung';

export const STAFF_DIRECTORY: StaffMember[] = [
  { id: 'u-hung', full_name: 'Nguyễn Việt Hùng', role: 'ADMIN', online: true },
  { id: 'u-quan', full_name: 'Trần Minh Quân', role: 'WAREHOUSE_MANAGER', online: true },
  { id: 'u-hoa', full_name: 'Lê Thị Hoa', role: 'WAREHOUSE_STAFF', online: true },
  { id: 'u-duc', full_name: 'Phạm Văn Đức', role: 'WAREHOUSE_STAFF', online: true },
  { id: 'u-tu', full_name: 'Đỗ Anh Tú', role: 'WAREHOUSE_STAFF', online: false },
  { id: 'u-ngoc', full_name: 'Vũ Thị Ngọc', role: 'LIBRARIAN', online: false },
  { id: 'u-trang', full_name: 'Bùi Thu Trang', role: 'LIBRARIAN', online: true },
];

// Anchored to load time (not a fixed date) so the relative-time labels in the
// preview always read as "just happened" regardless of when this is viewed.
const now = new Date();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const lastOf = <T,>(arr: T[]): T | null => (arr.length ? arr[arr.length - 1] : null);

export const MOCK_MESSAGES: Record<string, Message[]> = {
  'c-quan': [
    { id: 'm1', conversation_id: 'c-quan', sender_id: 'u-quan', content: 'Chào anh, kho A vừa nhận lô sách giáo khoa lớp 1 Chân trời sáng tạo, 40 thùng.', created_at: minsAgo(38) },
    { id: 'm2', conversation_id: 'c-quan', sender_id: 'u-hung', content: 'Ok, đã kiểm đếm đối chiếu với phiếu nhập chưa?', created_at: minsAgo(35) },
    { id: 'm3', conversation_id: 'c-quan', sender_id: 'u-quan', content: 'Đang cho Đức với Tú kiểm, dự kiến xong trong chiều nay.', created_at: minsAgo(30) },
    { id: 'm4', conversation_id: 'c-quan', sender_id: 'u-quan', content: 'Có 1 thùng bị móp góc, em chụp ảnh gửi anh xem có cần lập báo cáo sự cố không.', created_at: minsAgo(6) },
    { id: 'm5', conversation_id: 'c-quan', sender_id: 'u-quan', content: 'Sách bên trong vẫn nguyên vẹn, chỉ vỏ thùng móp thôi ạ.', created_at: minsAgo(5) },
  ],
  'c-kho-a': [
    { id: 'm6', conversation_id: 'c-kho-a', sender_id: 'u-hoa', content: 'Cả nhà ơi, pallet số 12 bị lệch mã vạch so với hệ thống.', created_at: minsAgo(52) },
    { id: 'm7', conversation_id: 'c-kho-a', sender_id: 'u-quan', content: 'Hoa kiểm lại giúp anh mã trên kệ D3-12 nhé, hôm qua có điều chuyển.', created_at: minsAgo(49) },
    { id: 'm8', conversation_id: 'c-kho-a', sender_id: 'u-hoa', content: 'Dạ để em qua kiểm tra trực tiếp.', created_at: minsAgo(47) },
    { id: 'm9', conversation_id: 'c-kho-a', sender_id: 'u-duc', content: 'Em xong khu vực picking đơn PO-2208 rồi, có việc gì làm tiếp không ạ?', created_at: minsAgo(15) },
    { id: 'm10', conversation_id: 'c-kho-a', sender_id: 'u-hung', content: 'Đức qua hỗ trợ Hoa kiểm pallet 12 giúp anh.', created_at: minsAgo(12) },
  ],
  'c-ngoc': [
    { id: 'm11', conversation_id: 'c-ngoc', sender_id: 'u-hung', content: 'Chị Ngọc, độc giả Nguyễn Văn A quá hạn trả sách 5 ngày rồi, đã gọi nhắc chưa?', created_at: minsAgo(180) },
    { id: 'm12', conversation_id: 'c-ngoc', sender_id: 'u-ngoc', content: 'Em gọi rồi anh, bạn ấy hẹn mai qua trả và nộp phạt luôn.', created_at: minsAgo(175) },
    { id: 'm13', conversation_id: 'c-ngoc', sender_id: 'u-hung', content: 'Ok cảm ơn chị.', created_at: minsAgo(174) },
  ],
  'c-thuthu': [
    { id: 'm14', conversation_id: 'c-thuthu', sender_id: 'u-trang', content: 'Danh sách quá hạn tuần này em gửi vào nhóm, 12 độc giả.', created_at: minsAgo(4200) },
    { id: 'm15', conversation_id: 'c-thuthu', sender_id: 'u-ngoc', content: 'Em xử lý phần nhắc qua email trước, phần gọi điện Trang hỗ trợ giúp nhé.', created_at: minsAgo(4190) },
  ],
};

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'c-quan',
    type: 'DIRECT',
    name: null,
    member_ids: ['u-hung', 'u-quan'],
    last_message: lastOf(MOCK_MESSAGES['c-quan']),
    unread_count: 2,
    last_read_message_id: { 'u-hung': 'm3', 'u-quan': 'm5' },
    updated_at: minsAgo(5),
  },
  {
    id: 'c-kho-a',
    type: 'GROUP',
    name: 'Kho A — Ca sáng',
    member_ids: ['u-hung', 'u-quan', 'u-hoa', 'u-duc', 'u-tu'],
    last_message: lastOf(MOCK_MESSAGES['c-kho-a']),
    unread_count: 0,
    last_read_message_id: { 'u-hung': 'm10' },
    updated_at: minsAgo(12),
  },
  {
    id: 'c-ngoc',
    type: 'DIRECT',
    name: null,
    member_ids: ['u-hung', 'u-ngoc'],
    last_message: lastOf(MOCK_MESSAGES['c-ngoc']),
    unread_count: 0,
    last_read_message_id: { 'u-hung': 'm13', 'u-ngoc': 'm13' },
    updated_at: minsAgo(174),
  },
  {
    id: 'c-thuthu',
    type: 'GROUP',
    name: 'Thủ thư — Xử lý quá hạn',
    member_ids: ['u-hung', 'u-ngoc', 'u-trang'],
    last_message: lastOf(MOCK_MESSAGES['c-thuthu']),
    unread_count: 0,
    last_read_message_id: { 'u-hung': 'm15' },
    updated_at: minsAgo(4190),
  },
];

// c-kho-a: Đức is mid-typing when the preview loads, to show the typing-indicator state.
export const MOCK_TYPING: Record<string, string[]> = {
  'c-kho-a': ['u-duc'],
};
