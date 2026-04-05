import { Outlet } from "react-router";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { AIChatbot } from "./ai-chatbot";
import { useState } from "react";
import { SocketProvider } from "@/lib/socket";

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
        <AIChatbot />
      </div>
    </SocketProvider>
  );
}
