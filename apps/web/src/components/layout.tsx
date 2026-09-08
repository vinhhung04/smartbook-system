import { Outlet, useLocation } from "react-router";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { AIChatbot } from "./ai-chatbot";
import { useState } from "react";
import { SocketProvider } from "@/lib/socket";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { RouteErrorBoundary } from "./route-error-boundary";
import { CommandPalette } from "./command-palette";

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const currentUser = authService.getCurrentUser();
  const location = useLocation();
  // ADMIN/WAREHOUSE_MANAGER have the dedicated /ai-assistant page instead of the floating widget.
  const hasDedicatedAssistant = canAccess(currentUser, ROUTE_ACCESS.aiAssistant);

  return (
    <SocketProvider>
      <div className="h-screen flex overflow-hidden bg-background">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
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
