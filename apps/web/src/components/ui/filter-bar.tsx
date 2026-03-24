import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "./utils";

interface FilterBarProps {
  /** Search input value */
  searchValue?: string;
  /** Search input change handler */
  onSearchChange?: (value: string) => void;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** Show clear button when search has value */
  showSearchClear?: boolean;
  /** Filter controls (select, tabs, etc.) */
  filters?: React.ReactNode;
  /** Right-side action buttons */
  actions?: React.ReactNode;
  className?: string;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  showSearchClear = true,
  filters,
  actions,
  className,
}: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center",
        className,
      )}
    >
      {/* Search input */}
      {onSearchChange !== undefined && (
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              "w-full pl-9 pr-9 py-2.5 rounded-xl border border-input bg-background text-[13px]",
              "outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40",
              "placeholder:text-muted-foreground",
              "transition-all duration-150",
            )}
          />
          {showSearchClear && searchValue && searchValue.length > 0 && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      {filters && <div className="flex items-center gap-2 flex-wrap">{filters}</div>}

      {/* Actions */}
      {actions && (
        <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
          {actions}
        </div>
      )}
    </div>
  );
}
