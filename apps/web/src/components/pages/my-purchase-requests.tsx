import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ShoppingCart, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getApiErrorMessage } from "@/services/api";
import { purchaseRequestService, type PurchaseRequest, type PurchaseRequestCreateInput } from "@/services/purchase-requests";
import { warehouseService } from "@/services/warehouse";

const REASONS = [
  { value: "LOW_STOCK", label: "Ton kho thap" },
  { value: "CUSTOMER_REQUEST", label: "Yeu cau khach hang" },
  { value: "DAMAGED", label: "Sach hu hong" },
  { value: "LOST", label: "Mat sach" },
  { value: "OTHER", label: "Ly do khac" },
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
      toast.error(getApiErrorMessage(err, "Khong tai duoc yeu cau mua hang"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.warehouse_id) { toast.error("Vui long chon kho"); return; }
    if (!form.quantity_requested || form.quantity_requested < 1) { toast.error("So luong phai lon hon 0"); return; }

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
      toast.success("Da gui yeu cau mua hang");
      setShowForm(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Gui yeu cau that bai"));
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
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-orange-100 bg-orange-50">
            <ShoppingCart className="h-5 w-5 text-orange-700" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Yeu cau mua hang cua toi</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Gui yeu cau bo sung hang cho quan ly xem xet va dieu phoi
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
            Tao yeu cau
          </Button>
        </div>
      </motion.div>

      {/* Disclaimer */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
        Yeu cau mua hang la de bao cao nhu cau bo sung kho cho quan ly. Quan ly se xem xet va tao don dat hang chinh thuc (PO) neu phe duyet.
      </div>

      {/* Create Form */}
      {showForm && (
        <SectionCard>
          <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
            <h2 className="text-[14px] font-semibold">Tao yeu cau mua hang moi</h2>
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
                <label className="block text-[12px] font-medium mb-1">Ly do *</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                >
                  {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">Ten sach / goi y</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  placeholder="Nhap ten sach hoac ISBNNếu có"
                  value={form.book_title_hint || ""}
                  onChange={(e) => setForm((f) => ({ ...f, book_title_hint: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">So luong can dat *</label>
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
              <label className="block text-[12px] font-medium mb-1">Ghi chu</label>
              <textarea
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                rows={3}
                placeholder="Mo ta them ve nhu cau hoac boi canh..."
                value={form.note || ""}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setForm(emptyForm); }}>
                Huy
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Dang gui..." : "Gui yeu cau"}
              </Button>
            </div>
          </form>
        </SectionCard>
      )}

      {/* List */}
      <SectionCard noPadding>
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold">Danh sach yeu cau</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Ma yeu cau", "Kho", "Sach / Goi y", "So luong", "Ly do", "Trang thai", "Tao luc"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">Dang tai...</td></tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10">
                    <EmptyState icon={ShoppingCart} title="Chua co yeu cau nao" description="Tao yeu cau mua hang de bao cao nhu cau bo sung kho cho quan ly." />
                  </td>
                </tr>
              ) : requests.map((req) => (
                <tr key={req.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 text-[12px] font-mono text-muted-foreground">{req.request_number}</td>
                  <td className="px-5 py-3 text-[13px]">{req.warehouses?.code || "-"}</td>
                  <td className="px-5 py-3 text-[13px]">
                    {req.book_variants?.books?.title || req.book_title_hint || <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="px-5 py-3 text-[13px]">{req.quantity_requested}</td>
                  <td className="px-5 py-3 text-[12px] text-muted-foreground">
                    {REASONS.find((r) => r.value === req.reason)?.label || req.reason}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge label={req.status} variant={statusVariant(req.status)} dot />
                  </td>
                  <td className="px-5 py-3 text-[12px] text-muted-foreground">{formatDate(req.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
