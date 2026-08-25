import { Outlet } from "react-router";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { AIChatbot } from "./ai-chatbot";
import { useState } from "react";
import { SocketProvider } from "@/lib/socket";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const currentUser = authService.getCurrentUser();
  // ADMIN/WAREHOUSE_MANAGER have the dedicated /ai-assistant page instead of the floating widget.
  const hasDedicatedAssistant = canAccess(currentUser, ROUTE_ACCESS.aiAssistant);

  return (
    <SocketProvider>
      <div className="h-screen flex overflow-hidden bg-background">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 overflow-y-auto scroll-smooth">
            <Outlet />
          </main>
        </div>
        {!hasDedicatedAssistant && <AIChatbot />}
      </div>
    </SocketProvider>
  );
}
