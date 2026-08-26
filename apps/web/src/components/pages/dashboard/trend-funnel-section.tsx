import { TicketCheck, TrendingUp } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import type { DashboardKpis } from '@/services/analytics';
import { CHART_COLORS } from './types';
import { formatPercent } from './utils';

interface TrendFunnelSectionProps {
  trendData: Array<{ date: string; loans: number; returns: number; reservations: number; label: string }>;
  funnelData: Array<{ name: string; value: number }>;
  kpis: DashboardKpis;
  conversionRate: number;
}

export function TrendFunnelSection({ trendData, funnelData, kpis, conversionRate }: TrendFunnelSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <section className="xl:col-span-2">
        <SectionCard title="Xu hướng mượn trả" subtitle="Lượt mượn, trả và đặt trước trong khoảng thời gian gần nhất" icon={TrendingUp}>
          {trendData.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={trendData} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                <defs>
                  <linearGradient id="loansGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-card)', color: 'var(--color-foreground)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="loans" stroke={CHART_COLORS[0]} fill="url(#loansGrad)" strokeWidth={2} name="Mượn" />
                <Area type="monotone" dataKey="returns" stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.15} strokeWidth={2} name="Trả" />
                <Area type="monotone" dataKey="reservations" stroke={CHART_COLORS[2]} fill={CHART_COLORS[2]} fillOpacity={0.15} strokeWidth={2} name="Đặt trước" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState variant="no-data" title="Chưa có dữ liệu xu hướng" description="Chưa có hoạt động mượn/đặt trong khoảng thời gian đã chọn." />
          )}
        </SectionCard>
      </section>

      <SectionCard title="Phễu đặt trước" subtitle={`Tỷ lệ chuyển đổi ${formatPercent(conversionRate)}`} icon={TicketCheck}>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="rounded-lg bg-muted/50 px-2.5 py-2">
            <p className="text-[11px] uppercase text-muted-foreground">Đặt trước</p>
            <p className="text-[15px] font-semibold text-foreground">{kpis.pending_reservations}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2.5 py-2">
            <p className="text-[11px] uppercase text-muted-foreground">Đã xác nhận</p>
            <p className="text-[15px] font-semibold text-foreground">{kpis.confirmed_reservations}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2.5 py-2">
            <p className="text-[11px] uppercase text-muted-foreground">Sẵn lấy</p>
            <p className="text-[15px] font-semibold text-foreground">{kpis.ready_for_pickup_reservations}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2.5 py-2">
            <p className="text-[11px] uppercase text-muted-foreground">Sắp hết hạn lấy</p>
            <p className="text-[15px] font-semibold text-foreground">{kpis.pickup_codes_expiring_soon}</p>
          </div>
        </div>
        {funnelData.some((item) => item.value > 0) ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnelData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-card)', color: 'var(--color-foreground)' }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Đặt trước">
                {funnelData.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState variant="no-data" title="Chưa có đặt trước" description="Phễu đặt trước sẽ hiển thị sau khi khách hàng tạo đặt trước." />
        )}
      </SectionCard>
    </div>
  );
}
