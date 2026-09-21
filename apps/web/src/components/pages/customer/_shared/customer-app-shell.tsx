import { ReactNode, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { MoreHorizontal, X } from 'lucide-react';
import { CustomerHeader } from './customer-header';
import { ACCOUNT_NAV, DISCOVER_NAV, PRIMARY_NAV } from './customer-nav';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { cn } from '@/components/ui/utils';

interface CustomerAppShellProps {
  children: ReactNode;
}

// The bottom bar shows the four everyday destinations; everything else lives behind "Thêm".
const TAB_ITEMS = PRIMARY_NAV.slice(0, 4);
const SHEET_GROUPS = [
  { title: 'Yêu thích & khám phá', items: [PRIMARY_NAV[4], ...DISCOVER_NAV] },
  { title: 'Tài khoản', items: ACCOUNT_NAV },
];

export function CustomerAppShell({ children }: CustomerAppShellProps) {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeMore = () => setMoreOpen(false);
  useDialogA11y(moreOpen, closeMore, sheetRef);

  const moreActive = SHEET_GROUPS.some((group) => group.items.some((item) => pathname.startsWith(item.to)));

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />

      <main className="pb-24 lg:pb-8">{children}</main>

      {/* Phone tab bar */}
      <nav
        aria-label="Điều hướng nhanh"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {TAB_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors',
                    isActive ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground',
                  )
                }
              >
                <item.icon className="h-5 w-5" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              className={cn(
                'flex w-full flex-col items-center gap-0.5 py-2 text-[11px] transition-colors',
                moreActive ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground',
              )}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              Thêm
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={closeMore}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Thêm"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Thêm</h2>
              <button type="button" onClick={closeMore} aria-label="Đóng" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              {SHEET_GROUPS.map((group) => (
                <section key={group.title}>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</h3>
                  <ul className="grid grid-cols-2 gap-2">
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          onClick={closeMore}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-2.5 rounded-xl border px-3 py-3 text-[13px] transition-colors',
                              isActive
                                ? 'border-indigo-200 bg-indigo-50 font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300'
                                : 'border-border text-foreground hover:bg-muted',
                            )
                          }
                        >
                          <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </motion.div>
        </div>
      ) : null}
    </div>
  );
}
