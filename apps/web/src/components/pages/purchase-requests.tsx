import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, RefreshCw, Check, X, ArrowRight, Search } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { getStatusVariant } from "@/lib/status-registry";

const REASONS: Record<string, string> = {
  LOW_STOCK: "Tồn kho thấp",
  CUSTOMER_REQUEST: "Yêu cầu khách hàng",
  DAMAGED: "Sách hư hỏng",
  LOST: "Mất sách",
  OTHER: "Lý do khác",
};

const STATUS_FILTERS = ["ALL", "PENDING", "APPROVED", "REJECTED", "CONVERTED"];
const PAGE_SIZE = 10;

function statusVariant(status: string) {
  return getStatusVariant("purchaseRequest", status);
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

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ClipboardCheck}
          title="Yêu cầu mua hàng"
          description="Xem xét và xử lý yêu cầu mua hàng từ nhân viên kho"
          iconBg="bg-indigo-100 dark:bg-indigo-500/15"
          iconColor="text-indigo-700 dark:text-indigo-400"
          actions={(
            <Button type="button" variant="outline" size="sm" onClick={() => void load(statusFilter)} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          )}
        />
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-[15px] font-semibold">Danh sách yêu cầu</h2>
          </div>

          <div className="px-5 pt-4">
            <FilterBar
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Tìm theo mã yêu cầu, kho hoặc tên sách..."
              filters={(
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[170px]" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTERS.map((s) => (
                      <SelectItem key={s} value={s}>{s === "ALL" ? "Tất cả trạng thái" : s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {["Mã yêu cầu", "Kho", "Sách / Gợi ý", "Số lượng", "Lý do", "Người tạo", "Trạng thái", "Tạo lúc", "Thao tác"].map((h) => (
                    <TableHead key={h} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonTableRow columns={9} rows={4} />
                ) : pagedRequests.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="whitespace-normal px-5 py-10">
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
                    </TableCell>
                  </TableRow>
                ) : pagedRequests.map((req) => (
                  <Fragment key={req.id}>
                    <TableRow className="hover:bg-muted/30">
                      <TableCell className="text-[12px] font-mono text-muted-foreground">{req.request_number}</TableCell>
                      <TableCell className="text-[13px]">{req.warehouses?.code || "-"}</TableCell>
                      <TableCell className="whitespace-normal text-[13px]">
                        {req.book_variants?.books?.title || req.book_title_hint || <span className="text-muted-foreground italic">Chưa xác định</span>}
                        {req.book_variants?.sku && <span className="block text-[11px] text-muted-foreground">{req.book_variants.sku}</span>}
                      </TableCell>
                      <TableCell className="text-[13px] font-medium">{req.quantity_requested}</TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">{REASONS[req.reason] || req.reason}</TableCell>
                      <TableCell className="text-[11px] font-mono text-muted-foreground">{req.created_by_user_id.slice(-8)}</TableCell>
                      <TableCell>
                        <StatusBadge label={req.status} variant={statusVariant(req.status)} dot />
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">{formatDate(req.created_at)}</TableCell>
                      <TableCell className="text-[12px]">
                        {req.status === "PENDING" && (
                          <div className="flex gap-1.5">
                            <Button type="button" size="sm" disabled={acting} onClick={() => setApproveTarget(req)}
                              className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700">
                              <Check className="h-3 w-3" /> Duyệt
                            </Button>
                            <Button type="button" size="sm" variant="outline" disabled={acting}
                              onClick={() => setRowAction(rowAction?.id === req.id && rowAction.type === "reject" ? null : { type: "reject", id: req.id, value: "" })}
                              className="h-7 px-2 text-[11px] border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/10">
                              <X className="h-3 w-3" /> Từ chối
                            </Button>
                          </div>
                        )}
                        {req.status === "APPROVED" && !req.purchase_order_id && (
                          <Button type="button" size="sm" disabled={acting}
                            onClick={() => setRowAction(rowAction?.id === req.id && rowAction.type === "convert" ? null : { type: "convert", id: req.id, value: "" })}
                            className="h-7 px-2 text-[11px] bg-indigo-600 hover:bg-indigo-700">
                            <ArrowRight className="h-3 w-3" /> Chuyển thành PO
                          </Button>
                        )}
                        {req.status === "CONVERTED" && req.purchase_order_id && (
                          <span className="text-[11px] text-muted-foreground font-mono">{req.purchase_order_id.slice(-8)}</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {rowAction?.id === req.id && rowAction.type === "reject" && (
                      <tr key={`${req.id}-reject`} className="bg-red-50/50 dark:bg-red-500/5 border-b border-border">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              className="flex-1 rounded-md border border-red-200 bg-card px-3 py-1.5 text-[13px] dark:border-red-500/20"
                              placeholder="Lý do từ chối (tùy chọn)..."
                              value={rowAction.value}
                              onChange={(e) => setRowAction({ ...rowAction, value: e.target.value })}
                            />
                            <Button type="button" size="sm" disabled={acting} onClick={() => void handleReject()}
                              className="bg-red-600 hover:bg-red-700 h-7 px-3 text-[11px]">
                              Xác nhận từ chối
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setRowAction(null)} aria-label="Hủy" className="h-7 px-2">
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {rowAction?.id === req.id && rowAction.type === "convert" && (
                      <tr key={`${req.id}-convert`} className="bg-indigo-50/50 dark:bg-indigo-500/5 border-b border-border">
                        <td colSpan={9} className="px-4 py-3 space-y-2">
                          {/* Nếu request chưa có book_variant_id, yêu cầu chọn biến thể */}
                          {!req.book_variant_id && (
                            <div className="space-y-1.5">
                              <p className="text-[11px] font-semibold text-indigo-800 dark:text-indigo-300">
                                Sách yêu cầu: <span className="font-normal italic">{req.book_title_hint || "Chưa rõ"}</span>
                                {" "}— Cần chọn biến thể cụ thể để tạo PO:
                              </p>
                              {rowAction.variantId ? (
                                <div className="flex items-center gap-2">
                                  <span className="rounded-md border border-indigo-200 bg-card px-3 py-1.5 text-[13px] flex-1 max-w-sm dark:border-indigo-500/20">
                                    ✓ {rowAction.variantLabel}
                                  </span>
                                  <Button type="button" size="sm" variant="outline"
                                    onClick={() => setRowAction({ ...rowAction, variantId: undefined, variantLabel: undefined })}
                                    className="h-7 px-2 text-[11px]">
                                    Đổi sách
                                  </Button>
                                </div>
                              ) : (
                                <div className="relative max-w-sm">
                                  <div className="relative">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                    <input
                                      type="text"
                                      className="w-full rounded-md border border-indigo-200 bg-card pl-7 pr-3 py-1.5 text-[13px] dark:border-indigo-500/20"
                                      placeholder="Tìm sách theo tên, ISBN13..."
                                      value={variantQuery}
                                      onChange={(e) => setVariantQuery(e.target.value)}
                                      autoFocus
                                    />
                                  </div>
                                  {variantQuery.length >= 2 && (
                                    <div className="absolute z-20 mt-1 w-full rounded-md border border-indigo-200 bg-card shadow-lg max-h-48 overflow-y-auto dark:border-indigo-500/20">
                                      {searchingVariant ? (
                                        <p className="px-3 py-2 text-[12px] text-muted-foreground">Đang tìm...</p>
                                      ) : variantResults.length === 0 ? (
                                        <p className="px-3 py-2 text-[12px] text-muted-foreground">Không tìm thấy sách</p>
                                      ) : variantResults.map((v) => (
                                        <button
                                          key={v.variant_id}
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-[12px] hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                                          onClick={() => {
                                            setRowAction({ ...rowAction, variantId: v.variant_id, variantLabel: `${v.title}${v.isbn13 ? ` (${v.isbn13})` : ""}` });
                                            setVariantQuery("");
                                            setVariantResults([]);
                                          }}
                                        >
                                          <span className="font-medium">{v.title}</span>
                                          {v.isbn13 && <span className="ml-2 text-muted-foreground text-[11px]">{v.isbn13}</span>}
                                          {v.sku && <span className="ml-2 text-muted-foreground text-[11px]">{v.sku}</span>}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <select
                              className="flex-1 max-w-xs rounded-md border border-indigo-200 bg-card px-3 py-1.5 text-[13px] dark:border-indigo-500/20"
                              value={rowAction.value}
                              onChange={(e) => setRowAction({ ...rowAction, value: e.target.value })}
                            >
                              <option value="">-- Chọn nhà cung cấp --</option>
                              {suppliers.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                            <Button
                              type="button" size="sm"
                              disabled={acting || !rowAction.value || (!req.book_variant_id && !rowAction.variantId)}
                              onClick={() => void handleConvert()}
                              className="bg-indigo-600 hover:bg-indigo-700 h-7 px-3 text-[11px]">
                              Tạo đơn đặt hàng
                            </Button>
                            <Button type="button" size="sm" variant="outline"
                              onClick={() => { setRowAction(null); setVariantQuery(""); setVariantResults([]); }}
                              aria-label="Hủy"
                              className="h-7 px-2">
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {!loading && filteredRequests.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-muted-foreground">
                Hiển thị <span className="font-medium text-foreground">{pagedRequests.length}</span> / {filteredRequests.length} yêu cầu
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
        </SectionCard>
      </FadeItem>

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
