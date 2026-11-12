import { useState } from 'react';
import { PackagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatCount, formatVnd, type LineTotals } from '@/lib/reorder-intelligence';
import { useRevealOnMount } from './meta';

/**
 * Sticky summary of the purchase-order selection. The CTA only opens the
 * purchase-order form with these lines; supplier, warehouse and the final check
 * happen there.
 */
export function SelectionActionBar({ totals, budgetVnd, overFunded, loadedCount, selectableUnselected, onSelectAllLoaded, onClear, onCreate, locked }: {
  totals: LineTotals;
  budgetVnd: number | null;
  /** Copies selected beyond what the budget funds (0 without a budget). */
  overFunded: number;
  loadedCount: number;
  /** Lines with an order quantity that are loaded but not selected (hidden by a filter or just unticked). */
  selectableUnselected: number;
  onSelectAllLoaded: () => void;
  onClear: () => void;
  onCreate: () => void;
  locked: boolean;
}) {
  const ref = useRevealOnMount<HTMLDivElement>(14);
  const blocked = totals.invalidQty > 0;
  const overBudget = budgetVnd !== null && totals.cost > budgetVnd;
  // Leaving the budget plan (more copies than funded, or more money than the budget) is allowed, but only knowingly.
  const needsConfirm = overFunded > 0 || overBudget;
  const [confirming, setConfirming] = useState(false);

  return (
    <div ref={ref} className="sticky bottom-3 z-20 mt-3 sm:bottom-4">
      <div
        role="region"
        aria-label="Lựa chọn để tạo đơn đặt hàng"
        className="mx-auto flex max-w-4xl flex-col gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-[0_8px_30px_rgba(15,15,18,0.12)] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:flex-row sm:items-center dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
      >
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-[13px] text-foreground">
            <span className="font-semibold">{formatCount(totals.lines)} đầu sách</span>
            <span className="text-muted-foreground"> · </span>
            <span className="tabular-nums">{formatCount(totals.qty)} bản</span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-semibold tabular-nums">{formatVnd(totals.cost)}</span>
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            {blocked ? <span className="text-red-700 dark:text-red-400">{totals.invalidQty} dòng cần số lượng hợp lệ trước khi tạo đơn. </span> : null}
            {totals.missingCost ? <span className="text-amber-700 dark:text-amber-400">{totals.missingCost} dòng chưa có đơn giá, không tính vào tổng. </span> : null}
            {overBudget ? <span className="text-red-700 dark:text-red-400">Vượt ngân sách {formatVnd(totals.cost - (budgetVnd ?? 0))}. </span> : null}
            {overFunded > 0 ? <span className="text-amber-700 dark:text-amber-400">{formatCount(overFunded)} bản ngoài phần được cấp ngân sách. </span> : null}
            {selectableUnselected > 0 ? (
              <button type="button" onClick={onSelectAllLoaded} disabled={locked} className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
                Chọn cả {formatCount(selectableUnselected)} dòng có số lượng còn lại trong {formatCount(loadedCount)} đề xuất đã tải
              </button>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={locked}>Bỏ chọn</Button>
          <Button type="button" size="sm" onClick={() => (needsConfirm ? setConfirming(true) : onCreate())} disabled={blocked || locked} className="flex-1 sm:flex-none">
            <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" />
            Tạo đơn đặt hàng
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Tạo đơn vượt kế hoạch ngân sách?"
        description={[
          overFunded > 0 ? `${formatCount(overFunded)} bản đang chọn nằm ngoài số bản hệ thống cấp ngân sách.` : '',
          overBudget ? `Tổng chi phí vượt ngân sách nhập vào ${formatVnd(totals.cost - (budgetVnd ?? 0))}.` : '',
          'Đơn chỉ được mở ở dạng nháp để bạn kiểm tra lại.',
        ].filter(Boolean).join(' ')}
        confirmLabel="Vẫn tạo đơn nháp"
        onConfirm={() => { setConfirming(false); onCreate(); }}
      />
    </div>
  );
}
