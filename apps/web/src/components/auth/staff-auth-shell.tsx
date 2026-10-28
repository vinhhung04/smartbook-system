import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, BookOpen, ChartColumn, Handshake, Library, ShieldCheck, Sparkles, Truck, Warehouse } from 'lucide-react';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from '@/lib/gsap';
import { AuthToneContext } from './auth-tone';

/**
 * How a book moves through SmartBook, one stage per module the staff app really
 * has (purchase requests, receiving and putaway, branch shelves, borrowing,
 * reports). It explains the product; it shows no data.
 */
const FLOW = [
  { icon: Truck, label: 'Nhập hàng', detail: 'Đề xuất và đơn mua' },
  { icon: Warehouse, label: 'Kho', detail: 'Nhận hàng, cất kệ' },
  { icon: Library, label: 'Chi nhánh', detail: 'Sách lên kệ' },
  { icon: Handshake, label: 'Mượn trả', detail: 'Giao và nhận sách' },
  { icon: ChartColumn, label: 'Báo cáo', detail: 'Tồn kho, hoạt động' },
];

function OperationsSchematic() {
  return (
    <figure className="rounded-2xl bg-white/[0.04] p-6 ring-1 ring-white/10" aria-labelledby="ops-caption">
      <ol className="relative grid grid-cols-5 gap-2">
        {/* The wire runs through the centres of the first and last node (each node is 2.75rem). */}
        <span data-auth="wire" className="pointer-events-none absolute left-[10%] right-[10%] top-[1.375rem] h-px bg-white/25" aria-hidden="true" />
        {FLOW.map(({ icon: Icon, label, detail }) => (
          <li key={label} data-auth="node" className="relative flex flex-col items-center text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#232052] text-indigo-100 ring-1 ring-white/15">
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="mt-3 text-[13px] font-semibold text-white">{label}</span>
            <span className="mt-0.5 text-[12px] leading-snug text-indigo-100/70">{detail}</span>
          </li>
        ))}
      </ol>
      <figcaption id="ops-caption" data-auth="node" className="mt-6 flex items-start gap-2.5 rounded-xl bg-white/[0.05] px-3.5 py-3 text-[13px] leading-snug text-indigo-100/85">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
        <span>Trợ lý AI đi cùng mọi bước: tra cứu nhanh và gợi ý nhập hàng.</span>
      </figcaption>
    </figure>
  );
}

function StaffWordmark({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link to="/" className="inline-flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="SmartBook — trang chủ">
      <span className={inverse ? 'flex h-8 w-8 items-center justify-center rounded-md bg-white text-[#1d1a4a]' : 'flex h-8 w-8 items-center justify-center rounded-md bg-[#1d1a4a] text-white dark:bg-indigo-500'}>
        <BookOpen className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className={inverse ? 'text-[17px] font-semibold tracking-[-0.01em] text-white' : 'text-[17px] font-semibold tracking-[-0.01em] text-foreground'}>SmartBook</span>
    </Link>
  );
}

interface StaffAuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Internal portal: a quiet, structured workspace. The panel says what the
 * system is for and who it serves; the form is the only thing to do. Motion is
 * short and exact: the panel opens, the flow wires up, the form settles.
 */
export function StaffAuthShell({ title, subtitle, children, footer }: StaffAuthShellProps) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.timeline({ defaults: { ease: 'power3.out', duration: 0.45 } })
        .from('[data-auth="form-item"]', { opacity: 0, y: 8, stagger: 0.04, clearProps: 'opacity,transform' }, 0)
        .fromTo('[data-auth="panel"]',
          { clipPath: 'inset(0% 100% 0% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.7, ease: 'power3.inOut', clearProps: 'clipPath' }, 0)
        .from('[data-auth="copy"]', { opacity: 0, y: 10, stagger: 0.06, ease: EASE_OUT, duration: 0.7, clearProps: 'opacity,transform' }, 0.3)
        .from('[data-auth="wire"]', { scaleX: 0, transformOrigin: '0% 50%', duration: 0.6, ease: 'power2.inOut' }, 0.45)
        .from('[data-auth="node"]', { opacity: 0, y: 6, stagger: 0.05, duration: 0.35, clearProps: 'opacity,transform' }, 0.45);
    });
    return () => mm.revert();
  }, { scope });

  return (
    <AuthToneContext.Provider value="staff">
      <div ref={scope} className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <aside data-auth="panel" className="relative hidden flex-col justify-between overflow-hidden bg-[#16143a] px-12 py-10 text-white lg:flex xl:px-16">
          <StaffWordmark inverse />
          <div className="max-w-[34rem] py-12">
            <p data-auth="copy" className="text-balance text-[34px] font-semibold leading-[1.12] tracking-[-0.025em] xl:text-[38px]">
              Một không gian làm việc cho mọi nghiệp vụ thư viện.
            </p>
            <p data-auth="copy" className="mt-4 max-w-md text-[15px] leading-relaxed text-indigo-100/80">
              Kho sách, mượn trả, nhập hàng và báo cáo của tất cả chi nhánh, mở theo đúng quyền của tài khoản bạn.
            </p>
            <div data-auth="copy" className="mt-10"><OperationsSchematic /></div>
          </div>
          <p data-auth="copy" className="max-w-md text-[13px] leading-relaxed text-indigo-100/70">
            Dành cho quản trị viên, quản lý kho, nhân viên kho và thủ thư. Sau khi đăng nhập, mỗi tài khoản vào thẳng khu vực của vai trò mình.
          </p>
        </aside>

        <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-10 lg:px-14">
          <div data-auth="form-item" className="flex items-center justify-between gap-4">
            <span className="lg:invisible"><StaffWordmark /></span>
            <Link to="/" className="inline-flex min-h-10 items-center gap-1.5 rounded-md text-[13.5px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Trang chủ
            </Link>
          </div>
          <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
            <div data-auth="form-item">
              <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Cổng nhân viên nội bộ
              </p>
              <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-foreground">{title}</h1>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{subtitle}</p>
            </div>
            <div data-auth="form-item" className="mt-8">{children}</div>
            {footer ? <div data-auth="form-item" className="mt-8">{footer}</div> : null}
          </div>
        </main>
      </div>
    </AuthToneContext.Provider>
  );
}
