import { useEffect, useState } from 'react';
import { ShieldCheck, Info, QrCode } from 'lucide-react';
import { customerService, MembershipInfo } from '@/services/customer';
import { getApiErrorMessage } from '@/services/api';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { QRCode } from '@/components/ui/qr-code';

export function CustomerMembershipPage() {
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await customerService.getMyMembership();
        setMembership(data);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load membership'));
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, []);

  if (isLoading) return <LoadingOverlay />;
  if (error) return <EmptyState variant="error" title="Failed to load membership" description={error} action={<button onClick={() => window.location.reload()} className="text-primary font-medium hover:underline">Try again</button>} />;
  if (!membership) return <EmptyState variant="no-data" title="Membership not found" description="Please contact support to set up your membership." />;

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 p-6 shadow-xl shadow-indigo-500/20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.1),transparent_50%)]" />
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="relative flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-[22px] tracking-tight text-white" style={{ fontWeight: 700 }}>
              {membership.plan_name || 'Standard Plan'}
            </h1>
            <p className="text-white/65 text-[13px] mt-0.5">
              Member since {membership.plan_code || 'N/A'} — Enjoy your reading benefits
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active Loans" value={membership.active_loan_count} icon={ShieldCheck} variant="info" />
        <StatCard label="Remaining Slots" value={membership.remaining_loan_slots} icon={ShieldCheck} variant="success" />
        <StatCard label="Max Loan Days" value={`${membership.limits.max_loan_days}d`} icon={ShieldCheck} variant="default" />
        <StatCard label="Fine Per Day" value={membership.limits.fine_per_day} icon={ShieldCheck} variant="warning" />
      </div>

      {/* Limits */}
      <SectionCard title="Membership Benefits" subtitle="Your current plan features and borrowing policies">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: 'Max active loans', value: `${membership.limits.max_active_loans} items`, icon: ShieldCheck },
            { label: 'Max loan period', value: `${membership.limits.max_loan_days} days`, icon: ShieldCheck },
            { label: 'Fine per overdue day', value: `${membership.limits.fine_per_day}`, icon: ShieldCheck },
            { label: 'Renewal limit', value: `${membership.limits.max_renewal_count} times / loan`, icon: ShieldCheck },
            { label: 'Reservation hold', value: `${membership.limits.reservation_hold_hours} hours`, icon: ShieldCheck },
            { label: 'Lost item fee', value: `${membership.limits.lost_item_fee_multiplier}x base fee`, icon: ShieldCheck },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <item.icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground font-medium">{item.label}</p>
                <p className="text-[14px] font-semibold text-foreground mt-0.5">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* QR Code */}
      <SectionCard title="Mã QR thẻ thành viên" subtitle="Xuất trình khi đến thư viện" icon={QrCode}>
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="p-3 bg-white rounded-xl border-2 border-indigo-100 shadow-sm">
            <QRCode value={`SMARTBOOK:MEMBER:${membership.card_number || membership.membership_id}`} size={180} />
          </div>
          <p className="text-[14px] font-mono text-slate-700" style={{ fontWeight: 600, letterSpacing: '0.05em' }}>
            {membership.card_number || membership.membership_id || 'N/A'}
          </p>
          <p className="text-[11px] text-slate-400">Quét mã này tại quầy để mượn/trả sách nhanh chóng</p>
        </div>
      </SectionCard>

      {/* Info Note */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <Info className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-[12px] text-amber-700 leading-relaxed">
          Borrowing limits and policies are determined by your current membership plan. Contact library staff to upgrade or discuss special arrangements.
        </p>
      </div>
    </div>
  );
}
