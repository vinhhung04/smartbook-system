import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";
import { motion } from "motion/react";
import { ClipboardCheck, ArrowRight, Package, UserCheck, Clock } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { putawayService, type PutawayReceiptSummary } from "@/services/putaway";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { authService } from "@/services/auth";
import { canManageReceiving } from "@/lib/rbac";
import { FadeItem, PageWrapper } from "../motion-utils";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function statusBadgeVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  const upper = String(status || "").toUpperCase();
  if (upper.includes("POSTED") || upper.includes("APPROVED") || upper.includes("READY")) return "success";
  if (upper.includes("PENDING")) return "warning";
  if (upper.includes("CANCEL") || upper.includes("REJECT")) return "danger";
  return "neutral";
}

function receiptAgingPriority(receivedAt: string | null): "LOW" | "MEDIUM" | "HIGH" | "URGENT" {
  if (!receivedAt) return "LOW";
  const receivedDate = new Date(receivedAt);
  if (Number.isNaN(receivedDate.getTime())) return "LOW";
  const hoursWaited = (Date.now() - receivedDate.getTime()) / (1000 * 60 * 60);
  if (hoursWaited >= 72) return "URGENT";
  if (hoursWaited >= 24) return "HIGH";
  if (hoursWaited >= 4) return "MEDIUM";
  return "LOW";
}

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
        toast.error(getApiErrorMessage(error, "Không tải được danh sách phiếu nhập đã duyệt"));
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
  const unassignedCount = receipts.filter((r) => !r.putaway_assignee_user_id).length;
  const assignedToMeCount = receipts.filter((r) => r.putaway_assignee_user_id === currentUserId).length;
  const colSpan = showAssign ? 10 : 9;

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
      await putawayService.assignStaff(receiptId, staffId);
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
    <PageWrapper className="space-y-6">
      <FadeItem>
        <NavLink
          to="/orders"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Quay lại danh sách
        </NavLink>
      </FadeItem>

      <FadeItem>
        <PageHeader
          icon={ClipboardCheck}
          title="Putaway"
          description={`${receipts.length} phiếu đã duyệt · ${totalRemaining} quyển chưa nhập kệ`}
          iconBg="bg-blue-100 dark:bg-blue-500/15"
          iconColor="text-blue-600 dark:text-blue-400"
        />
      </FadeItem>

      <FadeItem>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Phiếu chờ putaway" value={receipts.length} icon={Package} variant="default" />
          <StatCard label="Chưa nhận" value={unassignedCount} icon={Clock} variant="warning" />
          <StatCard label="Của bạn" value={assignedToMeCount} icon={UserCheck} variant="success" />
          <StatCard label="Quyển chưa nhập kệ" value={totalRemaining} icon={Package} variant="info" />
        </div>
      </FadeItem>

      <FadeItem>
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Tìm theo mã phiếu / kho"
          showSearchClear
        />
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-gradient-to-r from-blue-50/30 to-transparent dark:from-blue-500/10">
                  {["Mã phiếu", "Kho", "Ngày", "Trạng thái", "Ưu tiên", "Người duyệt", "Tổng dòng", "Còn lại", ...(showAssign ? ["Giao putaway"] : []), "Thao tác"].map((header) => (
                    <th key={header} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={colSpan} rows={4} />
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="py-12 text-center">
                      <EmptyState
                        variant="no-data"
                        title="Không có phiếu nhập nào sẵn sàng putaway"
                        description="Các phiếu nhập đã duyệt sẽ hiện ở đây"
                      />
                    </td>
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
                      <td className="px-4 py-3.5 text-[13px] font-semibold">{receipt.receipt_number}</td>
                      <td className="px-4 py-3.5 text-[13px] text-muted-foreground">{receipt.warehouse_code || receipt.warehouse_name || "-"}</td>
                      <td className="px-4 py-3.5 text-[12px] text-muted-foreground">{formatDate(receipt.received_at || receipt.created_at)}</td>
                      <td className="px-4 py-3.5">
                        <StatusBadge label={receipt.status} variant={statusBadgeVariant(receipt.status)} dot />
                      </td>
                      <td className="px-4 py-3.5">
                        <PriorityBadge priority={receiptAgingPriority(receipt.received_at || receipt.created_at)} />
                      </td>
                      <td className="px-4 py-3.5 text-[12px] text-muted-foreground">{receipt.approved_by_user_id ? receipt.approved_by_user_id.slice(0, 8) : "-"}</td>
                      <td className="px-4 py-3.5 text-[13px] text-muted-foreground">{receipt.line_count}</td>
                      <td className="px-4 py-3.5 text-[13px] font-semibold">{receipt.remaining_quantity}</td>
                      {showAssign && (
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <Select
                              value={assignState[receipt.id] || "none"}
                              onValueChange={(v) => setAssignState((prev) => ({ ...prev, [receipt.id]: v === "none" ? "" : v }))}
                            >
                              <SelectTrigger size="sm" className="h-8 min-w-[140px] text-[12px]">
                                <SelectValue placeholder="Chọn nhân viên" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Chọn nhân viên</SelectItem>
                                {warehouseStaff.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              size="sm"
                              disabled={assigningId === receipt.id}
                              loading={assigningId === receipt.id}
                              onClick={() => void handleAssign(receipt.id)}
                              className="shrink-0"
                            >
                              Giao
                            </Button>
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
                              className="inline-flex items-center rounded-[8px] border border-blue-200 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/15 disabled:opacity-50 transition-colors"
                            >
                              {claimingId === receipt.id ? "Đang nhận..." : "Tự nhận"}
                            </button>
                          )}
                          {receipt.putaway_assignee_user_id && receipt.putaway_assignee_user_id === currentUserId && (
                            <StatusBadge label="Của bạn" variant="success" />
                          )}
                          <NavLink
                            to={`/putaway/${receipt.id}`}
                            className="inline-flex items-center gap-1.5 rounded-[8px] bg-blue-50 dark:bg-blue-500/10 px-2.5 py-1.5 text-[12px] text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/15 font-semibold transition-colors"
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
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
