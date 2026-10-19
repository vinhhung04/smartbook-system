import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { publicCatalogService, type PublicBranch } from '@/services/public-catalog';
import { usePageMeta } from '@/lib/page-meta';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/public/page-hero';
import { BranchCard } from '@/components/public/branch-card';
import { Reveal } from '@/components/public/book-row';

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
