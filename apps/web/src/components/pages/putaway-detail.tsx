import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { PageWrapper, FadeItem } from "../motion-utils";
import { ArrowLeft, ArrowRight, CheckCircle2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { hasPermission } from "@/services/http-clients";
import { putawayService, type PutawayReceiptDetail } from "@/services/putaway";
import { storageSuggestionService, type StorageSuggestion } from "@/services/storage-suggestion";
import { storageSuitability } from "@/lib/ai-decision";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/components/ui/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { AIRecommendationNotice } from "@/components/ai/decision-card";

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

// Top-ranked location per remaining line (rule-based ranking, PUTAWAY mode).
// `explain: false` keeps this preview free of AI paraphrase calls; the full
// ranking with reasons is on the putaway screen the "Nhập hàng" button opens.
type LineSuggestion =
  | { state: "loading" }
  | { state: "ok"; top: StorageSuggestion; needsMore: boolean }
  | { state: "none"; message?: string }
  | { state: "error" };

function SuggestionCell({ value }: { value: LineSuggestion | undefined }) {
  if (!value || value.state === "loading") return <span className="text-[12px] text-muted-foreground">Đang xếp hạng…</span>;
  if (value.state === "error") return <span className="text-[12px] text-red-600 dark:text-red-400">Không lấy được gợi ý</span>;
  if (value.state === "none") return <span className="text-[12px] text-amber-700 dark:text-amber-400">Chưa có vị trí phù hợp</span>;
  const suitability = storageSuitability(value.top.confidence);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[13px] font-semibold text-foreground">{value.top.locationCode}</span>
        <StatusBadge label={suitability.label} variant={suitability.tone} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Còn chứa được {value.top.availableCapacity}
        {value.needsMore ? ", cần thêm vị trí khác" : ""}
      </p>
    </div>
  );
}

export function PutawayDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PutawayReceiptDetail | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [suggestions, setSuggestions] = useState<Record<string, LineSuggestion>>({});
  const canViewSuggestions =
    hasPermission("inventory.stock.read") || hasPermission("inventory.operation.decide") || hasPermission("inventory.task.progress");

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await putawayService.getReceiptDetail(id);
        setDetail(data);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được chi tiết phiếu"));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id, refreshKey]);

  // Force reload when tab/window is focused again (user returns from another page)
  useEffect(() => {
    const handleFocus = () => {
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const remainingItems = useMemo(() => detail?.items.filter((item) => item.remaining_quantity > 0) || [], [detail]);

  useEffect(() => {
    if (!detail || !canViewSuggestions || remainingItems.length === 0) return;
    let cancelled = false;
    setSuggestions(Object.fromEntries(remainingItems.map((item) => [item.id, { state: "loading" } as LineSuggestion])));
    void Promise.all(remainingItems.map(async (item) => {
      let value: LineSuggestion;
      try {
        const res = await storageSuggestionService.getSuggestions({
          warehouse_id: detail.warehouse_id,
          variant_id: item.variant_id,
          quantity: item.remaining_quantity,
          mode: "PUTAWAY",
          explain: false,
        });
        const top = res.success ? res.suggestions?.[0] : undefined;
        value = top
          ? { state: "ok", top, needsMore: Number.isFinite(top.availableCapacity) && top.availableCapacity < item.remaining_quantity }
          : res.success ? { state: "none", message: res.message } : { state: "error" };
      } catch {
        value = { state: "error" };
      }
      if (!cancelled) setSuggestions((prev) => ({ ...prev, [item.id]: value }));
    }));
    return () => { cancelled = true; };
  }, [detail, remainingItems, canViewSuggestions]);

  if (loading) {
    return (
      <PageWrapper>
        <LoadingOverlay />
      </PageWrapper>
    );
  }

  if (!detail) {
    return (
      <PageWrapper>
        <EmptyState variant="no-data" title="Không tìm thấy phiếu nhập" />
      </PageWrapper>
    );
  }

  const shelvedPct = detail.total_quantity > 0 ? Math.min(100, Math.round((detail.putaway_quantity / detail.total_quantity) * 100)) : 0;
  const allShelved = remainingItems.length === 0;
  // Hidden columns are hidden per cell with container queries; no row spans them, so the grid stays aligned.
  const columns = [
    { label: "Sách", className: "pl-5" },
    { label: "Còn phải cất", className: "hidden w-[160px] @xl:table-cell" },
    ...(canViewSuggestions ? [{ label: "Vị trí gợi ý", className: "hidden w-[220px] @2xl:table-cell" }] : []),
    { label: "", className: "w-[130px] pr-5" },
  ];

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <Button asChild variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
          <NavLink to="/putaway"><ArrowLeft className="h-4 w-4" /> Phiếu chờ cất hàng</NavLink>
        </Button>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className="break-all font-mono text-[24px] font-semibold tracking-tight text-foreground">{detail.receipt_number}</h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {detail.warehouse_name || detail.warehouse_code || "-"}, ghi sổ lúc {formatDate(detail.received_at || detail.created_at)}.
            </p>
          </div>
          <Button
            onClick={() => navigate('/receiving-putaway', {
              state: {
                warehouseId: detail.warehouse_id,
                goodsReceiptId: detail.id,
              },
            })}
            disabled={detail.remaining_quantity <= 0}
            data-testid="start-putaway-button"
          >
            <PackageCheck className="h-4 w-4" /> Bắt đầu cất hàng
          </Button>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-[12px] text-muted-foreground">Đã lên kệ</p>
          <p className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground">
            {detail.putaway_quantity}<span className="font-sans text-[14px] font-normal text-muted-foreground"> / {detail.total_quantity} cuốn</span>
          </p>
          <Progress value={shelvedPct} className="mt-3 h-1.5" aria-label={`Đã lên kệ ${shelvedPct}%`} />
          {allShelved ? (
            <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Tất cả sách trong phiếu đã được xếp lên kệ.
            </p>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Còn <span className="font-semibold tabular-nums text-foreground">{detail.remaining_quantity}</span> cuốn chờ lên kệ, ở {remainingItems.length}/{detail.items.length} dòng.
            </p>
          )}
        </div>
      </FadeItem>

      <FadeItem>
        <section aria-labelledby="putaway-lines-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
          <div className="px-5 pb-3 pt-4">
            <h2 id="putaway-lines-title" className="font-serif text-[17px] font-semibold tracking-tight">Sách trong phiếu</h2>
            {canViewSuggestions && !allShelved ? (
              <AIRecommendationNotice className="mt-1" />
            ) : (
              <p className="mt-0.5 text-[13px] text-muted-foreground">Mỗi dòng là một đầu sách cần đưa lên kệ.</p>
            )}
          </div>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((head, index) => (
                  <TableHead key={index} className={cn("px-3 text-[12px] font-medium text-muted-foreground", head.className)}>
                    {head.label || <span className="sr-only">Thao tác</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.items.map((item) => {
                const done = item.remaining_quantity <= 0;
                const linePct = item.quantity > 0 ? Math.min(100, Math.round((item.putaway_quantity / item.quantity) * 100)) : 0;
                return (
                  <TableRow key={item.id} className="hover:bg-muted/40">
                    <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                      <p className={cn("line-clamp-2 text-[14px]", done ? "text-muted-foreground" : "font-medium text-foreground")} title={item.book_title}>{item.book_title}</p>
                      <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">{item.isbn13 || item.sku || item.barcode || "-"}</p>
                      <p className="mt-1.5 text-[12px] text-muted-foreground @xl:hidden">
                        {done ? `Đã cất đủ ${item.quantity} cuốn` : <>Còn <span className="font-semibold tabular-nums text-foreground">{item.remaining_quantity}</span> cuốn, đã cất {item.putaway_quantity}/{item.quantity}</>}
                      </p>
                      {canViewSuggestions && !done && (
                        <div className="mt-2 @2xl:hidden">
                          <p className="mb-0.5 text-[12px] text-muted-foreground">Vị trí gợi ý</p>
                          <SuggestionCell value={suggestions[item.id]} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden px-3 py-3.5 align-top @xl:table-cell">
                      <p className="font-serif text-[18px] font-semibold leading-tight tabular-nums text-foreground">
                        {item.remaining_quantity}<span className="font-sans text-[12px] font-normal text-muted-foreground"> cuốn</span>
                      </p>
                      <Progress value={linePct} className="mt-1.5 h-1.5" aria-label={`Đã cất ${linePct}%`} />
                      <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">Đã cất {item.putaway_quantity}/{item.quantity}</p>
                    </TableCell>
                    {canViewSuggestions && (
                      <TableCell className="hidden px-3 py-3.5 align-top @2xl:table-cell">
                        {done ? <span className="text-[12px] text-muted-foreground">Không cần</span> : <SuggestionCell value={suggestions[item.id]} />}
                      </TableCell>
                    )}
                    <TableCell className="py-3.5 pl-3 pr-5 text-right align-top">
                      {done ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Đã xong
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate('/receiving-putaway', {
                            state: {
                              warehouseId: detail.warehouse_id,
                              variantId: item.variant_id,
                              bookTitle: item.book_title,
                              goodsReceiptId: detail.id,
                              maxQuantity: item.remaining_quantity,
                            },
                          })}
                          data-testid="start-putaway-button"
                          aria-label={`Cất ${item.book_title}`}
                        >
                          Cất hàng <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      </FadeItem>
    </PageWrapper>
  );
}
