import { Outlet } from 'react-router';
import { CustomerAppShell } from './_shared/customer-app-shell';
import { SocketProvider } from '@/lib/socket';

export function CustomerLayout() {
  return (
    <SocketProvider>
      <CustomerAppShell>
        <Outlet />
      </CustomerAppShell>
    </SocketProvider>
  );
}
