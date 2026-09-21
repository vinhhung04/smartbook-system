import { BookOpen, ChevronDown } from 'lucide-react';
import { Moon, Sun } from 'lucide'; // icon data (not components) — MorphIcon needs this, not lucide-react
import { MorphIcon } from 'morphicons/react';
import { NavLink, useLocation } from 'react-router';
import { NotificationBellDropdown } from './notification-bell-dropdown';
import { UserAvatarMenu } from './user-avatar-menu';
import { DISCOVER_NAV, PRIMARY_NAV } from './customer-nav';
import { LanguageToggle } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { cn } from '@/components/ui/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function CustomerThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label="Đổi giao diện sáng/tối"
      title="Đổi giao diện sáng/tối"
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-all hover:bg-muted"
    >
      <MorphIcon icon={resolvedTheme === 'dark' ? Sun : Moon} className="h-4 w-4" />
    </button>
  );
}

const linkClass = (active: boolean) =>
  cn(
    'inline-flex h-9 items-center rounded-lg px-3 text-[13px] transition-colors',
    active ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
  );

export function CustomerHeader() {
  const { pathname } = useLocation();
  const discoverActive = DISCOVER_NAV.some((item) => pathname.startsWith(item.to));

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <NavLink to="/customer" className="flex shrink-0 items-center gap-2.5" aria-label="SmartBook — trang tổng quan">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 shadow-md shadow-indigo-500/25">
            <BookOpen className="h-4 w-4 text-white" aria-hidden="true" />
          </span>
          <span className="text-[15px] font-bold tracking-tight text-indigo-700 dark:text-indigo-400">SmartBook</span>
        </NavLink>

        <nav aria-label="Điều hướng chính" className="ml-2 hidden items-center gap-1 lg:flex">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => linkClass(isActive)}>
              {item.label}
            </NavLink>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(linkClass(discoverActive), 'gap-1')}>
                Khám phá <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 rounded-xl p-1.5">
              {DISCOVER_NAV.map((item) => (
                <DropdownMenuItem key={item.to} asChild className="rounded-lg text-[13px]">
                  <NavLink to={item.to}>
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LanguageToggle />
          <CustomerThemeToggle />
          <NotificationBellDropdown />
          <UserAvatarMenu />
        </div>
      </div>
    </header>
  );
}
