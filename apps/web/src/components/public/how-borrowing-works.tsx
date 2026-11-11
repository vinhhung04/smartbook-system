import { useRef } from 'react';
import { Link } from 'react-router';
import { CalendarCheck, Search, Ticket, type LucideIcon } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from './gsap-motion';

// A real sequence (the order matters), so the numbers carry information.
const STEPS: BorrowingStep[] = [
  { title: 'Tìm sách', body: 'Duyệt danh mục hoặc tìm theo tên, tác giả, ISBN. Mỗi cuốn đều cho biết còn bao nhiêu bản và ở chi nhánh nào.', icon: Search },
  { title: 'Đặt trước trực tuyến', body: 'Chọn chi nhánh muốn đến lấy. Thư viện giữ sách cho bạn trong thời hạn theo gói hội viên.', icon: CalendarCheck },
  { title: 'Nhận sách tại quầy', body: 'Khi sách sẵn sàng, bạn nhận mã nhận sách. Đưa mã cho thủ thư để mượn và theo dõi hạn trả trong “Sách của tôi”.', icon: Ticket },
];

interface Cta {
  to: string;
  label: string;
}

export interface BorrowingStep {
  title: string;
  body: string;
  /** Marker icon on the band's journey; without one the marker shows the step number. */
  icon?: LucideIcon;
}

interface HowBorrowingWorksProps {
  cta: Cta | null;
  secondary?: Cta | null;
  /** card: inline panel (About page); band: closing call-to-action on the homepage. */
  variant?: 'card' | 'band';
  /** Replaces the default three steps (e.g. the membership page starts with creating an account). */
  steps?: BorrowingStep[];
}

/** Seconds between one step lighting up and the next. */
const STEP_BEAT = 0.42;

/**
 * Band: the steps as a journey down a line. When it scrolls into view the line
 * draws from the first step to the last and each step lights up as the line
 * reaches it, so the order is shown, not just numbered. Plays once.
 */
function BorrowingJourney({ steps }: { steps: BorrowingStep[] }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const list = scope.current;
    if (!list) return undefined;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: list, start: 'top 78%', once: true } });
      gsap.utils.toArray<HTMLElement>('[data-journey="step"]', list).forEach((step, index) => {
        const at = index * STEP_BEAT;
        tl.from(step.querySelector('[data-journey="marker"]'), { scale: 0.4, opacity: 0, duration: 0.5, ease: 'back.out(2.2)', clearProps: 'transform,opacity' }, at)
          .from(step.querySelector('[data-journey="text"]'), { opacity: 0, x: 18, duration: 0.7, ease: EASE_OUT, clearProps: 'transform,opacity' }, at + 0.06);
        // The segment to the next step draws while this one settles, arriving as the next lights up.
        const segment = step.querySelector('[data-journey="line"]');
        if (segment) tl.from(segment, { scaleY: 0, transformOrigin: '50% 0%', duration: STEP_BEAT, ease: 'none' }, at + 0.1);
      });
    });
    return () => mm.revert();
  }, { scope, dependencies: [steps.length] });

  return (
    <div ref={scope}>
      <ol className="grid gap-7">
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <li key={step.title} data-journey="step" className="relative flex gap-5">
            {/* Connector down to the next marker: starts under this 3rem marker, ends at the next one (across the 1.75rem gap). */}
            {index < steps.length - 1 ? (
              <span data-journey="line" className="pointer-events-none absolute -bottom-7 left-6 top-12 w-px -translate-x-1/2 bg-amber-200/60" aria-hidden="true" />
            ) : null}
            <span data-journey="marker" className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[#1d1a4a] shadow-[0_0_0_6px_#1d1a4a] dark:shadow-[0_0_0_6px_#15133a]" aria-hidden="true">
              {Icon ? <Icon className="h-5 w-5" /> : <span className="font-display text-[18px] font-semibold">{index + 1}</span>}
            </span>
            <div data-journey="text" className="pt-1.5">
              <h3 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.01em] sm:text-[22px]">
                <span className="sr-only">Bước {index + 1}: </span>{step.title}
              </h3>
              <p className="mt-1.5 max-w-md text-[14.5px] leading-relaxed text-indigo-100/85">{step.body}</p>
            </div>
          </li>
        );
      })}
      </ol>
    </div>
  );
}

export function HowBorrowingWorks({ cta, secondary = null, variant = 'card', steps = STEPS }: HowBorrowingWorksProps) {
  const band = variant === 'band';
  const actions = cta || secondary ? (
    <div className={cn('flex flex-wrap items-center gap-3', band ? 'mt-8' : 'mt-7')}>
      {cta ? (
        <Link
          to={cta.to}
          className={cn(
            'inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold transition-[background-color,transform] focus-visible:outline-none focus-visible:ring-2 active:scale-[0.98]',
            band ? 'bg-amber-100 text-[#1d1a4a] hover:bg-white focus-visible:ring-amber-200' : 'bg-indigo-700 text-white hover:bg-indigo-800 focus-visible:ring-indigo-500/50 dark:bg-indigo-500 dark:hover:bg-indigo-400',
          )}
        >
          {cta.label}
        </Link>
      ) : null}
      {secondary ? (
        <Link
          to={secondary.to}
          className={cn(
            'inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2',
            band ? 'text-white ring-1 ring-white/35 hover:bg-white/10 focus-visible:ring-amber-200' : 'text-foreground ring-1 ring-border hover:bg-muted focus-visible:ring-indigo-500/50',
          )}
        >
          {secondary.label}
        </Link>
      ) : null}
    </div>
  ) : null;

  if (band) {
    return (
      <section aria-labelledby="cach-muon-sach" className="relative overflow-hidden rounded-[32px] bg-[#1d1a4a] p-7 text-white sm:p-12 lg:p-16 dark:bg-[#15133a] dark:ring-1 dark:ring-white/10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <h2 id="cach-muon-sach" className="text-balance font-display text-[32px] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[44px]">
              Mượn sách thế nào?
            </h2>
            <p className="mt-4 max-w-sm text-[15.5px] leading-relaxed text-indigo-100/85">
              {steps.length} bước, từ lúc tìm thấy cuốn sách đến lúc cầm nó trên tay.
            </p>
            {actions}
          </div>
          <BorrowingJourney steps={steps} />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="cach-muon-sach" className="relative overflow-hidden rounded-xl border border-border bg-card p-6 sm:p-8">
      <div className="relative">
        <h2 id="cach-muon-sach" className="font-serif text-[22px] font-semibold tracking-tight sm:text-[26px]">
          Mượn sách thế nào?
        </h2>
        <ol className={cn('mt-6 grid gap-6', steps.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}>
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-indigo-600/40 font-mono text-[12px] font-semibold text-indigo-700 dark:text-indigo-300">
                {index + 1}
              </span>
              <div>
                <h3 className="text-[15px] font-semibold">{step.title}</h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        {actions}
      </div>
    </section>
  );
}
