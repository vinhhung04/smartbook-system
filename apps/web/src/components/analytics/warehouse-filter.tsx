import { Warehouse as WarehouseIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Warehouse } from '@/services/warehouse';

const ALL = 'all';

/** Picks one warehouse of the caller's scope for an analytics page (see useWarehouseFilter). */
export function WarehouseFilter({ warehouses, value, onChange, className }: {
  warehouses: Warehouse[];
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  // One warehouse in scope: "all" and that warehouse are the same figures.
  if (warehouses.length < 2) return null;
  return (
    <Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? '' : next)}>
      <SelectTrigger className={className ?? 'h-9 w-full sm:w-72'} aria-label="Xem số liệu theo kho">
        <WarehouseIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Tất cả kho ({warehouses.length})</SelectItem>
        {warehouses.map((w) => (
          <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
