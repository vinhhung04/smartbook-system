import { useState, useCallback } from 'react';
import { useSocketEvent } from '@/lib/socket';

export interface RealtimeNotification {
  id: string;
  subject: string | null;
  body: string;
  template_code: string | null;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at?: string | null;
}

export function useRealtimeNotifications(initialItems: RealtimeNotification[] = []) {
  const [notifications, setNotifications] = useState<RealtimeNotification[]>(initialItems);

  useSocketEvent<RealtimeNotification>('notification:new', (data) => {
    setNotifications((prev) => [data, ...prev]);
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
  }, []);

  return { notifications, setNotifications, unreadCount, markAllRead };
}
