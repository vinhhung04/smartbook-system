import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, BrainCircuit, Copy, PackagePlus, RefreshCw, TrendingUp, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingSpinner } from '@/components/ui/loading-state';
import { analyticsService, type AgingInventoryItem, type ReorderSuggestionItem, type ReorderSuggestionsData } from '@/services/analytics';
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

  const [agingItems, setAgingItems] = useState<AgingInventoryItem[]>([]);
  const [agingLoading, setAgingLoading] = useState(true);
  const [agingError, setAgingError] = useState<string | null>(null);

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

  const loadAgingInventory = useCallback(async () => {
    try {
      setAgingLoading(true);
      setAgingError(null);
      const response = await analyticsService.getAgingInventory({ days: 90, limit: 50 });
      setAgingItems(response.items.filter((item) => item.days_since_last_activity !== null));
    } catch (err) {
      setAgingError(getApiErrorMessage(err, 'Không thể tải danh sách tồn kho lâu không hoạt động'));
    } finally {
      setAgingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadAgingInventory();
  }, [loadAgingInventory]);

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
      className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6"
    >
      <div>
        <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-violet-500 dark:text-violet-400">Analytics + AI decision support</p>
        <div className="mt-2">
          <PageHeader
            icon={BrainCircuit}
            title="AI Demand Forecasting & Reorder Suggestion"
            description="Phân tích lượt mượn, đặt chỗ, wishlist, cảnh báo chờ hàng và tồn kho để đề xuất nhập thêm sách."
            iconBg="bg-violet-100 dark:bg-violet-500/15"
            iconColor="text-violet-600 dark:text-violet-400"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAskAi}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-200 dark:border-violet-500/20 bg-violet-50 dark:bg-violet-500/10 px-3 py-2 text-[13px] font-medium text-violet-700 dark:text-violet-400 transition hover:bg-violet-100 dark:hover:bg-violet-500/20"
                >
                  <Copy className="h-4 w-4" />
                  Ask AI about this plan
                </button>
                <button
                  type="button"
                  onClick={() => void loadData()}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Làm mới
                </button>
              </div>
            }
          />
        </div>
      </div>

      <SectionCard
        title="Bộ lọc dự báo"
        subtitle={data ? `Dữ liệu từ ${data.range.from} đến ${data.range.to}, lead time ${data.range.leadTimeDays} ngày` : 'Chọn khoảng thời gian và mức ưu tiên'}
        icon={BrainCircuit}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-border bg-card p-1">
            {dayOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                  days === option ? 'bg-indigo-600 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {option} ngày
              </button>
            ))}
          </div>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as PriorityFilter)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-indigo-300 dark:focus:border-indigo-500/40"
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
              className="h-9 w-20 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-indigo-300 dark:focus:border-indigo-500/40"
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
          <div className="flex min-h-[260px] items-center justify-center">
            <LoadingSpinner message="Đang phân tích nhu cầu..." />
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
              <thead className="border-y border-border bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-semibold">Title</th>
                  <th className="px-3 py-3 font-semibold">Available</th>
                  <th className="px-3 py-3 font-semibold">Borrow</th>
                  <th className="px-3 py-3 font-semibold">Reservation</th>
                  <th className="px-3 py-3 font-semibold">Forecast 30d</th>
                  <th className="px-3 py-3 font-semibold">Mùa vụ</th>
                  <th className="px-3 py-3 font-semibold">Stockout</th>
                  <th className="px-3 py-3 font-semibold">Priority</th>
                  <th className="px-3 py-3 font-semibold">Suggested</th>
                  <th className="px-5 py-3 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.variant_id} className="align-top transition hover:bg-muted/40">
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
                    <td className="px-3 py-4">
                      {item.seasonal_event ? (
                        <StatusBadge label={`${item.seasonal_event} · ${item.seasonal_index}x`} variant="info" dot />
                      ) : item.seasonal_index !== 1 ? (
                        <span className="text-[12px] text-muted-foreground">{item.seasonal_index}x</span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-4">{formatStockoutDays(item.estimated_days_until_stockout)}</td>
                    <td className="px-3 py-4">
                      <StatusBadge label={item.priority} variant={priorityVariant(item.priority)} dot />
                    </td>
                    <td className="px-3 py-4 font-semibold text-emerald-700 dark:text-emerald-400">{item.suggested_reorder_qty}</td>
                    <td className="px-5 py-4">
                      <p className="max-w-[420px] text-[12px] leading-relaxed text-muted-foreground">{item.reason}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Tồn kho lâu không hoạt động"
        subtitle="Sách còn tồn kho nhưng không có lượt mượn hoặc di chuyển kho trong 90 ngày gần đây"
        icon={Archive}
        noPadding
      >
        {agingLoading ? (
          <div className="flex min-h-[160px] items-center justify-center">
            <LoadingSpinner message="Đang kiểm tra tồn kho lâu..." />
          </div>
        ) : agingError ? (
          <EmptyState
            variant="error"
            title="Không thể tải dữ liệu"
            description={agingError}
            action={(
              <button
                type="button"
                onClick={() => void loadAgingInventory()}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-medium text-white"
              >
                Thử lại
              </button>
            )}
          />
        ) : agingItems.length === 0 ? (
          <EmptyState
            title="Không có sách nào tồn kho lâu"
            description="Tất cả sách còn tồn kho đều có hoạt động mượn/di chuyển trong 90 ngày gần đây."
            icon={Archive}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-y border-border bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-semibold">Title</th>
                  <th className="px-3 py-3 font-semibold">Kho</th>
                  <th className="px-3 py-3 font-semibold">Tồn kho</th>
                  <th className="px-3 py-3 font-semibold">Không hoạt động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {agingItems.map((item) => (
                  <tr key={`${item.variant_id}-${item.warehouse_id}`} className="align-top transition hover:bg-muted/40">
                    <td className="px-5 py-4 font-semibold text-foreground">{item.title}</td>
                    <td className="px-3 py-4">{item.warehouse_name}</td>
                    <td className="px-3 py-4">{item.on_hand_qty}</td>
                    <td className="px-3 py-4">
                      <StatusBadge label={`${item.days_since_last_activity} ngày`} variant={item.days_since_last_activity! >= 180 ? 'danger' : 'warning'} dot />
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
