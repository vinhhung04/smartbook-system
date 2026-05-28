import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ScanLine, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { FadeItem, PageWrapper } from "../motion-utils";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { getApiErrorMessage } from "@/services/api.ts";
import { authService } from "@/services/auth";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import {
  pickingService,
  type PickingTaskDetail,
  type PickingTaskItemRecord,
  type PickingTaskRecord,
  type PickingTaskSummary,
  type PickingTaskType,
  type PickingVariantLookupMatch,
} from "@/services/picking";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { canManageReceiving } from "@/lib/rbac";

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
  const [assigningPickerIdByTask, setAssigningPickerIdByTask] = useState<Record<string, string>>({});
  const [confirmingPresence, setConfirmingPresence] = useState(false);
  const [confirmingLine, setConfirmingLine] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
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

  // Repick hierarchy expand state
  const [expandedRepickTaskId, setExpandedRepickTaskId] = useState<string | null>(null);
  const [repickChildren, setRepickChildren] = useState<(PickingTaskRecord & { picking_task_items: PickingTaskItemRecord[] })[]>([]);
  const [loadingRepickChildren, setLoadingRepickChildren] = useState(false);

  const currentUser = authService.getCurrentUser();
  const canManageAssignment = canManageReceiving(currentUser);
  const currentUserId = String((currentUser as { id?: string } | null)?.id || "");
  const currentUserLabel = String((currentUser as { full_name?: string; username?: string; email?: string } | null)?.full_name
    || (currentUser as { full_name?: string; username?: string; email?: string } | null)?.username
    || (currentUser as { full_name?: string; username?: string; email?: string } | null)?.email
    || "Toi");
  const staffNameById = useMemo(() => {
    return new Map(warehouseStaff.map((user) => [
      user.id,
      user.full_name || user.username || user.email,
    ]));
  }, [warehouseStaff]);

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
    if (activeScanTarget === "presence") return "Quét vị trí hiện tại";
    if (activeScanTarget === "location") return "Quét vị trí cần đến";
    if (activeScanTarget === "product") return "Quét mã vạch sản phẩm";
    return "Quét mã vạch";
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

        const [warehouseRows, staffRows] = await Promise.all([
          canManageAssignment ? warehouseService.getAll() : Promise.resolve([]),
          canManageAssignment ? userService.getWarehouseStaff() : Promise.resolve({ data: [] }),
        ]);

        const rows = Array.isArray(warehouseRows) ? warehouseRows : [];
        setWarehouseStaff(Array.isArray(staffRows?.data) ? staffRows.data : []);
        setWarehouses(rows);

        const preferredWarehouseFromUser = String((currentUser as { primary_warehouse_id?: string } | null)?.primary_warehouse_id || "");
        const preferredWarehouse = rows.find((item) => item.id === preferredWarehouseFromUser)?.id || rows[0]?.id || "";

        setSelectedWarehouseId(preferredWarehouse);
        await loadTasks(canManageAssignment ? (preferredWarehouse || undefined) : undefined);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được danh sách đơn lấy hàng"));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    if (!canManageAssignment) {
      return;
    }

    if (!selectedWarehouseId) {
      setTasks([]);
      return;
    }

    void loadTasks(selectedWarehouseId).catch((error) => {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách đơn theo kho"));
    });
  }, [canManageAssignment, selectedWarehouseId]);

  const handleAssignTask = async (task: PickingTaskSummary) => {
    const key = `${task.task_type}:${task.task_id}`;
    const pickerUserId = assigningPickerIdByTask[key];

    if (!pickerUserId) {
      toast.error("Chọn nhân viên kho trước khi giao task");
      return;
    }

    try {
      setClaimingTaskKey(key);
      await pickingService.claimTask(task.task_type, task.task_id, pickerUserId);
      await loadTasks(canManageAssignment ? (selectedWarehouseId || undefined) : undefined);
      toast.success(`Đã giao task ${task.order_number}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Giao task that bai"));
    } finally {
      setClaimingTaskKey("");
    }
  };

  const handleOpenTask = async (task: PickingTaskSummary) => {
    try {
      await loadDetail(task.task_type, task.task_id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không mở được chi tiết đơn lấy hàng"));
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

      toast.success(`Đã xác nhận hiện diện tại ${res.data.location_code}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xác nhận hiện diện thất bại"));
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
      toast.error("Không xác định được dòng hiện tại");
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
        toast.success(`Đã nhận diện: ${res.selected.book_title}`);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tra cứu được mã vạch sản phẩm"));
    } finally {
      setLoadingLookup(false);
    }
  };

  const handleConfirmLine = async () => {
    if (!selectedTaskType || !selectedTaskId || !currentLine) {
      toast.error("Chưa có dòng cần lấy");
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

      const result = await pickingService.confirmLine(selectedTaskType, selectedTaskId, currentLine.line_id, payload);

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
        loadTasks(canManageAssignment ? (selectedWarehouseId || undefined) : undefined),
      ]);

      if (result.data.task_completed) {
        toast.success("Đã hoàn tất toàn bộ task picking");
      } else if (result.data.line_remaining_quantity > 0) {
        toast.success(`Đã pick một phần, còn ${result.data.line_remaining_quantity} sản phẩm cần pick tiếp`);
      } else {
        toast.success("Đã xác nhận lấy dòng thành công");
      }
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
      toast.error("Không có dòng cần lấy");
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
      toast.success("Đã xác nhận đúng vị trí lấy hàng");
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
        <p className="text-[13px] text-slate-500">Đang tải danh sách công việc lấy hàng...</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink
          to="/orders"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:text-blue-600"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Quay lại danh sách
        </NavLink>
      </FadeItem>

      <FadeItem>
        <h1 className="tracking-[-0.02em]">Picking</h1>
        <p className="text-[12px] text-slate-500 mt-1">
          {canManageAssignment ? "Quan ly giao picking task cho nhan vien kho va theo doi tien do pick" : "Thuc hien picking task da duoc giao"}
        </p>
      </FadeItem>

      {!detail ? (
        <>
          <FadeItem>
            <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {canManageAssignment ? (
                <div>
                  <p className="text-[11px] text-slate-500 mb-1.5 font-semibold">Warehouse</p>
                  <select
                    value={selectedWarehouseId}
                    onChange={(event) => setSelectedWarehouseId(event.target.value)}
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
                  >
                    <option value="">Chọn kho</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.code} - {warehouse.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Đơn chuyển kho sẽ hiện ở kho nguồn, không hiện ở kho đích.
                  </p>
                </div>
                ) : null}

                <div className={canManageAssignment ? "md:col-span-2" : "md:col-span-3"}>
                  <p className="text-[11px] text-slate-500 mb-1.5 font-semibold">Tìm đơn</p>
                  <div className="flex items-center gap-2">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Mã đơn / kho / loại đơn"
                      className="flex-1 rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
                    />
                    <div className="inline-flex items-center gap-1 rounded-[10px] border border-slate-200 p-1 bg-white">
                      {[
                        { key: "ALL", label: "Tat ca" },
                        { key: "PICK", label: "PICK" },
                        { key: "REPICK", label: "REPICK" },
                      ].map((item) => (
                        <button
                          key={item.key}
                          onClick={() => setTaskClassFilter(item.key as "ALL" | "PICK" | "REPICK")}
                          className={`rounded-[8px] px-2.5 py-1.5 text-[11px] ${taskClassFilter === item.key ? "bg-blue-100 text-blue-700 font-semibold" : "text-slate-500 hover:bg-slate-50"}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="overflow-hidden rounded-[16px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/30 to-transparent">
                    {[
                      "Mã đơn",
                      "Loại",
                      "Nhóm",
                      "Kho nguồn",
                      "Kho đích",
                      "Trạng thái",
                      "Số dòng",
                      "Còn lại",
                      "Người lấy",
                      "Ngày",
                      "Thao tác",
                    ].map((head) => (
                      <th key={head} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-10 text-center text-[13px] text-slate-400">
                        Không có đơn nào sẵn sàng lấy
                      </td>
                    </tr>
                  ) : filteredTasks.map((task) => {
                    const key = `${task.task_type}:${task.task_id}`;
                    const assignedToMe = task.assigned_picker_user_id && task.assigned_picker_user_id === currentUserId;
                    const isAssigned = Boolean(task.assigned_picker_user_id);
                    const selectedPickerId = assigningPickerIdByTask[key] || "";
                    const assignedPickerName = task.assigned_picker_user_id
                      ? staffNameById.get(task.assigned_picker_user_id) || (assignedToMe ? currentUserLabel : `User ${task.assigned_picker_user_id.slice(0, 8)}`)
                      : "";

                    return (
                      <React.Fragment key={key}>
                      <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 text-[12px] font-semibold">{task.order_number}</td>
                        <td className="px-4 py-3 text-[12px] text-slate-600">{taskTypeLabel(task.order_type)}</td>
                        <td className="px-4 py-3 text-[12px]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${taskClassLabel(task.task_class) === "REPICK" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
                              {taskClassLabel(task.task_class)}
                              {taskClassLabel(task.task_class) === "REPICK" && task.repick_sequence ? ` #${task.repick_sequence}` : ""}
                            </span>
                            {taskClassLabel(task.task_class) === "PICK" && (task.repick_count ?? 0) > 0 && task.picking_task_id && (
                              <button
                                onClick={async () => {
                                  const ptId = task.picking_task_id!;
                                  if (expandedRepickTaskId === ptId) {
                                    setExpandedRepickTaskId(null);
                                    setRepickChildren([]);
                                  } else {
                                    setExpandedRepickTaskId(ptId);
                                    setLoadingRepickChildren(true);
                                    try {
                                      const children = await pickingService.getPickingTaskChildren(ptId);
                                      setRepickChildren(children);
                                    } finally {
                                      setLoadingRepickChildren(false);
                                    }
                                  }
                                }}
                                className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-100 transition-colors"
                                title="Xem REPICK tasks"
                              >
                                {task.repick_count} RPK
                                {expandedRepickTaskId === task.picking_task_id
                                  ? <ChevronDown className="w-3 h-3" />
                                  : <ChevronRight className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-slate-600">{task.source_warehouse_code || task.source_warehouse_name || "-"}</td>
                        <td className="px-4 py-3 text-[12px] text-slate-600">{task.target_warehouse_code || task.target_warehouse_name || "-"}</td>
                        <td className="px-4 py-3 text-[12px] text-emerald-600 font-semibold">{task.status}</td>
                        <td className="px-4 py-3 text-[12px] text-slate-600">{task.line_count}</td>
                        <td className="px-4 py-3 text-[12px] font-semibold">{task.remaining_quantity}</td>
                        <td className="px-4 py-3 text-[12px] text-slate-600">
                          {isAssigned ? assignedPickerName : "Chưa giao"}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-slate-400">{formatDate(task.requested_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {!isAssigned && canManageAssignment ? (
                              <div className="flex items-center gap-2">
                                <select
                                  value={selectedPickerId}
                                  onChange={(event) => setAssigningPickerIdByTask((prev) => ({ ...prev, [key]: event.target.value }))}
                                  className="h-8 min-w-[150px] rounded-[8px] border border-slate-200 bg-white px-2 text-[11px] text-slate-700"
                                  aria-label={`Chọn nhân viên kho cho ${task.order_number}`}
                                >
                                  <option value="">Chọn nhân viên</option>
                                  {warehouseStaff.map((staff) => (
                                    <option key={staff.id} value={staff.id}>
                                      {staff.full_name || staff.username}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => void handleAssignTask(task)}
                                  disabled={claimingTaskKey === key || !selectedPickerId}
                                  className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 transition-colors"
                                >
                                  <UserCheck className="h-3.5 w-3.5" />
                                  {claimingTaskKey === key ? "Đang giao..." : "Giao task"}
                                </button>
                              </div>
                            ) : null}

                            {(canManageAssignment || assignedToMe) ? (
                              <button
                                onClick={() => void handleOpenTask(task)}
                                className="inline-flex items-center gap-1 rounded-[8px] border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] hover:bg-slate-50 transition-colors"
                              >
                                Xem chi tiet <ArrowRight className="w-3 h-3" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {/* Inline REPICK children rows when expanded */}
                      {task.picking_task_id && expandedRepickTaskId === task.picking_task_id && (
                        loadingRepickChildren ? (
                          <tr key={`${key}-loading`}>
                            <td colSpan={11} className="pl-10 py-2 text-[11px] text-slate-400">Đang tải...</td>
                          </tr>
                        ) : repickChildren.map((child) => (
                          <tr key={child.picking_task_id} className="border-b border-amber-50 bg-amber-50/30">
                            <td className="px-4 py-2 text-[11px] text-slate-500 pl-10">
                              <span className="text-amber-700 font-semibold">↳ {child.task_number}</span>
                            </td>
                            <td className="px-4 py-2 text-[11px] text-slate-400" colSpan={2}>REPICK</td>
                            <td className="px-4 py-2 text-[11px] text-slate-500" colSpan={2}>—</td>
                            <td className="px-4 py-2 text-[11px]">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] ${child.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : child.status === "PICKING" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                                {child.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-[11px] text-slate-500">{child.picking_task_items?.length ?? 0}</td>
                            <td className="px-4 py-2 text-[11px] text-slate-500">
                              {child.picking_task_items?.reduce((s, i) => s + i.short_qty, 0) ?? 0}
                            </td>
                            <td colSpan={3} />
                          </tr>
                        ))
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </FadeItem>
        </>
      ) : (
        <>
          <FadeItem>
            <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[11px] text-slate-500 font-semibold">Đơn đang thao tác</p>
                  <div className="flex items-center gap-2 mt-1">
                    <h2 className="text-[15px] font-semibold">{detail.order_number} · {taskTypeLabel(detail.order_type)}</h2>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${taskClassLabel(detail.task_class) === "REPICK" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
                      {taskClassLabel(detail.task_class)}
                      {taskClassLabel(detail.task_class) === "REPICK" && detail.repick_sequence ? ` #${detail.repick_sequence}` : ""}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-500 mt-1">
                    Nguon: {detail.source_warehouse_code || detail.source_warehouse_name || "-"}
                    {detail.target_warehouse_code || detail.target_warehouse_name ? ` | Dich: ${detail.target_warehouse_code || detail.target_warehouse_name}` : ""}
                    {` | Con ${detail.remaining_line_count} line / ${detail.remaining_quantity} qty`}
                  </p>
                </div>
                <button
                  onClick={handleBackToList}
                  className="rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Quay lại danh sách
                </button>
              </div>
            </div>
          </FadeItem>

          {loadingDetail ? (
            <FadeItem>
              <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
                <p className="text-center py-8 text-[13px] text-slate-500">Đang tải chi tiết đơn lấy hàng...</p>
              </div>
            </FadeItem>
          ) : null}

          {!loadingDetail && detail.remaining_line_count === 0 ? (
            <FadeItem>
              <div className="rounded-[16px] border border-emerald-200/60 bg-emerald-50/50 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="text-[13px] text-emerald-800 font-semibold">Đã hoàn tất lấy hàng, chờ xuất kho</p>
                    <p className="text-[12px] text-emerald-700 mt-0.5">Hang da duoc chuyen vao SHIPPING va dang cho xac nhan outbound.</p>
                    <p className="text-[12px] text-emerald-700 mt-1">
                      Don: {detail.order_number} | Line da pick: {completedLineCount}/{detail.lines.length} | Tong qty da pick: {totalPickedQty}
                      {detail.completed_at ? ` | Hoan tat: ${formatDate(detail.completed_at)}` : ""}
                    </p>
                  </div>
                </div>
              </div>
            </FadeItem>
          ) : null}

          {!loadingDetail && detail.remaining_line_count > 0 ? (
            <>
              {taskClassLabel(detail.task_class) === "REPICK" ? (
                <FadeItem>
                  <div className="rounded-[16px] border border-amber-200/60 bg-amber-50/50 p-4">
                    <p className="text-[12px] text-amber-900 font-semibold">Đơn LẤY LẠI bổ sung phần thiếu</p>
                    <p className="text-[12px] text-amber-800 mt-1">
                      Đơn gốc: {detail.root_order_number || detail.root_task_id || "-"}
                      {detail.parent_order_number || detail.parent_task_id ? ` | Sinh tu: ${detail.parent_order_number || detail.parent_task_id}` : ""}
                      {detail.repick_sequence ? ` | Lan REPICK: #${detail.repick_sequence}` : ""}
                    </p>
                    <p className="text-[12px] text-amber-800 mt-1">Đơn này chỉ chứa phần còn thiếu cần lấy lại.</p>
                  </div>
                </FadeItem>
              ) : null}

              <FadeItem>
                <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
                  <h3 className="text-[14px] font-semibold mb-3">1) Xác nhận hiện diện nhân viên</h3>
                  <p className="text-[11px] text-slate-500 mb-3">Scan/nhap vi tri hien tai trong kho nguon truoc khi pick.</p>
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
                      className="flex-1 min-w-[200px] rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
                      disabled={presenceConfirmed}
                    />
                    <button
                      onClick={() => setActiveScanTarget("presence")}
                      disabled={confirmingPresence || presenceConfirmed}
                      className="rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px] hover:bg-slate-50 disabled:opacity-60 transition-colors"
                    >
                      <ScanLine className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => void handleConfirmPresence()}
                      disabled={confirmingPresence || presenceConfirmed}
                      className={`rounded-[10px] px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                        presenceConfirmed
                          ? "bg-emerald-100 text-emerald-700 cursor-default"
                          : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:opacity-90"
                      }`}
                    >
                      {presenceConfirmed ? "Đã xác nhận" : confirmingPresence ? "Đang xác nhận..." : "Xác nhận"}
                    </button>
                  </div>
                </div>
              </FadeItem>

              <FadeItem>
                <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
                  <h3 className="text-[14px] font-semibold mb-3">2) Scan location can den</h3>
                  {!presenceConfirmed ? (
                    <p className="text-[12px] text-slate-500">Can hoan thanh buoc 1 truoc khi hien vi tri can pick.</p>
                  ) : currentLine ? (
                    <div className="space-y-4">
                      <div className="rounded-[12px] border border-slate-100 bg-slate-50/50 p-4">
                        <p className="text-[11px] text-slate-500 font-semibold">Vi tri can den</p>
                        <p className="text-[15px] text-slate-900 font-bold mt-1">
                          {currentLine.source_location_code || "(He thong dang xac dinh vi tri phu hop)"}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">Chi scan location nay moi duoc sang buoc tiep theo.</p>
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
                          className="flex-1 min-w-[200px] rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
                        />
                        <button
                          onClick={() => setActiveScanTarget("location")}
                          disabled={!presenceConfirmed || !currentLine}
                          className="rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px] hover:bg-slate-50 disabled:opacity-60 transition-colors"
                        >
                          <ScanLine className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleVerifyLocation()}
                          className={`rounded-[10px] px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                            locationVerified
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:opacity-90"
                          }`}
                        >
                          {locationVerified ? "Đúng vị trí" : "Xác nhận vị trí"}
                        </button>
                      </div>

                      {locationVerified ? (
                        <>
                          <h3 className="text-[14px] font-semibold pt-2">3) Scan san pham can lay</h3>
                          <div className="rounded-[12px] border border-slate-100 bg-slate-50/50 p-4">
                            <p className="text-[11px] text-slate-500 font-semibold">San pham can pick</p>
                            <p className="text-[13px] text-slate-900 font-semibold mt-1">{currentLine.book_title}</p>
                            <p className="text-[11px] text-slate-500 mt-1">
                              SKU: {currentLine.sku || "-"} | Barcode: {currentLine.barcode || "-"}
                            </p>
                            <p className="text-[12px] text-slate-700 mt-1 font-medium">
                              Can pick: {currentLine.remaining_qty} (da pick {currentLine.picked_qty}/{currentLine.requested_qty})
                            </p>
                            {taskClassLabel(detail.task_class) === "REPICK" && currentLine.repick_line?.original_line_id ? (
                              <p className="text-[11px] text-slate-500 mt-1">
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
                              className="flex-1 min-w-[200px] rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
                            />
                            <button
                              onClick={() => setActiveScanTarget("product")}
                              disabled={loadingLookup || !locationVerified}
                              className="rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px] hover:bg-slate-50 disabled:opacity-60 transition-colors"
                            >
                              <ScanLine className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => void handleLookupProduct()}
                              disabled={loadingLookup}
                              className="rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-colors"
                            >
                              {loadingLookup ? "Đang quét..." : "Xác nhận mã"}
                            </button>
                          </div>

                          {ambiguousMatches.length > 0 ? (
                            <div className="rounded-[12px] border border-amber-200/60 bg-amber-50/50 p-4">
                              <p className="text-[12px] text-amber-800 font-semibold">Barcode trung nhieu item, chon dung item:</p>
                              <select
                                value={selectedScannedVariantId}
                                onChange={(event) => {
                                  const selected = event.target.value;
                                  setSelectedScannedVariantId(selected);

                                  if (selected && selected === currentLine.variant_id) {
                                    setProductVerified(true);
                                    toast.success("Đã chọn đúng sản phẩm cho dòng hiện tại");
                                  } else {
                                    setProductVerified(false);
                                    if (selected) {
                                      toast.error("Sai san pham cho line hien tai");
                                    }
                                  }
                                }}
                                className="mt-2 w-full rounded-[10px] border border-amber-200 px-3 py-2.5 text-[12px]"
                              >
                                <option value="">Chọn biến thể đúng</option>
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
                              <h3 className="text-[14px] font-semibold pt-2">4) Nhap so luong va confirm</h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <p className="text-[11px] text-slate-500 mb-1.5 font-semibold">So luong</p>
                                  <input
                                    type="number"
                                    min={1}
                                    max={currentLine?.remaining_qty || 1}
                                    value={quantityInput}
                                    onChange={(event) => setQuantityInput(Math.max(1, Math.trunc(Number(event.target.value || 1))))}
                                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
                                  />
                                </div>
                                <div className="flex items-end justify-end">
                                  <button
                                    onClick={handleConfirmLine}
                                    disabled={!canConfirmLine || confirmingLine}
                                    className="rounded-[10px] bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-colors"
                                  >
                                    {confirmingLine ? "Đang xác nhận..." : "Xác nhận lấy dòng"}
                                  </button>
                                </div>
                              </div>
                            </>
                          ) : (
                            <p className="text-[12px] text-slate-500">Can scan dung san pham truoc khi nhap so luong.</p>
                          )}
                        </>
                      ) : (
                        <p className="text-[12px] text-slate-500">Can scan dung location dich truoc khi hien san pham can lay.</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12px] text-slate-500">Không tìm thấy dòng cần lấy tiếp theo.</p>
                  )}
                </div>
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
