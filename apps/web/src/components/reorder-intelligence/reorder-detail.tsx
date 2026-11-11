import type { ReactNode } from 'react';
import { Quote } from 'lucide-react';
import type { ReorderSuggestionItem } from '@/services/analytics';
import { formatCount, formatVnd, stockoutText, type PlanLine } from '@/lib/reorder-intelligence';
import { useRevealOnMount } from './meta';

const LEAD_TIME_SOURCE: Record<string, (samples: number) => string> = {
  LEARNED: (n) => `trung vị thực tế của ${n} lần giao gần đây`,
  SUPPLIER_DECLARED: () => 'theo cam kết của nhà cung cấp',
  DEFAULT: () => 'giá trị mặc định của hệ thống',
};

const FUNDING_TEXT = {
  FULL: 'Được cấp đủ theo kế hoạch',
  PARTIAL: 'Được cấp một phần',
  UNFUNDED: 'Chưa được cấp ngân sách',
  NOT_NEEDED: 'Kế hoạch ngân sách không cần nhập',
} as const;

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="text-right text-[12.5px] font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function FactGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
      <dl className="divide-y divide-border/70">{children}</dl>
    </div>
  );
}

const copies = (n: number) => `${formatCount(n)} bản`;

/**
 * "Vì sao nên nhập?" - the service's own explanation followed by the inputs it
 * was computed from, as returned. Nothing here is recomputed.
 */
export function ReorderDetail({ line, days, hasBudget }: { line: PlanLine; days: number; hasBudget: boolean }) {
  const ref = useRevealOnMount<HTMLDivElement>(4);
  const item: ReorderSuggestionItem = line.item;
  const trend = Math.round(item.demand_trend_pct);
  const leadDays = item.lead_time_days;
  const plan = item.budget_plan;

  return (
    <div ref={ref} className="space-y-4">
      <figure className="flex gap-2.5 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
        <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <figcaption className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Lý do từ hệ thống phân tích</figcaption>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">{item.reason || 'Hệ thống không trả về lý do cho đề xuất này.'}</p>
        </div>
      </figure>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        <FactGroup title="Tồn kho hiện tại">
          <Fact label="Sẵn sàng cho mượn" value={copies(item.available_qty)} />
          <Fact label="Trên kệ (tổng)" value={copies(item.on_hand_qty)} />
          <Fact label="Đang cho mượn" value={copies(item.borrowed_qty)} />
          <Fact label="Đang giữ chỗ" value={copies(item.reserved_qty)} />
          {item.reorder_point > 0 ? <Fact label="Điểm đặt hàng lại" value={copies(item.reorder_point)} /> : null}
        </FactGroup>

        <FactGroup title={`Tín hiệu nhu cầu · ${days} ngày`}>
          <Fact label="Lượt mượn" value={<>{formatCount(item.borrow_count)} <span className="font-normal text-muted-foreground">(kỳ trước {formatCount(item.previous_borrow_count)})</span></>} />
          <Fact label="Xu hướng" value={trend === 0 ? 'Không đổi' : `${trend > 0 ? 'Tăng' : 'Giảm'} ${Math.abs(trend)}%`} />
          <Fact label="Lượt đặt chỗ" value={formatCount(item.reservation_count)} />
          <Fact label="Wishlist · chờ hàng" value={`${formatCount(item.wishlist_count)} · ${formatCount(item.availability_alert_count)}`} />
          <Fact label="Điểm nhu cầu" value={item.demand_score.toLocaleString('vi-VN')} />
        </FactGroup>

        <FactGroup title="Dự báo">
          <Fact label="7 ngày tới" value={`${formatCount(item.forecast_7d)} lượt mượn`} />
          <Fact label="30 ngày tới" value={`${formatCount(item.forecast_30d)} lượt mượn`} />
          {item.lead_time_demand !== undefined && leadDays !== undefined
            ? <Fact label={`Trong ${leadDays} ngày chờ hàng`} value={`${formatCount(item.lead_time_demand)} lượt mượn`} />
            : null}
          <Fact label="Thời điểm hết" value={stockoutText(item)} />
          {item.seasonal_event ? <Fact label={`Mùa vụ: ${item.seasonal_event}`} value={`hệ số ${item.seasonal_index.toLocaleString('vi-VN')}x`} /> : null}
        </FactGroup>

        <FactGroup title="Số lượng & chi phí">
          {leadDays !== undefined ? (
            <Fact
              label="Thời gian chờ hàng"
              value={<span title={LEAD_TIME_SOURCE[item.lead_time_source ?? '']?.(item.lead_time_samples ?? 0)}>{leadDays} ngày</span>}
            />
          ) : null}
          <Fact label="Đề xuất gốc" value={copies(item.suggested_reorder_qty)} />
          <Fact label="Đơn giá" value={item.unit_cost > 0 ? formatVnd(item.unit_cost) : <span className="text-amber-700 dark:text-amber-400">Chưa có giá</span>} />
          {hasBudget && plan ? (
            <>
              <Fact label="Hàng đang về · dự kiến trả" value={`${formatCount(plan.incoming_qty)} · ${formatCount(plan.expected_returns)}`} />
              <Fact label="Tồn quy đổi (cho ngân sách)" value={copies(plan.inventory_position)} />
              <Fact label="Cần theo kế hoạch ngân sách" value={copies(plan.cap_qty)} />
              <Fact label="Được cấp" value={`${copies(item.funded_qty ?? 0)}${line.funding ? ` · ${FUNDING_TEXT[line.funding].toLowerCase()}` : ''}`} />
            </>
          ) : null}
        </FactGroup>
      </div>

      {leadDays !== undefined && item.lead_time_source ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Thời gian chờ hàng {leadDays} ngày là {LEAD_TIME_SOURCE[item.lead_time_source]?.(item.lead_time_samples ?? 0) ?? 'giá trị hệ thống trả về'}.
          {hasBudget && plan ? ' Ở chế độ ngân sách, số lượng được tính lại trên tồn quy đổi (khả dụng + hàng đang về + bản đang mượn dự kiến trả), nên có thể khác đề xuất gốc.' : ''}
        </p>
      ) : null}
    </div>
  );
}
