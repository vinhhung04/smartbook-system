import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Check, CheckCircle2, Clock, Inbox, ListOrdered, Loader2,
  Package, Plus, Search, Send, ShieldAlert, X,
} from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { getApiErrorMessage } from "@/services/api.ts";
import { authService } from "@/services/auth";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import {
  orderRequestService,
  type OutboundReferenceType,
  type OrderRequestSummary,
  type OrderRequestVariant,
  type RequestTaskType,
} from "@/services/order-requests";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-state";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";

type RequestType = "outbound" | "transfer";
type PageTab = "queue" | "compose";
type StatusFilter = "all" | "pending" | "approved" | "rejected";
type TypeFilter = "all" | "outbound" | "transfer";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

const OUTBOUND_REFERENCE_GROUPS: Array<{
  label: string;
  options: Array<{ value: OutboundReferenceType; label: string }>;
}> = [
  {
    label: "Bán hàng & khách hàng",
    options: [
      { value: "SALES_ORDER", label: "Xuất theo đơn bán hàng" },
      { value: "RESERVATION", label: "Xuất cho đơn đặt trước" },
      { value: "PROMOTION", label: "Xuất theo khuyến mãi/tặng" },
    ],
  },
  {
    label: "Nội bộ & thư viện",
    options: [
      { value: "INTERNAL_REQUEST", label: "Xuất theo yêu cầu nội bộ" },
      { value: "ISSUE_REQUEST", label: "Xuất theo phiếu cấp phát" },
      { value: "LOAN_REQUEST", label: "Xuất cho phiếu mượn thư viện" },
      { value: "MAINTENANCE", label: "Xuất để bảo trì/kiểm kê" },
    ],
  },
  {
    label: "Kho & nhà cung cấp",
    options: [
      { value: "TRANSFER_TO_STORE", label: "Xuất hàng tới cửa hàng bán lẻ" },
      { value: "WAREHOUSE_TRANSFER", label: "Điều chuyển giữa kho" },
      { value: "RETURN_TO_SUPPLIER", label: "Trả hàng nhà cung cấp" },
      { value: "INVENTORY_ADJUSTMENT", label: "Xuất do điều chỉnh tồn kho" },
      { value: "DAMAGED_RETURN", label: "Xuất hàng lỗi/hỏng" },
    ],
  },
  {
    label: "Khác",
    options: [{ value: "OTHER", label: "Khác" }],
  },
];

const PAGE_SIZE = 10;

type DraftLine = {
  isbn13: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
};

type PendingAction = {
  taskType: RequestTaskType;
  taskId: string;
  mode: "approve" | "reject";
  orderNumber: string;
  totalQuantity: number;
};

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

function canApproveRequests(): boolean {
  const user = authService.getCurrentUser();
  if (user?.is_superuser) return true;

  const permissions = Array.isArray(user?.permissions)
    ? user.permissions.map((permission) => String(permission || "").trim())
    : [];
  if (permissions.includes("inventory.purchase.approve")) {
    return true;
  }

  const roles = Array.isArray(user?.roles) ? user.roles.map((role) => String(role || "").toUpperCase()) : [];
  return roles.includes("ADMIN") || roles.includes("WAREHOUSE_MANAGER");
}

function getTransferInsufficientStockDescription(error: unknown): string | null {
  const maybe = error as {
    response?: {
      data?: {
        details?: {
          shortages?: Array<{
            isbn13?: string | null;
            sku?: string | null;
            variant_id?: string;
            shortage_qty?: number;
            required_qty?: number;
            available_qty?: number;
          }>;
        };
      };
    };
  };

  const shortages = maybe?.response?.data?.details?.shortages;
  if (!Array.isArray(shortages) || shortages.length === 0) {
    return null;
  }

  return shortages
    .slice(0, 3)
    .map((item) => `${item.isbn13 || item.sku || item.variant_id || "N/A"}: còn ${item.available_qty || 0}, cần ${item.required_qty || 0}, thiếu ${item.shortage_qty || 0}`)
    .join(" | ");
}

function requestAgingPriority(requestedAt: string): Priority {
  const requestedDate = new Date(requestedAt);
  if (Number.isNaN(requestedDate.getTime())) return "LOW";
  const hoursWaited = (Date.now() - requestedDate.getTime()) / (1000 * 60 * 60);
  if (hoursWaited >= 72) return "URGENT";
  if (hoursWaited >= 24) return "HIGH";
  if (hoursWaited >= 4) return "MEDIUM";
  return "LOW";
}

function statusBadgeVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" | "cyan" {
  const upper = String(status || "").toUpperCase();
  if (upper.includes("APPROVED") || upper.includes("COMPLETED") || upper.includes("READY")) return "success";
  if (upper.includes("REJECT") || upper.includes("CANCEL")) return "danger";
  if (upper.includes("PENDING") || upper.includes("REQUESTED")) return "warning";
  if (upper.includes("PICK")) return "info";
  return "neutral";
}

function requestStatusLabel(status: string): string {
  const upper = String(status || "").toUpperCase();
  if (upper.includes("REJECT")) return "Bị từ chối";
  if (upper.includes("CANCEL")) return "Đã hủy";
  if (upper.includes("PENDING") || upper.includes("REQUESTED")) return "Chờ duyệt";
  if (upper.includes("COMPLETED")) return "Hoàn tất";
  if (upper.includes("PICK")) return "Đang lấy hàng";
  if (upper.includes("READY")) return "Sẵn sàng";
  if (upper.includes("APPROVED")) return "Đã duyệt";
  return status;
}

function isPendingStatus(status: string): boolean {
  const upper = String(status || "").toUpperCase();
  return upper.includes("PENDING") || upper.includes("REQUESTED");
}

function isApprovedStatus(status: string): boolean {
  const upper = String(status || "").toUpperCase();
  return upper.includes("APPROVED") || upper.includes("COMPLETED") || upper.includes("READY");
}

function isRejectedStatus(status: string): boolean {
  const upper = String(status || "").toUpperCase();
  return upper.includes("REJECT") || upper.includes("CANCEL");
}

function orderTypeMeta(type: string): { label: string; variant: "info" | "violet" } {
  const upper = String(type || "").toUpperCase();
  if (upper.includes("TRANSFER")) return { label: "Điều chuyển", variant: "violet" };
  return { label: "Xuất kho", variant: "info" };
}

export function OrderRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [activeTab, setActiveTab] = useState<PageTab>("queue");

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [targetWarehouseId, setTargetWarehouseId] = useState("");

  const [requestType, setRequestType] = useState<RequestType>("outbound");
  const [requestNote, setRequestNote] = useState("");
  const [referenceType, setReferenceType] = useState<OutboundReferenceType>("SALES_ORDER");
  const [externalReference, setExternalReference] = useState("");
  const [loadingReferenceCode, setLoadingReferenceCode] = useState(false);
  const [referencePreviewRefreshKey, setReferencePreviewRefreshKey] = useState(0);

  const [variantQuery, setVariantQuery] = useState("");
  const [searchingVariant, setSearchingVariant] = useState(false);
  const [variantResults, setVariantResults] = useState<OrderRequestVariant[]>([]);

  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [assignedPickerUserId, setAssignedPickerUserId] = useState("");
  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);

  const [listView, setListView] = useState<"my" | "approval">(() => (canApproveRequests() ? "approval" : "my"));
  const [requests, setRequests] = useState<OrderRequestSummary[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [page, setPage] = useState(1);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const canApprove = canApproveRequests();

  const filteredWarehouses = useMemo(() => {
    if (!selectedWarehouseId || requestType !== "transfer") return warehouses;
    return warehouses.filter((warehouse) => warehouse.id !== selectedWarehouseId);
  }, [warehouses, requestType, selectedWarehouseId]);

  const requestStats = useMemo(() => {
    const total = requests.length;
    const pending = requests.filter((row) => isPendingStatus(row.status)).length;
    const approved = requests.filter((row) => isApprovedStatus(row.status)).length;
    const urgent = requests.filter(
      (row) => isPendingStatus(row.status) && requestAgingPriority(row.requested_at) === "URGENT",
    ).length;
    const totalQuantity = requests.reduce((sum, row) => sum + (row.total_quantity || 0), 0);
    return { total, pending, approved, urgent, totalQuantity };
  }, [requests]);

  const draftTotalQuantity = useMemo(
    () => draftLines.reduce((sum, line) => sum + (line.quantity || 0), 0),
    [draftLines],
  );

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((row) => {
      if (typeFilter !== "all" && row.task_type !== typeFilter) return false;
      if (statusFilter === "pending" && !isPendingStatus(row.status)) return false;
      if (statusFilter === "approved" && !isApprovedStatus(row.status)) return false;
      if (statusFilter === "rejected" && !isRejectedStatus(row.status)) return false;
      if (query) {
        const haystack = `${row.order_number} ${row.source_warehouse_code || ""} ${row.target_warehouse_code || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [requests, search, statusFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));

  const pagedRequests = useMemo(
    () => filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRequests, page],
  );

  const loadRequests = async (view: "my" | "approval", warehouseId?: string) => {
    const response = await orderRequestService.listRequests(view, warehouseId);
    setRequests(response.data || []);
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const warehouseRows = await warehouseService.getAll();
        const rows = Array.isArray(warehouseRows) ? warehouseRows : [];

        setWarehouses(rows);

        const currentUser = authService.getCurrentUser() as { primary_warehouse_id?: string } | null;
        const preferredWarehouse = rows.find((row) => row.id === currentUser?.primary_warehouse_id)?.id || rows[0]?.id || "";

        setSelectedWarehouseId(preferredWarehouse);
        setTargetWarehouseId(rows.find((row) => row.id !== preferredWarehouse)?.id || "");

        if (canApprove) {
          const staffRes = await userService.getWarehouseStaff();
          setWarehouseStaff(Array.isArray(staffRes.data) ? staffRes.data : []);
        }

        await loadRequests(canApprove ? "approval" : "my", canApprove ? undefined : (preferredWarehouse || undefined));
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được dữ liệu yêu cầu xuất kho"));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [canApprove]);

  useEffect(() => {
    if (!selectedWarehouseId) return;

    const warehouseFilter = listView === "approval" ? undefined : selectedWarehouseId;

    void loadRequests(listView, warehouseFilter).catch((error) => {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách yêu cầu"));
    });
  }, [listView, selectedWarehouseId]);

  useEffect(() => {
    if (requestType !== "outbound") return;

    let cancelled = false;
    setLoadingReferenceCode(true);
    setExternalReference("");

    orderRequestService.previewOutboundReferenceCode(referenceType)
      .then((response) => {
        if (!cancelled) {
          setExternalReference(response.data.external_reference);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(getApiErrorMessage(error, "Không tạo được mã tham chiếu"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingReferenceCode(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [referencePreviewRefreshKey, referenceType, requestType]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, typeFilter, listView]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const handleSearchVariant = async () => {
    const q = variantQuery.trim();
    if (q.length < 2) {
      toast.error("Nhập ít nhất 2 ký tự để tìm sách");
      return;
    }

    try {
      setSearchingVariant(true);
      const response = await orderRequestService.searchVariants(q);
      setVariantResults(response.data || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tìm được sách"));
    } finally {
      setSearchingVariant(false);
    }
  };

  const handleAddLine = (variant: OrderRequestVariant) => {
    const isbn13 = String(variant.isbn13 || "").trim();
    if (!isbn13 || !/^\d{13}$/.test(isbn13)) {
      toast.error("Chỉ thêm được sách có ISBN-13 hợp lệ");
      return;
    }

    setDraftLines((prev) => {
      const found = prev.find((line) => line.isbn13 === isbn13);
      if (found) {
        return prev.map((line) => (
          line.isbn13 === isbn13
            ? { ...line, quantity: line.quantity + 1 }
            : line
        ));
      }

      return [
        ...prev,
        {
          isbn13,
          title: variant.title,
          sku: variant.sku,
          barcode: variant.isbn13 || variant.barcode,
          quantity: 1,
        },
      ];
    });
  };

  const handleQuantityChange = (isbn13: string, value: number) => {
    setDraftLines((prev) => prev.map((line) => (
      line.isbn13 === isbn13
        ? { ...line, quantity: Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1 }
        : line
    )));
  };

  const handleRemoveLine = (isbn13: string) => {
    setDraftLines((prev) => prev.filter((line) => line.isbn13 !== isbn13));
  };

  const resetForm = () => {
    setRequestNote("");
    setReferenceType("SALES_ORDER");
    setExternalReference("");
    setReferencePreviewRefreshKey((prev) => prev + 1);
    setVariantQuery("");
    setVariantResults([]);
    setDraftLines([]);
    setAssignedPickerUserId("");
  };

  const handleSubmitRequest = async () => {
    if (!selectedWarehouseId) {
      toast.error("Chọn kho nguồn trước");
      return;
    }

    if (draftLines.length === 0) {
      toast.error("Yêu cầu cần ít nhất 1 dòng sách");
      return;
    }

    try {
      setSubmitting(true);

      if (requestType === "outbound") {
        await orderRequestService.createOutboundRequest({
          warehouse_id: selectedWarehouseId,
          outbound_type: "MANUAL",
          reference_type: referenceType,
          note: requestNote.trim() || null,
          lines: draftLines.map((line) => ({
            isbn13: line.isbn13,
            quantity: Math.max(1, Math.trunc(line.quantity || 0)),
          })),
          assigned_picker_user_id: assignedPickerUserId || null,
        });
      } else {
        if (!targetWarehouseId) {
          toast.error("Chọn kho đích cho điều chuyển");
          return;
        }

        await orderRequestService.createTransferRequest({
          from_warehouse_id: selectedWarehouseId,
          to_warehouse_id: targetWarehouseId,
          note: requestNote.trim() || null,
          lines: draftLines.map((line) => ({
            isbn13: line.isbn13,
            quantity: Math.max(1, Math.trunc(line.quantity || 0)),
          })),
          assigned_picker_user_id: assignedPickerUserId || null,
        });
      }

      toast.success("Đã tạo yêu cầu");
      resetForm();
      setListView("my");
      await loadRequests("my", selectedWarehouseId || undefined);
      setActiveTab("queue");
    } catch (error) {
      const message = getApiErrorMessage(error, "Tạo yêu cầu thất bại");
      const shortageDescription = getTransferInsufficientStockDescription(error);

      if (shortageDescription) {
        toast.error(message, { description: shortageDescription });
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openActionDialog = (row: OrderRequestSummary, mode: "approve" | "reject") => {
    setPendingAction({
      taskType: row.task_type,
      taskId: row.task_id,
      mode,
      orderNumber: row.order_number,
      totalQuantity: row.total_quantity,
    });
    setRejectReason("");
  };

  const closeActionDialog = () => {
    if (actionSubmitting) return;
    setPendingAction(null);
    setRejectReason("");
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;

    try {
      setActionSubmitting(true);

      if (pendingAction.mode === "approve") {
        await orderRequestService.approveRequest(pendingAction.taskType, pendingAction.taskId);
        toast.success("Đã duyệt yêu cầu");
      } else {
        await orderRequestService.rejectRequest(pendingAction.taskType, pendingAction.taskId, rejectReason.trim() || undefined);
        toast.success("Đã từ chối yêu cầu");
      }

      const warehouseFilter = listView === "approval" ? undefined : (selectedWarehouseId || undefined);
      await loadRequests(listView, warehouseFilter);
      setPendingAction(null);
      setRejectReason("");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cập nhật yêu cầu thất bại"));
    } finally {
      setActionSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <div className="flex min-h-[40vh] items-center justify-center">
          <LoadingSpinner message="Đang tải yêu cầu xuất kho…" className="flex-col gap-3 text-[13px]" />
        </div>
      </PageWrapper>
    );
  }

  // Plain counts (no hooks: this runs after the loading early return).
  const statusCounts: Record<StatusFilter, number> = {
    all: requests.length,
    pending: requests.filter((row) => isPendingStatus(row.status)).length,
    approved: requests.filter((row) => isApprovedStatus(row.status)).length,
    rejected: requests.filter((row) => isRejectedStatus(row.status)).length,
  };
  const typeCounts: Record<TypeFilter, number> = {
    all: requests.length,
    outbound: requests.filter((row) => row.task_type === "outbound").length,
    transfer: requests.filter((row) => row.task_type === "transfer").length,
  };
  const sourceWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);
  const targetWarehouse = warehouses.find((w) => w.id === targetWarehouseId);
  const referenceLabel = OUTBOUND_REFERENCE_GROUPS.flatMap((group) => group.options).find((o) => o.value === referenceType)?.label;
  const pickerName = warehouseStaff.find((s) => s.id === assignedPickerUserId)?.full_name;

  const lede = requests.length === 0
    ? "Chưa có yêu cầu nào trong danh sách này."
    : `${requestStats.total} yêu cầu, ${requestStats.pending} chờ duyệt${requestStats.urgent > 0 ? `, ${requestStats.urgent} đã chờ quá 3 ngày` : ""}.`;

  const railButton = (active: boolean, onClick: () => void, label: string, count: number, attention = false) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-primary/[0.08] text-primary" : "text-foreground hover:bg-muted/60",
      )}
    >
      <span className={cn("text-[13px]", active ? "font-semibold" : "font-medium")}>{label}</span>
      <span
        className={cn(
          "min-w-6 rounded-full px-1.5 text-center text-[12px] tabular-nums",
          attention && count > 0 ? "bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );

  const chip = (active: boolean, onClick: () => void, label: string, count: number, attention = false) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "border-primary/30 bg-primary/[0.08] font-semibold text-primary" : "border-border bg-card font-medium hover:bg-muted/60",
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
      <span className={cn("tabular-nums", attention && count > 0 ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{count}</span>
    </button>
  );

  const STATUS_ITEMS: Array<{ value: StatusFilter; label: string; attention?: boolean }> = [
    { value: "all", label: "Tất cả" },
    { value: "pending", label: "Chờ duyệt", attention: true },
    { value: "approved", label: "Đã duyệt" },
    { value: "rejected", label: "Bị từ chối" },
  ];
  const TYPE_ITEMS: Array<{ value: TypeFilter; label: string }> = [
    { value: "all", label: "Mọi loại" },
    { value: "outbound", label: "Xuất kho" },
    { value: "transfer", label: "Điều chuyển" },
  ];

  if (activeTab === "compose") {
    return (
      <PageWrapper className="space-y-6">
        <FadeItem>
          <Button variant="ghost" size="sm" onClick={() => setActiveTab("queue")} className="-ml-3 mb-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Danh sách yêu cầu
          </Button>
          <PageHeader
            title="Tạo yêu cầu mới"
            description="Chọn kho và sách cần xuất. Yêu cầu chờ quản lý duyệt rồi mới chuyển sang bước lấy hàng."
          />
        </FadeItem>

        <FadeItem>
          <div className="@container/page">
            <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-4">
                <section aria-labelledby="request-step-1" className="rounded-2xl border border-border bg-card p-5">
                  <h2 id="request-step-1" className="flex items-center gap-2.5 font-serif text-[18px] font-semibold tracking-tight">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground" aria-hidden="true">1</span>
                    Loại yêu cầu và kho
                  </h2>

                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <SegmentedControl
                        options={[
                          { value: "outbound", label: "Xuất kho" },
                          { value: "transfer", label: "Điều chuyển kho" },
                        ]}
                        value={requestType}
                        onChange={(v) => setRequestType(v as RequestType)}
                        layoutId="order-request-type"
                      />
                      <span className="text-[13px] text-muted-foreground">
                        {requestType === "transfer" ? "Chuyển hàng từ kho này sang kho khác." : "Xuất hàng ra khỏi kho theo một lý do cụ thể."}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 @xl/page:grid-cols-2">
                      <div className="space-y-1.5">
                        <label htmlFor="request-source" className="text-[13px] font-medium">Kho nguồn</label>
                        <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
                          <SelectTrigger id="request-source" className="w-full">
                            <SelectValue placeholder="Chọn kho nguồn" />
                          </SelectTrigger>
                          <SelectContent>
                            {warehouses.map((warehouse) => (
                              <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {requestType === "transfer" ? (
                        <div className="space-y-1.5">
                          <label htmlFor="request-target" className="text-[13px] font-medium">Kho đích</label>
                          <Select value={targetWarehouseId} onValueChange={setTargetWarehouseId}>
                            <SelectTrigger id="request-target" className="w-full">
                              <SelectValue placeholder="Chọn kho đích" />
                            </SelectTrigger>
                            <SelectContent>
                              {filteredWarehouses.map((warehouse) => (
                                <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <label htmlFor="request-reason" className="text-[13px] font-medium">Lý do xuất</label>
                          <Select value={referenceType} onValueChange={(v) => setReferenceType(v as OutboundReferenceType)}>
                            <SelectTrigger id="request-reason" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {OUTBOUND_REFERENCE_GROUPS.map((group) => (
                                <SelectGroup key={group.label}>
                                  <SelectLabel>{group.label}</SelectLabel>
                                  {group.options.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectGroup>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    {canApprove && warehouseStaff.length > 0 && (
                      <div className="space-y-1.5">
                        <label htmlFor="request-picker" className="text-[13px] font-medium">Nhân viên lấy hàng <span className="font-normal text-muted-foreground">(không bắt buộc)</span></label>
                        <Select value={assignedPickerUserId || "none"} onValueChange={(v) => setAssignedPickerUserId(v === "none" ? "" : v)}>
                          <SelectTrigger id="request-picker" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Chưa giao, giao sau ở bước Lấy hàng</SelectItem>
                            {warehouseStaff.map((staff) => (
                              <SelectItem key={staff.id} value={staff.id}>
                                {staff.full_name} ({staff.username})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label htmlFor="request-note" className="text-[13px] font-medium">Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span></label>
                      <Textarea
                        id="request-note"
                        value={requestNote}
                        onChange={(event) => setRequestNote(event.target.value)}
                        rows={2}
                        className="resize-y"
                        placeholder="Lý do tạo yêu cầu, ghi chú cho người duyệt"
                      />
                    </div>
                  </div>
                </section>

                <section aria-labelledby="request-step-2" className="rounded-2xl border border-border bg-card p-5">
                  <h2 id="request-step-2" className="flex items-center gap-2.5 font-serif text-[18px] font-semibold tracking-tight">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground" aria-hidden="true">2</span>
                    Sách cần {requestType === "transfer" ? "điều chuyển" : "xuất"}
                  </h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">Tìm theo ISBN-13, SKU hoặc tên sách, rồi thêm vào yêu cầu.</p>

                  <div className="mt-4 flex flex-col gap-2 @xl/page:flex-row">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <Input
                        value={variantQuery}
                        onChange={(event) => setVariantQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleSearchVariant();
                          }
                        }}
                        aria-label="Tìm sách để thêm"
                        placeholder="ISBN-13, SKU hoặc tên sách"
                        className="rounded-full pl-9"
                      />
                    </div>
                    <Button type="button" onClick={() => void handleSearchVariant()} disabled={searchingVariant} loading={searchingVariant} className="shrink-0">
                      Tìm sách
                    </Button>
                  </div>

                  {variantResults.length > 0 && (
                    <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border" aria-label="Kết quả tìm sách">
                      {variantResults.map((variant) => {
                        const inDraft = draftLines.find((line) => line.isbn13 === String(variant.isbn13 || "").trim());
                        return (
                          <li key={variant.variant_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-[13.5px] font-semibold text-foreground" title={variant.title}>{variant.title}</p>
                              <p className="truncate text-[12px] text-muted-foreground">
                                <span className="font-mono">{variant.isbn13 || "Không có ISBN"}</span>
                                {variant.sku ? <span className="ml-2">SKU {variant.sku}</span> : null}
                                {inDraft ? <span className="ml-2 text-primary">Đã có {inDraft.quantity} trong yêu cầu</span> : null}
                              </p>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={() => handleAddLine(variant)} className="shrink-0">
                              <Plus className="h-3.5 w-3.5" /> Thêm
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="mt-4">
                    {draftLines.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
                        <p className="text-[14px] font-semibold">Chưa có sách nào trong yêu cầu</p>
                        <p className="mt-1 text-[13px] text-muted-foreground">Tìm một cuốn ở trên rồi bấm "Thêm".</p>
                      </div>
                    ) : (
                      <table className="w-full table-fixed">
                        <thead>
                          <tr className="border-b border-border">
                            <th scope="col" className="py-2 pr-3 text-left text-[12px] font-medium text-muted-foreground">Sách</th>
                            <th scope="col" className="w-[112px] px-3 py-2 text-left text-[12px] font-medium text-muted-foreground">Số lượng</th>
                            <th scope="col" className="w-12 py-2"><span className="sr-only">Xóa</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {draftLines.map((line) => (
                            <tr key={line.isbn13} className="border-b border-border last:border-0">
                              <td className="py-2.5 pr-3">
                                <p className="truncate text-[13.5px] font-semibold text-foreground" title={line.title}>{line.title}</p>
                                <p className="truncate text-[12px] text-muted-foreground">
                                  <span className="font-mono">{line.isbn13}</span>
                                  {line.sku ? <span className="ml-2">SKU {line.sku}</span> : null}
                                </p>
                              </td>
                              <td className="px-3 py-2.5">
                                <Input
                                  type="number"
                                  min={1}
                                  value={line.quantity}
                                  onChange={(event) => handleQuantityChange(line.isbn13, Number(event.target.value))}
                                  aria-label={`Số lượng cho ${line.title}`}
                                  className="tabular-nums"
                                />
                              </td>
                              <td className="py-2.5 text-right">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm-icon"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => handleRemoveLine(line.isbn13)}
                                  aria-label={`Bỏ ${line.title} khỏi yêu cầu`}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              </div>

              {/* What will be sent, kept in view while the form scrolls. */}
              <aside aria-label="Tóm tắt yêu cầu" className="rounded-2xl border border-border bg-card p-5 @4xl/page:sticky @4xl/page:top-4">
                <h2 className="font-serif text-[18px] font-semibold tracking-tight">Tóm tắt</h2>
                <dl className="mt-3 space-y-2.5 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Loại</dt>
                    <dd className="text-right font-medium">{requestType === "transfer" ? "Điều chuyển kho" : "Xuất kho"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Từ kho</dt>
                    <dd className="text-right font-medium">{sourceWarehouse ? sourceWarehouse.code : "Chưa chọn"}</dd>
                  </div>
                  {requestType === "transfer" ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Đến kho</dt>
                      <dd className="text-right font-medium">{targetWarehouse ? targetWarehouse.code : "Chưa chọn"}</dd>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Lý do</dt>
                        <dd className="text-right font-medium">{referenceLabel}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Mã tham chiếu</dt>
                        <dd className="flex items-center gap-1.5 text-right font-mono">
                          {loadingReferenceCode && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
                          {externalReference || (loadingReferenceCode ? "Đang tạo" : "Tự động")}
                        </dd>
                      </div>
                    </>
                  )}
                  {canApprove && warehouseStaff.length > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Người lấy hàng</dt>
                      <dd className="text-right font-medium">{pickerName || "Giao sau"}</dd>
                    </div>
                  )}
                </dl>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
                  <div>
                    <dt className="text-[12px] text-muted-foreground">Số dòng</dt>
                    <dd className="mt-0.5 font-serif text-[24px] font-semibold leading-none tabular-nums">{draftLines.length}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted-foreground">Số cuốn</dt>
                    <dd className="mt-0.5 font-serif text-[24px] font-semibold leading-none tabular-nums">{draftTotalQuantity}</dd>
                  </div>
                </dl>
                <div className="mt-5 space-y-2">
                  <Button type="button" className="w-full" onClick={() => void handleSubmitRequest()} disabled={submitting} loading={submitting}>
                    <Send className="h-3.5 w-3.5" />
                    Gửi yêu cầu
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={resetForm}>
                    Làm lại từ đầu
                  </Button>
                </div>
              </aside>
            </div>
          </div>
        </FadeItem>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ListOrdered}
          title="Yêu cầu xuất kho và điều chuyển"
          description={lede}
          actions={
            <Button type="button" size="sm" onClick={() => setActiveTab("compose")}>
              <Plus className="h-3.5 w-3.5" />
              Tạo yêu cầu
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="Lọc yêu cầu" className="hidden rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Trạng thái</p>
              {STATUS_ITEMS.map((item) => (
                <div key={item.value}>{railButton(statusFilter === item.value, () => setStatusFilter(item.value), item.label, statusCounts[item.value], item.attention)}</div>
              ))}
              <div className="mt-3 border-t border-border pt-3">
                <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Loại yêu cầu</p>
                {TYPE_ITEMS.map((item) => (
                  <div key={item.value}>{railButton(typeFilter === item.value, () => setTypeFilter(item.value), item.label, typeCounts[item.value])}</div>
                ))}
              </div>
            </nav>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl/page:hidden" role="group" aria-label="Lọc yêu cầu">
              {STATUS_ITEMS.map((item) => <div key={item.value}>{chip(statusFilter === item.value, () => setStatusFilter(item.value), item.label, statusCounts[item.value], item.attention)}</div>)}
              {TYPE_ITEMS.slice(1).map((item) => <div key={item.value}>{chip(typeFilter === item.value, () => setTypeFilter(typeFilter === item.value ? "all" : item.value), item.label, typeCounts[item.value])}</div>)}
            </div>

            <section aria-label="Danh sách yêu cầu" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-4">
                <div className="min-w-0">
                  <h2 className="font-serif text-[18px] font-semibold tracking-tight">{listView === "approval" ? "Hàng chờ duyệt" : "Yêu cầu của tôi"}</h2>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {listView === "approval"
                      ? "Yêu cầu từ mọi kho. Duyệt xong, yêu cầu chuyển sang bước lấy hàng."
                      : `Yêu cầu bạn đã tạo tại kho ${sourceWarehouse?.code || "đang chọn"}.`}
                  </p>
                </div>
                {canApprove && (
                  <SegmentedControl
                    options={[{ value: "approval", label: "Hàng chờ duyệt" }, { value: "my", label: "Của tôi" }]}
                    value={listView}
                    onChange={(v) => setListView(v as "my" | "approval")}
                    layoutId="order-requests-list-view"
                  />
                )}
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Tìm mã yêu cầu hoặc mã kho" />
              </div>

              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {[
                      { label: "Yêu cầu", className: "pl-5" },
                      { label: "Trạng thái", className: "hidden w-[170px] @xl:table-cell" },
                      { label: "Số cuốn", className: "hidden w-[88px] @2xl:table-cell" },
                      { label: "Gửi lúc", className: "hidden w-[150px] @4xl:table-cell" },
                      { label: "Thao tác", className: "w-[168px] pr-5 text-right" },
                    ].map((head) => (
                      <TableHead key={head.label} className={cn("px-3 text-[12px] font-medium text-muted-foreground", head.className)}>
                        {head.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRequests.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="whitespace-normal py-12 text-center">
                        <EmptyState
                          variant={requests.length === 0 && listView === "approval" ? "inbox" : "no-data"}
                          title={requests.length === 0 ? (listView === "approval" ? "Không có yêu cầu nào chờ duyệt" : "Bạn chưa tạo yêu cầu nào") : "Không tìm thấy yêu cầu phù hợp"}
                          description={
                            requests.length === 0
                              ? (listView === "approval" ? "Yêu cầu mới từ các kho sẽ xuất hiện ở đây." : "Tạo yêu cầu đầu tiên để xuất hoặc điều chuyển sách.")
                              : "Thử đổi trạng thái, loại hoặc từ khóa tìm kiếm."
                          }
                          action={requests.length === 0 && listView === "my" ? (
                            <Button type="button" size="sm" onClick={() => setActiveTab("compose")}>
                              <Plus className="h-3.5 w-3.5" />
                              Tạo yêu cầu
                            </Button>
                          ) : undefined}
                          className="py-0"
                        />
                      </TableCell>
                    </TableRow>
                  ) : pagedRequests.map((row) => {
                    const priority = requestAgingPriority(row.requested_at);
                    const meta = orderTypeMeta(row.order_type);
                    const canTakeAction = listView === "approval"
                      && ((row.task_type === "outbound" && row.status === "PENDING_APPROVAL")
                        || (row.task_type === "transfer" && row.status === "REQUESTED"));
                    const pending = isPendingStatus(row.status);

                    return (
                      <TableRow key={`${row.task_type}-${row.task_id}`}>
                        <TableCell className="py-3.5 pl-5 pr-3 align-top">
                          <p className="truncate font-mono text-[13px] font-semibold text-foreground" title={row.order_number}>{row.order_number}</p>
                          <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                            {meta.label}{" "}
                            {row.source_warehouse_code ? `từ ${row.source_warehouse_code}` : ""}
                            {row.target_warehouse_code ? ` đến ${row.target_warehouse_code}` : ""}
                            {`, ${row.line_count} dòng`}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 @xl:hidden">
                            <StatusBadge label={requestStatusLabel(row.status)} variant={statusBadgeVariant(row.status)} dot />
                            {pending && <PriorityBadge priority={priority} />}
                            <span className="text-[12px] tabular-nums text-muted-foreground">{row.total_quantity} cuốn</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-3 py-3.5 align-top @xl:table-cell">
                          <div className="flex flex-col items-start gap-1.5">
                            <StatusBadge label={requestStatusLabel(row.status)} variant={statusBadgeVariant(row.status)} dot />
                            {pending && <PriorityBadge priority={priority} />}
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-3 py-3.5 align-top text-[13px] font-semibold tabular-nums @2xl:table-cell">{row.total_quantity}</TableCell>
                        <TableCell className="hidden px-3 py-3.5 align-top text-[13px] tabular-nums text-muted-foreground @4xl:table-cell">{formatDate(row.requested_at)}</TableCell>
                        <TableCell className="py-3.5 pl-3 pr-5 align-top text-right">
                          {canTakeAction ? (
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              <Button type="button" size="sm" onClick={() => openActionDialog(row, "approve")}>
                                <Check className="h-3.5 w-3.5" />
                                Duyệt
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => openActionDialog(row, "reject")}
                              >
                                Từ chối
                              </Button>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span aria-live="polite">
                  {filteredRequests.length > 0 ? `Hiển thị ${pagedRequests.length} / ${filteredRequests.length} yêu cầu` : "Không có yêu cầu"}
                </span>
                {totalPages > 1 && (
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(event) => {
                            event.preventDefault();
                            setPage((current) => Math.max(1, current - 1));
                          }}
                          className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
                        />
                      </PaginationItem>
                      {getPaginationRange(page, totalPages).map((item) => (
                        <PaginationItem key={item}>
                          {typeof item === "number" ? (
                            <PaginationLink
                              isActive={item === page}
                              onClick={(event) => {
                                event.preventDefault();
                                setPage(item);
                              }}
                              className="cursor-pointer"
                            >
                              {item}
                            </PaginationLink>
                          ) : (
                            <PaginationEllipsis />
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(event) => {
                            event.preventDefault();
                            setPage((current) => Math.min(totalPages, current + 1));
                          }}
                          className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </div>
            </section>
          </div>
        </div>
      </FadeItem>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => { if (!open) closeActionDialog(); }}>
        <AlertDialogContent className="max-w-[440px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.mode === "approve" ? "Duyệt yêu cầu?" : "Từ chối yêu cầu?"}
            </AlertDialogTitle>
            {pendingAction && (
              <AlertDialogDescription>
                Yêu cầu <span className="font-mono font-medium text-foreground">{pendingAction.orderNumber}</span>, {pendingAction.totalQuantity} cuốn.{" "}
                {pendingAction.mode === "approve"
                  ? "Yêu cầu sẽ chuyển sang bước Lấy hàng."
                  : "Người tạo yêu cầu sẽ được báo về việc từ chối."}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>

          {pendingAction?.mode === "reject" && (
            <div className="space-y-1.5">
              <label htmlFor="reject-reason" className="text-[13px] font-medium">Lý do từ chối <span className="font-normal text-muted-foreground">(không bắt buộc)</span></label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                rows={2}
                placeholder="Cho người tạo biết vì sao yêu cầu bị từ chối"
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionSubmitting} onClick={closeActionDialog}>
              Hủy
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmAction();
              }}
              disabled={actionSubmitting}
              className={cn(
                buttonVariants({ variant: pendingAction?.mode === "reject" ? "destructive" : "default" }),
                "min-w-[96px]",
              )}
            >
              {actionSubmitting ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  Đang xử lý...
                </span>
              ) : pendingAction?.mode === "approve" ? "Duyệt" : "Từ chối"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageWrapper>
  );
}
