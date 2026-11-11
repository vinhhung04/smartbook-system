import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { SocketProvider } from '@/lib/socket';
import { useAuthUser } from '@/hooks/useAuthUser';
import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { PublicHeader } from './public-header';

const FOOTER_LINK = 'inline-flex min-h-9 items-center rounded-sm text-[14px] text-indigo-100/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70';

function FooterColumn({ label, links }: { label: string; links: Array<{ to: string; label: string }> }) {
  return (
    <nav aria-label={label}>
      <h2 className="mb-2 text-[14px] font-semibold text-white">{label}</h2>
      <ul>
        {links.map((link) => <li key={link.to + link.label}><Link to={link.to} className={FOOTER_LINK}>{link.label}</Link></li>)}
      </ul>
    </nav>
  );
}

/**
 * A designed close rather than a sitemap: the promise in one line, three
 * short groups of real links, and the name set at full width to end the page.
 */
function PublicFooter() {
  const { isAuthenticated } = useAuthUser();
  return (
    <footer className="mt-24 overflow-hidden bg-[#1d1a4a] text-white sm:mt-32 dark:bg-[#121030]">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-6 pt-14 sm:grid-cols-3 sm:px-6 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:px-8 lg:pt-20">
        <p className="max-w-sm font-display text-[22px] font-medium leading-snug tracking-[-0.01em] text-white sm:col-span-3 lg:col-span-1">
          Tìm sách, xem chi nhánh nào còn sách và đặt trước trực tuyến. Nhận sách tại quầy bằng mã nhận sách.
        </p>
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
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="flex flex-wrap items-center justify-between gap-2 py-6 text-[13px] text-indigo-100/70">
          <span>© {new Date().getFullYear()} SmartBook</span>
          <Link to="/" className="rounded-sm hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70">Về trang chủ</Link>
        </p>
        {/* The name returns at full width; decorative, the wordmark above already names the site. */}
        <p aria-hidden="true" className="-mb-[0.2em] select-none whitespace-nowrap text-center font-display text-[20.5vw] font-semibold leading-[0.9] tracking-[-0.05em] text-white/[0.08] lg:text-[min(20vw,17.5rem)]">
          SmartBook
        </p>
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
