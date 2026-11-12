import { Outlet, useLocation } from 'react-router';
import { CustomerAppShell } from './_shared/customer-app-shell';
import { SocketProvider } from '@/lib/socket';
import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { AIChatbot } from '@/components/ai-chatbot';

export function CustomerLayout() {
  const location = useLocation();

  return (
    <SocketProvider>
      <CustomerAppShell>
        <RouteErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </RouteErrorBoundary>
      </CustomerAppShell>
      <AIChatbot aboveBottomNav />
    </SocketProvider>
  );
}
