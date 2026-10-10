import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronRight, ClipboardCheck, Download, Package, Plus, RefreshCw, X } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { StatusBadge } from "../status-badge";
import { PageWrapper, FadeItem } from "../motion-utils";
import { goodsReceiptService, type GoodsReceipt } from "@/services/goods-receipt";
import { putawayService, type PutawayReceiptSummary } from "@/services/putaway";
import { userService } from "@/services/user";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { exportToCsv } from "@/lib/export-utils";

const PAGE_SIZE = 15;

// Where a receipt sits in the receiving flow. DRAFT splits three ways depending on
// whether someone has been assigned and whether every line has been counted;
// POSTED splits on whether stock is still waiting in the receiving area.
type Stage = "unassigned" | "counting" | "review" | "putaway" | "done" | "cancelled";

const STAGES: { key: Stage; label: string; tone: string; attention?: boolean }[] = [
  { key: "unassigned", label: "Chưa giao kiểm đếm", tone: "warning", attention: true },
  { key: "counting", label: "Đang kiểm đếm", tone: "info" },
  { key: "review", label: "Chờ duyệt", tone: "warning", attention: true },
  { key: "putaway", label: "Chờ cất hàng", tone: "violet" },
  { key: "done", label: "Hoàn tất", tone: "success" },
];
const CANCELLED_STAGE = { key: "cancelled" as const, label: "Đã hủy", tone: "danger" };
const STAGE_BY_KEY = Object.fromEntries([...STAGES, CANCELLED_STAGE].map((stage) => [stage.key, stage])) as Record<Stage, (typeof STAGES)[number]>;

function stageOf(receipt: GoodsReceipt, putawayReady: Map<string, PutawayReceiptSummary> | null): Stage {
  if (receipt.status === "CANCELLED") return "cancelled";
  if (receipt.status === "POSTED") return putawayReady?.has(receipt.id) ? "putaway" : "done";
  if (!receipt.received_by_user_id) return "unassigned";
  const lines = receipt.item_count || 0;
  return lines > 0 && (receipt.counted_line_count ?? 0) >= lines ? "review" : "counting";
}

function formatCurrency(value: number): string {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(value?: string | null) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

export function OrdersPage() {
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();
  const [stageFilter, setStageFilter] = useState<Stage | "ALL">("ALL");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [putawayReady, setPutawayReady] = useState<Map<string, PutawayReceiptSummary> | null>(null);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map());
  const [page, setPage] = useState(1);

  const load = async () => {
    try {
      setLoading(true);
      const [data, ready, staff] = await Promise.all([
        goodsReceiptService.getAll(),
        // Both only enrich the list; it still renders if either fails.
        putawayService.getReadyReceipts().catch(() => null),
        userService.getWarehouseStaff().catch(() => null),
      ]);
      setReceipts(Array.isArray(data) ? data : []);
      setPutawayReady(Array.isArray(ready) ? new Map(ready.map((receipt) => [receipt.id, receipt])) : null);
      setStaffNames(new Map((staff?.data ?? []).map((s) => [s.id, s.full_name || s.username])));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách phiếu nhập kho"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const personName = (userId?: string | null) => {
    if (!userId) return null;
    if (currentUser?.id && userId === currentUser.id) return "Bạn";
    return staffNames.get(userId) ?? null;
  };

  const rows = useMemo(
    () => receipts.map((receipt) => ({ receipt, stage: stageOf(receipt, putawayReady) })),
    [receipts, putawayReady],
  );

  const warehouses = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of receipts) map.set(r.warehouse_id, [r.warehouse_code, r.warehouse_name].filter(Boolean).join(" - ") || r.warehouse_id);
    return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [receipts]);

  // Counts follow the warehouse filter so the pipeline always matches the table under it.
  const scoped = useMemo(() => (warehouseFilter ? rows.filter((row) => row.receipt.warehouse_id === warehouseFilter) : rows), [rows, warehouseFilter]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: scoped.length };
    for (const row of scoped) map[row.stage] = (map[row.stage] ?? 0) + 1;
    return map;
  }, [scoped]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return scoped.filter(({ receipt, stage }) => {
      if (stageFilter !== "ALL" && stage !== stageFilter) return false;
      if (!query) return true;
      return [receipt.receipt_number, receipt.po_number, receipt.supplier_name, receipt.warehouse_code, receipt.warehouse_name]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [scoped, stageFilter, searchQuery]);

  useEffect(() => { setPage(1); }, [stageFilter, searchQuery, warehouseFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = stageFilter !== "ALL" || !!warehouseFilter || !!searchQuery.trim();

  const clearFilters = () => {
    setStageFilter("ALL");
    setWarehouseFilter("");
    setSearchQuery("");
  };

  const handleExport = () => {
    exportToCsv(
      filtered.map(({ receipt, stage }) => ({
        receipt_number: receipt.receipt_number,
        po_number: receipt.po_number || "",
        supplier_name: receipt.supplier_name || "",
        warehouse_name: receipt.warehouse_name || "",
        item_count: receipt.item_count,
        total_quantity: receipt.total_quantity ?? "",
        total_amount: receipt.total_amount,
        stage: STAGE_BY_KEY[stage].label,
        created_at: formatDate(receipt.created_at),
      })),
      [
        { header: "Số phiếu", key: "receipt_number" },
        { header: "Số PO", key: "po_number" },
        { header: "Nhà cung cấp", key: "supplier_name" },
        { header: "Kho", key: "warehouse_name" },
        { header: "Số dòng", key: "item_count" },
        { header: "Số cuốn", key: "total_quantity" },
        { header: "Tổng tiền", key: "total_amount" },
        { header: "Trạng thái", key: "stage" },
        { header: "Ngày tạo", key: "created_at" },
      ],
      "phieu-nhap-kho",
    );
  };

  const stageHint = (receipt: GoodsReceipt, stage: Stage) => {
    const name = personName(receipt.received_by_user_id);
    switch (stage) {
      case "unassigned": return { text: "Cần giao cho nhân viên kho đếm hàng", attention: true };
      case "counting": return { text: `${name ?? "Nhân viên"} · đã đếm ${receipt.counted_line_count ?? 0}/${receipt.item_count} dòng`, attention: false };
      case "review": return { text: `Đã đếm xong${name ? ` (${name})` : ""} — cần duyệt`, attention: true };
      case "putaway": {
        const ready = putawayReady?.get(receipt.id);
        return { text: ready ? `Còn ${ready.remaining_quantity}/${ready.total_quantity} cuốn chưa lên kệ` : "Hàng đang ở khu nhận", attention: false };
      }
      case "done": return { text: receipt.received_at ? `Nhập kho ${timeAgo(receipt.received_at)}` : "Đã nhập kho", attention: false };
      default: return null;
    }
  };

  const pipelineButton = (key: Stage | "ALL", label: string, attention = false) => {
    const active = stageFilter === key;
    const count = counts[key] ?? 0;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setStageFilter(key)}
        aria-pressed={active}
        className={cn(
          "flex flex-1 shrink-0 flex-col items-start rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
            : "border-transparent hover:border-border hover:bg-muted/50",
        )}
      >
        <span className={cn("text-[18px] font-semibold leading-tight tabular-nums", !active && (count ? "text-foreground" : "text-muted-foreground/60"))}>
          {loading ? "–" : count}
        </span>
        <span className={cn("flex items-center gap-1.5 whitespace-nowrap text-[11px]", active ? "font-medium" : "text-muted-foreground")}>
          {attention && count > 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="cần xử lý" />}
          {label}
        </span>
      </button>
    );
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Package}
          title="Phiếu nhập kho"
          description="Theo dõi hàng nhận từ lúc kiểm đếm, duyệt đến khi lên kệ"
          iconBg="bg-gradient-to-br from-blue-100 to-indigo-50 dark:from-blue-500/15 dark:to-indigo-500/10"
          iconColor="text-blue-600 dark:text-blue-400"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Làm mới">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                <span className="hidden sm:inline">Làm mới</span>
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
                <Download className="h-3.5 w-3.5" />Xuất CSV
              </Button>
              <Button asChild variant="outline" size="sm">
                <NavLink to="/putaway"><ClipboardCheck className="h-3.5 w-3.5" />Cất hàng</NavLink>
              </Button>
              <Button asChild size="sm">
                <NavLink to="/orders/new"><Plus className="h-3.5 w-3.5" />Phiếu mới</NavLink>
              </Button>
            </div>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none">
          <div className="flex items-center gap-0.5 overflow-x-auto p-2 [scrollbar-width:thin]" role="group" aria-label="Lọc theo bước xử lý">
            {pipelineButton("ALL", "Tất cả")}
            <span className="mx-1 h-8 w-px shrink-0 bg-border" aria-hidden="true" />
            {STAGES.map((stage, i) => (
              <Fragment key={stage.key}>
                {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />}
                {pipelineButton(stage.key, stage.label, stage.attention)}
              </Fragment>
            ))}
            <span className="mx-1 h-8 w-px shrink-0 bg-border" aria-hidden="true" />
            {pipelineButton(CANCELLED_STAGE.key, CANCELLED_STAGE.label)}
          </div>
          <div className="border-t border-border px-4 py-3">
            <FilterBar
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Tìm mã phiếu, mã PO, nhà cung cấp, kho..."
              showSearchClear
              filters={
                <>
                  {warehouses.length > 1 && (
                    <Select value={warehouseFilter || "__all__"} onValueChange={(v) => setWarehouseFilter(v === "__all__" ? "" : v)}>
                      <SelectTrigger size="sm" className="w-[200px]" aria-label="Kho">
                        <SelectValue placeholder="Tất cả kho" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Tất cả kho</SelectItem>
                        {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {hasFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                      <X className="h-3.5 w-3.5" />Xóa lọc
                    </Button>
                  )}
                </>
              }
            />
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {[
                  { label: "Phiếu nhập", className: "" },
                  { label: "Trạng thái", className: "hidden w-[240px] sm:table-cell" },
                  { label: "Số lượng", className: "hidden w-[150px] md:table-cell" },
                  { label: "Giá trị", className: "hidden w-[140px] text-right xl:table-cell" },
                  { label: "Ngày tạo", className: "hidden w-[150px] lg:table-cell" },
                ].map((heading) => (
                  <TableHead key={heading.label} className={cn("px-4 text-[11px] uppercase tracking-wider text-muted-foreground", heading.className)}>{heading.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <SkeletonTableRow columns={5} rows={5} />
              ) : paginated.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="whitespace-normal py-12">
                    {hasFilters ? (
                      <EmptyState
                        variant="no-results"
                        title="Không có phiếu phù hợp"
                        description="Thử bỏ bớt bộ lọc hoặc đổi từ khóa tìm kiếm"
                        action={<Button variant="outline" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" />Xóa lọc</Button>}
                      />
                    ) : (
                      <EmptyState variant="no-data" title="Chưa có phiếu nhập kho" description="Phiếu nhập được tạo khi nhận hàng theo hóa đơn nhà cung cấp hoặc nhập trực tiếp" />
                    )}
                  </TableCell>
                </TableRow>
              ) : paginated.map(({ receipt, stage }) => {
                const stageInfo = STAGE_BY_KEY[stage];
                const hint = stageHint(receipt, stage);
                const ready = stage === "putaway" ? putawayReady?.get(receipt.id) : undefined;
                const qty = receipt.total_quantity ?? null;
                return (
                  <TableRow key={receipt.id} onClick={() => navigate(`/orders/${receipt.id}`)} className="cursor-pointer">
                    <TableCell className="px-4 py-3">
                      <NavLink
                        to={`/orders/${receipt.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="block truncate rounded font-mono text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-indigo-400 dark:hover:text-indigo-300"
                      >
                        {receipt.receipt_number}
                      </NavLink>
                      <p className="truncate text-[12px] text-foreground/80">
                        {receipt.po_number ? (
                          <>
                            <NavLink
                              to={`/purchase-orders/${receipt.purchase_order_id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="rounded font-mono hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {receipt.po_number}
                            </NavLink>
                            {receipt.supplier_name ? ` · ${receipt.supplier_name}` : ""}
                          </>
                        ) : (
                          <span className="text-muted-foreground">Nhập trực tiếp, không theo PO</span>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {receipt.warehouse_code || receipt.warehouse_name || "-"}
                        <span className="md:hidden"> · {qty !== null ? `${qty} cuốn` : `${receipt.item_count} dòng`}</span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                        <StatusBadge label={stageInfo.label} variant={stageInfo.tone} dot />
                        {hint && <span className={cn("text-[11px]", hint.attention ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{hint.text}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden px-4 py-3 sm:table-cell">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge label={stageInfo.label} variant={stageInfo.tone} dot />
                        {hint && (
                          <span className={cn("max-w-full truncate text-[11px]", hint.attention ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")} title={hint.text}>
                            {hint.text}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden px-4 py-3 md:table-cell">
                      <p className="text-[13px] tabular-nums">
                        {qty !== null ? <><span className="font-semibold">{qty}</span> cuốn</> : "-"}
                        <span className="text-[11px] text-muted-foreground"> · {receipt.item_count} dòng</span>
                      </p>
                      {ready ? (
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Đã cất ${ready.putaway_quantity}/${ready.total_quantity} cuốn`}>
                          <div className="h-full rounded-full bg-violet-500" style={{ width: `${ready.total_quantity > 0 ? Math.round((ready.putaway_quantity / ready.total_quantity) * 100) : 0}%` }} />
                        </div>
                      ) : null}
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground xl:hidden">{formatCurrency(receipt.total_amount)}</p>
                    </TableCell>
                    <TableCell className={cn("hidden px-4 py-3 text-right font-mono text-[12px] tabular-nums xl:table-cell", !receipt.total_amount && "text-muted-foreground")}>
                      {formatCurrency(receipt.total_amount)}
                    </TableCell>
                    <TableCell className="hidden px-4 py-3 text-[12px] text-muted-foreground lg:table-cell" title={formatDate(receipt.created_at)}>
                      <p>{formatDate(receipt.created_at)}</p>
                      <p className="text-[11px]">{timeAgo(receipt.created_at)}</p>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-col gap-2 border-t border-border px-5 py-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {filtered.length > 0
                ? `Hiển thị ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} trong ${filtered.length} phiếu`
                : "Không có phiếu"}
            </span>
            {totalPages > 1 && (
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={(event) => { event.preventDefault(); setPage(Math.max(1, currentPage - 1)); }}
                      className={cn("cursor-pointer", currentPage === 1 && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                  {getPaginationRange(currentPage, totalPages).map((item, i) => (
                    <PaginationItem key={`${item}-${i}`}>
                      {typeof item === "number" ? (
                        <PaginationLink isActive={item === currentPage} onClick={(event) => { event.preventDefault(); setPage(item); }} className="cursor-pointer">
                          {item}
                        </PaginationLink>
                      ) : (
                        <PaginationEllipsis />
                      )}
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={(event) => { event.preventDefault(); setPage(Math.min(totalPages, currentPage + 1)); }}
                      className={cn("cursor-pointer", currentPage === totalPages && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
