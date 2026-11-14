import { getStatusTone } from './customer-status';

interface StatusBadgeProps {
  status?: string | null;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const tone = getStatusTone(status);
  return <span className={`inline-flex rounded-[8px] border px-2 py-1 text-[12px] ${tone.className}`}>{tone.label}</span>;
}
