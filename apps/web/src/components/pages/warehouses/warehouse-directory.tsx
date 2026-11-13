import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, MapPin, Search } from "lucide-react";
import type { Warehouse } from "@/services/warehouse";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCatalogGrid } from "@/components/ui/loading-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/components/ui/utils";
import { StatusBadge } from "@/components/status-badge";
import {
  LOCATION_TYPE_META,
  WAREHOUSE_TYPE_META,
  normalizeType,
  occupancyBand,
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
}

export function WarehouseDirectory({
  warehouses,
  loading,
  summaries,
  loadingSummaryIds,
  onSelect,
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm theo tên, mã, địa chỉ"
            aria-label="Tìm kho"
            className="w-full rounded-full border border-border bg-card py-2.5 pl-9 pr-4 text-[13.5px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl options={typeOptions} value={typeFilter} onChange={setTypeFilter} layoutId="warehouse-type-filter" className="w-max" />
          </div>
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl options={statusOptions} value={statusFilter} onChange={setStatusFilter} layoutId="warehouse-status-filter" className="w-max" />
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonCatalogGrid count={4} />
      ) : warehouses.length === 0 ? (
        <EmptyState variant="no-data" title="Chưa có kho nào" description="Hãy tạo kho mới để bắt đầu" />
      ) : filtered.length === 0 ? (
        <EmptyState variant="no-results" title="Không tìm thấy kho phù hợp" description="Thử đổi từ khóa hoặc bộ lọc" />
      ) : (
        <div className="@container">
          <p className="mb-3 text-[12.5px] text-muted-foreground" aria-live="polite">Hiển thị {filtered.length} / {warehouses.length} kho</p>
          <ul className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3" aria-label="Danh sách kho">
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
          </ul>
        </div>
      )}
    </div>
  );
}

/** A warehouse as the public site shows a branch: what it is, where it is, what it holds. */
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
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.2) }}
      className="list-none"
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Mở kho ${warehouse.name}`}
        className={cn(
          "group flex h-full w-full flex-col rounded-2xl border border-border bg-card p-6 text-left transition-shadow duration-200 hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          !isActive && "bg-muted/30",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{meta.label}</span>
            <span className="truncate font-mono">{warehouse.code}</span>
          </p>
          {!isActive && <StatusBadge label="Ngừng hoạt động" variant="danger" dot />}
        </div>

        <h3 className="mt-2 font-serif text-[22px] font-semibold leading-tight tracking-tight" title={warehouse.name}>
          {warehouse.name}
        </h3>
        <p className="mt-2 flex gap-2 text-[13.5px] leading-relaxed text-foreground/80">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {warehouse.address_line1 ? <span>{warehouse.address_line1}</span> : <span className="text-muted-foreground">Chưa có địa chỉ</span>}
        </p>

        <div className="mt-5 border-t border-border pt-4">
          <WarehouseSummary summary={summary} loading={summaryLoading} />
        </div>

        <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-[13.5px] font-semibold text-primary">
          Mở sơ đồ kho
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </button>
    </motion.li>
  );
}

function WarehouseSummary({ summary, loading }: { summary: WarehouseLocationSummary | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-3" aria-label="Đang tải cấu trúc vị trí">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-14 animate-pulse rounded bg-muted" />
            <div className="h-6 w-8 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary || summary.zoneCount + summary.shelfCount + summary.compartmentCount === 0) {
    return <p className="text-[13px] text-muted-foreground">Chưa có vị trí nào. Mở kho để thêm khu vực và kệ.</p>;
  }

  const figures = [
    { type: "ZONE", value: summary.zoneCount },
    { type: "SHELF", value: summary.shelfCount },
    { type: "SHELF_COMPARTMENT", value: summary.compartmentCount },
  ];

  return (
    <>
      <dl className="grid grid-cols-3 gap-3">
        {figures.map(({ type, value }) => (
          <div key={type}>
            <dt className="text-[12px] text-muted-foreground">{LOCATION_TYPE_META[type].label}</dt>
            <dd className="mt-0.5 font-serif text-[22px] font-semibold leading-none tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {summary.capacityTotal !== null && (() => {
        const band = occupancyBand(summary.occupiedTotal, summary.capacityTotal);
        return band ? (
          <div className="mt-3.5 flex items-center gap-2.5" title={band.label}>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={`block h-full rounded-full ${band.line}`} style={{ width: `${Math.round(band.ratio * 100)}%` }} />
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {summary.occupiedTotal.toLocaleString("vi-VN")} / {summary.capacityTotal.toLocaleString("vi-VN")} cuốn
            </span>
          </div>
        ) : null;
      })()}
    </>
  );
}
