// Where a customer notification leads when clicked. Import-free on purpose:
// tests/notification-links.test.mjs transpiles it on Node 20 (see ai-decision.ts).

export interface NotificationReference {
  reference_type?: string | null;
  reference_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

/** In-app route for the entity a notification is about, or null when there is
 *  nothing more specific to open than the notification itself. */
export function notificationTarget(item: NotificationReference): string | null {
  const id = uuid(item.reference_id);
  switch (String(item.reference_type || '').toUpperCase()) {
    case 'LOAN_TRANSACTION':
      return id ? `/customer/loans/${id}` : '/customer/loans';
    case 'LOAN_ITEM': {
      // Due-date reminders point at one item; its loan id travels in metadata.
      const loanId = uuid(item.metadata?.loan_id);
      return loanId ? `/customer/loans/${loanId}` : '/customer/loans';
    }
    case 'LOAN_RESERVATION':
      // The web portal has no per-reservation page; the list shows its pickup code.
      return '/customer/reservations';
    case 'FINE':
      return '/customer/fines';
    case 'BOOK':
      return id ? `/books/${id}` : null;
    default:
      return null;
  }
}
