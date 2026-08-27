import { CUSTOMER_STATUS, TONE_CLASSNAME } from '@/lib/status-registry';

type StatusTone = {
  label: string;
  className: string;
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
