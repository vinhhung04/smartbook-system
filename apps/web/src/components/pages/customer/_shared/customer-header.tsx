import { Menu, PanelLeftClose, PanelLeftOpen, Moon, Sun } from 'lucide-react';
import { useLocation } from 'react-router';
import { NotificationBellDropdown } from './notification-bell-dropdown';
import { UserAvatarMenu } from './user-avatar-menu';
import { LanguageToggle } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

const pageTitleMap: Array<{ test: (pathname: string) => boolean; title: string; subtitle: string }> = [
  { test: (pathname) => pathname === '/customer', title: 'Dashboard', subtitle: 'Overview of your library activity' },
  { test: (pathname) => pathname.startsWith('/customer/books'), title: 'Browse Books', subtitle: 'Discover and reserve available books' },
  { test: (pathname) => pathname.startsWith('/customer/loans'), title: 'My Loans', subtitle: 'Track due dates and renew requests' },
  { test: (pathname) => pathname.startsWith('/customer/reservations'), title: 'My Reservations', subtitle: 'Follow reservation statuses' },
  { test: (pathname) => pathname.startsWith('/customer/membership'), title: 'My Membership', subtitle: 'Plan and policy details' },
  { test: (pathname) => pathname.startsWith('/customer/fines'), title: 'My Fines', subtitle: 'Outstanding balances and wallet' },
  { test: (pathname) => pathname.startsWith('/customer/notifications'), title: 'My Notifications', subtitle: 'Recent updates and reminders' },
  { test: (pathname) => pathname.startsWith('/customer/profile'), title: 'My Profile', subtitle: 'Personal account information' },
  { test: (pathname) => pathname.startsWith('/customer/wishlist'), title: 'Wishlist', subtitle: 'Your favorite books' },
  { test: (pathname) => pathname.startsWith('/customer/reading-analytics'), title: 'Reading Analytics', subtitle: 'Your reading journey' },
];

interface CustomerHeaderProps {
  onToggleMobileMenu: () => void;
  onToggleDesktopCollapse: () => void;
  isDesktopCollapsed: boolean;
}

function CustomerThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-all text-muted-foreground" title="Toggle theme">
      {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

export function CustomerHeader({ onToggleMobileMenu, onToggleDesktopCollapse, isDesktopCollapsed }: CustomerHeaderProps) {
  const location = useLocation();
  const current = pageTitleMap.find((item) => item.test(location.pathname)) || {
    title: 'Customer Portal',
    subtitle: 'Welcome back',
  };

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-white/90 dark:bg-slate-900/90 px-4 py-3 backdrop-blur md:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button onClick={onToggleMobileMenu} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-border text-muted-foreground transition-all duration-200 hover:border-cyan-200 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 lg:hidden">
              <Menu className="h-4 w-4" />
            </button>
            <button onClick={onToggleDesktopCollapse} className="hidden h-9 w-9 items-center justify-center rounded-[10px] border border-border text-muted-foreground transition-all duration-200 hover:border-cyan-200 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 lg:inline-flex">
              {isDesktopCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <h1 className="truncate text-[18px] text-foreground" style={{ fontWeight: 700 }}>{current.title}</h1>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-slate-500">{current.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <LanguageToggle />
          <CustomerThemeToggle />
          <NotificationBellDropdown />
          <UserAvatarMenu />
        </div>
      </div>
    </header>
  );
}
