import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, BrainCircuit, Copy, PackagePlus, RefreshCw, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { analyticsService, type ReorderSuggestionItem, type ReorderSuggestionsData } from '@/services/analytics';
import { getApiErrorMessage } from '@/services/api';

type PriorityFilter = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';

const dayOptions = [7, 30, 90];
const priorityOptions: PriorityFilter[] = ['ALL', 'HIGH', 'MEDIUM', 'LOW'];

function priorityVariant(priority: ReorderSuggestionItem['priority']) {
  if (priority === 'HIGH') return 'danger';
  if (priority === 'MEDIUM') return 'warning';
  return 'info';
}

function formatStockoutDays(value: number | null) {
  if (value === null || value === undefined) return 'Chưa xác định';
  return `${value.toLocaleString('vi-VN')} ngày`;
}

export function ReorderSuggestionsPage() {
  const [days, setDays] = useState(30);
  const [priority, setPriority] = useState<PriorityFilter>('ALL');
  const [limit, setLimit] = useState(20);
  const [data, setData] = useState<ReorderSuggestionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await analyticsService.getReorderSuggestions({ days, priority, limit });
      setData(response);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Không thể tải gợi ý nhập thêm sách');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [days, priority, limit]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const summary = data?.summary;
  const items = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);

  const handleAskAi = async () => {
    const prompt = 'Giải thích kế hoạch nhập thêm sách dựa trên Reorder Suggestions hiện tại.';
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success('Đã sao chép prompt để hỏi AI chatbot');
    } catch {
      toast.info(prompt);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6 p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-violet-500">Analytics + AI decision support</p>
          <h1 className="mt-2 text-[28px] font-bold tracking-tight text-foreground">
            AI Demand Forecasting &amp; Reorder Suggestion
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] text-muted-foreground">
            Phân tích lượt mượn, đặt chỗ, wishlist, cảnh báo chờ hàng và tồn kho để đề xuất nhập thêm sách.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAskAi}
            className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[13px] font-medium text-violet-700 transition hover:bg-violet-100"
          >
            <Copy className="h-4 w-4" />
            Ask AI about this plan
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      <SectionCard
        title="Bộ lọc dự báo"
        subtitle={data ? `Dữ liệu từ ${data.range.from} đến ${data.range.to}, lead time ${data.range.leadTimeDays} ngày` : 'Chọn khoảng thời gian và mức ưu tiên'}
        icon={BrainCircuit}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 bg-white p-1">
            {dayOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                  days === option ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {option} ngày
              </button>
            ))}
          </div>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as PriorityFilter)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 outline-none focus:border-indigo-300"
          >
            {priorityOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Limit
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(event) => setLimit(Math.min(100, Math.max(1, Number(event.target.value) || 1)))}
              className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 outline-none focus:border-indigo-300"
            />
          </label>
        </div>
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total candidates" value={summary?.total_candidates ?? 0} icon={BrainCircuit} variant="primary" />
        <StatCard label="High priority" value={summary?.high_priority ?? 0} icon={AlertTriangle} variant="danger" />
        <StatCard label="Medium priority" value={summary?.medium_priority ?? 0} icon={TrendingUp} variant="warning" />
        <StatCard label="Suggested qty" value={summary?.estimated_total_reorder_qty ?? 0} icon={PackagePlus} variant="success" />
      </div>

      <SectionCard
        title="Danh sách sách nên xem xét nhập thêm"
        subtitle="Sắp xếp theo mức ưu tiên, demand score và số lượng đề xuất"
        icon={PackagePlus}
        noPadding
      >
        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center text-[14px] text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Đang phân tích nhu cầu...
          </div>
        ) : error ? (
          <EmptyState
            variant="error"
            title="Không thể tải gợi ý nhập thêm"
            description={error}
            action={(
              <button
                type="button"
                onClick={() => void loadData()}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-medium text-white"
              >
                Thử lại
              </button>
            )}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Chưa có sách cần nhập thêm"
            description="Không có tín hiệu mượn, đặt chỗ hoặc thiếu tồn kho trong bộ lọc hiện tại."
            icon={PackagePlus}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-[13px]">
              <thead className="border-y border-slate-100 bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-semibold">Title</th>
                  <th className="px-3 py-3 font-semibold">Available</th>
                  <th className="px-3 py-3 font-semibold">Borrow</th>
                  <th className="px-3 py-3 font-semibold">Reservation</th>
                  <th className="px-3 py-3 font-semibold">Forecast 30d</th>
                  <th className="px-3 py-3 font-semibold">Stockout</th>
                  <th className="px-3 py-3 font-semibold">Priority</th>
                  <th className="px-3 py-3 font-semibold">Suggested</th>
                  <th className="px-5 py-3 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.variant_id} className="align-top transition hover:bg-slate-50/80">
                    <td className="px-5 py-4">
                      <div className="max-w-[280px]">
                        <p className="font-semibold text-foreground">{item.title || 'Chưa có tên sách'}</p>
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          {[item.author, item.category, item.isbn].filter(Boolean).join(' · ') || 'Chưa có metadata'}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-4 font-semibold">{item.available_qty}</td>
                    <td className="px-3 py-4">{item.borrow_count}</td>
                    <td className="px-3 py-4">{item.reservation_count}</td>
                    <td className="px-3 py-4">{item.forecast_30d}</td>
                    <td className="px-3 py-4">{formatStockoutDays(item.estimated_days_until_stockout)}</td>
                    <td className="px-3 py-4">
                      <StatusBadge label={item.priority} variant={priorityVariant(item.priority)} dot />
                    </td>
                    <td className="px-3 py-4 font-semibold text-emerald-700">{item.suggested_reorder_qty}</td>
                    <td className="px-5 py-4">
                      <p className="max-w-[420px] text-[12px] leading-relaxed text-slate-600">{item.reason}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </motion.div>
  );
}
