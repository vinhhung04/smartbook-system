import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { AlertCircle, BookOpen, Info, Loader2, RefreshCw, Sparkles, Star } from 'lucide-react';
import { aiService, AIRecommendationsResult } from '@/services/ai';

export function CustomerRecommendationsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AIRecommendationsResult | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setResult(await aiService.getRecommendationsAI(6));
    } catch (err) {
      console.error('Failed to load recommendations:', err);
      setError('Không thể tải gợi ý. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const recommendations = result?.recommendations ?? [];
  const basis = result?.basis;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[16px] text-foreground flex items-center gap-2" style={{ fontWeight: 650 }}>
            <Sparkles className="w-4 h-4 text-violet-500" /> Gợi ý cho bạn
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            {result?.personalized
              ? `Dựa trên ${basis?.loans_used ?? 0} sách bạn đã mượn, ${basis?.wishlist_used ?? 0} sách yêu thích và ${basis?.ratings_used ?? 0} đánh giá của bạn.`
              : 'Dựa trên mức độ phổ biến và đánh giá chung của thư viện.'}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-500/20 text-violet-700 dark:text-violet-400 text-[12px] hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-all disabled:opacity-50 shrink-0"
          style={{ fontWeight: 550 }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới
        </button>
      </div>

      {/* Never let a library-wide list pass as personal - say which one this is. */}
      {result && !result.personalized && !loading && (
        <div className="flex items-start gap-2.5 rounded-[12px] border border-amber-200/70 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10 p-3.5">
          <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
            Đây <strong>chưa phải</strong> gợi ý cá nhân hóa — bạn chưa có lịch sử mượn, sách yêu thích
            hay đánh giá nào để hệ thống học sở thích. Hãy mượn hoặc thêm sách vào danh sách yêu thích,
            gợi ý sẽ tự động sát với bạn hơn.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang phân tích sở thích đọc của bạn...
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 py-14 rounded-[12px] border border-rose-200/60 dark:border-rose-500/20 bg-card">
          <AlertCircle className="w-6 h-6 text-rose-500" />
          <p className="text-[13px] text-foreground" style={{ fontWeight: 600 }}>Không thể tải gợi ý</p>
          <p className="text-[12px] text-muted-foreground">{error}</p>
        </div>
      ) : recommendations.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 rounded-[12px] border border-border bg-card">
          <BookOpen className="w-6 h-6 text-muted-foreground" />
          <p className="text-[13px] text-foreground" style={{ fontWeight: 600 }}>Chưa có gợi ý</p>
          <p className="text-[12px] text-muted-foreground">Thư viện chưa có sách phù hợp để gợi ý cho bạn.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {recommendations.map((rec, index) => (
            <motion.div
              key={rec.book_id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
            >
              <NavLink
                to={`/customer/books/${rec.book_id}`}
                className="block h-full bg-card rounded-[14px] border border-border p-5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:border-violet-200 dark:hover:border-violet-500/30 transition-all group"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                    <BookOpen className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[13px] truncate text-foreground group-hover:text-violet-700 dark:group-hover:text-violet-400 transition-colors" style={{ fontWeight: 650 }}>
                      {rec.title}
                    </h4>
                    <p className="text-[11px] text-muted-foreground truncate">{rec.author || 'Chưa rõ tác giả'}</p>
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
                    {Array.from({ length: 5 }).map((_, starIndex) => (
                      <Star
                        key={starIndex}
                        className={`w-3 h-3 ${starIndex < Math.round((rec.score || 0) * 5) ? 'text-amber-400 fill-amber-400' : 'text-slate-200 dark:text-slate-700'}`}
                      />
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
    </div>
  );
}
