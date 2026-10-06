import { NotificationItem, type CustomerNotification } from './notification-item';

interface NotificationListItemProps {
  item: CustomerNotification;
  onMarkedRead?: (id: string, unreadCount?: number) => void;
}

export function NotificationListItem({ item, onMarkedRead }: NotificationListItemProps) {
  return <NotificationItem item={item} onMarkedRead={onMarkedRead} />;
}
