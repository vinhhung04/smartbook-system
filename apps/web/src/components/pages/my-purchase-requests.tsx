import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ShoppingCart, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { getApiErrorMessage } from "@/services/api";
import { purchaseRequestService, type PurchaseRequest, type PurchaseRequestCreateInput } from "@/services/purchase-requests";
import { warehouseService } from "@/services/warehouse";

const REASONS = [
  { value: "LOW_STOCK", label: "Tồn kho thấp" },
  { value: "CUSTOMER_REQUEST", label: "Yêu cầu khách hàng" },
  { value: "DAMAGED", label: "Sách hư hỏng" },
  { value: "LOST", label: "Mất sách" },
  { value: "OTHER", label: "Lý do khác" },
];

function statusVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" | "cyan" {
  const s = status.toUpperCase();
  if (s === "APPROVED" || s === "CONVERTED") return "success";
  if (s === "PENDING") return "warning";
  if (s === "REJECTED") return "danger";
  return "neutral";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ResponseCell({ req }: { req: PurchaseRequest }) {
  const s = req.status.toUpperCase();
  if (s === "REJECTED" && req.rejection_reason) {
    return (
      <span className="text-[11px] text-red-700 dark:text-red-400 italic block max-w-[160px] truncate" title={req.rejection_reason}>
        {req.rejection_reason}
      </span>
    );
  }
  if (s === "REJECTED") {
    return <span className="text-[11px] text-red-500 dark:text-red-400 italic">Đã từ chối</span>;
  }
  if (s === "CONVERTED" && req.purchase_order_id) {
    return (
      <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400" title={req.purchase_order_id}>
        PO #{req.purchase_order_id.slice(-8).toUpperCase()}
      </span>
    );
  }
  if (s === "CONVERTED") {
    return <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Đã chuyển PO</span>;
  }
  if (s === "APPROVED") {
    return <span className="text-[11px] text-sky-600 dark:text-sky-400">Đã duyệt, chờ tạo PO</span>;
  }
  return null;
}

interface Warehouse { id: string; code: string; name: string }

const emptyForm: PurchaseRequestCreateInput = {
  warehouse_id: "",
  book_variant_id: undefined,
  book_title_hint: "",
  quantity_requested: 1,
  reason: "OTHER",
  note: "",
};

export function MyPurchaseRequestsPage() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [form, setForm] = useState<PurchaseRequestCreateInput>(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const [res, wRes] = await Promise.all([
        purchaseRequestService.getMyRequests(),
        warehouseService.getReceivingWarehouses(),
      ]);
      setRequests(Array.isArray(res.data) ? res.data : []);
      setWarehouses(Array.isArray(wRes) ? wRes : []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được yêu cầu mua hàng"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.warehouse_id) { toast.error("Vui lòng chọn kho"); return; }
    if (!form.quantity_requested || form.quantity_requested < 1) { toast.error("Số lượng phải lớn hơn 0"); return; }

    setSubmitting(true);
    try {
      const payload: PurchaseRequestCreateInput = {
        warehouse_id: form.warehouse_id,
        quantity_requested: Number(form.quantity_requested),
        reason: form.reason || "OTHER",
        note: form.note || undefined,
        book_title_hint: form.book_title_hint || undefined,
        book_variant_id: form.book_variant_id || undefined,
      };
      await purchaseRequestService.createRequest(payload);
      toast.success("Đã gửi yêu cầu mua hàng");
      setShowForm(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Gửi yêu cầu thất bại"));
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
      >
        <PageHeader
          icon={ShoppingCart}
          title="Yêu cầu mua hàng của tôi"
          description="Gửi yêu cầu bổ sung hàng cho quản lý xem xét và điều phối"
          iconBg="bg-orange-100 dark:bg-orange-500/15"
          iconColor="text-orange-700 dark:text-orange-400"
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
              <Button type="button" size="sm" onClick={() => setShowForm(true)} disabled={showForm}>
                <Plus className="h-3.5 w-3.5" />
                Tạo yêu cầu
              </Button>
            </>
          }
        />
      </motion.div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
        Yêu cầu mua hàng là để báo cáo nhu cầu bổ sung kho cho quản lý. Quản lý sẽ xem xét và tạo đơn đặt hàng chính thức (PO) nếu phê duyệt.
      </div>

      {/* Create Form */}
      {showForm && (
        <SectionCard>
          <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
            <h2 className="text-[14px] font-semibold">Tạo yêu cầu mua hàng mới</h2>
            <button type="button" onClick={() => { setShowForm(false); setForm(emptyForm); }} aria-label="Đóng biểu mẫu" className="text-muted-foreground hover:text-foreground">
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
                  <option value="">-- Chọn kho --</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">Lý do *</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                >
                  {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">Tên sách / gợi ý</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  placeholder="Nhập tên sách hoặc ISBN nếu có"
                  value={form.book_title_hint || ""}
                  onChange={(e) => setForm((f) => ({ ...f, book_title_hint: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">Số lượng cần đặt *</label>
                <input
                  type="number"
                  min="1"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.quantity_requested}
                  onChange={(e) => setForm((f) => ({ ...f, quantity_requested: Number(e.target.value) }))}
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1">Ghi chú</label>
              <textarea
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                rows={3}
                placeholder="Mô tả thêm về nhu cầu hoặc bối cảnh..."
                value={form.note || ""}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setForm(emptyForm); }}>
                Hủy
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Đang gửi..." : "Gửi yêu cầu"}
              </Button>
            </div>
          </form>
        </SectionCard>
      )}

      {/* List */}
      <SectionCard noPadding>
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold">Danh sách yêu cầu</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Mã yêu cầu", "Kho", "Sách / Gợi ý", "Số lượng", "Lý do", "Trạng thái", "Phản hồi", "Tạo lúc"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={8} rows={4} />
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10">
                    <EmptyState icon={ShoppingCart} title="Chưa có yêu cầu nào" description="Tạo yêu cầu mua hàng để báo cáo nhu cầu bổ sung kho cho quản lý." />
                  </td>
                </tr>
              ) : requests.map((req) => (
                <tr key={req.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 text-[12px] font-mono text-muted-foreground">{req.request_number}</td>
                  <td className="px-4 py-3 text-[13px]">{req.warehouses?.code || "-"}</td>
                  <td className="px-4 py-3 text-[13px]">
                    {req.book_variants?.books?.title || req.book_title_hint || <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="px-4 py-3 text-[13px]">{req.quantity_requested}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {REASONS.find((r) => r.value === req.reason)?.label || req.reason}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge label={req.status} variant={statusVariant(req.status)} dot />
                  </td>
                  <td className="px-4 py-3">
                    <ResponseCell req={req} />
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(req.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
