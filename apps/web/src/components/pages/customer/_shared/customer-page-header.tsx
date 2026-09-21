import { ReactNode } from 'react';

interface CustomerPageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Page title block. The app bar no longer repeats the title, so each page owns its <h1>. */
export function CustomerPageHeader({ title, subtitle, actions }: CustomerPageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight text-foreground sm:text-[26px]">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
