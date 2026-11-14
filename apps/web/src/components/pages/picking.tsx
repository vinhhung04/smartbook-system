import React, { useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Circle, MapPin, Minus, Package, Plus, ScanLine, UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { FadeItem, PageWrapper } from "../motion-utils";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { useHardwareScanner } from "@/hooks/useHardwareScanner";
import { playScanError, playScanSuccess } from "@/lib/scan-feedback";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FilterBar } from "@/components/ui/filter-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
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

const ALL_WAREHOUSES = "all";
const PAGE_SIZE = 10;

const TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Chờ lấy",
  READY: "Chờ lấy",
  PICKING: "Đang lấy",
  IN_PROGRESS: "Đang lấy",
  PICKED: "Đã lấy xong",
  COMPLETED: "Đã lấy xong",
  SHORT_PICKED: "Thiếu hàng",
  CANCELLED: "Đã hủy",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function taskTypeLabel(orderType: string): string {
  if (orderType === "OUTBOUND_REPICK") return "Xuất kho · lấy bù";
  if (orderType === "WAREHOUSE_TRANSFER_REPICK") return "Chuyển kho · lấy bù";
  if (orderType === "WAREHOUSE_TRANSFER") return "Chuyển kho";
  if (orderType.startsWith("OUTBOUND_")) return "Xuất kho";
  return orderType;
}

function isRepick(taskClass?: string) {
  return taskClass === "REPICK";
}

function statusLabel(status: string) {
  return TASK_STATUS_LABELS[String(status || "").toUpperCase()] || status;
}

type ScanStep = "presence" | "location" | "product" | "quantity";

const SCAN_TITLES: Record<Exclude<ScanStep, "quantity">, string> = {
  presence: "Quét vị trí bạn đang đứng",
  location: "Quét mã kệ cần đến",
  product: "Quét mã vạch sách",
};

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
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(ALL_WAREHOUSES);

  const [tasks, setTasks] = useState<PickingTaskSummary[]>([]);
  const [query, setQuery] = useState("");
  const [taskClassFilter, setTaskClassFilter] = useState<"ALL" | "PICK" | "REPICK">("ALL");
  const [page, setPage] = useState(1);

  const [selectedTaskType, setSelectedTaskType] = useState<PickingTaskType | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [detail, setDetail] = useState<PickingTaskDetail | null>(null);

  const [presenceConfirmed, setPresenceConfirmed] = useState(false);
  const [presenceResolvedLocationInput, setPresenceResolvedLocationInput] = useState("");

  const [scanInput, setScanInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [locationVerified, setLocationVerified] = useState(false);
  const [productBarcodeInput, setProductBarcodeInput] = useState("");
  const [productVerified, setProductVerified] = useState(false);
  const [quantityInput, setQuantityInput] = useState(1);
  const [selectedScannedVariantId, setSelectedScannedVariantId] = useState("");
  const [ambiguousMatches, setAmbiguousMatches] = useState<PickingVariantLookupMatch[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [expandedRepickTaskId, setExpandedRepickTaskId] = useState<string | null>(null);
  const [repickChildren, setRepickChildren] = useState<(PickingTaskRecord & { picking_task_items: PickingTaskItemRecord[] })[]>([]);
  const [loadingRepickChildren, setLoadingRepickChildren] = useState(false);

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
  const staffNameById = useMemo(() => new Map(warehouseStaff.map((user) => [user.id, user.full_name || user.username || user.email])), [warehouseStaff]);

  // My tasks first, then unassigned ones waiting for a picker, then the oldest request first.
  const filteredTasks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const rank = (task: PickingTaskSummary) => (task.assigned_picker_user_id === currentUserId ? 0 : task.assigned_picker_user_id ? 2 : 1);
    return tasks
      .filter((task) => taskClassFilter === "ALL" || (taskClassFilter === "REPICK") === isRepick(task.task_class))
      .filter((task) => !keyword
        || task.order_number.toLowerCase().includes(keyword)
        || (task.source_warehouse_code || "").toLowerCase().includes(keyword)
        || (task.source_warehouse_name || "").toLowerCase().includes(keyword)
        || taskTypeLabel(task.order_type).toLowerCase().includes(keyword))
      .sort((a, b) => rank(a) - rank(b) || String(a.requested_at).localeCompare(String(b.requested_at)));
  }, [tasks, query, taskClassFilter, currentUserId]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const pagedTasks = useMemo(() => filteredTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredTasks, page]);

  const taskStats = useMemo(() => ({
    total: tasks.length,
    pick: tasks.filter((task) => !isRepick(task.task_class)).length,
    repick: tasks.filter((task) => isRepick(task.task_class)).length,
    unassigned: tasks.filter((task) => !task.assigned_picker_user_id).length,
    mine: tasks.filter((task) => task.assigned_picker_user_id === currentUserId).length,
  }), [tasks, currentUserId]);

  const currentLine = detail?.current_line || null;
  const completedLineCount = useMemo(
    () => (detail?.lines || []).filter((line) => Number(line.picked_qty || 0) >= Number(line.requested_qty || 0)).length,
    [detail],
  );
  const totalPickedQty = useMemo(() => (detail?.lines || []).reduce((sum, line) => sum + Number(line.picked_qty || 0), 0), [detail]);
  const totalRequestedQty = useMemo(() => (detail?.lines || []).reduce((sum, line) => sum + Number(line.requested_qty || 0), 0), [detail]);

  const canDeclareShortage = Boolean(
    detail
    && totalPickedQty > 0
    && (detail.lines || []).some((line) => Number(line.picked_qty || 0) < Number(line.requested_qty || 0)),
  );

  const scanStep: ScanStep = !presenceConfirmed ? "presence" : !locationVerified ? "location" : !productVerified ? "product" : "quantity";
  const canConfirmLine = Boolean(detail && currentLine && scanStep === "quantity" && Number(quantityInput) > 0);

  const loadTasks = async (warehouseId?: string) => {
    const res = await pickingService.getTasks(warehouseId && warehouseId !== ALL_WAREHOUSES ? warehouseId : undefined);
    setTasks(res.data || []);
  };
  const reloadTasks = () => loadTasks(canManageAssignment ? selectedWarehouseId : undefined);

  const resetLineProgress = () => {
    setScanInput("");
    setLocationInput("");
    setLocationVerified(false);
    setProductBarcodeInput("");
    setProductVerified(false);
    setQuantityInput(1);
    setSelectedScannedVariantId("");
    setAmbiguousMatches([]);
  };

  const loadDetail = async (
    taskType: PickingTaskType,
    taskId: string,
    options?: { preservePresence?: boolean; currentLocationInput?: string },
  ): Promise<PickingTaskDetail> => {
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
        setPresenceResolvedLocationInput("");
      }
      resetLineProgress();
      return data;
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
        // Only narrow to one warehouse when the user belongs to it; otherwise show every
        // warehouse so tasks are never hidden behind an arbitrary default branch.
        const preferred = rows.some((item) => item.id === currentUserPrimaryWarehouseId) ? currentUserPrimaryWarehouseId : ALL_WAREHOUSES;
        setSelectedWarehouseId(preferred);
        if (!canManageAssignment) await loadTasks();
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được danh sách đơn lấy hàng"));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [canManageAssignment, currentUserPrimaryWarehouseId]);

  useEffect(() => {
    if (!canManageAssignment) return;
    void loadTasks(selectedWarehouseId).catch((error) => {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách đơn theo kho"));
    });
  }, [canManageAssignment, selectedWarehouseId]);

  useEffect(() => { setPage(1); }, [query, taskClassFilter, selectedWarehouseId]);
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);

  useEffect(() => {
    if (detail && scanStep !== "quantity") document.getElementById("picking-scan")?.focus({ preventScroll: true });
  }, [detail, scanStep]);

  const handleAssignTask = async (task: PickingTaskSummary) => {
    const key = `${task.task_type}:${task.task_id}`;
    const pickerUserId = assigningPickerIdByTask[key];
    if (!pickerUserId) {
      toast.error("Chọn nhân viên kho trước khi giao việc");
      return;
    }
    try {
      setClaimingTaskKey(key);
      await pickingService.claimTask(task.task_type, task.task_id, pickerUserId);
      await reloadTasks();
      toast.success(`Đã giao đơn ${task.order_number}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Giao việc thất bại"));
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

  const matchesLineLocation = (line: PickingTaskDetail["current_line"], input: string) => {
    if (!line) return false;
    const normalized = input.trim().toLowerCase();
    return [line.source_location_id, line.source_location_code, line.source_location_barcode]
      .filter(Boolean)
      .some((value) => String(value).trim().toLowerCase() === normalized);
  };

  const acceptLocation = (line: NonNullable<PickingTaskDetail["current_line"]>, input: string) => {
    setLocationInput(input);
    setLocationVerified(true);
    setProductVerified(false);
    setProductBarcodeInput("");
    setQuantityInput(Math.max(1, Math.trunc(Number(line.remaining_qty || 1))));
    setSelectedScannedVariantId("");
    setAmbiguousMatches([]);
  };

  const handleConfirmPresence = async (input: string) => {
    if (!selectedTaskType || !selectedTaskId) return;
    const value = input.trim();
    if (!value) {
      toast.error("Quét hoặc nhập mã vị trí bạn đang đứng");
      return;
    }
    try {
      setConfirmingPresence(true);
      const res = await pickingService.confirmPresence(selectedTaskType, selectedTaskId, value);
      const confirmedLocation = String(res.data.location_code || value).trim();
      setPresenceConfirmed(true);
      setPresenceResolvedLocationInput(confirmedLocation);
      const fresh = await loadDetail(selectedTaskType, selectedTaskId, { preservePresence: true, currentLocationInput: confirmedLocation });
      playScanSuccess();
      // Standing at the shelf of the first line already? That one scan also verifies the location.
      if (fresh.current_line && matchesLineLocation(fresh.current_line, value)) {
        acceptLocation(fresh.current_line, value);
        toast.success(`Đã xác nhận có mặt và đúng kệ ${fresh.current_line.source_location_code}`);
      } else {
        toast.success(`Đã xác nhận có mặt tại ${res.data.location_code}`);
      }
    } catch (error) {
      playScanError();
      toast.error(getApiErrorMessage(error, "Xác nhận vị trí thất bại"));
    } finally {
      setConfirmingPresence(false);
    }
  };

  const handleVerifyLocation = (input: string) => {
    if (!currentLine) {
      toast.error("Không có dòng cần lấy");
      return;
    }
    if (!input.trim()) {
      toast.error("Quét hoặc nhập mã kệ cần đến");
      return;
    }
    if (matchesLineLocation(currentLine, input)) {
      acceptLocation(currentLine, input.trim());
      playScanSuccess();
      return;
    }
    // No shelf assigned yet: the backend resolves the source on confirm and accepts any
    // location that actually holds this book, so let the scan through and let it decide.
    if (!currentLine.source_location_id && !currentLine.source_location_code) {
      acceptLocation(currentLine, input.trim());
      playScanSuccess();
      toast.info("Dòng chưa gán kệ — hệ thống sẽ kiểm tra vị trí này có sách khi bạn xác nhận.");
      return;
    }
    setLocationVerified(false);
    setProductVerified(false);
    playScanError();
    toast.error(`Sai kệ. Cần đến ${currentLine.source_location_code || "vị trí được chỉ định"}`);
  };

  const handleLookupProduct = async (input: string) => {
    if (!currentLine) return;
    const barcode = input.trim();
    if (!barcode) {
      toast.error("Quét hoặc nhập mã vạch sách");
      return;
    }
    setProductBarcodeInput(barcode);
    try {
      setLoadingLookup(true);
      const res = await pickingService.lookupVariantByBarcode(barcode);
      if (res.ambiguous) {
        setAmbiguousMatches(res.matches || []);
        setSelectedScannedVariantId("");
        setProductVerified(false);
        playScanError();
        toast.error("Mã vạch trùng nhiều sách, hãy chọn đúng cuốn");
        return;
      }
      setAmbiguousMatches([]);
      if (res.selected?.variant_id) {
        if (res.selected.variant_id !== currentLine.variant_id) {
          setProductVerified(false);
          setSelectedScannedVariantId("");
          playScanError();
          toast.error(`Sai sách. Cần lấy: ${currentLine.book_title}`);
          return;
        }
        setSelectedScannedVariantId(res.selected.variant_id);
        setProductVerified(true);
        playScanSuccess();
      }
    } catch (error) {
      playScanError();
      toast.error(getApiErrorMessage(error, "Không tra cứu được mã vạch sách"));
    } finally {
      setLoadingLookup(false);
    }
  };

  const handleScan = (raw: string) => {
    const value = raw.trim();
    setScanInput("");
    if (!value || !detail || !currentLine) return;
    if (scanStep === "presence") void handleConfirmPresence(value);
    else if (scanStep === "location") handleVerifyLocation(value);
    else if (scanStep === "product") void handleLookupProduct(value);
  };

  // Handheld keyboard-wedge scanner: the current step decides what a scan means, so staff
  // never has to tap a field first — shelf, then book, one after another.
  useHardwareScanner(handleScan);

  const handleConfirmLine = async () => {
    if (!selectedTaskType || !selectedTaskId || !currentLine) {
      toast.error("Chưa có dòng cần lấy");
      return;
    }
    const quantity = Math.trunc(Number(quantityInput || 0));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Số lượng phải lớn hơn 0");
      return;
    }
    if (quantity > Number(currentLine.remaining_qty || 0)) {
      toast.error(`Chỉ còn ${currentLine.remaining_qty} cuốn cần lấy ở dòng này`);
      return;
    }
    try {
      setConfirmingLine(true);
      const result = await pickingService.confirmLine(selectedTaskType, selectedTaskId, currentLine.line_id, {
        quantity,
        scanned_location_input: locationInput.trim(),
        scanned_product_barcode: productBarcodeInput.trim() || null,
        scanned_variant_id: selectedScannedVariantId || null,
      });
      const nextLocationContext = locationInput.trim() || presenceResolvedLocationInput;
      setPresenceConfirmed(true);
      setPresenceResolvedLocationInput(nextLocationContext);
      await Promise.all([
        loadDetail(selectedTaskType, selectedTaskId, { preservePresence: true, currentLocationInput: nextLocationContext }),
        reloadTasks(),
      ]);
      playScanSuccess();
      if (result.data.task_completed) {
        confetti({ particleCount: 60, spread: 55, origin: { y: 0.7 } });
        toast.success("Đã lấy đủ hàng cho đơn này");
      } else if (result.data.line_remaining_quantity > 0) {
        toast.success(`Đã lấy ${quantity} cuốn, dòng này còn ${result.data.line_remaining_quantity}`);
      } else {
        toast.success(`Đã lấy ${quantity} cuốn`);
      }
    } catch (error) {
      playScanError();
      toast.error(getApiErrorMessage(error, "Xác nhận lấy hàng thất bại"));
    } finally {
      setConfirmingLine(false);
    }
  };

  const handleBackToList = () => {
    setSelectedTaskType(null);
    setSelectedTaskId("");
    setDetail(null);
    setPresenceConfirmed(false);
    setPresenceResolvedLocationInput("");
    resetLineProgress();
    setCameraOpen(false);
    setShowShortageConfirm(false);
  };

  const handleDeclareShortage = async () => {
    if (!selectedTaskId || !selectedTaskType || declaringShortage) return;
    setShowShortageConfirm(false);
    setDeclaringShortage(true);
    try {
      const res = await pickingService.declareShortage(selectedTaskType, selectedTaskId);
      toast.success(res.data?.order_number
        ? `Đã tạo đơn lấy bù ${res.data.order_number} cho phần còn thiếu`
        : "Đã khai báo thiếu hàng và tạo đơn lấy bù");
      await reloadTasks();
      handleBackToList();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khai báo thiếu hàng thất bại"));
    } finally {
      setDeclaringShortage(false);
    }
  };

  const toggleRepickChildren = async (pickingTaskId: string) => {
    if (expandedRepickTaskId === pickingTaskId) {
      setExpandedRepickTaskId(null);
      setRepickChildren([]);
      return;
    }
    setExpandedRepickTaskId(pickingTaskId);
    setLoadingRepickChildren(true);
    try {
      setRepickChildren(await pickingService.getPickingTaskChildren(pickingTaskId));
    } finally {
      setLoadingRepickChildren(false);
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <LoadingOverlay />
      </PageWrapper>
    );
  }

  if (detail) {
    const progress = totalRequestedQty > 0 ? Math.round((totalPickedQty / totalRequestedQty) * 100) : 0;
    const from = detail.source_warehouse_code || detail.source_warehouse_name;
    const to = detail.target_warehouse_code || detail.target_warehouse_name;
    const done = detail.remaining_line_count === 0;
    const stepHint: Record<ScanStep, string> = {
      presence: currentLine?.source_location_code
        ? `Quét mã vị trí bạn đang đứng để bắt đầu. Nếu đang ở kệ ${currentLine.source_location_code}, quét luôn mã kệ đó.`
        : "Quét mã vị trí bạn đang đứng để bắt đầu và sắp lộ trình ngắn nhất.",
      location: currentLine?.source_location_code
        ? `Đi tới kệ ${currentLine.source_location_code} rồi quét mã kệ.`
        : "Dòng này chưa được gán kệ. Đến vị trí đang có cuốn sách này và quét mã vị trí đó.",
      product: "Lấy sách trên kệ và quét mã vạch trên bìa.",
      quantity: "Kiểm lại số cuốn trên tay rồi xác nhận.",
    };
    // The four checks of one line, in the order the picker does them.
    const steps: { key: ScanStep; label: string; done: boolean }[] = [
      { key: "presence", label: "Có mặt tại kho", done: presenceConfirmed },
      { key: "location", label: "Đúng kệ", done: locationVerified },
      { key: "product", label: "Đúng sách", done: productVerified },
      { key: "quantity", label: "Xác nhận số lượng", done: false },
    ];

    return (
      <PageWrapper className="space-y-6">
        <FadeItem>
          <Button variant="ghost" size="sm" onClick={handleBackToList} className="-ml-3 mb-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Danh sách đơn lấy hàng
          </Button>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2.5 font-mono text-[24px] font-semibold tracking-tight text-foreground">
                {detail.order_number}
                {isRepick(detail.task_class) ? (
                  <StatusBadge label={detail.repick_sequence ? `Lấy bù #${detail.repick_sequence}` : "Lấy bù"} variant="warning" />
                ) : null}
              </h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {taskTypeLabel(detail.order_type)}{from ? ` từ ${from}` : ""}{to ? ` đến ${to}` : ""}
              </p>
            </div>
            <dl className="flex w-full items-end gap-6 rounded-2xl border border-border bg-card px-5 py-3 sm:w-auto">
              <div>
                <dt className="text-[12px] text-muted-foreground">Đã lấy</dt>
                <dd className="font-serif text-[22px] font-semibold leading-tight tabular-nums">
                  {totalPickedQty}<span className="text-[15px] font-medium text-muted-foreground"> / {totalRequestedQty} cuốn</span>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Dòng xong</dt>
                <dd className="font-serif text-[22px] font-semibold leading-tight tabular-nums">
                  {completedLineCount}<span className="text-[15px] font-medium text-muted-foreground"> / {detail.lines.length}</span>
                </dd>
              </div>
              <div className="min-w-24 flex-1 pb-2 sm:w-28 sm:flex-none">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến độ lấy hàng">
                  <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </dl>
          </div>
        </FadeItem>

        <FadeItem>
          <div className="@container/page">
            <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0">
                {loadingDetail && !currentLine ? (
                  <div className="rounded-2xl border border-border bg-card"><LoadingOverlay /></div>
                ) : done ? (
                  <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-8 text-center dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]">
                    <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <h2 className="mt-3 font-serif text-[22px] font-semibold text-foreground">Đã lấy đủ hàng</h2>
                    <p className="mt-1 text-[14px] text-muted-foreground">
                      {totalPickedQty} cuốn đã chuyển sang khu xuất hàng và đang chờ xác nhận xuất kho
                      {detail.completed_at ? `, xong lúc ${formatDate(detail.completed_at)}` : ""}.
                    </p>
                    <Button className="mt-5" onClick={handleBackToList}>
                      <ArrowLeft className="h-4 w-4" /> Về danh sách đơn
                    </Button>
                  </section>
                ) : currentLine ? (
                  <section aria-labelledby="next-pick-title" className={cn("rounded-2xl border border-border bg-card transition-opacity", loadingDetail && "opacity-60")}>
                    <div className="border-b border-border p-5">
                      <h2 id="next-pick-title" className="font-serif text-[18px] font-semibold tracking-tight">Lấy tiếp theo</h2>
                      <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-4 @xl/page:grid-cols-[auto_minmax(0,1fr)_auto]">
                        <div className={cn(
                          "flex flex-col items-center justify-center rounded-xl border px-4 py-3",
                          locationVerified ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10" : "border-primary/25 bg-primary/[0.06]",
                        )}>
                          <MapPin className={cn("h-4 w-4", locationVerified ? "text-emerald-600 dark:text-emerald-400" : "text-primary")} aria-hidden="true" />
                          <span className="mt-1 text-[12px] text-muted-foreground">Kệ</span>
                          {currentLine.source_location_code ? (
                            <span className="font-mono text-[20px] font-bold leading-tight text-foreground">{currentLine.source_location_code}</span>
                          ) : (
                            <span className="text-[13px] font-semibold leading-tight text-muted-foreground">Chưa gán</span>
                          )}
                        </div>
                        <div className="min-w-0 self-center">
                          <p className="text-[17px] font-semibold leading-snug text-foreground">{currentLine.book_title}</p>
                          <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[12px] text-muted-foreground">
                            <span>{currentLine.isbn13 || currentLine.barcode || "Không có mã"}</span>
                            {currentLine.sku ? <span>{currentLine.sku}</span> : null}
                          </p>
                          {currentLine.note ? <p className="mt-1 text-[13px] text-amber-700 dark:text-amber-400">Ghi chú: {currentLine.note}</p> : null}
                        </div>
                        <div className="col-span-2 flex items-baseline gap-2 @xl/page:col-span-1 @xl/page:flex-col @xl/page:items-end @xl/page:justify-center @xl/page:gap-0">
                          <span className="text-[12px] text-muted-foreground">Cần lấy</span>
                          <span className="font-serif text-[36px] font-semibold leading-none tabular-nums text-foreground">{currentLine.remaining_qty}</span>
                          <span className="text-[12px] text-muted-foreground">
                            {currentLine.picked_qty > 0 ? `đã lấy ${currentLine.picked_qty}/${currentLine.requested_qty}` : "cuốn"}
                          </span>
                        </div>
                      </div>
                      {isRepick(detail.task_class) && currentLine.repick_line?.missing_qty ? (
                        <p className="mt-3 text-[13px] text-amber-700 dark:text-amber-400">
                          Lấy bù phần thiếu {currentLine.repick_line.missing_qty} cuốn từ đơn {detail.parent_order_number || detail.root_order_number || "gốc"}.
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-5 p-5">
                      <ol className="grid grid-cols-2 gap-2 @xl/page:grid-cols-4" aria-label="Các bước của dòng này">
                        {steps.map((step, index) => {
                          const current = step.key === scanStep;
                          return (
                            <li
                              key={step.key}
                              aria-current={current ? "step" : undefined}
                              className={cn(
                                "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]",
                                step.done ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/[0.07] dark:text-emerald-300"
                                  : current ? "border-primary/30 bg-primary/[0.06] font-semibold text-primary"
                                    : "border-border text-muted-foreground",
                              )}
                            >
                              {step.done ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                              ) : (
                                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums", current ? "bg-primary text-primary-foreground" : "bg-muted")} aria-hidden="true">{index + 1}</span>
                              )}
                              {step.label}
                            </li>
                          );
                        })}
                      </ol>

                      {scanStep !== "quantity" ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            handleScan(scanInput);
                          }}
                          className="space-y-2"
                        >
                          <label htmlFor="picking-scan" className="block text-[15px] font-semibold text-foreground">{SCAN_TITLES[scanStep]}</label>
                          <p className="text-[13px] text-muted-foreground">{stepHint[scanStep]}</p>
                          <div className="flex flex-wrap gap-2">
                            <Input
                              id="picking-scan"
                              value={scanInput}
                              onChange={(event) => setScanInput(event.target.value)}
                              placeholder={scanStep === "product" ? "Mã vạch, ISBN hoặc SKU" : "Mã vị trí hoặc barcode kệ"}
                              autoComplete="off"
                              className="h-14 min-w-0 flex-[1_1_16rem] font-mono text-[16px]"
                            />
                            <IconButton type="button" variant="outline" onClick={() => setCameraOpen(true)} label="Quét bằng camera" className="h-14 w-14 shrink-0">
                              <ScanLine className="h-5 w-5" />
                            </IconButton>
                            <Button type="submit" loading={confirmingPresence || loadingLookup} className="h-14 flex-1 px-5 text-[15px] sm:flex-none">
                              Xác nhận
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[15px] font-semibold text-foreground">Số cuốn đã lấy</p>
                          <p className="text-[13px] text-muted-foreground">{stepHint.quantity}</p>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center rounded-xl border border-border">
                              <IconButton type="button" variant="ghost" label="Bớt 1 cuốn" className="h-14 w-14" onClick={() => setQuantityInput((value) => Math.max(1, value - 1))} disabled={quantityInput <= 1}>
                                <Minus className="h-5 w-5" />
                              </IconButton>
                              <Input
                                type="number"
                                inputMode="numeric"
                                aria-label="Số cuốn đã lấy"
                                min={1}
                                max={currentLine.remaining_qty || 1}
                                value={quantityInput}
                                onChange={(event) => setQuantityInput(Math.min(Number(currentLine.remaining_qty || 1), Math.max(1, Math.trunc(Number(event.target.value || 1)))))}
                                className="h-14 w-20 border-0 text-center font-serif text-[22px] font-semibold shadow-none focus-visible:ring-0"
                              />
                              <IconButton type="button" variant="ghost" label="Thêm 1 cuốn" className="h-14 w-14" onClick={() => setQuantityInput((value) => Math.min(Number(currentLine.remaining_qty || 1), value + 1))} disabled={quantityInput >= Number(currentLine.remaining_qty || 1)}>
                                <Plus className="h-5 w-5" />
                              </IconButton>
                            </div>
                            <Button onClick={() => void handleConfirmLine()} disabled={!canConfirmLine} loading={confirmingLine} className="h-14 flex-1 bg-emerald-600 px-5 text-[15px] hover:bg-emerald-700 sm:flex-none">
                              <CheckCircle2 className="h-5 w-5" />
                              Xác nhận đã lấy {quantityInput} cuốn
                            </Button>
                          </div>
                          {quantityInput < Number(currentLine.remaining_qty || 0) ? (
                            <p className="text-[13px] text-amber-700 dark:text-amber-400">Lấy ít hơn số cần: phần còn lại vẫn ở dòng này để lấy tiếp hoặc khai báo thiếu.</p>
                          ) : null}
                        </div>
                      )}

                      {ambiguousMatches.length > 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                          <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-300">Mã vạch trùng nhiều sách. Chọn đúng cuốn trên tay:</p>
                          <Select
                            value={selectedScannedVariantId || undefined}
                            onValueChange={(selected) => {
                              setSelectedScannedVariantId(selected);
                              if (selected === currentLine.variant_id) {
                                setProductVerified(true);
                                setAmbiguousMatches([]);
                                playScanSuccess();
                              } else {
                                setProductVerified(false);
                                playScanError();
                                toast.error(`Sai sách. Cần lấy: ${currentLine.book_title}`);
                              }
                            }}
                          >
                            <SelectTrigger className="mt-2 w-full text-[13px]" aria-label="Chọn đúng sách">
                              <SelectValue placeholder="Chọn sách" />
                            </SelectTrigger>
                            <SelectContent>
                              {ambiguousMatches.map((match) => (
                                <SelectItem key={match.variant_id} value={match.variant_id}>
                                  {match.book_title} ({match.sku || match.internal_barcode || match.isbn13 || match.isbn10})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : (
                  <div className="rounded-2xl border border-border bg-card">
                    <EmptyState variant="no-data" title="Không tìm thấy dòng cần lấy tiếp" description="Tải lại đơn hoặc quay về danh sách." />
                  </div>
                )}
              </div>

              <aside aria-labelledby="pick-list-title" className="@4xl/page:sticky @4xl/page:top-4">
                <section className="rounded-2xl border border-border bg-card">
                  <div className="border-b border-border px-5 py-3.5">
                    <h2 id="pick-list-title" className="font-serif text-[16px] font-semibold tracking-tight">Lộ trình lấy hàng</h2>
                    <p className="text-[12px] text-muted-foreground">Theo thứ tự kệ, gần nhất trước.</p>
                  </div>
                  <ol className="max-h-[60vh] overflow-y-auto">
                    {detail.lines.map((line) => {
                      const lineDone = Number(line.picked_qty || 0) >= Number(line.requested_qty || 0);
                      const isCurrent = !done && currentLine?.line_id === line.line_id;
                      return (
                        <li
                          key={line.line_id}
                          aria-current={isCurrent ? "step" : undefined}
                          className={cn("flex items-start gap-3 border-b border-border px-5 py-3 last:border-0", isCurrent && "bg-primary/[0.06]")}
                        >
                          {lineDone ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Đã lấy" />
                          ) : isCurrent ? (
                            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Đang lấy" />
                          ) : (
                            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-label="Chưa lấy" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={cn("line-clamp-2 text-[13px]", lineDone ? "text-muted-foreground line-through decoration-muted-foreground/40" : "font-medium text-foreground")} title={line.book_title}>{line.book_title}</p>
                            <p className="font-mono text-[12px] text-muted-foreground">{line.source_location_code || "Chưa gán kệ"}</p>
                          </div>
                          <span className={cn("shrink-0 text-[13px] tabular-nums", lineDone ? "text-muted-foreground" : "font-semibold text-foreground")}>
                            {line.picked_qty}/{line.requested_qty}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                  {canDeclareShortage && !done ? (
                    <div className="border-t border-border p-4">
                      {showShortageConfirm ? (
                        <div className="space-y-2">
                          <p className="text-[13px] text-foreground">Tạo đơn lấy bù cho phần còn thiếu và kết thúc đơn này?</p>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => void handleDeclareShortage()} loading={declaringShortage} className="bg-amber-600 text-white hover:bg-amber-700">
                              Xác nhận thiếu hàng
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setShowShortageConfirm(false)} disabled={declaringShortage}>Hủy</Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowShortageConfirm(true)}
                          className="inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-amber-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 dark:text-amber-300"
                        >
                          <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Kệ không đủ hàng? Khai báo thiếu
                        </button>
                      )}
                    </div>
                  ) : null}
                </section>
              </aside>
            </div>
          </div>
        </FadeItem>

        <BarcodeScanModal
          isOpen={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onDetected={(code) => {
            setCameraOpen(false);
            handleScan(code);
          }}
          title={scanStep === "quantity" ? "Quét mã vạch" : SCAN_TITLES[scanStep]}
        />
      </PageWrapper>
    );
  }

  // Same rule the list is sorted by (filteredTasks): mine, then unassigned, then someone else's.
  const groupOf = (task: PickingTaskSummary) => (task.assigned_picker_user_id === currentUserId ? 0 : task.assigned_picker_user_id ? 2 : 1);
  const GROUP_LABEL = ["Giao cho bạn", "Chưa giao cho ai", "Người khác đang lấy"];
  const LIST_COLUMNS = [
    { label: "Đơn hàng", className: "pl-5" },
    { label: "Cần lấy", className: "hidden w-[100px] @xl:table-cell" },
    { label: "Người lấy", className: "hidden w-[250px] @2xl:table-cell" },
    { label: "Yêu cầu lúc", className: "hidden w-[120px] @4xl:table-cell" },
    { label: "", className: "w-[120px] pr-5" },
  ];
  // Full-width rows repeat the header's cells instead of using colSpan: a spanning row keeps
  // the container-hidden columns in the table grid and squeezes the order column on phones.
  const fillerCells = (className?: string) =>
    LIST_COLUMNS.slice(1).map((column, index) => <TableCell key={`filler-${index}`} aria-hidden="true" className={cn(column.className, className)} />);
  const lede = tasks.length === 0
    ? "Chưa có đơn nào cần lấy."
    : `${taskStats.total} đơn cần lấy, ${taskStats.mine} giao cho bạn${taskStats.unassigned > 0 ? `, ${taskStats.unassigned} chưa giao cho ai` : ""}.`;

  const railButton = (active: boolean, onClick: () => void, label: string, count?: number) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-primary/[0.08] text-primary" : "text-foreground hover:bg-muted/60",
      )}
    >
      <span className={cn("min-w-0 truncate text-[13px]", active ? "font-semibold" : "font-medium")} title={label}>{label}</span>
      {count !== undefined && <span className={cn("shrink-0 text-[12px] tabular-nums", active ? "text-primary" : "text-muted-foreground")}>{count}</span>}
    </button>
  );
  const CLASS_ITEMS: Array<{ value: "ALL" | "PICK" | "REPICK"; label: string; count: number }> = [
    { value: "ALL", label: "Tất cả đơn", count: taskStats.total },
    { value: "PICK", label: "Lấy hàng", count: taskStats.pick },
    { value: "REPICK", label: "Lấy bù", count: taskStats.repick },
  ];

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader icon={Package} title="Lấy hàng" description={lede} />
      </FadeItem>

      <FadeItem>
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="Lọc đơn lấy hàng" className="hidden max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Loại đơn</p>
              {CLASS_ITEMS.map((item) => (
                <div key={item.value}>{railButton(taskClassFilter === item.value, () => setTaskClassFilter(item.value), item.label, item.count)}</div>
              ))}
              {canManageAssignment && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="px-3 text-[12px] font-semibold text-muted-foreground">Kho nguồn</p>
                  <p className="px-3 pb-1.5 text-[12px] text-muted-foreground">Đơn chuyển kho nằm ở kho nguồn.</p>
                  {railButton(selectedWarehouseId === ALL_WAREHOUSES, () => setSelectedWarehouseId(ALL_WAREHOUSES), "Tất cả kho")}
                  {warehouses.map((warehouse) => (
                    <div key={warehouse.id}>{railButton(selectedWarehouseId === warehouse.id, () => setSelectedWarehouseId(warehouse.id), warehouse.name)}</div>
                  ))}
                </div>
              )}
            </nav>

            <section aria-label="Danh sách đơn lấy hàng" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="px-5 pb-1 pt-4">
                <h2 className="font-serif text-[18px] font-semibold tracking-tight">
                  {taskClassFilter === "REPICK" ? "Đơn lấy bù" : taskClassFilter === "PICK" ? "Đơn lấy hàng" : "Đơn cần lấy"}
                </h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {canManageAssignment ? "Giao đơn cho nhân viên kho và theo dõi tiến độ lấy hàng." : "Các đơn lấy hàng được giao cho bạn."}
                </p>
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={query}
                  onSearchChange={setQuery}
                  searchPlaceholder="Mã đơn, kho hoặc loại đơn"
                  showSearchClear
                  filters={(
                    <div className="flex flex-wrap items-center gap-2 @4xl/page:hidden">
                      {canManageAssignment ? (
                        <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
                          <SelectTrigger size="sm" className="w-[200px]" aria-label="Kho nguồn" title="Đơn chuyển kho hiện ở kho nguồn.">
                            <SelectValue placeholder="Chọn kho" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ALL_WAREHOUSES}>Tất cả kho</SelectItem>
                            {warehouses.map((warehouse) => (
                              <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      <div className="max-w-full overflow-x-auto">
                        <SegmentedControl
                          options={CLASS_ITEMS.map((item) => ({ value: item.value, label: `${item.value === "ALL" ? "Tất cả" : item.label} (${item.count})` }))}
                          value={taskClassFilter}
                          onChange={(v) => setTaskClassFilter(v as "ALL" | "PICK" | "REPICK")}
                          layoutId="picking-class-filter"
                          className="w-max"
                        />
                      </div>
                    </div>
                  )}
                />
              </div>

              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {LIST_COLUMNS.map((head, index) => (
                      <TableHead key={index} className={cn("px-3 text-[12px] font-medium text-muted-foreground", head.className)}>{head.label || <span className="sr-only">Thao tác</span>}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedTasks.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="whitespace-normal py-12 text-center">
                        <EmptyState
                          variant="no-data"
                          title={tasks.length === 0 ? "Chưa có đơn nào cần lấy" : "Không có đơn khớp bộ lọc"}
                          description={tasks.length === 0 ? "Đơn xuất kho hoặc chuyển kho đã duyệt sẽ hiện ở đây." : "Thử đổi kho, loại đơn hoặc từ khóa."}
                        />
                      </TableCell>
                    </TableRow>
                  ) : pagedTasks.map((task, index) => {
                    const key = `${task.task_type}:${task.task_id}`;
                    const assignedToMe = Boolean(task.assigned_picker_user_id) && task.assigned_picker_user_id === currentUserId;
                    const isAssigned = Boolean(task.assigned_picker_user_id);
                    const selectedPickerId = assigningPickerIdByTask[key] || "";
                    const assignedPickerName = task.assigned_picker_user_id
                      ? staffNameById.get(task.assigned_picker_user_id) || (assignedToMe ? currentUserLabel : `Nhân viên ${task.assigned_picker_user_id.slice(0, 8)}`)
                      : "";
                    const repick = isRepick(task.task_class);
                    const from = task.source_warehouse_code || task.source_warehouse_name;
                    const to = task.target_warehouse_code || task.target_warehouse_name;
                    const inProgress = task.remaining_quantity < task.total_quantity;
                    const group = groupOf(task);
                    const groupStarts = index === 0 || groupOf(pagedTasks[index - 1]) !== group;

                    // Assignment control lives with the assignee column; on narrow tables that
                    // column is hidden, so the same control is rendered under the order instead.
                    const assignment = !isAssigned && canManageAssignment ? (
                      <div className="flex items-center gap-2">
                        <Select value={selectedPickerId || "none"} onValueChange={(v) => setAssigningPickerIdByTask((prev) => ({ ...prev, [key]: v === "none" ? "" : v }))}>
                          <SelectTrigger size="sm" aria-label={`Chọn nhân viên kho cho ${task.order_number}`} className="h-8 min-w-0 flex-1 text-[12px]">
                            <SelectValue placeholder="Chọn nhân viên" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Chọn nhân viên</SelectItem>
                            {warehouseStaff.map((staff) => (
                              <SelectItem key={staff.id} value={staff.id}>{staff.full_name || staff.username}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" onClick={() => void handleAssignTask(task)} disabled={!selectedPickerId} loading={claimingTaskKey === key}>
                          <UserCheck className="h-3.5 w-3.5" /> Giao
                        </Button>
                      </div>
                    ) : null;

                    return (
                      <React.Fragment key={key}>
                        {groupStarts && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell className="whitespace-normal bg-muted/40 py-2 pl-5 text-[12px] font-semibold text-muted-foreground">
                              {GROUP_LABEL[group]}
                            </TableCell>
                            {fillerCells("bg-muted/40")}
                          </TableRow>
                        )}
                        <TableRow className="hover:bg-muted/40">
                          <TableCell className="py-3.5 pl-5 pr-3 align-top">
                            <p className="truncate font-mono text-[13px] font-semibold" title={task.order_number}>{task.order_number}</p>
                            <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                              {taskTypeLabel(task.order_type)}{from ? ` từ ${from}` : ""}{to ? ` đến ${to}` : ""}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <StatusBadge label={statusLabel(task.status)} variant={getPickingTaskStatusVariant(task.status)} dot />
                              {repick ? <StatusBadge label={task.repick_sequence ? `Lấy bù #${task.repick_sequence}` : "Lấy bù"} variant="warning" /> : null}
                              {!repick && (task.repick_count ?? 0) > 0 && task.picking_task_id ? (
                                <button
                                  type="button"
                                  onClick={() => void toggleRepickChildren(task.picking_task_id!)}
                                  className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[12px] text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15"
                                  aria-label={`Xem ${task.repick_count} đơn lấy bù của ${task.order_number}`}
                                  aria-expanded={expandedRepickTaskId === task.picking_task_id}
                                >
                                  {task.repick_count} đơn lấy bù
                                  {expandedRepickTaskId === task.picking_task_id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                </button>
                              ) : null}
                            </div>
                            <p className="mt-1.5 text-[12px] text-muted-foreground @xl:hidden">
                              Còn <span className="font-semibold text-foreground">{task.remaining_quantity}</span> cuốn, {task.line_count} dòng
                            </p>
                            <div className="mt-2 @2xl:hidden">
                              {assignment ?? <p className="text-[12px] text-muted-foreground">{isAssigned ? `Người lấy: ${assignedPickerName}` : "Chưa giao"}</p>}
                            </div>
                          </TableCell>
                          <TableCell className="hidden px-3 py-3.5 align-top @xl:table-cell">
                            <p className="font-serif text-[18px] font-semibold leading-tight tabular-nums">{task.remaining_quantity}<span className="ml-1 font-sans text-[12px] font-normal text-muted-foreground">cuốn</span></p>
                            <p className="text-[12px] text-muted-foreground">{task.line_count} dòng</p>
                          </TableCell>
                          <TableCell className="hidden px-3 py-3.5 align-top @2xl:table-cell">
                            {assignment ?? <p className={cn("text-[13px]", isAssigned ? "text-foreground" : "text-muted-foreground")}>{isAssigned ? assignedPickerName : "Chưa giao"}</p>}
                          </TableCell>
                          <TableCell className="hidden px-3 py-3.5 align-top text-[13px] tabular-nums text-muted-foreground @4xl:table-cell">{formatDate(task.requested_at)}</TableCell>
                          <TableCell className="py-3.5 pl-3 pr-5 text-right align-top">
                            {assignedToMe ? (
                              <Button size="sm" onClick={() => void handleOpenTask(task)}>
                                {inProgress ? "Tiếp tục" : "Bắt đầu"} <ArrowRight className="h-3.5 w-3.5" />
                              </Button>
                            ) : canManageAssignment ? (
                              <Button size="sm" variant="outline" onClick={() => void handleOpenTask(task)}>Xem</Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                        {task.picking_task_id && expandedRepickTaskId === task.picking_task_id ? (
                          loadingRepickChildren ? (
                            <TableRow>
                              <TableCell className="whitespace-normal py-2 pl-10 text-[12px] text-muted-foreground">Đang tải đơn lấy bù...</TableCell>
                              {fillerCells()}
                            </TableRow>
                          ) : repickChildren.map((child) => (
                            <TableRow key={child.picking_task_id} className="bg-amber-50/30 hover:bg-amber-50/30 dark:bg-amber-500/5 dark:hover:bg-amber-500/5">
                              <TableCell className="whitespace-normal px-4 py-2 pl-10">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                                  <span className="font-mono font-semibold text-amber-800 dark:text-amber-300">{child.task_number}</span>
                                  <StatusBadge label={statusLabel(child.status)} variant={getPickingTaskStatusVariant(child.status)} />
                                  <span>{child.picking_task_items?.length ?? 0} dòng</span>
                                  <span>thiếu {child.picking_task_items?.reduce((sum, item) => sum + item.short_qty, 0) ?? 0} cuốn</span>
                                </div>
                              </TableCell>
                              {fillerCells()}
                            </TableRow>
                          ))
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span aria-live="polite">
                  {filteredTasks.length > 0 ? `Hiển thị ${pagedTasks.length} / ${filteredTasks.length} đơn` : "Không có đơn"}
                </span>
                {totalPages > 1 ? (
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(event) => { event.preventDefault(); setPage((current) => Math.max(1, current - 1)); }}
                          className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
                        />
                      </PaginationItem>
                      {getPaginationRange(page, totalPages).map((item, index) => (
                        <PaginationItem key={typeof item === "number" ? item : `${item}-${index}`}>
                          {typeof item === "number" ? (
                            <PaginationLink isActive={item === page} onClick={(event) => { event.preventDefault(); setPage(item); }} className="cursor-pointer">{item}</PaginationLink>
                          ) : (
                            <PaginationEllipsis />
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(event) => { event.preventDefault(); setPage((current) => Math.min(totalPages, current + 1)); }}
                          className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
