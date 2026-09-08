import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import { ReactNode } from 'react';

interface CustomerStateBlockProps {
  mode: 'loading' | 'error' | 'empty';
  message: string;
  action?: ReactNode;
  illustration?: ReactNode;
}

export function CustomerStateBlock({ mode, message, action, illustration }: CustomerStateBlockProps) {
  const icon = mode === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'error' ? <AlertCircle className="h-4 w-4" /> : <Inbox className="h-4 w-4" />;

  const toneClassName =
    mode === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-400'
      : mode === 'loading'
        ? 'border-border bg-card text-muted-foreground'
        : 'border-border bg-muted text-muted-foreground';

  return (
    <div className={`rounded-[14px] border p-5 md:p-6 ${toneClassName}`}>
      {illustration && mode !== 'loading' ? <div className="mb-3 flex justify-center">{illustration}</div> : null}
      <div className="flex items-start gap-3 text-[13px]">
        <div className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-[9px] border border-current/15 bg-card/75">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p>{message}</p>
          {mode === 'loading' ? (
            <div className="mt-3 space-y-2">
              <div className="h-2.5 w-4/5 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-3/5 animate-pulse rounded bg-muted" />
            </div>
          ) : null}
        </div>
      </div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
