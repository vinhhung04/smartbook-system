import React, { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";
import { ClipboardCheck, ArrowRight, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { putawayService, type PutawayReceiptSummary } from "@/services/putaway";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { authService } from "@/services/auth";
import { canAccess, canManageReceiving, ROUTE_ACCESS } from "@/lib/rbac";
import { FadeItem, PageWrapper } from "../motion-utils";
import { PageHeader } from "@/components/ui/page-header";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/components/ui/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const GROUP_LABEL = ["Giao cho bạn", "Chưa có người nhận", "Người khác đang cất"];

// Group rows repeat these cells instead of using colSpan: a spanning row keeps the
// container-hidden columns in the table grid and squeezes the first column on phones.
const COLUMNS = [
  { label: "Phiếu nhập", className: "pl-5" },
  { label: "Còn phải cất", className: "hidden w-[160px] @xl:table-cell" },
  { label: "Người phụ trách", className: "hidden w-[300px] @3xl:table-cell" },
  { label: "", className: "w-[130px] pr-5" },
];

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
      toast.success("Đã nhận nhiệm vụ cất hàng");
      const data = await putawayService.getReadyReceipts();
      setReceipts(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể nhận nhiệm vụ"));
    } finally {
      setClaimingId("");
    }
  };

  const handleAssign = async (receiptId: string) => {
    const staffId = assignState[receiptId];
    if (!staffId) {
      toast.error("Chọn nhân viên trước khi giao nhiệm vụ");
      return;
    }
    setAssigningId(receiptId);
    try {
      await putawayService.assignStaff(receiptId, staffId);
      toast.success("Đã giao nhiệm vụ cất hàng cho nhân viên");
      const data = await putawayService.getReadyReceipts();
      setReceipts(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Giao nhiệm vụ thất bại"));
    } finally {
      setAssigningId("");
    }
  };

  // Same split as the picking queue: yours first, then nobody's, then someone else's; server order inside each.
  const groupOf = (receipt: PutawayReceiptSummary) => (
    currentUserId && receipt.putaway_assignee_user_id === currentUserId ? 0 : receipt.putaway_assignee_user_id ? 2 : 1
  );
  const groups = [0, 1, 2].map((group) => filtered.filter((receipt) => groupOf(receipt) === group));
  const lede = loading
    ? "Cất sách từ phiếu nhập đã ghi sổ lên vị trí trên kệ."
    : receipts.length === 0
      ? "Không có phiếu nhập nào chờ cất hàng."
      : `${receipts.length} phiếu chờ cất hàng, ${totalRemaining} cuốn chưa lên kệ${assignedToMeCount > 0 ? `, ${assignedToMeCount} phiếu giao cho bạn` : ""}${unassignedCount > 0 ? `, ${unassignedCount} phiếu chưa có người nhận` : ""}.`;

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ClipboardCheck}
          title="Cất hàng vào kệ"
          description={(
            <>
              {lede}
              {canAccess(currentUser, ROUTE_ACCESS.managerStockDecision) && (
                <>
                  {" "}Phiếu đến từ{" "}
                  <NavLink to="/orders" className="whitespace-nowrap rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Phiếu nhập kho
                  </NavLink>
                  {" "}sau khi được ghi sổ.
                </>
              )}
            </>
          )}
        />
      </FadeItem>

      <FadeItem>
        <section aria-labelledby="putaway-queue-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
          <div className="px-5 pb-1 pt-4">
            <h2 id="putaway-queue-title" className="font-serif text-[18px] font-semibold tracking-tight">Phiếu chờ cất hàng</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {showAssign ? "Giao phiếu cho nhân viên kho hoặc tự nhận, rồi mở phiếu để cất từng dòng lên kệ." : "Nhận phiếu chưa có người phụ trách, rồi mở phiếu để cất từng dòng lên kệ."}
            </p>
          </div>
          <div className="border-b border-border px-4 py-3">
            <FilterBar searchValue={query} onSearchChange={setQuery} searchPlaceholder="Mã phiếu hoặc kho" showSearchClear />
          </div>

          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {COLUMNS.map((head, index) => (
                  <TableHead key={index} className={cn("px-3 text-[12px] font-medium text-muted-foreground", head.className)}>
                    {head.label || <span className="sr-only">Thao tác</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <SkeletonTableRow columns={4} rows={4} />
              ) : filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="whitespace-normal py-12">
                    <EmptyState
                      variant={query ? "no-results" : "no-data"}
                      title={query ? "Không tìm thấy phiếu phù hợp" : "Không có phiếu nhập nào chờ cất hàng"}
                      description={query ? "Thử tìm theo mã phiếu hoặc mã kho." : "Phiếu nhập kho sau khi được ghi sổ sẽ hiện ở đây để cất lên kệ."}
                    />
                  </TableCell>
                </TableRow>
              ) : groups.map((rows, group) => rows.length === 0 ? null : (
                <React.Fragment key={group}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="whitespace-normal bg-muted/40 py-2 pl-5 text-[12px] font-semibold text-muted-foreground">
                      {GROUP_LABEL[group]} <span className="font-normal tabular-nums">({rows.length})</span>
                    </TableCell>
                    {COLUMNS.slice(1).map((column, index) => (
                      <TableCell key={index} aria-hidden="true" className={cn("bg-muted/40", column.className)} />
                    ))}
                  </TableRow>
                  {rows.map((receipt) => {
                    const isMine = receipt.putaway_assignee_user_id === currentUserId && Boolean(currentUserId);
                    const isAssigned = Boolean(receipt.putaway_assignee_user_id);
                    const assigneeName = isMine
                      ? "Bạn"
                      : warehouseStaff.find((staff) => staff.id === receipt.putaway_assignee_user_id)?.full_name || "Đã giao";
                    const priority = receiptAgingPriority(receipt.received_at || receipt.created_at);
                    const shelvedPct = receipt.total_quantity > 0 ? Math.min(100, Math.round((receipt.putaway_quantity / receipt.total_quantity) * 100)) : 0;

                    // Ownership lives in one place: who has it, plus the controls to take or hand it over.
                    const ownership = (
                      <div className="space-y-2">
                        {/* Unassigned rows sit under the "Chưa có người nhận" group header, so only a name is shown. */}
                        {isAssigned && <p className="text-[13px] font-medium text-foreground">{assigneeName}</p>}
                        {(showAssign || !isAssigned) && (
                          <div className="space-y-1">
                            {showAssign && (
                              <div className="flex w-full items-center gap-2">
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
                                  variant="outline"
                                  disabled={assigningId === receipt.id}
                                  loading={assigningId === receipt.id}
                                  onClick={() => void handleAssign(receipt.id)}
                                  className="shrink-0"
                                  title="Giao phiếu cho nhân viên đã chọn"
                                >
                                  {/* The narrow layout is too tight for the label; it stays readable to screen readers. */}
                                  <UserCheck className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only @3xl:not-sr-only">Giao</span>
                                </Button>
                              </div>
                            )}
                            {!isAssigned && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={claimingId === receipt.id}
                                loading={claimingId === receipt.id}
                                onClick={() => void handleClaimSelf(receipt.id)}
                                className="-ml-3 text-primary hover:text-primary"
                              >
                                Tự nhận
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );

                    return (
                      <TableRow key={receipt.id} className="hover:bg-muted/40">
                        <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                          <p className="truncate font-mono text-[13px] font-semibold text-foreground" title={receipt.receipt_number}>{receipt.receipt_number}</p>
                          <p className="mt-0.5 truncate text-[12px] text-muted-foreground" title={receipt.warehouse_name || undefined}>
                            {receipt.warehouse_name || receipt.warehouse_code || "-"}, {receipt.line_count} dòng
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-[12px] tabular-nums text-muted-foreground">Nhận lúc {formatDate(receipt.received_at || receipt.created_at)}</span>
                            {priority !== "LOW" && <PriorityBadge priority={priority} />}
                          </div>
                          <p className="mt-1.5 text-[12px] text-muted-foreground @xl:hidden">
                            Còn <span className="font-semibold tabular-nums text-foreground">{receipt.remaining_quantity}</span> cuốn chưa lên kệ, đã cất {receipt.putaway_quantity}/{receipt.total_quantity}
                          </p>
                          <div className="mt-2 @3xl:hidden">{ownership}</div>
                        </TableCell>
                        <TableCell className="hidden px-3 py-3.5 align-top @xl:table-cell">
                          <p className="font-serif text-[18px] font-semibold leading-tight tabular-nums text-foreground">
                            {receipt.remaining_quantity}<span className="font-sans text-[12px] font-normal text-muted-foreground"> cuốn còn lại</span>
                          </p>
                          <Progress value={shelvedPct} className="mt-1.5 h-1.5" aria-label={`Đã cất ${shelvedPct}%`} />
                          <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">Đã cất {receipt.putaway_quantity}/{receipt.total_quantity}</p>
                        </TableCell>
                        <TableCell className="hidden px-3 py-3.5 align-top @3xl:table-cell">{ownership}</TableCell>
                        <TableCell className="py-3.5 pl-3 pr-5 text-right align-top">
                          <Button asChild size="sm" variant={isMine ? "default" : "outline"}>
                            <NavLink to={`/putaway/${receipt.id}`}>
                              {isMine ? <>Cất hàng <ArrowRight className="h-3.5 w-3.5" /></> : "Chi tiết"}
                            </NavLink>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
          {!loading && filtered.length > 0 && (
            <p className="border-t border-border px-5 py-3 text-[12.5px] text-muted-foreground" aria-live="polite">
              Hiển thị {filtered.length} / {receipts.length} phiếu
            </p>
          )}
        </section>
      </FadeItem>
    </PageWrapper>
  );
}
