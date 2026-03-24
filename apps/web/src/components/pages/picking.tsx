import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, ScanLine, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { getApiErrorMessage } from "@/services/api.ts";
import { authService } from "@/services/auth";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import {
  pickingService,
  type PickingTaskDetail,
  type PickingTaskSummary,
  type PickingTaskType,
  type PickingVariantLookupMatch,
} from "@/services/picking";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function taskTypeLabel(orderType: string): string {
  if (orderType === "OUTBOUND_REPICK") return "Outbound / Repick";
  if (orderType === "WAREHOUSE_TRANSFER_REPICK") return "Warehouse Transfer / Repick";
  if (orderType === "WAREHOUSE_TRANSFER") return "Warehouse Transfer";
  if (orderType.startsWith("OUTBOUND_")) return "Outbound / Store";
  return orderType;
}

function taskClassLabel(taskClass?: string): string {
  return taskClass === "REPICK" ? "REPICK" : "PICK";
}

type PickingScanTarget = "presence" | "location" | "product";

export function PickingPage() {
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [claimingTaskKey, setClaimingTaskKey] = useState("");
  const [confirmingPresence, setConfirmingPresence] = useState(false);
  const [confirmingLine, setConfirmingLine] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");

  const [tasks, setTasks] = useState<PickingTaskSummary[]>([]);
  const [query, setQuery] = useState("");
  const [taskClassFilter, setTaskClassFilter] = useState<"ALL" | "PICK" | "REPICK">("ALL");

  const [selectedTaskType, setSelectedTaskType] = useState<PickingTaskType | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [detail, setDetail] = useState<PickingTaskDetail | null>(null);

  const [presenceConfirmed, setPresenceConfirmed] = useState(false);
  const [presenceInput, setPresenceInput] = useState("");
  const [presenceResolvedLocationInput, setPresenceResolvedLocationInput] = useState("");

  const [locationInput, setLocationInput] = useState("");
  const [locationVerified, setLocationVerified] = useState(false);
  const [productBarcodeInput, setProductBarcodeInput] = useState("");
  const [productVerified, setProductVerified] = useState(false);
  const [quantityInput, setQuantityInput] = useState(1);
  const [selectedScannedVariantId, setSelectedScannedVariantId] = useState("");
  const [ambiguousMatches, setAmbiguousMatches] = useState<PickingVariantLookupMatch[]>([]);
  const [activeScanTarget, setActiveScanTarget] = useState<PickingScanTarget | null>(null);

  const currentUser = authService.getCurrentUser();
  const currentUserId = String((currentUser as { id?: string } | null)?.id || "");
  const currentUserLabel = String((currentUser as { full_name?: string; username?: string; email?: string } | null)?.full_name
    || (currentUser as { full_name?: string; username?: string; email?: string } | null)?.username
    || (currentUser as { full_name?: string; username?: string; email?: string } | null)?.email
    || "Toi");

  const filteredTasks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const classFiltered = taskClassFilter === "ALL"
      ? tasks
      : tasks.filter((task) => taskClassLabel(task.task_class) === taskClassFilter);

    if (!keyword) return classFiltered;

    return classFiltered.filter((task) => (
      task.order_number.toLowerCase().includes(keyword)
      || (task.source_warehouse_code || "").toLowerCase().includes(keyword)
      || (task.source_warehouse_name || "").toLowerCase().includes(keyword)
      || taskTypeLabel(task.order_type).toLowerCase().includes(keyword)
    ));
  }, [tasks, query, taskClassFilter]);

  const currentLine = detail?.current_line || null;
  const completedLineCount = useMemo(
    () => (detail?.lines || []).filter((line) => Number(line.picked_qty || 0) >= Number(line.requested_qty || 0)).length,
    [detail],
  );
  const totalPickedQty = useMemo(
    () => (detail?.lines || []).reduce((sum, line) => sum + Number(line.picked_qty || 0), 0),
    [detail],
  );

  const canConfirmLine = Boolean(
    detail
    && currentLine
    && presenceConfirmed
    && locationVerified
    && productVerified
    && Number(quantityInput) > 0,
  );

  const scannerTitle = useMemo(() => {
    if (activeScanTarget === "presence") return "Quet vi tri hien tai";
    if (activeScanTarget === "location") return "Quet location can den";
    if (activeScanTarget === "product") return "Quet barcode san pham";
    return "Quet Barcode";
  }, [activeScanTarget]);

  const loadTasks = async (warehouseId?: string) => {
    const res = await pickingService.getTasks(warehouseId);
    setTasks(res.data || []);
  };

  const loadDetail = async (
    taskType: PickingTaskType,
    taskId: string,
    options?: { preservePresence?: boolean; currentLocationInput?: string },
  ) => {
    setLoadingDetail(true);
    try {
      const preservePresence = options?.preservePresence === true;
      const currentLocationInput = options?.currentLocationInput || (preservePresence ? presenceResolvedLocationInput : "");
      const data = await pickingService.getTaskDetail(taskType, taskId, currentLocationInput || undefined);
      setDetail(data);
      setSelectedTaskType(taskType);
      setSelectedTaskId(taskId);

      if (!preservePresence) {
        setPresenceConfirmed(false);
        setPresenceInput("");
        setPresenceResolvedLocationInput("");
      }

      setLocationInput("");
      setLocationVerified(false);
      setProductBarcodeInput("");
      setProductVerified(false);
      setQuantityInput(1);
      setSelectedScannedVariantId("");
      setAmbiguousMatches([]);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);

        const [warehouseRows] = await Promise.all([
          warehouseService.getAll(),
        ]);

        const rows = Array.isArray(warehouseRows) ? warehouseRows : [];
        setWarehouses(rows);

        const preferredWarehouseFromUser = String((currentUser as { primary_warehouse_id?: string } | null)?.primary_warehouse_id || "");
        const preferredWarehouse = rows.find((item) => item.id === preferredWarehouseFromUser)?.id || rows[0]?.id || "";

        setSelectedWarehouseId(preferredWarehouse);
        await loadTasks(preferredWarehouse || undefined);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach don picking"));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    if (!selectedWarehouseId) {
      setTasks([]);
      return;
    }

    void loadTasks(selectedWarehouseId).catch((error) => {
      toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach don theo warehouse"));
    });
  }, [selectedWarehouseId]);

  const handleClaimTask = async (task: PickingTaskSummary) => {
    const key = `${task.task_type}:${task.task_id}`;

    try {
      setClaimingTaskKey(key);
      await pickingService.claimTask(task.task_type, task.task_id);
      await loadTasks(selectedWarehouseId || undefined);
      await loadDetail(task.task_type, task.task_id);
      toast.success(`Da nhan don ${task.order_number}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nhan don that bai"));
    } finally {
      setClaimingTaskKey("");
    }
  };

  const handleOpenTask = async (task: PickingTaskSummary) => {
    try {
      await loadDetail(task.task_type, task.task_id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong mo duoc chi tiet don pick"));
    }
  };

  const handleConfirmPresence = async (inputOverride?: string) => {
    if (!selectedTaskType || !selectedTaskId) return;

    const sourceInput = inputOverride ?? presenceInput;
    const input = sourceInput.trim();

    if (inputOverride !== undefined) {
      setPresenceInput(sourceInput);
    }

    if (!input) {
      toast.error("Nhap hoac scan vi tri hien tai");
      return;
    }

    try {
      setConfirmingPresence(true);
      const res = await pickingService.confirmPresence(selectedTaskType, selectedTaskId, input);

      const confirmedLocation = String(res.data.location_code || input).trim();
      setPresenceConfirmed(true);
      setPresenceResolvedLocationInput(confirmedLocation);
      setPresenceInput("");

      await loadDetail(selectedTaskType, selectedTaskId, {
        preservePresence: true,
        currentLocationInput: confirmedLocation,
      });

      toast.success(`Xac nhan hien dien tai ${res.data.location_code}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xac nhan hien dien that bai"));
    } finally {
      setConfirmingPresence(false);
    }
  };

  const handleLookupProduct = async (barcodeOverride?: string) => {
    if (!locationVerified) {
      toast.error("Can scan dung location dich truoc");
      return;
    }

    if (!currentLine) {
      toast.error("Khong xac dinh duoc line hien tai");
      return;
    }

    const sourceBarcode = barcodeOverride ?? productBarcodeInput;
    const barcode = sourceBarcode.trim();

    if (barcodeOverride !== undefined) {
      setProductBarcodeInput(sourceBarcode);
    }

    if (!barcode) {
      toast.error("Nhap barcode san pham");
      return;
    }

    try {
      setLoadingLookup(true);
      const res = await pickingService.lookupVariantByBarcode(barcode);

      if (res.ambiguous) {
        setAmbiguousMatches(res.matches || []);
        setSelectedScannedVariantId("");
        setProductVerified(false);
        toast.error("Barcode trung nhieu SKU, vui long chon dung item");
        return;
      }

      setAmbiguousMatches([]);
      if (res.selected?.variant_id) {
        if (res.selected.variant_id !== currentLine.variant_id) {
          setProductVerified(false);
          setSelectedScannedVariantId("");
          toast.error("Sai san pham cho line hien tai");
          return;
        }

        setSelectedScannedVariantId(res.selected.variant_id);
        setProductVerified(true);
        toast.success(`Da nhan dien: ${res.selected.book_title}`);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong lookup duoc barcode san pham"));
    } finally {
      setLoadingLookup(false);
    }
  };

  const handleConfirmLine = async () => {
    if (!selectedTaskType || !selectedTaskId || !currentLine) {
      toast.error("Chua co line can pick");
      return;
    }

    const quantity = Math.trunc(Number(quantityInput || 0));

    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("So luong phai > 0");
      return;
    }

    if (quantity > Number(currentLine.remaining_qty || 0)) {
      toast.error("So luong vuot qua so luong con phai pick cua line");
      return;
    }

    try {
      setConfirmingLine(true);

      const payload = {
        quantity,
        scanned_location_input: locationInput.trim(),
        scanned_product_barcode: productBarcodeInput.trim() || null,
        scanned_variant_id: selectedScannedVariantId || null,
      };

      await pickingService.confirmLine(selectedTaskType, selectedTaskId, currentLine.line_id, payload);

      const nextLocationContext = locationInput.trim() || presenceResolvedLocationInput;

      setLocationInput("");
      setLocationVerified(false);
      setProductBarcodeInput("");
      setProductVerified(false);
      setQuantityInput(1);
      setSelectedScannedVariantId("");
      setAmbiguousMatches([]);

      setPresenceConfirmed(true);
      setPresenceResolvedLocationInput(nextLocationContext);

      await Promise.all([
        loadDetail(selectedTaskType, selectedTaskId, {
          preservePresence: true,
          currentLocationInput: nextLocationContext,
        }),
        loadTasks(selectedWarehouseId || undefined),
      ]);

      toast.success("Da confirm line pick thanh cong");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Confirm pick line that bai"));
    } finally {
      setConfirmingLine(false);
    }
  };

  const handleBackToList = () => {
    setSelectedTaskType(null);
    setSelectedTaskId("");
    setDetail(null);
    setPresenceConfirmed(false);
    setPresenceInput("");
    setPresenceResolvedLocationInput("");
    setLocationInput("");
    setLocationVerified(false);
    setProductBarcodeInput("");
    setProductVerified(false);
    setQuantityInput(1);
    setSelectedScannedVariantId("");
    setAmbiguousMatches([]);
    setActiveScanTarget(null);
  };

  const handleVerifyLocation = (inputOverride?: string) => {
    if (!currentLine) {
      toast.error("Khong co line can pick");
      return;
    }

    const sourceInput = inputOverride ?? locationInput;
    const input = sourceInput.trim().toLowerCase();

    if (inputOverride !== undefined) {
      setLocationInput(sourceInput);
    }

    if (!input) {
      toast.error("Nhap hoac scan location dich");
      return;
    }

    const expected = [
      currentLine.source_location_id,
      currentLine.source_location_code,
      currentLine.source_location_barcode,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase());

    if (expected.includes(input)) {
      setLocationVerified(true);
      setProductVerified(false);
      setProductBarcodeInput("");
      setQuantityInput(Math.max(1, Math.trunc(Number(currentLine.remaining_qty || 1))));
      setSelectedScannedVariantId("");
      setAmbiguousMatches([]);
      toast.success("Da xac nhan dung location pick");
      return;
    }

    setLocationVerified(false);
    setProductVerified(false);
    toast.error(`Sai location. Can den ${currentLine.source_location_code || "vi tri duoc chi dinh"}`);
  };

  const handleDetectedScan = (code: string) => {
    const normalized = String(code || "").trim();
    if (!normalized || !activeScanTarget) return;

    if (activeScanTarget === "presence") {
      void handleConfirmPresence(normalized);
    }

    if (activeScanTarget === "location") {
      handleVerifyLocation(normalized);
    }

    if (activeScanTarget === "product") {
      void handleLookupProduct(normalized);
    }

    setActiveScanTarget(null);
  };

  if (loading) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-muted-foreground">Dang tai danh sach picking tasks...</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-100 to-teal-50 flex items-center justify-center border border-emerald-200/40">
            <UserCheck className="w-5 h-5 text-emerald-700" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Picking</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">Nhan don da duyet va pick theo dung vi tri trong kho</p>
          </div>
        </div>
      </FadeItem>

      {!detail ? (
        <>
          <FadeItem>
            <SectionCard>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1 font-medium">Warehouse</p>
                  <select
                    value={selectedWarehouseId}
                    onChange={(event) => setSelectedWarehouseId(event.target.value)}
                    className="w-full rounded-lg border border-input px-3 py-2 text-[12px]"
                  >
                    <option value="">Chon warehouse</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.code} - {warehouse.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Luu y: Don transfer se hien o kho nguon (from warehouse), khong hien o kho dich.
                  </p>
                </div>

                <div className="md:col-span-2">
                  <p className="text-[11px] text-muted-foreground mb-1 font-medium">Tim don</p>
                  <FilterBar
                    searchValue={query}
                    onSearchChange={setQuery}
                    searchPlaceholder="Ma don / kho / loai don"
                    showSearchClear
                    filters={
                      <div className="inline-flex items-center gap-1 rounded-lg border border-input p-1">
                        {[
                          { key: "ALL", label: "Tat ca" },
                          { key: "PICK", label: "PICK" },
                          { key: "REPICK", label: "REPICK" },
                        ].map((item) => (
                          <button
                            key={item.key}
                            onClick={() => setTaskClassFilter(item.key as "ALL" | "PICK" | "REPICK")}
                            className={`rounded-lg px-2.5 py-1 text-[11px] ${taskClassFilter === item.key ? "bg-emerald-100 text-emerald-700" : "text-muted-foreground hover:bg-muted"}`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    }
                  />
                </div>
              </div>
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <SectionCard noPadding>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {[
                      "Ma don",
                      "Loai",
                      "Nhom",
                      "Kho nguon",
                      "Dich",
                      "Trang thai",
                      "Lines",
                      "Con lai",
                      "Nguoi pick",
                      "Ngay",
                      "Action",
                    ].map((head) => (
                      <th key={head} className="text-left text-[11px] text-muted-foreground px-4 py-3 uppercase tracking-wider font-medium">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-10 text-center">
                        <EmptyState variant="no-data" title="Khong co don nao san sang pick" description="Cac don da duyet se hien o day" className="py-0" />
                      </td>
                    </tr>
                  ) : filteredTasks.map((task) => {
                    const key = `${task.task_type}:${task.task_id}`;
                    const assignedToMe = task.assigned_picker_user_id && task.assigned_picker_user_id === currentUserId;
                    const isAssigned = Boolean(task.assigned_picker_user_id);

                    return (
                      <tr key={key} className="border-b border-border last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-3 text-[12px] font-semibold">{task.order_number}</td>
                        <td className="px-4 py-3 text-[12px]">{taskTypeLabel(task.order_type)}</td>
                        <td className="px-4 py-3 text-[12px]">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${taskClassLabel(task.task_class) === "REPICK" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>
                            {taskClassLabel(task.task_class)}
                            {taskClassLabel(task.task_class) === "REPICK" && task.repick_sequence ? ` #${task.repick_sequence}` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[12px]">{task.source_warehouse_code || task.source_warehouse_name || "-"}</td>
                        <td className="px-4 py-3 text-[12px]">{task.target_warehouse_code || task.target_warehouse_name || "-"}</td>
                        <td className="px-4 py-3 text-[12px] text-emerald-700 font-semibold">{task.status}</td>
                        <td className="px-4 py-3 text-[12px]">{task.line_count}</td>
                        <td className="px-4 py-3 text-[12px] font-semibold">{task.remaining_quantity}</td>
                        <td className="px-4 py-3 text-[12px]">
                          {task.assigned_picker_user_id ? (assignedToMe ? currentUserLabel : `User ${task.assigned_picker_user_id.slice(0, 8)}`) : "Chua giao"}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-muted-foreground">{formatDate(task.requested_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {!isAssigned ? (
                              <button
                                onClick={() => void handleClaimTask(task)}
                                disabled={claimingTaskKey === key}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                {claimingTaskKey === key ? "Dang nhan..." : "Nhan don"}
                              </button>
                            ) : null}

                            {(assignedToMe || !isAssigned) ? (
                              <button
                                onClick={() => void handleOpenTask(task)}
                                className="inline-flex items-center gap-1 rounded-lg border border-input px-2.5 py-1.5 text-[11px] hover:bg-muted"
                              >
                                Vao pick <ArrowRight className="w-3 h-3" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </SectionCard>
          </FadeItem>
        </>
      ) : (
        <>
          <FadeItem>
            <SectionCard>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[12px] text-muted-foreground font-medium">Don dang thao tac</p>
                  <div className="flex items-center gap-2 mt-1">
                    <h2 className="text-[15px] font-semibold">{detail.order_number} · {taskTypeLabel(detail.order_type)}</h2>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${taskClassLabel(detail.task_class) === "REPICK" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>
                      {taskClassLabel(detail.task_class)}
                      {taskClassLabel(detail.task_class) === "REPICK" && detail.repick_sequence ? ` #${detail.repick_sequence}` : ""}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    Nguon: {detail.source_warehouse_code || detail.source_warehouse_name || "-"}
                    {detail.target_warehouse_code || detail.target_warehouse_name ? ` | Dich: ${detail.target_warehouse_code || detail.target_warehouse_name}` : ""}
                    {` | Con ${detail.remaining_line_count} line / ${detail.remaining_quantity} qty`}
                  </p>
                </div>
                <button
                  onClick={handleBackToList}
                  className="rounded-xl border border-input px-3 py-2 text-[12px] hover:bg-muted"
                >
                  Quay lai danh sach
                </button>
              </div>
            </SectionCard>
          </FadeItem>

          {loadingDetail ? (
            <FadeItem>
              <SectionCard><p className="text-center py-8 text-[12px] text-muted-foreground">Dang tai chi tiet don pick...</p></SectionCard>
            </FadeItem>
          ) : null}

          {!loadingDetail && detail.remaining_line_count === 0 ? (
            <FadeItem>
              <SectionCard className="border-emerald-200 bg-emerald-50/50">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                  <div>
                    <p className="text-[13px] text-emerald-800 font-semibold">Da hoan tat picking, cho outbound</p>
                    <p className="text-[12px] text-emerald-700 mt-0.5">Hang da duoc chuyen vao SHIPPING va dang cho xac nhan outbound.</p>
                    <p className="text-[12px] text-emerald-700 mt-1">
                      Don: {detail.order_number} | Line da pick: {completedLineCount}/{detail.lines.length} | Tong qty da pick: {totalPickedQty}
                      {detail.completed_at ? ` | Hoan tat: ${formatDate(detail.completed_at)}` : ""}
                    </p>
                  </div>
                </div>
              </SectionCard>
            </FadeItem>
          ) : null}

          {!loadingDetail && detail.remaining_line_count > 0 ? (
            <>
              {taskClassLabel(detail.task_class) === "REPICK" ? (
                <FadeItem>
                  <SectionCard className="border-amber-200 bg-amber-50/50">
                    <p className="text-[12px] text-amber-900 font-semibold">Don REPICK bo sung phan thieu</p>
                    <p className="text-[12px] text-amber-800 mt-1">
                      Don goc: {detail.root_order_number || detail.root_task_id || "-"}
                      {detail.parent_order_number || detail.parent_task_id ? ` | Sinh tu: ${detail.parent_order_number || detail.parent_task_id}` : ""}
                      {detail.repick_sequence ? ` | Lan REPICK: #${detail.repick_sequence}` : ""}
                    </p>
                    <p className="text-[12px] text-amber-800 mt-1">Don nay chi chua phan con thieu can pick lai.</p>
                  </SectionCard>
                </FadeItem>
              ) : null}

              <FadeItem>
                <SectionCard title="1) Xac nhan hien dien picker" subtitle="Scan/nhap vi tri hien tai trong kho nguon truoc khi pick.">
                  <div className="flex gap-2 flex-wrap">
                    <input
                      value={presenceInput}
                      onChange={(event) => setPresenceInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleConfirmPresence();
                        }
                      }}
                      placeholder="Barcode hoac ma vi tri hien tai"
                      className="flex-1 min-w-[200px] rounded-lg border border-input px-3 py-2 text-[12px]"
                      disabled={presenceConfirmed}
                    />
                    <button
                      onClick={() => setActiveScanTarget("presence")}
                      disabled={confirmingPresence || presenceConfirmed}
                      className="rounded-lg border border-input px-3 py-2 text-[12px] hover:bg-muted disabled:opacity-60"
                      title="Scan vi tri hien tai"
                    >
                      <ScanLine className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => void handleConfirmPresence()}
                      disabled={confirmingPresence || presenceConfirmed}
                      className="rounded-lg border border-input px-3 py-2 text-[12px] hover:bg-muted disabled:opacity-60"
                    >
                      {presenceConfirmed ? "Da xac nhan" : confirmingPresence ? "Dang xac nhan..." : "Xac nhan"}
                    </button>
                  </div>
                </SectionCard>
              </FadeItem>

              <FadeItem>
                <SectionCard title="2) Scan location can den" subtitle={!presenceConfirmed ? "Can hoan thanh buoc 1 truoc khi hien vi tri can pick." : undefined}>
                  {!presenceConfirmed ? (
                    <p className="text-[12px] text-muted-foreground">Can hoan thanh buoc 1 truoc khi hien vi tri can pick.</p>
                  ) : currentLine ? (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-input bg-muted/50 p-3">
                        <p className="text-[12px] text-muted-foreground">Vi tri can den</p>
                        <p className="text-[14px] text-foreground font-semibold">
                          {currentLine.source_location_code || "(He thong dang xac dinh vi tri phu hop)"}
                        </p>
                        <p className="text-[12px] text-muted-foreground mt-1">Chi scan location nay moi duoc sang buoc tiep theo.</p>
                      </div>

                      <div className="flex gap-2 flex-wrap">
                        <input
                          value={locationInput}
                          onChange={(event) => {
                            setLocationInput(event.target.value);
                            setLocationVerified(false);
                            setProductVerified(false);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              handleVerifyLocation();
                            }
                          }}
                          placeholder="Barcode hoac ma location dich"
                          className="flex-1 min-w-[200px] rounded-lg border border-input px-3 py-2 text-[12px]"
                        />
                        <button
                          onClick={() => setActiveScanTarget("location")}
                          disabled={!presenceConfirmed || !currentLine}
                          className="rounded-lg border border-input px-3 py-2 text-[12px] hover:bg-muted"
                          title="Scan location"
                        >
                          <ScanLine className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleVerifyLocation()}
                          className="rounded-lg border border-input px-3 py-2 text-[12px] hover:bg-muted"
                        >
                          {locationVerified ? "Da dung location" : "Xac nhan location"}
                        </button>
                      </div>

                      {locationVerified ? (
                        <>
                          <h3 className="text-[13px] pt-1 font-semibold">3) Scan san pham can lay</h3>
                          <div className="rounded-lg border border-input bg-muted/50 p-3">
                            <p className="text-[12px] text-muted-foreground">San pham can pick</p>
                            <p className="text-[13px] text-foreground font-medium">{currentLine.book_title}</p>
                            <p className="text-[12px] text-muted-foreground mt-1">
                              SKU: {currentLine.sku || "-"} | Barcode: {currentLine.barcode || "-"}
                            </p>
                            <p className="text-[12px] text-muted-foreground mt-1">
                              Can pick: {currentLine.remaining_qty} (da pick {currentLine.picked_qty}/{currentLine.requested_qty})
                            </p>
                            {taskClassLabel(detail.task_class) === "REPICK" && currentLine.repick_line?.original_line_id ? (
                              <p className="text-[12px] text-muted-foreground mt-1">
                                Truy vet line goc: {currentLine.repick_line.original_line_id} | Thieu ban dau: {currentLine.repick_line.missing_qty}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex gap-2 flex-wrap">
                            <input
                              value={productBarcodeInput}
                              onChange={(event) => {
                                setProductBarcodeInput(event.target.value);
                                setProductVerified(false);
                                setSelectedScannedVariantId("");
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void handleLookupProduct();
                                }
                              }}
                              placeholder="unit barcode / internal / isbn / sku"
                              className="flex-1 min-w-[200px] rounded-lg border border-input px-3 py-2 text-[12px]"
                            />
                            <button
                              onClick={() => setActiveScanTarget("product")}
                              disabled={loadingLookup || !locationVerified}
                              className="rounded-lg border border-input px-3 py-2 text-[12px] hover:bg-muted disabled:opacity-60"
                              title="Quet barcode san pham"
                            >
                              <ScanLine className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => void handleLookupProduct()}
                              disabled={loadingLookup}
                              className="rounded-lg border border-input px-3 py-2 text-[12px] hover:bg-muted disabled:opacity-60"
                            >
                              {loadingLookup ? "Dang quet..." : "Xac nhan ma"}
                            </button>
                          </div>

                          {ambiguousMatches.length > 0 ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                              <p className="text-[12px] text-amber-800 font-semibold">Barcode trung nhieu item, chon dung item:</p>
                              <select
                                value={selectedScannedVariantId}
                                onChange={(event) => {
                                  const selected = event.target.value;
                                  setSelectedScannedVariantId(selected);

                                  if (selected && selected === currentLine.variant_id) {
                                    setProductVerified(true);
                                    toast.success("Da chon dung san pham cho line hien tai");
                                  } else {
                                    setProductVerified(false);
                                    if (selected) {
                                      toast.error("Sai san pham cho line hien tai");
                                    }
                                  }
                                }}
                                className="mt-2 w-full rounded-lg border border-amber-200 px-3 py-2 text-[12px]"
                              >
                                <option value="">Chon variant dung</option>
                                {ambiguousMatches.map((match) => (
                                  <option key={match.variant_id} value={match.variant_id}>
                                    {match.sku || match.internal_barcode || match.isbn13 || match.isbn10} | {match.book_title} | {match.matched_by}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}

                          {productVerified ? (
                            <>
                              <h3 className="text-[13px] pt-1 font-semibold">4) Nhap so luong va confirm</h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <p className="text-[11px] text-muted-foreground mb-1 font-medium">So luong</p>
                                  <input
                                    type="number"
                                    min={1}
                                    max={currentLine?.remaining_qty || 1}
                                    value={quantityInput}
                                    onChange={(event) => setQuantityInput(Math.max(1, Math.trunc(Number(event.target.value || 1))))}
                                    className="w-full rounded-lg border border-input px-3 py-2 text-[12px]"
                                  />
                                </div>
                                <div className="flex items-end justify-end">
                                  <button
                                    onClick={handleConfirmLine}
                                    disabled={!canConfirmLine || confirmingLine}
                                    className="rounded-xl bg-emerald-600 text-white px-4 py-2.5 text-[12px] font-semibold disabled:opacity-60"
                                  >
                                    {confirmingLine ? "Dang confirm..." : "Confirm line pick"}
                                  </button>
                                </div>
                              </div>
                            </>
                          ) : (
                            <p className="text-[12px] text-muted-foreground">Can scan dung san pham truoc khi nhap so luong.</p>
                          )}
                        </>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">Can scan dung location dich truoc khi hien san pham can lay.</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">Khong tim thay line can pick tiep theo.</p>
                  )}
                </SectionCard>
              </FadeItem>
            </>
          ) : null}
        </>
      )}

      <BarcodeScanModal
        isOpen={Boolean(activeScanTarget)}
        onClose={() => setActiveScanTarget(null)}
        onDetected={handleDetectedScan}
        title={scannerTitle}
      />
    </PageWrapper>
  );
}
