import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { ClipboardList, ArrowRight, RefreshCw, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { FadeItem, PageWrapper } from "../motion-utils";
import { getApiErrorMessage } from "@/services/api";
import { goodsReceiptService } from "@/services/goods-receipt";

type DraftReceipt = {
  id: string;
  receipt_number: string;
  status: string;
  warehouse_code: string | null;
  warehouse_name: string | null;
  item_count: number;
  total_planned_quantity: number;
  total_actual_quantity: number | null;
  is_verified: boolean;
  created_at: string;
};

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ReceivingCheckPage() {
  const [receipts, setReceipts] = useState<DraftReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await goodsReceiptService.getMyDraftForVerification();
      setReceipts(res.data || []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được danh sách phiếu cần kiểm đếm"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="tracking-[-0.02em]">Kiểm đếm hàng nhận</h1>
            <p className="text-[12px] text-slate-500 mt-1">
              Xem và xác nhận số lượng thực tế trong phiếu nhập hàng trước khi manager duyệt
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Làm mới
          </button>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[16px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)] overflow-hidden">
          {loading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">Đang tải...</div>
          ) : receipts.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <ClipboardList className="mx-auto h-10 w-10 text-slate-300 mb-3" />
              <p className="text-[13px] text-slate-500 font-medium">Không có phiếu nào cần kiểm đếm</p>
              <p className="text-[12px] text-slate-400 mt-1">
                Các phiếu nhập hàng ở trạng thái DRAFT được giao cho bạn sẽ hiện ở đây
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  {["Mã phiếu", "Kho", "Số mặt hàng", "SL kế hoạch", "SL thực đếm", "Trạng thái KĐ", "Ngày tạo", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {receipts.map((r, idx) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-4 py-3.5 text-[13px] font-semibold font-mono">{r.receipt_number}</td>
                    <td className="px-4 py-3.5 text-[13px] text-slate-600">{r.warehouse_code || r.warehouse_name || "-"}</td>
                    <td className="px-4 py-3.5 text-[13px] text-slate-600">{r.item_count}</td>
                    <td className="px-4 py-3.5 text-[13px] text-slate-600">{r.total_planned_quantity}</td>
                    <td className="px-4 py-3.5 text-[13px]">
                      {r.total_actual_quantity !== null ? (
                        <span className={r.total_actual_quantity === r.total_planned_quantity ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
                          {r.total_actual_quantity}
                          {r.total_actual_quantity !== r.total_planned_quantity && (
                            <span className="ml-1 text-[11px]">
                              ({r.total_actual_quantity > r.total_planned_quantity ? "+" : ""}{r.total_actual_quantity - r.total_planned_quantity})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[12px]">Chưa đếm</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {r.is_verified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" /> Đã kiểm đếm
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          <Clock className="w-3 h-3" /> Chờ kiểm đếm
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-slate-500">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3.5">
                      <NavLink
                        to={`/orders/${r.id}`}
                        className="inline-flex items-center gap-1.5 rounded-[8px] bg-blue-50 px-2.5 py-1.5 text-[12px] text-blue-600 hover:bg-blue-100 font-semibold transition-colors"
                      >
                        Kiểm đếm <ArrowRight className="w-3 h-3" />
                      </NavLink>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
