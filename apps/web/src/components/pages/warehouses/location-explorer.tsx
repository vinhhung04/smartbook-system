import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ChevronRight, ClipboardCheck, Clock, ListTree, Mail, MapPin, Pencil, Phone, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { LocationNode, Warehouse } from "@/services/warehouse";
import { shelfService, type ShelfCompartmentItem } from "@/services/shelf";
import { stockAuditService } from "@/services/stock-audit";
import { authService } from "@/services/auth";
import { getApiErrorMessage, hasPermission } from "@/services/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/components/ui/utils";
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
  capacityOf,
  occupancyBand,
  summarizeLocationTree,
  warehouseTypeMeta,
} from "./meta";

const VIEW_OPTIONS = [
  { value: "tree" as const, label: "Danh sách" },
  { value: "map" as const, label: "Sơ đồ" },
];

const numberFormat = new Intl.NumberFormat("vi-VN");

/**
 * Runs `sync` during render whenever a dependency changes (including the first
 * render). React's "adjust state when props change" pattern: unlike a
 * useEffect that only calls setState, it doesn't commit a stale frame first.
 */
function useSyncOnChange(deps: readonly unknown[], sync: () => void) {
  const [prev, setPrev] = useState<readonly unknown[] | null>(null);
  if (prev === null || prev.some((dep, i) => !Object.is(dep, deps[i]))) {
    setPrev(deps);
    sync();
  }
}

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

/**
 * One warehouse as a workspace: its name is the page title, a strip of figures under it,
 * then three panes that collapse with the space they get (container queries, not the
 * viewport, since the app sidebar eats a variable share of the width):
 *   wide   — structure tree | contents (list or floor map) | inspector
 *   medium — structure tree | inspector above contents
 *   narrow — inspector, contents; the tree opens in a sheet
 */
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
  const summary = useMemo(() => summarizeLocationTree(locationTree), [locationTree]);

  const displayedTree = useMemo(() => filterLocationTree(locationTree, search), [locationTree, search]);

  // Keep root nodes expanded by default, without collapsing branches the user opened manually.
  useSyncOnChange([locationTree], () => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      locationTree.forEach((root) => next.add(root.id));
      return next;
    });
  });

  // Reveal the ancestor chain whenever the controlled selection changes (e.g. after create/edit).
  useSyncOnChange([selectedLocationId, flatLocations], () => {
    if (!selectedLocationId) return;
    const ancestors = ancestorIds(selectedLocationId, flatLocations);
    if (ancestors.length === 0) return;
    setExpandedIds((prev) => new Set([...prev, ...ancestors]));
  });

  // Auto-expand every branch that matches an active search.
  useSyncOnChange([search, displayedTree], () => {
    if (!search.trim()) return;
    setExpandedIds((prev) => new Set([...prev, ...collectIds(displayedTree)]));
  });

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
  // The list shows what is inside the selection; a compartment holds no locations, so picking one
  // keeps its shelf's compartments on screen with it highlighted, instead of an empty pane.
  const listOwner = selectedLocation && !canAddChild
    ? flatLocations.find((item) => item.id === selectedLocation.parent_location_id) || null
    : selectedLocation;
  const childrenToShow = listOwner ? listOwner.children || [] : locationTree;
  const warehouseMeta = warehouseTypeMeta(warehouse.warehouse_type);
  const isWarehouseActive = warehouse.is_active !== false;

  // Breadcrumb from the warehouse down to the selected location.
  const path = useMemo(() => {
    if (!selectedLocation) return [];
    const ids = [...ancestorIds(selectedLocation.id, flatLocations)].reverse();
    return [...ids.map((id) => flatLocations.find((item) => item.id === id)).filter(Boolean), selectedLocation] as LocationNode[];
  }, [selectedLocation, flatLocations]);

  const figures = [
    { label: "Khu vực", value: numberFormat.format(summary.zoneCount) },
    { label: "Kệ", value: numberFormat.format(summary.shelfCount) },
    { label: "Ngăn kệ", value: numberFormat.format(summary.compartmentCount) },
    {
      label: "Đang chứa",
      value: summary.capacityTotal === null
        ? "Chưa đặt sức chứa"
        : `${numberFormat.format(summary.occupiedTotal)} / ${numberFormat.format(summary.capacityTotal)} cuốn`,
    },
  ];

  const treePanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-serif text-[16px] font-semibold tracking-tight">Cấu trúc vị trí</h2>
        <Button variant="ghost" size="sm" onClick={onCreateRootLocation} className="-mr-2 text-primary hover:text-primary">
          <Plus className="h-3.5 w-3.5" /> Khu vực
        </Button>
      </div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm theo tên hoặc mã"
          aria-label="Tìm vị trí"
          className="w-full rounded-full border border-border bg-background py-2 pl-8 pr-3 text-[12.5px] outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
        />
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {loadingLocations ? (
          <LoadingOverlay className="py-8" />
        ) : locationTree.length === 0 ? (
          <p className="px-1 py-4 text-[12.5px] text-muted-foreground">Kho chưa có vị trí nào. Bắt đầu bằng một khu vực.</p>
        ) : displayedTree.length === 0 ? (
          <p className="px-1 py-4 text-[12.5px] text-muted-foreground">Không có vị trí nào khớp "{search}".</p>
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
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3 mb-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Tất cả kho
        </Button>
        <PageHeader
          title={warehouse.name}
          description={
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="font-mono text-[13px]">{warehouse.code}</span>
              <span>{warehouseMeta.label}</span>
              <StatusBadge
                label={isWarehouseActive ? "Đang hoạt động" : "Ngừng hoạt động"}
                variant={isWarehouseActive ? "success" : "danger"}
                dot
              />
            </span>
          }
          actions={
            <>
              <Button variant="outline" size="sm" onClick={onEditWarehouse}>
                <Pencil className="h-3.5 w-3.5" /> Sửa kho
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDeleteWarehouse}
                disabled={deletingWarehouse}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> {deletingWarehouse ? "Đang xóa..." : "Xóa kho"}
              </Button>
            </>
          }
        />
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4" aria-label="Số liệu kho">
        {figures.map((item) => (
          <div key={item.label} className="bg-card px-5 py-4">
            <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
            <dd className="mt-1 font-serif text-[24px] font-semibold leading-none tabular-nums">{loadingLocations ? "–" : item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="@container">
        <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-[240px_minmax(0,1fr)] @5xl:grid-cols-[240px_minmax(0,1fr)_300px]">
          {/* Structure tree: a sticky column when there is room, a sheet when there is not. */}
          <aside
            aria-label="Cấu trúc vị trí"
            className="hidden max-h-[calc(100vh-7rem)] rounded-2xl border border-border bg-card p-4 @4xl:sticky @4xl:top-4 @4xl:row-span-2 @4xl:flex @4xl:flex-col @5xl:row-span-1"
          >
            {treePanel}
          </aside>

          <div className="@4xl:hidden">
            <Sheet open={mobileTreeOpen} onOpenChange={setMobileTreeOpen}>
              <SheetTrigger className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <ListTree className="h-3.5 w-3.5" /> Cấu trúc vị trí
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] p-4">
                <SheetHeader className="sr-only p-0">
                  <SheetTitle>Cấu trúc vị trí</SheetTitle>
                </SheetHeader>
                {treePanel}
              </SheetContent>
            </Sheet>
          </div>

          {/* Inspector: the selected location, or the warehouse itself when nothing is selected. */}
          <aside
            aria-label={selectedLocation ? "Chi tiết vị trí" : "Thông tin kho"}
            className="rounded-2xl border border-border bg-card p-5 @4xl:col-start-2 @5xl:sticky @5xl:top-4 @5xl:col-start-3 @5xl:row-start-1"
          >
            {selectedLocation ? (
              <LocationInspector
                node={selectedLocation}
                warehouseId={warehouse.id}
                canAddChild={canAddChild}
                onAddChild={onCreateChildLocation}
                onEdit={onEditLocation}
                onDelete={onDeleteLocation}
                deleting={deletingLocation}
              />
            ) : (
              <WarehouseInfo warehouse={warehouse} />
            )}
          </aside>

          {/* Contents of the current level, as a list or as the floor map. */}
          <section aria-label="Nội dung" className="@container min-w-0 rounded-2xl border border-border bg-card @4xl:col-start-2 @5xl:row-start-1">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <nav aria-label="Vị trí hiện tại" className="min-w-0">
                <ol className="flex flex-wrap items-center gap-1 text-[13px]">
                  <li>
                    <button
                      type="button"
                      onClick={() => onSelectLocation("")}
                      className={cn(
                        "rounded-md px-1 font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        path.length === 0 ? "text-foreground" : "text-muted-foreground",
                      )}
                      aria-current={path.length === 0 ? "location" : undefined}
                    >
                      Toàn kho
                    </button>
                  </li>
                  {path.map((node, index) => (
                    <Fragment key={node.id}>
                      <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" /></li>
                      <li className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelectLocation(node.id)}
                          className={cn(
                            "max-w-[16ch] truncate rounded-md px-1 align-bottom font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                            index === path.length - 1 ? "text-foreground" : "text-muted-foreground",
                          )}
                          aria-current={index === path.length - 1 ? "location" : undefined}
                          title={node.name || node.code}
                        >
                          {node.name || node.code}
                        </button>
                      </li>
                    </Fragment>
                  ))}
                </ol>
              </nav>
              {flatLocations.length > 0 && (
                <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} layoutId="location-explorer-view" />
              )}
            </div>

            {view === "map" ? (
              <div className="p-5">
                <WarehouseFloorMap zones={zoneRoots} selectedLocationId={selectedLocationId} onSelectLocation={onSelectLocation} />
              </div>
            ) : loadingLocations ? (
              <LoadingOverlay className="py-12" />
            ) : childrenToShow.length === 0 ? (
              <EmptyState
                variant="no-data"
                title={`Chưa có ${listOwner ? "vị trí con" : "khu vực"} nào`}
                description={
                  listOwner
                    ? "Dùng nút thêm ở khung chi tiết để tạo vị trí bên trong."
                    : "Dùng nút \"Khu vực\" ở cây cấu trúc để tạo khu vực đầu tiên."
                }
                className="py-12"
              />
            ) : (
              <ul className="divide-y divide-border" aria-label={listOwner ? `Bên trong ${listOwner.name || listOwner.code}` : "Khu vực gốc"}>
                {childrenToShow.map((node) => (
                  <LocationRow
                    key={node.id}
                    node={node}
                    isSelected={selectedLocationId === node.id}
                    onSelect={() => onSelectLocation(node.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** The warehouse's own record, shown in the inspector until a location is picked. */
function WarehouseInfo({ warehouse }: { warehouse: Warehouse }) {
  const rows = [
    { icon: MapPin, label: "Địa chỉ", value: warehouse.address_line1 },
    { icon: Clock, label: "Giờ mở cửa", value: warehouse.opening_hours },
    { icon: Phone, label: "Điện thoại", value: warehouse.phone },
    { icon: Mail, label: "Email", value: warehouse.email },
  ].filter((row) => row.value);

  return (
    <div>
      <h2 className="font-serif text-[16px] font-semibold tracking-tight">Thông tin kho</h2>
      {rows.length === 0 && !warehouse.description ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Kho chưa có địa chỉ hay thông tin liên hệ. Thêm bằng nút "Sửa kho".
        </p>
      ) : (
        <>
          <dl className="mt-3 space-y-3">
            {rows.map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-[12px] text-muted-foreground">{label}</dt>
                  <dd className="break-words text-[13px] text-foreground">{value}</dd>
                </div>
              </div>
            ))}
          </dl>
          {warehouse.description && (
            <p className="mt-3 border-t border-border pt-3 text-[13px] leading-relaxed text-foreground/80">{warehouse.description}</p>
          )}
        </>
      )}
      <p className="mt-4 border-t border-border pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
        Chọn một khu vực, kệ hoặc ngăn kệ để xem chi tiết và thao tác.
      </p>
    </div>
  );
}

function LocationInspector({
  node,
  warehouseId,
  canAddChild,
  onAddChild,
  onEdit,
  onDelete,
  deleting,
}: {
  node: LocationNode;
  warehouseId: string;
  canAddChild: boolean;
  onAddChild: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const navigate = useNavigate();
  const meta = locationTypeMeta(node.location_type);
  const Icon = meta.icon;
  const isInactive = node.is_active === false;
  const isCompartment = normalizeType(node.location_type) === "SHELF_COMPARTMENT";
  const childType = CHILD_TYPE_BY_PARENT[normalizeType(node.location_type)];
  const childCount = node.children?.length || 0;

  const [compartment, setCompartment] = useState<ShelfCompartmentItem | null>(null);
  const [loadingStock, setLoadingStock] = useState(false);
  const [creatingAudit, setCreatingAudit] = useState(false);

  // Real per-book stock lives on the parent shelf's detail endpoint, not on
  // LocationNode itself (which only carries an aggregate available/capacity
  // count) — fetch it fresh whenever the selected compartment changes.
  useEffect(() => {
    if (!isCompartment || !node.parent_location_id) {
      setCompartment(null);
      return;
    }
    let cancelled = false;
    setLoadingStock(true);
    shelfService
      .getById(node.parent_location_id)
      .then((detail) => {
        if (cancelled) return;
        setCompartment(detail.compartments.find((item) => item.id === node.id) || null);
      })
      .catch(() => {
        if (!cancelled) setCompartment(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingStock(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCompartment, node.id, node.parent_location_id]);

  const handleCreateAudit = async () => {
    const currentUser = authService.getCurrentUser();
    if (!currentUser) return;
    setCreatingAudit(true);
    try {
      const created = await stockAuditService.create({
        warehouse_id: warehouseId,
        location_ids: [node.id],
        note: `Từ sơ đồ kho — ${node.name || node.code}`,
      });
      await stockAuditService.assign(created.data.id, currentUser.id);
      toast.success(`Đã tạo phiếu kiểm kê ${created.data.audit_number}`);
      navigate(`/stock-audits/${created.data.id}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tạo được phiếu kiểm kê"));
    } finally {
      setCreatingAudit(false);
    }
  };

  // occupied_qty comes from stock balances, rolled up the tree by the location endpoint.
  const capacity = capacityOf(node);
  const occupied = node.occupied_qty ?? 0;
  const band = capacity ? occupancyBand(occupied, capacity) : null;
  const facts = [
    { label: "Đang chứa", value: `${numberFormat.format(occupied)}${capacity ? ` / ${numberFormat.format(capacity)}` : ""} cuốn` },
    childType ? { label: `${locationTypeMeta(childType).label} bên trong`, value: numberFormat.format(childCount) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div>
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {meta.label}
        <span className="font-mono">{node.code}</span>
      </p>
      <h2 className="mt-1 break-words font-serif text-[20px] font-semibold leading-tight tracking-tight">{node.name || node.code}</h2>
      {isInactive && (
        <div className="mt-2">
          <StatusBadge label="Ngừng hoạt động" variant="danger" dot />
        </div>
      )}

      {facts.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
          {facts.map((fact, index) => (
            <div key={fact.label} className={index === 0 ? "col-span-2" : undefined}>
              <dt className="text-[12px] text-muted-foreground">{fact.label}</dt>
              <dd className="mt-0.5 font-serif text-[18px] font-semibold tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {band && (
        <div className="mt-3 flex items-center gap-2.5" title={band.label}>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className={`block h-full rounded-full ${band.line}`} style={{ width: `${Math.round(band.ratio * 100)}%` }} />
          </span>
          <span className={`shrink-0 text-[12px] font-medium ${band.ink}`}>{band.label}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {canAddChild && childType && (
          <Button size="sm" onClick={onAddChild}>
            <Plus className="h-3.5 w-3.5" /> Thêm {locationTypeMeta(childType).label.toLowerCase()}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Sửa
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={deleting}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" /> {deleting ? "Đang xóa..." : "Xóa"}
        </Button>
      </div>

      {isCompartment && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-[13px] font-semibold">Sách trong ngăn</h3>

          {loadingStock ? (
            <div className="mt-2 space-y-1.5" aria-busy="true">
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ) : !compartment || compartment.books.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">Ngăn kệ này chưa có sách nào.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {compartment.books.map((book) => (
                <li key={book.variantId} className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
                  <span className="min-w-0 truncate text-foreground" title={book.title}>{book.title}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{numberFormat.format(book.onHandQty)} cuốn</span>
                </li>
              ))}
            </ul>
          )}

          {hasPermission("inventory.stock.audit") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCreateAudit()}
              disabled={creatingAudit}
              className="mt-3 w-full"
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              {creatingAudit ? "Đang tạo..." : "Tạo phiếu kiểm kê"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** One location at the current level: what it is, how much is inside, how full it is. */
function LocationRow({
  node,
  isSelected,
  onSelect,
}: {
  node: LocationNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const meta = locationTypeMeta(node.location_type);
  const Icon = meta.icon;
  const isInactive = node.is_active === false;
  const childCount = node.children?.length || 0;
  const childType = CHILD_TYPE_BY_PARENT[normalizeType(node.location_type)];
  const capacity = capacityOf(node);
  const occupied = node.occupied_qty ?? 0;
  const band = capacity ? occupancyBand(occupied, capacity) : null;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={isSelected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-3 px-5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
          isSelected ? "bg-primary/[0.06]" : "hover:bg-muted/50",
          isInactive && "opacity-60",
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-foreground">{node.name || node.code}</span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {meta.label} <span className="font-mono">{node.code}</span>
            {isInactive ? " (ngừng hoạt động)" : ""}
          </span>
        </span>
        {childType && (
          <span className="hidden shrink-0 text-[12px] tabular-nums text-muted-foreground @md:inline">
            {childCount} {locationTypeMeta(childType).label.toLowerCase()}
          </span>
        )}
        {band ? (
          <span className="flex w-28 shrink-0 items-center gap-2" title={band.label}>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={`block h-full rounded-full ${band.line}`} style={{ width: `${Math.round(band.ratio * 100)}%` }} />
            </span>
            <span className="text-right text-[12px] tabular-nums text-muted-foreground">
              {occupied}/{capacity}
            </span>
          </span>
        ) : occupied > 0 ? (
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{numberFormat.format(occupied)} cuốn</span>
        ) : null}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      </button>
    </li>
  );
}
