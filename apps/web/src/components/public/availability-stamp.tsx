import type { PublicBook } from '@/services/public-catalog';
import { cn } from '@/components/ui/utils';

/**
 * Library date-stamp for the states a reader can act on (on the shelf, arriving).
 * "All copies out" is the common case in a busy library, so it stays quiet text
 * instead of repeating a loud stamp on every card.
 */
export function AvailabilityStamp({ book, className }: { book: Pick<PublicBook, 'available_quantity' | 'availability_status' | 'pickup_branches'>; className?: string }) {
  if (book.availability_status === 'UNAVAILABLE') {
    return <span className={cn('text-[12px] text-muted-foreground', className)}>Đã được mượn hết</span>;
  }

  const available = book.availability_status === 'AVAILABLE';
  const branches = book.pickup_branches.length;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[4px] border border-dashed px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.04em]',
        available
          ? 'border-emerald-600/50 text-emerald-700 dark:border-emerald-400/50 dark:text-emerald-400'
          : 'border-amber-600/50 text-amber-700 dark:border-amber-400/50 dark:text-amber-400',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', available ? 'bg-emerald-500' : 'bg-amber-500')} aria-hidden="true" />
      {available ? `Còn ${book.available_quantity} cuốn${branches > 1 ? ` · ${branches} chi nhánh` : ''}` : 'Đang nhập kho'}
    </span>
  );
}
