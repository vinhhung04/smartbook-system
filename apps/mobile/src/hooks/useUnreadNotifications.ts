import { useCallback, useEffect, useState } from 'react';

import * as engagementApi from '../api/customerEngagement';

// One shared count for every badge (home header, notification screen), updated in place
// when a notification is read, so badges never disagree between screens.
let sharedCount = 0;
const listeners = new Set<(count: number) => void>();

export function setUnreadCount(count: number) {
  sharedCount = Math.max(0, count);
  listeners.forEach((listener) => listener(sharedCount));
}

export function useUnreadNotifications() {
  const [count, setCount] = useState(sharedCount);

  useEffect(() => {
    listeners.add(setCount);
    return () => {
      listeners.delete(setCount);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await engagementApi.getUnreadNotificationCount();
      setUnreadCount(result.data.unread_count);
    } catch {
      // A missing badge is better than a wrong one: keep the last known count.
    }
  }, []);

  return { count, refresh };
}
