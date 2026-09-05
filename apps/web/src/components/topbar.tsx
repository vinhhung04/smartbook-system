import { Bell, ScanBarcode, LogOut, Wifi, WifiOff, Moon, Sun, Search } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useState, useCallback } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { authService } from "@/services/auth";
import { toast } from "sonner";
import { useSocket } from "@/lib/socket";
import { useTheme } from "@/lib/theme";
import { LanguageToggle, useI18n } from "@/lib/i18n";
import { useBorrowRealtime } from "@/hooks/useBorrowRealtime";
import { useInventoryRealtime } from "@/hooks/useInventoryRealtime";
import { useWarehouseTaskRealtime } from "@/hooks/useWarehouseTaskRealtime";
import { useAIActionRealtime } from "@/hooks/useAIActionRealtime";
import { navGroups } from "@/lib/nav-groups";
import { openCommandPalette } from "@/lib/command-palette-bus";

type Crumb = { labelKey: string; to?: string };

// Two-level (parent -> child) routes, plus a handful of flat routes that have
// no sidebar nav item to derive a label from (receiving-smart, transfer-receiving,
// forbidden). Every other single-level route is derived from `navGroups` below,
// so a route only needs an entry here if it needs a *different* label/hierarchy
// than its sidebar item, or has no sidebar item at all.
const breadcrumbMap: Record<string, { crumbs: Crumb[]; color: string }> = {
  "/": { crumbs: [{ labelKey: "breadcrumb.dashboard" }], color: "text-indigo-600" },
  "/orders/new": { crumbs: [{ labelKey: "breadcrumb.goods_receipts", to: "/orders" }, { labelKey: "breadcrumb.new_receipt" }], color: "text-indigo-600" },
  "/purchase-orders/new": { crumbs: [{ labelKey: "sidebar.purchase_orders", to: "/purchase-orders" }, { labelKey: "breadcrumb.new_purchase_order" }], color: "text-indigo-600" },
  "/forbidden": { crumbs: [{ labelKey: "breadcrumb.forbidden" }], color: "text-slate-600" },
  "/receiving-smart": { crumbs: [{ labelKey: "breadcrumb.receiving_smart" }], color: "text-cyan-600" },
  "/transfer-receiving": { crumbs: [{ labelKey: "breadcrumb.transfer_receiving" }], color: "text-sky-700" },
};

// Every single-level route with a sidebar nav item gets its breadcrumb derived
// from that item automatically, so adding a page to the sidebar is enough to
// give it a correct breadcrumb too (previously ~30 routes silently fell back
// to showing "Dashboard" because this map was hand-maintained and drifted).
const sidebarBreadcrumbMap: Record<string, { crumbs: Crumb[]; color: string }> = Object.fromEntries(
  navGroups.flatMap((group) => group.items.map((item) => [
    item.to,
    { crumbs: [{ labelKey: item.labelKey }], color: item.textColor },
  ])),
);

function resolveBreadcrumb(pathname: string): { crumbs: Crumb[]; color: string } {
  if (breadcrumbMap[pathname]) return breadcrumbMap[pathname];
  if (pathname.startsWith("/book/")) return { crumbs: [{ labelKey: "breadcrumb.catalog", to: "/catalog" }, { labelKey: "breadcrumb.book_detail" }], color: "text-blue-600" };
  if (pathname.startsWith("/orders/")) return { crumbs: [{ labelKey: "breadcrumb.goods_receipts", to: "/orders" }, { labelKey: "breadcrumb.order_detail" }], color: "text-indigo-600" };
  if (pathname.startsWith("/purchase-orders/")) return { crumbs: [{ labelKey: "sidebar.purchase_orders", to: "/purchase-orders" }, { labelKey: "breadcrumb.purchase_order_detail" }], color: "text-indigo-600" };
  if (pathname.startsWith("/putaway/")) return { crumbs: [{ labelKey: "sidebar.putaway", to: "/putaway" }, { labelKey: "breadcrumb.putaway_detail" }], color: "text-violet-600" };
  if (pathname.startsWith("/stock-audits/")) return { crumbs: [{ labelKey: "sidebar.stock_audits", to: "/stock-audits" }, { labelKey: "breadcrumb.stock_audit_detail" }], color: "text-violet-700" };
  if (pathname.startsWith("/borrow/loans/")) return { crumbs: [{ labelKey: "sidebar.loans", to: "/borrow/loans" }, { labelKey: "breadcrumb.loan_detail" }], color: "text-emerald-600" };
  if (pathname.startsWith("/supplier-deliveries/")) return { crumbs: [{ labelKey: "sidebar.supplier_deliveries" }], color: "text-sky-700" };
  if (sidebarBreadcrumbMap[pathname]) return sidebarBreadcrumbMap[pathname];
  return { crumbs: [{ labelKey: "breadcrumb.dashboard" }], color: "text-indigo-600" };
}

interface AdminNotification {
  event_type: string;
  title: string;
  desc: string;
  time: string;
  color: string;
  unread: boolean;
}

const EVENT_CONFIG: Record<string, { titleKey: string; color: string }> = {
  // Borrow
  'loan:created':               { titleKey: 'topbar.event.loan_created',               color: 'bg-amber-500' },
  'loan:status_changed':        { titleKey: 'topbar.event.loan_status_changed',         color: 'bg-amber-500' },
  'loan:returned':              { titleKey: 'topbar.event.loan_returned',               color: 'bg-emerald-500' },
  'loan:overdue':               { titleKey: 'topbar.event.loan_overdue',                color: 'bg-red-500' },
  'loan:renewal_requested':     { titleKey: 'topbar.event.loan_renewal_requested',      color: 'bg-amber-400' },
  'loan:renewal_reviewed':      { titleKey: 'topbar.event.loan_renewal_reviewed',       color: 'bg-amber-600' },
  'reservation:created':        { titleKey: 'topbar.event.reservation_created',         color: 'bg-indigo-500' },
  'reservation:confirmed':      { titleKey: 'topbar.event.reservation_confirmed',       color: 'bg-indigo-400' },
  'reservation:cancelled':      { titleKey: 'topbar.event.reservation_cancelled',       color: 'bg-slate-500' },
  'reservation:expired':        { titleKey: 'topbar.event.reservation_expired',         color: 'bg-slate-400' },
  'reservation:converted_to_loan': { titleKey: 'topbar.event.reservation_converted',   color: 'bg-violet-500' },
  'fine:created':               { titleKey: 'topbar.event.fine_created',                color: 'bg-rose-500' },
  'fine:paid':                  { titleKey: 'topbar.event.fine_paid',                   color: 'bg-emerald-600' },
  'fine:waived':                { titleKey: 'topbar.event.fine_waived',                 color: 'bg-slate-500' },
  // Inventory
  'purchase_request:created':   { titleKey: 'topbar.event.purchase_request_created',    color: 'bg-cyan-600' },
  'purchase_request:status_changed': { titleKey: 'topbar.event.purchase_request_status_changed', color: 'bg-cyan-500' },
  'goods_receipt:created':      { titleKey: 'topbar.event.goods_receipt_created',       color: 'bg-teal-500' },
  'stock:movement_created':     { titleKey: 'topbar.event.stock_movement_created',      color: 'bg-blue-500' },
  'stock:low':                  { titleKey: 'topbar.event.stock_low',                   color: 'bg-orange-500' },
  'stock:out_of_stock':         { titleKey: 'topbar.event.stock_out_of_stock',          color: 'bg-red-600' },
  // Warehouse tasks
  'warehouse_task:assigned':    { titleKey: 'topbar.event.warehouse_task_assigned',     color: 'bg-violet-500' },
  'warehouse_task:status_changed': { titleKey: 'topbar.event.warehouse_task_status_changed', color: 'bg-violet-400' },
  'exception_report:created':   { titleKey: 'topbar.event.exception_report_created',    color: 'bg-rose-600' },
  'exception_report:resolved':  { titleKey: 'topbar.event.exception_report_resolved',   color: 'bg-emerald-500' },
  // AI
  'ai_action:created':          { titleKey: 'topbar.event.ai_action_created',           color: 'bg-purple-500' },
  'ai_action:confirmed':        { titleKey: 'topbar.event.ai_action_confirmed',         color: 'bg-purple-400' },
  'ai_action:executed':         { titleKey: 'topbar.event.ai_action_executed',          color: 'bg-emerald-500' },
  'ai_action:failed':           { titleKey: 'topbar.event.ai_action_failed',            color: 'bg-red-500' },
  'ai_action:cancelled':        { titleKey: 'topbar.event.ai_action_cancelled',         color: 'bg-slate-500' },
  // Fallback
  'notification:new':           { titleKey: 'topbar.event.notification_new',            color: 'bg-cyan-500' },
};

function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useI18n();
  return (
    <button onClick={toggleTheme} className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-140 text-slate-500" title={t('topbar.toggle_dark_mode')} aria-label={t('topbar.toggle_dark_mode')}>
      {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

export function Topbar() {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const { t } = useI18n();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminNotifs, setAdminNotifs] = useState<AdminNotification[]>([]);
  const location = useLocation();
  const { crumbs, color } = resolveBreadcrumb(location.pathname);
  const user = authService.getCurrentUser();

  const handleAdminEvent = useCallback((eventName: string) => (data: unknown) => {
    const cfg = EVENT_CONFIG[eventName] || { titleKey: 'topbar.event.notification_new', color: 'bg-slate-500' };
    const d = data as Record<string, unknown>;
    const subject = (d?.subject as string) || t(cfg.titleKey);
    const body = (d?.body as string) || '';

    toast(subject, { description: body, duration: 5000 });

    setAdminNotifs((prev) => [{
      event_type: eventName,
      title: subject,
      desc: body,
      time: 'just now',
      color: cfg.color,
      unread: true,
    }, ...prev].slice(0, 10));
  }, [t]);

  useBorrowRealtime({
    onLoanEvent: (event, data) => handleAdminEvent(event)(data),
    onReservationEvent: (event, data) => handleAdminEvent(event)(data),
    onFineEvent: (event, data) => handleAdminEvent(event)(data),
  });

  useInventoryRealtime({
    onStockEvent: (event, data) => handleAdminEvent(event)(data),
    onPurchaseRequestEvent: (event, data) => handleAdminEvent(event)(data),
    onGoodsReceiptEvent: (event, data) => handleAdminEvent(event)(data),
  });

  useWarehouseTaskRealtime({
    onWarehouseTaskEvent: (event, data) => handleAdminEvent(event)(data),
    onExceptionReportEvent: (event, data) => handleAdminEvent(event)(data),
  });

  useAIActionRealtime((event, data) => handleAdminEvent(event)(data));

  const initials = (user?.full_name || user?.username || "AD")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "AD";

  const handleLogout = async () => {
    await authService.logout();
    toast.success(t('topbar.logged_out'));
    navigate("/login");
  };

  return (
    <header className="h-[52px] border-b border-border bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl flex items-center justify-between px-5 gap-4 shrink-0 sticky top-0 z-10">
      <nav className="flex items-center gap-1.5 text-[13px]">
        {crumbs.map((crumb, i) => (
          <span key={`${crumb.labelKey}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-300">/</span>}
            {crumb.to ? (
              <NavLink to={crumb.to} className="text-muted-foreground hover:text-foreground transition-colors" style={{ fontWeight: 400 }}>{t(crumb.labelKey)}</NavLink>
            ) : (
              <span className={i === crumbs.length - 1 ? color : "text-muted-foreground"} style={{ fontWeight: i === crumbs.length - 1 ? 600 : 400 }}>{t(crumb.labelKey)}</span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openCommandPalette()}
          className="hidden items-center gap-2 rounded-[8px] border border-input bg-background px-3 h-8 text-[12px] text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground sm:flex"
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">{t('command_palette.search_placeholder')}</span>
          <kbd className="ml-1 hidden rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] md:inline-block">⌘K</kbd>
        </button>

        <NavLink to="/orders/new" className="w-8 h-8 flex items-center justify-center rounded-[8px] bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 transition-all duration-140" title={t('topbar.quick_scan')} aria-label={t('topbar.quick_scan')}>
          <ScanBarcode className="w-4 h-4" />
        </NavLink>

        <ThemeToggle />
        <LanguageToggle />

        <div className="relative">
          <button onClick={() => setNotifOpen(!notifOpen)} className="relative w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-140 text-slate-500 dark:text-slate-400" aria-label={t('topbar.notifications')}>
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
                    <span className="text-[13px]" style={{ fontWeight: 650 }}>{t('topbar.notifications')}</span>
                    {connected ? (
                      <Wifi className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <WifiOff className="w-3 h-3 text-slate-400" />
                    )}
                  </div>
                  <span className="text-[11px] text-indigo-600 cursor-pointer hover:underline" style={{ fontWeight: 550 }}
                    onClick={() => setAdminNotifs((prev) => prev.map((n) => ({ ...n, unread: false })))}
                  >{t('topbar.mark_all_read')}</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {adminNotifs.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-[12px] text-slate-500">{t('topbar.no_events')}</p>
                      <p className="text-[11px] text-slate-400 mt-1">{t('topbar.events_will_appear')}</p>
                    </div>
                  ) : (
                    adminNotifs.map((n, i) => (
                      <div key={i} className={`px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/50 cursor-pointer transition-colors ${n.unread ? "bg-indigo-50/20 dark:bg-indigo-500/5" : ""}`}>
                        <div className="flex items-start gap-2.5">
                          <div className={`w-2 h-2 rounded-full ${n.color} mt-1.5 shrink-0`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <div className="text-[12px]" style={{ fontWeight: n.unread ? 600 : 450 }}>{n.title}</div>
                              <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 rounded px-1 py-0.5 shrink-0">{n.event_type.replace(':', ' ')}</span>
                            </div>
                            {n.desc && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{n.desc}</div>}
                            <div className="text-[10px] text-slate-400 mt-1">{n.time}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="px-4 py-2.5 border-t border-border text-center">
                  <span className="text-[11px] text-slate-400" style={{ fontWeight: 500 }}>
                    {connected ? t('topbar.connected') : t('topbar.disconnected')}
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
                  <p className="text-[13px]" style={{ fontWeight: 650 }}>{user?.full_name || user?.username || t('topbar.user_fallback')}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{user?.email || ""}</p>
                </div>
                <button onClick={() => void handleLogout()} className="w-full px-4 py-2.5 text-left text-[12px] text-rose-600 hover:bg-rose-50/60 transition-colors flex items-center gap-2" style={{ fontWeight: 550 }}>
                  <LogOut className="w-3.5 h-3.5" /> {t('topbar.logout')}
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
