import { useRef, useState } from 'react';
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

interface NavItem {
  to: string;
  label: string;
  isActive: (pathname: string, search: URLSearchParams) => boolean;
}

const DISCOVER_ITEMS: NavItem[] = [
  { to: '/', label: 'Trang chủ', isActive: (p) => p === '/' },
  { to: '/books', label: 'Khám phá', isActive: (p, s) => (p.startsWith('/books') || p === '/search') && s.get('sort') !== 'newest' },
  { to: '/categories', label: 'Thể loại', isActive: (p) => p.startsWith('/categories') },
];
const NEW_ARRIVALS: NavItem = { to: '/books?sort=newest', label: 'Sách mới', isActive: (p, s) => p === '/books' && s.get('sort') === 'newest' };
const CUSTOMER_ITEMS: NavItem[] = [
  { to: '/customer/recommendations', label: 'Gợi ý cho bạn', isActive: () => false },
  { to: '/customer', label: 'Sách của tôi', isActive: () => false },
];

const linkClass = (active: boolean) => cn(
  'inline-flex h-9 items-center whitespace-nowrap rounded-md px-3 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
  active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground',
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
      <span className="font-serif text-[19px] font-semibold tracking-tight text-foreground">SmartBook</span>
    </Link>
  );
}

export function PublicHeader() {
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const { user, isAuthenticated, isCustomer, isStaff } = useAuthUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeMenu = () => setMenuOpen(false);
  useDialogA11y(menuOpen, closeMenu, sheetRef);

  const navItems = [...DISCOVER_ITEMS, ...(isCustomer ? CUSTOMER_ITEMS : [NEW_ARRIVALS])];
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
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Wordmark />

        <nav aria-label="Điều hướng chính" className="ml-4 hidden items-center lg:flex">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass(item.isActive(pathname, params))} aria-current={item.isActive(pathname, params) ? 'page' : undefined} end>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {showHeaderSearch ? <div className={cn('hidden md:block', isAuthenticated ? 'w-48 lg:hidden xl:block xl:w-56' : 'w-56 xl:w-72')}><SearchAutocomplete placeholder="Tìm sách, tác giả…" /></div> : null}
          <ThemeToggle />
          {isAuthenticated ? (
            <div className="hidden items-center gap-2 sm:flex">{accountActions}</div>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link to={loginUrl} className="inline-flex h-9 items-center rounded-md px-3 text-[13.5px] font-semibold text-foreground hover:bg-muted">Đăng nhập</Link>
              <Link to={registerUrl} className="inline-flex h-9 items-center rounded-md bg-indigo-700 px-3.5 text-[13.5px] font-semibold text-white hover:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-400">Đăng ký</Link>
            </div>
          )}
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Mở menu" aria-expanded={menuOpen} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted lg:hidden">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={closeMenu}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onClick={(event) => event.stopPropagation()}
            className="absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] flex-col gap-5 overflow-y-auto border-l border-border bg-background p-5"
          >
            <div className="flex items-center justify-between">
              <Wordmark />
              <button type="button" onClick={closeMenu} aria-label="Đóng menu" className="rounded-md p-2 text-muted-foreground hover:bg-muted">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <SearchAutocomplete placeholder="Tìm sách, tác giả…" onNavigate={closeMenu} />
            <nav aria-label="Điều hướng chính" className="flex flex-col">
              {navItems.map((item) => (
                <Link key={item.to} to={item.to} onClick={closeMenu} className={cn(linkClass(item.isActive(pathname, params)), 'h-11 text-[15px]')}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
              {isAuthenticated ? (
                <div className="flex items-center gap-2">{accountActions}</div>
              ) : (
                <>
                  <Link to={loginUrl} onClick={closeMenu} className="inline-flex h-11 items-center justify-center rounded-md border border-border text-[14px] font-semibold">Đăng nhập</Link>
                  <Link to={registerUrl} onClick={closeMenu} className="inline-flex h-11 items-center justify-center rounded-md bg-indigo-700 text-[14px] font-semibold text-white dark:bg-indigo-500">Tạo tài khoản bạn đọc</Link>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
