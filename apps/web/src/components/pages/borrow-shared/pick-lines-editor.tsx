import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { borrowService, type PickOption } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { pickCountsTotal, type PickCounts } from './pick-counts';

/**
 * The shelves of a warehouse that hold this book, each with the number of copies the librarian
 * took from it. For a reservation, it starts on the shelves the system is holding copies on.
 */
export function PickLinesEditor({
  variantId,
  warehouseId,
  reservationId,
  quantity,
  value,
  onChange,
}: {
  variantId: string;
  warehouseId: string;
  reservationId?: string;
  quantity: number;
  value: PickCounts;
  onChange: (next: PickCounts) => void;
}) {
  const [options, setOptions] = useState<PickOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    borrowService.getPickOptions({ variant_id: variantId, warehouse_id: warehouseId, reservation_id: reservationId })
      .then((response) => {
        if (!active) return;
        const rows = response.data ?? [];
        setOptions(rows);
        const held = Object.fromEntries(rows.filter((row) => row.held_qty > 0).map((row) => [row.location_id, row.held_qty]));
        onChange(held);
      })
      .catch((loadError) => { if (active) setError(getApiErrorMessage(loadError, 'Không tải được danh sách vị trí')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // onChange comes from the parent's state setter; reload only when the book or place changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId, warehouseId, reservationId]);

  const total = pickCountsTotal(value);

  if (loading) {
    return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang tải vị trí có sách...</p>;
  }
  if (error) return <p className="text-xs text-red-700 dark:text-red-400">{error}</p>;
  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">Không có vị trí nào trong kho này còn sách này trên hệ thống.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Vị trí</th>
              <th className="px-3 py-2 text-right font-medium">Có thể lấy</th>
              <th className="w-24 px-3 py-2 text-right font-medium">Đã lấy</th>
            </tr>
          </thead>
          <tbody>
            {options.map((option) => {
              const max = option.available_qty + option.held_qty;
              const place = [option.zone, option.aisle, option.shelf, option.bin].filter(Boolean).join(' · ');
              return (
                <tr key={option.location_id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="block font-mono text-[13px] font-medium text-foreground">{option.location_code}</span>
                    {place ? <span className="block text-[11px] text-muted-foreground">{place}</span> : null}
                    {option.held_qty > 0 ? <span className="block text-[11px] text-primary">Hệ thống đang giữ {option.held_qty} cuốn ở đây</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{max}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      max={max}
                      inputMode="numeric"
                      aria-label={`Số cuốn đã lấy ở ${option.location_code}`}
                      value={value[option.location_id] ?? 0}
                      onChange={(event) => {
                        const next = Math.max(0, Math.min(max, Number.parseInt(event.target.value, 10) || 0));
                        onChange({ ...value, [option.location_id]: next });
                      }}
                      className="w-16 rounded-md border border-input bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={cn('text-xs tabular-nums', total === quantity ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300')}>
        Đã nhập {total}/{quantity} cuốn
      </p>
    </div>
  );
}
