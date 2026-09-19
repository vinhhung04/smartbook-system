import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";
import { motion } from "motion/react";
import { ClipboardCheck, ArrowRight } from "lucide-react";
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
import { SectionCard } from "@/components/ui/section-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
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
          title="Nhập kệ (Putaway)"
          description="Cất sách từ phiếu nhập đã duyệt vào vị trí trên kệ"
          iconBg="bg-blue-100 dark:bg-blue-500/15"
          iconColor="text-blue-600 dark:text-blue-400"
        />
      </FadeItem>

      {receipts.length > 0 && (
        <FadeItem>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span><span className="font-semibold text-foreground">{receipts.length}</span> phiếu chờ putaway</span>
            <span aria-hidden="true">·</span>
            <span><span className="font-semibold text-foreground">{totalRemaining}</span> quyển chưa nhập kệ</span>
            {unassignedCount > 0 ? <StatusBadge label={`${unassignedCount} chưa nhận`} variant="warning" dot /> : null}
            {assignedToMeCount > 0 ? <StatusBadge label={`${assignedToMeCount} của bạn`} variant="success" dot /> : null}
          </p>
        </FadeItem>
      )}

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
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {[
                    { label: "Phiếu nhập", className: "" },
                    { label: "Trạng thái", className: "hidden w-[170px] sm:table-cell" },
                    { label: "Còn lại", className: "hidden w-[110px] md:table-cell" },
                    { label: "Phụ trách", className: cn("hidden lg:table-cell", showAssign ? "w-[330px]" : "w-[220px]") },
                    { label: "Thao tác", className: "w-[120px] text-right" },
                  ].map((header) => (
                    <th key={header.label} className={cn("px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground", header.className)}>{header.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={5} rows={4} />
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <EmptyState
                        variant="no-data"
                        title="Không có phiếu nhập nào sẵn sàng putaway"
                        description="Các phiếu nhập đã duyệt sẽ hiện ở đây"
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((receipt, index) => {
                    const isMine = receipt.putaway_assignee_user_id === currentUserId && Boolean(currentUserId);
                    const isAssigned = Boolean(receipt.putaway_assignee_user_id);
                    const assigneeName = isMine
                      ? "Của bạn"
                      : warehouseStaff.find((staff) => staff.id === receipt.putaway_assignee_user_id)?.full_name || "Đã giao";
                    const priority = receiptAgingPriority(receipt.received_at || receipt.created_at);

                    // Ownership lives in one place: who has it, plus the controls to take or hand it over.
                    const ownership = (
                      <div className="space-y-2">
                        <p className={cn("text-[12px]", isAssigned ? "font-medium text-foreground" : "text-muted-foreground")}>
                          {isAssigned ? assigneeName : "Chưa nhận"}
                        </p>
                        {(showAssign || !isAssigned) && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {showAssign && (
                              <>
                                <Select
                                  value={assignState[receipt.id] || "none"}
                                  onValueChange={(v) => setAssignState((prev) => ({ ...prev, [receipt.id]: v === "none" ? "" : v }))}
                                >
                                  <SelectTrigger size="sm" aria-label={`Chọn nhân viên cho phiếu ${receipt.receipt_number}`} className="h-8 min-w-0 flex-1 text-[12px]">
                                    <SelectValue placeholder="Chọn nhân viên" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Chọn nhân viên</SelectItem>
                                    {warehouseStaff.map((staff) => (
                                      <SelectItem key={staff.id} value={staff.id}>{staff.full_name}</SelectItem>
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
                              </>
                            )}
                            {!isAssigned && (
                              <button
                                type="button"
                                disabled={claimingId === receipt.id}
                                onClick={() => void handleClaimSelf(receipt.id)}
                                className="inline-flex shrink-0 items-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[12px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/15"
                              >
                                {claimingId === receipt.id ? "Đang nhận..." : "Tự nhận"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );

                    return (
                      <motion.tr
                        key={receipt.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(index, 10) * 0.02 }}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 align-top">
                          <p className="truncate text-[13px] font-semibold" title={receipt.receipt_number}>{receipt.receipt_number}</p>
                          <p className="truncate text-[12px] text-muted-foreground">
                            {[receipt.warehouse_code || receipt.warehouse_name, `${receipt.line_count} dòng`, formatDate(receipt.received_at || receipt.created_at)].filter(Boolean).join(" · ")}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:hidden">
                            <StatusBadge label={receipt.status} variant={statusBadgeVariant(receipt.status)} dot />
                            <PriorityBadge priority={priority} />
                          </div>
                          <p className="mt-1 text-[12px] text-muted-foreground md:hidden">Còn {receipt.remaining_quantity} quyển</p>
                          <div className="mt-2 lg:hidden">{ownership}</div>
                        </td>
                        <td className="hidden px-4 py-3 align-top sm:table-cell">
                          <div className="flex flex-col items-start gap-1.5">
                            <StatusBadge label={receipt.status} variant={statusBadgeVariant(receipt.status)} dot />
                            <PriorityBadge priority={priority} />
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 align-top md:table-cell">
                          <p className="text-[13px] font-semibold tabular-nums">{receipt.remaining_quantity}<span className="ml-1 text-[11px] font-normal text-muted-foreground">quyển</span></p>
                        </td>
                        <td className="hidden px-4 py-3 align-top lg:table-cell">{ownership}</td>
                        <td className="px-4 py-3 text-right align-top">
                          <NavLink
                            to={`/putaway/${receipt.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[12px] font-semibold text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/15"
                          >
                            Chi tiết <ArrowRight className="h-3 w-3" />
                          </NavLink>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
