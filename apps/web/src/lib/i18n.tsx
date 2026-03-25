import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Locale = 'vi' | 'en';

const translations: Record<Locale, Record<string, string>> = {
  vi: {
    'nav.dashboard': 'Trang chủ',
    'nav.books': 'Danh mục sách',
    'nav.loans': 'Phiếu mượn',
    'nav.reservations': 'Đặt trước',
    'nav.wishlist': 'Yêu thích',
    'nav.reading_analytics': 'Thống kê đọc',
    'nav.membership': 'Thẻ thành viên',
    'nav.fines': 'Phạt',
    'nav.notifications': 'Thông báo',
    'nav.profile': 'Hồ sơ',
    'common.loading': 'Đang tải...',
    'common.refresh': 'Làm mới',
    'common.search': 'Tìm kiếm...',
    'common.save': 'Lưu',
    'common.cancel': 'Hủy',
    'common.delete': 'Xóa',
    'common.edit': 'Sửa',
    'common.back': 'Quay lại',
    'common.confirm': 'Xác nhận',
    'common.no_data': 'Chưa có dữ liệu',
    'common.error': 'Đã xảy ra lỗi',
    'common.success': 'Thành công',
    'common.all': 'Tất cả',
    'common.available': 'Còn hàng',
    'common.out_of_stock': 'Hết hàng',
    'catalog.title': 'Danh mục sách',
    'catalog.subtitle': 'Khám phá và đặt mượn sách',
    'catalog.search_placeholder': 'Tìm theo tên, tác giả, ISBN...',
    'catalog.all_categories': 'Tất cả thể loại',
    'catalog.all_authors': 'Tất cả tác giả',
    'catalog.all_availability': 'Tất cả tình trạng',
    'catalog.reserve': 'Đặt mượn',
    'catalog.view_detail': 'Xem chi tiết',
    'loan.status.BORROWED': 'Đang mượn',
    'loan.status.RETURNED': 'Đã trả',
    'loan.status.OVERDUE': 'Quá hạn',
    'loan.status.CANCELLED': 'Đã hủy',
    'dashboard.welcome': 'Xin chào',
    'dashboard.overview': 'Tổng quan hoạt động',
    'wishlist.title': 'Sách yêu thích',
    'wishlist.empty': 'Chưa có sách yêu thích',
    'wishlist.add': 'Thêm vào yêu thích',
    'wishlist.remove': 'Xóa khỏi yêu thích',
    'reading.title': 'Thống kê đọc sách',
    'reading.subtitle': 'Hành trình đọc sách của bạn',
    'reading.total_books': 'Tổng sách đã mượn',
    'reading.avg_days': 'Thời gian mượn TB',
    'reading.streak': 'Streak liên tục',
    'reading.achievements': 'Thành tựu',
    'membership.qr_title': 'Mã QR thẻ thành viên',
    'membership.qr_subtitle': 'Xuất trình khi đến thư viện',
  },
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.books': 'Browse Books',
    'nav.loans': 'My Loans',
    'nav.reservations': 'My Reservations',
    'nav.wishlist': 'Wishlist',
    'nav.reading_analytics': 'Reading Analytics',
    'nav.membership': 'My Membership',
    'nav.fines': 'My Fines',
    'nav.notifications': 'Notifications',
    'nav.profile': 'My Profile',
    'common.loading': 'Loading...',
    'common.refresh': 'Refresh',
    'common.search': 'Search...',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.back': 'Back',
    'common.confirm': 'Confirm',
    'common.no_data': 'No data yet',
    'common.error': 'An error occurred',
    'common.success': 'Success',
    'common.all': 'All',
    'common.available': 'Available',
    'common.out_of_stock': 'Out of stock',
    'catalog.title': 'Book Catalog',
    'catalog.subtitle': 'Discover and reserve books',
    'catalog.search_placeholder': 'Search by title, author, ISBN...',
    'catalog.all_categories': 'All categories',
    'catalog.all_authors': 'All authors',
    'catalog.all_availability': 'All availability',
    'catalog.reserve': 'Reserve',
    'catalog.view_detail': 'View detail',
    'loan.status.BORROWED': 'Borrowed',
    'loan.status.RETURNED': 'Returned',
    'loan.status.OVERDUE': 'Overdue',
    'loan.status.CANCELLED': 'Cancelled',
    'dashboard.welcome': 'Welcome',
    'dashboard.overview': 'Activity overview',
    'wishlist.title': 'Wishlist',
    'wishlist.empty': 'No books in wishlist',
    'wishlist.add': 'Add to wishlist',
    'wishlist.remove': 'Remove from wishlist',
    'reading.title': 'Reading Analytics',
    'reading.subtitle': 'Your reading journey',
    'reading.total_books': 'Total books borrowed',
    'reading.avg_days': 'Average borrow time',
    'reading.streak': 'Streak',
    'reading.achievements': 'Achievements',
    'membership.qr_title': 'Membership QR Code',
    'membership.qr_subtitle': 'Show at library entrance',
  },
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'vi',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('smartbook-locale') as Locale | null;
    return saved || 'vi';
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('smartbook-locale', l);
  }, []);

  const t = useCallback((key: string): string => {
    return translations[locale]?.[key] || translations.vi[key] || key;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <button
      onClick={() => setLocale(locale === 'vi' ? 'en' : 'vi')}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] hover:bg-slate-50 transition-all ${className || ''}`}
      style={{ fontWeight: 600 }}
      title={locale === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
    >
      {locale === 'vi' ? '🇻🇳 VI' : '🇬🇧 EN'}
    </button>
  );
}
