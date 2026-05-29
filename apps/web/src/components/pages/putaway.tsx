import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";
import { motion } from "motion/react";
import { ClipboardCheck, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { putawayService, type PutawayReceiptSummary } from "@/services/putaway";
import { goodsReceiptService } from "@/services/goods-receipt";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { authService } from "@/services/auth";
import { canManageReceiving } from "@/lib/rbac";
import { FadeItem, PageWrapper } from "../motion-utils";

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
  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
  const [assignState, setAssignState] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState("");
  const [claimingId, setClaimingId] = useState("");

  const currentUser = authService.getCurrentUser();
  const showAssign = canManageReceiving(currentUser);
  const currentUserId = currentUser?.id || "";

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [data, staffRes] = await Promise.all([
          putawayService.getReadyReceipts(),
          showAssign ? userService.getWarehouseStaff() : Promise.resolve({ data: [] }),
        ]);
        setReceipts(Array.isArray(data) ? data : []);
        setWarehouseStaff(Array.isArray(staffRes.data) ? staffRes.data : []);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach phieu nhap da duyet"));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [showAssign]);

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

  const handleClaimSelf = async (receiptId: string) => {
    setClaimingId(receiptId);
    try {
      await putawayService.claimSelf(receiptId);
      toast.success("Đã nhận task thành công");
      const data = await putawayService.getReadyReceipts();
      setReceipts(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể nhận task"));
    } finally {
      setClaimingId("");
    }
  };

  const handleAssign = async (receiptId: string) => {
    const staffId = assignState[receiptId];
    if (!staffId) {
      toast.error("Chọn nhân viên trước khi giao task");
      return;
    }
    setAssigningId(receiptId);
    try {
      await goodsReceiptService.assign(receiptId, staffId);
      toast.success("Đã giao putaway task cho nhân viên");
      const data = await putawayService.getReadyReceipts();
      setReceipts(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Giao task thất bại"));
    } finally {
      setAssigningId("");
    }
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink
          to="/orders"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:text-blue-600"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Quay lai danh sach
        </NavLink>
      </FadeItem>

      <FadeItem>
        <h1 className="tracking-[-0.02em]">Putaway</h1>
        <p className="text-[12px] text-slate-500 mt-1">{receipts.length} phieu da duyet · {totalRemaining} quyen chua nhap ke</p>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tim theo ma phieu / kho"
            className="w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
          />
        </div>
      </FadeItem>

      <FadeItem>
        <div className="overflow-hidden rounded-[16px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-gradient-to-r from-blue-50/30 to-transparent">
                {["Ma phieu", "Kho", "Ngay", "Trang thai", "Nguoi duyet", "Tong dong", "Con lai", ...(showAssign ? ["Giao putaway"] : []), "Action"].map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={showAssign ? 9 : 8} className="text-center py-14 text-[13px] text-slate-400">Dang tai danh sach phieu nhap...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={showAssign ? 9 : 8} className="py-12 text-center">
                    <p className="text-[13px] text-slate-400">Khong co phieu nhap nao san sang putaway</p>
                    <p className="text-[11px] text-slate-400 mt-1">Cac phieu nhap da duyet se hien o day</p>
                  </td>
                </tr>
              ) : (
                filtered.map((receipt, index) => (
                  <motion.tr
                    key={receipt.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.02 }}
                    className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-4 py-3.5 text-[13px] font-semibold">{receipt.receipt_number}</td>
                    <td className="px-4 py-3.5 text-[13px] text-slate-600">{receipt.warehouse_code || receipt.warehouse_name || "-"}</td>
                    <td className="px-4 py-3.5 text-[12px] text-slate-500">{formatDate(receipt.received_at || receipt.created_at)}</td>
                    <td className="px-4 py-3.5 text-[12px] text-emerald-600 font-semibold">{receipt.status}</td>
                    <td className="px-4 py-3.5 text-[12px] text-slate-500">{receipt.approved_by_user_id ? receipt.approved_by_user_id.slice(0, 8) : "-"}</td>
                    <td className="px-4 py-3.5 text-[13px] text-slate-600">{receipt.line_count}</td>
                    <td className="px-4 py-3.5 text-[13px] font-semibold">{receipt.remaining_quantity}</td>
                    {showAssign && (
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={assignState[receipt.id] || ""}
                            onChange={(e) => setAssignState((prev) => ({ ...prev, [receipt.id]: e.target.value }))}
                            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px]"
                          >
                            <option value="">Chọn nhân viên</option>
                            {warehouseStaff.map((s) => (
                              <option key={s.id} value={s.id}>{s.full_name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={assigningId === receipt.id}
                            onClick={() => void handleAssign(receipt.id)}
                            className="h-8 rounded-md bg-violet-600 px-2.5 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
                          >
                            {assigningId === receipt.id ? "..." : "Giao"}
                          </button>
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        {!receipt.putaway_assignee_user_id && (
                          <button
                            type="button"
                            disabled={claimingId === receipt.id}
                            onClick={() => void handleClaimSelf(receipt.id)}
                            className="inline-flex items-center rounded-[8px] border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                          >
                            {claimingId === receipt.id ? "Đang nhận..." : "Tự nhận"}
                          </button>
                        )}
                        {receipt.putaway_assignee_user_id && receipt.putaway_assignee_user_id === currentUserId && (
                          <span className="rounded-[6px] bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                            Của bạn
                          </span>
                        )}
                        <NavLink
                          to={`/putaway/${receipt.id}`}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-blue-50 px-2.5 py-1.5 text-[12px] text-blue-600 hover:bg-blue-100 font-semibold transition-colors"
                        >
                          Xem chi tiết <ArrowRight className="w-3 h-3" />
                        </NavLink>
                      </div>
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
