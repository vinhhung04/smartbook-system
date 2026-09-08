import { ReactNode } from 'react';
import { Search } from 'lucide-react';

interface SearchFilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
}

export function SearchFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filters,
  actions,
}: SearchFilterBarProps) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-4 md:p-5">
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 max-w-2xl">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-10 w-full rounded-[10px] border border-border py-2 pl-9 pr-3 text-[13px] text-slate-700 dark:text-slate-300 outline-none focus:border-indigo-300 focus:ring-[3px] focus:ring-indigo-500/10"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filters}
          {actions}
        </div>
      </div>
    </div>
  );
}
