import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Clock, MapPin, Phone } from 'lucide-react';
import { publicCatalogService, type PublicBranch } from '@/services/public-catalog';
import { usePageMeta } from '@/lib/page-meta';
import { branchBooksUrl } from '@/lib/branch-links';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/public/page-hero';
import { BranchStatus } from '@/components/public/branch-status';
import { Reveal } from '@/components/public/book-row';

const numberFormat = new Intl.NumberFormat('vi-VN');

function BranchCard({ branch }: { branch: PublicBranch }) {
  const { stats } = branch;
  return (
    <article aria-labelledby={`chi-nhanh-${branch.id}`} className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <h2 id={`chi-nhanh-${branch.id}`} className="font-serif text-[22px] font-semibold leading-tight tracking-tight">{branch.name}</h2>
        <span className="shrink-0"><BranchStatus /></span>
      </div>
      <p className="mt-3 flex gap-2 text-[13.5px] leading-relaxed text-foreground/80">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {branch.address ? <span>{branch.address}</span> : <span className="text-muted-foreground">Địa chỉ đang được cập nhật</span>}
      </p>
      {branch.opening_hours ? (
        <p className="mt-1.5 flex gap-2 text-[13px] leading-relaxed text-foreground/80">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span><span className="sr-only">Giờ mở cửa: </span>{branch.opening_hours}</span>
        </p>
      ) : null}
      {branch.phone ? (
        <p className="mt-1.5 flex gap-2 text-[13px] text-foreground/80">
          <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <a href={`tel:${branch.phone.replace(/[^0-9+]/g, '')}`} className="hover:underline">{branch.phone}</a>
        </p>
      ) : null}

      {stats.title_count > 0 ? (
        <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <div>
            <dt className="text-[12px] text-muted-foreground">Đầu sách</dt>
            <dd className="mt-0.5 font-serif text-[24px] font-semibold tabular-nums">{numberFormat.format(stats.title_count)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Có sẵn để mượn</dt>
            <dd className="mt-0.5 font-serif text-[24px] font-semibold tabular-nums">{numberFormat.format(stats.available_title_count)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-5 border-t border-border pt-4 text-[13.5px] text-muted-foreground">Chi nhánh chưa có sách trên kệ.</p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-6">
        {stats.title_count > 0 ? (
          <Link
            to={branchBooksUrl(branch)}
            className="group inline-flex h-10 items-center gap-1.5 rounded-full bg-indigo-700 px-4 text-[13.5px] font-semibold text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            aria-label={`Xem sách tại ${branch.name}`}
          >
            Xem sách tại chi nhánh <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        ) : null}
        <Link
          to={`/branches/${branch.id}`}
          className="inline-flex h-10 items-center rounded-full px-4 text-[13.5px] font-semibold text-foreground ring-1 ring-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
          aria-label={`Xem chi tiết ${branch.name}`}
        >
          Xem chi tiết
        </Link>
      </div>
    </article>
  );
}

export function PublicBranchesPage() {
  usePageMeta({
    title: 'Chi nhánh thư viện',
    description: 'Danh sách chi nhánh thư viện SmartBook: địa chỉ, số đầu sách và sách đang có sẵn để mượn tại từng chi nhánh.',
  });
  const [branches, setBranches] = useState<PublicBranch[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    publicCatalogService.getBranches()
      .then((data) => { if (active) { setBranches(data); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [reloadKey]);

  return (
    <>
      <PageHero
        eyebrow="Hệ thống thư viện"
        title="Tìm chi nhánh SmartBook gần bạn"
        description="Xem địa chỉ và khám phá sách đang có tại từng chi nhánh. Đặt trước trực tuyến rồi đến chi nhánh bạn chọn để nhận sách."
      />

      <div className="mx-auto max-w-7xl space-y-16 px-4 pt-10 sm:px-6 lg:px-8">
        {error ? (
          <EmptyState variant="error" title="Không tải được danh sách chi nhánh" description="Máy chủ thư viện chưa phản hồi."
            action={<button type="button" onClick={() => { setError(false); setBranches(null); setReloadKey((key) => key + 1); }} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Thử lại</button>} />
        ) : !branches ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Đang tải danh sách chi nhánh">
            {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-64 animate-pulse rounded-2xl bg-muted/60" />)}
          </div>
        ) : branches.length === 0 ? (
          <EmptyState variant="no-data" title="Chưa có chi nhánh nào đang mở" description="Thư viện chưa công bố chi nhánh nào. Bạn vẫn có thể xem danh mục sách."
            action={<Link to="/books" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Xem danh mục sách</Link>} />
        ) : (
          <Reveal>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Chi nhánh">
              {branches.map((branch) => (
                <li key={branch.id}><BranchCard branch={branch} /></li>
              ))}
            </ul>
          </Reveal>
        )}

        <Reveal>
          <section aria-labelledby="dat-truoc-chi-nhanh" className="flex flex-col items-start justify-between gap-5 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-6 sm:flex-row sm:items-center sm:p-8 dark:border-indigo-500/25 dark:bg-indigo-950/20">
            <div className="max-w-2xl">
              <h2 id="dat-truoc-chi-nhanh" className="font-serif text-[22px] font-semibold tracking-tight">Đặt trước, nhận sách tại chi nhánh</h2>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                Mỗi cuốn sách đều cho biết chi nhánh nào còn bản. Với tài khoản bạn đọc, bạn đặt trước trực tuyến và chi nhánh giữ sách cho bạn.
              </p>
            </div>
            <Link to="/membership" className="inline-flex h-11 shrink-0 items-center rounded-full px-5 text-[14px] font-semibold text-foreground ring-1 ring-border hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
              Tìm hiểu thẻ bạn đọc
            </Link>
          </section>
        </Reveal>
      </div>
    </>
  );
}
