import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Hand, RotateCcw } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { Book3D } from './book-3d';

const SPIN_REST = 22;

/** Back cover layout: title block on top, a short list of real facts below. */
export function BackCover({ title, author, facts }: { title: string; author: string | null; facts: Array<{ label: string; value: ReactNode }> }) {
  return (
    <>
      <div>
        <p className="font-mono text-[clamp(6px,5cqw,10px)] uppercase tracking-[0.14em] opacity-70">SmartBook</p>
        <p className="mt-[5%] line-clamp-4 font-serif text-[clamp(8px,9cqw,17px)] font-semibold leading-tight">{title}</p>
        <p className="mt-[3%] text-[clamp(7px,6cqw,12px)] opacity-80">{author || 'Chưa rõ tác giả'}</p>
      </div>
      <dl className="space-y-[4%] text-[clamp(7px,6cqw,12px)]">
        {facts.map((fact) => (
          <div key={fact.label} className="flex justify-between gap-2 border-t border-white/20 pt-[4%]">
            <dt className="opacity-70">{fact.label}</dt>
            <dd className="text-right font-semibold">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

interface SpinningBookProps {
  title: string;
  author: string | null;
  imageUrl: string | null;
  back: ReactNode;
  eager?: boolean;
  className?: string;
}

/**
 * A book you can turn: drag sideways to spin it, let go and it settles on the
 * front or back cover. The button does the same for keyboard and screen-reader
 * users (the drag surface itself is decorative).
 */
export function SpinningBook({ title, author, imageUrl, back, eager, className }: SpinningBookProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const angle = useRef(SPIN_REST);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const [showingBack, setShowingBack] = useState(false);

  const apply = (degrees: number) => {
    angle.current = degrees;
    stageRef.current?.style.setProperty('--spin', `${degrees}deg`);
  };
  const settle = () => {
    const turns = Math.round((angle.current - SPIN_REST) / 180);
    apply(SPIN_REST + turns * 180);
    setShowingBack(Math.abs(turns) % 2 === 1);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start: angle.current };
    event.currentTarget.classList.add('is-dragging');
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    apply(drag.current.start + (event.clientX - drag.current.x) * 0.75);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.classList.remove('is-dragging');
    settle();
  };

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div
        ref={stageRef}
        className="spin-stage w-full"
        style={{ '--spin': `${SPIN_REST}deg` } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        aria-hidden="true"
      >
        <Book3D title={title} author={author} imageUrl={imageUrl} pose="spin" back={back} eager={eager} />
      </div>
      <button
        type="button"
        onClick={() => { apply(angle.current + 180); settle(); }}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {showingBack ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Hand className="h-3.5 w-3.5" aria-hidden="true" />}
        {showingBack ? 'Xem bìa trước' : 'Xoay xem bìa sau'}
      </button>
    </div>
  );
}
