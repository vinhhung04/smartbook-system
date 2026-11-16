import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withoutLeadingZeros, zeroFieldProps } from '@/lib/number-input';
import { borrowService } from '@/services/borrow';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { PageWrapper, FadeItem } from '../motion-utils';
import {
  Crown,
  Plus,
  Edit,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Loader2,
} from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingSpinner } from '@/components/ui/loading-state';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';
import { getApiErrorMessage } from '@/services/api';

export interface MembershipPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  max_active_loans: number;
  max_loan_days: number;
  max_renewal_count: number;
  reservation_hold_hours: number;
  fine_per_day: number | string;
  lost_item_fee_multiplier: number | string;
  deposit_per_item?: number | string;
  price: number | string;
  duration_days: number;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  _count?: { customer_memberships: number };
}

interface PlanFormState {
  id?: string;
  code: string;
  name: string;
  description: string;
  max_active_loans: string;
  max_loan_days: string;
  max_renewal_count: string;
  reservation_hold_hours: string;
  fine_per_day: string;
  lost_item_fee_multiplier: string;
  deposit_per_item: string;
  price: string;
  duration_days: string;
  is_default: boolean;
  is_active: boolean;
}

const initialFormState: PlanFormState = {
  code: '',
  name: '',
  description: '',
  max_active_loans: '5',
  max_loan_days: '14',
  max_renewal_count: '2',
  reservation_hold_hours: '24',
  fine_per_day: '0',
  lost_item_fee_multiplier: '1',
  deposit_per_item: '0',
  price: '0',
  duration_days: '365',
  is_default: false,
  is_active: true,
};

type PlanNumberKey = 'max_active_loans' | 'max_loan_days' | 'max_renewal_count' | 'reservation_hold_hours'
  | 'fine_per_day' | 'lost_item_fee_multiplier' | 'deposit_per_item' | 'price' | 'duration_days';

const PLAN_NUMBER_FIELDS: Array<{ key: PlanNumberKey; label: string; integer: boolean; min: number }> = [
  { key: 'max_active_loans', label: 'Tối đa mượn đồng thời', integer: true, min: 1 },
  { key: 'max_loan_days', label: 'Tối đa số ngày mượn', integer: true, min: 1 },
  { key: 'max_renewal_count', label: 'Tối đa lần gia hạn', integer: true, min: 0 },
  { key: 'reservation_hold_hours', label: 'Giữ đặt trước (giờ)', integer: true, min: 1 },
  { key: 'fine_per_day', label: 'Phạt/ngày', integer: false, min: 0 },
  { key: 'lost_item_fee_multiplier', label: 'Hệ số phí mất sách', integer: false, min: 0 },
  { key: 'deposit_per_item', label: 'Tiền cọc mỗi cuốn', integer: true, min: 0 },
  { key: 'price', label: 'Phí gói', integer: false, min: 0 },
  { key: 'duration_days', label: 'Thời hạn thẻ', integer: true, min: 1 },
];

function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function formatVnd(value: unknown): string {
  return `${toNum(value).toLocaleString('vi-VN')} VND`;
}

type PlanRule = { label: string; hint?: string; value: (plan: MembershipPlan) => string };

// Rows of the comparison table, grouped the way a librarian reads a plan: what a reader may borrow, then what it costs.
const PLAN_RULE_GROUPS: Array<{ title: string; rules: PlanRule[] }> = [
  {
    title: 'Quyền mượn',
    rules: [
      { label: 'Mượn cùng lúc', value: (p) => `${p.max_active_loans} cuốn` },
      { label: 'Thời hạn mỗi lượt', value: (p) => `${p.max_loan_days} ngày` },
      { label: 'Gia hạn tối đa', value: (p) => `${p.max_renewal_count} lần` },
      { label: 'Giữ chỗ đặt trước', value: (p) => `${p.reservation_hold_hours} giờ` },
    ],
  },
  {
    title: 'Phí và tiền phạt',
    rules: [
      { label: 'Phí gói', value: (p) => (toNum(p.price) > 0 ? formatVnd(p.price) : 'Miễn phí') },
      { label: 'Thời hạn thẻ', value: (p) => `${p.duration_days} ngày` },
      { label: 'Phạt mỗi ngày trễ', value: (p) => (toNum(p.fine_per_day) > 0 ? formatVnd(p.fine_per_day) : 'Không phạt') },
      { label: 'Phí mất sách', hint: 'hệ số nhân phí mất sách cơ bản', value: (p) => `×${toNum(p.lost_item_fee_multiplier)}` },
      { label: 'Tiền cọc mỗi cuốn', value: (p) => (toNum(p.deposit_per_item) > 0 ? formatVnd(p.deposit_per_item) : 'Không cọc') },
    ],
  },
];

function PlanHead({ plan, totalMembers, onEdit }: { plan: MembershipPlan; totalMembers: number; onEdit: (plan: MembershipPlan) => void }) {
  const members = plan._count?.customer_memberships ?? 0;
  const share = totalMembers > 0 ? Math.round((members / totalMembers) * 100) : 0;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('font-display text-[18px] font-semibold leading-tight tracking-tight', plan.is_active ? 'text-foreground' : 'text-muted-foreground')}>{plan.name}</span>
        {!plan.is_active && <StatusBadge label="Ngừng" variant="neutral" />}
      </div>
      <p className="font-mono text-[12px] text-muted-foreground">{plan.code}</p>
      {plan.is_default && <p className="mt-1.5"><StatusBadge label="Mặc định khi đăng ký" variant="info" /></p>}
      {plan.description && <p className="mt-2 line-clamp-3 text-[13px] font-normal text-muted-foreground" title={plan.description}>{plan.description}</p>}
      <div className="mt-3">
        <p className="text-[13px] font-normal text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{members.toLocaleString('vi-VN')}</span> bạn đọc
          {totalMembers > 0 && <span>, {share}%</span>}
        </p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => onEdit(plan)} aria-label={`Sửa gói ${plan.name}`}>
        <Edit className="h-3.5 w-3.5" /> Sửa
      </Button>
    </>
  );
}

function PlanComparison({ plans, onEdit }: { plans: MembershipPlan[]; onEdit: (plan: MembershipPlan) => void }) {
  const totalMembers = plans.reduce((sum, p) => sum + (p._count?.customer_memberships ?? 0), 0);
  return (
    <div className="@container">
      {/* Narrow screens: one card per plan, the same rules listed down the card. */}
      <ul className="divide-y divide-border @2xl:hidden">
        {plans.map((plan) => (
          <li key={plan.id} className="px-5 py-4">
            <PlanHead plan={plan} totalMembers={totalMembers} onEdit={onEdit} />
            {PLAN_RULE_GROUPS.map((group) => (
              <div key={group.title} className="mt-4">
                <h3 className="text-[13px] font-semibold text-foreground">{group.title}</h3>
                <dl className="mt-1 divide-y divide-border/70">
                  {group.rules.map((rule) => (
                    <div key={rule.label} className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
                      <dt className="text-muted-foreground">
                        {rule.label}
                        {rule.hint && <span className="block text-[12px]">{rule.hint}</span>}
                      </dt>
                      <dd className={cn('shrink-0 text-right tabular-nums', plan.is_active ? 'font-medium text-foreground' : 'text-muted-foreground')}>{rule.value(plan)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto @2xl:block">
        <table className="w-full min-w-[600px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-[200px]" />
            {plans.map((plan) => <col key={plan.id} />)}
          </colgroup>
          <thead>
            <tr className="border-b border-border align-top">
              <th scope="col" className="sticky left-0 z-10 bg-card px-5 py-4 text-left text-[12px] font-normal text-muted-foreground">Gói</th>
              {plans.map((plan) => (
                <th key={plan.id} scope="col" className="px-4 py-4 text-left font-normal">
                  <PlanHead plan={plan} totalMembers={totalMembers} onEdit={onEdit} />
                </th>
              ))}
            </tr>
          </thead>
          {PLAN_RULE_GROUPS.map((group) => (
            <tbody key={group.title}>
              <tr className="bg-muted/40">
                <th scope="rowgroup" colSpan={plans.length + 1} className="sticky left-0 px-5 py-2 text-left text-[13px] font-semibold text-foreground">
                  {group.title}
                </th>
              </tr>
              {group.rules.map((rule) => (
                <tr key={rule.label} className="border-b border-border/70 last:border-0 hover:bg-muted/20">
                  <th scope="row" className="sticky left-0 bg-card px-5 py-2.5 text-left font-normal text-muted-foreground">
                    {rule.label}
                    {rule.hint && <span className="block text-[12px]">{rule.hint}</span>}
                  </th>
                  {plans.map((plan) => (
                    <td key={plan.id} className={cn('px-4 py-2.5 tabular-nums', plan.is_active ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                      {rule.value(plan)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

function planToForm(p: MembershipPlan): PlanFormState {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description ?? '',
    max_active_loans: String(p.max_active_loans),
    max_loan_days: String(p.max_loan_days),
    max_renewal_count: String(p.max_renewal_count),
    reservation_hold_hours: String(p.reservation_hold_hours),
    fine_per_day: String(toNum(p.fine_per_day)),
    lost_item_fee_multiplier: String(toNum(p.lost_item_fee_multiplier)),
    deposit_per_item: String(toNum(p.deposit_per_item)),
    price: String(toNum(p.price)),
    duration_days: String(p.duration_days),
    is_default: p.is_default,
    is_active: p.is_active,
  };
}

export function MembershipPlansPage() {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PlanFormState>(initialFormState);

  const isEdit = Boolean(form.id);

  const loadPlans = useCallback(async () => {
    try {
      setLoading(true);
      const res = await borrowService.getMembershipPlans() as { data?: MembershipPlan[] };
      setPlans(Array.isArray(res?.data) ? res.data : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được danh sách gói hội viên'));
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const stats = useMemo(() => {
    const total = plans.length;
    const activePlans = plans.filter((p) => p.is_active).length;
    const totalMembers = plans.reduce(
      (s, p) => s + (p._count?.customer_memberships ?? 0),
      0,
    );
    return { total, activePlans, totalMembers };
  }, [plans]);

  const openCreate = () => {
    setForm(initialFormState);
    setShowModal(true);
  };

  const openEdit = (plan: MembershipPlan) => {
    setForm(planToForm(plan));
    setShowModal(true);
  };

  const closeModal = () => {
    if (!saving) {
      setShowModal(false);
      setForm(initialFormState);
    }
  };

  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(showModal, closeModal, modalRef);

  const onSubmit = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error('Tên gói là bắt buộc');
      return;
    }

    if (!isEdit) {
      const code = form.code.trim();
      if (!code) {
        toast.error('Mã gói là bắt buộc');
        return;
      }
    }

    // Same limits as the API (which stays the source of truth). 0 is a real value
    // (e.g. 0 renewals), never replaced by a default.
    const numbers: Record<string, number> = {};
    for (const rule of PLAN_NUMBER_FIELDS) {
      const raw = form[rule.key].trim();
      const value = raw === '' ? Number.NaN : Number(raw);
      const validShape = rule.integer ? Number.isInteger(value) : Number.isFinite(value);
      if (!validShape || value < rule.min) {
        toast.error(`${rule.label} phải là ${rule.integer ? 'số nguyên' : 'số'} ≥ ${rule.min}`);
        return;
      }
      numbers[rule.key] = value;
    }
    if (form.is_default && !form.is_active) {
      toast.error('Gói mặc định phải đang hoạt động');
      return;
    }

    const basePayload: Record<string, unknown> = {
      name,
      description: form.description.trim() || null,
      ...numbers,
      // Only ever sent as true: the default moves to another plan, it is never just removed.
      ...(form.is_default ? { is_default: true } : {}),
    };

    try {
      setSaving(true);
      if (isEdit && form.id) {
        await borrowService.updateMembershipPlan(form.id, {
          ...basePayload,
          is_active: form.is_active,
        });
        toast.success('Đã cập nhật gói hội viên');
      } else {
        const createdRes = await borrowService.createMembershipPlan({
          ...basePayload,
          code: form.code.trim().toUpperCase(),
        }) as { data?: MembershipPlan };
        const newId = createdRes?.data?.id;
        if (!form.is_active && newId) {
          await borrowService.updateMembershipPlan(newId, { is_active: false });
        }
        toast.success('Đã tạo gói hội viên mới');
      }
      setShowModal(false);
      setForm(initialFormState);
      await loadPlans();
    } catch (error) {
      toast.error(getApiErrorMessage(error, isEdit ? 'Cập nhật gói thất bại' : 'Tạo gói thất bại'));
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full h-9 px-3 rounded-lg border border-input bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40';

  // Cheapest tier first, so the columns read as a ladder from basic to VIP.
  const orderedPlans = [...plans].sort(
    (a, b) => Number(b.is_active) - Number(a.is_active) || a.max_active_loans - b.max_active_loans || toNum(a.price) - toNum(b.price),
  );

  const defaultPlan = plans.find((p) => p.is_default);
  const numberField = (key: PlanNumberKey, id: string, label: string, min: number, step?: string) => (
    <div key={key}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-foreground">{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        step={step}
        className={inputClass}
        value={form[key]}
        {...zeroFieldProps}
        onChange={(e) => setForm((f) => ({ ...f, [key]: withoutLeadingZeros(e.target.value) }))}
      />
    </div>
  );

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Crown}
          title="Gói hội viên"
          description={
            loading
              ? 'Quy tắc mượn và phí của từng gói'
              : `${stats.total} gói, ${stats.activePlans} đang mở đăng ký, ${stats.totalMembers.toLocaleString('vi-VN')} bạn đọc đang dùng`
          }
          actions={
            <>
              <Button type="button" variant="outline" size="sm" className="gap-2" disabled={loading} onClick={() => void loadPlans()}>
                <RefreshCw className={cn('h-4 w-4 motion-reduce:animate-none', loading && 'animate-spin')} /> Làm mới
              </Button>
              <Button type="button" size="sm" className="gap-2" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Gói mới
              </Button>
            </>
          }
        />
      </FadeItem>

      <FadeItem>
        <section aria-label="Tổng quan gói hội viên" className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4">
            <p className="text-[13px] text-muted-foreground">Gói đang mở đăng ký</p>
            <p className="mt-1 font-display text-[28px] font-semibold leading-tight tabular-nums text-foreground">
              {loading ? '–' : stats.activePlans}
            </p>
            {!loading && <p className="text-[12px] text-muted-foreground">trên tổng {stats.total} gói</p>}
          </div>
          <div className="px-5 py-4">
            <p className="text-[13px] text-muted-foreground">Bạn đọc đang dùng gói</p>
            <p className="mt-1 font-display text-[28px] font-semibold leading-tight tabular-nums text-foreground">
              {loading ? '–' : stats.totalMembers.toLocaleString('vi-VN')}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[13px] text-muted-foreground">Gói cấp cho bạn đọc mới</p>
            <p className="mt-1 truncate font-display text-[22px] font-semibold leading-tight text-foreground" title={defaultPlan?.name}>
              {loading ? '–' : defaultPlan?.name ?? 'Chưa chọn'}
            </p>
            {!loading && defaultPlan && <p className="font-mono text-[12px] text-muted-foreground">{defaultPlan.code}</p>}
          </div>
        </section>
      </FadeItem>

      <FadeItem>
        <section aria-labelledby="plan-compare-title" className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 pb-3 pt-4">
            <h2 id="plan-compare-title" className="font-display text-[18px] font-semibold tracking-tight">So sánh các gói</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Xếp từ gói cơ bản đến gói cao nhất, gói ngừng nằm cuối với chữ nhạt.</p>
          </div>
          {loading ? (
            <LoadingSpinner message="Đang tải gói hội viên..." className="justify-center py-16" />
          ) : plans.length === 0 ? (
            <EmptyState
              variant="no-data"
              title="Chưa có gói hội viên"
              description="Tạo gói để định nghĩa giới hạn mượn và phí phạt."
              icon={Crown}
              action={
                <Button size="sm" className="gap-2" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Gói mới
                </Button>
              }
            />
          ) : (
            <PlanComparison plans={orderedPlans} onEdit={openEdit} />
          )}
        </section>
      </FadeItem>

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="membership-plan-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="membership-plan-modal-title" className="mb-1 font-display text-[20px] font-semibold tracking-tight text-foreground">
              {isEdit ? 'Sửa gói hội viên' : 'Gói hội viên mới'}
            </h2>
            <p className="mb-5 text-[13px] text-muted-foreground">
              {isEdit ? 'Cập nhật quy tắc mượn cho gói này.' : 'Định nghĩa cấp hội viên mới.'}
            </p>

            <div className="space-y-5">
              <div className="space-y-4">
                {!isEdit && (
                  <div>
                    <label htmlFor="plan-code" className="mb-1.5 block text-[13px] font-medium text-foreground">Mã gói</label>
                    <input
                      id="plan-code"
                      className={cn(inputClass, 'font-mono uppercase')}
                      value={form.code}
                      onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                      placeholder="VD: GOLD"
                      autoComplete="off"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="plan-name" className="mb-1.5 block text-[13px] font-medium text-foreground">Tên gói</label>
                  <input
                    id="plan-name"
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Tên hiển thị gói"
                  />
                </div>
                <div>
                  <label htmlFor="plan-description" className="mb-1.5 block text-[13px] font-medium text-foreground">Mô tả</label>
                  <textarea
                    id="plan-description"
                    className={`${inputClass} min-h-[72px] resize-y py-2`}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Ghi chú (không bắt buộc)"
                    rows={3}
                  />
                </div>
              </div>

              <fieldset className="border-t border-border pt-4">
                <legend className="pr-2 text-[13px] font-semibold text-foreground">Quyền mượn</legend>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {numberField('max_active_loans', 'plan-max-active-loans', 'Mượn cùng lúc (cuốn)', 1)}
                  {numberField('max_loan_days', 'plan-max-loan-days', 'Thời hạn mỗi lượt (ngày)', 1)}
                  {numberField('max_renewal_count', 'plan-max-renewals', 'Gia hạn tối đa (lần)', 0)}
                  {numberField('reservation_hold_hours', 'plan-hold-hours', 'Giữ đặt trước (giờ)', 1)}
                </div>
              </fieldset>

              <fieldset className="border-t border-border pt-4">
                <legend className="pr-2 text-[13px] font-semibold text-foreground">Phí và tiền phạt</legend>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {numberField('price', 'plan-price', 'Phí gói (VND)', 0, '1000')}
                  {numberField('duration_days', 'plan-duration', 'Thời hạn thẻ (ngày)', 1)}
                  {numberField('fine_per_day', 'plan-fine-per-day', 'Phạt mỗi ngày trễ (VND)', 0, '0.01')}
                  {numberField('lost_item_fee_multiplier', 'plan-lost-multiplier', 'Hệ số phí mất sách', 0, '0.01')}
                  {numberField('deposit_per_item', 'plan-deposit', 'Tiền cọc mỗi cuốn (VND)', 0, '1000')}
                </div>
              </fieldset>

              <label className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={form.is_default}
                  // The current default can only be replaced by choosing another plan.
                  disabled={Boolean(form.id && plans.find((p) => p.id === form.id)?.is_default)}
                  onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                />
                <span>
                  <span className="block text-[13px] font-medium text-foreground">Gói mặc định khi đăng ký</span>
                  <span className="block text-[12px] text-muted-foreground">Tài khoản bạn đọc mới được cấp gói này; chỉ một gói là mặc định.</span>
                </span>
              </label>

              <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-foreground">Hoạt động</p>
                  <p className="text-[12px] text-muted-foreground">Gói có thể được đăng ký mới</p>
                </div>
                <button
                  type="button"
                  aria-label={form.is_active ? 'Tắt hoạt động' : 'Bật hoạt động'}
                  className="shrink-0 rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                  aria-pressed={form.is_active}
                >
                  {form.is_active ? (
                    <ToggleRight className="h-9 w-9 text-primary" />
                  ) : (
                    <ToggleLeft className="h-9 w-9 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={closeModal}>
                Hủy
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void onSubmit()}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Đang lưu...
                  </>
                ) : isEdit ? (
                  'Lưu thay đổi'
                ) : (
                  'Tạo gói'
                )}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </PageWrapper>
  );
}
