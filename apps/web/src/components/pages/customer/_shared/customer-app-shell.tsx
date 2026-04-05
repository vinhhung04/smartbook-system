import { ReactNode, useState } from 'react';
import { CustomerSidebar } from './customer-sidebar';
import { CustomerHeader } from './customer-header';

interface CustomerAppShellProps {
  children: ReactNode;
}

export function CustomerAppShell({ children }: CustomerAppShellProps) {
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <div className={['hidden lg:block shrink-0', isDesktopCollapsed ? 'w-[72px]' : 'w-[268px]'].join(' ')}>
          <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">
            <CustomerSidebar collapsed={isDesktopCollapsed} />
          </div>
        </div>

        {/* Mobile sidebar drawer */}
        {isMobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setIsMobileOpen(false)}>
            <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-y-0 left-0 h-full w-[268px] bg-card shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <CustomerSidebar onNavigate={() => setIsMobileOpen(false)} />
            </motion.div>
          </div>
        ) : null}

        {/* Main content */}
        <div className="min-w-0 flex-1 flex flex-col">
          <CustomerHeader
            onToggleMobileMenu={() => setIsMobileOpen((prev) => !prev)}
            onToggleDesktopCollapse={() => setIsDesktopCollapsed((prev) => !prev)}
            isDesktopCollapsed={isDesktopCollapsed}
          />
          <main className="flex-1">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

// Need to import motion for the mobile drawer animation
import { motion } from 'motion/react';
