import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { BookOpen } from 'lucide-react';
import { customerService, MembershipInfo } from '@/services/customer';
import { getApiErrorMessage } from '@/services/api';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { QRCode } from '@/components/ui/qr-code';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { formatCurrencyVnd } from './_shared/customer-format';

export function CustomerMembershipPage() {
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setMembership(await customerService.getMyMembership());
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được thông tin hội viên'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8" aria-busy="true">
        <div className="h-56 animate-pulse rounded-2xl border bg-card" />
        <div className="h-48 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
        <EmptyState variant="error" title="Không tải được hội viên" description={error} action={<button onClick={() => void load()} className="font-medium text-primary hover:underline">Thử lại</button>} />
      </div>
    );
  }
  if (!membership) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
        <EmptyState
          variant="no-data"
          title="Không tìm thấy hội viên"
          description="Vui lòng liên hệ nhân viên thư viện để thiết lập hội viên."
          action={<NavLink to="/customer/support" className="font-medium text-primary hover:underline">Xem thông tin liên hệ</NavLink>}
        />
      </div>
    );
  }

  const { limits } = membership;
  const maxLoans = Number(limits.max_active_loans) || 0;
  const usagePct = maxLoans > 0 ? Math.min(100, Math.round((membership.active_loan_count / maxLoans) * 100)) : 0;
  const cardNumber = membership.card_number || membership.membership_id || '—';

  const benefits = [
    { label: 'Tối đa đang mượn', value: `${limits.max_active_loans} cuốn` },
    { label: 'Thời hạn mỗi lượt mượn', value: `${limits.max_loan_days} ngày` },
    { label: 'Gia hạn tối đa', value: `${limits.max_renewal_count} lần / phiếu` },
    { label: 'Giữ chỗ đặt trước', value: `${limits.reservation_hold_hours} giờ` },
    { label: 'Phạt mỗi ngày quá hạn', value: formatCurrencyVnd(Number(limits.fine_per_day) || 0) },
    { label: 'Phí khi làm mất sách', value: `${limits.lost_item_fee_multiplier}× phí cơ bản` },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader title="Hội viên" subtitle="Gói của bạn, hạn mức mượn và thẻ thành viên" />

      <div className="grid gap-5 md:grid-cols-5">
        {/* The library card: what the reader shows at the desk */}
        <section
          aria-label="Thẻ thành viên"
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 p-5 text-white shadow-lg shadow-indigo-500/20 md:col-span-3"
        >
          <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
          <div className="relative flex h-full flex-col justify-between gap-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-white/70">
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> SmartBook Library
                </p>
                <h2 className="mt-1 text-[22px] font-bold tracking-tight">{membership.plan_name || 'Gói tiêu chuẩn'}</h2>
                <p className="text-[12px] text-white/70">Mã gói: {membership.plan_code || '—'}</p>
              </div>
              <div className="rounded-xl bg-white p-2 shadow-sm">
                <QRCode value={`SMARTBOOK:MEMBER:${membership.card_number || membership.membership_id}`} size={96} />
              </div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-white/60">Số thẻ</p>
              <p className="font-mono text-[18px] font-semibold tracking-[0.08em]">{cardNumber}</p>
              <p className="mt-1 text-[11px] text-white/60">Đưa mã QR này tại quầy để mượn hoặc trả sách nhanh hơn.</p>
            </div>
          </div>
        </section>

        <section aria-label="Mức sử dụng" className="rounded-2xl border border-border bg-card p-5 md:col-span-2">
          <h2 className="text-[14px] font-semibold">Suất mượn của bạn</h2>
          <p className="mt-3 font-mono text-[32px] font-bold leading-none tabular-nums">
            {membership.active_loan_count}
            <span className="text-[18px] font-medium text-muted-foreground"> / {maxLoans || '—'}</span>
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">cuốn đang mượn</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Đã dùng ${usagePct}% số suất mượn`}>
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${usagePct}%` }} />
          </div>
          <p className="mt-2 text-[13px] font-medium text-foreground">Còn {membership.remaining_loan_slots} suất mượn</p>
        </section>
      </div>

      <SectionCard title="Quyền lợi và chính sách" subtitle="Áp dụng theo gói hiện tại của bạn">
        <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          {benefits.map((item) => (
            <div key={item.label} className="flex items-baseline justify-between gap-3 border-b border-border py-3 last:border-0 sm:[&:nth-last-child(2)]:border-0">
              <dt className="text-[13px] text-muted-foreground">{item.label}</dt>
              <dd className="text-right text-[14px] font-semibold text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          Hạn mức do gói hội viên quy định.{' '}
          <NavLink to="/customer/support" className="font-medium underline">Liên hệ thư viện</NavLink> để nâng cấp gói hoặc thỏa thuận riêng.
        </p>
      </SectionCard>
    </div>
  );
}
