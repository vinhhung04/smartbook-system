import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthUser } from '@/hooks/useAuthUser';
import { buildLoginUrl } from '@/lib/return-url';

const SCAN_COVER_PATH = '/customer/scan-cover';

/**
 * "Tìm bằng ảnh bìa" from the public search box: the reader picks or takes a
 * photo right here and lands on the scan page with it already uploading.
 * Cover search reads the catalog with the reader's own token, so visitors are
 * asked to log in first (and come back to the scan page).
 */
export function CoverSearchButton() {
  const navigate = useNavigate();
  const { isAuthenticated, isCustomer } = useAuthUser();
  const inputRef = useRef<HTMLInputElement>(null);

  const start = () => {
    if (!isAuthenticated) {
      toast.info('Đăng nhập tài khoản bạn đọc để tìm sách bằng ảnh bìa.');
      navigate(buildLoginUrl(SCAN_COVER_PATH));
      return;
    }
    if (!isCustomer) {
      toast.info('Nhân viên tìm sách bằng ảnh bìa trong trang Danh mục của hệ thống quản lý.');
      return;
    }
    inputRef.current?.click();
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          // A File survives history state (structured clone), so the scan page can start on it.
          if (file) navigate(SCAN_COVER_PATH, { state: { coverFile: file } });
        }}
      />
      <button
        type="button"
        onClick={start}
        aria-label="Tìm sách bằng ảnh bìa"
        title="Chụp hoặc chọn ảnh bìa để tìm sách"
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 sm:px-3"
      >
        <Camera className="h-5 w-5" aria-hidden="true" />
        <span className="hidden sm:inline">Ảnh bìa</span>
      </button>
    </>
  );
}
