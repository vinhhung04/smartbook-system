import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { BookOpen, LayoutDashboard, Menu, Moon, Sun, X } from 'lucide-react';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { buildLoginUrl } from '@/lib/return-url';
import { getHomePathForUser } from '@/lib/rbac';
import { useTheme } from '@/lib/theme';
import { cn } from '@/components/ui/utils';
import { NotificationBellDropdown } from '@/components/pages/customer/_shared/notification-bell-dropdown';
import { UserAvatarMenu } from '@/components/pages/customer/_shared/user-avatar-menu';
import { SearchAutocomplete } from './search-autocomplete';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from './gsap-motion';

interface NavItem {
  to: string;
  label: string;
  isActive: (pathname: string, search: URLSearchParams) => boolean;
}

// The wordmark is the way home; "Sách mới" lives on the homepage and in the footer.
const DISCOVER_ITEMS: NavItem[] = [
  { to: '/books', label: 'Khám phá', isActive: (p) => p.startsWith('/books') || p === '/search' },
  { to: '/categories', label: 'Thể loại', isActive: (p) => p.startsWith('/categories') },
  { to: '/branches', label: 'Chi nhánh', isActive: (p) => p.startsWith('/branches') },
];
const VISITOR_ITEMS: NavItem[] = [
  { to: '/discover', label: 'AI gợi ý', isActive: (p) => p === '/discover' },
  { to: '/about', label: 'Về SmartBook', isActive: (p) => p === '/about' },
];
const CUSTOMER_ITEMS: NavItem[] = [
  { to: '/customer/recommendations', label: 'Gợi ý cho bạn', isActive: () => false },
  { to: '/customer', label: 'Sách của tôi', isActive: () => false },
];

const linkClass = (active: boolean) => cn(
  'inline-flex h-9 items-center whitespace-nowrap rounded-md px-3 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
  active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground',
);

// Desktop bar: a short ink underline marks the current page and grows in on hover elsewhere.
const barLinkClass = (active: boolean) => cn(
  linkClass(active),
  'relative after:absolute after:inset-x-3 after:bottom-1 after:h-[2px] after:origin-left after:rounded-full after:bg-indigo-600 after:transition-transform after:duration-300 dark:after:bg-indigo-300 motion-reduce:after:transition-none',
  active ? 'after:scale-x-100' : 'after:scale-x-0 hover:after:scale-x-100',
);

function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const Icon = resolvedTheme === 'dark' ? Sun : Moon;
  return (
    <button type="button" onClick={toggleTheme} aria-label="Đổi giao diện sáng/tối" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

export function Wordmark() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50" aria-label="SmartBook — trang chủ">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-700 text-white dark:bg-indigo-500">
        <BookOpen className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">SmartBook</span>
    </Link>
  );
}

export function PublicHeader() {
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const { user, isAuthenticated, isCustomer, isStaff } = useAuthUser();
  // `menuOpen` is what the reader asked for; `menuMounted` keeps the sheet on
  // screen until its exit animation has finished.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Transparent while it sits on top of the page, a frosted bar once content scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    const frame = requestAnimationFrame(update);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
    };
  }, []);
  const sheetRef = useRef<HTMLDivElement>(null);
  // The exit runs after `menuOpen` is already false, so it lives in its own
  // context; reopening mid-exit reverts it first.
  const exitRef = useRef<gsap.Context | null>(null);
  useEffect(() => () => exitRef.current?.revert(), []);
  const openMenu = () => {
    exitRef.current?.revert();
    exitRef.current = null;
    setMenuMounted(true);
    setMenuOpen(true);
  };

  // Sheet slides in from the right, its contents follow; short, so it never
  // stands between the reader and a link.
  useGSAP(() => {
    if (!menuOpen) return undefined;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.timeline({ defaults: { ease: EASE_OUT } })
        .from('[data-menu="backdrop"]', { opacity: 0, duration: 0.3 })
        .from('[data-menu="sheet"]', { xPercent: 100, duration: 0.55 }, 0)
        .from('[data-menu="item"]', { opacity: 0, x: 16, duration: 0.45, stagger: 0.035 }, 0.12);
    });
    return () => mm.revert();
  }, { scope: menuRef, dependencies: [menuOpen], revertOnUpdate: true });

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    const root = menuRef.current;
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMenuMounted(false);
      return;
    }
    exitRef.current = gsap.context(() => {
      gsap.timeline({ defaults: { duration: 0.25, ease: 'power2.in' }, onComplete: () => setMenuMounted(false) })
        .to('[data-menu="sheet"]', { xPercent: 100 }, 0)
        .to('[data-menu="backdrop"]', { opacity: 0 }, 0);
    }, root);
  }, []);
  useDialogA11y(menuOpen, closeMenu, sheetRef);

  const navItems = [...DISCOVER_ITEMS, ...(isCustomer ? CUSTOMER_ITEMS : VISITOR_ITEMS)];
  const loginUrl = buildLoginUrl(`${pathname}${search}`);
  const registerUrl = buildLoginUrl(`${pathname}${search}`, 'register');
  // The home hero and the search page already have a big search field.
  const showHeaderSearch = pathname !== '/' && pathname !== '/search';

  const accountActions = isCustomer ? (
    <>
      <NotificationBellDropdown />
      <UserAvatarMenu />
    </>
  ) : isStaff ? (
    <Link to={getHomePathForUser(user)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-semibold text-foreground hover:bg-muted">
      <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Trang quản lý
    </Link>
  ) : null;

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b transition-[background-color,border-color,box-shadow] duration-300',
        scrolled
          ? 'border-border bg-background/85 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.35)] backdrop-blur-md supports-[backdrop-filter]:bg-background/70'
          : 'border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Wordmark />

        <nav aria-label="Điều hướng chính" className="ml-4 hidden items-center lg:flex">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={barLinkClass(item.isActive(pathname, params))} aria-current={item.isActive(pathname, params) ? 'page' : undefined} end>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {showHeaderSearch ? <div className={cn('hidden md:block lg:hidden xl:block', isAuthenticated ? 'w-48 xl:w-56' : 'w-56 2xl:w-72')}><SearchAutocomplete placeholder="Tìm sách, tác giả…" /></div> : null}
          <ThemeToggle />
          {isAuthenticated ? (
            <div className="hidden items-center gap-2 sm:flex">{accountActions}</div>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link to={loginUrl} className="inline-flex h-9 items-center whitespace-nowrap rounded-md px-3 text-[13.5px] font-semibold text-foreground hover:bg-muted">Đăng nhập</Link>
              <Link to={registerUrl} className="inline-flex h-9 items-center whitespace-nowrap rounded-md bg-indigo-700 px-3.5 text-[13.5px] font-semibold text-white hover:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-400">Đăng ký</Link>
            </div>
          )}
          <button type="button" onClick={openMenu} aria-label="Mở menu" aria-expanded={menuOpen} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted lg:hidden">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {menuMounted ? (
        <div ref={menuRef} className="fixed inset-0 z-40 lg:hidden" onClick={closeMenu}>
          <div data-menu="backdrop" className="absolute inset-0 bg-[#141233]/45" />
          <div
            ref={sheetRef}
            data-menu="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onClick={(event) => event.stopPropagation()}
            className="absolute inset-y-0 right-0 flex w-[min(21rem,90vw)] flex-col gap-5 overflow-y-auto bg-background p-5 shadow-[-24px_0_60px_-30px_rgba(20,18,51,0.6)]"
          >
            <div data-menu="item" className="flex items-center justify-between">
              <Wordmark />
              <button type="button" onClick={closeMenu} aria-label="Đóng menu" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div data-menu="item"><SearchAutocomplete placeholder="Tìm sách, tác giả…" onNavigate={closeMenu} /></div>
            <nav aria-label="Điều hướng chính" className="flex flex-col">
              {navItems.map((item) => {
                const active = item.isActive(pathname, params);
                return (
                  <Link
                    key={item.to}
                    data-menu="item"
                    to={item.to}
                    onClick={closeMenu}
                    aria-current={active ? 'page' : undefined}
                    className={cn(linkClass(active), 'h-12 font-display text-[22px] tracking-[-0.01em]', active ? 'text-indigo-700 dark:text-indigo-300' : 'text-foreground')}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div data-menu="item" className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
              {isAuthenticated ? (
                <div className="flex items-center gap-2">{accountActions}</div>
              ) : (
                <>
                  <Link to={loginUrl} onClick={closeMenu} className="inline-flex h-11 items-center justify-center rounded-md border border-border text-[14px] font-semibold">Đăng nhập</Link>
                  <Link to={registerUrl} onClick={closeMenu} className="inline-flex h-11 items-center justify-center rounded-md bg-indigo-700 text-[14px] font-semibold text-white dark:bg-indigo-500">Tạo tài khoản bạn đọc</Link>
                  <Link to="/membership" onClick={closeMenu} className="inline-flex h-11 items-center justify-center rounded-md text-[14px] font-semibold text-indigo-700 hover:bg-muted dark:text-indigo-300">Quyền lợi thẻ bạn đọc</Link>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
