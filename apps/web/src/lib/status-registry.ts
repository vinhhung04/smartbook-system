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
  loan: {
    RESERVED: 'primary',
    BORROWED: 'info',
    RETURNED: 'success',
    OVERDUE: 'rose',
    LOST: 'rose',
    DAMAGED: 'rose',
    CANCELLED: 'neutral',
  },
  reservation: {
    PENDING: 'warning',
    CONFIRMED: 'info',
    READY_FOR_PICKUP: 'info',
    CONVERTED_TO_LOAN: 'success',
    CANCELLED: 'neutral',
    EXPIRED: 'neutral',
  },
  borrowCustomer: {
    ACTIVE: 'success',
    SUSPENDED: 'warning',
    BLOCKED: 'danger',
    INACTIVE: 'neutral',
  },
  fine: {
    PAID: 'success',
    WAIVED: 'neutral',
    PARTIALLY_PAID: 'warning',
    UNPAID: 'rose',
  },
  supplier: {
    ACTIVE: 'success',
    INACTIVE: 'neutral',
  },
} satisfies Record<string, ToneMap>;

export type StatusDomain = keyof typeof DOMAINS;

export function getStatusVariant(domain: StatusDomain, status: string, fallback: Tone = 'neutral'): Tone {
  const map: ToneMap = DOMAINS[domain];
  return map[String(status || '').toUpperCase()] ?? fallback;
}

// Single source of truth for tone -> Tailwind classes, shared by status-badge.tsx
// and the customer portal's status badge (customer-status.ts) — they previously
// each hardcoded their own copy of this map, and had drifted (different shades,
// and the customer-portal copy had no dark-mode classes at all).
export const TONE_CLASSNAME: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200/70 shadow-emerald-100/40 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20 dark:shadow-none",
  warning: "bg-amber-50 text-amber-700 border-amber-200/70 shadow-amber-100/40 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20 dark:shadow-none",
  danger: "bg-red-50 text-red-600 border-red-200/70 shadow-red-100/40 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20 dark:shadow-none",
  info: "bg-sky-50 text-sky-700 border-sky-200/70 shadow-sky-100/40 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20 dark:shadow-none",
  neutral: "bg-slate-50 text-slate-600 border-slate-200/70 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20",
  primary: "bg-indigo-50 text-indigo-700 border-indigo-200/70 shadow-indigo-100/40 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20 dark:shadow-none",
  violet: "bg-violet-50 text-violet-700 border-violet-200/70 shadow-violet-100/40 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20 dark:shadow-none",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200/70 shadow-cyan-100/40 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/20 dark:shadow-none",
  teal: "bg-teal-50 text-teal-700 border-teal-200/70 shadow-teal-100/40 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/20 dark:shadow-none",
  amber: "bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  rose: "bg-rose-50 text-rose-600 border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
};

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
