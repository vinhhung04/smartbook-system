import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { borrowService } from '@/services/borrow';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import {
  Crown,
  Plus,
  Edit,
  RefreshCw,
  Shield,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Users,
} from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { SectionCard } from '@/components/ui/section-card';
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
  price: '0',
  duration_days: '365',
  is_default: false,
  is_active: true,
};

type PlanNumberKey = 'max_active_loans' | 'max_loan_days' | 'max_renewal_count' | 'reservation_hold_hours'
  | 'fine_per_day' | 'lost_item_fee_multiplier' | 'price' | 'duration_days';

const PLAN_NUMBER_FIELDS: Array<{ key: PlanNumberKey; label: string; integer: boolean; min: number }> = [
  { key: 'max_active_loans', label: 'Tối đa mượn đồng thời', integer: true, min: 1 },
  { key: 'max_loan_days', label: 'Tối đa số ngày mượn', integer: true, min: 1 },
  { key: 'max_renewal_count', label: 'Tối đa lần gia hạn', integer: true, min: 0 },
  { key: 'reservation_hold_hours', label: 'Giữ đặt trước (giờ)', integer: true, min: 1 },
  { key: 'fine_per_day', label: 'Phạt/ngày', integer: false, min: 0 },
  { key: 'lost_item_fee_multiplier', label: 'Hệ số phí mất sách', integer: false, min: 0 },
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

function PlanCard({ plan, onEdit }: { plan: MembershipPlan; onEdit: (plan: MembershipPlan) => void }) {
  const members = plan._count?.customer_memberships ?? 0;
  const rules: Array<{ label: string; value: string }> = [
    { label: 'Phí gói', value: toNum(plan.price) > 0 ? formatVnd(plan.price) : 'Miễn phí' },
    { label: 'Thời hạn thẻ', value: `${plan.duration_days} ngày` },
    { label: 'Gia hạn tối đa', value: `${plan.max_renewal_count} lần` },
    { label: 'Giữ chỗ đặt trước', value: `${plan.reservation_hold_hours} giờ` },
    { label: 'Phạt mỗi ngày trễ', value: toNum(plan.fine_per_day) > 0 ? formatVnd(plan.fine_per_day) : 'Không phạt' },
    { label: 'Hệ số phí mất sách', value: `×${toNum(plan.lost_item_fee_multiplier)}` },
  ];
  return (
    <article className={cn('flex flex-col rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md', !plan.is_active && 'opacity-70')}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-foreground" title={plan.name}>{plan.name}</h3>
          <p className="font-mono text-[11px] text-muted-foreground">{plan.code}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {plan.is_active ? (
            <StatusBadge label="Hoạt động" variant="success" dot />
          ) : (
            <StatusBadge label="Không hoạt động" variant="neutral" dot />
          )}
          {plan.is_default ? <StatusBadge label="Mặc định khi đăng ký" variant="info" /> : null}
        </div>
      </header>

      {plan.description ? <p className="mt-2 line-clamp-2 text-[12px] text-muted-foreground">{plan.description}</p> : null}

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3">
        <div>
          <p className="font-mono text-[24px] font-bold leading-none tabular-nums text-foreground">{plan.max_active_loans}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">cuốn mượn cùng lúc</p>
        </div>
        <div>
          <p className="font-mono text-[24px] font-bold leading-none tabular-nums text-foreground">{plan.max_loan_days}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">ngày mỗi lượt mượn</p>
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-[12px]">
        {rules.map((rule) => (
          <div key={rule.label} className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{rule.label}</dt>
            <dd className="text-right font-medium text-foreground">{rule.value}</dd>
          </div>
        ))}
      </dl>

      <footer className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {members} thành viên
        </span>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => onEdit(plan)} aria-label={`Sửa gói ${plan.name}`}>
          <Edit className="h-3.5 w-3.5" />
          Sửa
        </Button>
      </footer>
    </article>
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

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <PageHeader
          icon={Crown}
          title="Gói hội viên"
          description="Quản lý các gói hội viên"
          iconBg="bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg"
          iconColor="text-white"
          iconSize="sm"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={loading}
                onClick={() => void loadPlans()}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Làm mới
              </Button>
              <Button type="button" size="sm" className="gap-2" onClick={openCreate}>
                <Plus className="w-4 h-4" />
                Gói mới
              </Button>
            </>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      >
        <StatCard
          label="Tổng số gói"
          value={stats.total}
          icon={Crown}
          variant="warning"
        />
        <StatCard
          label="Gói đang hoạt động"
          value={stats.activePlans}
          icon={Shield}
          variant="success"
        />
        <StatCard
          label="Tổng thành viên"
          value={stats.totalMembers}
          icon={ToggleRight}
          variant="primary"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <SectionCard noPadding>
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
                  <Plus className="w-4 h-4" />
                  Gói mới
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} onEdit={openEdit} />
              ))}
            </div>
          )}
        </SectionCard>
      </motion.div>

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
            className="bg-card rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="membership-plan-modal-title" className="text-[16px] font-semibold text-foreground mb-1">
              {isEdit ? 'Sửa gói hội viên' : 'Gói hội viên mới'}
            </h2>
            <p className="text-[12px] text-muted-foreground mb-5">
              {isEdit ? 'Cập nhật quy tắc mượn cho gói này.' : 'Định nghĩa cấp hội viên mới.'}
            </p>

            <div className="space-y-4">
              {!isEdit && (
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Mã gói
                  </label>
                  <input
                    className={inputClass}
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    placeholder="e.g. GOLD"
                    autoComplete="off"
                  />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Tên gói
                </label>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Tên hiển thị gói"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Mô tả
                </label>
                <textarea
                  className={`${inputClass} min-h-[72px] py-2 resize-y`}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Ghi chú (không bắt buộc)"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Tối đa mượn đồng thời
                  </label>
                  <input
                    type="number"
                    min={1}
                    className={inputClass}
                    value={form.max_active_loans}
                    onChange={(e) => setForm((f) => ({ ...f, max_active_loans: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Tối đa số ngày mượn
                  </label>
                  <input
                    type="number"
                    min={1}
                    className={inputClass}
                    value={form.max_loan_days}
                    onChange={(e) => setForm((f) => ({ ...f, max_loan_days: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Tối đa lần gia hạn
                  </label>
                  <input
                    type="number"
                    min={0}
                    className={inputClass}
                    value={form.max_renewal_count}
                    onChange={(e) => setForm((f) => ({ ...f, max_renewal_count: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Giữ đặt trước (giờ)
                  </label>
                  <input
                    type="number"
                    min={1}
                    className={inputClass}
                    value={form.reservation_hold_hours}
                    onChange={(e) => setForm((f) => ({ ...f, reservation_hold_hours: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Phạt/ngày
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={form.fine_per_day}
                    onChange={(e) => setForm((f) => ({ ...f, fine_per_day: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="plan-price" className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Phí gói (VND)
                  </label>
                  <input
                    id="plan-price"
                    type="number"
                    min={0}
                    step="1000"
                    className={inputClass}
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="plan-duration" className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Thời hạn thẻ (ngày)
                  </label>
                  <input
                    id="plan-duration"
                    type="number"
                    min={1}
                    className={inputClass}
                    value={form.duration_days}
                    onChange={(e) => setForm((f) => ({ ...f, duration_days: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Hệ số phí mất sách
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={form.lost_item_fee_multiplier}
                    onChange={(e) => setForm((f) => ({ ...f, lost_item_fee_multiplier: e.target.value }))}
                  />
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={form.is_default}
                  // The current default can only be replaced by choosing another plan.
                  disabled={Boolean(form.id && plans.find((p) => p.id === form.id)?.is_default)}
                  onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                />
                <span>
                  <span className="block text-[13px] font-medium text-foreground">Gói mặc định khi đăng ký</span>
                  <span className="block text-[11px] text-muted-foreground">Tài khoản bạn đọc mới được cấp gói này; chỉ một gói là mặc định.</span>
                </span>
              </label>

              <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-foreground">Hoạt động</p>
                  <p className="text-[11px] text-muted-foreground">Gói có thể được đăng ký mới</p>
                </div>
                <button
                  type="button"
                  aria-label={form.is_active ? 'Tắt hoạt động' : 'Bật hoạt động'}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                  aria-pressed={form.is_active}
                >
                  {form.is_active ? (
                    <ToggleRight className="w-9 h-9 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <ToggleLeft className="w-9 h-9 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6 pt-2 border-t border-border">
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={closeModal}>
                Hủy
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void onSubmit()}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
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
    </div>
  );
}
