import { useId, type ReactNode, type SVGProps } from 'react';
import { SYMBOL } from '@/components/brand-logo';
import { cn } from '@/components/ui/utils';

// SmartBook's own icons for the AI assistant. The mark is the brand S (two books
// stacked spine-out / spine-in, assets/branding) lit by the Lamp spark. The
// topic icons draw that same edge-on book: rounded spine on one end, the page
// slot cut into the other.

const SPARK = 'M32.5 1.5L33.9 6.1L38.5 7.5L33.9 8.9L32.5 13.5L31.1 8.9L26.5 7.5L31.1 6.1Z';

const MARK_TONE = {
  /** On the Ink tile: the app-icon colours. */
  tile: { symbol: 'fill-brand-lamp', spark: 'fill-brand-lamp' },
  /** On the page or a card: Ink (Mist in dark mode) with an indigo spark. */
  surface: { symbol: 'fill-brand-mark', spark: 'fill-primary' },
} as const;

/** SmartBook AI: the brand S with the spark above it; the spark turns while the AI works. */
export function SmartBookAiMark({ tone = 'surface', busy = false, className }: {
  tone?: keyof typeof MARK_TONE;
  busy?: boolean;
  className?: string;
}) {
  const colors = MARK_TONE[tone];
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false" className={className}>
      <path d={SYMBOL} transform="translate(3 10) scale(0.75)" className={colors.symbol} />
      <path
        d={SPARK}
        className={cn(colors.spark, busy && 'animate-[spin_1.6s_linear_infinite] [transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none')}
      />
    </svg>
  );
}

/** The brand book edge-on: rounded spine at the left, the page slot cut in from the right. */
function bookSpineLeft(x: number, y: number, w: number, h: number) {
  const r = h / 2;
  return `M${x + r} ${y}H${x + w}V${y + h}H${x + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z M${x + w} ${y + r}H${x + w - r}`;
}

/** The same book turned over: spine at the right, slot from the left. */
function bookSpineRight(x: number, y: number, w: number, h: number) {
  const r = h / 2;
  return `M${x + w - r} ${y}H${x}V${y + h}H${x + w - r}A${r} ${r} 0 0 0 ${x + w - r} ${y}Z M${x} ${y + r}H${x + r}`;
}

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function StrokeIcon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

/** The brand book across the top with a round badge in front of it; a gap is cut around the badge. */
function BadgedBook({ badge: { cx, cy, r }, children, ...props }: IconProps & { badge: { cx: number; cy: number; r: number }; children: ReactNode }) {
  const mask = `sb-${useId().replace(/:/g, '')}`;
  return (
    <StrokeIcon {...props}>
      <mask id={mask}>
        <rect width="24" height="24" fill="white" />
        <circle cx={cx} cy={cy} r={r + 1.75} fill="black" />
      </mask>
      <path d={bookSpineLeft(2.5, 3.5, 19, 7)} mask={`url(#${mask})`} />
      <circle cx={cx} cy={cy} r={r} />
      {children}
    </StrokeIcon>
  );
}

/** Due dates: a book and a clock. */
export function BookDueIcon(props: IconProps) {
  return (
    <BadgedBook badge={{ cx: 16, cy: 16, r: 5 }} {...props}>
      <path d="M16 13.5V16L17.75 17.25" />
    </BadgedBook>
  );
}

/** Fines and payments: a book and a coin. */
export function BookFineIcon(props: IconProps) {
  return (
    <BadgedBook badge={{ cx: 16, cy: 16, r: 5 }} {...props}>
      <circle cx="16" cy="16" r="2" />
    </BadgedBook>
  );
}

/** Risks and shortages: a book and a warning mark. */
export function BookAlertIcon(props: IconProps) {
  return (
    <BadgedBook badge={{ cx: 16, cy: 16, r: 5 }} {...props}>
      <path d="M16 13.6V16.4M16 18.4V18.45" />
    </BadgedBook>
  );
}

/** Reservations: a book holding a bookmark ribbon. */
export function BookReserveIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d={bookSpineLeft(2.5, 3.5, 19, 7)} />
      <path d="M8.5 10.5V20.5L11.25 18.25L14 20.5V10.5" />
    </StrokeIcon>
  );
}

/** Rules and guides: an open book with its lines. */
export function BookRulesIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 6.5C10.4 5.4 8 4.8 4 4.8V17.2C8 17.2 10.4 17.8 12 18.9C13.6 17.8 16 17.2 20 17.2V4.8C16 4.8 13.6 5.4 12 6.5ZM12 6.5V18.9" />
      <path d="M7 9.25H9.25M7 12.25H9.25M14.75 9.25H17M14.75 12.25H17" />
    </StrokeIcon>
  );
}

/** Books and recommendations: the logo's two stacked books. */
export function BookStackIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d={bookSpineLeft(4, 4, 16, 6.5)} />
      <path d={bookSpineRight(4, 13.5, 16, 6.5)} />
    </StrokeIcon>
  );
}

/** Stock and warehouses: three books piled the way stock is kept level. */
export function BookPileIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d={bookSpineLeft(4, 3, 16, 5)} />
      <path d={bookSpineRight(4, 9.5, 16, 5)} />
      <path d={bookSpineLeft(4, 16, 16, 5)} />
    </StrokeIcon>
  );
}

/** Tasks and reports: a book and a tick. */
export function BookTaskIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d={bookSpineLeft(2.5, 3.5, 19, 7)} />
      <path d="M7.5 16L10.75 19.25L17 13" />
    </StrokeIcon>
  );
}

/** Photo of a book cover: the cover inside a scan frame. */
export function CoverScanIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4H18.5A1.5 1.5 0 0 1 20 5.5V8M20 16V18.5A1.5 1.5 0 0 1 18.5 20H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <rect x="8.5" y="7.5" width="7" height="9" rx="1" />
      <path d="M10.75 7.5V16.5" />
    </StrokeIcon>
  );
}

/** Anything else: the spark alone. */
export function SparkIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 3.5L13.9 10.1L20.5 12L13.9 13.9L12 20.5L10.1 13.9L3.5 12L10.1 10.1Z" />
    </StrokeIcon>
  );
}
