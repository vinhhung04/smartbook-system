import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { motion } from "motion/react";
import { Package, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { warehouseService, type LocationNode, type Warehouse } from "@/services/warehouse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { cn } from "@/components/ui/utils";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { WarehouseDirectory } from "./warehouse-directory";
import { LocationExplorer } from "./location-explorer";
import {
  CHILD_TYPE_BY_PARENT,
  LOCATION_TYPES,
  ROOT_TYPES,
  flattenNodes,
  locationTypeMeta,
  normalizeType,
  summarizeLocationTree,
  warehouseTypeMeta,
  type WarehouseLocationSummary,
} from "./meta";

type WarehouseMode = "create" | "edit";
type LocationMode = "create-root" | "create-child" | "edit";

interface WarehouseFormState {
  code: string;
  name: string;
  warehouse_type: string;
  address_line1: string;
  phone: string;
  email: string;
  opening_hours: string;
  description: string;
  is_active: boolean;
}

interface LocationFormState {
  code: string;
  name: string;
  location_type: string;
  parent_location_id: string;
  is_active: boolean;
}

const EMPTY_WAREHOUSE_FORM: WarehouseFormState = {
  code: "",
  name: "",
  warehouse_type: "WAREHOUSE",
  address_line1: "",
  phone: "",
  email: "",
  opening_hours: "",
  description: "",
  is_active: true,
};

const EMPTY_LOCATION_FORM: LocationFormState = {
  code: "",
  name: "",
  location_type: "ZONE",
  parent_location_id: "",
  is_active: true,
};

/** A form field with a visible label: placeholders alone vanish once a value is typed. */
function Field({ id, label, required, className, children }: { id: string; label: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      {children}
    </div>
  );
}

export function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  // The open warehouse lives in the URL (?kho=<id>), so a refresh or the browser's Back button keeps it.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedWarehouseId = searchParams.get("kho") || "";
  const setSelectedWarehouseId = useCallback((id: string) => {
    if ((searchParams.get("kho") || "") === id) return;
    const next = new URLSearchParams(searchParams);
    if (id) next.set("kho", id);
    else next.delete("kho");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);
  const [locationTree, setLocationTree] = useState<LocationNode[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [locationSummaries, setLocationSummaries] = useState<Record<string, WarehouseLocationSummary>>({});
  const [loadingSummaryIds, setLoadingSummaryIds] = useState<Set<string>>(new Set());
  const locationTreeCache = useRef<Map<string, LocationNode[]>>(new Map());
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

  const selectedWarehouse = useMemo(
    () => warehouses.find((item) => item.id === selectedWarehouseId) || null,
    [warehouses, selectedWarehouseId],
  );

  const flatLocations = useMemo(() => flattenNodes(locationTree), [locationTree]);
  const selectedLocation = useMemo(
    () => flatLocations.find((item) => item.id === selectedLocationId) || null,
    [flatLocations, selectedLocationId],
  );

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
  }, [selectedWarehouseId, setSelectedWarehouseId]);

  // Fetches (and caches) a warehouse's location tree, refreshing its directory-card summary as a side effect.
  const fetchLocationTree = useCallback(async (warehouseId: string, forceRefresh = false): Promise<LocationNode[]> => {
    const cached = locationTreeCache.current.get(warehouseId);
    if (cached && !forceRefresh) return cached;

    const data = await warehouseService.getLocationTree(warehouseId);
    const tree = Array.isArray(data?.tree) ? data.tree : [];
    locationTreeCache.current.set(warehouseId, tree);
    setLocationSummaries((prev) => ({ ...prev, [warehouseId]: summarizeLocationTree(tree) }));
    return tree;
  }, []);

  const loadLocationTree = useCallback(async (warehouseId: string, preferredLocationId?: string): Promise<LocationNode[]> => {
    if (!warehouseId) {
      setLocationTree([]);
      setSelectedLocationId("");
      return [];
    }

    try {
      setLoadingLocations(true);
      const tree = await fetchLocationTree(warehouseId, true);
      setLocationTree(tree);

      const flat = flattenNodes(tree);
      const allIds = new Set(flat.map((item) => item.id));

      const keep = preferredLocationId || selectedLocationId;
      setSelectedLocationId(keep && allIds.has(keep) ? keep : "");
      return flat;
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được cấu trúc vị trí"));
      setLocationTree([]);
      setSelectedLocationId("");
      return [];
    } finally {
      setLoadingLocations(false);
    }
  }, [fetchLocationTree, selectedLocationId]);

  useEffect(() => {
    void loadWarehouses();
  }, [loadWarehouses]);

  // Background-loads a glanceable location summary (counts + occupancy) for every warehouse card.
  useEffect(() => {
    const pending = warehouses.filter((warehouse) => !locationTreeCache.current.has(warehouse.id));
    if (pending.length === 0) return;

    setLoadingSummaryIds((prev) => new Set([...prev, ...pending.map((item) => item.id)]));
    pending.forEach((warehouse) => {
      fetchLocationTree(warehouse.id)
        .catch(() => {
          // Card falls back to showing no summary; the detail view will surface the real error on click-through.
        })
        .finally(() => {
          setLoadingSummaryIds((prev) => {
            const next = new Set(prev);
            next.delete(warehouse.id);
            return next;
          });
        });
    });
  }, [warehouses, fetchLocationTree]);

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
      phone: selectedWarehouse.phone || "",
      email: selectedWarehouse.email || "",
      opening_hours: selectedWarehouse.opening_hours || "",
      description: selectedWarehouse.description || "",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      phone: selectedWarehouse.phone || "",
      email: selectedWarehouse.email || "",
      opening_hours: selectedWarehouse.opening_hours || "",
      description: selectedWarehouse.description || "",
      is_active: selectedWarehouse.is_active ?? true,
    });
    setShowWarehouseForm(true);
  };

  const handleSaveWarehouse = async () => {
    const code = warehouseForm.code.trim();
    const name = warehouseForm.name.trim();

    if (!code) {
      toast.error("Mã kho không được để trống");
      return;
    }
    if (!name) {
      toast.error("Tên kho không được để trống");
      return;
    }

    try {
      setSavingWarehouse(true);
      const payload = {
        code,
        name,
        warehouse_type: warehouseForm.warehouse_type,
        address_line1: warehouseForm.address_line1.trim() || undefined,
        phone: warehouseForm.phone.trim(),
        email: warehouseForm.email.trim(),
        opening_hours: warehouseForm.opening_hours.trim(),
        description: warehouseForm.description.trim(),
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

    try {
      setDeletingLocation(true);
      await warehouseService.deleteLocation(selectedLocationId);
      toast.success("Đã xóa vị trí");
      setSelectedLocationId("");
      await loadLocationTree(selectedWarehouseId);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xóa vị trí thất bại"));
    } finally {
      setDeletingLocation(false);
      setShowDeleteLocationConfirm(false);
    }
  };

  const typeCounts = warehouses.reduce<Record<string, number>>((acc, item) => {
    const label = warehouseTypeMeta(item.warehouse_type).label.toLowerCase();
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const directoryLede = loadingWarehouses && warehouses.length === 0
    ? "Đang tải danh sách kho..."
    : [`${warehouses.length} kho`, ...Object.entries(typeCounts).map(([label, count]) => `${count} ${label}`)].join(", ");

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      {pageError ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-[13px] text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {pageError}
        </div>
      ) : null}

      {!selectedWarehouseId ? (
        <>
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <PageHeader
              icon={Package}
              title="Quản lý kho"
              description={`${directoryLede}. Mở một kho để sắp xếp khu vực, kệ và ngăn kệ.`}
              actions={
                <Button size="sm" onClick={startCreateWarehouse}>
                  <Plus className="h-3.5 w-3.5" /> Thêm kho
                </Button>
              }
            />
          </motion.div>
          <WarehouseDirectory
            warehouses={warehouses}
            loading={loadingWarehouses}
            summaries={locationSummaries}
            loadingSummaryIds={loadingSummaryIds}
            onSelect={setSelectedWarehouseId}
          />
        </>
      ) : selectedWarehouse ? (
        <LocationExplorer
          warehouse={selectedWarehouse}
          onBack={() => setSelectedWarehouseId("")}
          onEditWarehouse={startEditWarehouse}
          onDeleteWarehouse={() => setShowDeleteWarehouseConfirm(true)}
          deletingWarehouse={deletingWarehouse}
          locationTree={locationTree}
          loadingLocations={loadingLocations}
          selectedLocationId={selectedLocationId}
          onSelectLocation={setSelectedLocationId}
          onCreateRootLocation={startCreateRootLocation}
          onCreateChildLocation={startCreateChildLocation}
          onEditLocation={startEditLocation}
          onDeleteLocation={() => setShowDeleteLocationConfirm(true)}
          deletingLocation={deletingLocation}
        />
      ) : loadingWarehouses ? (
        <LoadingOverlay className="py-24" />
      ) : null}

      {showWarehouseForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="warehouse-form-modal-title">
          <motion.div
            ref={warehouseModalRef}
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.5)]"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="warehouse-form-modal-title" className="font-serif text-[22px] font-semibold tracking-tight">
                  {warehouseMode === "create" ? "Thêm kho" : "Sửa kho"}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {warehouseMode === "create" ? "Kho mới bắt đầu trống. Thêm khu vực và kệ sau khi tạo." : selectedWarehouse?.name}
                </p>
              </div>
              <button onClick={() => setShowWarehouseForm(false)} aria-label="Đóng" className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="warehouse-code" label="Mã kho" required>
                <Input
                  id="warehouse-code"
                  value={warehouseForm.code}
                  onChange={(event) => setWarehouseForm((prev) => ({ ...prev, code: event.target.value }))}
                  placeholder="VD: WH-HCM-01"
                  className="font-mono"
                />
              </Field>
              <Field id="warehouse-type" label="Loại kho">
                <Select value={warehouseForm.warehouse_type} onValueChange={(value) => setWarehouseForm((prev) => ({ ...prev, warehouse_type: value }))}>
                  <SelectTrigger id="warehouse-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WAREHOUSE">Kho tổng</SelectItem>
                    <SelectItem value="STORE">Cửa hàng</SelectItem>
                    <SelectItem value="BRANCH">Chi nhánh</SelectItem>
                    <SelectItem value="LIBRARY">Thư viện</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field id="warehouse-name" label="Tên kho" required className="sm:col-span-2">
                <Input id="warehouse-name" value={warehouseForm.name} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="VD: Kho HCM Chính" />
              </Field>
              <Field id="warehouse-address" label="Địa chỉ" className="sm:col-span-2">
                <Input id="warehouse-address" value={warehouseForm.address_line1} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, address_line1: event.target.value }))} placeholder="Số nhà, đường, quận" />
              </Field>
              {["BRANCH", "LIBRARY"].includes(warehouseForm.warehouse_type) ? (
                <fieldset className="grid gap-4 rounded-xl border border-border p-4 sm:col-span-2 sm:grid-cols-2">
                  <legend className="px-1 text-[13px] font-medium text-muted-foreground">Hiển thị cho bạn đọc trên trang chi nhánh</legend>
                  <Field id="warehouse-hours" label="Giờ mở cửa" className="sm:col-span-2">
                    <Input id="warehouse-hours" value={warehouseForm.opening_hours} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, opening_hours: event.target.value }))} placeholder="VD: Thứ 2 – Thứ 6: 8:00 – 20:00" maxLength={255} />
                  </Field>
                  <Field id="warehouse-phone" label="Số điện thoại">
                    <Input id="warehouse-phone" value={warehouseForm.phone} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, phone: event.target.value }))} maxLength={30} inputMode="tel" />
                  </Field>
                  <Field id="warehouse-email" label="Email chi nhánh">
                    <Input id="warehouse-email" type="email" value={warehouseForm.email} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, email: event.target.value }))} maxLength={255} />
                  </Field>
                  <Field id="warehouse-description" label="Mô tả ngắn" className="sm:col-span-2">
                    <Input id="warehouse-description" value={warehouseForm.description} onChange={(event) => setWarehouseForm((prev) => ({ ...prev, description: event.target.value }))} maxLength={2000} />
                  </Field>
                </fieldset>
              ) : null}

              <label className="inline-flex items-center gap-2 text-[13px] text-foreground sm:col-span-2">
                <Checkbox checked={warehouseForm.is_active} onCheckedChange={(checked) => setWarehouseForm((prev) => ({ ...prev, is_active: checked === true }))} />
                Đang hoạt động
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowWarehouseForm(false)}>Hủy</Button>
              <Button onClick={handleSaveWarehouse} disabled={savingWarehouse}>
                <Save className="h-3.5 w-3.5" /> {savingWarehouse ? "Đang lưu..." : warehouseMode === "create" ? "Tạo kho" : "Lưu thay đổi"}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}

      {showLocationForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="location-form-modal-title">
          <motion.div
            ref={locationModalRef}
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.5)]"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="location-form-modal-title" className="font-serif text-[22px] font-semibold tracking-tight">
                  {locationMode === "edit" ? "Sửa vị trí" : `Thêm ${locationTypeMeta(locationForm.location_type).label.toLowerCase()}`}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">{selectedWarehouse?.name}</p>
              </div>
              <button onClick={() => setShowLocationForm(false)} aria-label="Đóng" className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="location-code" label="Mã vị trí" required>
                <Input
                  id="location-code"
                  value={locationForm.code}
                  onChange={(event) => setLocationForm((prev) => ({ ...prev, code: event.target.value }))}
                  placeholder="VD: SHELF-A-01"
                  className="font-mono"
                />
              </Field>
              <Field id="location-name" label="Tên vị trí" required>
                <Input id="location-name" value={locationForm.name} onChange={(event) => setLocationForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="VD: A / 01" />
              </Field>
              <Field id="location-parent" label="Nằm trong">
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
                  <SelectTrigger id="location-parent" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">Cấp gốc của kho</SelectItem>
                    {parentLocationOptions.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {locationTypeMeta(item.location_type).label} {item.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="location-type" label="Loại vị trí">
                <Select
                  value={locationForm.location_type || "none"}
                  onValueChange={(value) => setLocationForm((prev) => ({ ...prev, location_type: value === "none" ? "" : value }))}
                >
                  <SelectTrigger id="location-type" className="w-full">
                    <SelectValue placeholder="Chọn loại vị trí" />
                  </SelectTrigger>
                  <SelectContent>
                    {(allowedLocationTypes.length > 0 ? allowedLocationTypes : LOCATION_TYPES).map((item) => (
                      <SelectItem key={item} value={item}>{locationTypeMeta(item).label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <label className="inline-flex items-center gap-2 text-[13px] text-foreground sm:col-span-2">
                <Checkbox checked={locationForm.is_active} onCheckedChange={(checked) => setLocationForm((prev) => ({ ...prev, is_active: checked === true }))} />
                Đang hoạt động
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowLocationForm(false)}>Hủy</Button>
              <Button onClick={handleSaveLocation} disabled={savingLocation || !selectedWarehouseId}>
                <Save className="h-3.5 w-3.5" /> {savingLocation ? "Đang lưu..." : locationMode === "edit" ? "Lưu thay đổi" : "Tạo vị trí"}
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
