import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import { AlertTriangle, ArrowLeft, CheckCircle, RefreshCw, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { FadeItem, PageWrapper } from "../motion-utils";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/loading-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { getPaginationRange } from "@/lib/pagination";
import { cn } from "@/components/ui/utils";
import { getApiErrorMessage } from "@/services/api";
import { authService } from "@/services/auth";
import { exceptionReportService, type ExceptionReport } from "@/services/exception-reports";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { getStatusVariant } from "@/lib/status-registry";
import { timeAgo } from "@/lib/time-ago";

const TASK_TYPE_LABELS: Record<string, string> = {
  RECEIVING: "Tiếp nhận",
  PUTAWAY: "Cất vào kho",
  PICKING: "Lấy hàng",
  OUTBOUND: "Xuất kho",
};

const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  SHORT: "Thiếu hàng",
  OVERAGE: "Dư hàng",
  DAMAGED: "Hư hỏng",
  WRONG_ITEM: "Sai sản phẩm",
  WRONG_QTY: "Sai số lượng",
  OTHER: "Khác",
};

const STATUS_FILTERS = ["ALL", "OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
const STATUS_LABELS: Record<string, string> = {
  ALL: "Tất cả",
  OPEN: "Đang mở",
  ACKNOWLEDGED: "Đã tiếp nhận",
  RESOLVED: "Đã xử lý",
  DISMISSED: "Đã bỏ qua",
};

const PAGE_SIZE = 20;
// Backend has no hard cap on `limit` (see exception-report.controller.js) — fetch a generous
// bounded batch instead of the previous default (limit=50), which silently truncated the list.
const FETCH_LIMIT = 200;

function statusVariant(status: string) {
  return getStatusVariant("exceptionReport", status);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "17 ngày trước", "hôm qua", "vừa xong" or "ngày 08/09/2026": the age as a phrase inside a sentence. */
function ageText(value: string | null | undefined) {
  const t = timeAgo(value);
  if (t.includes("/")) return `ngày ${t}`;
  if (t === "Hôm qua" || t === "Vừa xong") return t.toLowerCase();
  return `${t} trước`;
}

/** Expected → actual, with the actual figure signalled only when it differs. */
function QtyChange({ report, size = "sm" }: { report: ExceptionReport; size?: "sm" | "lg" }) {
  if (report.expected_qty === null || report.actual_qty === null) return null;
  const delta = report.actual_qty - report.expected_qty;
  const tone = delta < 0 ? "text-red-700 dark:text-red-400" : delta > 0 ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground";
  if (size === "sm") {
    return (
      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
        {report.expected_qty} → <span className={cn("font-semibold", tone)}>{report.actual_qty}</span>
      </span>
    );
  }
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      <div>
        <dt className="text-[13px] text-muted-foreground">Theo chứng từ</dt>
        <dd className="font-serif text-[24px] font-semibold leading-tight tabular-nums text-foreground">{report.expected_qty}<span className="font-sans text-[13px] font-normal text-muted-foreground"> cuốn</span></dd>
      </div>
      <div>
        <dt className="text-[13px] text-muted-foreground">Thực tế</dt>
        <dd className="font-serif text-[24px] font-semibold leading-tight tabular-nums text-foreground">{report.actual_qty}<span className="font-sans text-[13px] font-normal text-muted-foreground"> cuốn</span></dd>
      </div>
      <div>
        <dt className="text-[13px] text-muted-foreground">Chênh lệch</dt>
        <dd className={cn("font-serif text-[24px] font-semibold leading-tight tabular-nums", tone)}>
          {delta === 0 ? "0" : delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
        </dd>
      </div>
    </dl>
  );
}

export function ExceptionReportsPage() {
  const [reports, setReports] = useState<ExceptionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [resolveState, setResolveState] = useState<{ id: string; notes: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
  const [assignState, setAssignState] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await exceptionReportService.getAll({ limit: FETCH_LIMIT });
      setReports(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được danh sách báo cáo sự cố"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    void userService.getWarehouseStaff().then((res) => {
      setWarehouseStaff(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
  }, []);

  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const stats = useMemo(() => ({
    total: reports.length,
    open: reports.filter((r) => r.status === "OPEN").length,
    acknowledged: reports.filter((r) => r.status === "ACKNOWLEDGED").length,
    resolved: reports.filter((r) => r.status === "RESOLVED").length,
  }), [reports]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const byStatus = statusFilter === "ALL" ? reports : reports.filter((r) => r.status === statusFilter);
    if (!keyword) return byStatus;
    return byStatus.filter((r) => (
      r.report_number.toLowerCase().includes(keyword)
      || r.warehouses?.code?.toLowerCase().includes(keyword)
      || r.warehouses?.name?.toLowerCase().includes(keyword)
      || r.note?.toLowerCase().includes(keyword)
      || (TASK_TYPE_LABELS[r.task_type] || r.task_type).toLowerCase().includes(keyword)
      || (EXCEPTION_TYPE_LABELS[r.exception_type] || r.exception_type).toLowerCase().includes(keyword)
    ));
  }, [reports, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleAssign = async (reportId: string) => {
    const staffId = assignState[reportId];
    if (!staffId) {
      toast.error("Chọn nhân viên trước khi giao");
      return;
    }
    setAssigningId(reportId);
    try {
      await exceptionReportService.assign(reportId, staffId);
      toast.success("Đã giao task xử lý cho nhân viên");
      void load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Giao task thất bại"));
    } finally {
      setAssigningId("");
    }
  };

  const handleResolve = async () => {
    if (!resolveState) return;
    setResolving(true);
    try {
      await exceptionReportService.resolve(resolveState.id, resolveState.notes || undefined);
      toast.success("Đã xử lý báo cáo sự cố");
      setResolveState(null);
      void load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Xử lý thất bại"));
    } finally {
      setResolving(false);
    }
  };

  // Which report the right pane shows. On wide screens the first row opens by default;
  // on a phone the list shows alone until a row is chosen (one region at a time).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentUser = authService.getCurrentUser();
  const staffNames = useMemo(() => new Map(warehouseStaff.map((s) => [s.id, s.full_name || s.username])), [warehouseStaff]);
  const personName = (userId: string | null | undefined) => {
    if (!userId) return null;
    if (currentUser?.id === userId) return "Bạn";
    return staffNames.get(userId) ?? "Người dùng khác";
  };
  const selected = reports.find((r) => r.id === selectedId) ?? paged[0] ?? null;
  const openReports = reports.filter((r) => r.status === "OPEN");
  const oldestOpen = openReports.reduce<string | null>((oldest, r) => (!oldest || r.created_at < oldest ? r.created_at : oldest), null);
  const unassignedOpen = openReports.filter((r) => !r.assigned_to_user_id).length;
  const lede = loading
    ? "Báo cáo thiếu, dư, hư hỏng hoặc sai sách từ nhân viên kho."
    : stats.total === 0
      ? "Chưa có báo cáo sự cố nào."
      : stats.open === 0
        ? `Không còn báo cáo nào đang mở. ${stats.resolved} báo cáo đã xử lý.`
        : `${stats.open} báo cáo đang mở (cũ nhất ${ageText(oldestOpen)})${unassignedOpen > 0 ? `, ${unassignedOpen} chưa giao người xử lý` : ""}.`;
  const tabs = [
    { value: "OPEN" as const, count: stats.open },
    { value: "ACKNOWLEDGED" as const, count: stats.acknowledged },
    { value: "RESOLVED" as const, count: stats.resolved },
    { value: "ALL" as const, count: stats.total },
  ];
  const exceptionLabel = (r: ExceptionReport) => EXCEPTION_TYPE_LABELS[r.exception_type] || r.exception_type;
  const bookTitle = (r: ExceptionReport) => r.book_variants?.books?.title ?? null;

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={AlertTriangle}
          title="Báo cáo sự cố"
          description={lede}
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Làm mới
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            {/* The queue */}
            <section
              aria-labelledby="exception-queue-title"
              className={cn("min-w-0 overflow-hidden rounded-2xl border border-border bg-card", selectedId ? "hidden @4xl/page:block" : "block")}
            >
              <h2 id="exception-queue-title" className="sr-only">Danh sách báo cáo</h2>
              <div role="tablist" aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-x-1 border-b border-border px-3 pt-2">
                {tabs.map((tab) => {
                  const active = statusFilter === tab.value;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setStatusFilter(tab.value)}
                      className={cn(
                        "-mb-px shrink-0 border-b-2 px-2 pb-2.5 pt-2 text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab.value === "ACKNOWLEDGED" ? "Đã nhận" : STATUS_LABELS[tab.value]} <span className="tabular-nums text-muted-foreground">{tab.count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="border-b border-border px-3 py-3">
                <FilterBar searchValue={query} onSearchChange={setQuery} searchPlaceholder="Mã, kho, mô tả hoặc loại" showSearchClear />
              </div>

              {loading ? (
                <ul aria-busy="true">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <li key={i} className="border-b border-border px-4 py-3.5 last:border-0">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="mt-2 h-3.5 w-56 max-w-full" />
                    </li>
                  ))}
                </ul>
              ) : paged.length === 0 ? (
                <EmptyState
                  icon={AlertTriangle}
                  variant={filtered.length === 0 && reports.length > 0 ? "no-results" : "no-data"}
                  title={reports.length === 0 ? "Chưa có báo cáo sự cố" : "Không có báo cáo nào ở đây"}
                  description={reports.length === 0 ? "Báo cáo từ nhân viên kho sẽ hiện ở đây." : "Thử trạng thái khác hoặc đổi từ khóa."}
                  className="py-10"
                />
              ) : (
                <ul>
                  {paged.map((r) => {
                    const active = selected?.id === r.id;
                    const open = r.status === "OPEN";
                    return (
                      <li key={r.id} className="border-b border-border last:border-0">
                        <button
                          type="button"
                          onClick={() => setSelectedId(r.id)}
                          aria-current={active ? "true" : undefined}
                          className={cn(
                            "w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            active ? "bg-muted" : "hover:bg-muted/50",
                          )}
                        >
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2">
                              {open && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" aria-label="Đang mở" />}
                              <span className={cn("truncate text-[14px] text-foreground", open ? "font-semibold" : "font-medium")}>
                                {exceptionLabel(r)}{bookTitle(r) ? `: ${bookTitle(r)}` : ""}
                              </span>
                            </span>
                            <span className={cn("shrink-0 text-[12px] tabular-nums", active ? "text-foreground/75" : "text-muted-foreground")} title={formatDate(r.created_at)}>{timeAgo(r.created_at)}</span>
                          </span>
                          {/* On the selected row's grey fill, muted grey drops under 4.5:1, so meta takes a darker ink there. */}
                          <span className={cn("mt-0.5 block truncate text-[13px]", active ? "text-foreground/75" : "text-muted-foreground")}>
                            {r.warehouses?.code || r.warehouses?.name || "-"}, {TASK_TYPE_LABELS[r.task_type] || r.task_type}
                            {r.expected_qty !== null && r.actual_qty !== null ? <>, <QtyChange report={r} /></> : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-foreground/80" title={r.note}>{r.note || "-"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!loading && filtered.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
                  <p className="text-[13px] text-muted-foreground" aria-live="polite">
                    {(currentPage - 1) * PAGE_SIZE + 1}–{(currentPage - 1) * PAGE_SIZE + paged.length} trong {filtered.length} báo cáo
                  </p>
                  {totalPages > 1 && (
                    <Pagination className="mx-0 w-auto justify-start">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={(event) => {
                              event.preventDefault();
                              setPage((current) => Math.max(1, current - 1));
                            }}
                            className={cn("cursor-pointer", currentPage === 1 && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                        {getPaginationRange(currentPage, totalPages).map((item, i) => (
                          <PaginationItem key={typeof item === "number" ? item : `${item}-${i}`}>
                            {typeof item === "number" ? (
                              <PaginationLink
                                isActive={item === currentPage}
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
                            className={cn("cursor-pointer", currentPage === totalPages && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  )}
                </div>
              )}
            </section>

            {/* The open report */}
            <section
              aria-labelledby="exception-detail-title"
              className={cn("@container min-w-0 rounded-2xl border border-border bg-card @4xl/page:sticky @4xl/page:top-4", selectedId ? "block" : "hidden @4xl/page:block")}
            >
              {loading ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-72 max-w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : !selected ? (
                <div className="p-5">
                  <h2 id="exception-detail-title" className="text-[16px] font-semibold text-foreground">Chưa chọn báo cáo</h2>
                  <p className="mt-1 text-[14px] text-muted-foreground">Chọn một báo cáo trong danh sách để xem chi tiết và xử lý.</p>
                </div>
              ) : (
                <ReportDetail
                  report={selected}
                  exceptionLabel={exceptionLabel(selected)}
                  personName={personName}
                  onBack={() => setSelectedId(null)}
                  onPreview={setPreviewUrl}
                  warehouseStaff={warehouseStaff}
                  // A current assignee outside the warehouse-staff list (e.g. an admin) would leave the select blank.
                  assignValue={assignState[selected.id] || (staffNames.has(selected.assigned_to_user_id ?? "") ? selected.assigned_to_user_id! : "")}
                  onAssignChange={(value) => setAssignState((prev) => ({ ...prev, [selected.id]: value }))}
                  assigning={assigningId === selected.id}
                  onAssign={() => void handleAssign(selected.id)}
                  resolveNotes={resolveState?.id === selected.id ? resolveState.notes : null}
                  onResolveStart={() => setResolveState({ id: selected.id, notes: "" })}
                  onResolveNotes={(notes) => setResolveState({ id: selected.id, notes })}
                  onResolveCancel={() => setResolveState(null)}
                  resolving={resolving}
                  onResolve={() => void handleResolve()}
                />
              )}
            </section>
          </div>
        </div>
      </FadeItem>

      {previewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ảnh bằng chứng sự cố"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="Ảnh bằng chứng sự cố"
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            aria-label="Đóng"
            className="absolute right-6 top-6 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </PageWrapper>
  );
}

function ReportDetail({
  report: r,
  exceptionLabel,
  personName,
  onBack,
  onPreview,
  warehouseStaff,
  assignValue,
  onAssignChange,
  assigning,
  onAssign,
  resolveNotes,
  onResolveStart,
  onResolveNotes,
  onResolveCancel,
  resolving,
  onResolve,
}: {
  report: ExceptionReport;
  exceptionLabel: string;
  personName: (userId: string | null | undefined) => string | null;
  onBack: () => void;
  onPreview: (url: string) => void;
  warehouseStaff: WarehouseStaffOption[];
  assignValue: string;
  onAssignChange: (value: string) => void;
  assigning: boolean;
  onAssign: () => void;
  resolveNotes: string | null;
  onResolveStart: () => void;
  onResolveNotes: (notes: string) => void;
  onResolveCancel: () => void;
  resolving: boolean;
  onResolve: () => void;
}) {
  const book = r.book_variants;
  const resolved = r.status === "RESOLVED";
  const details: Array<{ label: string; value: ReactNode }> = [
    { label: "Kho", value: r.warehouses ? `${r.warehouses.name} (${r.warehouses.code})` : "-" },
    { label: "Công việc", value: <>{TASK_TYPE_LABELS[r.task_type] || r.task_type} <span className="font-mono text-[12px] text-muted-foreground" title={r.task_id}>{r.task_id.slice(0, 8)}</span></> },
    ...(r.goods_receipt_id ? [{ label: "Phiếu nhập", value: <NavLink to={`/orders/${r.goods_receipt_id}`} className="font-medium text-primary underline-offset-4 hover:underline">Mở phiếu nhập</NavLink> }] : []),
    ...(book ? [{ label: "Sách", value: <>{book.books?.title ?? "-"}<span className="block font-mono text-[12px] text-muted-foreground">{[book.isbn13, book.sku].filter(Boolean).join(", ")}</span></> }] : []),
    { label: "Người báo", value: personName(r.created_by_user_id) ?? "-" },
    { label: "Báo lúc", value: formatDate(r.created_at) },
    { label: "Giao cho", value: r.assigned_to_user_id ? <>{personName(r.assigned_to_user_id)}<span className="block text-[12px] text-muted-foreground">{formatDate(r.assigned_at)}</span></> : <span className="text-muted-foreground">Chưa giao</span> },
    ...(resolved ? [{ label: "Xử lý bởi", value: <>{personName(r.resolved_by_user_id) ?? "-"}<span className="block text-[12px] text-muted-foreground">{formatDate(r.resolved_at)}</span></> }] : []),
  ];

  return (
    <div>
      <div className="border-b border-border p-5">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3 mb-2 text-muted-foreground @4xl/page:hidden">
          <ArrowLeft className="h-4 w-4" /> Danh sách báo cáo
        </Button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 id="exception-detail-title" className="text-[20px] font-semibold tracking-tight text-foreground">{exceptionLabel}</h2>
          <StatusBadge label={STATUS_LABELS[r.status] ?? r.status} variant={statusVariant(r.status)} dot />
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">
          <span className="font-mono text-[13px]">{r.report_number}</span>, báo {ageText(r.created_at)}
        </p>
      </div>

      <div className="grid grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-5 p-5">
          {r.expected_qty !== null && r.actual_qty !== null && <QtyChange report={r} size="lg" />}

          <div>
            <h3 className="text-[13px] text-muted-foreground">Mô tả từ nhân viên</h3>
            <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-foreground">{r.note || "-"}</p>
          </div>
          {r.evidence_notes && (
            <div>
              <h3 className="text-[13px] text-muted-foreground">Ghi chú bằng chứng</h3>
              <p className="mt-1 whitespace-pre-line text-[14px] text-foreground">{r.evidence_notes}</p>
            </div>
          )}
          {r.evidence_photo_url && (
            <div>
              <h3 className="text-[13px] text-muted-foreground">Ảnh bằng chứng</h3>
              <button
                type="button"
                onClick={() => onPreview(r.evidence_photo_url!)}
                className="mt-1.5 block overflow-hidden rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Phóng to ảnh bằng chứng"
              >
                <img src={r.evidence_photo_url} alt="Ảnh bằng chứng sự cố" className="h-32 w-44 bg-muted object-cover" />
              </button>
            </div>
          )}

          {resolved ? (
            <div className="rounded-xl bg-muted/50 p-4">
              <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
                <CheckCircle className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> Kết quả xử lý
              </h3>
              <p className="mt-1 whitespace-pre-line text-[14px] text-foreground">{r.resolution_notes || "Không có ghi chú."}</p>
            </div>
          ) : (
            <div className="space-y-4 border-t border-border pt-5">
              {warehouseStaff.length > 0 && (
                <div>
                  <label htmlFor="exception-assignee" className="mb-1.5 block text-[14px] font-medium text-foreground">Người xử lý</label>
                  <div className="flex max-w-md items-center gap-2">
                    <Select value={assignValue} onValueChange={onAssignChange}>
                      <SelectTrigger id="exception-assignee" className="min-w-0 flex-1">
                        <SelectValue placeholder="Chọn nhân viên" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouseStaff.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={onAssign} disabled={assigning} loading={assigning} className="shrink-0">
                      <UserCheck className="h-4 w-4" /> Giao
                    </Button>
                  </div>
                </div>
              )}

              {resolveNotes === null ? (
                <Button onClick={onResolveStart} disabled={resolving}>
                  <CheckCircle className="h-4 w-4" /> Đánh dấu đã xử lý
                </Button>
              ) : (
                <div>
                  <label htmlFor="exception-resolution" className="mb-1.5 block text-[14px] font-medium text-foreground">Ghi chú xử lý <span className="font-normal text-muted-foreground">(không bắt buộc)</span></label>
                  <Input
                    id="exception-resolution"
                    placeholder="Ví dụ: đã liên hệ nhà cung cấp gửi bù"
                    value={resolveNotes}
                    onChange={(e) => onResolveNotes(e.target.value)}
                    className="h-10"
                  />
                  <div className="mt-3 flex items-center gap-2">
                    <Button onClick={onResolve} disabled={resolving} loading={resolving}>Xác nhận đã xử lý</Button>
                    <Button variant="ghost" onClick={onResolveCancel}>Hủy</Button>
                  </div>
                </div>
              )}
              <p className="text-[13px] text-muted-foreground">
                Xử lý báo cáo không tự điều chỉnh tồn kho. Nếu cần sửa số tồn, dùng kiểm kê kho hoặc điều chỉnh tồn riêng.
              </p>
            </div>
          )}
        </div>

        <dl className="border-t border-border p-5 @3xl:border-l @3xl:border-t-0">
          {details.map((item) => (
            <div key={item.label} className="flex items-baseline justify-between gap-4 py-1.5 @3xl:block">
              <dt className="shrink-0 text-[13px] text-muted-foreground">{item.label}</dt>
              <dd className="min-w-0 text-right text-[14px] text-foreground @3xl:mt-0.5 @3xl:text-left">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
