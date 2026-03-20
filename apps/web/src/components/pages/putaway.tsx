import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { ClipboardCheck, Search, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { putawayService, type PutawayReceiptSummary } from "@/services/putaway";

function formatDate(value: string | null): string {
  if (!value) return "-";
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

export function PutawayPage() {
  const [loading, setLoading] = useState(true);
  const [receipts, setReceipts] = useState<PutawayReceiptSummary[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await putawayService.getReadyReceipts();
        setReceipts(Array.isArray(data) ? data : []);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach phieu nhap da duyet"));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return receipts;

    return receipts.filter((receipt) => (
      receipt.receipt_number.toLowerCase().includes(keyword)
      || (receipt.warehouse_code || "").toLowerCase().includes(keyword)
      || (receipt.warehouse_name || "").toLowerCase().includes(keyword)
    ));
  }, [receipts, query]);

  const totalRemaining = receipts.reduce((sum, row) => sum + row.remaining_quantity, 0);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-blue-100 to-indigo-50 flex items-center justify-center border border-blue-200/40">
            <ClipboardCheck className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="tracking-[-0.02em]">Putaway</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">{receipts.length} phieu da duyet · {totalRemaining} quyen chua nhap ke</p>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="relative max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tim theo ma phieu / kho"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-blue-100/60 rounded-[10px] text-[13px] outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-300/60 transition-all shadow-sm"
          />
        </div>
      </FadeItem>

      <FadeItem>
        <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-gradient-to-r from-blue-50/40 to-transparent">
                {["Ma phieu", "Kho", "Ngay", "Trang thai", "Nguoi duyet", "Tong dong", "Con lai", "Action"].map((header) => (
                  <th key={header} className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-14 text-[13px] text-slate-400">Dang tai danh sach phieu nhap...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-14 text-[13px] text-slate-400">Khong co phieu nhap nao san sang putaway.</td>
                </tr>
              ) : (
                filtered.map((receipt, index) => (
                  <motion.tr
                    key={receipt.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.02 }}
                    className="border-b border-slate-50 last:border-0 hover:bg-blue-50/20 transition-colors"
                  >
                    <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 600 }}>{receipt.receipt_number}</td>
                    <td className="px-5 py-3.5 text-[13px]">{receipt.warehouse_code || receipt.warehouse_name || "-"}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-500">{formatDate(receipt.received_at || receipt.created_at)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-emerald-700" style={{ fontWeight: 600 }}>{receipt.status}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-500">{receipt.approved_by_user_id ? receipt.approved_by_user_id.slice(0, 8) : "-"}</td>
                    <td className="px-5 py-3.5 text-[13px]">{receipt.line_count}</td>
                    <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 600 }}>{receipt.remaining_quantity}</td>
                    <td className="px-5 py-3.5">
                      <NavLink to={`/putaway/${receipt.id}`} className="inline-flex items-center gap-1.5 text-[12px] text-blue-600 hover:text-blue-700" style={{ fontWeight: 600 }}>
                        Xem chi tiet <ArrowRight className="w-3.5 h-3.5" />
                      </NavLink>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
