import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, RefreshCw, Check, ArrowRight, Search } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router";
import { PageWrapper, FadeItem } from "../motion-utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueueTabs, RefCode, RowsSkeleton } from "@/components/ops/ops-kit";
import { elapsedSince } from "@/components/ops/ops-utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { getApiErrorMessage } from "@/services/api";
import { purchaseRequestService, type PurchaseRequest } from "@/services/purchase-requests";
import { supplierService, type Supplier } from "@/services/supplier";
import { purchaseOrderService, type VariantSearchItem } from "@/services/purchase-order";
import { userService } from "@/services/user";
import { getStatusVariant, PURCHASE_REQUEST_STATUS_LABELS } from "@/lib/status-registry";

const REASONS: Record<string, string> = {
  LOW_STOCK: "Tồn kho thấp",
  CUSTOMER_REQUEST: "Yêu cầu khách hàng",
  DAMAGED: "Sách hư hỏng",
  LOST: "Mất sách",
  OTHER: "Lý do khác",
};

const STATUS_FILTERS = ["ALL", "PENDING", "APPROVED", "CONVERTED", "REJECTED", "WITHDRAWN"];
const PAGE_SIZE = 10;
const PANEL_ID = "purchase-request-list";

function statusVariant(status: string) {
  return getStatusVariant("purchaseRequest", status);
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("vi-VN");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface RowAction {
  type: "reject" | "convert";
  id: string;
  value: string;       // supplier_id khi convert, lý do khi reject
  variantId?: string;  // book_variant_id khi convert (nếu request chưa có)
  variantLabel?: string;
}

export function PurchaseRequestsPage() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rowAction, setRowAction] = useState<RowAction | null>(null);
  const [approveTarget, setApproveTarget] = useState<PurchaseRequest | null>(null);
  const [acting, setActing] = useState(false);
  const [variantQuery, setVariantQuery] = useState("");
  const [variantResults, setVariantResults] = useState<VariantSearchItem[]>([]);
  const [searchingVariant, setSearchingVariant] = useState(false);
  const variantSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async (status?: string) => {
    setLoading(true);
    try {
      const [res, sRes] = await Promise.all([
        purchaseRequestService.getAll(status && status !== "ALL" ? { status } : {}),
        supplierService.getAll(),
      ]);
      setRequests(Array.isArray(res.data) ? res.data : []);
      setSuppliers(Array.isArray(sRes) ? sRes : []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được danh sách yêu cầu"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(statusFilter); }, [statusFilter]);

  useEffect(() => {
    if (variantSearchTimer.current) clearTimeout(variantSearchTimer.current);
    if (variantQuery.trim().length < 2) { setVariantResults([]); return; }
    setSearchingVariant(true);
    variantSearchTimer.current = setTimeout(async () => {
      try {
        const results = await purchaseOrderService.searchVariants(variantQuery);
        setVariantResults(results);
      } catch { setVariantResults([]); }
      finally { setSearchingVariant(false); }
    }, 350);
    return () => { if (variantSearchTimer.current) clearTimeout(variantSearchTimer.current); };
  }, [variantQuery]);

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return requests;
    return requests.filter((req) => {
      const haystack = `${req.request_number} ${req.warehouses?.code || ""} ${req.book_variants?.books?.title || ""} ${req.book_title_hint || ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [requests, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));

  const pagedRequests = useMemo(
    () => filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRequests, page],
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const handleApprove = async (id: string) => {
    setActing(true);
    try {
      await purchaseRequestService.approve(id);
      toast.success("Đã duyệt yêu cầu");
      setApproveTarget(null);
      void load(statusFilter);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Duyệt yêu cầu thất bại"));
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!rowAction || rowAction.type !== "reject") return;
    setActing(true);
    try {
      await purchaseRequestService.reject(rowAction.id, rowAction.value || undefined);
      toast.success("Đã từ chối yêu cầu");
      setRowAction(null);
      void load(statusFilter);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Từ chối thất bại"));
    } finally {
      setActing(false);
    }
  };

  const handleConvert = async () => {
    if (!rowAction || rowAction.type !== "convert") return;
    if (!rowAction.value) { toast.error("Vui lòng chọn nhà cung cấp"); return; }
    setActing(true);
    try {
      const payload: { supplier_id: string; book_variant_id?: string } = { supplier_id: rowAction.value };
      if (rowAction.variantId) payload.book_variant_id = rowAction.variantId;
      const result = await purchaseRequestService.convertToPO(rowAction.id, payload);
      toast.success(`Đã chuyển thành PO: ${result.data.po_number}`);
      setRowAction(null);
      setVariantQuery("");
      setVariantResults([]);
      void load(statusFilter);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Chuyển thành PO thất bại"));
    } finally {
      setActing(false);
    }
  };

  // Names for "who asked": read-only staff directory, the same one the exception inbox uses.
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void userService.getWarehouseStaff()
      .then((res) => setStaffNames(new Map((Array.isArray(res.data) ? res.data : []).map((s) => [s.id, s.full_name || s.username]))))
      .catch(() => setStaffNames(new Map()));
  }, []);
  const personName = (userId: string | null | undefined) => (userId ? staffNames.get(userId) ?? `Tài khoản …${userId.slice(-6)}` : "-");

  const counts = requests.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
  const pending = requests.filter((r) => r.status === "PENDING");
  const oldestPending = pending.reduce<string | null>((oldest, r) => (!oldest || r.created_at < oldest ? r.created_at : oldest), null);
  const oldestAge = elapsedSince(oldestPending);
  const awaitingPo = requests.filter((r) => r.status === "APPROVED" && !r.purchase_order_id).length;
  const lede = loading
    ? "Xem xét và xử lý yêu cầu mua hàng từ nhân viên kho."
    : statusFilter !== "ALL"
      ? `${requests.length} yêu cầu ${(PURCHASE_REQUEST_STATUS_LABELS[statusFilter] ?? statusFilter).toLowerCase()}.`
      : requests.length === 0
        ? "Chưa có yêu cầu mua hàng nào từ nhân viên kho."
        : `${requests.length} yêu cầu gần nhất: ${[
            pending.length ? `${pending.length} chờ duyệt${oldestAge ? ` (cũ nhất ${oldestAge.text})` : ""}` : null,
            awaitingPo ? `${awaitingPo} đã duyệt, chờ chuyển thành PO` : null,
            counts.CONVERTED ? `${counts.CONVERTED} đã vào đơn PO` : null,
            counts.REJECTED ? `${counts.REJECTED} bị từ chối` : null,
            counts.WITHDRAWN ? `${counts.WITHDRAWN} đã rút` : null,
          ].filter(Boolean).join(", ")}.`;
  const statusTabs = STATUS_FILTERS.map((key) => ({
    key,
    label: key === "ALL" ? "Tất cả" : PURCHASE_REQUEST_STATUS_LABELS[key] ?? key,
    // Only the unfiltered list gives honest per-status counts (the API filters by status).
    count: statusFilter === "ALL" && !loading ? (key === "ALL" ? requests.length : counts[key] ?? 0) : undefined,
  }));
  const actionTarget = rowAction ? requests.find((r) => r.id === rowAction.id) ?? null : null;
  const closeAction = () => {
    if (acting) return;
    setRowAction(null);
    if (rowAction?.type === "convert") { setVariantQuery(""); setVariantResults([]); }
  };
  const titleOf = (req: PurchaseRequest) => req.book_variants?.books?.title || req.book_title_hint || null;

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ClipboardCheck}
          title="Yêu cầu mua hàng"
          description={lede}
          actions={(
            <Button type="button" variant="outline" size="sm" onClick={() => void load(statusFilter)} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 motion-reduce:animate-none ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          )}
        />
      </FadeItem>

      <FadeItem>
        <section aria-label="Danh sách yêu cầu" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
          <QueueTabs label="Lọc theo trạng thái" tabs={statusTabs} value={statusFilter} onChange={setStatusFilter} panelId={PANEL_ID} loading={loading} />

          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="relative min-w-0 sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm mã yêu cầu, kho, tên sách…"
                aria-label="Tìm yêu cầu"
                className="h-10 w-full rounded-md border border-input bg-input-background pl-9 pr-3 text-[14px] outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-border dark:bg-muted/40 sm:h-9"
              />
            </div>
            {!loading ? <p className="text-[13px] tabular-nums text-muted-foreground">{filteredRequests.length} yêu cầu</p> : null}
          </div>

          <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-tab-${statusFilter}`} aria-busy={loading}>
            {loading ? (
              <RowsSkeleton rows={5} />
            ) : pagedRequests.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  icon={ClipboardCheck}
                  variant={requests.length === 0 ? "no-data" : "no-results"}
                  title={requests.length === 0 ? "Chưa có yêu cầu nào" : "Không tìm thấy yêu cầu phù hợp"}
                  description={
                    requests.length === 0
                      ? "Các yêu cầu mua hàng từ nhân viên kho sẽ hiển thị tại đây."
                      : "Thử điều chỉnh từ khóa tìm kiếm hoặc bộ lọc."
                  }
                  className="py-0"
                />
              </div>
            ) : (
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Yêu cầu</TableHead>
                    <TableHead className="hidden w-[92px] text-right text-[12px] font-normal text-muted-foreground @2xl:table-cell">Số lượng</TableHead>
                    <TableHead className="hidden w-[150px] text-[12px] font-normal text-muted-foreground @3xl:table-cell">Kho</TableHead>
                    <TableHead className="hidden w-[170px] text-[12px] font-normal text-muted-foreground @4xl:table-cell">Người gửi</TableHead>
                    <TableHead className="w-[128px] pr-5 text-right @2xl:w-[172px] text-[12px] font-normal text-muted-foreground">Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRequests.map((req) => {
                    const title = titleOf(req);
                    const waited = req.status === "PENDING" ? elapsedSince(req.created_at) : null;
                    const codes = [req.book_variants?.isbn13 ? `ISBN ${req.book_variants.isbn13}` : null, req.book_variants?.sku].filter(Boolean).join(", ");
                    return (
                      <TableRow key={req.id} className="hover:bg-muted/30">
                        <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className={cn("text-[14px] font-semibold", title ? "text-foreground" : "italic text-muted-foreground")}>{title || "Chưa xác định sách"}</p>
                            {!req.book_variant_id ? (
                              <span className="rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground" title="Nhân viên nhập tên sách, cần chọn đầu sách khi chuyển thành PO">Nhập tay</span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
                            <RefCode value={req.request_number} />
                            {codes ? <span className="font-mono">{codes}</span> : null}
                          </p>
                          {/* Columns the container hides move here, so no field is dropped. */}
                          <p className="mt-1 text-[13px] text-muted-foreground @2xl:hidden">
                            <span className="font-semibold tabular-nums text-foreground">{req.quantity_requested} cuốn</span>, {req.warehouses?.code || "chưa rõ kho"}, {(REASONS[req.reason] || req.reason).toLowerCase()}
                          </p>
                          <p className="mt-1 hidden text-[13px] text-muted-foreground @2xl:block @3xl:hidden">{req.warehouses?.code || "Chưa rõ kho"}, {(REASONS[req.reason] || req.reason).toLowerCase()}</p>
                          <p className="mt-1 hidden text-[13px] text-muted-foreground @3xl:block">{REASONS[req.reason] || req.reason}</p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground @4xl:hidden">Gửi bởi {personName(req.created_by_user_id)}, {formatDate(req.created_at)}</p>
                          {req.note ? <p className="mt-1 line-clamp-2 max-w-prose text-[13px] text-foreground/80" title={req.note}>Ghi chú: {req.note}</p> : null}
                          {req.status === "REJECTED" && req.rejection_reason ? (
                            <p className="mt-1 max-w-prose text-[13px] text-red-700 dark:text-red-400">Lý do từ chối: {req.rejection_reason}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="hidden py-3.5 text-right align-top @2xl:table-cell">
                          <span className="text-[15px] font-semibold tabular-nums text-foreground">{req.quantity_requested}</span>
                          <span className="text-[12px] text-muted-foreground"> cuốn</span>
                        </TableCell>
                        <TableCell className="hidden whitespace-normal py-3.5 align-top @3xl:table-cell">
                          <p className="text-[13px] text-foreground">{req.warehouses?.code || "-"}</p>
                          <p className="line-clamp-2 text-[12px] text-muted-foreground">{req.warehouses?.name}</p>
                        </TableCell>
                        <TableCell className="hidden whitespace-normal py-3.5 align-top @4xl:table-cell">
                          <p className="truncate text-[13px] text-foreground" title={personName(req.created_by_user_id)}>{personName(req.created_by_user_id)}</p>
                          <p className="text-[12px] tabular-nums text-muted-foreground">{formatDate(req.created_at)}</p>
                        </TableCell>
                        <TableCell className="py-3.5 pr-5 text-right align-top">
                          <div className="flex flex-col items-end gap-1.5">
                            <StatusBadge label={PURCHASE_REQUEST_STATUS_LABELS[req.status] ?? req.status} variant={statusVariant(req.status)} dot />
                            {waited ? (
                              <span className={cn("text-[12px] tabular-nums", waited.stale ? "font-medium text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>Chờ {waited.text}</span>
                            ) : req.approved_at && (req.status === "APPROVED" || req.status === "CONVERTED") ? (
                              <span className="text-[12px] tabular-nums text-muted-foreground" title={personName(req.approved_by_user_id)}>Duyệt {formatShortDate(req.approved_at)}</span>
                            ) : req.rejected_at && req.status === "REJECTED" ? (
                              <span className="text-[12px] tabular-nums text-muted-foreground" title={personName(req.rejected_by_user_id)}>Từ chối {formatShortDate(req.rejected_at)}</span>
                            ) : null}
                            {req.status === "PENDING" && (
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <Button type="button" size="sm" variant="ghost" disabled={acting}
                                  onClick={() => setRowAction({ type: "reject", id: req.id, value: "" })}
                                  className="h-9 px-2.5 text-[13px] text-muted-foreground hover:text-red-700 sm:h-8 dark:hover:text-red-400">
                                  Từ chối
                                </Button>
                                <Button type="button" size="sm" disabled={acting} onClick={() => setApproveTarget(req)}
                                  data-testid="approve-purchase-request-button"
                                  className="h-9 px-3 text-[13px] sm:h-8">
                                  <Check className="h-3.5 w-3.5" /> Duyệt
                                </Button>
                              </div>
                            )}
                            {req.status === "APPROVED" && !req.purchase_order_id && (
                              <Button type="button" size="sm" disabled={acting}
                                onClick={() => setRowAction({ type: "convert", id: req.id, value: "" })}
                                data-testid="convert-request-to-po-button"
                                className="h-9 px-3 text-[13px] sm:h-8">
                                <ArrowRight className="h-3.5 w-3.5" /> Chuyển thành PO
                              </Button>
                            )}
                            {req.status === "CONVERTED" && req.purchase_order_id && (
                              <Link to={`/purchase-orders/${req.purchase_order_id}`} className="rounded font-mono text-[12px] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                                {req.purchase_orders?.po_number ?? req.purchase_order_id.slice(-8)}
                              </Link>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {!loading && filteredRequests.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-muted-foreground">
                Hiển thị <span className="font-medium tabular-nums text-foreground">{(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + pagedRequests.length}</span> trong {filteredRequests.length} yêu cầu
              </p>
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
          )}
        </section>
      </FadeItem>

      {/* Reject and convert open beside the list instead of as inserted table rows. */}
      <Dialog open={Boolean(rowAction && actionTarget)} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <DialogContent className="sm:max-w-lg">
          {rowAction && actionTarget ? (
            <>
              <DialogHeader>
                <DialogTitle>{rowAction.type === "reject" ? "Từ chối yêu cầu" : "Chuyển thành đơn đặt hàng"}</DialogTitle>
                <DialogDescription>
                  {actionTarget.request_number}: {actionTarget.quantity_requested} cuốn {titleOf(actionTarget) ?? "chưa xác định sách"} cho {actionTarget.warehouses?.code || "kho chưa rõ"}.
                </DialogDescription>
              </DialogHeader>

              {rowAction.type === "reject" ? (
                <div className="space-y-1.5">
                  <label htmlFor="pr-reject-reason" className="text-[13px] font-medium text-foreground">Lý do từ chối <span className="font-normal text-muted-foreground">(không bắt buộc)</span></label>
                  <input
                    id="pr-reject-reason"
                    type="text"
                    className="h-10 w-full rounded-md border border-input bg-input-background px-3 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-muted/40"
                    placeholder="Ví dụ: kho còn đủ hàng ở chi nhánh khác"
                    value={rowAction.value}
                    onChange={(e) => setRowAction({ ...rowAction, value: e.target.value })}
                  />
                  <p className="text-[12px] text-muted-foreground">Nhân viên gửi yêu cầu sẽ thấy lý do này.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Nếu request chưa có book_variant_id, yêu cầu chọn biến thể */}
                  {!actionTarget.book_variant_id && (
                    <div className="space-y-1.5">
                      <p className="text-[13px] font-medium text-foreground">Đầu sách</p>
                      <p className="text-[12px] text-muted-foreground">
                        Nhân viên ghi: <span className="italic">{actionTarget.book_title_hint || "Chưa rõ"}</span>. Chọn đúng đầu sách trong danh mục để tạo PO.
                      </p>
                      {rowAction.variantId ? (
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px]">
                            <Check className="mr-1 inline h-3.5 w-3.5 text-primary" aria-hidden="true" />{rowAction.variantLabel}
                          </span>
                          <Button type="button" size="sm" variant="outline"
                            onClick={() => setRowAction({ ...rowAction, variantId: undefined, variantLabel: undefined })}>
                            Đổi sách
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                            <input
                              type="text"
                              className="h-10 w-full rounded-md border border-input bg-input-background pl-9 pr-3 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-muted/40"
                              placeholder="Tìm sách theo tên, ISBN13..."
                              aria-label="Tìm đầu sách"
                              value={variantQuery}
                              onChange={(e) => setVariantQuery(e.target.value)}
                              autoFocus
                              data-testid="convert-po-variant-search"
                            />
                          </div>
                          {variantQuery.length >= 2 && (
                            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border">
                              {searchingVariant ? (
                                <p className="px-3 py-2 text-[13px] text-muted-foreground">Đang tìm...</p>
                              ) : variantResults.length === 0 ? (
                                <p className="px-3 py-2 text-[13px] text-muted-foreground">Không tìm thấy sách</p>
                              ) : variantResults.map((v) => (
                                <button
                                  key={v.variant_id}
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-[13px] transition-colors hover:bg-primary/[0.06] focus-visible:bg-primary/[0.06] focus-visible:outline-none"
                                  onClick={() => {
                                    setRowAction({ ...rowAction, variantId: v.variant_id, variantLabel: `${v.title}${v.isbn13 ? ` (${v.isbn13})` : ""}` });
                                    setVariantQuery("");
                                    setVariantResults([]);
                                  }}
                                >
                                  <span className="font-medium">{v.title}</span>
                                  {v.isbn13 && <span className="ml-2 font-mono text-[12px] text-muted-foreground">{v.isbn13}</span>}
                                  {v.sku && <span className="ml-2 font-mono text-[12px] text-muted-foreground">{v.sku}</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label htmlFor="pr-convert-supplier" className="text-[13px] font-medium text-foreground">Nhà cung cấp</label>
                    <select
                      id="pr-convert-supplier"
                      className="h-10 w-full rounded-md border border-input bg-input-background px-3 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-muted/40"
                      value={rowAction.value}
                      onChange={(e) => setRowAction({ ...rowAction, value: e.target.value })}
                      data-testid="convert-po-supplier-select"
                    >
                      <option value="">-- Chọn nhà cung cấp --</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeAction} disabled={acting}>Hủy</Button>
                {rowAction.type === "reject" ? (
                  <Button type="button" variant="destructive" disabled={acting} loading={acting} onClick={() => void handleReject()}>
                    Xác nhận từ chối
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={acting || !rowAction.value || (!actionTarget.book_variant_id && !rowAction.variantId)}
                    loading={acting}
                    onClick={() => void handleConvert()}
                    data-testid="create-po-from-request-button"
                  >
                    Tạo đơn đặt hàng
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!approveTarget}
        onOpenChange={(open) => { if (!open && !acting) setApproveTarget(null); }}
        title="Duyệt yêu cầu mua hàng?"
        description={approveTarget ? `Yêu cầu ${approveTarget.request_number} sẽ được duyệt và có thể chuyển thành đơn đặt hàng.` : undefined}
        confirmLabel="Duyệt"
        cancelLabel="Hủy"
        variant="default"
        loading={acting}
        onConfirm={() => {
          if (approveTarget) return handleApprove(approveTarget.id);
          return undefined;
        }}
      />
    </PageWrapper>
  );
}
