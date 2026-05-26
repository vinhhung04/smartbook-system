import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getApiErrorMessage } from "@/services/api";
import { exceptionReportService, type ExceptionReport, type ExceptionReportCreateInput } from "@/services/exception-reports";
import { warehouseService } from "@/services/warehouse";

const TASK_TYPES = [
  { value: "RECEIVING", label: "Tiep nhan hang" },
  { value: "PUTAWAY", label: "Chuyen vao kho" },
  { value: "PICKING", label: "Lay hang" },
  { value: "OUTBOUND", label: "Xuat kho" },
];

const EXCEPTION_TYPES = [
  { value: "SHORT", label: "Thieu hang" },
  { value: "OVERAGE", label: "Du hang" },
  { value: "DAMAGED", label: "Hu hong" },
  { value: "WRONG_ITEM", label: "Sai san pham" },
  { value: "WRONG_QTY", label: "Sai so luong" },
  { value: "OTHER", label: "Khac" },
];

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

interface Warehouse { id: string; code: string; name: string }

const emptyForm: ExceptionReportCreateInput = {
  warehouse_id: "",
  task_type: "RECEIVING",
  task_id: "",
  exception_type: "SHORT",
  note: "",
  expected_qty: undefined,
  actual_qty: undefined,
  evidence_notes: "",
  goods_receipt_id: undefined,
};

export function MyExceptionReportsPage() {
  const [reports, setReports] = useState<ExceptionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [form, setForm] = useState<ExceptionReportCreateInput>(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const [res, wRes] = await Promise.all([
        exceptionReportService.getMyReports(),
        warehouseService.getReceivingWarehouses(),
      ]);
      setReports(Array.isArray(res.data) ? res.data : []);
      setWarehouses(Array.isArray(wRes) ? wRes : []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Khong tai duoc bao cao ngoai le"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.warehouse_id) { toast.error("Vui long chon kho"); return; }
    if (!form.task_id.trim()) { toast.error("Vui long nhap ID task lien quan"); return; }
    if (!form.note.trim()) { toast.error("Vui long nhap mo ta su co"); return; }

    setSubmitting(true);
    try {
      const payload: ExceptionReportCreateInput = {
        warehouse_id: form.warehouse_id,
        task_type: form.task_type,
        task_id: form.task_id.trim(),
        exception_type: form.exception_type,
        note: form.note.trim(),
        expected_qty: form.expected_qty !== undefined && form.expected_qty !== null ? Number(form.expected_qty) : undefined,
        actual_qty: form.actual_qty !== undefined && form.actual_qty !== null ? Number(form.actual_qty) : undefined,
        evidence_notes: form.evidence_notes || undefined,
        goods_receipt_id: form.goods_receipt_id || undefined,
      };
      await exceptionReportService.createReport(payload);
      toast.success("Da gui bao cao ngoai le");
      setShowForm(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Gui bao cao that bai"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
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
            <h1 className="text-xl font-semibold tracking-tight">Bao cao ngoai le cua toi</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Ghi nhan su co thieu/du/hu hong trong qua trinh lam viec de quan ly xu ly
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Lam moi
          </Button>
          <Button type="button" size="sm" onClick={() => setShowForm(true)} disabled={showForm}>
            <Plus className="h-3.5 w-3.5" />
            Bao cao su co
          </Button>
        </div>
      </motion.div>

      {/* Disclaimer */}
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-800">
        Bao cao ngoai le khong tu dong dieu chinh ton kho. Quan ly se xem xet va quyet dinh xu ly phu hop.
      </div>

      {/* Create Form */}
      {showForm && (
        <SectionCard>
          <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
            <h2 className="text-[14px] font-semibold">Bao cao su co moi</h2>
            <button onClick={() => { setShowForm(false); setForm(emptyForm); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[12px] font-medium mb-1">Kho *</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.warehouse_id}
                  onChange={(e) => setForm((f) => ({ ...f, warehouse_id: e.target.value }))}
                  required
                >
                  <option value="">-- Chon kho --</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">Loai task *</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.task_type}
                  onChange={(e) => setForm((f) => ({ ...f, task_type: e.target.value }))}
                >
                  {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">ID task lien quan *</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] font-mono"
                  placeholder="UUID hoac ma task"
                  value={form.task_id}
                  onChange={(e) => setForm((f) => ({ ...f, task_id: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">Loai su co *</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.exception_type}
                  onChange={(e) => setForm((f) => ({ ...f, exception_type: e.target.value }))}
                >
                  {EXCEPTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">So luong du kien</label>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  placeholder="So luong theo chung tu"
                  value={form.expected_qty ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, expected_qty: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">So luong thuc te</label>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  placeholder="So luong thuc nhan/kiem"
                  value={form.actual_qty ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, actual_qty: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1">Mo ta su co *</label>
              <textarea
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                rows={3}
                placeholder="Mo ta chi tiet su co phat hien..."
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1">Ghi chu bang chung</label>
              <textarea
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                rows={2}
                placeholder="Ghi chu so serial, vi tri, hinh anh (neu co)..."
                value={form.evidence_notes || ""}
                onChange={(e) => setForm((f) => ({ ...f, evidence_notes: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setForm(emptyForm); }}>
                Huy
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Dang gui..." : "Gui bao cao"}
              </Button>
            </div>
          </form>
        </SectionCard>
      )}

      {/* List */}
      <SectionCard noPadding>
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold">Danh sach bao cao ngoai le</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Ma bao cao", "Kho", "Task", "Loai su co", "SL du kien", "SL thuc te", "Trang thai", "Tao luc"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">Dang tai...</td></tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10">
                    <EmptyState icon={AlertTriangle} title="Chua co bao cao ngoai le" description="Khi phat hien su co trong qua trinh lam viec, hay bao cao de quan ly xu ly kip thoi." />
                  </td>
                </tr>
              ) : reports.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 text-[12px] font-mono text-muted-foreground">{r.report_number}</td>
                  <td className="px-4 py-3 text-[13px]">{r.warehouses?.code || "-"}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {TASK_TYPES.find((t) => t.value === r.task_type)?.label || r.task_type}
                  </td>
                  <td className="px-4 py-3 text-[13px]">
                    {EXCEPTION_TYPES.find((t) => t.value === r.exception_type)?.label || r.exception_type}
                  </td>
                  <td className="px-4 py-3 text-[13px]">{r.expected_qty ?? "-"}</td>
                  <td className="px-4 py-3 text-[13px]">{r.actual_qty ?? "-"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={r.status} variant={statusVariant(r.status)} dot />
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
