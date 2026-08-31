import { useEffect, useState, useCallback } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import {
  Sparkles, BookOpen, RefreshCw, Star, TrendingUp,
  BarChart3, AlertCircle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { aiService, AIRecommendation } from "@/services/ai";
import { bookService } from "@/services/book";
import { borrowService } from "@/services/borrow";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSpinner } from "@/components/ui/loading-state";

const PIE_COLORS = ["#6366f1", "#a78bfa", "#c084fc", "#e879f9", "#f472b6", "#fb7185", "#38bdf8", "#34d399"];

export function RecommendationsPage() {
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [provider, setProvider] = useState("");
  const [demandData, setDemandData] = useState<{ name: string; demand: number }[]>([]);
  const [categoryData, setCategoryData] = useState<{ name: string; value: number }[]>([]);
  const [error, setError] = useState("");
  const [personalized, setPersonalized] = useState(false);
  // The loans endpoint is not readable by every staff role. Surfacing that is the
  // point: an empty chart caused by a 403 must not look like "no data yet".
  const [loansError, setLoansError] = useState("");

  const loadRecommendations = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const [booksResp, loansResp] = await Promise.allSettled([
        bookService.getAll(),
        borrowService.getLoans({ pageSize: 100 }),
      ]);

      const books = booksResp.status === "fulfilled" && Array.isArray(booksResp.value) ? booksResp.value : [];
      const loans = loansResp.status === "fulfilled" ? loansResp.value?.data || [] : [];
      setLoansError(
        loansResp.status === "rejected"
          ? "Tài khoản của bạn không có quyền xem danh sách phiếu mượn, nên hai biểu đồ dưới đây chưa có dữ liệu."
          : ""
      );

      // Map a loan back to its book through variant ids. Comparing a loan item's
      // variant_id against book.id never matches - they are different primary keys.
      const bookByVariant = new Map<string, any>();
      books.forEach((b: any) => {
        const ids: string[] = Array.isArray(b.variant_ids) ? b.variant_ids : (b.variant_id ? [b.variant_id] : []);
        ids.forEach((variantId) => bookByVariant.set(String(variantId), b));
      });

      const catMap: Record<string, number> = {};
      books.forEach((b: any) => {
        const cat = b.category || "Khác";
        catMap[cat] = (catMap[cat] || 0) + 1;
      });
      setCategoryData(
        Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }))
      );

      const bookDemand = loans.reduce((acc: Record<string, number>, loan: any) => {
        (loan.loan_items || []).forEach((item: any) => {
          const book = bookByVariant.get(String(item.variant_id));
          if (!book) return;
          acc[book.title] = (acc[book.title] || 0) + 1;
        });
        return acc;
      }, {});
      setDemandData(
        Object.entries(bookDemand).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 6).map(([name, demand]) => ({ name: name.length > 20 ? name.slice(0, 20) + "…" : name, demand: demand as number }))
      );

      const result = await aiService.getRecommendationsAI(6);
      setRecommendations(result.recommendations || []);
      setProvider(result.ai_provider || "");
      setPersonalized(Boolean(result.personalized));
    } catch (err) {
      console.error("Failed to load recommendations:", err);
      setError("Không thể tải gợi ý. Vui lòng thử lại.");
      toast.error("Failed to load AI recommendations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRecommendations(); }, [loadRecommendations]);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Sparkles}
          title="Gợi ý & nhu cầu đọc"
          description={`Thống kê mượn sách toàn thư viện và gợi ý đầu sách${provider ? ` (${provider})` : ""}`}
          iconBg="bg-gradient-to-br from-violet-100 to-purple-50 border border-violet-200/40 dark:from-violet-500/15 dark:to-purple-500/10 dark:border-violet-500/20"
          iconColor="text-violet-600 dark:text-violet-400"
          actions={
            <button onClick={() => void loadRecommendations()} disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-500/20 text-violet-700 dark:text-violet-400 text-[12px] hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-all disabled:opacity-50" style={{ fontWeight: 550 }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Phân tích lại
            </button>
          }
        />
      </FadeItem>

      {loansError && (
        <FadeItem>
          <div className="flex items-start gap-2.5 rounded-[12px] border border-amber-200/70 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10 p-3.5">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">{loansError}</p>
          </div>
        </FadeItem>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <FadeItem>
          <div className="bg-card rounded-[16px] border border-border p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
            <h3 className="text-[14px] mb-4 flex items-center gap-2 text-foreground" style={{ fontWeight: 650 }}>
              <TrendingUp className="w-4 h-4 text-indigo-500 dark:text-indigo-400" /> Sách mượn nhiều nhất
            </h3>
            {demandData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={demandData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" fontSize={10} stroke="#94a3b8" />
                  <YAxis fontSize={11} stroke="#94a3b8" />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" }} />
                  <Bar dataKey="demand" radius={[8, 8, 0, 0]}>
                    {demandData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Chưa có dữ liệu mượn để thống kê." className="py-10" />
            )}
          </div>
        </FadeItem>
        <FadeItem>
          <div className="bg-card rounded-[16px] border border-border p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
            <h3 className="text-[14px] mb-4 flex items-center gap-2 text-foreground" style={{ fontWeight: 650 }}>
              <BarChart3 className="w-4 h-4 text-violet-500 dark:text-violet-400" /> Phân bố thể loại
            </h3>
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                    {categoryData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Chưa có thể loại để thống kê." className="py-10" />
            )}
          </div>
        </FadeItem>
      </div>

      <FadeItem>
        <h3 className="text-[14px] flex items-center gap-2 text-foreground" style={{ fontWeight: 650 }}>
          <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400" />
          {personalized ? "Gợi ý cho bạn" : "Gợi ý theo đánh giá và mức phổ biến"}
        </h3>
        {!personalized && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Tài khoản nhân viên không có lịch sử mượn cá nhân, nên đây là gợi ý chung của thư viện.
            Bạn đọc xem gợi ý riêng của mình trong mục &quot;Gợi ý cho bạn&quot; của cổng khách hàng.
          </p>
        )}
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
          className="bg-card rounded-[12px] border border-rose-200/60 dark:border-rose-500/20 py-12"
        />
      ) : recommendations.length === 0 ? (
        <EmptyState
          variant="no-data"
          icon={BookOpen}
          title="Chưa có gợi ý"
          description={provider === "fallback" ? "AI chưa khả dụng. Vui lòng kiểm tra cấu hình ANTHROPIC_API_KEY hoặc kết nối Ollama." : "Chưa có đủ dữ liệu để gợi ý. Hãy mượn thêm sách!"}
          className="bg-card rounded-[12px] border border-border py-12"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {recommendations.map((rec, i) => (
            <motion.div key={rec.book_id || i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <NavLink to={`/book/${rec.book_id}`}
                className="block h-full bg-card rounded-[14px] border border-border p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] dark:shadow-none transition-all group">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                  <BookOpen className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[13px] truncate text-foreground group-hover:text-violet-700 dark:group-hover:text-violet-400 transition-colors" style={{ fontWeight: 650 }}>{rec.title}</h4>
                  <p className="text-[11px] text-muted-foreground truncate">{rec.author}</p>
                </div>
              </div>
              {rec.category && (
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-violet-50 text-violet-600 border border-violet-100/60 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20 mb-2" style={{ fontWeight: 550 }}>
                  {rec.category}
                </span>
              )}
              <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">{rec.reason}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, si) => (
                    <Star key={si} className={`w-3 h-3 ${si < Math.round((rec.score || 0) * 5) ? "text-amber-400 fill-amber-400" : "text-slate-200 dark:text-slate-700"}`} />
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground" style={{ fontWeight: 550 }}>
                  Phù hợp {Math.round((rec.score || 0) * 100)}%
                </span>
              </div>
              </NavLink>
            </motion.div>
          ))}
        </div>
      )}

      <FadeItem>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Gợi ý", value: recommendations.length, color: "from-violet-50 to-purple-50/50 border-violet-100/60 dark:from-violet-500/10 dark:to-purple-500/5 dark:border-violet-500/20" },
            { label: "Thể loại phân tích", value: categoryData.length, color: "from-blue-50 to-indigo-50/50 border-blue-100/60 dark:from-blue-500/10 dark:to-indigo-500/5 dark:border-blue-500/20" },
            { label: "Sách đã phân tích", value: demandData.reduce((s, d) => s + d.demand, 0), color: "from-emerald-50 to-teal-50/50 border-emerald-100/60 dark:from-emerald-500/10 dark:to-teal-500/5 dark:border-emerald-500/20" },
            { label: "AI Provider", value: provider || "—", color: "from-rose-50 to-pink-50/50 border-rose-100/60 dark:from-rose-500/10 dark:to-pink-500/5 dark:border-rose-500/20" },
          ].map((s) => (
            <div key={s.label} className={`bg-gradient-to-br ${s.color} rounded-[12px] border p-3`}>
              <p className="text-[11px] text-muted-foreground mb-1" style={{ fontWeight: 550 }}>{s.label}</p>
              <p className="text-[22px] text-foreground" style={{ fontWeight: 700, lineHeight: 1 }}>{s.value}</p>
            </div>
          ))}
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
