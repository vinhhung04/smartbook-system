import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, ScanBarcode, ChevronLeft, ChevronDown } from "lucide-react";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { navGroups } from "@/lib/nav-groups";
import { useI18n } from "@/lib/i18n";

const SIDEBAR_EXPANDED_STORAGE_KEY = "smartbook-sidebar-expanded";
const ALWAYS_OPEN_GROUP = "sidebar.group.today";

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const user = authService.getCurrentUser();
  const { t } = useI18n();
  const location = useLocation();
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccess(user, item.access)),
    }))
    .filter((group) => group.items.length > 0);
  const canReceiveStock = canAccess(user, ROUTE_ACCESS.staffTaskProgress);

  const activeGroupKey = visibleGroups.find((group) =>
    group.items.some((item) => item.to === location.pathname)
  )?.labelKey;

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    let saved: Record<string, boolean> = {};
    try {
      saved = JSON.parse(localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY) || "{}");
    } catch {
      saved = {};
    }
    if (activeGroupKey) saved[activeGroupKey] = true;
    return saved;
  });

  useEffect(() => {
    if (activeGroupKey && !expanded[activeGroupKey]) {
      setExpanded((prev) => ({ ...prev, [activeGroupKey]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupKey]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, JSON.stringify(expanded));
  }, [expanded]);

  const toggleGroup = (labelKey: string) => {
    setExpanded((prev) => ({ ...prev, [labelKey]: !prev[labelKey] }));
  };
  const initials = (user?.full_name || user?.username || "AD")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "AD";

  return (
    <motion.aside
      animate={{ width: collapsed ? 68 : 256 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="h-screen bg-[#fafbfe] dark:bg-slate-950 border-r border-border flex flex-col shrink-0 relative z-20"
    >
      {/* Logo */}
      <div className="h-[56px] flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/25">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2 }}>
                <span className="text-[15px] tracking-[-0.3px] bg-gradient-to-r from-indigo-700 to-violet-600 bg-clip-text text-transparent" style={{ fontWeight: 700 }}>SmartBook</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button onClick={onToggle} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400" aria-label="Toggle sidebar">
          <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.24 }}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </motion.div>
        </button>
      </div>

      {/* Scan CTA */}
      {canReceiveStock ? <div className="px-3 pt-4 pb-1">
        <NavLink
          to="/orders/new"
          className={`group flex items-center gap-2.5 rounded-[10px] bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 text-white text-[13px] shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 active:scale-[0.98] transition-all duration-140 ${collapsed ? "justify-center px-0 py-2.5" : "px-3.5 py-2.5"}`}
          style={{ fontWeight: 500 }}
          aria-label="Create receiving draft"
        >
          <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}>
            <ScanBarcode className="w-4 h-4" />
          </motion.div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                {t('sidebar.scan_receive_cta')}
              </motion.span>
            )}
          </AnimatePresence>
        </NavLink>
      </div> : null}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {visibleGroups.map((group) => {
          const isAlwaysOpen = group.labelKey === ALWAYS_OPEN_GROUP;
          const isGroupOpen = collapsed || isAlwaysOpen || !!expanded[group.labelKey] || group.items.some((item) => item.to === location.pathname);
          return (
            <div key={group.labelKey} className="pt-4 first:pt-1">
              <AnimatePresence>
                {!collapsed && (
                  <motion.button
                    type="button"
                    onClick={() => !isAlwaysOpen && toggleGroup(group.labelKey)}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className={`flex w-full items-center gap-1.5 px-3 pb-2 ${isAlwaysOpen ? "cursor-default" : "cursor-pointer"}`}
                  >
                    <div className={`w-1 h-1 rounded-full ${group.dotColor}`} />
                    <span className={`flex-1 text-left text-[10px] uppercase tracking-[0.08em] ${group.color}`} style={{ fontWeight: 600 }}>{t(group.labelKey)}</span>
                    {!isAlwaysOpen && (
                      <motion.div animate={{ rotate: isGroupOpen ? 0 : -90 }} transition={{ duration: 0.2 }}>
                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                      </motion.div>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {isGroupOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) =>
                          `group flex items-center gap-2.5 px-3 py-[7px] rounded-[9px] text-[13px] transition-all duration-160 relative overflow-hidden ${
                            isActive ? item.textColor : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          } ${collapsed ? "justify-center" : ""}`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <motion.div
                                layoutId="sidebar-active-pill"
                                className={`absolute inset-0 rounded-[9px] bg-gradient-to-r ${item.activeColor} border border-white/50 dark:border-white/10`}
                                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                              />
                            )}
                            <div className={`w-[22px] h-[22px] rounded-[6px] flex items-center justify-center shrink-0 relative z-10 transition-colors duration-160 ${
                              isActive ? item.iconBg : "group-hover:bg-slate-100 dark:group-hover:bg-slate-800"
                            }`}>
                              <item.icon className="w-[14px] h-[14px]" />
                            </div>
                            <AnimatePresence>
                              {!collapsed && (
                                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                                  className="relative z-10" style={{ fontWeight: isActive ? 550 : 400 }}>
                                  {t(item.labelKey)}
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-border p-3">
          <div className={`flex items-center gap-2.5 px-2 py-2.5 rounded-[10px] bg-gradient-to-r from-indigo-50/80 to-violet-50/50 dark:from-indigo-500/10 dark:to-violet-500/5 border border-indigo-100/40 dark:border-indigo-500/20 cursor-pointer hover:border-indigo-200/60 dark:hover:border-indigo-400/30 transition-all duration-160 ${collapsed ? "justify-center" : ""}`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shrink-0 shadow-sm shadow-indigo-500/20">
            <span className="text-[10px] text-white" style={{ fontWeight: 700 }}>{initials}</span>
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-w-0">
                <div className="text-[13px] truncate" style={{ fontWeight: 550 }}>{user?.full_name || user?.username || "Admin User"}</div>
                <div className="text-[11px] text-indigo-400 truncate">{user?.email || "admin@smartbook.vn"}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  );
}
