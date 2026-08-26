import { NavLink } from 'react-router';
import { AlertTriangle, BookMarked, BookOpen, Package, TrendingUp } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { AnimatedCounter } from '@/components/motion-utils';
import type { DashboardKpis } from '@/services/analytics';
import { formatPercent } from './utils';

interface KpiGridProps {
  kpis: DashboardKpis;
  overdueTotalItems: number;
}

export function KpiGrid({ kpis, overdueTotalItems }: KpiGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:auto-rows-[minmax(120px,1fr)] md:grid-flow-dense lg:grid-cols-5">
      <NavLink
        to="/borrow/loans?status=BORROWED"
        className="relative col-span-2 overflow-hidden rounded-xl border border-indigo-700/20 bg-gradient-to-br from-indigo-600 to-blue-600 p-5 flex flex-col justify-between text-white shadow-[0_4px_20px_-6px_rgba(79,70,229,0.5)] md:row-span-2 transition-transform hover:-translate-y-0.5"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-white/70">Đang mượn</span>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
            <BookMarked className="h-[18px] w-[18px] text-white" />
          </div>
        </div>
        <AnimatedCounter value={kpis.active_loans} className="text-[42px] font-bold tracking-tight text-white leading-none" />
        <p className="text-[12px] text-white/75">Tổng số bản sao đang được mượn · Xem chi tiết →</p>
      </NavLink>

      <NavLink to="/catalog" className="block">
        <StatCard label="Đầu sách" value={kpis.total_titles} icon={BookOpen} variant="default" animateValue className="cursor-pointer hover:-translate-y-0.5 transition-transform" hint="Xem chi tiết →" />
      </NavLink>
      <NavLink to="/inventory" className="block">
        <StatCard label="Bản sao" value={kpis.total_copies} icon={Package} variant="success" animateValue className="cursor-pointer hover:-translate-y-0.5 transition-transform" hint="Xem chi tiết →" />
      </NavLink>
      <StatCard label="Tỷ lệ nhận sách" value={formatPercent(kpis.reservation_conversion_rate)} icon={TrendingUp} variant="success" />
      <NavLink to="/borrow/loans?status=OVERDUE" className="block">
        <StatCard label="Mục quá hạn" value={overdueTotalItems} icon={AlertTriangle} variant="danger" animateValue className="cursor-pointer hover:-translate-y-0.5 transition-transform" hint="Xem chi tiết →" />
      </NavLink>
    </div>
  );
}
