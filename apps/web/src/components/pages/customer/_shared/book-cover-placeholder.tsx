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
      iconTone: 'text-cyan-700 bg-cyan-100 border-cyan-200 dark:text-cyan-300 dark:bg-cyan-950/40 dark:border-cyan-800/50',
      gradient: 'from-cyan-100 via-white to-blue-100 dark:from-cyan-950/30 dark:via-card dark:to-blue-950/30',
      label: 'Science',
    };
  }
  if (value.includes('history') || value.includes('geography')) {
    return {
      Icon: Globe2,
      iconTone: 'text-amber-700 bg-amber-100 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50',
      gradient: 'from-amber-100 via-white to-orange-100 dark:from-amber-950/30 dark:via-card dark:to-orange-950/30',
      label: 'History',
    };
  }
  if (value.includes('literature') || value.includes('fiction') || value.includes('novel')) {
    return {
      Icon: ScrollText,
      iconTone: 'text-indigo-700 bg-indigo-100 border-indigo-200 dark:text-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-800/50',
      gradient: 'from-indigo-100 via-white to-cyan-100 dark:from-indigo-950/30 dark:via-card dark:to-cyan-950/30',
      label: 'Literature',
    };
  }
  return {
    Icon: BookOpenText,
    iconTone: 'text-slate-700 dark:text-slate-300 bg-muted border-border',
    gradient: 'from-slate-100 via-white to-cyan-100 dark:from-slate-800/60 dark:via-card dark:to-cyan-950/30',
    label: 'General',
  };
}

export function BookCoverPlaceholder({ category, title, imageUrl }: BookCoverPlaceholderProps) {
  const style = pickStyle(category);
  const [imgError, setImgError] = useState(false);

  return (
    <div className={`relative aspect-[4/5] w-full overflow-hidden rounded-[11px] border border-white/80 dark:border-white/10 bg-gradient-to-b ${style.gradient}`}>
      {imageUrl && !imgError ? (
        <img
          src={imageUrl}
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
            <p className="line-clamp-2 text-[11px] text-slate-700 dark:text-slate-300" style={{ fontWeight: 600 }}>
              {title}
            </p>
            <span className="rounded-full border border-border bg-card/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
              {style.label}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
