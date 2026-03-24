import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";
import { motion } from "motion/react";
import { ClipboardCheck, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { putawayService, type PutawayReceiptSummary } from "@/services/putaway";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";

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
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-3"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-50 flex items-center justify-center border border-blue-200/40">
          <ClipboardCheck className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Putaway</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">{receipts.length} phieu da duyet · {totalRemaining} quyen chua nhap ke</p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Tim theo ma phieu / kho"
          showSearchClear
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <SectionCard noPadding>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Ma phieu", "Kho", "Ngay", "Trang thai", "Nguoi duyet", "Tong dong", "Con lai", "Action"].map((header) => (
                  <th key={header} className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-14 text-[13px] text-muted-foreground">Dang tai danh sach phieu nhap...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}><EmptyState variant="no-data" title="Khong co phieu nhap nao san sang putaway" description="Cac phieu nhap da duyet se hien o day" className="py-12" /></td>
                </tr>
              ) : (
                filtered.map((receipt, index) => (
                  <motion.tr
                    key={receipt.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.02 }}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-5 py-3.5 text-[13px] font-semibold">{receipt.receipt_number}</td>
                    <td className="px-5 py-3.5 text-[13px]">{receipt.warehouse_code || receipt.warehouse_name || "-"}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(receipt.received_at || receipt.created_at)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-emerald-700 font-semibold">{receipt.status}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{receipt.approved_by_user_id ? receipt.approved_by_user_id.slice(0, 8) : "-"}</td>
                    <td className="px-5 py-3.5 text-[13px]">{receipt.line_count}</td>
                    <td className="px-5 py-3.5 text-[13px] font-semibold">{receipt.remaining_quantity}</td>
                    <td className="px-5 py-3.5">
                      <NavLink to={`/putaway/${receipt.id}`} className="inline-flex items-center gap-1.5 text-[12px] text-blue-600 hover:text-blue-700 font-semibold">
                        Xem chi tiet <ArrowRight className="w-3.5 h-3.5" />
                      </NavLink>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </SectionCard>
      </motion.div>
    </div>
  );
}
