import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination';
import { cn } from '@/components/ui/utils';
import { getPaginationRange } from '@/lib/pagination';

/** "Hiển thị 21–40 / 23.114 phiếu mượn" plus page links, for a server-paginated list. */
export function ListFooter({
  page,
  pageSize,
  total,
  totalPages,
  shown,
  noun,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  shown: number;
  noun: string;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = from + shown - 1;

  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        Hiển thị <span className="font-medium text-foreground">{from.toLocaleString('vi-VN')}–{to.toLocaleString('vi-VN')}</span> / {total.toLocaleString('vi-VN')} {noun}
      </span>
      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={(event) => { event.preventDefault(); onPageChange(Math.max(1, page - 1)); }}
                className={cn('cursor-pointer', page === 1 && 'pointer-events-none opacity-50')}
              />
            </PaginationItem>
            {getPaginationRange(page, totalPages).map((item, i) => (
              <PaginationItem key={`${item}-${i}`}>
                {typeof item === 'number' ? (
                  <PaginationLink isActive={item === page} onClick={(event) => { event.preventDefault(); onPageChange(item); }} className="cursor-pointer">
                    {item.toLocaleString('vi-VN')}
                  </PaginationLink>
                ) : (
                  <PaginationEllipsis />
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={(event) => { event.preventDefault(); onPageChange(Math.min(totalPages, page + 1)); }}
                className={cn('cursor-pointer', page === totalPages && 'pointer-events-none opacity-50')}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
