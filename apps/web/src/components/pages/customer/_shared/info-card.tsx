import { ReactNode } from 'react';

interface InfoCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}

export function InfoCard({ label, value, hint, className = '' }: InfoCardProps) {
  return (
    <div className={`rounded-[12px] border border-border bg-card p-4 ${className}`}>
      <div className="text-[11px] uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">{label}</div>
      <div className="mt-1 text-[14px] text-foreground" style={{ fontWeight: 700 }}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-[12px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
