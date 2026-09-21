import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Info, RefreshCw } from 'lucide-react';
import { aiService, AIRecommendationsResult } from '@/services/ai';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/components/ui/utils';
import { CustomerPageHeader } from './_shared/customer-page-header';

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
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Gợi ý cho bạn"
        subtitle={
          result?.personalized
            ? `Dựa trên ${basis?.loans_used ?? 0} sách bạn đã mượn, ${basis?.wishlist_used ?? 0} sách yêu thích và ${basis?.ratings_used ?? 0} đánh giá của bạn.`
            : 'Dựa trên mức độ phổ biến và đánh giá chung của thư viện.'
        }
        actions={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Làm mới
          </button>
        }
      />

      {/* Never let a library-wide list pass as personal - say which one this is. */}
      {result && !result.personalized && !loading && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/70 bg-amber-50 p-3.5 dark:border-amber-500/20 dark:bg-amber-500/10">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
            Đây <strong>chưa phải</strong> gợi ý cá nhân hóa — bạn chưa có lịch sử mượn, sách yêu thích
            hay đánh giá nào để hệ thống học sở thích. Hãy mượn hoặc thêm sách vào danh sách yêu thích,
            gợi ý sẽ tự động sát với bạn hơn.
          </p>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl border bg-card" />)}
        </div>
      ) : error ? (
        <EmptyState
          variant="error"
          title="Không thể tải gợi ý"
          description={error}
          action={<button onClick={() => void load()} className="font-medium text-primary hover:underline">Thử lại</button>}
        />
      ) : recommendations.length === 0 ? (
        <EmptyState variant="no-data" title="Chưa có gợi ý" description="Thư viện chưa có sách phù hợp để gợi ý cho bạn." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {recommendations.map((rec, index) => {
            const match = Math.round((rec.score || 0) * 100);
            return (
              <motion.div
                key={rec.book_id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.05 }}
              >
                <NavLink
                  to={`/customer/books/${rec.book_id}`}
                  className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:border-violet-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:hover:border-violet-500/30"
                >
                  {rec.category ? (
                    <span className="mb-2 w-fit rounded-full border border-violet-100/60 bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-600 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-400">
                      {rec.category}
                    </span>
                  ) : null}
                  <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground transition-colors group-hover:text-violet-700 dark:group-hover:text-violet-400">
                    {rec.title}
                  </h3>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{rec.author || 'Chưa rõ tác giả'}</p>

                  <p className="mt-3 flex-1 text-[13px] leading-relaxed text-foreground/80">{rec.reason}</p>

                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Độ phù hợp</span>
                      <span className="font-semibold text-foreground">{match}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Độ phù hợp ${match}%`}>
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, match)}%` }} />
                    </div>
                  </div>
                </NavLink>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
