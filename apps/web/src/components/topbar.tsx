import { Search, Bell, ScanBarcode, LogOut, Wifi, WifiOff, Moon, Sun } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useState, useCallback } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { authService } from "@/services/auth";
import { toast } from "sonner";
import { useSocket, useSocketEvent } from "@/lib/socket";
import { useTheme } from "@/lib/theme";

const breadcrumbMap: Record<string, { crumbs: { label: string; to?: string }[]; color: string }> = {
  "/": { crumbs: [{ label: "Dashboard" }], color: "text-indigo-600" },
  "/catalog": { crumbs: [{ label: "Catalog" }], color: "text-blue-600" },
  "/inventory": { crumbs: [{ label: "Inventory" }], color: "text-emerald-600" },
  "/orders": { crumbs: [{ label: "Goods Receipts" }], color: "text-indigo-600" },
  "/orders/new": { crumbs: [{ label: "Goods Receipts", to: "/orders" }, { label: "New Receipt" }], color: "text-indigo-600" },
  "/putaway": { crumbs: [{ label: "Putaway" }], color: "text-violet-600" },
  "/receiving-putaway": { crumbs: [{ label: "Receiving Putaway" }], color: "text-amber-700" },
  "/order-requests": { crumbs: [{ label: "Order Requests" }], color: "text-cyan-700" },
  "/picking": { crumbs: [{ label: "Picking" }], color: "text-emerald-700" },
  "/outbound": { crumbs: [{ label: "Outbound" }], color: "text-sky-700" },
  "/warehouses": { crumbs: [{ label: "Warehouses" }], color: "text-emerald-600" },
  "/shelves": { crumbs: [{ label: "Shelves" }], color: "text-cyan-700" },
  "/movements": { crumbs: [{ label: "Stock Movements" }], color: "text-blue-600" },
  "/ai-import": { crumbs: [{ label: "AI Import" }], color: "text-cyan-600" },
  "/recommendations": { crumbs: [{ label: "Recommendations" }], color: "text-violet-600" },
  "/reports": { crumbs: [{ label: "Reports" }], color: "text-emerald-600" },
  "/borrow": { crumbs: [{ label: "Borrow" }], color: "text-amber-600" },
  "/users": { crumbs: [{ label: "Users" }], color: "text-slate-600" },
  "/roles": { crumbs: [{ label: "Roles" }], color: "text-indigo-600" },
};

function resolveBreadcrumb(pathname: string): { crumbs: { label: string; to?: string }[]; color: string } {
  if (breadcrumbMap[pathname]) return breadcrumbMap[pathname];
  if (pathname.startsWith("/book/")) return { crumbs: [{ label: "Catalog", to: "/catalog" }, { label: "Book Detail" }], color: "text-blue-600" };
  if (pathname.startsWith("/order/")) return { crumbs: [{ label: "Goods Receipts", to: "/orders" }, { label: "Order Detail" }], color: "text-indigo-600" };
  if (pathname.startsWith("/orders")) return breadcrumbMap["/orders"];
  return { crumbs: [{ label: "Dashboard" }], color: "text-indigo-600" };
}

interface AdminNotification {
  title: string;
  desc: string;
  time: string;
  color: string;
  unread: boolean;
}

const EVENT_CONFIG: Record<string, { title: string; color: string }> = {
  'loan:status_changed': { title: 'Loan update', color: 'bg-amber-500' },
  'reservation:status_changed': { title: 'Reservation update', color: 'bg-indigo-500' },
  'fine:created': { title: 'Fine update', color: 'bg-rose-500' },
  'notification:new': { title: 'Notification', color: 'bg-cyan-500' },
};

function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-140 text-slate-500" title="Toggle dark mode">
      {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

export function Topbar() {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const [searchFocused, setSearchFocused] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminNotifs, setAdminNotifs] = useState<AdminNotification[]>([]);
  const location = useLocation();
  const { crumbs, color } = resolveBreadcrumb(location.pathname);
  const user = authService.getCurrentUser();

  const handleAdminEvent = useCallback((eventName: string) => (data: any) => {
    const cfg = EVENT_CONFIG[eventName] || { title: 'Event', color: 'bg-slate-500' };
    const subject = data?.subject || cfg.title;
    const body = data?.body || '';

    toast(subject, { description: body, duration: 5000 });

    setAdminNotifs((prev) => [{
      title: subject,
      desc: body,
      time: 'just now',
      color: cfg.color,
      unread: true,
    }, ...prev].slice(0, 10));
  }, []);

  useSocketEvent('loan:status_changed', handleAdminEvent('loan:status_changed'));
  useSocketEvent('reservation:status_changed', handleAdminEvent('reservation:status_changed'));
  useSocketEvent('fine:created', handleAdminEvent('fine:created'));
  useSocketEvent('notification:new', handleAdminEvent('notification:new'));
  const initials = (user?.full_name || user?.username || "AD")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "AD";

  const handleLogout = async () => {
    await authService.logout();
    toast.success("Logged out");
    navigate("/login");
  };

  return (
    <header className="h-[52px] border-b border-border bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl flex items-center justify-between px-5 gap-4 shrink-0 sticky top-0 z-10">
      <nav className="flex items-center gap-1.5 text-[13px]">
        {crumbs.map((crumb, i) => (
          <span key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-300">/</span>}
            {crumb.to ? (
              <NavLink to={crumb.to} className="text-muted-foreground hover:text-foreground transition-colors" style={{ fontWeight: 400 }}>{crumb.label}</NavLink>
            ) : (
              <span className={i === crumbs.length - 1 ? color : "text-muted-foreground"} style={{ fontWeight: i === crumbs.length - 1 ? 600 : 400 }}>{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <motion.div animate={{ width: searchFocused ? 380 : 260 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search books, orders, barcodes..."
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className={`w-full pr-14 py-[7px] bg-slate-50 dark:bg-slate-800 rounded-[9px] text-[13px] text-foreground border outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all duration-220 ${
              searchFocused ? "border-indigo-300/60 ring-[3px] ring-indigo-500/8 bg-white dark:bg-slate-800 shadow-md shadow-indigo-500/5" : "border-transparent hover:border-slate-200 dark:hover:border-slate-600"
            }`}
            style={{ paddingLeft: "2.125rem" }}
          />
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <kbd className="text-[10px] text-slate-400 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-1.5 py-0.5 rounded-[4px] shadow-[0_1px_0_rgba(0,0,0,0.03)]" style={{ fontWeight: 500 }}>⌘</kbd>
            <kbd className="text-[10px] text-slate-400 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-1.5 py-0.5 rounded-[4px] shadow-[0_1px_0_rgba(0,0,0,0.03)]" style={{ fontWeight: 500 }}>K</kbd>
          </div>
        </motion.div>

        <NavLink to="/orders/new" className="w-8 h-8 flex items-center justify-center rounded-[8px] bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 transition-all duration-140" title="Quick scan">
          <ScanBarcode className="w-4 h-4" />
        </NavLink>

        <ThemeToggle />

        <div className="relative">
          <button onClick={() => setNotifOpen(!notifOpen)} className="relative w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-140 text-slate-500 dark:text-slate-400">
            <Bell className="w-4 h-4" />
            {adminNotifs.some((n) => n.unread) && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-1 right-1 w-2.5 h-2.5 bg-gradient-to-br from-red-500 to-rose-500 rounded-full ring-2 ring-white" />
            )}
            <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-white ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          </button>
          <AnimatePresence>
            {notifOpen && (
              <motion.div initial={{ opacity: 0, y: 4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="absolute right-0 top-full mt-2 w-80 bg-card rounded-[14px] border border-border shadow-xl shadow-black/8 overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px]" style={{ fontWeight: 650 }}>Notifications</span>
                    {connected ? (
                      <Wifi className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <WifiOff className="w-3 h-3 text-slate-400" />
                    )}
                  </div>
                  <span className="text-[11px] text-indigo-600 cursor-pointer hover:underline" style={{ fontWeight: 550 }}
                    onClick={() => setAdminNotifs((prev) => prev.map((n) => ({ ...n, unread: false })))}
                  >Mark all read</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {adminNotifs.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-[12px] text-slate-500">No real-time events yet.</p>
                      <p className="text-[11px] text-slate-400 mt-1">Events will appear here as they happen.</p>
                    </div>
                  ) : (
                    adminNotifs.map((n, i) => (
                      <div key={i} className={`px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/50 cursor-pointer transition-colors ${n.unread ? "bg-indigo-50/20 dark:bg-indigo-500/5" : ""}`}>
                        <div className="flex items-start gap-2.5">
                          <div className={`w-2 h-2 rounded-full ${n.color} mt-1.5 shrink-0`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px]" style={{ fontWeight: n.unread ? 600 : 450 }}>{n.title}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{n.desc}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{n.time}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="px-4 py-2.5 border-t border-border text-center">
                  <span className="text-[11px] text-slate-400" style={{ fontWeight: 500 }}>
                    {connected ? 'Live — receiving real-time updates' : 'Offline — reconnecting...'}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {notifOpen && <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />}
        </div>

        <div className="relative">
          <button onClick={() => setProfileOpen(!profileOpen)} className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center cursor-pointer hover:shadow-md hover:shadow-indigo-500/20 transition-all duration-140">
            <span className="text-[10px] text-white" style={{ fontWeight: 700 }}>{initials}</span>
          </button>
          <AnimatePresence>
            {profileOpen && (
              <motion.div initial={{ opacity: 0, y: 4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="absolute right-0 top-full mt-2 w-64 bg-card rounded-[14px] border border-border shadow-xl shadow-black/8 overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[13px]" style={{ fontWeight: 650 }}>{user?.full_name || user?.username || "User"}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{user?.email || ""}</p>
                </div>
                <button onClick={() => void handleLogout()} className="w-full px-4 py-2.5 text-left text-[12px] text-rose-600 hover:bg-rose-50/60 transition-colors flex items-center gap-2" style={{ fontWeight: 550 }}>
                  <LogOut className="w-3.5 h-3.5" /> Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          {profileOpen && <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />}
        </div>
      </div>
    </header>
  );
}
