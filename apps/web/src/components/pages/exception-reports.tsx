import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, RefreshCw, CheckCircle, X, UserCheck, Inbox, ClipboardCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatCard } from "@/components/ui/stat-card";
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

  const load = async (status?: string) => {
    setLoading(true);
    try {
      const res = await exceptionReportService.getAll({
        ...(status && status !== "ALL" ? { status } : {}),
        limit: FETCH_LIMIT,
      });
      setReports(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được danh sách báo cáo sự cố"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(statusFilter); }, [statusFilter]);

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
    if (!keyword) return reports;
    return reports.filter((r) => (
      r.report_number.toLowerCase().includes(keyword)
      || r.warehouses?.code?.toLowerCase().includes(keyword)
      || r.warehouses?.name?.toLowerCase().includes(keyword)
      || r.note?.toLowerCase().includes(keyword)
      || (TASK_TYPE_LABELS[r.task_type] || r.task_type).toLowerCase().includes(keyword)
      || (EXCEPTION_TYPE_LABELS[r.exception_type] || r.exception_type).toLowerCase().includes(keyword)
    ));
  }, [reports, query]);

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
      void load(statusFilter);
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
      void load(statusFilter);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Xử lý thất bại"));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24 }}
      >
        <PageHeader
          icon={AlertTriangle}
          title="Báo cáo sự cố"
          description="Xem xét và xử lý báo cáo thiếu/dư/hư hỏng từ nhân viên kho"
          iconBg="bg-red-50 dark:bg-red-500/10"
          iconColor="text-red-700 dark:text-red-400"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => void load(statusFilter)} disabled={loading}>
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
        className="grid grid-cols-2 gap-4 sm:grid-cols-4"
      >
        <StatCard label="Tổng số" value={stats.total} icon={Inbox} variant="default" />
        <StatCard label="Đang mở" value={stats.open} icon={AlertTriangle} variant="danger" />
        <StatCard label="Đã tiếp nhận" value={stats.acknowledged} icon={ClipboardCheck} variant="warning" />
        <StatCard label="Đã xử lý" value={stats.resolved} icon={ShieldCheck} variant="success" />
      </motion.div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
        Giải quyết báo cáo sự cố KHÔNG tự động điều chỉnh tồn kho. Nếu cần chỉnh tồn kho, sử dụng chức năng Stock Adjustment riêng.
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.1 }}
      >
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Tìm mã báo cáo, kho, mô tả..."
          filters={
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all",
                    statusFilter === status
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  {STATUS_LABELS[status] ?? status}
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

      <SectionCard noPadding>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Mã báo cáo", "Kho", "Task / Sự cố", "Chênh lệch", "Mô tả", "Trạng thái", "Tạo lúc", "Giao xử lý", "Thao tác"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={9} rows={4} />
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10">
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
                return (
                <React.Fragment key={r.id}>
                  <tr className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 text-[12px] font-mono text-muted-foreground">{r.report_number}</td>
                    <td className="px-4 py-3 text-[13px]">{r.warehouses?.code || "-"}</td>
                    <td className="px-4 py-3 text-[12px]">
                      <p className="text-muted-foreground">{TASK_TYPE_LABELS[r.task_type] || r.task_type}</p>
                      <p className="text-[13px] font-medium text-foreground">{EXCEPTION_TYPE_LABELS[r.exception_type] || r.exception_type}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] tabular-nums">
                      {hasQty ? (
                        <span className="whitespace-nowrap">
                          {r.expected_qty} → <span className={cn(
                            "font-semibold",
                            delta < 0 && "text-rose-600 dark:text-rose-400",
                            delta > 0 && "text-amber-600 dark:text-amber-400",
                            delta === 0 && "text-muted-foreground",
                          )}>{r.actual_qty}</span>
                        </span>
                      ) : "-"}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground max-w-[200px]">
                      <span className="block truncate" title={r.note}>{r.note}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge label={r.status} variant={statusVariant(r.status)} dot />
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3 text-[12px]">
                      {warehouseStaff.length > 0 && r.status !== "RESOLVED" && (
                        <div className="flex items-center gap-1.5">
                          <Select
                            value={assignState[r.id] || r.assigned_to_user_id || ""}
                            onValueChange={(value) => setAssignState((prev) => ({ ...prev, [r.id]: value }))}
                          >
                            <SelectTrigger size="sm" className="h-7 w-[140px] text-[11px]">
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
                            aria-label="Giao xử lý"
                            className="h-7 w-7 p-0"
                          >
                            <UserCheck className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {r.assigned_to_user_id && warehouseStaff.length === 0 && (
                        <span className="text-[11px] text-muted-foreground">Đã giao</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      {r.status !== "RESOLVED" && (
                        <Button type="button" size="sm" variant="success-outline" disabled={resolving}
                          onClick={() => setResolveState(resolveState?.id === r.id ? null : { id: r.id, notes: "" })}
                        >
                          <CheckCircle className="h-3 w-3" /> Xử lý
                        </Button>
                      )}
                      {r.status === "RESOLVED" && r.resolution_notes && (
                        <span className="text-[11px] text-muted-foreground italic truncate max-w-[120px] block" title={r.resolution_notes}>
                          {r.resolution_notes}
                        </span>
                      )}
                    </td>
                  </tr>
                  {resolveState?.id === r.id && (
                    <tr key={`${r.id}-resolve`} className="bg-emerald-50/50 dark:bg-emerald-500/10 border-b border-border">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Input
                            className="flex-1"
                            placeholder="Ghi chú xử lý (tùy chọn — không tự động điều chỉnh stock)..."
                            value={resolveState.notes}
                            onChange={(e) => setResolveState({ ...resolveState, notes: e.target.value })}
                          />
                          <Button type="button" size="sm" variant="success-outline" disabled={resolving} onClick={() => void handleResolve()}>
                            Xác nhận xử lý
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setResolveState(null)} aria-label="Hủy" className="h-8 px-2">
                            <X className="h-3 w-3" />
                          </Button>
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
    </div>
  );
}
