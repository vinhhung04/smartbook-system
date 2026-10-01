import { useState } from 'react';
import { cn } from '@/components/ui/utils';
import { bindingFor } from '@/lib/book-binding';

interface BookCoverProps {
  title: string;
  author?: string | null;
  imageUrl?: string | null;
  className?: string;
  /** Above-the-fold covers (hero shelf, detail page) load eagerly. */
  eager?: boolean;
}

export function BookCover({ title, author, imageUrl, className, eager = false }: BookCoverProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showImage = Boolean(imageUrl) && !failed;

  return (
    <div className={cn('relative aspect-[2/3] w-full overflow-hidden rounded-[6px] bg-muted', showImage && !loaded && 'animate-pulse', 'shadow-[0_1px_2px_rgba(15,23,42,0.12),0_8px_20px_-12px_rgba(15,23,42,0.45)]', className)}>
      {showImage ? (
        <img
          src={imageUrl!}
          alt={`Bìa sách ${title}`}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('h-full w-full object-cover transition-opacity duration-300 motion-reduce:transition-none', loaded ? 'opacity-100' : 'opacity-0')}
        />
      ) : (
        <div
          role="img"
          aria-label={`Bìa sách ${title}`}
          // Container units: the type scales with the cover, from hero shelf to 36px thumbnails.
          className="@container flex h-full w-full flex-col justify-between p-[9%] text-[#F3EBD8]"
          style={{ backgroundColor: bindingFor(title) }}
        >
          <span className="h-px w-1/3 bg-[#F3EBD8]/50" aria-hidden="true" />
          <span className="line-clamp-5 font-serif text-[clamp(7px,15cqw,20px)] font-semibold leading-[1.15] [overflow-wrap:anywhere]">{title}</span>
          <span className="hidden line-clamp-2 text-[clamp(8px,7.5cqw,12px)] uppercase tracking-[0.08em] text-[#F3EBD8]/75 @[5.5rem]:block">{author || 'SmartBook'}</span>
        </div>
      )}
      {/* Spine crease: the one detail that reads "book" rather than "thumbnail". */}
      <span className="pointer-events-none absolute inset-y-0 left-[5%] w-px bg-white/25 mix-blend-overlay" aria-hidden="true" />
    </div>
  );
}
