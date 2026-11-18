// Internal incident notifications for the monitoring audience (ADMIN or a
// monitoring.* permission) - never customer notifications. monitoring-service
// stores every notification before pushing it, so the stored list is the source
// of truth: a socket event only triggers a reload, and a missed event (offline,
// reconnect) is recovered by the next load.
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSocketEvent } from '@/lib/socket';
import { incidentService, type SystemNotification } from '@/services/incidents';

const MONITORING_PERMISSIONS = ['monitoring.incidents.read', 'monitoring.incidents.manage', 'monitoring.settings.manage'];

interface UserLike { roles?: string[]; permissions?: string[]; is_superuser?: boolean }

export function canSeeSystemNotifications(user: UserLike | null | undefined) {
  if (!user) return false;
  if (user.is_superuser || (user.roles || []).map((role) => role.toUpperCase()).includes('ADMIN')) return true;
  return (user.permissions || []).some((permission) => MONITORING_PERMISSIONS.includes(permission));
}

export function useSystemNotifications(enabled: boolean) {
  const [items, setItems] = useState<SystemNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const reload = useCallback(() => incidentService.notifications({ page_size: 10 }).then(
    (result) => { setItems(result.items); setUnread(result.unread_count); },
    // monitoring-service down or no rights: keep what is shown, the bell still works for other events.
    () => undefined,
  ), []);

  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);

  useSocketEvent<{ title?: string; body?: string; kind?: string; severity?: string }>('incident:notification', (data) => {
    if (!enabled) return;
    const show = data?.severity === 'CRITICAL' || data?.severity === 'HIGH' ? toast.error : toast;
    show(data?.title || 'Sự cố hệ thống', { description: data?.body, duration: 8000 });
    void reload();
  });

  const markRead = useCallback(async (id: string) => {
    try {
      const result = await incidentService.markRead(id);
      setUnread(result.unread_count);
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, read_at: item.read_at || new Date().toISOString() } : item)));
    } catch { /* stays unread; retried on the next click */ }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await incidentService.markAllRead();
      setUnread(0);
      setItems((prev) => prev.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
    } catch { /* ignore: the server count is reloaded with the next event */ }
  }, []);

  return { items, unread, markRead, markAllRead };
}
