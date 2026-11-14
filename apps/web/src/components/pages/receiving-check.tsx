import React, { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { ClipboardList, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { FadeItem, PageWrapper } from "../motion-utils";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/components/ui/utils";
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

const GROUP_LABEL = ["Chờ kiểm đếm", "Đã kiểm đếm, chờ quản lý duyệt"];

// Group rows repeat these cells instead of using colSpan: a spanning row keeps the
// container-hidden columns in the table grid and squeezes the first column on phones.
const COLUMNS = [
  { label: "Phiếu nhập", className: "pl-5" },
  { label: "Theo phiếu", className: "hidden w-[130px] @xl:table-cell" },
  { label: "Thực đếm", className: "hidden w-[150px] @xl:table-cell" },
  { label: "Ngày tạo", className: "hidden w-[170px] @3xl:table-cell" },
  { label: "", className: "w-[130px] pr-5" },
];

/** Counted quantity against the receipt: the gap is what the manager will look at. */
function CountResult({ receipt }: { receipt: DraftReceipt }) {
  if (receipt.total_actual_quantity === null) {
    return <p className="text-[13px] text-muted-foreground">Chưa đếm</p>;
  }
  const diff = receipt.total_actual_quantity - receipt.total_planned_quantity;
  return (
    <div>
      <p className="font-serif text-[18px] font-semibold leading-tight tabular-nums text-foreground">
        {receipt.total_actual_quantity}<span className="font-sans text-[12px] font-normal text-muted-foreground"> cuốn</span>
      </p>
      <p className={cn("text-[12px]", diff === 0 ? "text-emerald-700 dark:text-emerald-400" : "font-medium text-amber-800 dark:text-amber-300")}>
        {diff === 0 ? "Khớp với phiếu" : diff > 0 ? `Dư ${diff} cuốn` : `Thiếu ${-diff} cuốn`}
      </p>
    </div>
  );
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

  // Uncounted receipts first; the server's newest-first order is kept inside each group.
  const groups = [receipts.filter((r) => !r.is_verified), receipts.filter((r) => r.is_verified)];
  const pendingCount = groups[0].length;
  const lede = loading
    ? "Đếm số lượng thực tế trong phiếu nhập kho được giao cho bạn, trước khi quản lý duyệt."
    : receipts.length === 0
      ? "Bạn chưa có phiếu nhập kho nào cần kiểm đếm."
      : `${receipts.length} phiếu nhập kho được giao cho bạn, ${pendingCount > 0 ? `${pendingCount} phiếu chưa kiểm đếm` : "tất cả đã kiểm đếm xong"}.`;

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title="Kiểm đếm hàng nhận"
          description={lede}
          actions={(
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Làm mới
            </Button>
          )}
        />
      </FadeItem>

      <FadeItem>
        <section aria-label="Phiếu cần kiểm đếm" className="@container overflow-hidden rounded-2xl border border-border bg-card">
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
                <SkeletonTableRow columns={5} rows={4} />
              ) : receipts.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="whitespace-normal py-12">
                    <EmptyState
                      variant="no-data"
                      icon={ClipboardList}
                      title="Không có phiếu nào cần kiểm đếm"
                      description="Khi quản lý giao một phiếu nhập kho nháp cho bạn, phiếu sẽ hiện ở đây."
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
                  {rows.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/40">
                      <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                        <p className="truncate font-mono text-[13px] font-semibold text-foreground" title={r.receipt_number}>{r.receipt_number}</p>
                        <p className="mt-0.5 truncate text-[12px] text-muted-foreground" title={r.warehouse_name || undefined}>
                          {r.warehouse_name || r.warehouse_code || "-"}
                        </p>
                        <div className="mt-1.5">
                          <StatusBadge label={r.is_verified ? "Đã kiểm đếm" : "Chờ kiểm đếm"} variant={r.is_verified ? "success" : "warning"} dot />
                        </div>
                        <div className="mt-2 space-y-0.5 text-[12px] text-muted-foreground @xl:hidden">
                          <p>
                            Theo phiếu <span className="font-semibold tabular-nums text-foreground">{r.total_planned_quantity}</span> cuốn, {r.item_count} dòng
                          </p>
                          {r.total_actual_quantity !== null && (
                            <p>
                              Thực đếm <span className="font-semibold tabular-nums text-foreground">{r.total_actual_quantity}</span> cuốn
                              {r.total_actual_quantity !== r.total_planned_quantity && (
                                <span className="text-amber-800 dark:text-amber-300">
                                  , {r.total_actual_quantity > r.total_planned_quantity ? "dư" : "thiếu"} {Math.abs(r.total_actual_quantity - r.total_planned_quantity)}
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] tabular-nums text-muted-foreground @3xl:hidden">Tạo lúc {formatDate(r.created_at)}</p>
                      </TableCell>
                      <TableCell className="hidden px-3 py-3.5 align-top @xl:table-cell">
                        <p className="font-serif text-[18px] font-semibold leading-tight tabular-nums text-foreground">
                          {r.total_planned_quantity}<span className="font-sans text-[12px] font-normal text-muted-foreground"> cuốn</span>
                        </p>
                        <p className="text-[12px] text-muted-foreground">{r.item_count} dòng</p>
                      </TableCell>
                      <TableCell className="hidden px-3 py-3.5 align-top @xl:table-cell">
                        <CountResult receipt={r} />
                      </TableCell>
                      <TableCell className="hidden px-3 py-3.5 align-top text-[13px] tabular-nums text-muted-foreground @3xl:table-cell">
                        {formatDate(r.created_at)}
                      </TableCell>
                      <TableCell className="py-3.5 pl-3 pr-5 text-right align-top">
                        <Button asChild size="sm" variant={r.is_verified ? "outline" : "default"}>
                          <NavLink to={`/orders/${r.id}`}>
                            {r.is_verified ? "Xem lại" : <>Kiểm đếm <ArrowRight className="h-3.5 w-3.5" /></>}
                          </NavLink>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </section>
      </FadeItem>
    </PageWrapper>
  );
}
