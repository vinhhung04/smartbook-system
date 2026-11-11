import { useEffect, useState } from "react";
import { Pencil, RefreshCw, Star, Users } from "lucide-react";
import type { Warehouse } from "@/services/warehouse";
import { userService, type WarehouseStaffMember } from "@/services/user";
import { getApiErrorMessage } from "@/services/api";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/components/ui/utils";
import { ACCESS_LEVEL_LABELS, canActWith } from "./warehouse-access";

interface WarehouseStaffPanelProps {
  warehouses: Warehouse[];
  warehouseId: string;
  onWarehouseChange: (warehouseId: string) => void;
  onEditUser: (userId: string) => void;
  /** bumps when an assignment was saved elsewhere on the page */
  refreshKey: number;
}

function statusVariant(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "LOCKED") return "danger";
  if (status === "PENDING") return "warning";
  return "neutral";
}

/** Everyone holding a scope row on one warehouse, with their access level there. */
export function WarehouseStaffPanel({ warehouses, warehouseId, onWarehouseChange, onEditUser, refreshKey }: WarehouseStaffPanelProps) {
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: WarehouseStaffMember[]; error: string | null } | null>(null);
  const requestKey = `${warehouseId}:${refreshKey}:${reloadToken}`;

  useEffect(() => {
    if (!warehouseId) return undefined;
    let cancelled = false;
    userService.getStaffByWarehouse(warehouseId)
      .then((response) => { if (!cancelled) setResult({ key: requestKey, rows: Array.isArray(response.data) ? response.data : [], error: null }); })
      .catch((err) => { if (!cancelled) setResult({ key: requestKey, rows: [], error: getApiErrorMessage(err, "Không tải được nhân sự của kho") }); });
    return () => { cancelled = true; };
  }, [warehouseId, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const rows = current?.rows ?? [];
  const error = current?.error ?? null;
  const loading = Boolean(warehouseId) && !current;

  const warehouse = warehouses.find((w) => w.id === warehouseId);
  const actingCount = rows.filter((row) => row.status === "ACTIVE" && canActWith(row.access_level)).length;

  return (
    <SectionCard noPadding>
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Nhân sự theo kho</h2>
          <p className="text-[12px] text-muted-foreground">
            {warehouse
              ? `${rows.length} người có quyền ở ${warehouse.code} · ${actingCount} đang hoạt động và nhận được việc`
              : "Chọn một kho để xem ai đang được phân công"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={warehouseId} onValueChange={onWarehouseChange}>
            <SelectTrigger className="w-[240px]" size="sm" aria-label="Chọn kho">
              <SelectValue placeholder="Chọn kho" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={() => setReloadToken((v) => v + 1)} disabled={loading || !warehouseId} aria-label="Tải lại nhân sự kho">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {[
                { label: "Nhân sự", className: "" },
                { label: "Vai trò", className: "w-[170px]" },
                { label: "Mức quyền", className: "w-[130px]" },
                { label: "Trạng thái", className: "w-[120px]" },
                { label: "", className: "w-[64px]" },
              ].map((header, index) => (
                <th key={header.label || index} className={cn("px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", header.className)}>
                  {header.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!warehouseId ? (
              <tr><td colSpan={5}><EmptyState variant="no-data" icon={Users} title="Chưa chọn kho" description="Chọn kho ở góc trên để xem nhân sự." className="py-10" /></td></tr>
            ) : loading ? (
              <SkeletonTableRow columns={5} rows={4} />
            ) : error ? (
              <tr>
                <td colSpan={5} className="px-5 py-8">
                  <div role="alert" className="flex flex-col items-center gap-3 text-center text-[13px] text-red-700 dark:text-red-300">
                    {error}
                    <Button type="button" variant="outline" size="sm" onClick={() => setReloadToken((v) => v + 1)}>Thử lại</Button>
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5}><EmptyState variant="no-data" icon={Users} title="Kho này chưa có ai được phân công" description="Mở người dùng và thêm kho trong mục Phân công kho làm việc." className="py-10" /></td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold">
                      <span className="truncate">{row.full_name || row.username}</span>
                      {row.is_primary ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" title="Kho chính của người này">
                          <Star className="h-3 w-3 fill-current" aria-hidden="true" /> Kho chính
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-[12px] text-muted-foreground">{row.username} · {row.email}</p>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{row.roles.join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      canActWith(row.access_level)
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground",
                    )}>
                      {ACCESS_LEVEL_LABELS[row.access_level] || row.access_level}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge label={row.status} variant={statusVariant(row.status)} /></td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onEditUser(row.id)}
                      aria-label={`Sửa phân công của ${row.username}`}
                      title="Sửa phân công"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input hover:bg-muted"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
