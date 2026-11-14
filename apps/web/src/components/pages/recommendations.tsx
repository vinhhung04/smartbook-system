import { useEffect, useState, useCallback } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { Sparkles, BookOpen, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { aiService, AIRecommendation, type AIRecommendationsResult } from "@/services/ai";
import { bookService } from "@/services/book";
import { analyticsService } from "@/services/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSpinner } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";
import { AIRecommendationNotice } from "@/components/ai/decision-card";
import { RecommendationCard } from "@/components/ai/recommendation-card";

// Aggregated server-side (SQL GROUP BY over the whole loan_items table), not a
// client-side sample — so this is an honest "toàn thư viện" ranking regardless
// of how many loan records the library has accumulated.
const TOP_BOOKS_SINCE = "2000-01-01";
const TOP_BOOKS_ANALYSIS_LIMIT = 50;
const TOP_BOOKS_CHART_LIMIT = 6;

export function RecommendationsPage() {
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [provider, setProvider] = useState("");
  const [demandData, setDemandData] = useState<{ name: string; demand: number; bookId?: string | null }[]>([]);
  const [analyzedBorrowCount, setAnalyzedBorrowCount] = useState(0);
  const [categoryData, setCategoryData] = useState<{ name: string; value: number }[]>([]);
  const [categoryCount, setCategoryCount] = useState(0);
  const [coverByBookId, setCoverByBookId] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [personalized, setPersonalized] = useState(false);
  const [basis, setBasis] = useState<AIRecommendationsResult["basis"] | null>(null);
  const [model, setModel] = useState<AIRecommendationsResult["model"]>(undefined);
  // The top-books analytics endpoint is not readable by every staff role. Surfacing
  // that is the point: an empty chart caused by a 403 must not look like "no data yet".
  const [topBooksError, setTopBooksError] = useState("");

  const loadRecommendations = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const [booksResp, topBooksResp] = await Promise.allSettled([
        bookService.getAll(),
        analyticsService.getTopBooks({ from: TOP_BOOKS_SINCE, limit: TOP_BOOKS_ANALYSIS_LIMIT }),
      ]);

      const books = booksResp.status === "fulfilled" && Array.isArray(booksResp.value) ? booksResp.value : [];
      const topBooks = topBooksResp.status === "fulfilled" ? topBooksResp.value || [] : [];
      setTopBooksError(
        topBooksResp.status === "rejected"
          ? "Tài khoản của bạn không có quyền xem thống kê mượn sách, nên biểu đồ và số liệu phân tích bên dưới chưa có dữ liệu."
          : ""
      );

      const covers: Record<string, string> = {};
      books.forEach((b: any) => { if (b.cover_image_url) covers[b.id] = b.cover_image_url; });
      setCoverByBookId(covers);

      const catMap: Record<string, number> = {};
      books.forEach((b: any) => {
        const cat = b.category || "Khác";
        catMap[cat] = (catMap[cat] || 0) + 1;
      });
      const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
      setCategoryData(catEntries.slice(0, 8).map(([name, value]) => ({ name, value })));
      setCategoryCount(catEntries.length);

      // topBooks is already ranked library-wide by the analytics service (SQL
      // GROUP BY over every loan, not just a recent sample). The chart shows the
      // top 6; the "Sách đã phân tích" stat sums the same fetched set so the two
      // numbers can never disagree.
      setDemandData(
        topBooks.slice(0, TOP_BOOKS_CHART_LIMIT).map((b) => ({
          name: b.title,
          demand: b.borrow_count,
          bookId: b.book_id,
        }))
      );
      setAnalyzedBorrowCount(topBooks.reduce((sum, b) => sum + b.borrow_count, 0));

      const result = await aiService.getRecommendationsAI(6);
      setRecommendations(result.recommendations || []);
      setProvider(result.ai_provider || "");
      setPersonalized(Boolean(result.personalized));
      setBasis(result.basis ?? null);
      setModel(result.model);
    } catch (err) {
      console.error("Failed to load recommendations:", err);
      setError("Không thể tải gợi ý. Vui lòng thử lại.");
      toast.error("Không thể tải gợi ý sách");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRecommendations(); }, [loadRecommendations]);

  const providerLabel = provider === "openrouter" ? "OpenRouter" : provider === "fallback" ? "Dự phòng (không có AI)" : provider || "-";
  const leader = demandData[0];
  const lede = loading
    ? "Thống kê mượn sách toàn thư viện và gợi ý đầu sách."
    : leader
      ? `${leader.name} dẫn đầu với ${leader.demand.toLocaleString("vi-VN")} lượt mượn. ${recommendations.length} gợi ý ${personalized ? "theo lịch sử đọc của bạn" : "chung của thư viện"}${basis?.candidate_pool ? `, chọn từ ${basis.candidate_pool} sách ứng viên` : ""}.`
      : `${recommendations.length} gợi ý ${personalized ? "theo lịch sử đọc của bạn" : "chung của thư viện"}. Chưa có thống kê mượn sách.`;
  const maxDemand = Math.max(1, ...demandData.map((d) => d.demand));
  const maxCategory = Math.max(1, ...categoryData.map((d) => d.value));
  const stats = [
    { label: "Lượt mượn đã phân tích", value: analyzedBorrowCount.toLocaleString("vi-VN"), caption: `${TOP_BOOKS_ANALYSIS_LIMIT} đầu sách mượn nhiều nhất` },
    { label: "Thể loại trong danh mục", value: categoryCount.toLocaleString("vi-VN"), caption: "Biểu đồ hiện 8 thể loại lớn nhất" },
    { label: "Gợi ý", value: recommendations.length.toLocaleString("vi-VN"), caption: personalized ? "Theo lịch sử đọc của bạn" : "Gợi ý chung, chưa cá nhân hóa" },
    { label: "Nguồn AI", value: providerLabel, caption: basis?.global_interactions ? `${basis.global_interactions.toLocaleString("vi-VN")} lượt tương tác toàn thư viện` : model ? `Mô hình ${model}` : "AI chỉ diễn đạt lý do" },
  ];

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={Sparkles}
          title="Gợi ý & nhu cầu đọc"
          description={lede}
          actions={
            <Button variant="outline" size="sm" onClick={() => void loadRecommendations()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 motion-reduce:animate-none ${loading ? "animate-spin" : ""}`} /> Phân tích lại
            </Button>
          }
        />
      </FadeItem>

      {topBooksError && (
        <FadeItem>
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-500/20 dark:bg-amber-500/10" role="note">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <p className="text-[13px] leading-relaxed text-amber-900 dark:text-amber-200">{topBooksError}</p>
          </div>
        </FadeItem>
      )}

      {/* KPI strip: one container split into cells, each naming its basis. */}
      <FadeItem>
        <dl className="grid grid-cols-2 divide-border overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-4 lg:divide-x [&>div]:border-border max-lg:[&>div:nth-child(odd)]:border-r max-lg:[&>div:nth-child(-n+2)]:border-b">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 p-4 sm:p-5">
              <dt className="text-[13px] text-muted-foreground">{s.label}</dt>
              <dd className="mt-1 truncate font-display text-[20px] sm:text-[26px] font-semibold leading-tight tabular-nums text-foreground" title={s.value}>{loading ? "–" : s.value}</dd>
              <dd className="mt-1 text-[12px] text-muted-foreground">{s.caption}</dd>
            </div>
          ))}
        </dl>
      </FadeItem>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <FadeItem>
          <section aria-labelledby="top-books-title" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="top-books-title" className="font-display text-[18px] font-semibold tracking-tight">Sách mượn nhiều nhất</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Toàn thư viện, tính trên mọi lượt mượn từ trước đến nay.</p>
            {demandData.length > 0 ? (
              <ol className="mt-4 space-y-3">
                {demandData.map((d, i) => (
                  <li key={d.bookId || d.name} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                    <span className="text-right text-[13px] tabular-nums text-muted-foreground">{i + 1}</span>
                    {d.bookId ? (
                      <NavLink to={`/book/${d.bookId}`} className="truncate text-[14px] font-medium text-foreground underline-offset-2 hover:text-primary hover:underline" title={d.name}>{d.name}</NavLink>
                    ) : (
                      <span className="truncate text-[14px] font-medium text-foreground" title={d.name}>{d.name}</span>
                    )}
                    <span className="text-[13px] tabular-nums text-foreground">{d.demand.toLocaleString("vi-VN")} <span className="text-muted-foreground">lượt</span></span>
                    <span aria-hidden="true" />
                    <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-primary/10" aria-hidden="true">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${(d.demand / maxDemand) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Chưa có dữ liệu mượn để thống kê." className="py-10" />
            )}
          </section>
        </FadeItem>
        <FadeItem>
          <section aria-labelledby="categories-title" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="categories-title" className="font-display text-[18px] font-semibold tracking-tight">Phân bố thể loại</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Số đầu sách trong danh mục.</p>
            {categoryData.length > 0 ? (
              <ul className="mt-4 space-y-2.5">
                {categoryData.map((c) => (
                  <li key={c.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13px] text-foreground" title={c.name}>{c.name}</span>
                      <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{c.value}</span>
                    </div>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-primary/10" aria-hidden="true">
                      <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(c.value / maxCategory) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Chưa có thể loại để thống kê." className="py-10" />
            )}
          </section>
        </FadeItem>
      </div>

      <FadeItem>
        <div>
          <h2 className="font-display text-[18px] font-semibold tracking-tight text-foreground">
            {personalized ? "Gợi ý cho bạn" : "Gợi ý theo đánh giá và mức phổ biến"}
          </h2>
          <AIRecommendationNotice className="mt-1" />
          {!personalized && (
            <p className="mt-1 max-w-prose text-[13px] text-muted-foreground">
              Tài khoản nhân viên không có lịch sử mượn cá nhân, nên đây là gợi ý chung của thư viện.
              Bạn đọc xem gợi ý riêng của mình trong mục &quot;Gợi ý cho bạn&quot; của cổng khách hàng.
            </p>
          )}
        </div>
      </FadeItem>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner message="AI đang phân tích lịch sử mượn sách..." />
        </div>
      ) : error ? (
        <EmptyState
          variant="error"
          icon={AlertCircle}
          title="Không thể tải gợi ý"
          description={error}
          className="rounded-2xl border border-rose-200/60 bg-card py-12 dark:border-rose-500/20"
        />
      ) : recommendations.length === 0 ? (
        <EmptyState
          variant="no-data"
          icon={BookOpen}
          title="Chưa có gợi ý"
          description={provider === "fallback" ? "AI chưa khả dụng. Vui lòng kiểm tra cấu hình OPENROUTER_API_KEY." : "Chưa có đủ dữ liệu để gợi ý. Hãy mượn thêm sách!"}
          className="rounded-2xl border border-border bg-card py-12"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {recommendations.map((rec, i) => (
            <motion.div key={rec.book_id || i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <RecommendationCard
                rec={rec}
                href={`/book/${rec.book_id}`}
                coverUrl={coverByBookId[rec.book_id]}
                actions={(
                  <Button asChild size="sm" variant="outline">
                    <NavLink to={`/book/${rec.book_id}`}>Xem sách</NavLink>
                  </Button>
                )}
              />
            </motion.div>
          ))}
        </div>
      )}
    </PageWrapper>
  );
}
