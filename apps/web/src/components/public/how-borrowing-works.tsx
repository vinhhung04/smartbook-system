import { Link } from 'react-router';
import { cn } from '@/components/ui/utils';

// A real sequence (the order matters), so the numbers carry information.
const STEPS = [
  { title: 'Tìm sách', body: 'Duyệt danh mục hoặc tìm theo tên, tác giả, ISBN. Mỗi cuốn đều cho biết còn bao nhiêu bản và ở chi nhánh nào.' },
  { title: 'Đặt trước trực tuyến', body: 'Chọn chi nhánh muốn đến lấy. Thư viện giữ sách cho bạn trong thời hạn theo gói hội viên.' },
  { title: 'Nhận sách tại quầy', body: 'Khi sách sẵn sàng, bạn nhận mã nhận sách. Đưa mã cho thủ thư để mượn và theo dõi hạn trả trong “Sách của tôi”.' },
];

interface Cta {
  to: string;
  label: string;
}

export interface BorrowingStep {
  title: string;
  body: string;
}

interface HowBorrowingWorksProps {
  cta: Cta | null;
  secondary?: Cta | null;
  /** card: inline panel (About page); band: closing call-to-action on the homepage. */
  variant?: 'card' | 'band';
  /** Replaces the default three steps (e.g. the membership page starts with creating an account). */
  steps?: BorrowingStep[];
}

export function HowBorrowingWorks({ cta, secondary = null, variant = 'card', steps = STEPS }: HowBorrowingWorksProps) {
  const band = variant === 'band';
  return (
    <section
      aria-labelledby="cach-muon-sach"
      className={cn(
        'relative overflow-hidden',
        band
          ? 'rounded-3xl bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-700 p-8 text-white shadow-[0_30px_60px_-30px_rgba(67,56,202,0.7)] sm:p-12'
          : 'rounded-xl border border-border bg-card p-6 sm:p-8',
      )}
    >
      {band ? (
        <>
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.12)_1px,transparent_0)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
        </>
      ) : null}
      <div className="relative">
        {band ? <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-indigo-100">{steps.length} bước</p> : null}
        <h2 id="cach-muon-sach" className={cn('font-serif font-semibold tracking-tight', band ? 'text-[30px] leading-tight sm:text-[38px]' : 'text-[22px] sm:text-[26px]')}>
          Mượn sách thế nào?
        </h2>
        <ol className={cn('grid gap-6', steps.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3', band ? 'mt-8' : 'mt-6')}>
          {steps.map((step, index) => (
            <li key={step.title} className={cn('flex gap-3', band && 'rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur-sm')}>
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-semibold',
                  band ? 'bg-white text-indigo-700' : 'border border-indigo-600/40 text-indigo-700 dark:text-indigo-300',
                )}
              >
                {index + 1}
              </span>
              <div>
                <h3 className="text-[15px] font-semibold">{step.title}</h3>
                <p className={cn('mt-1 text-[13.5px] leading-relaxed', band ? 'text-indigo-50/85' : 'text-muted-foreground')}>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        {cta || secondary ? (
          <div className={cn('flex flex-wrap items-center gap-3', band ? 'mt-9' : 'mt-7')}>
            {cta ? (
              <Link
                to={cta.to}
                className={cn(
                  'inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold transition-colors',
                  band ? 'bg-white text-indigo-700 hover:bg-indigo-50' : 'bg-indigo-700 text-white hover:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-400',
                )}
              >
                {cta.label}
              </Link>
            ) : null}
            {secondary ? (
              <Link to={secondary.to} className={cn('inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold', band ? 'text-white ring-1 ring-white/40 hover:bg-white/10' : 'text-foreground ring-1 ring-border hover:bg-muted')}>
                {secondary.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
