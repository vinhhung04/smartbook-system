import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ListTree, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { LocationNode, Warehouse } from "@/services/warehouse";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/status-badge";
import { LocationTree } from "./location-tree";
import { WarehouseFloorMap } from "./warehouse-floor-map";
import {
  CHILD_TYPE_BY_PARENT,
  ancestorIds,
  collectIds,
  filterLocationTree,
  flattenNodes,
  locationTypeMeta,
  normalizeType,
  warehouseTypeMeta,
} from "./meta";

const VIEW_OPTIONS = [
  { value: "tree" as const, label: "Cây thư mục" },
  { value: "map" as const, label: "Sơ đồ kho" },
];

const COUNT_TYPES = ["ZONE", "SHELF", "SHELF_COMPARTMENT"] as const;

interface LocationExplorerProps {
  warehouse: Warehouse;
  onBack: () => void;
  onEditWarehouse: () => void;
  onDeleteWarehouse: () => void;
  deletingWarehouse: boolean;

  locationTree: LocationNode[];
  loadingLocations: boolean;
  selectedLocationId: string;
  onSelectLocation: (id: string) => void;

  onCreateRootLocation: () => void;
  onCreateChildLocation: () => void;
  onEditLocation: () => void;
  onDeleteLocation: () => void;
  deletingLocation: boolean;
}

export function LocationExplorer({
  warehouse,
  onBack,
  onEditWarehouse,
  onDeleteWarehouse,
  deletingWarehouse,
  locationTree,
  loadingLocations,
  selectedLocationId,
  onSelectLocation,
  onCreateRootLocation,
  onCreateChildLocation,
  onEditLocation,
  onDeleteLocation,
  deletingLocation,
}: LocationExplorerProps) {
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [view, setView] = useState<"tree" | "map">("tree");

  const flatLocations = useMemo(() => flattenNodes(locationTree), [locationTree]);
  const zoneRoots = useMemo(
    () => locationTree.filter((node) => normalizeType(node.location_type) === "ZONE"),
    [locationTree],
  );
  const selectedLocation = useMemo(
    () => flatLocations.find((item) => item.id === selectedLocationId) || null,
    [flatLocations, selectedLocationId],
  );

  const displayedTree = useMemo(() => filterLocationTree(locationTree, search), [locationTree, search]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    flatLocations.forEach((item) => {
      const type = normalizeType(item.location_type);
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [flatLocations]);

  // Keep root nodes expanded by default, without collapsing branches the user opened manually.
  useEffect(() => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      locationTree.forEach((root) => next.add(root.id));
      return next;
    });
  }, [locationTree]);

  // Reveal the ancestor chain whenever the controlled selection changes (e.g. after create/edit).
  useEffect(() => {
    if (!selectedLocationId) return;
    const ancestors = ancestorIds(selectedLocationId, flatLocations);
    if (ancestors.length === 0) return;
    setExpandedIds((prev) => new Set([...prev, ...ancestors]));
  }, [selectedLocationId, flatLocations]);

  // Auto-expand every branch that matches an active search.
  useEffect(() => {
    if (!search.trim()) return;
    setExpandedIds((prev) => new Set([...prev, ...collectIds(displayedTree)]));
  }, [search, displayedTree]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canAddChild = Boolean(
    selectedLocation && CHILD_TYPE_BY_PARENT[normalizeType(selectedLocation.location_type)],
  );
  const childrenToShow = selectedLocation ? selectedLocation.children || [] : locationTree;
  const warehouseMeta = warehouseTypeMeta(warehouse.warehouse_type);
  const WarehouseIcon = warehouseMeta.icon;
  const isWarehouseActive = warehouse.is_active !== false;

  const treePanel = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm vị trí theo tên/mã..."
            aria-label="Tìm vị trí"
            className="w-full pl-8 pr-3 py-2 rounded-md border border-input bg-input-background text-[12px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 placeholder:text-muted-foreground transition-all"
          />
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onCreateRootLocation} className="mb-3 justify-center">
        <Plus className="w-3.5 h-3.5" /> Thêm khu vực gốc
      </Button>

      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {loadingLocations ? (
          <LoadingOverlay className="py-8" />
        ) : locationTree.length === 0 ? (
          <p className="text-[12px] text-muted-foreground px-1 py-4">Chưa có vị trí nào trong kho này.</p>
        ) : displayedTree.length === 0 ? (
          <p className="text-[12px] text-muted-foreground px-1 py-4">Không tìm thấy vị trí khớp "{search}".</p>
        ) : (
          <LocationTree
            nodes={displayedTree}
            selectedId={selectedLocationId}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
            onSelect={(node) => {
              onSelectLocation(node.id);
              setMobileTreeOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative overflow-hidden rounded-xl border border-border bg-card p-4"
      >
        <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${warehouseMeta.swatch}`} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="w-3.5 h-3.5" />
              Quay lại
            </Button>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${warehouseMeta.chip}`}>
              <WarehouseIcon className={`w-[18px] h-[18px] ${warehouseMeta.ink}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold truncate">{warehouse.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <p className="text-[11px] text-muted-foreground">{warehouse.code}</p>
                <StatusBadge label={warehouseMeta.label} variant="neutral" />
                <StatusBadge
                  label={isWarehouseActive ? "Đang hoạt động" : "Ngừng hoạt động"}
                  variant={isWarehouseActive ? "success" : "danger"}
                  dot
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onEditWarehouse}>
              <Pencil className="w-3.5 h-3.5" /> Sửa kho
            </Button>
            <Button variant="destructive" size="sm" onClick={onDeleteWarehouse} disabled={deletingWarehouse}>
              <Trash2 className="w-3.5 h-3.5" /> {deletingWarehouse ? "Đang xóa..." : "Xóa kho"}
            </Button>
          </div>
        </div>
      </motion.div>

      {flatLocations.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.03 }}
          className="grid grid-cols-3 gap-3"
        >
          {COUNT_TYPES.map((type) => {
            const meta = locationTypeMeta(type);
            const Icon = meta.icon;
            return (
              <div key={type} className="rounded-xl border border-border bg-card p-3.5 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.chip}`}>
                  <Icon className={`w-4 h-4 ${meta.ink}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[18px] font-bold leading-none">{typeCounts[type] || 0}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 truncate">{meta.label}</p>
                </div>
              </div>
            );
          })}
        </motion.div>
      )}

      {flatLocations.length > 0 && (
        <div className="flex justify-end">
          <SegmentedControl
            options={VIEW_OPTIONS}
            value={view}
            onChange={setView}
            layoutId="location-explorer-view"
            gradientClassName="from-violet-600 to-indigo-600"
          />
        </div>
      )}

      {view === "map" ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="space-y-4"
        >
          <div className="rounded-lg border border-border bg-card p-4">
            <WarehouseFloorMap zones={zoneRoots} selectedLocationId={selectedLocationId} onSelectLocation={onSelectLocation} />
          </div>

          {selectedLocation && (
            <div className="rounded-lg border border-border bg-card p-4">
              <LocationDataPlate
                node={selectedLocation}
                canAddChild={canAddChild}
                onAddChild={onCreateChildLocation}
                onEdit={onEditLocation}
                onDelete={onDeleteLocation}
                deleting={deletingLocation}
              />
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4"
        >
          <div className="hidden lg:block rounded-lg border border-border bg-card p-3.5 h-fit max-h-[560px]">
            {treePanel}
          </div>

          <div className="lg:hidden">
            <Sheet open={mobileTreeOpen} onOpenChange={setMobileTreeOpen}>
              <SheetTrigger className="inline-flex w-full items-center justify-center gap-1.5 h-8 rounded-md border border-input bg-background px-3 text-[13px] font-medium text-foreground transition-all hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 active:scale-[0.98]">
                <ListTree className="w-3.5 h-3.5" /> Sơ đồ cấu trúc
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] p-4">
                <SheetHeader className="p-0 mb-1">
                  <SheetTitle>Cấu trúc vị trí</SheetTitle>
                </SheetHeader>
                {treePanel}
              </SheetContent>
            </Sheet>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 min-w-0">
            {selectedLocation ? (
              <LocationDataPlate
                node={selectedLocation}
                canAddChild={canAddChild}
                onAddChild={onCreateChildLocation}
                onEdit={onEditLocation}
                onDelete={onDeleteLocation}
                deleting={deletingLocation}
              />
            ) : (
              <div className="rounded-lg bg-muted/40 p-3.5 text-[12px] text-muted-foreground">
                Chọn một vị trí trong sơ đồ, hoặc chọn một khu vực bên dưới để xem chi tiết.
              </div>
            )}

            <div className="mt-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
                {selectedLocation ? `Bên trong ${selectedLocation.name || selectedLocation.code}` : "Khu vực gốc"}
              </h4>

              {loadingLocations ? (
                <LoadingOverlay className="py-8" />
              ) : childrenToShow.length === 0 ? (
                <EmptyState
                  variant="no-data"
                  title={
                    selectedLocation && !canAddChild
                      ? "Đây là cấp thấp nhất"
                      : `Chưa có ${selectedLocation ? "vị trí con" : "khu vực"} nào`
                  }
                  description={
                    selectedLocation && !canAddChild
                      ? "Ngăn kệ không thể chứa vị trí con."
                      : "Bấm 'Thêm node con' hoặc 'Thêm khu vực gốc' để bắt đầu."
                  }
                  className="py-8"
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {childrenToShow.map((node, index) => (
                    <LocationTagCard
                      key={node.id}
                      node={node}
                      index={index}
                      isSelected={selectedLocationId === node.id}
                      onSelect={() => onSelectLocation(node.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function LocationDataPlate({
  node,
  canAddChild,
  onAddChild,
  onEdit,
  onDelete,
  deleting,
}: {
  node: LocationNode;
  canAddChild: boolean;
  onAddChild: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const meta = locationTypeMeta(node.location_type);
  const Icon = meta.icon;
  const isInactive = node.is_active === false;

  return (
    <div className="relative rounded-xl border border-border bg-card p-3.5">
      <div className={`absolute top-0 left-0 right-0 h-[3px] rounded-t-xl bg-gradient-to-r ${meta.swatch}`} />
      <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.chip}`}>
            <Icon className={`w-4 h-4 ${meta.ink}`} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold truncate">{node.name || node.code}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-[11px] text-muted-foreground">{node.code}</p>
              <StatusBadge label={meta.label} variant="neutral" />
              {typeof node.capacity_qty === "number" && node.capacity_qty > 0 && (
                <span className="text-[10px] text-muted-foreground">Sức chứa {node.capacity_qty}</span>
              )}
              {isInactive && <StatusBadge label="Ngừng hoạt động" variant="danger" dot />}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canAddChild && (
            <Button variant="outline" size="sm" onClick={onAddChild}>
              <Plus className="w-3.5 h-3.5" /> Node con
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" /> Sửa
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete} disabled={deleting}>
            <Trash2 className="w-3.5 h-3.5" /> {deleting ? "Đang xóa..." : "Xóa"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LocationTagCard({
  node,
  index,
  isSelected,
  onSelect,
}: {
  node: LocationNode;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const meta = locationTypeMeta(node.location_type);
  const Icon = meta.icon;
  const isInactive = node.is_active === false;
  const childCount = node.children?.length || 0;

  return (
    <motion.button
      onClick={onSelect}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.02, 0.2) }}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      className={`group relative flex flex-col items-start gap-1.5 rounded-xl border p-2.5 text-left transition-colors ${
        isSelected
          ? `${meta.border} ${meta.chip} shadow-sm`
          : "border-border bg-card hover:border-muted-foreground/30"
      } ${isInactive ? "opacity-60" : ""}`}
    >
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? "bg-card" : meta.chip}`}>
        <Icon className={`w-3.5 h-3.5 ${meta.ink}`} />
      </div>
      <p className="truncate w-full text-[12px] font-medium">{node.name || node.code}</p>
      <p className="font-mono text-[10px] text-muted-foreground truncate w-full">{node.code}</p>
      <div className="flex items-center gap-1 flex-wrap">
        {childCount > 0 && (
          <span className="text-[9px] font-semibold text-muted-foreground bg-muted rounded px-1.5 py-[1px]">
            {childCount} bên trong
          </span>
        )}
        {isInactive && <span className="text-[9px] font-semibold uppercase text-rose-600 dark:text-rose-400">Ngừng</span>}
      </div>
    </motion.button>
  );
}
