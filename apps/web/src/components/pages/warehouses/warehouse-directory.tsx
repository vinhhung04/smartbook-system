import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ChevronRight, MapPin, Plus, Search } from "lucide-react";
import type { Warehouse } from "@/services/warehouse";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCatalogGrid } from "@/components/ui/loading-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/components/ui/utils";
import { StatusBadge } from "@/components/status-badge";
import {
  LOCATION_TYPE_META,
  WAREHOUSE_TYPE_META,
  normalizeType,
  occupancyBandFromRatio,
  warehouseTypeMeta,
  type WarehouseLocationSummary,
} from "./meta";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";

const TYPE_KEYS = ["WAREHOUSE", "STORE", "BRANCH", "LIBRARY"] as const;

interface WarehouseDirectoryProps {
  warehouses: Warehouse[];
  loading: boolean;
  summaries: Record<string, WarehouseLocationSummary>;
  loadingSummaryIds: Set<string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function WarehouseDirectory({
  warehouses,
  loading,
  summaries,
  loadingSummaryIds,
  onSelect,
  onCreate,
}: WarehouseDirectoryProps) {
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");

  // Counts sit on the filter chips themselves, so the old row of big stat cards is not needed.
  const counts = useMemo(() => {
    const byType: Record<string, number> = { ALL: warehouses.length };
    for (const item of warehouses) {
      const type = normalizeType(item.warehouse_type);
      byType[type] = (byType[type] || 0) + 1;
    }
    const active = warehouses.filter((item) => item.is_active !== false).length;
    return { byType, status: { ALL: warehouses.length, ACTIVE: active, INACTIVE: warehouses.length - active } };
  }, [warehouses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return warehouses.filter((item) => {
      if (typeFilter !== "ALL" && normalizeType(item.warehouse_type) !== typeFilter) return false;
      if (statusFilter === "ACTIVE" && item.is_active === false) return false;
      if (statusFilter === "INACTIVE" && item.is_active !== false) return false;
      if (q) {
        const haystack = `${item.name} ${item.code} ${item.address_line1 || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [warehouses, typeFilter, statusFilter, search]);

  const typeOptions = [
    { value: "ALL", label: `Tất cả (${counts.byType.ALL || 0})` },
    ...TYPE_KEYS.map((key) => ({ value: key, label: `${WAREHOUSE_TYPE_META[key].label} (${counts.byType[key] || 0})` })),
  ];
  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: "ALL", label: "Mọi trạng thái" },
    { value: "ACTIVE", label: `Hoạt động (${counts.status.ACTIVE})` },
    { value: "INACTIVE", label: `Ngừng (${counts.status.INACTIVE})` },
  ];

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-3"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm theo tên, mã, địa chỉ..."
              aria-label="Tìm kho"
              className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-[13px] outline-none transition-all duration-150 placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
            />
          </div>
          <Button onClick={onCreate} size="sm" className="shrink-0 sm:ml-auto">
            <Plus className="h-3.5 w-3.5" />
            Thêm kho
          </Button>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl options={typeOptions} value={typeFilter} onChange={setTypeFilter} layoutId="warehouse-type-filter" className="w-max" />
          </div>
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl
              options={statusOptions}
              value={statusFilter}
              onChange={setStatusFilter}
              layoutId="warehouse-status-filter"
              gradientClassName="from-slate-600 to-slate-700"
              className="w-max"
            />
          </div>
        </div>
      </motion.div>

      {loading ? (
        <SkeletonCatalogGrid count={4} />
      ) : warehouses.length === 0 ? (
        <EmptyState variant="no-data" title="Chưa có kho nào" description="Hãy tạo kho mới để bắt đầu" />
      ) : filtered.length === 0 ? (
        <EmptyState variant="no-results" title="Không tìm thấy kho phù hợp" description="Thử đổi từ khóa hoặc bộ lọc" />
      ) : (
        <>
          <p className="text-[12px] text-muted-foreground">Hiển thị {filtered.length} / {warehouses.length} kho</p>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((warehouse, index) => (
              <WarehouseCard
                key={warehouse.id}
                warehouse={warehouse}
                index={index}
                summary={summaries[warehouse.id]}
                summaryLoading={loadingSummaryIds.has(warehouse.id)}
                onSelect={() => onSelect(warehouse.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function WarehouseCard({
  warehouse,
  index,
  summary,
  summaryLoading,
  onSelect,
}: {
  warehouse: Warehouse;
  index: number;
  summary: WarehouseLocationSummary | undefined;
  summaryLoading: boolean;
  onSelect: () => void;
}) {
  const meta = warehouseTypeMeta(warehouse.warehouse_type);
  const Icon = meta.icon;
  const isActive = warehouse.is_active !== false;

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.3) }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      aria-label={`Mở kho ${warehouse.name}`}
      className={cn(
        "group relative flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-200 hover:border-transparent hover:shadow-[0_12px_28px_-8px_rgba(0,0,0,0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:shadow-none",
        !isActive && "opacity-75",
      )}
    >
      <div
        className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-25 ${meta.swatch}`}
      />

      <div className="relative flex items-start gap-3.5">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${meta.swatch} shadow-sm`}>
          <Icon className="h-5 w-5 text-white" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold" title={warehouse.name}>{warehouse.name}</h3>
            {/* Active is the normal state, so only a stopped warehouse gets a badge. */}
            {!isActive && <StatusBadge label="Ngừng hoạt động" variant="danger" dot />}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{warehouse.code}</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium">{meta.label}</span>
          </p>
          {warehouse.address_line1 && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{warehouse.address_line1}</span>
            </p>
          )}
        </div>

        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>

      <div className="relative mt-3.5 border-t border-border/70 pt-3">
        <WarehouseSummaryRow summary={summary} loading={summaryLoading} />
      </div>
    </motion.button>
  );
}

function WarehouseSummaryRow({ summary, loading }: { summary: WarehouseLocationSummary | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-3" aria-label="Đang tải cấu trúc vị trí">
        <div className="h-5 w-16 animate-pulse rounded-md bg-muted" />
        <div className="h-5 w-16 animate-pulse rounded-md bg-muted" />
        <div className="h-5 w-16 animate-pulse rounded-md bg-muted" />
        <div className="ml-auto h-1.5 w-24 animate-pulse rounded-full bg-muted" />
      </div>
    );
  }

  if (!summary || summary.zoneCount + summary.shelfCount + summary.compartmentCount === 0) {
    return <p className="text-[11px] text-muted-foreground">Chưa có vị trí nào — mở kho để thêm khu vực và kệ</p>;
  }

  const counts: Array<{ type: "ZONE" | "SHELF" | "SHELF_COMPARTMENT"; value: number }> = [
    { type: "ZONE", value: summary.zoneCount },
    { type: "SHELF", value: summary.shelfCount },
    { type: "SHELF_COMPARTMENT", value: summary.compartmentCount },
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {counts.map(({ type, value }) => {
          const meta = LOCATION_TYPE_META[type];
          const TypeIcon = meta.icon;
          return (
            <span key={type} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <TypeIcon className={`h-3.5 w-3.5 ${meta.ink}`} />
              <span className="font-semibold text-foreground">{value}</span> {meta.label.toLowerCase()}
            </span>
          );
        })}
      </div>

      {summary.avgOccupancy !== null && (() => {
        const band = occupancyBandFromRatio(summary.avgOccupancy);
        return (
          <div className="flex items-center gap-2.5" title={band.label}>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={`block h-full rounded-full ${band.line}`} style={{ width: `${Math.round(band.ratio * 100)}%` }} />
            </span>
            <span className={`shrink-0 text-[11px] font-medium ${band.ink}`}>
              {Math.round(summary.avgOccupancy * 100)}% lấp đầy
            </span>
          </div>
        );
      })()}
    </div>
  );
}
