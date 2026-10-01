import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { SocketProvider } from '@/lib/socket';
import { useAuthUser } from '@/hooks/useAuthUser';
import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { PublicHeader, Wordmark } from './public-header';

function PublicFooter() {
  return (
    <footer className="mt-20 border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="space-y-3">
          <Wordmark />
          <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
            Tìm sách, xem chi nhánh nào còn sách và đặt mượn trực tuyến. Nhận sách tại quầy bằng mã nhận sách.
          </p>
        </div>
        <nav aria-label="Khám phá" className="space-y-2 text-[13px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Khám phá</p>
          <Link to="/books" className="block text-foreground/80 hover:text-foreground">Tất cả sách</Link>
          <Link to="/categories" className="block text-foreground/80 hover:text-foreground">Thể loại</Link>
          <Link to="/books?sort=newest" className="block text-foreground/80 hover:text-foreground">Sách mới về</Link>
          <Link to="/books?sort=popular" className="block text-foreground/80 hover:text-foreground">Được mượn nhiều</Link>
        </nav>
        <nav aria-label="Bạn đọc" className="space-y-2 text-[13px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Bạn đọc</p>
          <Link to="/about" className="block text-foreground/80 hover:text-foreground">Cách mượn sách</Link>
          <Link to="/customer" className="block text-foreground/80 hover:text-foreground">Sách của tôi</Link>
          <Link to="/login" className="block text-foreground/80 hover:text-foreground">Đăng nhập nhân viên</Link>
        </nav>
      </div>
    </footer>
  );
}

/** Shell for the public website: anyone can browse; account actions appear once signed in. */
export function PublicLayout() {
  const { pathname } = useLocation();
  const { isCustomer } = useAuthUser();

  const shell = (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a href="#noi-dung" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-[13px] focus:shadow">
        Bỏ qua đến nội dung
      </a>
      <PublicHeader />
      <main id="noi-dung" className="flex-1">
        <RouteErrorBoundary resetKey={pathname}>
          <Outlet />
        </RouteErrorBoundary>
      </main>
      <PublicFooter />
      <ScrollRestoration />
    </div>
  );

  // Live notifications (bell) need the socket; visitors don't open one.
  return isCustomer ? <SocketProvider>{shell}</SocketProvider> : shell;
}
