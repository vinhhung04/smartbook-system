import { CUSTOMER_STATUS, type Tone } from '@/lib/status-registry';

type StatusTone = {
  label: string;
  className: string;
};

// Same soft/rounded visual shell this file always used — just keyed by the
// shared registry's `tone` now instead of a second hardcoded per-status map.
const TONE_CLASSNAME: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  primary: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function getStatusTone(status?: string | null): StatusTone {
  if (!status) {
    return { label: 'Unknown', className: TONE_CLASSNAME.neutral };
  }

  const normalized = status.toUpperCase();
  const entry = CUSTOMER_STATUS[normalized];
  if (entry) {
    return { label: entry.label, className: TONE_CLASSNAME[entry.tone] };
  }

  return {
    label: status.replace(/_/g, ' ').toLowerCase().replace(/(^\w|\s\w)/g, (m: string) => m.toUpperCase()),
    className: TONE_CLASSNAME.neutral,
  };
}
