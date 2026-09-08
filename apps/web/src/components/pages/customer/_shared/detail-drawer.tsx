import { ReactNode, useRef } from 'react';
import { X } from 'lucide-react';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface DetailDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function DetailDrawer({ open, title, onClose, children }: DetailDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, onClose, containerRef);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="detail-drawer-title">
      <div className="absolute inset-0 bg-slate-900/35" onClick={onClose} />
      <div ref={containerRef} className="absolute right-0 top-0 h-full w-full max-w-md border-l border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 id="detail-drawer-title" className="text-[15px] text-foreground" style={{ fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} aria-label="Đóng" className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-border text-slate-600 dark:text-slate-300 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="h-[calc(100%-57px)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
