import { Atom, BookOpenText, Globe2, ScrollText } from 'lucide-react';
import { useState } from 'react';

interface BookCoverPlaceholderProps {
  category?: string | null;
  title: string;
  imageUrl?: string | null;
}

function pickStyle(category?: string | null) {
  const value = String(category || '').toLowerCase();
  if (value.includes('science') || value.includes('technology')) {
    return {
      Icon: Atom,
      iconTone: 'text-muted-foreground bg-muted border-border dark:text-muted-foreground dark:bg-muted dark:border-border',
      gradient: '',
      label: 'Khoa học',
    };
  }
  if (value.includes('history') || value.includes('geography')) {
    return {
      Icon: Globe2,
      iconTone: 'text-amber-700 bg-amber-100 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50',
      gradient: '',
      label: 'Lịch sử',
    };
  }
  if (value.includes('literature') || value.includes('fiction') || value.includes('novel')) {
    return {
      Icon: ScrollText,
      iconTone: 'text-primary bg-primary/10 border-primary/25 dark:text-primary dark:bg-primary/15 dark:border-primary/25',
      gradient: '',
      label: 'Văn học',
    };
  }
  return {
    Icon: BookOpenText,
    iconTone: 'text-slate-700 dark:text-slate-300 bg-muted border-border',
    gradient: '',
    label: 'Tổng hợp',
  };
}

export function BookCoverPlaceholder({ category, title, imageUrl }: BookCoverPlaceholderProps) {
  const style = pickStyle(category);
  const [imgError, setImgError] = useState(false);

  return (
    <div className={`relative aspect-[4/5] w-full overflow-hidden rounded-[11px] border border-border bg-muted/60 ${style.gradient}`}>
      {imageUrl && !imgError ? (
        <img
          // Some sources (Google Books) return http:// cover URLs, which the CSP's https-only img-src blocks.
          src={imageUrl.replace(/^http:\/\//i, 'https://')}
          alt={title}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <>
          <div className="absolute inset-x-3 top-3 h-5 rounded-full bg-card/70" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <div className={`inline-flex h-11 w-11 items-center justify-center rounded-full border ${style.iconTone}`}>
              <style.Icon className="h-5 w-5" />
            </div>
            <p className="line-clamp-2 text-[12px] text-slate-700 dark:text-slate-300" style={{ fontWeight: 600 }}>
              {title}
            </p>
            <span className="rounded-full border border-border bg-card/80 px-2 py-0.5 text-[12px] text-muted-foreground">
              {style.label}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
