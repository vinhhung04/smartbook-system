import { useEffect, useState, useCallback } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import {
  Sparkles, BookOpen, RefreshCw, Star, TrendingUp,
  BarChart3, Loader2, AlertCircle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import { toast } from "sonner";
import { aiService, AIRecommendation } from "@/services/ai";
import { bookService } from "@/services/book";
import { borrowService } from "@/services/borrow";

const PIE_COLORS = ["#6366f1", "#a78bfa", "#c084fc", "#e879f9", "#f472b6", "#fb7185", "#38bdf8", "#34d399"];

export function RecommendationsPage() {
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [provider, setProvider] = useState("");
  const [demandData, setDemandData] = useState<{ name: string; demand: number }[]>([]);
  const [categoryData, setCategoryData] = useState<{ name: string; value: number }[]>([]);
  const [error, setError] = useState("");

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

      const borrowHistory = loans.flatMap((loan: any) =>
        (loan.loan_items || []).map((item: any) => {
          const book = books.find((b: any) => b.id === item.variant_id || b.variants?.some((v: any) => v.id === item.variant_id));
          return { title: book?.title || "Unknown", author: book?.author || "", category: book?.category || "" };
        })
      );

      const catalogBooks = books.map((b: any) => ({
        id: b.id, title: b.title, author: b.author || "", category: b.category || "", quantity: Number(b.quantity || 0),
      }));

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
          const book = books.find((b: any) => b.id === item.variant_id || b.variants?.some((v: any) => v.id === item.variant_id));
          const title = book?.title || "Unknown";
          acc[title] = (acc[title] || 0) + 1;
        });
        return acc;
      }, {});
      setDemandData(
        Object.entries(bookDemand).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 6).map(([name, demand]) => ({ name: name.length > 20 ? name.slice(0, 20) + "…" : name, demand: demand as number }))
      );

      const result = await aiService.getRecommendationsAI(borrowHistory, catalogBooks);
      setRecommendations(result.recommendations || []);
      setProvider(result.ai_provider || "");
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-violet-100 to-purple-50 flex items-center justify-center border border-violet-200/40">
              <Sparkles className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h1 className="tracking-[-0.02em]">AI Recommendations</h1>
              <p className="text-[12px] text-slate-400 mt-0.5">
                Gợi ý sách cá nhân hóa dựa trên lịch sử mượn
                {provider && <span className="ml-1 text-violet-400">({provider})</span>}
              </p>
            </div>
          </div>
          <button onClick={() => void loadRecommendations()} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-violet-200 text-violet-700 text-[12px] hover:bg-violet-50 transition-all disabled:opacity-50" style={{ fontWeight: 550 }}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Phân tích lại
          </button>
        </div>
      </FadeItem>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <FadeItem>
          <div className="bg-white rounded-[16px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <h3 className="text-[14px] mb-4 flex items-center gap-2" style={{ fontWeight: 650 }}>
              <TrendingUp className="w-4 h-4 text-indigo-500" /> Sách mượn nhiều nhất
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
              <div className="h-[220px] flex items-center justify-center text-slate-400 text-[13px]">Chưa có dữ liệu</div>
            )}
          </div>
        </FadeItem>
        <FadeItem>
          <div className="bg-white rounded-[16px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <h3 className="text-[14px] mb-4 flex items-center gap-2" style={{ fontWeight: 650 }}>
              <BarChart3 className="w-4 h-4 text-violet-500" /> Phân bố thể loại
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
              <div className="h-[220px] flex items-center justify-center text-slate-400 text-[13px]">Chưa có dữ liệu</div>
            )}
          </div>
        </FadeItem>
      </div>

      <FadeItem>
        <h3 className="text-[14px] flex items-center gap-2" style={{ fontWeight: 650 }}>
          <Sparkles className="w-4 h-4 text-violet-500" /> Gợi ý cho bạn
        </h3>
      </FadeItem>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
          <p className="text-[13px] text-slate-400">AI đang phân tích lịch sử mượn sách...</p>
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-white rounded-[12px] border border-rose-200/60">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
          <p className="text-[13px] text-rose-600">{error}</p>
        </div>
      ) : recommendations.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-[12px] border border-white/80">
          <BookOpen className="w-8 h-8 text-violet-300 mx-auto mb-2" />
          <p className="text-[13px] text-slate-400">Chưa có đủ dữ liệu để gợi ý. Hãy mượn thêm sách!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {recommendations.map((rec, i) => (
            <motion.div key={rec.book_id || i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="bg-white rounded-[14px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all group">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                  <BookOpen className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[13px] truncate group-hover:text-violet-700 transition-colors" style={{ fontWeight: 650 }}>{rec.title}</h4>
                  <p className="text-[11px] text-slate-400 truncate">{rec.author}</p>
                </div>
              </div>
              {rec.category && (
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-violet-50 text-violet-600 border border-violet-100/60 mb-2" style={{ fontWeight: 550 }}>
                  {rec.category}
                </span>
              )}
              <p className="text-[12px] text-slate-600 leading-relaxed mb-3">{rec.reason}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, si) => (
                    <Star key={si} className={`w-3 h-3 ${si < Math.round((rec.score || 0) * 5) ? "text-amber-400 fill-amber-400" : "text-slate-200"}`} />
                  ))}
                </div>
                <span className="text-[10px] text-slate-400" style={{ fontWeight: 550 }}>
                  Phù hợp {Math.round((rec.score || 0) * 100)}%
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <FadeItem>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Gợi ý", value: recommendations.length, color: "from-violet-50 to-purple-50/50 border-violet-100/60" },
            { label: "Thể loại phân tích", value: categoryData.length, color: "from-blue-50 to-indigo-50/50 border-blue-100/60" },
            { label: "Sách đã phân tích", value: demandData.reduce((s, d) => s + d.demand, 0), color: "from-emerald-50 to-teal-50/50 border-emerald-100/60" },
            { label: "AI Provider", value: provider || "—", color: "from-rose-50 to-pink-50/50 border-rose-100/60" },
          ].map((s) => (
            <div key={s.label} className={`bg-gradient-to-br ${s.color} rounded-[12px] border p-3`}>
              <p className="text-[11px] text-slate-500 mb-1" style={{ fontWeight: 550 }}>{s.label}</p>
              <p className="text-[22px] text-slate-700" style={{ fontWeight: 700, lineHeight: 1 }}>{s.value}</p>
            </div>
          ))}
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
