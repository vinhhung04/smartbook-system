import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { PageWrapper, FadeItem } from "../motion-utils";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { hasPermission } from "@/services/http-clients";
import { putawayService, type PutawayReceiptDetail } from "@/services/putaway";
import { storageSuggestionService, type StorageSuggestion } from "@/services/storage-suggestion";
import { storageSuitability } from "@/lib/ai-decision";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingOverlay } from "@/components/ui/loading-state";
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
        {value.needsMore ? " · cần thêm vị trí khác" : ""}
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

  const headers = ["ISBN-13", "Tên sách", "Số lượng", "Đã lên kệ", "Còn chờ xếp kệ", ...(canViewSuggestions ? ["Vị trí gợi ý"] : []), "Nhập hàng"];

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <NavLink to="/putaway" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors" style={{ fontWeight: 550 }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Quay lại danh sách cất hàng
        </NavLink>
      </FadeItem>

      <FadeItem>
        <PageHeader
          icon={PackageCheck}
          title={detail.receipt_number}
          description={`Kho: ${detail.warehouse_code || detail.warehouse_name || "-"} · Ngày duyệt: ${formatDate(detail.received_at || detail.created_at)}`}
          iconBg="bg-violet-100 dark:bg-violet-500/15"
          iconColor="text-violet-600 dark:text-violet-400"
          actions={
            <button
              onClick={() => navigate('/receiving-putaway', {
                state: {
                  warehouseId: detail.warehouse_id,
                  goodsReceiptId: detail.id,
                },
              })}
              disabled={detail.remaining_quantity <= 0}
              data-testid="start-putaway-button"
              className="inline-flex items-center gap-2 rounded-[10px] bg-violet-600 px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              <PackageCheck className="w-3.5 h-3.5" /> Nhập hàng
            </button>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground uppercase">Tổng số lượng</p>
            <p className="text-[24px] text-foreground" style={{ fontWeight: 700 }}>{detail.total_quantity}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground uppercase">Đã lên kệ</p>
            <p className="text-[24px] text-emerald-700 dark:text-emerald-400" style={{ fontWeight: 700 }}>{detail.putaway_quantity}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground uppercase">Còn lại</p>
            <p className="text-[24px] text-blue-700 dark:text-blue-400" style={{ fontWeight: 700 }}>{detail.remaining_quantity}</p>
          </div>
        </div>
      </FadeItem>

      {canViewSuggestions && remainingItems.length > 0 && (
        <FadeItem>
          <AIRecommendationNotice />
        </FadeItem>
      )}

      <FadeItem>
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-gradient-to-r from-blue-50/40 to-transparent dark:from-blue-500/10">
                  {headers.map((header) => (
                    <th key={header} className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0 hover:bg-blue-50/20 dark:hover:bg-blue-500/10 transition-colors">
                    <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{item.isbn13 || item.sku || item.barcode || "-"}</td>
                    <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>{item.book_title}</td>
                    <td className="px-5 py-3.5 text-[13px]">{item.quantity}</td>
                    <td className="px-5 py-3.5 text-[13px] text-emerald-700 dark:text-emerald-400">{item.putaway_quantity}</td>
                    <td className="px-5 py-3.5 text-[13px] text-blue-700 dark:text-blue-400" style={{ fontWeight: 600 }}>{item.remaining_quantity}</td>
                    {canViewSuggestions && (
                      <td className="px-5 py-3.5 min-w-[180px]">
                        {item.remaining_quantity > 0 ? <SuggestionCell value={suggestions[item.id]} /> : <span className="text-[12px] text-muted-foreground">—</span>}
                      </td>
                    )}
                    <td className="px-5 py-3.5 text-[12px]">
                      {item.remaining_quantity > 0 ? (
                        <button
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
                          className="inline-flex items-center gap-1.5 rounded-[8px] border border-violet-200 dark:border-violet-500/20 bg-violet-50 dark:bg-violet-500/10 px-3 py-1.5 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-500/15"
                          style={{ fontWeight: 600 }}
                        >
                          <PackageCheck className="w-3.5 h-3.5" /> Nhập hàng
                        </button>
                      ) : (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Đã xong</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </FadeItem>

      {remainingItems.length === 0 ? (
        <FadeItem>
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-700 dark:text-emerald-400">Tất cả sách trong phiếu đã được xếp lên kệ.</div>
        </FadeItem>
      ) : null}
    </PageWrapper>
  );
}
