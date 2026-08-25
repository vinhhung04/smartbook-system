import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft, ArrowRight, ChevronRight, Home, MapPin, Package, Plus, Pencil, Trash2, Save, X,
  Warehouse as WarehouseIcon, Store, Building2, Library, LayoutGrid, BookOpen,
  Boxes, CheckCircle2, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { warehouseService, type LocationNode, type Warehouse } from "@/services/warehouse";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/status-badge";

interface TypeMeta {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  accentBorder: string;
}

const WAREHOUSE_TYPE_META: Record<string, TypeMeta> = {
  WAREHOUSE: {
    icon: WarehouseIcon,
    iconBg: "bg-gradient-to-br from-indigo-100 to-blue-50 dark:from-indigo-500/20 dark:to-blue-500/10",
    iconColor: "text-indigo-600 dark:text-indigo-400",
    accentBorder: "from-indigo-500 to-blue-500",
  },
  STORE: {
    icon: Store,
    iconBg: "bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-500/20 dark:to-teal-500/10",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    accentBorder: "from-emerald-500 to-teal-500",
  },
  BRANCH: {
    icon: Building2,
    iconBg: "bg-gradient-to-br from-amber-100 to-orange-50 dark:from-amber-500/20 dark:to-orange-500/10",
    iconColor: "text-amber-600 dark:text-amber-400",
    accentBorder: "from-amber-500 to-orange-500",
  },
  LIBRARY: {
    icon: Library,
    iconBg: "bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-500/20 dark:to-purple-500/10",
    iconColor: "text-violet-600 dark:text-violet-400",
    accentBorder: "from-violet-500 to-purple-500",
  },
};

function warehouseTypeMeta(type: string | null | undefined): TypeMeta {
  return WAREHOUSE_TYPE_META[String(type || "").toUpperCase()] || WAREHOUSE_TYPE_META.WAREHOUSE;
}

interface LocationTypeMeta {
  icon: LucideIcon;
  textColor: string;
  iconBg: string;
  ring: string;
  accentBorder: string;
}

const LOCATION_TYPE_META: Record<string, LocationTypeMeta> = {
  ZONE: {
    icon: LayoutGrid,
    textColor: "text-violet-600 dark:text-violet-400",
    iconBg: "bg-violet-100 dark:bg-violet-500/15",
    ring: "ring-violet-200 dark:ring-violet-500/20",
    accentBorder: "from-violet-500 to-purple-500",
  },
  SHELF: {
    icon: BookOpen,
    textColor: "text-cyan-600 dark:text-cyan-400",
    iconBg: "bg-cyan-100 dark:bg-cyan-500/15",
    ring: "ring-cyan-200 dark:ring-cyan-500/20",
    accentBorder: "from-cyan-500 to-blue-500",
  },
  SHELF_COMPARTMENT: {
    icon: Package,
    textColor: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-100 dark:bg-emerald-500/15",
    ring: "ring-emerald-200 dark:ring-emerald-500/20",
    accentBorder: "from-emerald-500 to-teal-500",
  },
};

function locationTypeMeta(type: string | null | undefined): LocationTypeMeta {
  return LOCATION_TYPE_META[String(type || "").toUpperCase()] || LOCATION_TYPE_META.SHELF_COMPARTMENT;
}

type WarehouseMode = "create" | "edit";
type LocationMode = "create-root" | "create-child" | "edit";

interface WarehouseFormState {
  code: string;
  name: string;
  warehouse_type: string;
  address_line1: string;
  is_active: boolean;
}

interface LocationFormState {
  code: string;
  name: string;
  location_type: string;
  parent_location_id: string;
  is_active: boolean;
}

const LOCATION_TYPES = ["ZONE", "SHELF", "SHELF_COMPARTMENT"];
const ROOT_TYPES = ["ZONE"];
const CHILD_TYPE_BY_PARENT: Record<string, string> = {
  ZONE: "SHELF",
  SHELF: "SHELF_COMPARTMENT",
};

function normalizeType(value: string | null | undefined): string {
  return String(value || "").trim().toUpperCase();
}

const TYPE_LABEL: Record<string, string> = {
  ZONE: "Zone",
  SHELF: "Shelf",
  SHELF_COMPARTMENT: "Shelf Compartment",
};

const EMPTY_WAREHOUSE_FORM: WarehouseFormState = {
  code: "",
  name: "",
  warehouse_type: "WAREHOUSE",
  address_line1: "",
  is_active: true,
};

const EMPTY_LOCATION_FORM: LocationFormState = {
  code: "",
  name: "",
  location_type: "ZONE",
  parent_location_id: "",
  is_active: true,
};

function flattenNodes(nodes: LocationNode[]): LocationNode[] {
  const output: LocationNode[] = [];
  const visit = (node: LocationNode) => {
    output.push(node);
    (node.children || []).forEach(visit);
  };
  nodes.forEach(visit);
  return output;
}

function LocationTile({
  node,
  isSelected,
  onSelect,
  onDrillIn,
  dense = false,
  index = 0,
}: {
  node: LocationNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDrillIn: (node: LocationNode) => void;
  dense?: boolean;
  index?: number;
}) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isInactive = node.is_active === false;
  const meta = locationTypeMeta(node.location_type);
  const Icon = meta.icon;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={`group relative flex flex-col overflow-hidden rounded-xl border p-3 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${dense ? "aspect-square items-center justify-center text-center" : ""} ${
        isSelected
          ? "border-violet-300 bg-gradient-to-br from-violet-50 to-purple-50/40 shadow-sm dark:border-violet-500/40 dark:from-violet-500/15 dark:to-purple-500/5"
          : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/40"
      } ${isInactive ? "opacity-55" : ""}`}
    >
      {hasChildren && (
        <button
          type="button"
          aria-label={`Xem bên trong ${node.name || node.code}`}
          onClick={(event) => {
            event.stopPropagation();
            onDrillIn(node);
          }}
          className={`absolute z-10 flex items-center justify-center rounded-lg transition-colors ${dense ? "top-1 right-1 w-5 h-5" : "top-2 right-2 w-6 h-6"} bg-background/80 text-muted-foreground hover:bg-primary/10 hover:text-primary`}
        >
          <ArrowRight className={dense ? "w-3 h-3" : "w-3.5 h-3.5"} />
        </button>
      )}

      <div className={`rounded-lg flex items-center justify-center shrink-0 ${meta.iconBg} ${isSelected ? `ring-2 ${meta.ring}` : ""} ${dense ? "w-8 h-8 mb-1.5" : "w-9 h-9 mb-2"}`}>
        <Icon className={`${dense ? "w-4 h-4" : "w-[18px] h-[18px]"} ${meta.textColor}`} />
      </div>

      <p className={`truncate font-semibold ${dense ? "text-[11px] max-w-full" : "text-[13px]"}`}>{node.name || node.code}</p>
      {!dense && (
        <p className={`text-[10px] font-medium mt-0.5 ${meta.textColor}`}>
          {TYPE_LABEL[node.location_type] || node.location_type} · <span className="text-muted-foreground font-normal">{node.code}</span>
        </p>
      )}

      <div className={`flex items-center gap-1 flex-wrap ${dense ? "justify-center mt-1" : "mt-2"}`}>
        {hasChildren && !dense && (
          <span className="text-[10px] font-semibold text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {node.children!.length}
          </span>
        )}
        {typeof node.capacity_qty === "number" && node.capacity_qty > 0 && !dense && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            Sức chứa {node.capacity_qty}
          </span>
        )}
        {isInactive && (
          <span className={`shrink-0 font-semibold uppercase tracking-wide text-muted-foreground bg-muted rounded-full ${dense ? "text-[8px] px-1 py-[1px]" : "text-[9px] px-1.5 py-[1px]"}`}>
            {dense ? "Tắt" : "Ngừng hoạt động"}
          </span>
        )}
      </div>
    </motion.div>
  );
}

export function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [locationTree, setLocationTree] = useState<LocationNode[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [savingWarehouse, setSavingWarehouse] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [deletingWarehouse, setDeletingWarehouse] = useState(false);
  const [deletingLocation, setDeletingLocation] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [warehouseMode, setWarehouseMode] = useState<WarehouseMode>("edit");
  const [locationMode, setLocationMode] = useState<LocationMode>("create-root");
  const [warehouseForm, setWarehouseForm] = useState<WarehouseFormState>(EMPTY_WAREHOUSE_FORM);
  const [locationForm, setLocationForm] = useState<LocationFormState>(EMPTY_LOCATION_FORM);
  const [pageError, setPageError] = useState("");
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const warehouseModalRef = useRef<HTMLDivElement>(null);
  const closeWarehouseForm = () => setShowWarehouseForm(false);
  useDialogA11y(showWarehouseForm, closeWarehouseForm, warehouseModalRef);
  const locationModalRef = useRef<HTMLDivElement>(null);
  const closeLocationForm = () => setShowLocationForm(false);
  useDialogA11y(showLocationForm, closeLocationForm, locationModalRef);
  const [showDeleteWarehouseConfirm, setShowDeleteWarehouseConfirm] = useState(false);
  const [showDeleteLocationConfirm, setShowDeleteLocationConfirm] = useState(false);
  const [drillPath, setDrillPath] = useState<LocationNode[]>([]);

  const selectedWarehouse = useMemo(
    () => warehouses.find((item) => item.id === selectedWarehouseId) || null,
    [warehouses, selectedWarehouseId],
  );

  const flatLocations = useMemo(() => flattenNodes(locationTree), [locationTree]);
  const selectedLocation = useMemo(
    () => flatLocations.find((item) => item.id === selectedLocationId) || null,
    [flatLocations, selectedLocationId],
  );

  const warehouseStats = useMemo(() => {
    const total = warehouses.length;
    const active = warehouses.filter((item) => item.is_active !== false).length;
    return { total, active, inactive: total - active };
  }, [warehouses]);

  const locationTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    flatLocations.forEach((item) => {
      const type = normalizeType(item.location_type);
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [flatLocations]);

  const visibleLocations = useMemo(() => {
    if (drillPath.length === 0) return locationTree;
    return drillPath[drillPath.length - 1].children || [];
  }, [drillPath, locationTree]);

  const handleDrillIn = (node: LocationNode) => {
    setDrillPath((prev) => [...prev, node]);
  };

  const handleDrillTo = (depth: number) => {
    setDrillPath((prev) => prev.slice(0, depth));
  };

  const loadWarehouses = useCallback(async (preferredId?: string) => {
    try {
      setLoadingWarehouses(true);
      setPageError("");
      const rows = await warehouseService.getAll();
      const nextRows = Array.isArray(rows) ? (rows as Warehouse[]) : [];
      setWarehouses(nextRows);

      if (nextRows.length === 0) {
        setSelectedWarehouseId("");
        return;
      }

      const keep = preferredId ?? selectedWarehouseId;
      const exists = keep ? nextRows.some((row) => row.id === keep) : false;
      setSelectedWarehouseId(exists && keep ? keep : "");
    } catch (error) {
      const message = getApiErrorMessage(error, "Không tải được danh sách kho");
      setPageError(message);
      toast.error(message);
    } finally {
      setLoadingWarehouses(false);
    }
  }, [selectedWarehouseId]);

  const loadLocationTree = useCallback(async (warehouseId: string, preferredLocationId?: string): Promise<LocationNode[]> => {
    if (!warehouseId) {
      setLocationTree([]);
      setSelectedLocationId("");
      setDrillPath([]);
      return [];
    }

    try {
      setLoadingLocations(true);
      const data = await warehouseService.getLocationTree(warehouseId);
      const tree = Array.isArray(data?.tree) ? data.tree : [];
      setLocationTree(tree);

      const flat = flattenNodes(tree);
      const allIds = new Set(flat.map((item) => item.id));

      const keep = preferredLocationId || selectedLocationId;
      if (keep && allIds.has(keep)) {
        setSelectedLocationId(keep);
        const ancestors: LocationNode[] = [];
        let current = flat.find((item) => item.id === keep) || null;
        while (current?.parent_location_id) {
          const parent = flat.find((item) => item.id === current!.parent_location_id) || null;
          if (!parent) break;
          ancestors.unshift(parent);
          current = parent;
        }
        setDrillPath(ancestors);
      } else {
        setSelectedLocationId("");
        setDrillPath([]);
      }
      return flat;
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được cấu trúc vị trí"));
      setLocationTree([]);
      setSelectedLocationId("");
      setDrillPath([]);
      return [];
    } finally {
      setLoadingLocations(false);
    }
  }, [selectedLocationId]);

  useEffect(() => {
    void loadWarehouses();
  }, [loadWarehouses]);

  useEffect(() => {
    if (!selectedWarehouse) {
      setWarehouseForm(EMPTY_WAREHOUSE_FORM);
      return;
    }

    setWarehouseForm({
      code: selectedWarehouse.code || "",
      name: selectedWarehouse.name || "",
      warehouse_type: selectedWarehouse.warehouse_type || "WAREHOUSE",
      address_line1: selectedWarehouse.address_line1 || "",
      is_active: selectedWarehouse.is_active ?? true,
    });
    setWarehouseMode("edit");
  }, [selectedWarehouse]);

  useEffect(() => {
    if (!selectedWarehouseId) {
      setLocationTree([]);
      setSelectedLocationId("");
      setLocationForm(EMPTY_LOCATION_FORM);
      return;
    }

    void loadLocationTree(selectedWarehouseId);
  }, [selectedWarehouseId, loadLocationTree]);

  useEffect(() => {
    if (!selectedLocation) {
      setLocationForm((prev) => ({ ...prev, parent_location_id: "" }));
      return;
    }

    if (locationMode === "edit") {
      setLocationForm({
        code: selectedLocation.code || selectedLocation.location_code,
        name: selectedLocation.name || selectedLocation.code,
        location_type: selectedLocation.location_type,
        parent_location_id: selectedLocation.parent_location_id || "",
        is_active: selectedLocation.is_active,
      });
    }
  }, [selectedLocation, locationMode]);

  const allowedLocationTypes = useMemo(() => {
    const parentId = locationForm.parent_location_id;
    if (!parentId) return ROOT_TYPES;

    const parent = flatLocations.find((item) => item.id === parentId);
    const next = parent ? CHILD_TYPE_BY_PARENT[normalizeType(parent.location_type)] : null;
    return next ? [next] : [];
  }, [flatLocations, locationForm.parent_location_id]);

  const parentLocationOptions = useMemo(() => {
    if (locationMode !== "edit") {
      return flatLocations;
    }
    return flatLocations.filter((item) => item.id !== selectedLocationId);
  }, [flatLocations, locationMode, selectedLocationId]);

  const startCreateWarehouse = () => {
    setWarehouseMode("create");
    setWarehouseForm(EMPTY_WAREHOUSE_FORM);
    setShowWarehouseForm(true);
  };

  const startEditWarehouse = () => {
    if (!selectedWarehouse) return;
    setWarehouseMode("edit");
    setWarehouseForm({
      code: selectedWarehouse.code || "",
      name: selectedWarehouse.name || "",
      warehouse_type: selectedWarehouse.warehouse_type || "WAREHOUSE",
      address_line1: selectedWarehouse.address_line1 || "",
      is_active: selectedWarehouse.is_active ?? true,
    });
    setShowWarehouseForm(true);
  };

  const handleSaveWarehouse = async () => {
    const code = warehouseForm.code.trim();
    const name = warehouseForm.name.trim();

    if (!code) {
      toast.error("Code kho khong duoc de trong");
      return;
    }
    if (!name) {
      toast.error("Ten kho khong duoc de trong");
      return;
    }

    try {
      setSavingWarehouse(true);
      const payload = {
        code,
        name,
        warehouse_type: warehouseForm.warehouse_type,
        address_line1: warehouseForm.address_line1.trim() || undefined,
        is_active: warehouseForm.is_active,
      };

      if (warehouseMode === "create") {
        await warehouseService.create(payload);
        toast.success("Đã tạo kho mới");
        await loadWarehouses();
        setSelectedWarehouseId("");
      } else if (selectedWarehouseId) {
        await warehouseService.update(selectedWarehouseId, payload);
        toast.success("Đã cập nhật kho");
        await loadWarehouses(selectedWarehouseId);
      }
      setShowWarehouseForm(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lưu kho thất bại"));
    } finally {
      setSavingWarehouse(false);
    }
  };

  const handleDeleteWarehouse = async () => {
    if (!selectedWarehouseId) return;

    try {
      setDeletingWarehouse(true);
      await warehouseService.delete(selectedWarehouseId);
      toast.success("Đã xóa kho");
      setSelectedWarehouseId("");
      await loadWarehouses();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xóa kho thất bại"));
    } finally {
      setDeletingWarehouse(false);
      setShowDeleteWarehouseConfirm(false);
    }
  };

  const startCreateRootLocation = () => {
    setLocationMode("create-root");
    setSelectedLocationId("");
    setLocationForm({ ...EMPTY_LOCATION_FORM, location_type: "ZONE" });
    setShowLocationForm(true);
  };

  const startCreateChildLocation = () => {
    if (!selectedLocation) {
      toast.error("Vui lòng chọn một vị trí cha");
      return;
    }
    const childType = CHILD_TYPE_BY_PARENT[normalizeType(selectedLocation.location_type)];
    if (!childType) {
      toast.error("Vị trí này không hỗ trợ thêm node con");
      return;
    }

    setLocationMode("create-child");
    setLocationForm({
      ...EMPTY_LOCATION_FORM,
      parent_location_id: selectedLocation.id,
      location_type: childType,
    });
    setShowLocationForm(true);
  };

  const startEditLocation = () => {
    if (!selectedLocation) {
      toast.error("Vui lòng chọn vị trí cần sửa");
      return;
    }
    setLocationMode("edit");
    setLocationForm({
      code: selectedLocation.code,
      name: selectedLocation.name || selectedLocation.code,
      location_type: selectedLocation.location_type,
      parent_location_id: selectedLocation.parent_location_id || "",
      is_active: selectedLocation.is_active,
    });
    setShowLocationForm(true);
  };

  const handleSaveLocation = async () => {
    if (!selectedWarehouseId) {
      toast.error("Vui lòng chọn kho");
      return;
    }

    const code = locationForm.code.trim();
    const name = locationForm.name.trim();
    if (!code) {
      toast.error("Mã vị trí không được để trống");
      return;
    }
    if (!name) {
      toast.error("Tên vị trí không được để trống");
      return;
    }

    if (allowedLocationTypes.length > 0 && !allowedLocationTypes.includes(locationForm.location_type)) {
      toast.error("Loại vị trí không hợp lệ với cấp cha hiện tại");
      return;
    }

    try {
      setSavingLocation(true);
      const payload = {
        warehouse_id: selectedWarehouseId,
        parent_location_id: locationForm.parent_location_id || null,
        code,
        name,
        location_type: locationForm.location_type,
        is_active: locationForm.is_active,
      };

      if (locationMode === "edit" && selectedLocationId) {
        await warehouseService.updateLocation(selectedLocationId, payload);
        toast.success("Đã cập nhật vị trí");
        await loadLocationTree(selectedWarehouseId, selectedLocationId);
      } else {
        const created = await warehouseService.createLocation(payload);
        toast.success("Đã tạo vị trí");
        await loadLocationTree(selectedWarehouseId, created.id);
      }
      setShowLocationForm(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lưu vị trí thất bại"));
    } finally {
      setSavingLocation(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!selectedLocationId || !selectedWarehouseId) {
      toast.error("Vui lòng chọn vị trí cần xóa");
      return;
    }

    const drillAnchorId = drillPath[drillPath.length - 1]?.id;

    try {
      setDeletingLocation(true);
      await warehouseService.deleteLocation(selectedLocationId);
      toast.success("Đã xóa vị trí");
      setSelectedLocationId("");
      const flat = await loadLocationTree(selectedWarehouseId);

      if (drillAnchorId) {
        const anchor = flat.find((item) => item.id === drillAnchorId) || null;
        if (anchor) {
          const path: LocationNode[] = [];
          let current: LocationNode | null = anchor;
          while (current) {
            path.unshift(current);
            current = current.parent_location_id
              ? flat.find((item) => item.id === current!.parent_location_id) || null
              : null;
          }
          setDrillPath(path);
        }
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xóa vị trí thất bại"));
    } finally {
      setDeletingLocation(false);
      setShowDeleteLocationConfirm(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <PageHeader
          icon={Package}
          title="Quản lý kho"
          description={`${warehouses.length} kho · Quản lý cấu trúc vị trí phân cấp`}
          iconBg="bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-500/20 dark:to-purple-500/10"
          iconColor="text-violet-600 dark:text-violet-400"
        />
      </motion.div>

      {pageError ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <SectionCard className="border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/10">
            <p className="text-[13px] text-red-700 dark:text-red-400">{pageError}</p>
          </SectionCard>
        </motion.div>
      ) : null}

      {!selectedWarehouseId ? (
        <div className="space-y-5">
          {!loadingWarehouses && warehouses.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
              <StatCard
                label="Tổng số kho"
                value={warehouseStats.total}
                icon={Boxes}
                variant="primary"
                animateValue
              />
              <StatCard
                label="Đang hoạt động"
                value={warehouseStats.active}
                icon={CheckCircle2}
                variant="success"
                animateValue
              />
              <StatCard
                label="Ngừng hoạt động"
                value={warehouseStats.inactive}
                icon={XCircle}
                variant={warehouseStats.inactive > 0 ? "danger" : "default"}
                animateValue
              />
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="flex items-center justify-end"
          >
            <Button onClick={startCreateWarehouse} size="sm">
              <Plus className="w-3.5 h-3.5" />
              Thêm kho
            </Button>
          </motion.div>

          {loadingWarehouses ? (
            <SectionCard><LoadingOverlay /></SectionCard>
          ) : warehouses.length === 0 ? (
            <SectionCard>
              <EmptyState variant="no-data" title="Chưa có kho nào" description="Hãy tạo kho mới để bắt đầu" />
            </SectionCard>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
              {warehouses.map((warehouse, index) => {
                const meta = warehouseTypeMeta(warehouse.warehouse_type);
                const Icon = meta.icon;
                const isActive = warehouse.is_active !== false;

                return (
                  <motion.button
                    key={warehouse.id}
                    onClick={() => setSelectedWarehouseId(warehouse.id)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.3) }}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.99 }}
                    className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-200 hover:border-transparent hover:shadow-[0_12px_28px_-8px_rgba(0,0,0,0.15)] dark:shadow-none"
                  >
                    <div
                      className={`pointer-events-none absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-25 bg-gradient-to-br ${meta.accentBorder}`}
                    />

                    <div className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.accentBorder} shadow-sm`}>
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
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {warehouse.warehouse_type || "WAREHOUSE"}
                      </span>
                      <span className={`flex items-center gap-1 text-[11px] font-medium ${isActive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-rose-500"}`} />
                        {isActive ? "Đang hoạt động" : "Ngừng hoạt động"}
                      </span>
                    </div>

                    <ChevronRight className="relative w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="relative overflow-hidden rounded-xl border border-border bg-card p-4"
          >
            {(() => {
              const meta = warehouseTypeMeta(selectedWarehouse?.warehouse_type);
              const Icon = meta.icon;
              const isActive = selectedWarehouse?.is_active !== false;
              return (
                <div>
                  <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${meta.accentBorder}`} />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Button variant="outline" size="sm" onClick={() => setSelectedWarehouseId("")}>
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Quay lại
                      </Button>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${meta.iconBg}`}>
                        <Icon className={`w-[18px] h-[18px] ${meta.iconColor}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold truncate">{selectedWarehouse?.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <p className="text-[11px] text-muted-foreground">{selectedWarehouse?.code}</p>
                          <StatusBadge label={selectedWarehouse?.warehouse_type || "WAREHOUSE"} variant="neutral" />
                          <StatusBadge label={isActive ? "Đang hoạt động" : "Ngừng hoạt động"} variant={isActive ? "success" : "danger"} dot />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" onClick={startEditWarehouse}>
                        <Pencil className="w-3.5 h-3.5" /> Sửa kho
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setShowDeleteWarehouseConfirm(true)} disabled={deletingWarehouse}>
                        <Trash2 className="w-3.5 h-3.5" /> {deletingWarehouse ? "Đang xóa..." : "Xóa kho"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </motion.div>

          {flatLocations.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.03 }}
              className="grid grid-cols-3 gap-3"
            >
              {(["ZONE", "SHELF", "SHELF_COMPARTMENT"] as const).map((type) => {
                const meta = locationTypeMeta(type);
                const Icon = meta.icon;
                return (
                  <div key={type} className="rounded-xl border border-border bg-card p-3.5 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.iconBg}`}>
                      <Icon className={`w-4 h-4 ${meta.textColor}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[18px] font-bold leading-none">{locationTypeCounts[type] || 0}</p>
                      <p className="text-[10px] text-muted-foreground mt-1 truncate">{TYPE_LABEL[type]}</p>
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
          >
            <SectionCard
              title="Cấu trúc vị trí trong kho"
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={startCreateRootLocation}>
                    <Plus className="w-3.5 h-3.5" /> Thêm vị trí
                  </Button>
                  <Button variant="outline" size="sm" onClick={startCreateChildLocation} disabled={!selectedLocationId}>
                    <Plus className="w-3.5 h-3.5" /> Thêm node con
                  </Button>
                  <Button variant="outline" size="sm" onClick={startEditLocation} disabled={!selectedLocationId}>
                    <Pencil className="w-3.5 h-3.5" /> Sửa
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setShowDeleteLocationConfirm(true)} disabled={!selectedLocationId || deletingLocation}>
                    <Trash2 className="w-3.5 h-3.5" /> {deletingLocation ? "Đang xóa..." : "Xóa"}
                  </Button>
                </div>
              }
            >
              {loadingLocations ? (
                <LoadingOverlay />
              ) : locationTree.length === 0 ? (
                <EmptyState variant="no-data" title="Chưa có vị trí nào" description="Thêm vị trí đầu tiên để bắt đầu" />
              ) : (
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap mb-4 text-[12px]">
                    <button
                      type="button"
                      onClick={() => handleDrillTo(0)}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors hover:bg-muted ${
                        drillPath.length === 0 ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Home className="w-3.5 h-3.5" /> Toàn bộ kho
                    </button>
                    {drillPath.map((node, index) => {
                      const meta = locationTypeMeta(node.location_type);
                      const isLast = index === drillPath.length - 1;
                      return (
                        <span key={node.id} className="inline-flex items-center gap-1.5">
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                          <button
                            type="button"
                            onClick={() => handleDrillTo(index + 1)}
                            className={`rounded-md px-2 py-1 font-medium transition-colors hover:bg-muted ${isLast ? meta.textColor : "text-muted-foreground hover:text-foreground"}`}
                          >
                            {node.name || node.code}
                          </button>
                        </span>
                      );
                    })}
                  </div>

                  {visibleLocations.length === 0 ? (
                    <EmptyState
                      variant="no-data"
                      title={`Chưa có ${TYPE_LABEL[CHILD_TYPE_BY_PARENT[normalizeType(drillPath[drillPath.length - 1]?.location_type)] || "ZONE"] || "vị trí"} nào`}
                      description="Bấm 'Thêm node con' để thêm vào đây"
                    />
                  ) : (
                    <motion.div
                      key={drillPath.map((n) => n.id).join("/")}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2 }}
                      className={
                        drillPath.length === 2
                          ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5"
                          : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
                      }
                    >
                      {visibleLocations.map((node, index) => (
                        <LocationTile
                          key={node.id}
                          node={node}
                          index={index}
                          isSelected={selectedLocationId === node.id}
                          onSelect={(id) => setSelectedLocationId(id)}
                          onDrillIn={handleDrillIn}
                          dense={drillPath.length === 2}
                        />
                      ))}
                    </motion.div>
                  )}
                </div>
              )}
            </SectionCard>
          </motion.div>
        </div>
      )}

      {showWarehouseForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="warehouse-form-modal-title">
          <motion.div ref={warehouseModalRef} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-lg overflow-hidden rounded-xl bg-card p-6 shadow-2xl">
            <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${warehouseTypeMeta(warehouseForm.warehouse_type).accentBorder}`} />
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${warehouseTypeMeta(warehouseForm.warehouse_type).iconBg}`}>
                  {(() => { const Icon = warehouseTypeMeta(warehouseForm.warehouse_type).icon; return <Icon className={`w-4 h-4 ${warehouseTypeMeta(warehouseForm.warehouse_type).iconColor}`} />; })()}
                </div>
                <h3 id="warehouse-form-modal-title" className="text-[16px] font-semibold">{warehouseMode === "create" ? "Thêm kho" : "Sửa kho"}</h3>
              </div>
              <button onClick={() => setShowWarehouseForm(false)} aria-label="Đóng" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <Input value={warehouseForm.code} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="Code *" />
              <Input value={warehouseForm.name} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Tên kho *" />
              <Select value={warehouseForm.warehouse_type} onValueChange={(value) => setWarehouseForm((prev) => ({ ...prev, warehouse_type: value }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WAREHOUSE">WAREHOUSE</SelectItem>
                  <SelectItem value="STORE">STORE</SelectItem>
                  <SelectItem value="BRANCH">BRANCH</SelectItem>
                  <SelectItem value="LIBRARY">LIBRARY</SelectItem>
                </SelectContent>
              </Select>
              <Input value={warehouseForm.address_line1} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, address_line1: event.target.value }))} placeholder="Địa chỉ" />

              <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                <Checkbox checked={warehouseForm.is_active} onCheckedChange={(checked) => setWarehouseForm((prev) => ({ ...prev, is_active: checked === true }))} />
                Hoạt động
              </label>
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowWarehouseForm(false)}>Hủy</Button>
              <Button className="flex-1" onClick={handleSaveWarehouse} disabled={savingWarehouse}>
                <Save className="w-3.5 h-3.5" /> {savingWarehouse ? "Đang lưu..." : "Lưu"}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}

      {showLocationForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="location-form-modal-title">
          <motion.div ref={locationModalRef} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-lg overflow-hidden rounded-xl bg-card p-6 shadow-2xl">
            <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${locationTypeMeta(locationForm.location_type).accentBorder}`} />
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${locationTypeMeta(locationForm.location_type).iconBg}`}>
                  {(() => { const Icon = locationTypeMeta(locationForm.location_type).icon; return <Icon className={`w-4 h-4 ${locationTypeMeta(locationForm.location_type).textColor}`} />; })()}
                </div>
                <h3 id="location-form-modal-title" className="text-[16px] font-semibold">{locationMode === "edit" ? "Sửa vị trí" : "Thêm vị trí"}</h3>
              </div>
              <button onClick={() => setShowLocationForm(false)} aria-label="Đóng" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <Input value={locationForm.code} onChange={(event) => setLocationForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="Code *" />
              <Input value={locationForm.name} onChange={(event) => setLocationForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Tên vị trí *" />
              <Select
                value={locationForm.parent_location_id || "root"}
                onValueChange={(value) => {
                  const parentId = value === "root" ? "" : value;
                  const parent = flatLocations.find((item) => item.id === parentId);
                  const inferredType = parent
                    ? (CHILD_TYPE_BY_PARENT[normalizeType(parent.location_type)] || "")
                    : "ZONE";

                  setLocationForm((prev) => ({
                    ...prev,
                    parent_location_id: parentId,
                    location_type: inferredType,
                  }));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Root (thuộc kho)</SelectItem>
                  {parentLocationOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{TYPE_LABEL[item.location_type] || item.location_type} · {item.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={locationForm.location_type || "none"}
                onValueChange={(value) => setLocationForm((prev) => ({ ...prev, location_type: value === "none" ? "" : value }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn loại vị trí" />
                </SelectTrigger>
                <SelectContent>
                  {(allowedLocationTypes.length > 0 ? allowedLocationTypes : LOCATION_TYPES).map((item) => (
                    <SelectItem key={item} value={item}>{TYPE_LABEL[item] || item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                <Checkbox checked={locationForm.is_active} onCheckedChange={(checked) => setLocationForm((prev) => ({ ...prev, is_active: checked === true }))} />
                Hoạt động
              </label>
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowLocationForm(false)}>Hủy</Button>
              <Button className="flex-1" onClick={handleSaveLocation} disabled={savingLocation || !selectedWarehouseId}>
                <Save className="w-3.5 h-3.5" /> {savingLocation ? "Đang lưu..." : "Lưu"}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}

      <ConfirmDialog
        open={showDeleteWarehouseConfirm}
        onOpenChange={setShowDeleteWarehouseConfirm}
        title="Xóa kho này?"
        description="Thao tác này không thể hoàn tác."
        variant="destructive"
        confirmLabel="Xóa kho"
        onConfirm={handleDeleteWarehouse}
        loading={deletingWarehouse}
      />

      <ConfirmDialog
        open={showDeleteLocationConfirm}
        onOpenChange={setShowDeleteLocationConfirm}
        title="Xóa vị trí này?"
        description="Thao tác này không thể hoàn tác."
        variant="destructive"
        confirmLabel="Xóa vị trí"
        onConfirm={handleDeleteLocation}
        loading={deletingLocation}
      />
    </div>
  );
}
