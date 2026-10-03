import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { SocketProvider } from '@/lib/socket';
import { useAuthUser } from '@/hooks/useAuthUser';
import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { PublicHeader, Wordmark } from './public-header';

const FOOTER_LINK = 'block py-1 text-foreground/80 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded-sm';

function FooterColumn({ label, links }: { label: string; links: Array<{ to: string; label: string }> }) {
  return (
    <nav aria-label={label} className="space-y-1.5 text-[13px]">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      {links.map((link) => <Link key={link.to} to={link.to} className={FOOTER_LINK}>{link.label}</Link>)}
    </nav>
  );
}

function PublicFooter() {
  const { isAuthenticated } = useAuthUser();
  return (
    <footer className="mt-20 border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
        <div className="space-y-3 sm:col-span-3 lg:col-span-1">
          <Wordmark />
          <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
            Tìm sách, xem chi nhánh nào còn sách và đặt trước trực tuyến. Nhận sách tại quầy bằng mã nhận sách.
          </p>
        </div>
        <FooterColumn
          label="Khám phá"
          links={[
            { to: '/books', label: 'Tất cả sách' },
            { to: '/categories', label: 'Thể loại' },
            { to: '/books?sort=newest', label: 'Sách mới về' },
            { to: '/discover', label: 'AI gợi ý sách' },
          ]}
        />
        <FooterColumn
          label="Thư viện"
          links={[
            { to: '/branches', label: 'Chi nhánh' },
            { to: '/membership', label: 'Thẻ bạn đọc' },
            { to: '/about', label: 'Về SmartBook' },
          ]}
        />
        <FooterColumn
          label="Hỗ trợ"
          links={[
            { to: '/about', label: 'Cách mượn sách' },
            ...(isAuthenticated
              ? [{ to: '/customer', label: 'Sách của tôi' }]
              : [{ to: '/customer/login', label: 'Đăng nhập' }, { to: '/customer/register', label: 'Đăng ký' }]),
            { to: '/login', label: 'Đăng nhập nhân viên' },
          ]}
        />
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
