import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Heart, Info, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { aiService, AIRecommendationsResult } from '@/services/ai';
import { customerCatalogService } from '@/services/customer-catalog';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/http-clients';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';
import { AIRecommendationNotice } from '@/components/ai/decision-card';
import { RecommendationCard } from '@/components/ai/recommendation-card';
import { CustomerPageHeader } from './_shared/customer-page-header';

export function CustomerRecommendationsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AIRecommendationsResult | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [wishlisted, setWishlisted] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [recs, books] = await Promise.allSettled([
        aiService.getRecommendationsAI(6),
        customerCatalogService.getBooks(),
      ]);
      if (recs.status === 'rejected') throw recs.reason;
      setResult(recs.value);
      // Covers are cosmetic: a catalog failure must not hide the recommendations.
      if (books.status === 'fulfilled') {
        const map: Record<string, string> = {};
        books.value.forEach((b) => { if (b.cover_image_url) map[b.id] = b.cover_image_url; });
        setCovers(map);
      }
    } catch (err) {
      console.error('Failed to load recommendations:', err);
      setError(getApiErrorMessage(err, 'Không thể tải gợi ý. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addToWishlist = async (bookId: string) => {
    setSavingId(bookId);
    try {
      await customerBorrowService.addToWishlist(bookId);
      setWishlisted((prev) => new Set(prev).add(bookId));
      toast.success('Đã thêm vào danh sách yêu thích');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Không thể thêm vào danh sách yêu thích'));
    } finally {
      setSavingId(null);
    }
  };

  const recommendations = result?.recommendations ?? [];
  const basis = result?.basis;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Gợi ý cho bạn"
        subtitle={
          !result
            ? 'Đang phân tích lịch sử đọc của bạn…'
            : result.personalized
              ? `Dựa trên ${basis?.loans_used ?? 0} sách bạn đã mượn, ${basis?.wishlist_used ?? 0} sách yêu thích và ${basis?.ratings_used ?? 0} đánh giá của bạn.`
              : 'Dựa trên mức độ phổ biến và đánh giá chung của thư viện.'
        }
        actions={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" /> Làm mới
          </button>
        }
      />

      <AIRecommendationNotice />

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Đang tải gợi ý">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-52 animate-pulse rounded-xl border bg-card" />)}
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
            const saved = wishlisted.has(rec.book_id);
            return (
              <motion.div
                key={rec.book_id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.05 }}
              >
                <RecommendationCard
                  rec={rec}
                  href={`/customer/books/${rec.book_id}`}
                  coverUrl={covers[rec.book_id]}
                  actions={(
                    <>
                      <Button asChild size="sm" variant="default">
                        <NavLink to={`/customer/books/${rec.book_id}`}>Xem sách & đặt trước</NavLink>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void addToWishlist(rec.book_id)}
                        disabled={saved}
                        loading={savingId === rec.book_id}
                        loadingLabel="Đang thêm…"
                        aria-pressed={saved}
                      >
                        <Heart className={cn('h-3.5 w-3.5', saved && 'fill-current')} aria-hidden="true" />
                        {saved ? 'Đã yêu thích' : 'Thêm yêu thích'}
                      </Button>
                    </>
                  )}
                />
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
