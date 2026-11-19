import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BookOpenCheck, MessageSquareText, Sparkles } from 'lucide-react';
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

/** What happens between typing a wish and seeing books, in the reader's words. */
const STEPS = [
  { icon: MessageSquareText, title: 'Bạn mô tả', text: 'Viết cuốn sách bạn muốn bằng lời của mình: chủ đề, cảm giác, độ khó.' },
  { icon: Sparkles, title: 'AI hiểu ý nghĩa', text: 'SmartBook so mô tả với phần giới thiệu của từng cuốn, không chỉ khớp từ khóa.' },
  { icon: BookOpenCheck, title: 'Chỉ sách đang có', text: 'Kết quả là sách thật của thư viện, kèm chi nhánh còn sách để đặt trước.' },
];

/** The empty /discover page: how it works, then books readers are borrowing now, as a place to start. */
function DiscoverStart({ onReserve }: { onReserve: ReturnType<typeof useReserveAction>['requestReserve'] }) {
  const [popular, setPopular] = useState<PublicBook[]>([]);
  useEffect(() => {
    let active = true;
    publicCatalogService.getHome()
      .then((home) => { if (active) setPopular((home.trending.length ? home.trending : home.most_borrowed).slice(0, 6)); })
      .catch(() => { /* optional row: hide on failure */ });
    return () => { active = false; };
  }, []);

  return (
    <>
      <ol className="mt-12 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-2xl bg-card p-5 ring-1 ring-border">
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                <step.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">Bước {index + 1}</span>
            </span>
            <h2 className="mt-3 font-display text-[18px] font-semibold tracking-[-0.01em]">{step.title}</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{step.text}</p>
          </li>
        ))}
      </ol>
      {popular.length ? (
        <section aria-labelledby="dang-duoc-muon" className="mt-16">
          <h2 id="dang-duoc-muon" className="font-display text-[22px] font-semibold tracking-[-0.01em]">Chưa có ý tưởng? Bắt đầu từ sách đang được quan tâm</h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground">Những cuốn bạn đọc mượn, đặt trước và yêu thích nhiều nhất gần đây.</p>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
            {popular.map((book) => <li key={book.id}><PublicBookCard book={book} onReserve={onReserve} /></li>)}
          </ul>
        </section>
      ) : null}
    </>
  );
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
  const reduce = useReducedMotion();
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
      <div className="mx-auto max-w-5xl px-4 pb-8 pt-10 sm:px-6 lg:px-8">
        <DiscoveryBox headingLevel={1} />
        <DiscoverStart onReserve={requestReserve} />
        <ReserveModal book={target} onClose={closeReserve} onSuccess={closeReserve} />
      </div>
    );
  }

  return (
    <>
      <PageHero
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
              {view.items.map(({ book, matched }, index) => (
                // Results arrive one after another, the best match first.
                <motion.li
                  key={book.id}
                  className="flex flex-col"
                  initial={reduce ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: Math.min(index, 11) * 0.06 }}
                >
                  <PublicBookCard book={book} onReserve={requestReserve} />
                  {view.status === 'ai' ? (
                    <p className="mt-2 text-[11.5px] text-muted-foreground">{matched.map((m) => MATCH_LABELS[m]).join(' · ')}</p>
                  ) : null}
                </motion.li>
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
