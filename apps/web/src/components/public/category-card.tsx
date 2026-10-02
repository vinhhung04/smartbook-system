import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { PublicCategory } from '@/services/public-catalog';
import { bindingFor } from '@/lib/book-binding';
import { cn } from '@/components/ui/utils';
import { TiltCard } from './tilt-card';

const numberFormat = new Intl.NumberFormat('vi-VN');

/**
 * Category card shared by the homepage bento and /categories: name, real counts,
 * and a fan of the category's covers that lifts on hover. `featured` is the
 * large bento tile (only enlarged from lg up, so phones keep one layout).
 */
export function CategoryCard({ category, featured = false }: { category: PublicCategory; featured?: boolean }) {
  return (
    <TiltCard className="h-full rounded-2xl" max={5}>
      <Link
        to={`/categories/${category.slug}`}
        className={cn(
          'group relative flex h-full min-h-40 overflow-hidden rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
          featured && 'lg:min-h-[21rem]',
        )}
      >
        <span className="pointer-events-none absolute inset-0 opacity-[0.07] dark:opacity-[0.16]" style={{ backgroundColor: bindingFor(category.name) }} aria-hidden="true" />
        <span className={cn('relative z-10 flex min-w-0 flex-col justify-between pr-28', featured && 'lg:pr-0')}>
          <span>
            <span className={cn('block font-serif text-[22px] font-semibold leading-tight tracking-tight', featured && 'lg:text-[30px]')}>{category.name}</span>
            <span className="mt-1.5 block text-[13px] text-muted-foreground">
              {numberFormat.format(category.book_count)} đầu sách · {numberFormat.format(category.available_count)} đang có trên kệ
            </span>
          </span>
          <span className="mt-6 inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
            Xem thể loại <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </span>
        </span>
        <span className={cn('pointer-events-none absolute bottom-0 right-4 h-32 w-28', featured && 'lg:right-8 lg:h-56 lg:w-44')} aria-hidden="true">
          {(category.covers.length ? category.covers : [null, null, null]).slice(0, 3).map((cover, coverIndex) => (
            <span
              key={cover || coverIndex}
              className="absolute bottom-[-12%] left-1/2 block w-[62%] origin-bottom"
              style={{
                transform: `translateX(-50%) rotate(${(coverIndex - 1) * 9}deg) translateX(${(coverIndex - 1) * 18}%)`,
                zIndex: coverIndex === 1 ? 3 : 2,
              }}
            >
              <span className="block transition-transform duration-500 group-hover:-translate-y-2 motion-reduce:transform-none">
                {cover ? (
                  <img src={cover} alt="" loading="lazy" decoding="async" className="aspect-[2/3] w-full rounded-[4px] object-cover shadow-lg" />
                ) : (
                  <span className="block aspect-[2/3] w-full rounded-[4px] shadow-lg" style={{ backgroundColor: bindingFor(`${category.name}-${coverIndex}`) }} />
                )}
              </span>
            </span>
          ))}
        </span>
      </Link>
    </TiltCard>
  );
}
