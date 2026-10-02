import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import axios from 'axios';
import { ArrowRight, MapPin } from 'lucide-react';
import { publicCatalogService, type PublicBranchDetail } from '@/services/public-catalog';
import { usePageMeta } from '@/lib/page-meta';
import { branchBooksUrl } from '@/lib/branch-links';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/public/page-hero';
import { BranchStatus } from '@/components/public/branch-status';
import { BookRow, BookRowSkeleton, Reveal, SectionHeading } from '@/components/public/book-row';
import { useReserveAction } from '@/components/public/use-reserve-action';
import { ReserveModal } from '@/components/pages/customer/_shared/reserve-modal';

const numberFormat = new Intl.NumberFormat('vi-VN');

function Breadcrumb({ name }: { name?: string }) {
  return (
    <nav aria-label="Đường dẫn" className="text-[13px] text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        <li><Link to="/" className="hover:text-foreground hover:underline">Trang chủ</Link></li>
        <li aria-hidden="true">/</li>
        <li><Link to="/branches" className="hover:text-foreground hover:underline">Chi nhánh</Link></li>
        {name ? (
          <>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-foreground">{name}</li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}

export function PublicBranchDetailPage() {
  const { id = '' } = useParams();
  const [branch, setBranch] = useState<PublicBranchDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const { target, requestReserve, closeReserve } = useReserveAction();

  useEffect(() => {
    let active = true;
    publicCatalogService.getBranch(id)
      .then((data) => { if (active) { setBranch(data); setStatus('ready'); } })
      .catch((err) => { if (active) setStatus(axios.isAxiosError(err) && err.response?.status === 404 ? 'not-found' : 'error'); });
    return () => { active = false; };
  }, [id, reloadKey]);

  const retry = () => {
    setBranch(null);
    setStatus('loading');
    setReloadKey((key) => key + 1);
  };

  usePageMeta({
    title: branch ? branch.name : 'Chi nhánh',
    description: branch
      ? `${branch.name}${branch.address ? ` — ${branch.address}` : ''}. Xem sách đang có sẵn để mượn và đặt trước để nhận tại chi nhánh này.`
      : undefined,
  });

  if (status === 'not-found') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState variant="no-data" title="Không tìm thấy chi nhánh" description="Chi nhánh này không tồn tại hoặc đã ngừng hoạt động."
          action={<Link to="/branches" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Xem các chi nhánh khác</Link>} />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState variant="error" title="Không tải được thông tin chi nhánh" description="Máy chủ thư viện chưa phản hồi."
          action={<button type="button" onClick={retry} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Thử lại</button>} />
      </div>
    );
  }
  if (!branch) {
    return (
      <>
        <PageHero
          top={<Breadcrumb />}
          eyebrow="Chi nhánh"
          title={<><span className="sr-only">Đang tải chi nhánh</span><span className="inline-block h-10 w-72 max-w-full animate-pulse rounded bg-muted align-middle" aria-hidden="true" /></>}
        />
        <div className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-8" aria-busy="true"><BookRowSkeleton /></div>
      </>
    );
  }

  const { stats } = branch;
  // The second shelf shows what the branch owns beyond what is on the first one.
  const shownAvailable = new Set(branch.available_books.map((book) => book.id));
  const otherBooks = branch.new_arrivals.filter((book) => !shownAvailable.has(book.id));
  const facts = [
    { label: 'Đầu sách tại chi nhánh', value: stats.title_count },
    { label: 'Đầu sách có sẵn để mượn', value: stats.available_title_count },
    { label: 'Bản sách sẵn sàng trên kệ', value: stats.available_copies },
  ];

  return (
    <>
      <PageHero
        top={<Breadcrumb name={branch.name} />}
        eyebrow="Chi nhánh"
        title={branch.name}
        description={(
          <span className="flex gap-2">
            <MapPin className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            {branch.address || 'Địa chỉ đang được cập nhật'}
          </span>
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <BranchStatus />
          {stats.title_count > 0 ? (
            <Link
              to={branchBooksUrl(branch)}
              className="group inline-flex h-11 items-center gap-1.5 rounded-full bg-indigo-700 px-5 text-[14px] font-semibold text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              Khám phá sách tại chi nhánh này <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </PageHero>

      <div className="mx-auto max-w-7xl space-y-16 px-4 pt-10 sm:px-6 lg:px-8">
        {stats.title_count === 0 ? (
          <EmptyState variant="no-data" title="Chi nhánh chưa có sách trên kệ" description="Bạn có thể tìm sách ở các chi nhánh khác hoặc xem toàn bộ danh mục."
            action={(
              <div className="flex flex-wrap justify-center gap-4">
                <Link to="/branches" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Các chi nhánh khác</Link>
                <Link to="/books" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Toàn bộ danh mục</Link>
              </div>
            )} />
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              {facts.map((fact) => (
                <div key={fact.label} className="rounded-2xl border border-border bg-card px-5 py-4">
                  <dt className="text-[12.5px] text-muted-foreground">{fact.label}</dt>
                  <dd className="mt-1 font-serif text-[28px] font-semibold tabular-nums">{numberFormat.format(fact.value)}</dd>
                </div>
              ))}
            </dl>

            {branch.available_books.length ? (
              <BookRow
                id="co-san-tai-chi-nhanh"
                eyebrow="Mượn ngay"
                title="Có sẵn tại chi nhánh"
                basis="Đặt trước trực tuyến rồi đến chi nhánh này nhận sách. Xếp theo lượt mượn."
                books={branch.available_books}
                seeAllTo={`/books?branch=${branch.id}&availability=available`}
                onReserve={requestReserve}
              />
            ) : (
              <p className="rounded-2xl border border-border bg-card px-5 py-4 text-[14px] text-muted-foreground">
                Hiện mọi bản sách của chi nhánh đều đang được mượn. Bạn có thể xem các cuốn bên dưới hoặc tìm ở chi nhánh khác.
              </p>
            )}

            <BookRow
              id="sach-cua-chi-nhanh"
              eyebrow="Mới cập nhật"
              title="Sách khác tại chi nhánh"
              basis="Đầu sách chi nhánh đang giữ, mới thêm vào thư viện trước — kể cả cuốn đang được mượn."
              books={otherBooks}
              seeAllTo={`/books?branch=${branch.id}&sort=newest`}
              onReserve={requestReserve}
            />

            {branch.categories.length ? (
              <Reveal>
                <section aria-labelledby="the-loai-chi-nhanh">
                  <SectionHeading id="the-loai-chi-nhanh" eyebrow="Thể loại" title="Thể loại tại chi nhánh" />
                  <ul className="flex flex-wrap gap-2">
                    {branch.categories.map((category) => (
                      <li key={category.slug}>
                        <Link
                          to={`/books?branch=${branch.id}&category=${encodeURIComponent(category.slug)}`}
                          className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-[13.5px] font-medium text-foreground/85 transition-colors hover:border-indigo-300 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:hover:text-indigo-300"
                        >
                          {category.name}
                          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{numberFormat.format(category.book_count)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              </Reveal>
            ) : null}
          </>
        )}
      </div>

      <ReserveModal book={target} onClose={closeReserve} onSuccess={() => { closeReserve(); setReloadKey((key) => key + 1); }} />
    </>
  );
}
