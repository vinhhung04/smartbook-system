import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, RefreshCw, CheckCircle, X, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getApiErrorMessage } from "@/services/api";
import { exceptionReportService, type ExceptionReport } from "@/services/exception-reports";
import { userService, type WarehouseStaffOption } from "@/services/user";

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

const STATUS_FILTERS = ["ALL", "OPEN", "ACKNOWLEDGED", "RESOLVED"];

function statusVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" | "cyan" {
  const s = status.toUpperCase();
  if (s === "RESOLVED") return "success";
  if (s === "OPEN") return "danger";
  if (s === "ACKNOWLEDGED") return "warning";
  return "neutral";
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
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [resolveState, setResolveState] = useState<{ id: string; notes: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
  const [assignState, setAssignState] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState("");

  const load = async (status?: string) => {
    setLoading(true);
    try {
      const res = await exceptionReportService.getAll(status && status !== "ALL" ? { status } : {});
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
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-100 bg-red-50">
            <AlertTriangle className="h-5 w-5 text-red-700" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Báo cáo sự cố</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Xem xét và xử lý báo cáo thiếu/dư/hư hỏng từ nhân viên kho
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-border bg-background px-3 py-1.5 text-[13px]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{s === "ALL" ? "Tất cả trạng thái" : s}</option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" onClick={() => void load(statusFilter)} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </Button>
        </div>
      </motion.div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
        Giải quyết báo cáo sự cố KHÔNG tự động điều chỉnh tồn kho. Nếu cần chỉnh tồn kho, sử dụng chức năng Stock Adjustment riêng.
      </div>

      <SectionCard noPadding>
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold">Danh sách báo cáo sự cố</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Mã báo cáo", "Kho", "Loại task", "Loại sự cố", "SL dự kiến", "SL thực tế", "Mô tả", "Trạng thái", "Tạo lúc", "Giao xử lý", "Thao tác"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-5 py-10 text-center text-sm text-muted-foreground">Đang tải...</td></tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-5 py-10">
                    <EmptyState icon={AlertTriangle} title="Chưa có báo cáo sự cố" description="Các báo cáo từ nhân viên kho sẽ hiển thị tại đây." />
                  </td>
                </tr>
              ) : reports.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 text-[12px] font-mono text-muted-foreground">{r.report_number}</td>
                    <td className="px-4 py-3 text-[13px]">{r.warehouses?.code || "-"}</td>
                    <td className="px-4 py-3 text-[12px]">{TASK_TYPE_LABELS[r.task_type] || r.task_type}</td>
                    <td className="px-4 py-3 text-[13px]">{EXCEPTION_TYPE_LABELS[r.exception_type] || r.exception_type}</td>
                    <td className="px-4 py-3 text-[13px]">{r.expected_qty ?? "-"}</td>
                    <td className="px-4 py-3 text-[13px]">{r.actual_qty ?? "-"}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground max-w-[200px]">
                      <span className="block truncate" title={r.note}>{r.note}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge label={r.status} variant={statusVariant(r.status)} dot />
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3 text-[12px]">
                      {warehouseStaff.length > 0 && r.status !== "RESOLVED" && (
                        <div className="flex items-center gap-1">
                          <select
                            value={assignState[r.id] || r.assigned_to_user_id || ""}
                            onChange={(e) => setAssignState((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[11px]"
                          >
                            <option value="">Chọn nhân viên</option>
                            {warehouseStaff.map((s) => (
                              <option key={s.id} value={s.id}>{s.full_name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={assigningId === r.id}
                            onClick={() => void handleAssign(r.id)}
                            className="h-7 rounded bg-amber-500 px-2 text-[10px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                          >
                            <UserCheck className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      {r.assigned_to_user_id && warehouseStaff.length === 0 && (
                        <span className="text-[11px] text-muted-foreground">Đã giao</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      {r.status !== "RESOLVED" && (
                        <Button type="button" size="sm" disabled={resolving}
                          onClick={() => setResolveState(resolveState?.id === r.id ? null : { id: r.id, notes: "" })}
                          className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700">
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
                    <tr key={`${r.id}-resolve`} className="bg-emerald-50/50 border-b border-border">
                      <td colSpan={11} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            className="flex-1 rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-[13px]"
                            placeholder="Ghi chú xử lý (tùy chọn — không tự động điều chỉnh stock)..."
                            value={resolveState.notes}
                            onChange={(e) => setResolveState({ ...resolveState, notes: e.target.value })}
                          />
                          <Button type="button" size="sm" disabled={resolving} onClick={() => void handleResolve()}
                            className="bg-emerald-600 hover:bg-emerald-700 h-7 px-3 text-[11px]">
                            Xác nhận xử lý
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setResolveState(null)} className="h-7 px-2">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
