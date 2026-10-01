import type { CSSProperties } from 'react';
import { bindingFor } from '@/lib/book-binding';
import { cn } from '@/components/ui/utils';
import { BookCover } from './book-cover';

interface Book3DProps {
  title: string;
  author?: string | null;
  imageUrl?: string | null;
  /** shelf: stands angled on the hero shelf; card: flat until the card is hovered. */
  pose: 'shelf' | 'card';
  eager?: boolean;
  className?: string;
}

/** A book as a CSS 3D box (see styles/book-3d.css). The front face is the normal cover. */
export function Book3D({ title, author, imageUrl, pose, eager, className }: Book3DProps) {
  return (
    <div className={cn('book3d', `book3d--${pose}`, className)}>
      <div className="book3d__body" style={{ '--book-binding': bindingFor(title) } as CSSProperties}>
        <div className="book3d__face book3d__front">
          <BookCover title={title} author={author} imageUrl={imageUrl} eager={eager} className="rounded-[2px_5px_5px_2px] shadow-none" />
        </div>
        <div className="book3d__face book3d__spine" aria-hidden="true">
          <span className="book3d__spine-title">{title}</span>
        </div>
        <div className="book3d__face book3d__pages" aria-hidden="true" />
        <div className="book3d__face book3d__top" aria-hidden="true" />
        <div className="book3d__face book3d__back" aria-hidden="true" />
        <span className="book3d__shadow" aria-hidden="true" />
      </div>
    </div>
  );
}
