import { Outlet, useLocation } from "react-router";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { AIChatbot } from "./ai-chatbot";
import { useEffect, useState } from "react";
import { SocketProvider } from "@/lib/socket";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { RouteErrorBoundary } from "./route-error-boundary";
import { CommandPalette } from "./command-palette";
import { useMediaQuery } from "./pages/ai-import/use-media-query";

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Below lg the sidebar is an off-canvas drawer; a fixed 256px rail left ~120px for content on phones.
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const currentUser = authService.getCurrentUser();
  const location = useLocation();
  // The drawer remembers the route it was opened on, so navigating (or widening to desktop) closes it.
  const [navOpenFor, setNavOpenFor] = useState<string | null>(null);
  const mobileNavOpen = !isDesktop && navOpenFor === location.pathname;
  const setMobileNavOpen = (open: boolean) => setNavOpenFor(open ? location.pathname : null);
  // ADMIN/WAREHOUSE_MANAGER have the dedicated /ai-assistant page instead of the floating widget.
  const hasDedicatedAssistant = canAccess(currentUser, ROUTE_ACCESS.aiAssistant);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpenFor(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  return (
    <SocketProvider>
      <div className="h-screen flex overflow-hidden bg-background">
        {!isDesktop && mobileNavOpen && (
          <button
            type="button"
            aria-label="Đóng menu"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 z-30 bg-slate-950/40"
          />
        )}
        <Sidebar
          collapsed={isDesktop && sidebarCollapsed}
          onToggle={() => (isDesktop ? setSidebarCollapsed(!sidebarCollapsed) : setMobileNavOpen(false))}
          drawer={!isDesktop}
          drawerOpen={mobileNavOpen}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar onMenuClick={isDesktop ? undefined : () => setMobileNavOpen(true)} menuOpen={mobileNavOpen} />
          <main className="flex-1 overflow-y-auto scroll-smooth">
            <RouteErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </RouteErrorBoundary>
          </main>
        </div>
        {!hasDedicatedAssistant && <AIChatbot />}
        <CommandPalette />
      </div>
    </SocketProvider>
  );
}
