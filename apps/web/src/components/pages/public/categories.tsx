import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { publicCatalogService, type PublicCategory } from '@/services/public-catalog';
import { usePageMeta } from '@/lib/page-meta';
import { EmptyState } from '@/components/ui/empty-state';

const numberFormat = new Intl.NumberFormat('vi-VN');

export function PublicCategoriesPage() {
  usePageMeta({ title: 'Thể loại', description: 'Duyệt sách theo thể loại tại thư viện SmartBook.' });
  const [categories, setCategories] = useState<PublicCategory[] | null>(null);
  const [error, setError] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    publicCatalogService.getCategories()
      .then((data) => { if (active) { setCategories(data); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [reloadKey]);

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
      <h1 className="font-serif text-[30px] font-semibold tracking-tight sm:text-[36px]">Thể loại</h1>
      <p className="mt-2 text-[14.5px] text-muted-foreground">Mọi thể loại đang có sách trong thư viện.</p>

      <div className="mt-8">
        {error ? (
          <EmptyState variant="error" title="Không tải được danh sách thể loại" description="Máy chủ thư viện chưa phản hồi."
            action={<button type="button" onClick={() => { setError(false); setReloadKey((key) => key + 1); }} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Thử lại</button>} />
        ) : !categories ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-lg bg-muted/60" />)}
          </div>
        ) : categories.length === 0 ? (
          <EmptyState variant="no-data" title="Chưa có thể loại nào" description="Thư viện chưa phân loại sách nào." />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <li key={category.slug}>
                <Link to={`/categories/${category.slug}`} className="group flex h-full items-center gap-5 rounded-lg border border-border bg-card p-5 transition-colors hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:hover:border-indigo-500/40">
                  <span className="relative h-24 w-20 shrink-0" aria-hidden="true">
                    {category.covers.map((cover, index) => (
                      <img key={cover} src={cover} alt="" loading="lazy" decoding="async"
                        className="absolute bottom-0 h-24 w-16 rounded-[3px] object-cover shadow-md"
                        style={{ left: `${index * 8}px`, transform: `rotate(${(index - 1) * 5}deg)` }} />
                    ))}
                    {category.covers.length === 0 ? <span className="absolute bottom-0 h-24 w-16 rounded-[3px] bg-muted" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-serif text-[19px] font-semibold leading-tight group-hover:underline">{category.name}</span>
                    <span className="mt-1 block text-[13px] text-muted-foreground">
                      {numberFormat.format(category.book_count)} đầu sách · {numberFormat.format(category.available_count)} đang có trên kệ
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
