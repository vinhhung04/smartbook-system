import React, { useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChevronDown, ChevronRight, Clock, ListChecks, MapPin, Package, QrCode, RotateCcw, ScanLine, Search, UserCheck } from "lucide-react";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { FadeItem, PageWrapper } from "../motion-utils";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { getApiErrorMessage } from "@/services/api.ts";
import { getPickingTaskStatusVariant } from "@/lib/status-registry";
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
  if (orderType === "OUTBOUND_REPICK") return "Xuất kho / Lấy bù";
  if (orderType === "WAREHOUSE_TRANSFER_REPICK") return "Chuyển kho / Lấy bù";
  if (orderType === "WAREHOUSE_TRANSFER") return "Chuyển kho";
  if (orderType.startsWith("OUTBOUND_")) return "Xuất kho / Cửa hàng";
  return orderType;
}

function taskClassLabel(taskClass?: string): string {
  return taskClass === "REPICK" ? "REPICK" : "PICK";
}

function taskStatusVariant(status: string) {
  return getPickingTaskStatusVariant(status);
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

  // Declare shortage (create REPICK)
  const [declaringShortage, setDeclaringShortage] = useState(false);
  const [showShortageConfirm, setShowShortageConfirm] = useState(false);

  const currentUser = authService.getCurrentUser();
  const canManageAssignment = canManageReceiving(currentUser);
  const currentUserId = String((currentUser as { id?: string } | null)?.id || "");
  const currentUserPrimaryWarehouseId = String((currentUser as { primary_warehouse_id?: string } | null)?.primary_warehouse_id || "");
  const currentUserLabel = String((currentUser as { full_name?: string; username?: string; email?: string } | null)?.full_name
    || (currentUser as { full_name?: string; username?: string; email?: string } | null)?.username
    || (currentUser as { full_name?: string; username?: string; email?: string } | null)?.email
    || "Tôi");
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

  const taskStats = useMemo(() => {
    const pick = tasks.filter((task) => taskClassLabel(task.task_class) === "PICK").length;
    const repick = tasks.filter((task) => taskClassLabel(task.task_class) === "REPICK").length;
    const unassigned = tasks.filter((task) => !task.assigned_picker_user_id).length;
    return { total: tasks.length, pick, repick, unassigned };
  }, [tasks]);

  const currentLine = detail?.current_line || null;
  const completedLineCount = useMemo(
    () => (detail?.lines || []).filter((line) => Number(line.picked_qty || 0) >= Number(line.requested_qty || 0)).length,
    [detail],
  );
  const totalPickedQty = useMemo(
    () => (detail?.lines || []).reduce((sum, line) => sum + Number(line.picked_qty || 0), 0),
    [detail],
  );

  // Can declare shortage when: some items were picked but not all lines complete (PICK or REPICK task)
  const canDeclareShortage = Boolean(
    detail
    && totalPickedQty > 0
    && (detail.lines || []).some((line) => Number(line.picked_qty || 0) < Number(line.requested_qty || 0)),
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

        const preferredWarehouse = rows.find((item) => item.id === currentUserPrimaryWarehouseId)?.id || rows[0]?.id || "";

        setSelectedWarehouseId(preferredWarehouse);
        await loadTasks(canManageAssignment ? (preferredWarehouse || undefined) : undefined);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được danh sách đơn lấy hàng"));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [canManageAssignment, currentUserPrimaryWarehouseId]);

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
      toast.error(getApiErrorMessage(error, "Giao task thất bại"));
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
      toast.error("Nhập hoặc scan vị trí hiện tại");
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
      toast.error("Cần scan đúng vị trí đích trước");
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
      toast.error("Nhập barcode sản phẩm");
      return;
    }

    try {
      setLoadingLookup(true);
      const res = await pickingService.lookupVariantByBarcode(barcode);

      if (res.ambiguous) {
        setAmbiguousMatches(res.matches || []);
        setSelectedScannedVariantId("");
        setProductVerified(false);
        toast.error("Barcode trùng nhiều SKU, vui lòng chọn đúng item");
        return;
      }

      setAmbiguousMatches([]);
      if (res.selected?.variant_id) {
        if (res.selected.variant_id !== currentLine.variant_id) {
          setProductVerified(false);
          setSelectedScannedVariantId("");
          toast.error("Sai sản phẩm cho dòng hiện tại");
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
      toast.error("Số lượng phải > 0");
      return;
    }

    if (quantity > Number(currentLine.remaining_qty || 0)) {
      toast.error("Số lượng vượt quá số lượng còn phải pick của dòng");
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
        confetti({ particleCount: 60, spread: 55, origin: { y: 0.7 } });
        toast.success("Đã hoàn tất toàn bộ task picking");
      } else if (result.data.line_remaining_quantity > 0) {
        toast.success(`Đã pick một phần, còn ${result.data.line_remaining_quantity} sản phẩm cần pick tiếp`);
      } else {
        toast.success("Đã xác nhận lấy dòng thành công");
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xác nhận lấy dòng thất bại"));
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
    setShowShortageConfirm(false);
  };

  const handleDeclareShortage = async () => {
    if (!selectedTaskId || declaringShortage) return;
    setShowShortageConfirm(false);
    setDeclaringShortage(true);
    try {
      const res = await pickingService.declareShortage(selectedTaskType!, selectedTaskId);
      toast.success(res.data?.order_number
        ? `Đã tạo REPICK ${res.data.order_number} — nhân viên khác có thể nhận và lấy bù`
        : "Đã khai báo thiếu hàng và tạo REPICK thành công");
      await loadTasks(canManageAssignment ? (selectedWarehouseId || undefined) : undefined);
      handleBackToList();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khai báo thiếu hàng thất bại"));
    } finally {
      setDeclaringShortage(false);
    }
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
      toast.error("Nhập hoặc scan vị trí đích");
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
    toast.error(`Sai vị trí. Cần đến ${currentLine.source_location_code || "vị trí được chỉ định"}`);
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
        <LoadingOverlay />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink
          to="/orders"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Quay lại danh sách
        </NavLink>
      </FadeItem>

      <FadeItem>
        <PageHeader
          icon={Package}
          title="Lấy hàng (Picking)"
          description={canManageAssignment ? "Quản lý giao task lấy hàng cho nhân viên kho và theo dõi tiến độ pick" : "Thực hiện task lấy hàng đã được giao"}
          iconBg="bg-gradient-to-br from-blue-100 to-indigo-50 dark:from-blue-500/20 dark:to-indigo-500/10"
          iconColor="text-blue-600 dark:text-blue-400"
        />
      </FadeItem>

      {!detail ? (
        <>
          <FadeItem>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Tổng đơn" value={taskStats.total} icon={Boxes} variant="primary" animateValue />
              <StatCard label="Đơn PICK" value={taskStats.pick} icon={ListChecks} variant="info" animateValue />
              <StatCard label="Đơn REPICK" value={taskStats.repick} icon={RotateCcw} variant="warning" animateValue />
              <StatCard label="Chưa giao" value={taskStats.unassigned} icon={Clock} variant={taskStats.unassigned > 0 ? "danger" : "default"} animateValue />
            </div>
          </FadeItem>

          <FadeItem>
            <SectionCard>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {canManageAssignment ? (
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Kho</p>
                  <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Chọn kho" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>
                          {warehouse.code} - {warehouse.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Đơn chuyển kho sẽ hiện ở kho nguồn, không hiện ở kho đích.
                  </p>
                </div>
                ) : null}

                <div className={canManageAssignment ? "md:col-span-2" : "md:col-span-3"}>
                  <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Tìm đơn</p>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Mã đơn / kho / loại đơn"
                        className="h-auto py-2.5 pl-9"
                      />
                    </div>
                    <SegmentedControl
                      options={[
                        { value: "ALL", label: "Tất cả" },
                        { value: "PICK", label: "PICK" },
                        { value: "REPICK", label: "REPICK" },
                      ]}
                      value={taskClassFilter}
                      onChange={(v) => setTaskClassFilter(v as "ALL" | "PICK" | "REPICK")}
                      layoutId="picking-class-filter"
                      gradientClassName="from-blue-600 to-indigo-600"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <SectionCard noPadding>
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
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
                      <th key={head} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-10 text-center">
                        <EmptyState variant="no-data" title="Không có đơn nào sẵn sàng lấy" description="Các đơn được giao picking sẽ hiện ở đây" />
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
                      <tr className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 text-[12px] font-semibold">{task.order_number}</td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{taskTypeLabel(task.order_type)}</td>
                        <td className="px-4 py-3 text-[12px]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <StatusBadge
                              label={`${taskClassLabel(task.task_class)}${taskClassLabel(task.task_class) === "REPICK" && task.repick_sequence ? ` #${task.repick_sequence}` : ""}`}
                              variant={taskClassLabel(task.task_class) === "REPICK" ? "warning" : "info"}
                            />
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
                                className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-100 transition-colors dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400 dark:hover:bg-amber-500/15"
                                title="Xem REPICK tasks"
                                aria-label={`Xem ${task.repick_count} REPICK task của đơn ${task.order_number}`}
                                aria-expanded={expandedRepickTaskId === task.picking_task_id}
                              >
                                {task.repick_count} RPK
                                {expandedRepickTaskId === task.picking_task_id
                                  ? <ChevronDown className="w-3 h-3" />
                                  : <ChevronRight className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{task.source_warehouse_code || task.source_warehouse_name || "-"}</td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{task.target_warehouse_code || task.target_warehouse_name || "-"}</td>
                        <td className="px-4 py-3">
                          <StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot />
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{task.line_count}</td>
                        <td className="px-4 py-3 text-[12px] font-semibold">{task.remaining_quantity}</td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">
                          {isAssigned ? assignedPickerName : "Chưa giao"}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-muted-foreground">{formatDate(task.requested_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {!isAssigned && canManageAssignment ? (
                              <div className="flex items-center gap-2">
                                <Select
                                  value={selectedPickerId || "none"}
                                  onValueChange={(v) => setAssigningPickerIdByTask((prev) => ({ ...prev, [key]: v === "none" ? "" : v }))}
                                >
                                  <SelectTrigger size="sm" aria-label={`Chọn nhân viên kho cho ${task.order_number}`} className="h-8 min-w-[150px] text-[11px]">
                                    <SelectValue placeholder="Chọn nhân viên" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Chọn nhân viên</SelectItem>
                                    {warehouseStaff.map((staff) => (
                                      <SelectItem key={staff.id} value={staff.id}>
                                        {staff.full_name || staff.username}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  variant="success-outline"
                                  onClick={() => void handleAssignTask(task)}
                                  disabled={!selectedPickerId}
                                  loading={claimingTaskKey === key}
                                >
                                  <UserCheck className="h-3.5 w-3.5" />
                                  Giao task
                                </Button>
                              </div>
                            ) : null}

                            {(canManageAssignment || assignedToMe) ? (
                              <Button size="sm" variant="outline" onClick={() => void handleOpenTask(task)}>
                                Xem chi tiết <ArrowRight className="w-3 h-3" />
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {/* Inline REPICK children rows when expanded */}
                      {task.picking_task_id && expandedRepickTaskId === task.picking_task_id && (
                        loadingRepickChildren ? (
                          <tr key={`${key}-loading`}>
                            <td colSpan={11} className="pl-10 py-2 text-[11px] text-muted-foreground">Đang tải...</td>
                          </tr>
                        ) : repickChildren.map((child) => (
                          <tr key={child.picking_task_id} className="border-b border-amber-50 bg-amber-50/30 dark:border-amber-500/10 dark:bg-amber-500/5">
                            <td className="px-4 py-2 text-[11px] text-muted-foreground pl-10">
                              <span className="text-amber-700 dark:text-amber-400 font-semibold">↳ {child.task_number}</span>
                            </td>
                            <td className="px-4 py-2 text-[11px] text-muted-foreground" colSpan={2}>REPICK</td>
                            <td className="px-4 py-2 text-[11px] text-muted-foreground" colSpan={2}>—</td>
                            <td className="px-4 py-2 text-[11px]">
                              <StatusBadge
                                label={child.status}
                                variant={child.status === "COMPLETED" ? "success" : child.status === "PICKING" ? "info" : "neutral"}
                              />
                            </td>
                            <td className="px-4 py-2 text-[11px] text-muted-foreground">{child.picking_task_items?.length ?? 0}</td>
                            <td className="px-4 py-2 text-[11px] text-muted-foreground">
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
            </SectionCard>
          </FadeItem>
        </>
      ) : (
        <>
          <FadeItem>
            <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 to-indigo-500" />
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-blue-100 to-indigo-50 dark:from-blue-500/20 dark:to-indigo-500/10 items-center justify-center">
                    <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground font-semibold">Đơn đang thao tác</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <h2 className="text-[15px] font-semibold">{detail.order_number} · {taskTypeLabel(detail.order_type)}</h2>
                      <StatusBadge
                        label={`${taskClassLabel(detail.task_class)}${taskClassLabel(detail.task_class) === "REPICK" && detail.repick_sequence ? ` #${detail.repick_sequence}` : ""}`}
                        variant={taskClassLabel(detail.task_class) === "REPICK" ? "warning" : "info"}
                      />
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-1">
                      Nguồn: {detail.source_warehouse_code || detail.source_warehouse_name || "-"}
                      {detail.target_warehouse_code || detail.target_warehouse_name ? ` | Đích: ${detail.target_warehouse_code || detail.target_warehouse_name}` : ""}
                      {` | Còn ${detail.remaining_line_count} dòng / ${detail.remaining_quantity} sản phẩm`}
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={handleBackToList}>
                  Quay lại danh sách
                </Button>
              </div>
            </div>
          </FadeItem>

          {loadingDetail ? (
            <FadeItem>
              <SectionCard>
                <LoadingOverlay />
              </SectionCard>
            </FadeItem>
          ) : null}

          {!loadingDetail && detail.remaining_line_count === 0 ? (
            <FadeItem>
              <Alert className="border-emerald-200/60 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />
                <AlertTitle className="text-emerald-800 dark:text-emerald-300">Đã hoàn tất lấy hàng, chờ xuất kho</AlertTitle>
                <AlertDescription className="text-emerald-700 dark:text-emerald-400">
                  <p>Hàng đã được chuyển vào SHIPPING và đang chờ xác nhận outbound.</p>
                  <p>
                    Đơn: {detail.order_number} | Line đã pick: {completedLineCount}/{detail.lines.length} | Tổng qty đã pick: {totalPickedQty}
                    {detail.completed_at ? ` | Hoàn tất: ${formatDate(detail.completed_at)}` : ""}
                  </p>
                </AlertDescription>
              </Alert>
            </FadeItem>
          ) : null}

          {!loadingDetail && detail.remaining_line_count > 0 ? (
            <>
              {/* Focus Mode Stepper */}
              <FadeItem>
                <SectionCard title="Tiến trình lấy hàng">
                  <WorkflowStepper
                    steps={[
                      {
                        id: 'presence',
                        label: 'Xác nhận vị trí',
                        description: 'Quét mã vị trí hiện tại',
                        icon: UserCheck,
                        status: presenceConfirmed ? 'completed' : 'active',
                      },
                      {
                        id: 'location',
                        label: 'Đi tới kệ',
                        description: 'Quét mã vị trí lấy hàng',
                        icon: MapPin,
                        status: !presenceConfirmed ? 'pending' : locationVerified ? 'completed' : 'active',
                      },
                      {
                        id: 'product',
                        label: 'Quét sản phẩm',
                        description: 'Quét mã vạch sách',
                        icon: QrCode,
                        status: !locationVerified ? 'pending' : productVerified ? 'completed' : 'active',
                      },
                      {
                        id: 'quantity',
                        label: 'Nhập số lượng',
                        description: 'Điền số lượng lấy được',
                        icon: Package,
                        status: !productVerified ? 'pending' : canConfirmLine ? 'active' : 'pending',
                      },
                      {
                        id: 'confirm',
                        label: 'Xác nhận',
                        description: 'Xác nhận dòng đã lấy',
                        icon: CheckCircle2,
                        status: canConfirmLine ? 'active' : 'pending',
                      },
                    ] satisfies WorkflowStep[]}
                    compact
                  />
                </SectionCard>
              </FadeItem>

              {taskClassLabel(detail.task_class) === "REPICK" ? (
                <FadeItem>
                  <Alert className="border-amber-200/60 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-500/10">
                    <AlertTriangle className="text-amber-600 dark:text-amber-400" />
                    <AlertTitle className="text-amber-900 dark:text-amber-300">
                      {detail.repick_sequence ? `Lấy bù lần #${detail.repick_sequence}` : 'Đơn lấy bù bổ sung phần thiếu'}
                    </AlertTitle>
                    <AlertDescription className="text-amber-800 dark:text-amber-400">
                      <p>
                        Đơn gốc: {detail.root_order_number || detail.root_task_id || "-"}
                        {detail.parent_order_number || detail.parent_task_id ? ` | Sinh từ: ${detail.parent_order_number || detail.parent_task_id}` : ""}
                      </p>
                      <p>Đơn này chỉ chứa phần còn thiếu cần lấy lại.</p>
                    </AlertDescription>
                  </Alert>
                </FadeItem>
              ) : null}

              <FadeItem>
                <SectionCard
                  title="Xác nhận hiện diện nhân viên"
                  subtitle="Scan/nhập vị trí hiện tại trong kho nguồn trước khi pick."
                  icon={UserCheck}
                >
                  <div className="flex gap-2 flex-wrap">
                    <Input
                      value={presenceInput}
                      onChange={(event) => setPresenceInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleConfirmPresence();
                        }
                      }}
                      placeholder="Barcode hoặc mã vị trí hiện tại"
                      className="flex-1 min-w-[200px] h-12 py-3.5 text-[15px]"
                      disabled={presenceConfirmed}
                    />
                    <IconButton
                      variant="outline"
                      onClick={() => setActiveScanTarget("presence")}
                      disabled={confirmingPresence || presenceConfirmed}
                      label="Quét mã vị trí hiện tại"
                      className="h-12 w-12 shrink-0"
                    >
                      <ScanLine className="w-4 h-4" />
                    </IconButton>
                    <Button
                      onClick={() => void handleConfirmPresence()}
                      disabled={presenceConfirmed}
                      loading={confirmingPresence}
                      className={`h-12 px-4 text-[15px] ${
                        presenceConfirmed
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 cursor-default dark:bg-emerald-500/15 dark:text-emerald-400"
                          : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90"
                      }`}
                    >
                      {presenceConfirmed ? "Đã xác nhận" : "Xác nhận"}
                    </Button>
                  </div>
                </SectionCard>
              </FadeItem>

              <FadeItem>
                <SectionCard title="Scan vị trí cần đến" icon={MapPin}>
                  {!presenceConfirmed ? (
                    <p className="text-[12px] text-muted-foreground">Cần hoàn thành bước 1 trước khi hiện vị trí cần pick.</p>
                  ) : currentLine ? (
                    <div className="space-y-4">
                      <div className="rounded-[12px] border border-border bg-muted/50 p-4">
                        <p className="text-[11px] text-muted-foreground font-semibold">Vị trí cần đến</p>
                        <p className="text-[15px] text-foreground font-bold mt-1">
                          {currentLine.source_location_code || "(Hệ thống đang xác định vị trí phù hợp)"}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">Chỉ scan đúng vị trí này mới được sang bước tiếp theo.</p>
                      </div>

                      <div className="flex gap-2 flex-wrap">
                        <Input
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
                          placeholder="Barcode hoặc mã vị trí đích"
                          className="flex-1 min-w-[200px] h-12 py-3.5 text-[15px]"
                        />
                        <IconButton
                          variant="outline"
                          onClick={() => setActiveScanTarget("location")}
                          disabled={!presenceConfirmed || !currentLine}
                          label="Quét mã vị trí cần đến"
                          className="h-12 w-12 shrink-0"
                        >
                          <ScanLine className="w-4 h-4" />
                        </IconButton>
                        <Button
                          onClick={() => handleVerifyLocation()}
                          className={`h-12 px-4 text-[15px] ${
                            locationVerified
                              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400"
                              : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90"
                          }`}
                        >
                          {locationVerified ? "Đúng vị trí" : "Xác nhận vị trí"}
                        </Button>
                      </div>

                      {locationVerified ? (
                        <>
                          <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground pt-2">Scan sản phẩm cần lấy</p>
                          <div className="rounded-[12px] border border-border bg-muted/50 p-4">
                            <p className="text-[11px] text-muted-foreground font-semibold">Sản phẩm cần pick</p>
                            <p className="text-[13px] text-foreground font-semibold mt-1">{currentLine.book_title}</p>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              SKU: {currentLine.sku || "-"} | Barcode: {currentLine.barcode || "-"}
                            </p>
                            <p className="text-[12px] text-foreground mt-1 font-medium">
                              Cần pick: {currentLine.remaining_qty} (đã pick {currentLine.picked_qty}/{currentLine.requested_qty})
                            </p>
                            {taskClassLabel(detail.task_class) === "REPICK" && currentLine.repick_line?.original_line_id ? (
                              <p className="text-[11px] text-muted-foreground mt-1">
                                Truy vết dòng gốc: {currentLine.repick_line.original_line_id} | Thiếu ban đầu: {currentLine.repick_line.missing_qty}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex gap-2 flex-wrap">
                            <Input
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
                              placeholder="Barcode / mã nội bộ / ISBN / SKU"
                              className="flex-1 min-w-[200px] h-12 py-3.5 text-[15px]"
                            />
                            <IconButton
                              variant="outline"
                              onClick={() => setActiveScanTarget("product")}
                              disabled={loadingLookup || !locationVerified}
                              label="Quét mã vạch sản phẩm"
                              className="h-12 w-12 shrink-0"
                            >
                              <ScanLine className="w-4 h-4" />
                            </IconButton>
                            <Button
                              onClick={() => void handleLookupProduct()}
                              loading={loadingLookup}
                              className="h-12 px-4 text-[15px] bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90"
                            >
                              Xác nhận mã
                            </Button>
                          </div>

                          {ambiguousMatches.length > 0 ? (
                            <div className="rounded-[12px] border border-amber-200/60 bg-amber-50/50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                              <p className="text-[12px] text-amber-800 dark:text-amber-400 font-semibold">Barcode trùng nhiều item, chọn đúng item:</p>
                              <Select
                                value={selectedScannedVariantId || undefined}
                                onValueChange={(selected) => {
                                  setSelectedScannedVariantId(selected);

                                  if (selected === currentLine.variant_id) {
                                    setProductVerified(true);
                                    toast.success("Đã chọn đúng sản phẩm cho dòng hiện tại");
                                  } else {
                                    setProductVerified(false);
                                    toast.error("Sai sản phẩm cho dòng hiện tại");
                                  }
                                }}
                              >
                                <SelectTrigger className="mt-2 w-full text-[12px] border-amber-200 dark:border-amber-500/20">
                                  <SelectValue placeholder="Chọn biến thể đúng" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ambiguousMatches.map((match) => (
                                    <SelectItem key={match.variant_id} value={match.variant_id}>
                                      {match.sku || match.internal_barcode || match.isbn13 || match.isbn10} | {match.book_title} | {match.matched_by}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}

                          {productVerified ? (
                            <>
                              <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground pt-2">Nhập số lượng và xác nhận</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Số lượng</p>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={currentLine?.remaining_qty || 1}
                                    value={quantityInput}
                                    onChange={(event) => setQuantityInput(Math.max(1, Math.trunc(Number(event.target.value || 1))))}
                                    className="w-full h-12 py-3.5 text-[15px]"
                                  />
                                </div>
                                <div className="flex items-end justify-end">
                                  <Button
                                    onClick={handleConfirmLine}
                                    disabled={!canConfirmLine}
                                    loading={confirmingLine}
                                    className="h-12 px-5 text-[15px] bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90"
                                  >
                                    Xác nhận lấy dòng
                                  </Button>
                                </div>
                              </div>
                            </>
                          ) : (
                            <p className="text-[12px] text-muted-foreground">Cần scan đúng sản phẩm trước khi nhập số lượng.</p>
                          )}
                        </>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">Cần scan đúng vị trí đích trước khi hiện sản phẩm cần lấy.</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">Không tìm thấy dòng cần lấy tiếp theo.</p>
                  )}
                </SectionCard>
              </FadeItem>

              {canDeclareShortage ? (
                <FadeItem>
                  <Alert className="border-orange-200/70 bg-orange-50/60 dark:border-orange-500/20 dark:bg-orange-500/10">
                    <AlertTriangle className="text-orange-600 dark:text-orange-400" />
                    <AlertTitle className="text-orange-900 dark:text-orange-300">Không đủ hàng để pick?</AlertTitle>
                    <AlertDescription className="text-orange-800 dark:text-orange-400">
                      <p>
                        Nếu bạn đã pick tối đa có thể nhưng vẫn thiếu, hãy khai báo thiếu hàng.
                        Hệ thống sẽ tạo đơn REPICK để nhân viên khác có thể nhận và lấy bù phần còn thiếu.
                      </p>
                      <div className="mt-3">
                        {showShortageConfirm ? (
                          <div className="flex items-center gap-3 flex-wrap">
                            <p className="text-[12px] text-orange-900 dark:text-orange-300 font-semibold">Xác nhận khai báo thiếu hàng?</p>
                            <Button
                              onClick={() => void handleDeclareShortage()}
                              loading={declaringShortage}
                              size="sm"
                              className="bg-orange-600 hover:bg-orange-700 text-white"
                            >
                              Xác nhận, tạo REPICK
                            </Button>
                            <Button
                              onClick={() => setShowShortageConfirm(false)}
                              disabled={declaringShortage}
                              variant="outline"
                              size="sm"
                              className="border-orange-200 text-orange-700 hover:bg-orange-100 dark:border-orange-500/20 dark:text-orange-400 dark:hover:bg-orange-500/15"
                            >
                              Huỷ
                            </Button>
                          </div>
                        ) : (
                          <Button
                            onClick={() => setShowShortageConfirm(true)}
                            variant="outline"
                            size="sm"
                            className="border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-500/30 dark:text-orange-400 dark:hover:bg-orange-500/15"
                          >
                            Khai báo thiếu hàng &amp; tạo REPICK
                          </Button>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                </FadeItem>
              ) : null}
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
