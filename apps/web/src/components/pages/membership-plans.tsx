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
} from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { SectionCard } from '@/components/ui/section-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingSpinner } from '@/components/ui/loading-state';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { Button } from '@/components/ui/button';
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
  is_active: true,
};

function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
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

    const basePayload: Record<string, unknown> = {
      name,
      description: form.description.trim() || null,
      max_active_loans: Number(form.max_active_loans) || 0,
      max_loan_days: Number(form.max_loan_days) || 0,
      max_renewal_count: Number(form.max_renewal_count) || 0,
      reservation_hold_hours: Number(form.reservation_hold_hours) || 0,
      fine_per_day: Number(form.fine_per_day) || 0,
      lost_item_fee_multiplier: Number(form.lost_item_fee_multiplier) || 1,
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
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
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
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">
                      Mã gói
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">
                      Tên gói
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">
                      Tối đa mượn
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">
                      Tối đa ngày
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">
                      Phạt/ngày
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">
                      Gia hạn
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">
                      Trạng thái
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">
                      Thành viên
                    </th>
                    <th className="text-right text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id} className="border-b border-border/80 last:border-0 hover:bg-muted/20">
                      <td className="px-5 py-3.5 text-[13px] font-medium">{plan.code}</td>
                      <td className="px-5 py-3.5 text-[13px]">{plan.name}</td>
                      <td className="px-5 py-3.5 text-[13px]">{plan.max_active_loans}</td>
                      <td className="px-5 py-3.5 text-[13px]">{plan.max_loan_days}</td>
                      <td className="px-5 py-3.5 text-[13px]">{toNum(plan.fine_per_day).toFixed(2)}</td>
                      <td className="px-5 py-3.5 text-[13px]">{plan.max_renewal_count}</td>
                      <td className="px-5 py-3.5 text-[13px]">
                        {plan.is_active ? (
                          <StatusBadge label="Hoạt động" variant="success" dot />
                        ) : (
                          <StatusBadge label="Không hoạt động" variant="neutral" dot />
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[13px]">
                        {plan._count?.customer_memberships ?? 0}
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 h-8"
                          onClick={() => openEdit(plan)}
                        >
                          <Edit className="w-3.5 h-3.5" />
                          Sửa
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    min={0}
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
                    min={0}
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
                    min={0}
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
