import { useEffect, useState, useCallback } from 'react';
import { Award, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { customerBorrowService } from '@/services/customer-borrow';
import { aiService, ReadingStatsResponse } from '@/services/ai';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { SectionCard } from './_shared/section-card';
import { fillMonths } from './_shared/customer-format';

const CHART_MONTHS = 12;

function RankedList({ items, unit, empty }: { items: { name: string; count: number }[]; unit: string; empty: string }) {
  if (items.length === 0) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.name}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-foreground">{item.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{item.count} {unit}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CustomerReadingAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ReadingStatsResponse | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const loansResp = await customerBorrowService.getMyLoans();
      const loans = Array.isArray(loansResp?.data) ? loansResp.data : [];

      let reviews: any[] = [];
      try {
        const reviewsResp = await customerBorrowService.getMyReviews();
        reviews = Array.isArray(reviewsResp?.data) ? reviewsResp.data : [];
      } catch { /* reviews are optional */ }

      const result = await aiService.getReadingStats(loans, reviews);
      setStats(result);
    } catch (err) {
      console.error('Failed to load reading stats:', err);
      toast.error('Không thể tải thống kê đọc sách');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStats(); }, [loadStats]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8" aria-busy="true">
        <div className="h-24 animate-pulse motion-reduce:animate-none rounded-xl border bg-card" />
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="h-72 animate-pulse motion-reduce:animate-none rounded-xl border bg-card xl:col-span-2" />
          <div className="h-72 animate-pulse motion-reduce:animate-none rounded-xl border bg-card" />
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <EmptyState
          variant="no-data"
          title="Chưa có dữ liệu thống kê"
          description="Hãy mượn sách để bắt đầu hành trình đọc sách của bạn."
          action={<button onClick={() => void loadStats()} className="font-medium text-primary hover:underline">Tải lại</button>}
        />
      </div>
    );
  }

  const months = fillMonths(stats.monthly_data);
  const busiest = stats.monthly_data.reduce<{ month: string; count: number } | null>((best, m) => (!best || m.count > best.count ? m : best), null);
  const [busyYear, busyMonth] = busiest ? busiest.month.split('-') : [];

  // avg_borrow_days is 0 both for same-day returns and for "nothing returned yet"; the API cannot tell them apart.
  const summary = [
    { label: 'Sách đã mượn', value: String(stats.total_books), hint: 'tính trên mọi phiếu mượn' },
    { label: 'Thời gian giữ sách TB', value: stats.avg_borrow_days > 0 ? `${stats.avg_borrow_days} ngày` : '—', hint: stats.avg_borrow_days > 0 ? 'trên các sách đã trả' : 'chưa đủ dữ liệu trả sách' },
    { label: 'Chuỗi tháng liên tiếp', value: `${stats.streak_months} tháng`, hint: 'tháng nào cũng có mượn' },
    { label: 'Thành tựu', value: String(stats.badges.length), hint: stats.badges.length ? stats.badges.map((b) => b.name).join(', ') : 'chưa mở khóa' },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Thống kê đọc sách"
        subtitle="Hành trình đọc sách của bạn"
        actions={
          <button onClick={() => void loadStats()} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Làm mới
          </button>
        }
      />

      <section aria-label="Tóm tắt" className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          {summary.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
              <dd className="mt-1 truncate font-mono text-[22px] font-bold leading-none tabular-nums text-foreground">{item.value}</dd>
              <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{item.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Sách mượn theo tháng"
          subtitle={busiest ? `${CHART_MONTHS} tháng gần nhất · nhiều nhất ${busiest.count} cuốn vào tháng ${Number(busyMonth)}/${busyYear}` : `${CHART_MONTHS} tháng gần nhất`}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={months} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)' }} interval="preserveStartEnd" />
              <YAxis fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: 'var(--muted-foreground)' }} width={36} />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                formatter={(value) => [`${value} cuốn`, 'Đã mượn']}
                labelFormatter={(label) => `Tháng ${label}`}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--foreground)' }}
              />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Thành tựu" subtitle="Mở khóa theo số sách và nhịp mượn">
          {stats.badges.length ? (
            <ul className="space-y-3">
              {stats.badges.map((badge) => (
                <li key={badge.id} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                    <Award className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">{badge.name}</p>
                    <p className="text-[12px] text-muted-foreground">{badge.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">Mượn 10 cuốn để mở thành tựu đầu tiên.</p>
          )}
        </SectionCard>

        <SectionCard title="Tác giả hay đọc" className="xl:col-span-2">
          <RankedList items={stats.top_authors} unit="lần mượn" empty="Các phiếu mượn chưa ghi tên tác giả." />
        </SectionCard>

        <SectionCard title="Thể loại yêu thích">
          <RankedList items={stats.top_categories} unit="cuốn" empty="Các phiếu mượn chưa ghi thể loại." />
        </SectionCard>
      </div>
    </div>
  );
}
