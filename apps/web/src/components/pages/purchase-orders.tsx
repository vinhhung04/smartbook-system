import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";
import { CheckSquare, ClipboardList, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderStatus, type PurchaseOrderSummary } from "@/services/purchase-order";
import { supplierService, type Supplier } from "@/services/supplier";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import { getApiErrorMessage } from "@/services/api";
import { StatusBadge } from "@/components/status-badge";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { PageWrapper, FadeItem } from "@/components/motion-utils";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { getStatusVariant } from "@/lib/status-registry";

const STATUS_OPTIONS = ["ALL", "DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED", "RECEIVED", "REJECTED", "CANCELLED"];

const VIEW_OPTIONS: { value: "all" | "my" | "approval"; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "my", label: "Của tôi" },
  { value: "approval", label: "Chờ duyệt" },
];

// The real PO happy path — draft through received. Off-ramp statuses (rejected,
// cancelled, shortage-reported) don't get force-fit onto this trail; they show
// only their status badge, since a linear dot trail would misrepresent them.
const STAGE_SEQUENCE: PurchaseOrderStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "RECEIVED"];
const STAGE_LABEL: Record<string, string> = {
  DRAFT: "Nháp",
  PENDING_APPROVAL: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  SENT_TO_SUPPLIER: "Đã gửi NCC",
  SUPPLIER_CONFIRMED: "NCC đã xác nhận",
  RECEIVED: "Đã nhận",
};
const STAGE_OFF_RAMP = new Set(["REJECTED", "CANCELLED", "SHORTAGE_REPORTED"]);

function PoStageDots({ status }: { status: PurchaseOrderStatus }) {
  if (STAGE_OFF_RAMP.has(status)) return null;
  const isPartial = status === "PARTIALLY_RECEIVED";
  const currentIdx = isPartial ? 4 : STAGE_SEQUENCE.indexOf(status);
  return (
    <div className="flex items-center gap-1" title={`Tiến trình: ${STAGE_LABEL[isPartial ? "SUPPLIER_CONFIRMED" : status] ?? status}`} aria-hidden="true">
      {STAGE_SEQUENCE.map((stage, i) => {
        const tone = isPartial && i === 5 ? "bg-amber-500" : i <= currentIdx ? "bg-emerald-500" : "bg-muted";
        return <span key={stage} className={`h-1.5 w-1.5 rounded-full ${tone}`} />;
      })}
    </div>
  );
}

const STAT_STATUSES = [
  { key: "DRAFT", label: "Nháp", variant: "default" as const },
  { key: "PENDING_APPROVAL", label: "Chờ duyệt", variant: "warning" as const },
  { key: "APPROVED", label: "Đã duyệt", variant: "primary" as const },
  { key: "PARTIALLY_RECEIVED", label: "Nhận một phần", variant: "info" as const },
  { key: "RECEIVED", label: "Đã nhận", variant: "success" as const },
];

function formatCurrency(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

export function PurchaseOrdersPage() {
  const currentUser = authService.getCurrentUser();
  const canCreatePurchaseOrder = canAccess(currentUser, ROUTE_ACCESS.purchaseWrite);
  const [rows, setRows] = useState<PurchaseOrderSummary[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [view, setView] = useState<"all" | "my" | "approval">("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkApprove, setConfirmBulkApprove] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const PAGE_SIZE = 20;

  const load = async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { view, page, pageSize: PAGE_SIZE };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (status !== "ALL") params.status = status;
      if (supplierId) params.supplier_id = supplierId;
      if (warehouseId) params.warehouse_id = warehouseId;
      const [poResp, supplierRows, warehouseRows] = await Promise.all([
        purchaseOrderService.getAll(params),
        supplierService.getAll(),
        warehouseService.getAll(),
      ]);
      setRows(Array.isArray(poResp.data) ? poResp.data : []);
      setTotalPages(Math.max(1, Math.ceil((poResp.pagination?.total || 0) / PAGE_SIZE)));
      setSuppliers(Array.isArray(supplierRows) ? supplierRows : []);
      setWarehouses(Array.isArray(warehouseRows) ? warehouseRows : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách đơn đặt hàng"));
    } finally {
      setLoading(false);
    }
  };

  // Real totals across the whole system, independent of the row filters above —
  // the old stat cards counted only the current page's rows, which was silently
  // wrong under any filter or on page 2+.
  const loadCounts = async () => {
    try {
      const results = await Promise.all(
        STAT_STATUSES.map((s) => purchaseOrderService.getAll({ status: s.key, page: 1, pageSize: 1 })),
      );
      const next: Record<string, number> = {};
      STAT_STATUSES.forEach((s, i) => { next[s.key] = results[i]?.pagination?.total || 0; });
      setCounts(next);
    } catch {
      // Non-critical — stat cards just stay at their last known counts.
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, supplierId, warehouseId, view, page, debouncedSearch]);

  useEffect(() => {
    void loadCounts();
  }, []);

  // Debounce free-text search into a separate committed value instead of requiring
  // Enter — settles 400ms after typing stops, then resets to page 1 and (via the
  // debouncedSearch dependency above) triggers exactly one reload either way,
  // whether or not the page number itself actually changed.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const selectablePendingRows = useMemo(() => rows.filter((row) => row.status === "PENDING_APPROVAL"), [rows]);
  const allSelectableChecked = selectablePendingRows.length > 0 && selectablePendingRows.every((row) => selectedIds.has(row.id));

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleAllSelectable = (checked: boolean) => {
    setSelectedIds(checked ? new Set(selectablePendingRows.map((row) => row.id)) : new Set());
  };

  const handleBulkApprove = async () => {
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => purchaseOrderService.approve(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    const succeeded = ids.length - failed;
    if (succeeded > 0) toast.success(`Đã duyệt ${succeeded} đơn.`);
    if (failed > 0) toast.error(`${failed} đơn duyệt thất bại.`);
    setSelectedIds(new Set());
    setConfirmBulkApprove(false);
    void load();
    void loadCounts();
  };

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title="Đơn đặt hàng"
          description="Lập đơn đặt hàng, phê duyệt và đối soát nhập hàng"
          iconBg="bg-gradient-to-br from-indigo-600 to-sky-600 shadow-lg shadow-indigo-500/20"
          iconColor="text-white"
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => { void load(); void loadCounts(); }} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
              {canCreatePurchaseOrder ? (
                <Button asChild size="sm">
                  <NavLink to="/purchase-orders/new">
                    <Plus className="h-3.5 w-3.5" />
                    Tạo PO mới
                  </NavLink>
                </Button>
              ) : null}
            </>
          }
        />
      </FadeItem>

      <FadeItem className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {STAT_STATUSES.map((s) => (
          <StatCard key={s.key} label={s.label} value={counts[s.key] ?? 0} variant={s.variant} animateValue />
        ))}
      </FadeItem>

      <FadeItem>
        <SectionCard>
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Tìm PO, nhà cung cấp, kho..."
            filters={
              <>
                <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                  <SelectTrigger size="sm" className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item === "ALL" ? "Tất cả trạng thái" : item}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={supplierId || "__all__"} onValueChange={(v) => { setSupplierId(v === "__all__" ? "" : v); setPage(1); }}>
                  <SelectTrigger size="sm" className="w-[170px]">
                    <SelectValue placeholder="Tất cả nhà cung cấp" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Tất cả nhà cung cấp</SelectItem>
                    {suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={warehouseId || "__all__"} onValueChange={(v) => { setWarehouseId(v === "__all__" ? "" : v); setPage(1); }}>
                  <SelectTrigger size="sm" className="w-[170px]">
                    <SelectValue placeholder="Tất cả kho" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Tất cả kho</SelectItem>
                    {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            }
            actions={
              <SegmentedControl
                options={VIEW_OPTIONS}
                value={view}
                onChange={(v) => { setView(v); setPage(1); }}
                layoutId="po-view-segmented"
              />
            }
          />
        </SectionCard>
      </FadeItem>

      {selectedIds.size > 0 && (
        <FadeItem className="flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[13px] text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400">
          <span>Đã chọn {selectedIds.size} đơn</span>
          <Button size="sm" onClick={() => setConfirmBulkApprove(true)}>
            <CheckSquare className="h-3.5 w-3.5" />
            Duyệt hàng loạt
          </Button>
        </FadeItem>
      )}

      <FadeItem>
        <SectionCard noPadding>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10">
                  {selectablePendingRows.length > 0 && (
                    <Checkbox checked={allSelectableChecked} onCheckedChange={(checked) => toggleAllSelectable(checked === true)} aria-label="Chọn tất cả đơn chờ duyệt" />
                  )}
                </TableHead>
                {["Số PO", "Nhà cung cấp", "Kho", "Trạng thái", "Ngày đặt", "Dự kiến", "Dòng", "SL đặt", "SL nhận", "Tổng tiền", "Đối soát"].map((heading) => (
                  <TableHead key={heading} className="text-[11px] uppercase tracking-wider text-muted-foreground">{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <SkeletonTableRow columns={12} rows={5} />
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={12} className="whitespace-normal py-12">
                    <EmptyState variant="no-data" title="Chưa có đơn đặt hàng" description="Tạo PO để bắt đầu quy trình phê duyệt và đối soát nhập hàng" />
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.status === "PENDING_APPROVAL" && (
                      <Checkbox checked={selectedIds.has(row.id)} onCheckedChange={(checked) => toggleRow(row.id, checked === true)} aria-label={`Chọn ${row.po_number}`} />
                    )}
                  </TableCell>
                  <TableCell className="text-[13px]"><NavLink to={`/purchase-orders/${row.id}`} className="font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">{row.po_number}</NavLink></TableCell>
                  <TableCell className="text-[13px]">{row.supplier_name || "-"}</TableCell>
                  <TableCell className="text-[13px]">{row.warehouse_code || row.warehouse_name || "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <StatusBadge label={row.status} variant={getStatusVariant("purchaseOrder", row.status)} dot />
                      <PoStageDots status={row.status} />
                    </div>
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{formatDate(row.order_date)}</TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{formatDate(row.expected_date)}</TableCell>
                  <TableCell className="text-[13px]">{row.item_count}</TableCell>
                  <TableCell className="text-[13px]">{row.total_ordered_qty}</TableCell>
                  <TableCell className="text-[13px]">{row.total_received_qty}</TableCell>
                  <TableCell className="text-[12px] font-mono">{formatCurrency(row.total_amount)}</TableCell>
                  <TableCell><StatusBadge label={row.reconciliation_status} variant={getStatusVariant("purchaseOrder", row.reconciliation_status)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
              <span>Trang {page} / {totalPages}</span>
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={(event) => { event.preventDefault(); if (page > 1) setPage(page - 1); }}
                      className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                  {getPaginationRange(page, totalPages).map((item, i) => (
                    <PaginationItem key={`${item}-${i}`}>
                      {typeof item === "number" ? (
                        <PaginationLink isActive={item === page} onClick={(event) => { event.preventDefault(); setPage(item); }} className="cursor-pointer">
                          {item}
                        </PaginationLink>
                      ) : (
                        <PaginationEllipsis />
                      )}
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={(event) => { event.preventDefault(); if (page < totalPages) setPage(page + 1); }}
                      className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </SectionCard>
      </FadeItem>

      <ConfirmDialog
        open={confirmBulkApprove}
        onOpenChange={setConfirmBulkApprove}
        title="Duyệt hàng loạt?"
        description={`Duyệt ${selectedIds.size} đơn đặt hàng đã chọn? Hành động này không thể hoàn tác.`}
        confirmLabel="Duyệt"
        onConfirm={handleBulkApprove}
      />
    </PageWrapper>
  );
}
