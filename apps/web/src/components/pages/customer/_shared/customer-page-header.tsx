import { ReactNode } from 'react';

interface CustomerPageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function CustomerPageHeader({ title, subtitle, actions }: CustomerPageHeaderProps) {
  return (
    <div className="rounded-[16px] border border-border bg-card px-5 py-4 md:px-6 md:py-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-[20px] tracking-[-0.02em] text-foreground" style={{ fontWeight: 700 }}>
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-[12px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
