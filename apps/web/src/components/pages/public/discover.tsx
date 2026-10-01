import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import axios from 'axios';
import { publicCatalogService, type PublicBook } from '@/services/public-catalog';
import { usePageMeta } from '@/lib/page-meta';
import { EmptyState } from '@/components/ui/empty-state';
import { BookCardSkeleton, PublicBookCard } from '@/components/public/public-book-card';
import { DiscoveryBox } from '@/components/public/discovery-box';
import { PageHero } from '@/components/public/page-hero';
import { useReserveAction } from '@/components/public/use-reserve-action';
import { ReserveModal } from '@/components/pages/customer/_shared/reserve-modal';

type Match = 'semantic' | 'keyword';
interface DiscoverState {
  /** Which query these results belong to; a mismatch means a new search is loading. */
  q: string;
  status: 'loading' | 'ai' | 'fallback' | 'none' | 'error';
  items: Array<{ book: PublicBook; matched: Match[] }>;
  uncertain?: boolean;
}

const MATCH_LABELS: Record<Match, string> = {
  semantic: 'Khớp nội dung giới thiệu',
  keyword: 'Khớp từ khóa',
};

/**
 * /discover?q=… — AI-assisted discovery. Results are real catalog books ranked by
 * the hybrid search; when AI is busy or down, the page falls back to the plain
 * keyword search instead of failing.
 */
export function PublicDiscoverPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const [state, setState] = useState<DiscoverState>({ q: '', status: 'loading', items: [] });
  const { target, requestReserve, closeReserve } = useReserveAction();
  usePageMeta({ title: q ? `Gợi ý cho “${q}”` : 'Không biết nên đọc gì?' });

  useEffect(() => {
    if (q.length < 3) return undefined;
    const controller = new AbortController();
    let active = true;
    const fallback = () => publicCatalogService.getBooks({ q, pageSize: 12 }, controller.signal)
      .then((page) => {
        if (active) setState({ q, status: page.data.length ? 'fallback' : 'none', items: page.data.map((book) => ({ book, matched: ['keyword'] })) });
      })
      .catch((err) => { if (active && !axios.isCancel(err)) setState({ q, status: 'error', items: [] }); });

    publicCatalogService.discover(q, controller.signal)
      .then((result) => {
        if (!active) return;
        if (result.results.length === 0) return fallback();
        setState({ q, status: 'ai', items: result.results, uncertain: result.status === 'UNCERTAIN' });
        return undefined;
      })
      .catch((err) => {
        if (active && !axios.isCancel(err)) void fallback();
      });
    return () => { active = false; controller.abort(); };
  }, [q]);

  const view: DiscoverState = state.q === q ? state : { q, status: 'loading', items: [] };

  if (q.length < 3) {
    return (
      <div className="mx-auto max-w-4xl px-4 pt-10 sm:px-6 lg:px-8">
        <DiscoveryBox />
      </div>
    );
  }

  return (
    <>
      <PageHero
        eyebrow="Không biết nên đọc gì? · Gợi ý bằng AI"
        title={`“${q}”`}
        description={(
          <span aria-live="polite">
            {view.status === 'loading' && 'Đang tìm trong thư viện… lần tìm đầu tiên có thể mất vài giây.'}
            {view.status === 'ai' && (view.uncertain
              ? 'Những cuốn gần nhất với mô tả của bạn — mức độ khớp chưa cao, hãy xem phần giới thiệu trước khi chọn.'
              : 'Những cuốn trong thư viện khớp nhất với mô tả của bạn.')}
            {view.status === 'fallback' && 'Gợi ý bằng AI tạm thời không dùng được, đây là kết quả tìm theo từ khóa.'}
            {(view.status === 'none' || view.status === 'error') && 'Chỉ gợi ý những cuốn thư viện đang có.'}
          </span>
        )}
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mt-10">
          {view.status === 'loading' ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6" aria-busy="true">
              {Array.from({ length: 6 }).map((_, index) => <BookCardSkeleton key={index} />)}
            </div>
          ) : view.status === 'error' ? (
            <EmptyState variant="error" title="Không tải được gợi ý" description="Máy chủ thư viện chưa phản hồi. Thử lại sau ít phút." />
          ) : view.status === 'none' ? (
            <EmptyState
              variant="no-results"
              title="Thư viện chưa có cuốn nào khớp mô tả này"
              description="Thử mô tả theo chủ đề hoặc thể loại, hoặc duyệt danh mục."
              action={<Link to="/categories" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Duyệt theo thể loại</Link>}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
              {view.items.map(({ book, matched }) => (
                <li key={book.id} className="flex flex-col">
                  <PublicBookCard book={book} onReserve={requestReserve} />
                  {view.status === 'ai' ? (
                    <p className="mt-2 text-[11.5px] text-muted-foreground">{matched.map((m) => MATCH_LABELS[m]).join(' · ')}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-16"><DiscoveryBox /></div>
        <ReserveModal book={target} onClose={closeReserve} onSuccess={closeReserve} />
      </div>
    </>
  );
}
