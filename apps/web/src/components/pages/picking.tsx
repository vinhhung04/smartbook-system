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
import { SectionCard } from "@/components/ui/section-card";
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
  if (orderType.startsWith("OUTBOUND_")) return "Xuất kho / cửa hàng";
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
    const route = [detail.source_warehouse_code || detail.source_warehouse_name, detail.target_warehouse_code || detail.target_warehouse_name].filter(Boolean).join(" → ");
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
    const checks: { label: string; done: boolean }[] = [
      { label: "Có mặt tại kho", done: presenceConfirmed },
      { label: "Đúng kệ", done: locationVerified },
      { label: "Đúng sách", done: productVerified },
    ];

    return (
      <PageWrapper className="space-y-5">
        <FadeItem>
          <header className="space-y-3">
            <button
              type="button"
              onClick={handleBackToList}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Danh sách đơn lấy hàng
            </button>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-mono text-[20px] font-semibold tracking-tight text-foreground">{detail.order_number}</h1>
                  {isRepick(detail.task_class) ? (
                    <StatusBadge label={detail.repick_sequence ? `Lấy bù #${detail.repick_sequence}` : "Lấy bù"} variant="warning" />
                  ) : null}
                </div>
                <p className="mt-1 text-[13px] text-muted-foreground">{[taskTypeLabel(detail.order_type), route].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="w-full min-w-[220px] sm:w-64">
                <div className="flex items-baseline justify-between text-[12px]">
                  <span className="text-muted-foreground">{completedLineCount}/{detail.lines.length} dòng</span>
                  <span className="font-semibold tabular-nums text-foreground">{totalPickedQty}/{totalRequestedQty} cuốn</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến độ lấy hàng">
                  <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>
          </header>
        </FadeItem>

        <FadeItem>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-4">
              {loadingDetail && !currentLine ? (
                <SectionCard><LoadingOverlay /></SectionCard>
              ) : done ? (
                <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 text-center dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <h2 className="mt-3 text-[18px] font-semibold text-foreground">Đã lấy đủ hàng</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {totalPickedQty} cuốn đã chuyển sang khu xuất hàng và đang chờ xác nhận xuất kho
                    {detail.completed_at ? ` · xong lúc ${formatDate(detail.completed_at)}` : ""}.
                  </p>
                  <Button className="mt-5" onClick={handleBackToList}>
                    <ArrowLeft className="h-4 w-4" /> Về danh sách đơn
                  </Button>
                </section>
              ) : currentLine ? (
                <section aria-labelledby="next-pick-title" className={cn("rounded-xl border border-border bg-card transition-opacity", loadingDetail && "opacity-60")}>
                  <div className="border-b border-border p-5">
                    <h2 id="next-pick-title" className="text-[12px] font-semibold text-muted-foreground">Lấy tiếp theo</h2>
                    <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                      <div className={cn(
                        "flex flex-col items-center justify-center rounded-lg border px-4 py-3",
                        locationVerified ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10" : "border-blue-200 bg-blue-50 dark:border-blue-500/20 dark:bg-blue-500/10",
                      )}>
                        <MapPin className={cn("h-4 w-4", locationVerified ? "text-emerald-600 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400")} aria-hidden="true" />
                        <span className="mt-1 text-[11px] text-muted-foreground">Kệ</span>
                        {currentLine.source_location_code ? (
                          <span className="font-mono text-[20px] font-bold leading-tight text-foreground">{currentLine.source_location_code}</span>
                        ) : (
                          <span className="text-[13px] font-semibold leading-tight text-muted-foreground">Chưa gán</span>
                        )}
                      </div>
                      <div className="min-w-0 self-center">
                        <p className="text-[17px] font-semibold leading-snug text-foreground">{currentLine.book_title}</p>
                        <p className="mt-1 truncate font-mono text-[12px] text-muted-foreground">
                          {[currentLine.isbn13 || currentLine.barcode, currentLine.sku].filter(Boolean).join(" · ") || "—"}
                        </p>
                        {currentLine.note ? <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-400">Ghi chú: {currentLine.note}</p> : null}
                      </div>
                      <div className="col-span-2 flex items-baseline gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-center sm:gap-0">
                        <span className="text-[11px] text-muted-foreground">Cần lấy</span>
                        <span className="text-[32px] font-bold leading-none text-foreground">{currentLine.remaining_qty}</span>
                        <span className="text-[12px] text-muted-foreground">
                          {currentLine.picked_qty > 0 ? `đã lấy ${currentLine.picked_qty}/${currentLine.requested_qty}` : "cuốn"}
                        </span>
                      </div>
                    </div>
                    {isRepick(detail.task_class) && currentLine.repick_line?.missing_qty ? (
                      <p className="mt-3 text-[12px] text-amber-700 dark:text-amber-400">
                        Lấy bù phần thiếu {currentLine.repick_line.missing_qty} cuốn từ đơn {detail.parent_order_number || detail.root_order_number || "gốc"}.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-4 p-5">
                    <ol className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Các bước kiểm tra">
                      {checks.map((check) => (
                        <li key={check.label} className={cn("inline-flex items-center gap-1.5 text-[13px]", check.done ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                          {check.done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Circle className="h-4 w-4" aria-hidden="true" />}
                          {check.label}
                        </li>
                      ))}
                    </ol>

                    {scanStep !== "quantity" ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          handleScan(scanInput);
                        }}
                        className="space-y-2"
                      >
                        <label htmlFor="picking-scan" className="block text-[14px] font-semibold text-foreground">{SCAN_TITLES[scanStep]}</label>
                        <p className="text-[13px] text-muted-foreground">{stepHint[scanStep]}</p>
                        <div className="flex gap-2">
                          <Input
                            id="picking-scan"
                            value={scanInput}
                            onChange={(event) => setScanInput(event.target.value)}
                            placeholder={scanStep === "product" ? "Mã vạch / ISBN / SKU" : "Mã vị trí hoặc barcode kệ"}
                            autoComplete="off"
                            className="h-14 min-w-0 flex-1 font-mono text-[16px]"
                          />
                          <IconButton type="button" variant="outline" onClick={() => setCameraOpen(true)} label="Quét bằng camera" className="h-14 w-14 shrink-0">
                            <ScanLine className="h-5 w-5" />
                          </IconButton>
                          <Button type="submit" loading={confirmingPresence || loadingLookup} className="h-14 px-5 text-[15px]">
                            Xác nhận
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-[14px] font-semibold text-foreground">Số cuốn đã lấy</p>
                        <p className="text-[13px] text-muted-foreground">{stepHint.quantity}</p>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center rounded-lg border border-border">
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
                              className="h-14 w-20 border-0 text-center text-[20px] font-semibold shadow-none focus-visible:ring-0"
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
                          <p className="text-[12px] text-amber-700 dark:text-amber-400">Lấy ít hơn số cần: phần còn lại vẫn ở dòng này để lấy tiếp hoặc khai báo thiếu.</p>
                        ) : null}
                      </div>
                    )}

                    {ambiguousMatches.length > 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                        <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-300">Mã vạch trùng nhiều sách — chọn đúng cuốn trên tay:</p>
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
                          <SelectTrigger className="mt-2 w-full text-[13px]">
                            <SelectValue placeholder="Chọn sách" />
                          </SelectTrigger>
                          <SelectContent>
                            {ambiguousMatches.map((match) => (
                              <SelectItem key={match.variant_id} value={match.variant_id}>
                                {match.book_title} · {match.sku || match.internal_barcode || match.isbn13 || match.isbn10}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : (
                <SectionCard>
                  <EmptyState variant="no-data" title="Không tìm thấy dòng cần lấy tiếp" description="Tải lại đơn hoặc quay về danh sách." />
                </SectionCard>
              )}
            </div>

            <aside aria-labelledby="pick-list-title" className="lg:sticky lg:top-20 lg:self-start">
              <section className="rounded-xl border border-border bg-card">
                <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
                  <h2 id="pick-list-title" className="text-[14px] font-semibold text-foreground">Danh sách cần lấy</h2>
                  <span className="text-[12px] text-muted-foreground">theo lộ trình</span>
                </div>
                <ol className="max-h-[60vh] overflow-y-auto">
                  {detail.lines.map((line) => {
                    const lineDone = Number(line.picked_qty || 0) >= Number(line.requested_qty || 0);
                    const isCurrent = !done && currentLine?.line_id === line.line_id;
                    return (
                      <li
                        key={line.line_id}
                        aria-current={isCurrent ? "step" : undefined}
                        className={cn("flex items-start gap-3 border-b border-border px-4 py-3 last:border-0", isCurrent && "bg-blue-50/70 dark:bg-blue-500/[0.07]")}
                      >
                        {lineDone ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Đã lấy" />
                        ) : isCurrent ? (
                          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-label="Đang lấy" />
                        ) : (
                          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-label="Chưa lấy" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-[13px]", lineDone ? "text-muted-foreground line-through decoration-muted-foreground/40" : "font-medium text-foreground")} title={line.book_title}>{line.book_title}</p>
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
                          <Button size="sm" onClick={() => void handleDeclareShortage()} loading={declaringShortage} className="bg-orange-600 text-white hover:bg-orange-700">
                            Xác nhận thiếu hàng
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setShowShortageConfirm(false)} disabled={declaringShortage}>Hủy</Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowShortageConfirm(true)}
                        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-orange-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/30 dark:text-orange-400"
                      >
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Kệ không đủ hàng? Khai báo thiếu
                      </button>
                    )}
                  </div>
                ) : null}
              </section>
            </aside>
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

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Package}
          title="Lấy hàng"
          description={canManageAssignment ? "Giao đơn cho nhân viên kho và theo dõi tiến độ lấy hàng." : "Các đơn lấy hàng được giao cho bạn."}
          iconBg="bg-blue-100 dark:bg-blue-500/15"
          iconColor="text-blue-600 dark:text-blue-400"
        />
      </FadeItem>

      <FadeItem>
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Mã đơn, kho hoặc loại đơn"
          showSearchClear
          filters={(
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
              {canManageAssignment ? (
                <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
                  <SelectTrigger className="w-full sm:w-[240px]" aria-label="Kho nguồn" title="Đơn chuyển kho hiện ở kho nguồn.">
                    <SelectValue placeholder="Chọn kho" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_WAREHOUSES}>Tất cả kho</SelectItem>
                    {warehouses.map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <div className="max-w-full overflow-x-auto">
                <SegmentedControl
                  options={[
                    { value: "ALL", label: `Tất cả (${taskStats.total})` },
                    { value: "PICK", label: `Lấy hàng (${taskStats.pick})` },
                    { value: "REPICK", label: `Lấy bù (${taskStats.repick})` },
                  ]}
                  value={taskClassFilter}
                  onChange={(v) => setTaskClassFilter(v as "ALL" | "PICK" | "REPICK")}
                  layoutId="picking-class-filter"
                  className="w-max"
                />
              </div>
            </div>
          )}
        />
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-3 text-[13px] text-muted-foreground">
            <span><span className="font-semibold text-foreground">{taskStats.total}</span> đơn</span>
            {taskStats.mine > 0 ? <span><span className="font-semibold text-foreground">{taskStats.mine}</span> giao cho bạn</span> : null}
            {taskStats.unassigned > 0 ? (
              <span className="font-medium text-rose-600 dark:text-rose-400">{taskStats.unassigned} chưa giao cho ai</span>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {[
                    { label: "Đơn hàng", className: "" },
                    { label: "Cần lấy", className: "hidden w-[110px] sm:table-cell" },
                    { label: "Người lấy", className: "hidden w-[270px] md:table-cell" },
                    { label: "Yêu cầu lúc", className: "hidden w-[130px] xl:table-cell" },
                    { label: "", className: "w-[130px]" },
                  ].map((head, index) => (
                    <TableHead key={index} className={cn("px-4 text-[12px] font-medium text-muted-foreground", head.className)}>{head.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedTasks.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="whitespace-normal py-10 text-center">
                      <EmptyState
                        variant="no-data"
                        title={tasks.length === 0 ? "Chưa có đơn nào cần lấy" : "Không có đơn khớp bộ lọc"}
                        description={tasks.length === 0 ? "Đơn xuất kho hoặc chuyển kho đã duyệt sẽ hiện ở đây." : "Thử đổi kho, loại đơn hoặc từ khóa."}
                      />
                    </TableCell>
                  </TableRow>
                ) : pagedTasks.map((task) => {
                  const key = `${task.task_type}:${task.task_id}`;
                  const assignedToMe = Boolean(task.assigned_picker_user_id) && task.assigned_picker_user_id === currentUserId;
                  const isAssigned = Boolean(task.assigned_picker_user_id);
                  const selectedPickerId = assigningPickerIdByTask[key] || "";
                  const assignedPickerName = task.assigned_picker_user_id
                    ? staffNameById.get(task.assigned_picker_user_id) || (assignedToMe ? currentUserLabel : `Nhân viên ${task.assigned_picker_user_id.slice(0, 8)}`)
                    : "";
                  const repick = isRepick(task.task_class);
                  const route = [task.source_warehouse_code || task.source_warehouse_name, task.target_warehouse_code || task.target_warehouse_name].filter(Boolean).join(" → ");
                  const inProgress = task.remaining_quantity < task.total_quantity;

                  // Assignment control lives with the assignee column; on narrow screens that
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
                      <Button size="sm" variant="success-outline" onClick={() => void handleAssignTask(task)} disabled={!selectedPickerId} loading={claimingTaskKey === key}>
                        <UserCheck className="h-3.5 w-3.5" /> Giao
                      </Button>
                    </div>
                  ) : null;

                  return (
                    <React.Fragment key={key}>
                      <TableRow className={cn("hover:bg-muted/50", assignedToMe && "bg-blue-50/40 dark:bg-blue-500/[0.05]")}>
                        <TableCell className="px-4 py-3 align-top">
                          <p className="truncate font-mono text-[13px] font-semibold" title={task.order_number}>{task.order_number}</p>
                          <p className="truncate text-[12px] text-muted-foreground" title={route || undefined}>
                            {[taskTypeLabel(task.order_type), route].filter(Boolean).join(" · ")}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <StatusBadge label={statusLabel(task.status)} variant={getPickingTaskStatusVariant(task.status)} dot />
                            {repick ? <StatusBadge label={task.repick_sequence ? `Lấy bù #${task.repick_sequence}` : "Lấy bù"} variant="warning" /> : null}
                            {assignedToMe ? <StatusBadge label="Của bạn" variant="info" /> : null}
                            {!repick && (task.repick_count ?? 0) > 0 && task.picking_task_id ? (
                              <button
                                type="button"
                                onClick={() => void toggleRepickChildren(task.picking_task_id!)}
                                className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/15"
                                aria-label={`Xem ${task.repick_count} đơn lấy bù của ${task.order_number}`}
                                aria-expanded={expandedRepickTaskId === task.picking_task_id}
                              >
                                {task.repick_count} đơn lấy bù
                                {expandedRepickTaskId === task.picking_task_id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-[12px] text-muted-foreground sm:hidden">
                            Còn <span className="font-semibold text-foreground">{task.remaining_quantity}</span> cuốn · {task.line_count} dòng
                          </p>
                          <div className="mt-2 md:hidden">
                            {assignment ?? <p className="text-[12px] text-muted-foreground">{isAssigned ? `Người lấy: ${assignedPickerName}` : "Chưa giao"}</p>}
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 align-top sm:table-cell">
                          <p className="text-[13px] font-semibold tabular-nums">{task.remaining_quantity}<span className="ml-1 text-[12px] font-normal text-muted-foreground">cuốn</span></p>
                          <p className="text-[12px] text-muted-foreground">{task.line_count} dòng</p>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 align-top md:table-cell">
                          {assignment ?? <p className={cn("text-[13px]", isAssigned ? "text-foreground" : "text-muted-foreground")}>{isAssigned ? assignedPickerName : "Chưa giao"}</p>}
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 align-top text-[12px] tabular-nums text-muted-foreground xl:table-cell">{formatDate(task.requested_at)}</TableCell>
                        <TableCell className="px-4 py-3 text-right align-top">
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
                            <TableCell colSpan={5} className="py-2 pl-10 text-[12px] text-muted-foreground">Đang tải…</TableCell>
                          </TableRow>
                        ) : repickChildren.map((child) => (
                          <TableRow key={child.picking_task_id} className="bg-amber-50/30 hover:bg-amber-50/30 dark:bg-amber-500/5 dark:hover:bg-amber-500/5">
                            <TableCell colSpan={5} className="px-4 py-2 pl-10">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                                <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">↳ {child.task_number}</span>
                                <StatusBadge label={statusLabel(child.status)} variant={getPickingTaskStatusVariant(child.status)} />
                                <span>{child.picking_task_items?.length ?? 0} dòng</span>
                                <span>thiếu {child.picking_task_items?.reduce((sum, item) => sum + item.short_qty, 0) ?? 0} cuốn</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {filteredTasks.length > 0 && totalPages > 1 ? (
            <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-muted-foreground">
                Hiển thị <span className="font-medium text-foreground">{pagedTasks.length}</span> / {filteredTasks.length} đơn
              </p>
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
            </div>
          ) : null}
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
