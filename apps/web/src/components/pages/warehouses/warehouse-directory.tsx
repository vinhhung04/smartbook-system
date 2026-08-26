import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Boxes, CheckCircle2, ChevronRight, MapPin, Plus, Search, XCircle } from "lucide-react";
import type { Warehouse } from "@/services/warehouse";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCatalogGrid } from "@/components/ui/loading-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { WAREHOUSE_TYPE_META, normalizeType, warehouseTypeMeta } from "./meta";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";

const TYPE_FILTER_OPTIONS = [
  { value: "ALL", label: "Tất cả" },
  { value: "WAREHOUSE", label: WAREHOUSE_TYPE_META.WAREHOUSE.label },
  { value: "STORE", label: WAREHOUSE_TYPE_META.STORE.label },
  { value: "BRANCH", label: WAREHOUSE_TYPE_META.BRANCH.label },
  { value: "LIBRARY", label: WAREHOUSE_TYPE_META.LIBRARY.label },
];

interface WarehouseDirectoryProps {
  warehouses: Warehouse[];
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function WarehouseDirectory({ warehouses, loading, onSelect, onCreate }: WarehouseDirectoryProps) {
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");

  const stats = useMemo(() => {
    const total = warehouses.length;
    const active = warehouses.filter((item) => item.is_active !== false).length;
    return { total, active, inactive: total - active };
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

  const toggleStatus = (next: StatusFilter) => setStatusFilter((prev) => (prev === next ? "ALL" : next));

  return (
    <div className="space-y-5">
      {!loading && warehouses.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          <button
            type="button"
            onClick={() => toggleStatus("ALL")}
            aria-pressed={statusFilter === "ALL"}
            className="text-left rounded-xl transition-transform active:scale-[0.99]"
          >
            <StatCard
              label="Tổng số kho"
              value={stats.total}
              icon={Boxes}
              variant="primary"
              animateValue
              className={statusFilter === "ALL" ? "border-primary shadow-md" : "hover:border-muted-foreground/30"}
            />
          </button>
          <button
            type="button"
            onClick={() => toggleStatus("ACTIVE")}
            aria-pressed={statusFilter === "ACTIVE"}
            className="text-left rounded-xl transition-transform active:scale-[0.99]"
          >
            <StatCard
              label="Đang hoạt động"
              value={stats.active}
              icon={CheckCircle2}
              variant="success"
              animateValue
              className={statusFilter === "ACTIVE" ? "border-emerald-500 shadow-md" : "hover:border-muted-foreground/30"}
            />
          </button>
          <button
            type="button"
            onClick={() => toggleStatus("INACTIVE")}
            aria-pressed={statusFilter === "INACTIVE"}
            className="text-left rounded-xl transition-transform active:scale-[0.99]"
          >
            <StatCard
              label="Ngừng hoạt động"
              value={stats.inactive}
              icon={XCircle}
              variant={stats.inactive > 0 ? "danger" : "default"}
              animateValue
              className={statusFilter === "INACTIVE" ? "border-rose-500 shadow-md" : "hover:border-muted-foreground/30"}
            />
          </button>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.04 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center min-w-0">
          <SegmentedControl
            options={TYPE_FILTER_OPTIONS}
            value={typeFilter}
            onChange={setTypeFilter}
            layoutId="warehouse-type-filter"
          />
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm theo tên, mã, địa chỉ..."
              aria-label="Tìm kho"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-input bg-background text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 placeholder:text-muted-foreground transition-all duration-150"
            />
          </div>
        </div>
        <Button onClick={onCreate} size="sm" className="shrink-0">
          <Plus className="w-3.5 h-3.5" />
          Thêm kho
        </Button>
      </motion.div>

      {loading ? (
        <SkeletonCatalogGrid count={4} />
      ) : warehouses.length === 0 ? (
        <EmptyState variant="no-data" title="Chưa có kho nào" description="Hãy tạo kho mới để bắt đầu" />
      ) : filtered.length === 0 ? (
        <EmptyState variant="no-results" title="Không tìm thấy kho phù hợp" description="Thử đổi từ khóa hoặc bộ lọc" />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
          {filtered.map((warehouse, index) => (
            <WarehouseCard key={warehouse.id} warehouse={warehouse} index={index} onSelect={() => onSelect(warehouse.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function WarehouseCard({
  warehouse,
  index,
  onSelect,
}: {
  warehouse: Warehouse;
  index: number;
  onSelect: () => void;
}) {
  const meta = warehouseTypeMeta(warehouse.warehouse_type);
  const Icon = meta.icon;
  const isActive = warehouse.is_active !== false;

  return (
    <motion.button
      onClick={onSelect}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.3) }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-200 hover:border-transparent hover:shadow-[0_12px_28px_-8px_rgba(0,0,0,0.15)] dark:shadow-none"
    >
      <div
        className={`pointer-events-none absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-25 bg-gradient-to-br ${meta.swatch}`}
      />

      <div className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.swatch} shadow-sm`}>
        <Icon className="w-6 h-6 text-white" />
      </div>

      <div className="relative min-w-0 flex-1">
        <h3 className="text-[14px] font-semibold truncate">{warehouse.name}</h3>
        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{warehouse.code}</p>
        {warehouse.address_line1 && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{warehouse.address_line1}</span>
          </p>
        )}
      </div>

      <div className="relative flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{meta.label}</span>
        <StatusBadge label={isActive ? "Đang hoạt động" : "Ngừng hoạt động"} variant={isActive ? "success" : "danger"} dot />
      </div>

      <ChevronRight className="relative w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
    </motion.button>
  );
}
