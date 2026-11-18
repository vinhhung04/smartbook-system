import { cn } from '@/components/ui/utils';
import type { IncidentSeverity, IncidentStatus } from '@/services/incidents';
import { SEVERITY_META, STATUS_LABEL, STATUS_STYLE } from './incident-format';

export function SeverityBadge({ severity, className }: { severity: IncidentSeverity; className?: string }) {
  const meta = SEVERITY_META[severity];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold', meta.badge, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function StatusPill({ status }: { status: IncidentStatus }) {
  return <span className={cn('inline-flex whitespace-nowrap rounded-full border bg-card px-2 py-0.5 text-[11px] font-semibold', STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;
}
