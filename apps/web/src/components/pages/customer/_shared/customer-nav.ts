import {
  BarChart3, BookOpen, CalendarClock, Bell, HandCoins, Heart, House, LifeBuoy, ReceiptText,
  ScanSearch, ShieldCheck, Sparkles, User, type LucideIcon,
} from 'lucide-react';

export interface CustomerNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Everyday destinations: shown in the top bar on desktop and the bottom tab bar on phones. */
export const PRIMARY_NAV: CustomerNavItem[] = [
  { to: '/customer', label: 'Tổng quan', icon: House, end: true },
  { to: '/customer/books', label: 'Danh mục', icon: BookOpen },
  { to: '/customer/loans', label: 'Phiếu mượn', icon: HandCoins },
  { to: '/customer/reservations', label: 'Đặt trước', icon: CalendarClock },
  { to: '/customer/wishlist', label: 'Yêu thích', icon: Heart },
];

/** Ways to find something to read. */
export const DISCOVER_NAV: CustomerNavItem[] = [
  { to: '/customer/recommendations', label: 'Gợi ý cho bạn', icon: Sparkles },
  { to: '/customer/scan-cover', label: 'Tìm bằng ảnh bìa', icon: ScanSearch },
  { to: '/customer/reading-analytics', label: 'Thống kê đọc sách', icon: BarChart3 },
];

/** Account pages, reached from the avatar menu (desktop) or the "Thêm" sheet (phone). */
export const ACCOUNT_NAV: CustomerNavItem[] = [
  { to: '/customer/fines', label: 'Tiền phạt', icon: ReceiptText },
  { to: '/customer/membership', label: 'Hội viên', icon: ShieldCheck },
  { to: '/customer/notifications', label: 'Thông báo', icon: Bell },
  { to: '/customer/profile', label: 'Hồ sơ của tôi', icon: User },
  { to: '/customer/support', label: 'Hỗ trợ & Liên hệ', icon: LifeBuoy },
];
