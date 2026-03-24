import * as React from "react";
import { cn } from "./utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DataTableProps {
  children: React.ReactNode;
  className?: string;
}

export function DataTable({ children, className }: DataTableProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-black/5 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface DataTableHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function DataTableHeader({ children, className }: DataTableHeaderProps) {
  return (
    <thead className={cn("", className)}>
      <tr className="border-b border-border bg-muted/30">
        {children}
      </tr>
    </thead>
  );
}

interface DataTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sortActive?: boolean;
  sortDir?: "asc" | "desc";
}

export function DataTableHead({
  children,
  sortable,
  sortActive,
  sortDir,
  className,
  ...props
}: DataTableHeadProps) {
  return (
    <th
      className={cn(
        "text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-5 py-3",
        sortable && "cursor-pointer select-none hover:text-foreground transition-colors",
        className,
      )}
      {...props}
    >
      <div className={cn("inline-flex items-center gap-1", sortable && "justify-between")}>
        {children}
        {sortable && sortActive && (
          <ChevronLeft
            className={cn(
              "w-3 h-3 transition-transform",
              sortDir === "desc" && "rotate-180",
            )}
          />
        )}
      </div>
    </th>
  );
}

export function DataTableBody({ children, className }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("", className)}>{children}</tbody>;
}

export function DataTableRow({
  children,
  hoverable = true,
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { hoverable?: boolean }) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-0 transition-colors",
        hoverable && "hover:bg-muted/40",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function DataTableCell({
  children,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-5 py-3.5 text-[13px] text-foreground align-middle", className)}
      {...props}
    >
      {children}
    </td>
  );
}

/** Pagination bar for data tables */
interface DataTablePaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function DataTablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  className,
}: DataTablePaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  const start = Math.min((page - 1) * pageSize + 1, total);
  const end = Math.min(page * pageSize, total);

  return (
    <div
      className={cn(
        "flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground",
        className,
      )}
    >
      <span>
        Showing {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
          const pageNum = i + 1;
          return (
            <button
              key={i}
              onClick={() => onPageChange(pageNum)}
              className={cn(
                "w-7 h-7 rounded-md text-[12px] transition-colors",
                pageNum === page
                  ? "bg-primary text-primary-foreground font-medium"
                  : "hover:bg-muted",
              )}
            >
              {pageNum}
            </button>
          );
        })}
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
