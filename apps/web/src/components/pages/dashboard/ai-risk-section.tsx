import { Sparkles } from 'lucide-react';
import type { LateReturnRiskItem, ReservationNoShowRiskItem, RiskBand, RiskFactor, RiskModelData } from '@/services/analytics';
import { formatDateTime, formatPercent } from '@/lib/reorder-intelligence';
import { BandChip, BandMeter, type RiskDomainConfig } from '@/components/reorder-intelligence/risk-workspace';
import { LATE_RETURN, NO_SHOW } from '@/components/reorder-intelligence/risk-domains';
import { BlockEmpty, BlockError, Panel, PanelBody, PanelHeader, PanelLink } from './panel';
import { formatNumber } from './utils';

/** How many rows each model shows here (the API returns the riskiest first); the full list lives on /reorder-suggestions. */
export const AI_RISK_LIMIT = 5;

type Row = { key: string; customer: string; title: string; score: number; band: RiskBand; factor?: RiskFactor };

interface ColumnProps {
  id: string;
  config: RiskDomainConfig;
  lede: string;
  data: RiskModelData<unknown> | null;
  rows: Row[];
  link?: string;
  onRetry: () => void;
}

/** "AUC 0,68 · học từ 23.240 khoản · huấn luyện 19/11 14:43": what a reviewer asks first about a model. */
function modelLine(data: RiskModelData<unknown>, subjectNoun: string) {
  const parts = ['Hồi quy logistic'];
  if (data.evaluation?.auc != null) parts.push(`AUC ${data.evaluation.auc.toFixed(2).replace('.', ',')}`);
  if (data.model?.train_size) parts.push(`học từ ${formatNumber(data.model.train_size)} ${subjectNoun}`);
  if (data.model?.trained_at) parts.push(`huấn luyện ${formatDateTime(data.model.trained_at)}`);
  return parts.join(' · ');
}

function RiskColumn({ id, config, lede, data, rows, link, onRetry }: ColumnProps) {
  const Icon = config.icon;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col">
      <h3 id={id} className="flex items-center gap-2 text-[14px] font-semibold leading-6 text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {config.title}
      </h3>
      <p className="text-[12px] leading-5 text-muted-foreground">{lede}</p>

      <div className="mt-2 flex-1">
        {!data ? (
          <BlockError what={`dự báo ${config.title.toLowerCase()}`} onRetry={onRetry} />
        ) : data.status === 'INSUFFICIENT_DATA' ? (
          <BlockEmpty>{config.needs}</BlockEmpty>
        ) : !rows.length ? (
          <BlockEmpty>{config.emptyText}</BlockEmpty>
        ) : (
          <ol>
            {rows.map((row) => (
              <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border/70 py-2.5 last:border-0">
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">{row.customer}</span>
                    {row.band === 'LOW' ? null : <BandChip band={row.band} />}
                  </p>
                  <p className="truncate text-[12px] leading-5 text-muted-foreground" title={row.title}>{row.title}</p>
                  {row.factor ? (
                    <p className="truncate text-[12px] leading-5 text-muted-foreground">
                      {row.factor.direction === 'increases_risk' ? 'Do ' : 'Giảm nhờ '}
                      <span className="text-foreground/85">{(config.factorLabels[row.factor.feature] || row.factor.feature).toLowerCase()}</span>
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-semibold tabular-nums text-foreground">{formatPercent(row.score)}</p>
                  <BandMeter band={row.band} score={row.score} className="mt-1 w-16" label={`Điểm rủi ro ${formatPercent(row.score)}`} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {data && data.status !== 'INSUFFICIENT_DATA' ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3">
          <p className="text-[12px] leading-5 text-muted-foreground">{modelLine(data, config.subjectNoun)}</p>
          {link ? <PanelLink to={link}>Xem phân tích</PanelLink> : null}
        </div>
      ) : null}
    </section>
  );
}

interface AiRiskSectionProps {
  late: RiskModelData<LateReturnRiskItem> | null;
  noShow: RiskModelData<ReservationNoShowRiskItem> | null;
  /** /reorder-suggestions is behind ROUTE_ACCESS.reports. */
  canOpen: boolean;
  onRetry: () => void;
}

export function AiRiskSection({ late, noShow, canOpen, onRetry }: AiRiskSectionProps) {
  const lateRows: Row[] = (late?.items ?? []).map((item) => ({
    key: item.loan_item_id,
    customer: item.customer_name || 'Chưa xác định',
    title: item.title || 'Chưa xác định',
    score: item.risk_score,
    band: item.risk_band,
    factor: item.top_factors[0],
  }));
  const noShowRows: Row[] = (noShow?.items ?? []).map((item) => ({
    key: item.reservation_id,
    customer: item.customer_name || 'Chưa xác định',
    title: item.title || 'Chưa xác định',
    score: item.risk_score,
    band: item.risk_band,
    factor: item.top_factors[0],
  }));
  const generatedAt = late?.generated_at ?? noShow?.generated_at;

  return (
    <Panel titleId="ai-risk-title" className="@5xl:col-span-8">
      <PanelHeader
        id="ai-risk-title"
        title="AI dự báo rủi ro"
        description="Mô hình học từ lịch sử mượn trả của thư viện, chấm điểm từng phiếu mượn và đặt chỗ đang mở."
        aside={generatedAt ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-0.5 text-[12px] font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Chấm điểm {formatDateTime(generatedAt)}
          </span>
        ) : null}
      />
      <PanelBody className="@container">
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 @2xl:grid-cols-2">
          <RiskColumn
            id="ai-late-title"
            config={LATE_RETURN}
            lede="Khoản mượn đang mở dễ bị trả sau hạn nhất"
            data={late}
            rows={lateRows}
            link={canOpen ? '/reorder-suggestions?tab=late-return' : undefined}
            onRetry={onRetry}
          />
          <RiskColumn
            id="ai-no-show-title"
            config={NO_SHOW}
            lede="Đặt chỗ đang chờ dễ bị bạn đọc bỏ lỡ nhất"
            data={noShow}
            rows={noShowRows}
            link={canOpen ? '/reorder-suggestions?tab=no-show' : undefined}
            onRetry={onRetry}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}
