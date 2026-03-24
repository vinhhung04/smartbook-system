import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ChevronRight, MapPin, Package, Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { warehouseService, type LocationNode, type Warehouse } from "@/services/warehouse";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

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

function TreeNode({
  node,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
}: {
  node: LocationNode;
  selectedId: string;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const expanded = expandedIds.has(node.id);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node.id);
          }
        }}
        className={`w-full flex items-center gap-2 py-2 px-3 rounded-lg transition-colors text-left ${selectedId === node.id ? "bg-violet-50 border border-violet-200" : "hover:bg-muted/60 border border-transparent"}`}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
          className="inline-flex items-center justify-center w-4 h-4"
        >
          <motion.div animate={{ rotate: hasChildren && expanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </button>
        <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] truncate font-semibold">{node.name || node.code}</p>
          <p className="text-[10px] text-muted-foreground">{TYPE_LABEL[node.location_type] || node.location_type} · {node.code}</p>
        </div>
      </div>

      {hasChildren && expanded ? (
        <div className="ml-3 border-l border-border pl-3">
          {(node.children || []).map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [warehouseMode, setWarehouseMode] = useState<WarehouseMode>("edit");
  const [locationMode, setLocationMode] = useState<LocationMode>("create-root");
  const [warehouseForm, setWarehouseForm] = useState<WarehouseFormState>(EMPTY_WAREHOUSE_FORM);
  const [locationForm, setLocationForm] = useState<LocationFormState>(EMPTY_LOCATION_FORM);
  const [pageError, setPageError] = useState("");
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);

  const selectedWarehouse = useMemo(
    () => warehouses.find((item) => item.id === selectedWarehouseId) || null,
    [warehouses, selectedWarehouseId],
  );

  const flatLocations = useMemo(() => flattenNodes(locationTree), [locationTree]);
  const selectedLocation = useMemo(
    () => flatLocations.find((item) => item.id === selectedLocationId) || null,
    [flatLocations, selectedLocationId],
  );

  const loadWarehouses = async (preferredId?: string) => {
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
      const message = getApiErrorMessage(error, "Khong tai duoc danh sach kho");
      setPageError(message);
      toast.error(message);
    } finally {
      setLoadingWarehouses(false);
    }
  };

  const loadLocationTree = async (warehouseId: string, preferredLocationId?: string) => {
    if (!warehouseId) {
      setLocationTree([]);
      setSelectedLocationId("");
      return;
    }

    try {
      setLoadingLocations(true);
      const data = await warehouseService.getLocationTree(warehouseId);
      const tree = Array.isArray(data?.tree) ? data.tree : [];
      setLocationTree(tree);

      const allIds = new Set(flattenNodes(tree).map((item) => item.id));
      setExpandedIds(allIds);

      const keep = preferredLocationId || selectedLocationId;
      if (keep && allIds.has(keep)) {
        setSelectedLocationId(keep);
      } else {
        setSelectedLocationId("");
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong tai duoc cau truc vi tri"));
      setLocationTree([]);
      setSelectedLocationId("");
    } finally {
      setLoadingLocations(false);
    }
  };

  useEffect(() => {
    void loadWarehouses();
  }, []);

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
  }, [selectedWarehouseId]);

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

  const handleToggleNode = (id: string) => {
    setExpandedIds((prev) => {
      const clone = new Set(prev);
      if (clone.has(id)) {
        clone.delete(id);
      } else {
        clone.add(id);
      }
      return clone;
    });
  };

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
        toast.success("Da tao kho moi");
        await loadWarehouses();
        setSelectedWarehouseId("");
      } else if (selectedWarehouseId) {
        await warehouseService.update(selectedWarehouseId, payload);
        toast.success("Da cap nhat kho");
        await loadWarehouses(selectedWarehouseId);
      }
      setShowWarehouseForm(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Luu kho that bai"));
    } finally {
      setSavingWarehouse(false);
    }
  };

  const handleDeleteWarehouse = async () => {
    if (!selectedWarehouseId) return;
    const accepted = window.confirm("Xoa kho nay? Thao tac nay khong the hoan tac.");
    if (!accepted) return;

    try {
      setDeletingWarehouse(true);
      await warehouseService.delete(selectedWarehouseId);
      toast.success("Da xoa kho");
      setSelectedWarehouseId("");
      await loadWarehouses();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xoa kho that bai"));
    } finally {
      setDeletingWarehouse(false);
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
      toast.error("Vui long chon mot vi tri cha");
      return;
    }
    const childType = CHILD_TYPE_BY_PARENT[normalizeType(selectedLocation.location_type)];
    if (!childType) {
      toast.error("Vi tri nay khong ho tro them node con");
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
      toast.error("Vui long chon vi tri can sua");
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
      toast.error("Vui long chon kho");
      return;
    }

    const code = locationForm.code.trim();
    const name = locationForm.name.trim();
    if (!code) {
      toast.error("Code vi tri khong duoc de trong");
      return;
    }
    if (!name) {
      toast.error("Ten vi tri khong duoc de trong");
      return;
    }

    if (allowedLocationTypes.length > 0 && !allowedLocationTypes.includes(locationForm.location_type)) {
      toast.error("Loai vi tri khong hop le voi cap cha hien tai");
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
        toast.success("Da cap nhat vi tri");
        await loadLocationTree(selectedWarehouseId, selectedLocationId);
      } else {
        const created = await warehouseService.createLocation(payload);
        toast.success("Da tao vi tri");
        await loadLocationTree(selectedWarehouseId, created.id);
      }
      setShowLocationForm(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Luu vi tri that bai"));
    } finally {
      setSavingLocation(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!selectedLocationId || !selectedWarehouseId) {
      toast.error("Vui long chon vi tri can xoa");
      return;
    }

    const accepted = window.confirm("Xoa vi tri nay? Thao tac nay khong the hoan tac.");
    if (!accepted) return;

    try {
      setDeletingLocation(true);
      await warehouseService.deleteLocation(selectedLocationId);
      toast.success("Da xoa vi tri");
      setSelectedLocationId("");
      await loadLocationTree(selectedWarehouseId);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xoa vi tri that bai"));
    } finally {
      setDeletingLocation(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-3"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-purple-50 flex items-center justify-center border border-violet-200/40">
          <Package className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Warehouses</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">{warehouses.length} kho · Quan ly cau truc vi tri phan cap</p>
        </div>
      </motion.div>

      {pageError ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <SectionCard className="border-red-200 bg-red-50">
            <p className="text-[13px] text-red-700">{pageError}</p>
          </SectionCard>
        </motion.div>
      ) : null}

      {!selectedWarehouseId ? (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="flex items-center justify-end"
          >
            <Button onClick={startCreateWarehouse} size="sm">
              <Plus className="w-3.5 h-3.5" />
              Them kho
            </Button>
          </motion.div>

          {loadingWarehouses ? (
            <SectionCard><p className="text-center py-8 text-[12px] text-muted-foreground">Dang tai danh sach kho...</p></SectionCard>
          ) : warehouses.length === 0 ? (
            <SectionCard>
              <EmptyState variant="no-data" title="Chua co kho nao" description="Hay tao kho moi de bat dau" />
            </SectionCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {warehouses.map((warehouse) => (
                <motion.button
                  key={warehouse.id}
                  onClick={() => setSelectedWarehouseId(warehouse.id)}
                  whileHover={{ y: -2 }}
                  className="w-full text-left p-4 rounded-xl border-2 border-border bg-card hover:border-primary/30 transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-[12px] font-semibold">{warehouse.code}</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{warehouse.name}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-violet-600" />
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">{warehouse.warehouse_type || "WAREHOUSE"} · {warehouse.is_active === false ? "INACTIVE" : "ACTIVE"}</p>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setSelectedWarehouseId("")}>
                <ArrowLeft className="w-3.5 h-3.5" />
                Quay lai danh sach
              </Button>
              <div>
                <p className="text-[13px] font-semibold">{selectedWarehouse?.name}</p>
                <p className="text-[11px] text-muted-foreground">{selectedWarehouse?.code} · {selectedWarehouse?.warehouse_type || "WAREHOUSE"}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={startEditWarehouse}>
                <Pencil className="w-3.5 h-3.5" /> Sua kho
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDeleteWarehouse} disabled={deletingWarehouse}>
                <Trash2 className="w-3.5 h-3.5" /> {deletingWarehouse ? "Dang xoa..." : "Xoa kho"}
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
          >
            <SectionCard
              title="Cau truc vi tri trong kho"
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={startCreateRootLocation}>
                    <Plus className="w-3.5 h-3.5" /> Them vi tri
                  </Button>
                  <Button variant="outline" size="sm" onClick={startCreateChildLocation} disabled={!selectedLocationId}>
                    <Plus className="w-3.5 h-3.5" /> Them node con
                  </Button>
                  <Button variant="outline" size="sm" onClick={startEditLocation} disabled={!selectedLocationId}>
                    <Pencil className="w-3.5 h-3.5" /> Sua
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleDeleteLocation} disabled={!selectedLocationId || deletingLocation}>
                    <Trash2 className="w-3.5 h-3.5" /> {deletingLocation ? "Dang xoa..." : "Xoa"}
                  </Button>
                </div>
              }
            >
              {loadingLocations ? (
                <p className="text-center py-8 text-[12px] text-muted-foreground">Dang tai cau truc vi tri...</p>
              ) : locationTree.length === 0 ? (
                <EmptyState variant="no-data" title="Chua co vi tri nao" description="Them vi tri dau tien de bat dau" />
              ) : (
                <div className="space-y-0 max-h-[560px] overflow-auto pr-1">
                  {locationTree.map((node) => (
                    <TreeNode
                      key={node.id}
                      node={node}
                      selectedId={selectedLocationId}
                      expandedIds={expandedIds}
                      onToggle={handleToggleNode}
                      onSelect={(id) => setSelectedLocationId(id)}
                    />
                  ))}
                </div>
              )}
            </SectionCard>
          </motion.div>
        </div>
      )}

      {showWarehouseForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-lg rounded-xl bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold">{warehouseMode === "create" ? "Them kho" : "Sua kho"}</h3>
              <button onClick={() => setShowWarehouseForm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <input value={warehouseForm.code} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="Code *" className="w-full rounded-lg border border-input px-3 py-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/10" />
              <input value={warehouseForm.name} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Ten kho *" className="w-full rounded-lg border border-input px-3 py-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/10" />
              <select value={warehouseForm.warehouse_type} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, warehouse_type: event.target.value }))} className="w-full rounded-lg border border-input px-3 py-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/10">
                <option value="WAREHOUSE">WAREHOUSE</option>
                <option value="STORE">STORE</option>
                <option value="BRANCH">BRANCH</option>
                <option value="LIBRARY">LIBRARY</option>
              </select>
              <input value={warehouseForm.address_line1} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, address_line1: event.target.value }))} placeholder="Dia chi" className="w-full rounded-lg border border-input px-3 py-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/10" />

              <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                <input type="checkbox" checked={warehouseForm.is_active} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, is_active: event.target.checked }))} />
                Active
              </label>
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowWarehouseForm(false)}>Huy</Button>
              <Button className="flex-1" onClick={handleSaveWarehouse} disabled={savingWarehouse}>
                <Save className="w-3.5 h-3.5" /> {savingWarehouse ? "Dang luu..." : "Luu"}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}

      {showLocationForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-lg rounded-xl bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold">{locationMode === "edit" ? "Sua vi tri" : "Them vi tri"}</h3>
              <button onClick={() => setShowLocationForm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <input value={locationForm.code} onChange={(event) => setLocationForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="Code *" className="w-full rounded-lg border border-input px-3 py-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/10" />
              <input value={locationForm.name} onChange={(event) => setLocationForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Ten vi tri *" className="w-full rounded-lg border border-input px-3 py-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/10" />
              <select
                value={locationForm.parent_location_id}
                onChange={(event) => {
                  const parentId = event.target.value;
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
                className="w-full rounded-lg border border-input px-3 py-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/10"
              >
                <option value="">Root (thuoc kho)</option>
                {parentLocationOptions.map((item) => (
                  <option key={item.id} value={item.id}>{TYPE_LABEL[item.location_type] || item.location_type} · {item.code}</option>
                ))}
              </select>
              <select value={locationForm.location_type} onChange={(event) => setLocationForm((prev) => ({ ...prev, location_type: event.target.value }))} className="w-full rounded-lg border border-input px-3 py-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/10">
                <option value="">Chon loai vi tri</option>
                {(allowedLocationTypes.length > 0 ? allowedLocationTypes : LOCATION_TYPES).map((item) => (
                  <option key={item} value={item}>{TYPE_LABEL[item] || item}</option>
                ))}
              </select>

              <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                <input type="checkbox" checked={locationForm.is_active} onChange={(event) => setLocationForm((prev) => ({ ...prev, is_active: event.target.checked }))} />
                Active
              </label>
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowLocationForm(false)}>Huy</Button>
              <Button className="flex-1" onClick={handleSaveLocation} disabled={savingLocation || !selectedWarehouseId}>
                <Save className="w-3.5 h-3.5" /> {savingLocation ? "Dang luu..." : "Luu"}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </div>
  );
}
