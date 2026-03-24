import { LucideIcon, Bell, BookOpen, CalendarClock, HandCoins, House, ReceiptText, ShieldCheck, User, ChevronLeft } from 'lucide-react';
import { NavLink } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';

export interface CustomerSidebarItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

interface CustomerSidebarProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

const primaryItems: CustomerSidebarItem[] = [
  { to: '/customer', label: 'Dashboard', icon: House, end: true },
  { to: '/customer/books', label: 'Browse Books', icon: BookOpen },
  { to: '/customer/loans', label: 'My Loans', icon: HandCoins },
  { to: '/customer/reservations', label: 'My Reservations', icon: CalendarClock },
];

const accountItems: CustomerSidebarItem[] = [
  { to: '/customer/membership', label: 'My Membership', icon: ShieldCheck },
  { to: '/customer/fines', label: 'My Fines', icon: ReceiptText },
  { to: '/customer/notifications', label: 'My Notifications', icon: Bell },
  { to: '/customer/profile', label: 'My Profile', icon: User },
];

const sidebarGroups = [
  { title: 'Main', items: primaryItems },
  { title: 'Account', items: accountItems },
];

function NavItem({
  item,
  collapsed,
  onNavigate,
}: {
  item: CustomerSidebarItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          'group flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] transition-all duration-160 relative overflow-hidden',
          isActive
            ? 'bg-gradient-to-r from-indigo-50 to-cyan-50 text-indigo-700 shadow-[0_2px_8px_rgba(79,70,229,0.10)] border border-indigo-100/60'
            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-100',
          collapsed ? 'justify-center px-0' : '',
        ].join(' ')
      }
      title={collapsed ? item.label : undefined}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.div
              layoutId="customer-sidebar-active"
              className="absolute inset-0 rounded-xl"
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          <div className={[
            'w-[22px] h-[22px] rounded-lg flex items-center justify-center shrink-0 relative z-10 transition-colors duration-160',
            isActive ? 'bg-indigo-100' : 'group-hover:bg-slate-100',
          ].join(' ')}>
            <item.icon className="w-[14px] h-[14px]" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="relative z-10"
                style={{ fontWeight: isActive ? 600 : 400 }}
              >
                {item.label}
              </motion.span>
            )}
          </AnimatePresence>
        </>
      )}
    </NavLink>
  );
}

export function CustomerSidebar({ collapsed = false, onNavigate }: CustomerSidebarProps) {
  return (
    <aside
      className={[
        'h-full border-r border-slate-200 bg-white flex flex-col',
        collapsed ? 'w-[72px]' : 'w-[268px]',
      ].join(' ')}
    >
      {/* Logo */}
      <div className="h-[56px] flex items-center justify-between px-4 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/25">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.2 }}
              >
                <div>
                  <p className="text-[14px] tracking-[-0.3px] text-indigo-700" style={{ fontWeight: 700 }}>SmartBook</p>
                  <p className="text-[10px] text-slate-400">Customer Portal</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {sidebarGroups.map((group) => (
          <div key={group.title}>
            <AnimatePresence>
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 px-3 pb-2"
                >
                  <div className="w-1 h-1 rounded-full bg-slate-300" />
                  <span className="text-[10px] uppercase tracking-[0.08em] text-slate-400" style={{ fontWeight: 600 }}>
                    {group.title}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem
                  key={item.to}
                  item={item}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer branding */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-slate-100 shrink-0">
          <p className="text-[10px] text-slate-300 text-center">SmartBook Library System</p>
        </div>
      )}
    </aside>
  );
}
