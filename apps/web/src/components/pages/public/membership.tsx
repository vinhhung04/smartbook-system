import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BellRing, CalendarCheck, ClipboardList, Heart, Sparkles, Star, Wallet, type LucideIcon } from 'lucide-react';
import { publicCatalogService, type PublicMembershipPlan, type PublicMembershipPlans } from '@/services/public-catalog';
import { useAuthUser } from '@/hooks/useAuthUser';
import { usePageMeta } from '@/lib/page-meta';
import { priceLabel, validityLabel } from '@/lib/membership-format';
import { buildLoginUrl } from '@/lib/return-url';
import { cn } from '@/components/ui/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/public/page-hero';
import { Reveal, SectionHeading } from '@/components/public/book-row';
import { HowBorrowingWorks, type BorrowingStep } from '@/components/public/how-borrowing-works';

const CARD_PATH = '/customer/membership';
const moneyFormat = new Intl.NumberFormat('vi-VN');

// Only what the reader portal actually does today.
const BENEFITS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: CalendarCheck, title: 'Đặt trước sách', body: 'Chọn chi nhánh còn sách và đặt trước trực tuyến; chi nhánh giữ sách cho bạn trong thời gian theo gói.' },
  { icon: ClipboardList, title: 'Theo dõi phiếu mượn', body: 'Xem sách đang mượn, hạn trả và gửi yêu cầu gia hạn ngay trên tài khoản.' },
  { icon: Heart, title: 'Danh sách yêu thích', body: 'Lưu những cuốn muốn đọc để quay lại sau.' },
  { icon: Star, title: 'Đánh giá sách', body: 'Chấm điểm và chia sẻ cảm nhận về sách bạn đã đọc.' },
  { icon: Sparkles, title: 'Gợi ý dành riêng cho bạn', body: 'Gợi ý sách theo lịch sử đọc của bạn.' },
  { icon: BellRing, title: 'Thông báo', body: 'Nhận tin khi đặt trước được xác nhận, sách sắp đến hạn trả, quá hạn, có khoản phí mới — và khi cuốn sách bạn chờ có lại tại chi nhánh.' },
  { icon: Wallet, title: 'Phí trễ hạn & thanh toán', body: 'Xem các khoản phí trễ hạn và thanh toán trực tuyến qua VNPay.' },
];

const STEPS: BorrowingStep[] = [
  { title: 'Tạo tài khoản', body: 'Đăng ký tài khoản bạn đọc; thẻ bạn đọc được cấp ngay sau khi tạo.' },
  { title: 'Chọn sách', body: 'Tìm trong danh mục và xem chi nhánh nào còn bản trên kệ.' },
  { title: 'Đặt trước', body: 'Đặt trước trực tuyến và chọn chi nhánh bạn muốn đến lấy.' },
  { title: 'Nhận sách tại chi nhánh', body: 'Đưa mã nhận sách cho thủ thư và theo dõi hạn trả trong “Sách của tôi”.' },
];

function PlanCard({ plan, wide }: { plan: PublicMembershipPlan; wide: boolean }) {
  const facts = [
    { label: 'Thời hạn thẻ', value: validityLabel(plan.duration_days) },
    { label: 'Mượn và đặt trước cùng lúc', value: `Tối đa ${plan.max_active_loans} cuốn` },
    { label: 'Thời hạn mỗi lượt mượn', value: `${plan.max_loan_days} ngày` },
    { label: 'Gia hạn', value: plan.max_renewal_count > 0 ? `${plan.max_renewal_count} lần / phiếu` : 'Không gia hạn' },
    { label: 'Giữ sách đặt trước', value: `${plan.reservation_hold_hours} giờ` },
    { label: 'Phí trễ hạn', value: plan.fine_per_day > 0 ? `${moneyFormat.format(plan.fine_per_day)} đ / ngày` : 'Không tính phí' },
  ];
  return (
    <article
      aria-labelledby={`goi-${plan.id}`}
      className={cn(
        'flex h-full flex-col rounded-2xl border bg-card p-6',
        plan.is_default ? 'border-indigo-300 dark:border-indigo-500/40' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`goi-${plan.id}`} className="font-serif text-[21px] font-semibold leading-tight tracking-tight">{plan.name}</h3>
        {plan.is_default ? (
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[12px] font-medium text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-950/30 dark:text-indigo-200">
            Cấp khi tạo tài khoản
          </span>
        ) : null}
      </div>
      <p className="mt-3 flex items-baseline gap-1.5" data-testid={`membership-plan-price-${plan.id}`}>
        <span className="text-[24px] font-semibold tabular-nums tracking-tight">{priceLabel(plan.price)}</span>
        {plan.price > 0 ? <span className="text-[13px] text-muted-foreground">/ {validityLabel(plan.duration_days)}</span> : null}
      </p>
      {plan.description ? <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{plan.description}</p> : null}
      <dl className={cn('mt-5 grid border-t border-border', wide && 'sm:grid-cols-2 sm:gap-x-10')}>
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 text-[13.5px]">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="whitespace-nowrap text-right font-semibold tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

const PLAN_COLUMNS: Record<number, string> = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3' };

function Plans({ result, defaultPlan }: { result: PublicMembershipPlans; defaultPlan: PublicMembershipPlan | null }) {
  const plans = result.data;
  if (plans.length === 0) {
    return (
      <EmptyState variant="no-data" title="Thư viện chưa công bố gói thẻ nào"
        description="Bạn vẫn có thể tạo tài khoản và dùng các tính năng ở trên. Thông tin gói thẻ sẽ hiển thị tại đây khi thư viện cập nhật." />
    );
  }
  return (
    <>
      {/* One plan is a card, not a one-column pricing table. */}
      <ul className={cn('grid gap-4', plans.length === 1 ? 'max-w-3xl' : PLAN_COLUMNS[plans.length] || 'sm:grid-cols-2 xl:grid-cols-4')}>
        {plans.map((plan) => <li key={plan.id}><PlanCard plan={plan} wide={plans.length === 1} /></li>)}
      </ul>
      <p className="mt-5 max-w-3xl text-[13.5px] leading-relaxed text-muted-foreground">
        {defaultPlan ? <>Tài khoản mới được cấp gói <span className="font-semibold text-foreground">{defaultPlan.name}</span>. </> : null}
        {result.card_validity_days ? <>Thẻ cấp khi đăng ký có hiệu lực {validityLabel(result.card_validity_days)} kể từ ngày cấp. </> : null}
        Phí gói (nếu có) thanh toán tại quầy — đổi gói hoặc gia hạn thẻ do thủ thư thực hiện tại{' '}
        <Link to="/branches" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">chi nhánh</Link> gần bạn.
      </p>
    </>
  );
}

export function PublicMembershipPage() {
  usePageMeta({
    title: 'Thẻ bạn đọc',
    description: 'Tài khoản bạn đọc SmartBook: đặt trước sách, theo dõi phiếu mượn, lưu yêu thích, nhận thông báo và gợi ý sách. Xem các gói thẻ và hạn mức mượn.',
  });
  const { isAuthenticated, isCustomer } = useAuthUser();
  const [result, setResult] = useState<PublicMembershipPlans | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    publicCatalogService.getMembershipPlans()
      .then((data) => { if (active) { setResult(data); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [reloadKey]);

  // Readers go to their card; staff keep browsing (their way back is in the header);
  // visitors register and land on the card they were just given.
  const primary = isCustomer
    ? { to: CARD_PATH, label: 'Xem thẻ bạn đọc của tôi' }
    : isAuthenticated
      ? { to: '/books', label: 'Khám phá sách' }
      : { to: buildLoginUrl(CARD_PATH, 'register'), label: 'Tạo tài khoản' };
  const secondary = isAuthenticated ? null : { to: '/books', label: 'Khám phá sách trước' };
  const defaultPlan = result?.data.find((plan) => plan.is_default) || null;

  return (
    <>
      <PageHero
        eyebrow="Thẻ bạn đọc"
        title="Đọc nhiều hơn với tài khoản SmartBook"
        description="Tạo tài khoản để đặt trước sách, theo dõi sách đang mượn, lưu yêu thích và nhận gợi ý phù hợp với bạn. Xem sách và chi nhánh thì không cần đăng nhập."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={primary.to}
            className="group inline-flex h-11 items-center gap-1.5 rounded-full bg-indigo-700 px-5 text-[14px] font-semibold text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            {primary.label} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          {secondary ? (
            <Link to={secondary.to} className="inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold text-foreground ring-1 ring-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
              {secondary.label}
            </Link>
          ) : null}
        </div>
        {!isAuthenticated ? (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Đã có tài khoản?{' '}
            <Link to={buildLoginUrl(CARD_PATH)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Đăng nhập</Link>
          </p>
        ) : null}
      </PageHero>

      <div className="mx-auto max-w-7xl space-y-20 px-4 pt-12 sm:px-6 lg:px-8">
        <Reveal>
          <section aria-labelledby="quyen-loi">
            <SectionHeading id="quyen-loi" eyebrow="Quyền lợi" title="Tài khoản bạn đọc giúp gì cho bạn" basis="Duyệt danh mục, xem chi nhánh và đọc đánh giá luôn mở cho mọi người. Những việc dưới đây cần tài khoản." />
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {BENEFITS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="rounded-2xl border border-border bg-card p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <h3 className="mt-3 text-[15px] font-semibold">{title}</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>

        <section aria-labelledby="goi-the">
          <SectionHeading id="goi-the" eyebrow="Gói thẻ" title="Hạn mức theo từng gói" basis="Số liệu lấy trực tiếp từ quy định của thư viện." />
          {error ? (
            <EmptyState variant="error" title="Không tải được thông tin gói thẻ" description="Máy chủ thư viện chưa phản hồi."
              action={<button type="button" onClick={() => { setError(false); setResult(null); setReloadKey((key) => key + 1); }} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Thử lại</button>} />
          ) : !result ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Đang tải gói thẻ">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-72 animate-pulse rounded-2xl bg-muted/60" />)}
            </div>
          ) : (
            <Plans result={result} defaultPlan={defaultPlan} />
          )}
        </section>

        <Reveal>
          <HowBorrowingWorks variant="band" steps={STEPS} cta={primary} secondary={secondary} />
        </Reveal>
      </div>
    </>
  );
}
