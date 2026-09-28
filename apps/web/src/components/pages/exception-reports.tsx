import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, ImageIcon, RefreshCw, CheckCircle, X, UserCheck, Info } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
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
import { exceptionReportService, type ExceptionReport } from "@/services/exception-reports";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { getStatusVariant } from "@/lib/status-registry";

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

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24 }}
      >
        <PageHeader
          icon={AlertTriangle}
          title="Báo cáo sự cố"
          description="Xem xét và xử lý báo cáo thiếu, dư, hư hỏng từ nhân viên kho"
          iconBg="bg-red-50 dark:bg-red-500/10"
          iconColor="text-red-700 dark:text-red-400"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.05 }}
        className="space-y-3"
      >
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Tìm mã báo cáo, kho, mô tả..."
          showSearchClear
          filters={
            <div className="max-w-full overflow-x-auto">
              <SegmentedControl
                layoutId="exception-status-filter"
                value={statusFilter}
                onChange={setStatusFilter}
                options={STATUS_FILTERS.map((status) => ({
                  value: status,
                  label: `${STATUS_LABELS[status] ?? status} (${status === "ALL" ? stats.total : stats[status === "OPEN" ? "open" : status === "ACKNOWLEDGED" ? "acknowledged" : "resolved"]})`,
                }))}
                gradientClassName="from-red-600 to-rose-600"
                className="w-max"
              />
            </div>
          }
        />
        <p className="flex items-start gap-2 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Xử lý báo cáo sự cố không tự động điều chỉnh tồn kho. Nếu cần chỉnh tồn kho, dùng chức năng điều chỉnh tồn (Stock Adjustment) riêng.
        </p>
      </motion.div>

      <SectionCard noPadding>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {[
                  { label: "Báo cáo", className: "" },
                  { label: "Sự cố", className: "hidden w-[170px] sm:table-cell" },
                  { label: "Trạng thái", className: "hidden w-[170px] md:table-cell" },
                  { label: "Giao xử lý", className: "hidden w-[200px] xl:table-cell" },
                  { label: "Thao tác", className: "w-[110px] text-right" },
                ].map((h) => (
                  <th key={h.label} className={cn("px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", h.className)}>{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={5} rows={4} />
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10">
                    <EmptyState
                      icon={AlertTriangle}
                      variant={filtered.length === 0 && reports.length > 0 ? "no-results" : "no-data"}
                      title={reports.length === 0 ? "Chưa có báo cáo sự cố" : "Không tìm thấy báo cáo phù hợp"}
                      description={reports.length === 0 ? "Các báo cáo từ nhân viên kho sẽ hiển thị tại đây." : "Thử điều chỉnh tìm kiếm hoặc bộ lọc."}
                    />
                  </td>
                </tr>
              ) : paged.map((r) => {
                const hasQty = r.expected_qty !== null && r.actual_qty !== null;
                const delta = hasQty ? (r.actual_qty as number) - (r.expected_qty as number) : 0;
                const qtyChange = hasQty ? (
                  <span className="whitespace-nowrap font-mono tabular-nums">
                    {r.expected_qty} → <span className={cn(
                      "font-semibold",
                      delta < 0 && "text-rose-600 dark:text-rose-400",
                      delta > 0 && "text-amber-600 dark:text-amber-400",
                      delta === 0 && "text-muted-foreground",
                    )}>{r.actual_qty}</span>
                  </span>
                ) : null;
                const assignment = warehouseStaff.length > 0 && r.status !== "RESOLVED" ? (
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={assignState[r.id] || r.assigned_to_user_id || ""}
                      onValueChange={(value) => setAssignState((prev) => ({ ...prev, [r.id]: value }))}
                    >
                      <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-[11px]" aria-label={`Chọn nhân viên xử lý ${r.report_number}`}>
                        <SelectValue placeholder="Chọn nhân viên" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouseStaff.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="warning-outline"
                      disabled={assigningId === r.id}
                      onClick={() => void handleAssign(r.id)}
                      aria-label={`Giao xử lý ${r.report_number}`}
                      title="Giao xử lý"
                      className="h-8 w-8 shrink-0 p-0"
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : r.assigned_to_user_id && warehouseStaff.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">Đã giao</span>
                ) : null;
                return (
                <React.Fragment key={r.id}>
                  <tr className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 align-top">
                      <p className="truncate font-mono text-[12px] font-semibold text-foreground">{r.report_number}</p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {[r.warehouses?.code, TASK_TYPE_LABELS[r.task_type] || r.task_type].filter(Boolean).join(" · ")} · {formatDate(r.created_at)}
                      </p>
                      {(r.note || r.evidence_photo_url) && (
                        <div className="mt-1 flex items-start gap-1.5">
                          {r.note ? <p className="line-clamp-2 text-[12px] text-foreground/80" title={r.note}>{r.note}</p> : null}
                          {r.evidence_photo_url && (
                            <button
                              type="button"
                              onClick={() => setPreviewUrl(r.evidence_photo_url)}
                              title="Xem ảnh bằng chứng"
                              aria-label="Xem ảnh bằng chứng"
                              className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                        <span className="text-[12px] font-medium text-foreground">{EXCEPTION_TYPE_LABELS[r.exception_type] || r.exception_type}</span>
                        {qtyChange}
                        <StatusBadge label={r.status} variant={statusVariant(r.status)} dot />
                      </div>
                      {assignment ? <div className="mt-2 xl:hidden">{assignment}</div> : null}
                    </td>
                    <td className="hidden px-4 py-3 align-top sm:table-cell">
                      <p className="text-[13px] font-medium text-foreground">{EXCEPTION_TYPE_LABELS[r.exception_type] || r.exception_type}</p>
                      {qtyChange ? <p className="text-[13px]">{qtyChange}</p> : null}
                    </td>
                    <td className="hidden px-4 py-3 align-top md:table-cell">
                      <StatusBadge label={r.status} variant={statusVariant(r.status)} dot />
                    </td>
                    <td className="hidden px-4 py-3 align-top xl:table-cell">{assignment}</td>
                    <td className="px-4 py-3 text-right align-top">
                      {r.status !== "RESOLVED" && (
                        <Button type="button" size="sm" variant="success-outline" disabled={resolving}
                          onClick={() => setResolveState(resolveState?.id === r.id ? null : { id: r.id, notes: "" })}
                        >
                          <CheckCircle className="h-3 w-3" /> Xử lý
                        </Button>
                      )}
                      {r.status === "RESOLVED" && r.resolution_notes && (
                        <span className="block truncate text-[11px] italic text-muted-foreground" title={r.resolution_notes}>
                          {r.resolution_notes}
                        </span>
                      )}
                    </td>
                  </tr>
                  {resolveState?.id === r.id && (
                    <tr key={`${r.id}-resolve`} className="bg-emerald-50/50 dark:bg-emerald-500/10 border-b border-border">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            className="flex-1"
                            placeholder="Ghi chú xử lý (tùy chọn — không tự động điều chỉnh tồn kho)..."
                            value={resolveState.notes}
                            onChange={(e) => setResolveState({ ...resolveState, notes: e.target.value })}
                          />
                          <div className="flex items-center gap-2">
                            <Button type="button" size="sm" variant="success-outline" disabled={resolving} onClick={() => void handleResolve()}>
                              Xác nhận xử lý
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setResolveState(null)} aria-label="Hủy" className="h-8 px-2">
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-muted-foreground">
              Hiển thị <span className="font-medium text-foreground">{paged.length}</span> / {filtered.length} báo cáo
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
      </SectionCard>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="Ảnh bằng chứng sự cố"
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            aria-label="Đóng"
            className="absolute right-6 top-6 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
