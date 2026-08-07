import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRightLeft, Book, Check, CheckCircle2, Clock, ListOrdered, Loader2,
  Package, Plus, Search, Send, Truck, X,
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
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-state";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";

type RequestType = "outbound" | "transfer";

const OUTBOUND_REFERENCE_OPTIONS: Array<{
  value: OutboundReferenceType;
  label: string;
}> = [
  { value: "TRANSFER_TO_STORE", label: "Xuất hàng tới cửa hàng bán lẻ" },
  { value: "WAREHOUSE_TRANSFER", label: "Điều chuyển giữa kho" },
  { value: "RETURN_TO_SUPPLIER", label: "Trả hàng nhà cung cấp" },
  { value: "SALES_ORDER", label: "Xuất theo đơn bán hàng" },
  { value: "INTERNAL_REQUEST", label: "Xuất theo yêu cầu nội bộ" },
  { value: "ISSUE_REQUEST", label: "Xuất theo phiếu cấp phát" },
  { value: "RESERVATION", label: "Xuất cho đơn đặt trước" },
  { value: "LOAN_REQUEST", label: "Xuất cho phiếu mượn thư viện" },
  { value: "MAINTENANCE", label: "Xuất để bảo trì/kiểm kê" },
  { value: "INVENTORY_ADJUSTMENT", label: "Xuất do điều chỉnh tồn kho" },
  { value: "DAMAGED_RETURN", label: "Xuất hàng lỗi/hỏng" },
  { value: "PROMOTION", label: "Xuất theo khuyến mãi/tặng" },
  { value: "OTHER", label: "Khác" },
];

type DraftLine = {
  isbn13: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
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
    .map((item) => `${item.isbn13 || item.sku || item.variant_id || "N/A"}: can ${item.available_qty || 0}, yeu cau ${item.required_qty || 0}, thieu ${item.shortage_qty || 0}`)
    .join(" | ");
}

function requestAgingPriority(requestedAt: string): "LOW" | "MEDIUM" | "HIGH" | "URGENT" {
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

function isPendingStatus(status: string): boolean {
  const upper = String(status || "").toUpperCase();
  return upper.includes("PENDING") || upper.includes("REQUESTED");
}

function isApprovedStatus(status: string): boolean {
  const upper = String(status || "").toUpperCase();
  return upper.includes("APPROVED") || upper.includes("COMPLETED") || upper.includes("READY");
}

function orderTypeMeta(type: string): { label: string; variant: "info" | "violet" } {
  const upper = String(type || "").toUpperCase();
  if (upper.includes("TRANSFER")) return { label: "Điều chuyển", variant: "violet" };
  return { label: "Xuất kho", variant: "info" };
}

export function OrderRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processingActionKey, setProcessingActionKey] = useState("");

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

  const [listView, setListView] = useState<"my" | "approval">("my");
  const [requests, setRequests] = useState<OrderRequestSummary[]>([]);

  const canApprove = canApproveRequests();

  const filteredWarehouses = useMemo(() => {
    if (!selectedWarehouseId || requestType !== "transfer") return warehouses;
    return warehouses.filter((warehouse) => warehouse.id !== selectedWarehouseId);
  }, [warehouses, requestType, selectedWarehouseId]);

  const requestStats = useMemo(() => {
    const total = requests.length;
    const pending = requests.filter((row) => isPendingStatus(row.status)).length;
    const approved = requests.filter((row) => isApprovedStatus(row.status)).length;
    const totalQuantity = requests.reduce((sum, row) => sum + (row.total_quantity || 0), 0);
    return { total, pending, approved, totalQuantity };
  }, [requests]);

  const draftTotalQuantity = useMemo(
    () => draftLines.reduce((sum, line) => sum + (line.quantity || 0), 0),
    [draftLines],
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

        await loadRequests("my", preferredWarehouse || undefined);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc du lieu order requests"));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    if (!selectedWarehouseId) return;

    const warehouseFilter = listView === "approval" ? undefined : selectedWarehouseId;

    void loadRequests(listView, warehouseFilter).catch((error) => {
      toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach request"));
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
          toast.error(getApiErrorMessage(error, "Khong sinh duoc Reference Code"));
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

  const handleSearchVariant = async () => {
    const q = variantQuery.trim();
    if (q.length < 2) {
      toast.error("Nhap it nhat 2 ky tu de tim variant");
      return;
    }

    try {
      setSearchingVariant(true);
      const response = await orderRequestService.searchVariants(q);
      setVariantResults(response.data || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong tim duoc variant"));
    } finally {
      setSearchingVariant(false);
    }
  };

  const handleAddLine = (variant: OrderRequestVariant) => {
    const isbn13 = String(variant.isbn13 || "").trim();
    if (!isbn13 || !/^\d{13}$/.test(isbn13)) {
      toast.error("Chi duoc them sach co ISBN13 hop le");
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
      toast.error("Chon warehouse nguon truoc");
      return;
    }

    if (draftLines.length === 0) {
      toast.error("Can it nhat 1 line trong request");
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
          toast.error("Chon warehouse dich cho transfer");
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

      toast.success("Tao request thanh cong");
      resetForm();
      setListView("my");
      await loadRequests("my", selectedWarehouseId || undefined);
    } catch (error) {
      const message = getApiErrorMessage(error, "Tao request that bai");
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

  const handleApproveOrReject = async (
    taskType: RequestTaskType,
    taskId: string,
    mode: "approve" | "reject",
  ) => {
    try {
      const key = `${mode}:${taskType}:${taskId}`;
      setProcessingActionKey(key);

      if (mode === "approve") {
        await orderRequestService.approveRequest(taskType, taskId);
        toast.success("Da duyet request");
      } else {
        await orderRequestService.rejectRequest(taskType, taskId);
        toast.success("Da tu choi request");
      }

      const warehouseFilter = listView === "approval" ? undefined : (selectedWarehouseId || undefined);
      await loadRequests(listView, warehouseFilter);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cap nhat request that bai"));
    } finally {
      setProcessingActionKey("");
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <div className="flex min-h-[40vh] items-center justify-center">
          <LoadingSpinner message="Dang tai du lieu order requests..." className="flex-col gap-3 text-[13px]" />
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ListOrdered}
          title="Order Requests"
          description="Tao don yeu cau va duyet truoc khi vao Picking"
          iconBg="bg-gradient-to-br from-cyan-100 to-sky-50 border-cyan-200/50 dark:from-cyan-500/15 dark:to-sky-500/10 dark:border-cyan-500/20"
          iconColor="text-cyan-700 dark:text-cyan-400"
        />
      </FadeItem>

      {requests.length > 0 && (
        <FadeItem>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Tổng request" value={requestStats.total} icon={ListOrdered} variant="primary" animateValue />
            <StatCard label="Chờ duyệt" value={requestStats.pending} icon={Clock} variant="warning" animateValue />
            <StatCard label="Đã duyệt" value={requestStats.approved} icon={CheckCircle2} variant="success" animateValue />
            <StatCard label="Tổng số lượng" value={requestStats.totalQuantity} icon={Package} variant="info" animateValue />
          </div>
        </FadeItem>
      )}

      <FadeItem>
        <SectionCard
          title="Thông tin request"
          subtitle="Chọn loại, kho nguồn và ghi chú trước khi thêm dòng hàng."
          icon={Send}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-3">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Loại request</p>
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl
                  options={[
                    { value: "outbound", label: "Xuất kho" },
                    { value: "transfer", label: "Điều chuyển kho" },
                  ]}
                  value={requestType}
                  onChange={(v) => setRequestType(v as RequestType)}
                  layoutId="order-request-type"
                  gradientClassName={requestType === "transfer" ? "from-violet-600 to-purple-600" : "from-cyan-600 to-sky-600"}
                />
                <div
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    requestType === "transfer"
                      ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400"
                      : "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400"
                  }`}
                >
                  {requestType === "transfer" ? <ArrowRightLeft className="w-3.5 h-3.5" /> : <Truck className="w-3.5 h-3.5" />}
                  {requestType === "transfer" ? "Chuyển hàng giữa 2 kho" : "Xuất hàng ra khỏi kho"}
                </div>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Warehouse nguồn</p>
              <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {requestType === "transfer" ? (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Warehouse đích</p>
                <Select value={targetWarehouseId} onValueChange={setTargetWarehouseId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chọn warehouse đích" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredWarehouses.map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Reference Type</p>
                  <Select value={referenceType} onValueChange={(v) => setReferenceType(v as OutboundReferenceType)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTBOUND_REFERENCE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Reference Code</p>
                  <div className="relative">
                    <Input
                      value={externalReference}
                      readOnly
                      placeholder={loadingReferenceCode ? "Đang sinh mã..." : "Tự động tạo"}
                      className="bg-muted/50 pr-8 text-muted-foreground"
                    />
                    {loadingReferenceCode && (
                      <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>
              </div>
            )}

            {canApprove && warehouseStaff.length > 0 && (
              <div className="md:col-span-3">
                <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Giao nhân viên phụ trách (tùy chọn)</p>
                <Select value={assignedPickerUserId || "none"} onValueChange={(v) => setAssignedPickerUserId(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Chưa giao (giao sau ở Picking)</SelectItem>
                    {warehouseStaff.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        {staff.full_name} ({staff.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="md:col-span-3">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Ghi chú</p>
              <Textarea
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
                rows={2}
                className="resize-y"
                placeholder="Lý do tạo request..."
              />
            </div>
          </div>
        </SectionCard>
      </FadeItem>

      <FadeItem>
        <SectionCard
          title="Thêm lines"
          subtitle="Tìm variant theo ISBN13, SKU hoặc tên sách, sau đó thêm vào bảng dưới."
          icon={Plus}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={variantQuery}
                onChange={(event) => setVariantQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSearchVariant();
                  }
                }}
                placeholder="Nhập ISBN13, SKU hoặc tên sách"
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              onClick={() => void handleSearchVariant()}
              disabled={searchingVariant}
              loading={searchingVariant}
              className="shrink-0 sm:w-auto"
            >
              Tim
            </Button>
          </div>

          {variantResults.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-muted/20">
              {variantResults.map((variant, index) => (
                <motion.div
                  key={variant.variant_id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.24) }}
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-cyan-100 dark:bg-cyan-500/15 flex items-center justify-center shrink-0">
                      <Book className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-foreground">{variant.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        ISBN13: {variant.isbn13 || "-"} | SKU: {variant.sku || "-"}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="info-outline"
                    size="sm"
                    onClick={() => handleAddLine(variant)}
                    className="shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Thêm
                  </Button>
                </motion.div>
              ))}
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-xl border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {["Sản phẩm", "Số lượng", "Thao tác"].map((head) => (
                    <th
                      key={head}
                      className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draftLines.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-10 text-center">
                      <EmptyState
                        variant="no-data"
                        title="Chưa có line nào"
                        description="Tìm sản phẩm và nhấn Thêm để bắt đầu."
                        className="py-0"
                      />
                    </td>
                  </tr>
                ) : draftLines.map((line) => (
                  <tr key={line.isbn13} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 text-[12px]">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-cyan-100 dark:bg-cyan-500/15 flex items-center justify-center shrink-0">
                          <Book className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{line.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            ISBN13: {line.isbn13} | SKU: {line.sku || "-"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      <Input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(event) => handleQuantityChange(line.isbn13, Number(event.target.value))}
                        aria-label={`Số lượng cho ${line.title}`}
                        className="max-w-[120px]"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm-icon"
                        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                        onClick={() => handleRemoveLine(line.isbn13)}
                        aria-label="Xoa dong"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <div className="text-[12px] text-muted-foreground">
              {draftLines.length > 0 ? (
                <span>
                  <span className="font-semibold text-foreground">{draftLines.length}</span> dòng ·{" "}
                  <span className="font-semibold text-foreground">{draftTotalQuantity}</span> cuốn
                </span>
              ) : (
                <span>Chưa có dòng nào</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={resetForm}>
                Reset
              </Button>
              <Button type="button" onClick={() => void handleSubmitRequest()} disabled={submitting} loading={submitting}>
                <Send className="h-3.5 w-3.5" />
                Tạo request
              </Button>
            </div>
          </div>
        </SectionCard>
      </FadeItem>

      <FadeItem>
        <SectionCard
          title="Danh sách requests"
          subtitle={listView === "my" ? "Các đơn bạn đã tạo theo kho nguồn." : "Hàng chờ duyệt (cần quyền phù hợp)."}
          actions={(
            <SegmentedControl
              options={
                canApprove
                  ? [{ value: "my", label: "Đơn của tôi" }, { value: "approval", label: "Hàng chờ duyệt" }]
                  : [{ value: "my", label: "Đơn của tôi" }]
              }
              value={listView}
              onChange={(v) => setListView(v as "my" | "approval")}
              layoutId="order-requests-list-view"
              gradientClassName="from-cyan-600 to-sky-600"
            />
          )}
        >
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {["Order", "Loại", "Nguồn", "Đích", "Trạng thái", "Ưu tiên", "Số lượng", "Yêu cầu lúc", "Thao tác"].map((head) => (
                    <th
                      key={head}
                      className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center">
                      <EmptyState
                        variant="no-data"
                        title="Không có request nào"
                        description={listView === "approval" ? "Không có đơn chờ duyệt." : "Hãy tạo request mới ở phần trên."}
                        className="py-0"
                      />
                    </td>
                  </tr>
                ) : requests.map((row) => {
                  const approveKey = `approve:${row.task_type}:${row.task_id}`;
                  const rejectKey = `reject:${row.task_type}:${row.task_id}`;
                  const canTakeAction = listView === "approval"
                    && ((row.task_type === "outbound" && row.status === "PENDING_APPROVAL")
                      || (row.task_type === "transfer" && row.status === "REQUESTED"));

                  return (
                    <tr key={`${row.task_type}-${row.task_id}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 text-[12px]">
                        <p className="font-semibold text-foreground">{row.order_number}</p>
                        <p className="text-[11px] text-muted-foreground">{row.line_count} lines</p>
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        {(() => { const meta = orderTypeMeta(row.order_type); return <StatusBadge label={meta.label} variant={meta.variant} />; })()}
                      </td>
                      <td className="px-4 py-3 text-[12px]">{row.source_warehouse_code || "-"}</td>
                      <td className="px-4 py-3 text-[12px]">{row.target_warehouse_code || "-"}</td>
                      <td className="px-4 py-3 text-[12px]">
                        <StatusBadge label={row.status} variant={statusBadgeVariant(row.status)} dot />
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        {listView === "approval" ? <PriorityBadge priority={requestAgingPriority(row.requested_at)} /> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-medium">{row.total_quantity}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(row.requested_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {canTakeAction ? (
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="success-outline"
                              size="sm"
                              onClick={() => void handleApproveOrReject(row.task_type, row.task_id, "approve")}
                              disabled={processingActionKey === approveKey || processingActionKey === rejectKey}
                            >
                              <Check className="h-3 w-3" />
                              Duyệt
                            </Button>
                            <Button
                              type="button"
                              variant="danger-outline"
                              size="sm"
                              onClick={() => void handleApproveOrReject(row.task_type, row.task_id, "reject")}
                              disabled={processingActionKey === approveKey || processingActionKey === rejectKey}
                            >
                              Từ chối
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
