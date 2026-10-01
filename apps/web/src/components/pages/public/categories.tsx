import { useEffect, useState } from 'react';
import { publicCatalogService, type PublicCategory } from '@/services/public-catalog';
import { usePageMeta } from '@/lib/page-meta';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/public/page-hero';
import { CategoryCard } from '@/components/public/category-card';
import { Reveal } from '@/components/public/book-row';

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
    <>
      <PageHero
        eyebrow="Thể loại"
        title="Khám phá theo thể loại"
        description={categories ? `${categories.length} thể loại đang có sách trong thư viện. Mỗi thẻ cho biết số đầu sách và số đang có trên kệ.` : 'Mọi thể loại đang có sách trong thư viện.'}
      />

      <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
        {error ? (
          <EmptyState variant="error" title="Không tải được danh sách thể loại" description="Máy chủ thư viện chưa phản hồi."
            action={<button type="button" onClick={() => { setError(false); setReloadKey((key) => key + 1); }} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Thử lại</button>} />
        ) : !categories ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-2xl bg-muted/60" />)}
          </div>
        ) : categories.length === 0 ? (
          <EmptyState variant="no-data" title="Chưa có thể loại nào" description="Thư viện chưa phân loại sách nào." />
        ) : (
          <Reveal>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => (
                <li key={category.slug}>
                  <CategoryCard category={category} />
                </li>
              ))}
            </ul>
          </Reveal>
        )}
      </div>
    </>
  );
}
