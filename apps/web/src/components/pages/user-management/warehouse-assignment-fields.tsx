import { Plus, Star, Trash2, Warehouse as WarehouseIcon } from "lucide-react";
import type { Warehouse } from "@/services/warehouse";
import type { WarehouseAccessLevel } from "@/services/user";
import { cn } from "@/components/ui/utils";
import { ACCESS_LEVEL_OPTIONS, canActWith, type ScopeDraft } from "./warehouse-access";

interface WarehouseAssignmentFieldsProps {
  warehouses: Warehouse[];
  rows: ScopeDraft[];
  onRowsChange: (rows: ScopeDraft[]) => void;
  primaryWarehouseId: string | null;
  onPrimaryChange: (warehouseId: string | null) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
}

const FIELD_CLASS = "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 disabled:opacity-60";

/**
 * "Phân công kho làm việc": one row per warehouse (no duplicates - a picked
 * warehouse is disabled in the other rows), its access level, and which one is
 * the primary warehouse. The primary is only a default, never a grant, so it
 * can only be one of the rows.
 */
export function WarehouseAssignmentFields({
  warehouses,
  rows,
  onRowsChange,
  primaryWarehouseId,
  onPrimaryChange,
  loading = false,
  error = null,
  disabled = false,
}: WarehouseAssignmentFieldsProps) {
  const used = new Set(rows.map((row) => row.warehouse_id).filter(Boolean));
  const canAdd = !disabled && rows.length < warehouses.length;

  const updateRow = (index: number, patch: Partial<ScopeDraft>) => {
    const previous = rows[index];
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onRowsChange(next);
    // moving the primary row to another warehouse moves the primary with it
    if (patch.warehouse_id !== undefined && previous.warehouse_id && previous.warehouse_id === primaryWarehouseId) {
      onPrimaryChange(patch.warehouse_id || null);
    }
  };

  const removeRow = (index: number) => {
    const removed = rows[index];
    onRowsChange(rows.filter((_, i) => i !== index));
    if (removed.warehouse_id && removed.warehouse_id === primaryWarehouseId) onPrimaryChange(null);
  };

  const addRow = () => {
    onRowsChange([...rows, { warehouse_id: "", access_level: "OPERATOR" }]);
  };

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <legend className="text-[13px] font-semibold">Phân công kho làm việc</legend>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Người dùng chỉ thấy và thao tác dữ liệu của các kho được phân công. Kho chính chỉ là kho mặc định, không tự cấp quyền.
          </p>
        </div>
        <button
          type="button"
          onClick={addRow}
          disabled={!canAdd || loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-[12px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="add-warehouse-scope"
        >
          <Plus className="h-3.5 w-3.5" /> Thêm kho
        </button>
      </div>

      {loading ? (
        <div className="rounded-lg border border-dashed border-input px-3 py-3 text-[12px] text-muted-foreground">Đang tải danh sách kho...</div>
      ) : error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-[12px] text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-input px-3 py-3 text-[12px] text-muted-foreground">
          <WarehouseIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          Chưa phân công kho nào: tài khoản này sẽ không truy cập được dữ liệu kho.
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Các kho được phân công">
          {rows.map((row, index) => {
            const isPrimary = Boolean(row.warehouse_id) && row.warehouse_id === primaryWarehouseId;
            const label = warehouses.find((w) => w.id === row.warehouse_id);
            return (
              <li
                key={`${row.warehouse_id || "new"}-${index}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] sm:items-center"
                data-testid="warehouse-scope-row"
              >
                <select
                  aria-label={`Kho ${index + 1}`}
                  value={row.warehouse_id}
                  onChange={(event) => updateRow(index, { warehouse_id: event.target.value })}
                  className={cn(FIELD_CLASS, "col-span-2 sm:col-span-1")}
                >
                  <option value="">Chọn kho...</option>
                  {warehouses.map((warehouse) => (
                    <option
                      key={warehouse.id}
                      value={warehouse.id}
                      disabled={(used.has(warehouse.id) && warehouse.id !== row.warehouse_id) || (warehouse.is_active === false && warehouse.id !== row.warehouse_id)}
                    >
                      {warehouse.code} · {warehouse.name}{warehouse.is_active === false ? " (ngừng hoạt động)" : ""}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Mức quyền ở ${label?.code || `kho ${index + 1}`}`}
                  value={row.access_level}
                  onChange={(event) => updateRow(index, { access_level: event.target.value as WarehouseAccessLevel })}
                  className={FIELD_CLASS}
                  title={ACCESS_LEVEL_OPTIONS.find((o) => o.value === row.access_level)?.hint}
                >
                  {ACCESS_LEVEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <label
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-2 text-[12px] font-medium",
                    isPrimary
                      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                      : "border-input text-muted-foreground hover:bg-muted",
                    !row.warehouse_id && "cursor-not-allowed opacity-50",
                  )}
                >
                  <input
                    type="radio"
                    name="primary-warehouse"
                    className="sr-only"
                    checked={isPrimary}
                    disabled={!row.warehouse_id}
                    onChange={() => onPrimaryChange(row.warehouse_id)}
                  />
                  <Star className={cn("h-3.5 w-3.5", isPrimary && "fill-current")} aria-hidden="true" />
                  {isPrimary ? "Kho chính" : "Đặt làm kho chính"}
                </label>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  aria-label={`Thu hồi ${label?.code || `kho ${index + 1}`}`}
                  title="Thu hồi kho này"
                  className="inline-flex h-9 w-9 items-center justify-center justify-self-end rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                {!canActWith(row.access_level) && row.warehouse_id ? (
                  <p className="col-span-2 text-[11px] text-muted-foreground sm:col-span-4">
                    Mức Chỉ xem không nhận được việc ở kho này.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > 0 && !primaryWarehouseId ? (
        <p className="text-[11px] text-muted-foreground">Chưa chọn kho chính (không bắt buộc).</p>
      ) : null}
      {primaryWarehouseId ? (
        <button
          type="button"
          onClick={() => onPrimaryChange(null)}
          className="text-[11px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Bỏ chọn kho chính
        </button>
      ) : null}
    </fieldset>
  );
}
