import { Outlet } from "react-router";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useState } from "react";
import { Toaster } from "sonner";

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="h-screen flex overflow-hidden bg-[#f4f5fa]">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto scroll-smooth">
          <Outlet />
        </main>
      </div>
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { borderRadius: "12px", fontSize: "13px", fontWeight: 500 } }} />
    </div>
  );
}
