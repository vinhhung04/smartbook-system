// Shared source of truth for status -> badge color across pages that previously
// hand-rolled their own status->variant mapping (and had drifted, e.g. the same
// status showing a different color depending on which page rendered it).

export type Tone =
  | 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  | 'primary' | 'violet' | 'cyan' | 'teal' | 'amber' | 'rose';

type ToneMap = Record<string, Tone>;

const DOMAINS = {
  // Purchase order status (purchase-orders.tsx list) plus the related sub-entity
  // statuses shown on purchase-order-detail.tsx (dispatch, invoice, shortage
  // report, reconciliation, goods receipt) — that page already reused one
  // function across all of them, so they share one domain here too.
  purchaseOrder: {
    RECEIVED: 'success', MATCHED: 'success', FULLY_RECEIVED: 'success',
    APPROVED: 'primary', SENT: 'primary', ACKNOWLEDGED: 'primary', SUPPLIER_CONFIRMED: 'primary',
    PENDING_APPROVAL: 'warning', UNDER_RECEIVED: 'warning', PARTIALLY_RECEIVED: 'warning',
    SENT_TO_SUPPLIER: 'warning', SHORTAGE_REPORTED: 'warning', SUBMITTED: 'warning', OPEN: 'warning',
    REJECTED: 'danger', CANCELLED: 'danger', OVER_RECEIVED: 'danger', FAILED: 'danger',
  },
  purchaseRequest: {
    APPROVED: 'success', CONVERTED: 'success',
    PENDING: 'warning',
    REJECTED: 'danger',
  },
  exceptionReport: {
    RESOLVED: 'success',
    ACKNOWLEDGED: 'warning',
    OPEN: 'danger',
  },
} satisfies Record<string, ToneMap>;

export type StatusDomain = keyof typeof DOMAINS;

export function getStatusVariant(domain: StatusDomain, status: string, fallback: Tone = 'neutral'): Tone {
  const map: ToneMap = DOMAINS[domain];
  return map[String(status || '').toUpperCase()] ?? fallback;
}

// Ported 1:1 from picking.tsx's local `taskStatusVariant` — substring-matched
// against the picking task status, kept here so it has one owner instead of
// silently diverging from the (differently-behaved) copy in warehouse tasks.
export function getPickingTaskStatusVariant(status: string): Tone {
  const upper = String(status || '').toUpperCase();
  if (upper.includes('COMPLETED') || upper.includes('DONE')) return 'success';
  if (upper.includes('PICKING') || upper.includes('IN_PROGRESS')) return 'info';
  if (upper.includes('SHORT') || upper.includes('CANCEL')) return 'danger';
  if (upper.includes('PENDING') || upper.includes('READY')) return 'warning';
  return 'neutral';
}

// Ported 1:1 from my-warehouse-tasks.tsx's local `taskStatusVariant` — same
// function name as the one above in the old code, but different logic
// (different task set: putaway/transfer/outbound rather than picking).
export function getWarehouseTaskStatusVariant(status: string): Tone {
  const upper = String(status || '').toUpperCase();
  if (upper.includes('DONE') || upper.includes('COMPLETE') || upper.includes('POSTED') || upper.includes('RECEIVED')) return 'success';
  if (upper.includes('PROGRESS') || upper.includes('PICKING')) return 'info';
  if (upper.includes('PENDING') || upper.includes('READY') || upper.includes('APPROVED')) return 'warning';
  if (upper.includes('CANCEL') || upper.includes('REJECT')) return 'danger';
  return 'neutral';
}

// Customer-portal statuses (loan / reservation / fine / generic workflow) —
// consumed by components/pages/customer/_shared/customer-status.ts, which
// keeps its own softer visual shell but now sources label+tone from here
// instead of a separate hardcoded map.
export const CUSTOMER_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  OVERDUE: { label: 'Overdue', tone: 'rose' },
  RETURNED: { label: 'Returned', tone: 'neutral' },
  PENDING: { label: 'Pending', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'rose' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  READY_FOR_PICKUP: { label: 'Ready for pickup', tone: 'info' },
  OUT_OF_STOCK: { label: 'Out of stock', tone: 'neutral' },
  UNPAID: { label: 'Unpaid', tone: 'rose' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  WAIVED: { label: 'Waived', tone: 'primary' },
};
