import { Ban, CheckCircle2, Crown, Receipt } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import type { FineSummary } from '@/services/analytics';
import { CHART_COLORS } from './types';
import { formatMoney } from './utils';

interface TopBooksFinesSectionProps {
  topBookData: Array<{ variant_id: string; book_id: string | null; title: string; borrow_count: number; name: string }>;
  fines: FineSummary;
}

export function TopBooksFinesSection({ topBookData, fines }: TopBooksFinesSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <SectionCard title="Sách mượn nhiều nhất" subtitle="Xếp hạng theo số lượt mượn" icon={Crown}>
        {topBookData.length ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topBookData} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11, fill: 'var(--color-foreground)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-card)', color: 'var(--color-foreground)' }} />
              <Bar dataKey="borrow_count" radius={[0, 6, 6, 0]} name="Số lượt mượn">
                {topBookData.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState variant="no-data" title="Chưa có dữ liệu mượn sách" description="Sách sẽ được xếp hạng sau khi có giao dịch mượn." />
        )}
      </SectionCard>

      <SectionCard title="Tổng quan tiền phạt" subtitle="Số tiền chưa trả, đã trả và miễn giảm" icon={Receipt}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/20 dark:bg-rose-500/10">
            <div className="flex items-center gap-1.5 text-[11px] uppercase text-rose-700 dark:text-rose-400">
              <Receipt className="w-3 h-3" /> Chưa trả
            </div>
            <p className="mt-1 text-[18px] font-semibold text-rose-900 dark:text-rose-300">{formatMoney(fines.total_unpaid)}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
            <div className="flex items-center gap-1.5 text-[11px] uppercase text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" /> Đã trả
            </div>
            <p className="mt-1 text-[18px] font-semibold text-emerald-900 dark:text-emerald-300">{formatMoney(fines.total_paid)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-500/20 dark:bg-slate-500/10">
            <div className="flex items-center gap-1.5 text-[11px] uppercase text-slate-600 dark:text-slate-400">
              <Ban className="w-3 h-3" /> Miễn giảm
            </div>
            <p className="mt-1 text-[18px] font-semibold text-slate-800 dark:text-slate-300">{formatMoney(fines.total_waived)}</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {fines.by_type.length ? (
            fines.by_type.map((item) => (
              <div key={item.fine_type} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                <div>
                  <p className="text-[13px] font-medium">{item.fine_type}</p>
                  <p className="text-[12px] text-muted-foreground">{item.count} khoản phạt</p>
                </div>
                <p className="text-[13px] font-semibold">{formatMoney(item.amount)}</p>
              </div>
            ))
          ) : (
            <EmptyState variant="no-data" title="Chưa có tiền phạt" description="Tổng quan tiền phạt sẽ hiển thị khi có phạt." className="py-8" />
          )}
        </div>
      </SectionCard>
    </div>
  );
}
