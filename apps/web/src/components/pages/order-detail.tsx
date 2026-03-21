import { useEffect, useMemo, useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { StatusBadge } from "../status-badge";
import { NavLink, useParams } from "react-router";
import { ArrowLeft, Download, FileText, CheckCircle, XCircle, AlertCircle, ClipboardCheck } from "lucide-react";
import { goodsReceiptService } from "@/services/goods-receipt";
import { getApiErrorMessage } from "@/services/api.ts";
import { toast } from "sonner";

interface ReceiptDetailItem {
  id: string;
  barcode: string | null;
  book_title: string;
  location_code: string | null;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

interface ReceiptDetail {
  id: string;
  receipt_number: string;
  warehouse_code?: string;
  warehouse_name?: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  created_at: string;
  note?: string;
  total_amount: number;
  items: ReceiptDetailItem[];
}

function formatCurrency(value: number): string {
  return `${value.toLocaleString("vi-VN")} VND`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderDetailPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);

  useEffect(() => {
    const fetchDetail = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await goodsReceiptService.getById(id);
        setReceipt(data as ReceiptDetail);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Failed to load receipt details"));
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [id]);

  const handleUpdateStatus = async (nextStatus: "POSTED" | "CANCELLED") => {
    if (!id) return;
    try {
      setIsUpdatingStatus(true);
      await goodsReceiptService.updateStatus(id, nextStatus);
      const refreshed = await goodsReceiptService.getById(id);
      setReceipt(refreshed as ReceiptDetail);
      toast.success(nextStatus === "POSTED" ? "Da duyet phieu nhap" : "Da huy phieu nhap");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cap nhat trang thai that bai"));
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const totalQty = useMemo(() => receipt?.items?.reduce((s, i) => s + i.quantity, 0) || 0, [receipt]);
  const timeline = useMemo(() => {
    const created = { step: 1, title: "Receipt Created", time: formatDate(receipt?.created_at || ""), completed: true, description: "Draft created" };
    const posted = {
      step: 2,
      title: receipt?.status === "POSTED" ? "Posted" : "Awaiting Post",
      time: receipt?.status === "POSTED" ? "Completed" : "Pending",
      completed: receipt?.status === "POSTED",
      description: receipt?.status === "POSTED" ? "Stock updated in inventory" : "Receipt is still in draft",
    };
    return [created, posted];
  }, [receipt]);

  if (loading) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-400">Loading receipt details...</p>
      </PageWrapper>
    );
  }

  if (!receipt) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-400">Receipt not found.</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <NavLink to="/orders" className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-blue-600 transition-colors" style={{ fontWeight: 550 }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Receipts
        </NavLink>
      </FadeItem>

      <FadeItem>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="tracking-[-0.02em]">{receipt.receipt_number}</h1>
            <p className="text-[12px] text-slate-400 mt-1">Created {formatDate(receipt.created_at)}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge label={receipt.status} variant={receipt.status === "POSTED" ? "success" : receipt.status === "DRAFT" ? "info" : "danger"} dot />
            <button className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm" style={{ fontWeight: 550 }}>
              <Download className="w-3.5 h-3.5" /> Download
            </button>
          </div>
        </div>
      </FadeItem>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Timeline */}
          <FadeItem>
            <div className="bg-white rounded-[16px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <h3 className="text-[14px] mb-4" style={{ fontWeight: 650 }}>Status Timeline</h3>
              <div className="space-y-3">
                {timeline.map((t, i) => (
                  <div key={t.step} className="flex gap-4">
                    <div className="flex flex-col items-center gap-2">
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.1 }}
                        className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${t.completed ? "bg-gradient-to-br from-emerald-500 to-teal-600 border-emerald-400 text-white" : "bg-white border-slate-300 text-slate-400"}`}>
                        {t.completed ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      </motion.div>
                      {i < timeline.length - 1 && <div className="w-0.5 h-12 bg-gradient-to-b from-emerald-400 to-slate-200" />}
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2.5 mb-0.5">
                        <span className="text-[13px]" style={{ fontWeight: 650 }}>{t.title}</span>
                        <span className="text-[11px] text-slate-400">{t.time}</span>
                      </div>
                      <p className="text-[12px] text-slate-500">{t.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeItem>

          {/* Items */}
          <FadeItem>
            <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="px-5 py-4">
                <h3 className="text-[14px]" style={{ fontWeight: 650 }}>Receipt Items ({receipt.items.length})</h3>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-t border-b border-slate-100 bg-gradient-to-r from-blue-50/30 to-transparent">
                    {["Barcode", "Title", "Location", "Qty", "Unit Cost", "Subtotal"].map(h => (
                      <th key={h} className={`${["Qty", "Unit Cost", "Subtotal"].includes(h) ? "text-right" : "text-left"} text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]`} style={{ fontWeight: 550 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map(item => (
                    <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-blue-50/20 transition-colors">
                      <td className="px-5 py-3.5 text-[12px] font-mono text-slate-400">{item.barcode || "-"}</td>
                      <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>{item.book_title}</td>
                      <td className="px-5 py-3.5 text-[12px] font-mono text-slate-500">{item.location_code || "-"}</td>
                      <td className="px-5 py-3.5 text-right text-[13px]" style={{ fontWeight: 550 }}>{item.quantity}</td>
                      <td className="px-5 py-3.5 text-right text-[12px] font-mono text-slate-500">{formatCurrency(item.unit_cost)}</td>
                      <td className="px-5 py-3.5 text-right text-[13px] font-mono" style={{ fontWeight: 550 }}>{formatCurrency(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-gradient-to-r from-slate-50/60 to-transparent">
                    <td colSpan={3} className="px-5 py-3 text-right text-[13px]" style={{ fontWeight: 650 }}>Total:</td>
                    <td className="px-5 py-3 text-right text-[14px] font-mono" style={{ fontWeight: 700 }}>{totalQty}</td>
                    <td colSpan={2} className="px-5 py-3 text-right text-[14px] font-mono" style={{ fontWeight: 700 }}>{formatCurrency(receipt.total_amount || 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </FadeItem>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <FadeItem>
            <div className="bg-gradient-to-br from-blue-50/80 to-indigo-50/50 rounded-[16px] border border-blue-100/60 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <h3 className="text-[14px] mb-4" style={{ fontWeight: 650 }}>Receipt Summary</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] text-slate-400 uppercase mb-1" style={{ fontWeight: 550 }}>Warehouse</p>
                  <p className="text-[13px]" style={{ fontWeight: 550 }}>{receipt.warehouse_code || receipt.warehouse_name || "-"}</p>
                </div>
                <div className="h-px bg-blue-200/40" />
                <div>
                  <p className="text-[11px] text-slate-400 uppercase mb-1" style={{ fontWeight: 550 }}>Created By</p>
                  <p className="text-[13px]" style={{ fontWeight: 550 }}>System User</p>
                </div>
                <div className="h-px bg-blue-200/40" />
                <div>
                  <p className="text-[11px] text-slate-400 uppercase mb-1" style={{ fontWeight: 550 }}>Total Items</p>
                  <p className="text-[26px] text-blue-700" style={{ fontWeight: 700, lineHeight: 1 }}>{receipt.items.length}</p>
                </div>
                <div className="h-px bg-blue-200/40" />
                <div>
                  <p className="text-[11px] text-slate-400 uppercase mb-1" style={{ fontWeight: 550 }}>Total Quantity</p>
                  <p className="text-[26px] text-emerald-700" style={{ fontWeight: 700, lineHeight: 1 }}>{totalQty}</p>
                </div>
                <div className="h-px bg-blue-200/40" />
                <div>
                  <p className="text-[11px] text-slate-400 uppercase mb-1" style={{ fontWeight: 550 }}>Total Value</p>
                  <p className="text-[18px] font-mono" style={{ fontWeight: 700, color: "#6366f1" }}>{formatCurrency(receipt.total_amount || 0)}</p>
                </div>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-transparent">
                <p className="text-[12px] text-slate-500" style={{ fontWeight: 550 }}>Actions</p>
              </div>
              <div className="p-3 space-y-2">
                <button className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] hover:shadow-lg transition-all shadow-md shadow-blue-500/15" style={{ fontWeight: 550 }}>
                  <FileText className="w-3.5 h-3.5" /> Print
                </button>
                <NavLink
                  to={`/putaway/${receipt.id}`}
                  className={`w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-[10px] text-[13px] transition-all ${
                    receipt.status === "POSTED"
                      ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                      : "cursor-not-allowed border border-slate-200 bg-white text-slate-400 pointer-events-none"
                  }`}
                  style={{ fontWeight: 550 }}
                >
                  <ClipboardCheck className="w-3.5 h-3.5" /> Nhap hang
                </NavLink>
                <button
                  disabled={receipt.status !== "DRAFT" || isUpdatingStatus}
                  onClick={() => void handleUpdateStatus("POSTED")}
                  className={`w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-[10px] text-[13px] transition-all ${
                    receipt.status === "DRAFT" && !isUpdatingStatus
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
                      : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"
                  }`}
                  style={{ fontWeight: 550 }}
                >
                  <CheckCircle className="w-3.5 h-3.5" /> {isUpdatingStatus ? "Dang xu ly..." : "Approve"}
                </button>
                <button
                  disabled={receipt.status !== "DRAFT" || isUpdatingStatus}
                  onClick={() => void handleUpdateStatus("CANCELLED")}
                  className={`w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-[10px] text-[13px] transition-all ${
                    receipt.status === "DRAFT" && !isUpdatingStatus
                      ? "border border-rose-200 bg-rose-50 text-rose-700"
                      : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"
                  }`}
                  style={{ fontWeight: 550 }}
                >
                  <XCircle className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </div>
          </FadeItem>
        </div>
      </div>
    </PageWrapper>
  );
}
