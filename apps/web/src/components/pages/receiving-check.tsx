import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { ClipboardList, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { FadeItem, PageWrapper } from "../motion-utils";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTableRow } from "@/components/ui/loading-state";
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
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title="Kiểm đếm hàng nhận"
          description="Xem và xác nhận số lượng thực tế trong phiếu nhập hàng trước khi manager duyệt"
          iconBg="bg-blue-100 dark:bg-blue-500/15"
          iconColor="text-blue-600 dark:text-blue-400"
          actions={
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-2 text-[13px] hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </button>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Mã phiếu", "Kho", "Số mặt hàng", "SL kế hoạch", "SL thực đếm", "Trạng thái KĐ", "Ngày tạo", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={8} rows={4} />
                ) : receipts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-10">
                      <EmptyState
                        variant="no-data"
                        icon={ClipboardList}
                        title="Không có phiếu nào cần kiểm đếm"
                        description="Các phiếu nhập hàng ở trạng thái DRAFT được giao cho bạn sẽ hiện ở đây"
                      />
                    </td>
                  </tr>
                ) : (
                  receipts.map((r, idx) => (
                    <motion.tr
                      key={r.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.03 }}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3.5 text-[13px] font-semibold font-mono">{r.receipt_number}</td>
                      <td className="px-4 py-3.5 text-[13px] text-muted-foreground">{r.warehouse_code || r.warehouse_name || "-"}</td>
                      <td className="px-4 py-3.5 text-[13px] text-muted-foreground">{r.item_count}</td>
                      <td className="px-4 py-3.5 text-[13px] text-muted-foreground">{r.total_planned_quantity}</td>
                      <td className="px-4 py-3.5 text-[13px]">
                        {r.total_actual_quantity !== null ? (
                          <span className={r.total_actual_quantity === r.total_planned_quantity ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-amber-600 dark:text-amber-400 font-semibold"}>
                            {r.total_actual_quantity}
                            {r.total_actual_quantity !== r.total_planned_quantity && (
                              <span className="ml-1 text-[11px]">
                                ({r.total_actual_quantity > r.total_planned_quantity ? "+" : ""}{r.total_actual_quantity - r.total_planned_quantity})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[12px]">Chưa đếm</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {r.is_verified ? (
                          <StatusBadge label="Đã kiểm đếm" variant="success" />
                        ) : (
                          <StatusBadge label="Chờ kiểm đếm" variant="warning" />
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-[12px] text-muted-foreground">{formatDate(r.created_at)}</td>
                      <td className="px-4 py-3.5">
                        <NavLink
                          to={`/orders/${r.id}`}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-blue-50 dark:bg-blue-500/10 px-2.5 py-1.5 text-[12px] text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/15 font-semibold transition-colors"
                        >
                          Kiểm đếm <ArrowRight className="w-3 h-3" />
                        </NavLink>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
