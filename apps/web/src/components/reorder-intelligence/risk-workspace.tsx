import { Fragment, useState, type ComponentType } from 'react';
import { ChevronDown, CircleAlert, CircleDot, DatabaseZap, Layers, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import type { RiskBand, RiskFactor, RiskModelData } from '@/services/analytics';
import {
  describeInsufficientReason,
  factorWeights,
  formatCount,
  formatDateTime,
  formatPercent,
  riskBandCutoffs,
  RISK_BAND_ORDER,
} from '@/lib/reorder-intelligence';
import { ModelQuality } from './model-quality';
import { FilterPills, LoadingRows, Meter, Panel, StateMessage } from './primitives';
import { useMediaQuery, useRevealOnMount, WIDE_QUERY } from './meta';

export interface RiskRow {
  key: string;
  customer: string;
  title: string;
  from: string | null | undefined;
  to: string | null | undefined;
  score: number;
  band: RiskBand;
  factors: RiskFactor[];
}

export interface RiskDomainConfig {
  id: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** One sentence on what the model estimates. */
  modelSummary: string;
  subjectNoun: string;
  eventNoun: string;
  fromLabel: string;
  toLabel: string;
  /** Shown when the deadline has already passed. */
  pastDueLabel: string;
  factorLabels: Record<string, string>;
  /** What history the model is waiting for. */
  needs: string;
  emptyTitle: string;
  emptyText: string;
}

const BAND_META: Record<RiskBand, { label: string; icon: ComponentType<{ className?: string }>; chip: string; fill: string }> = {
  HIGH: {
    label: 'Nguy cơ cao',
    icon: CircleAlert,
    chip: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
    fill: 'bg-red-500',
  },
  MEDIUM: {
    label: 'Nguy cơ vừa',
    icon: CircleDot,
    chip: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
    fill: 'bg-amber-500',
  },
  LOW: {
    label: 'Nguy cơ thấp',
    icon: ShieldCheck,
    chip: 'border-border bg-muted/50 text-muted-foreground',
    fill: 'bg-slate-400 dark:bg-slate-500',
  },
};

function BandChip({ band }: { band: RiskBand }) {
  const meta = BAND_META[band];
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium', meta.chip)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function ScoreCell({ row }: { row: RiskRow }) {
  return (
    <div>
      <p className="text-[14px] font-semibold tabular-nums text-foreground">{formatPercent(row.score)}</p>
      <Meter value={row.score} fill={BAND_META[row.band].fill} className="mt-1 w-20" />
    </div>
  );
}

function factorLabel(labels: Record<string, string>, feature: string) {
  return labels[feature] || feature;
}

function FactorSummary({ factors, labels }: { factors: RiskFactor[]; labels: Record<string, string> }) {
  if (!factors.length) return <span className="text-[12px] text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5 text-[12px]">
      {factors.slice(0, 2).map((factor) => {
        const up = factor.direction === 'increases_risk';
        const Icon = up ? TrendingUp : TrendingDown;
        return (
          <li key={factor.feature} className="flex items-center gap-1.5 text-muted-foreground">
            <Icon className={cn('h-3.5 w-3.5 shrink-0', up ? 'text-foreground' : 'text-sky-600 dark:text-sky-400')} aria-hidden="true" />
            <span className="sr-only">{up ? 'Làm tăng rủi ro:' : 'Làm giảm rủi ro:'}</span>
            <span className="truncate text-foreground/85">{factorLabel(labels, factor.feature)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Every returned factor with its relative weight; the copy is explicit that this is association, not cause. */
function RiskDetail({ row, config }: { row: RiskRow; config: RiskDomainConfig }) {
  const ref = useRevealOnMount<HTMLDivElement>(4);
  const factors = factorWeights(row.factors);
  return (
    <div ref={ref} className="space-y-3">
      <p className="text-[12.5px] leading-relaxed text-foreground/90">
        Mô hình ước tính khả năng {config.eventNoun} của {config.subjectNoun} này là <strong className="font-semibold">{formatPercent(row.score)}</strong>.
        Đây là xác suất ước tính, không phải kết luận — {config.subjectNoun} vẫn có thể diễn ra bình thường.
      </p>
      {factors.length ? (
        <ul className="max-w-2xl space-y-2" aria-label="Các yếu tố ảnh hưởng mạnh nhất">
          {factors.map((factor) => {
            const up = factor.direction === 'increases_risk';
            const Icon = up ? TrendingUp : TrendingDown;
            return (
              <li key={factor.feature} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,220px)_1fr_auto]">
                <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-foreground">
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', up ? 'text-foreground' : 'text-sky-600 dark:text-sky-400')} aria-hidden="true" />
                  <span className="truncate">{factorLabel(config.factorLabels, factor.feature)}</span>
                </span>
                <span className="order-3 col-span-2 sm:order-none sm:col-span-1">
                  <Meter value={factor.weight} fill={up ? 'bg-foreground/55' : 'bg-sky-500/70'} className="h-2 w-full" />
                </span>
                <span className="text-right text-[11.5px] tabular-nums text-muted-foreground">
                  {up ? 'Làm tăng' : 'Làm giảm'} · {factor.contribution > 0 ? '+' : ''}{factor.contribution.toFixed(2).replace('.', ',')}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Mức ảnh hưởng là phần đóng góp của từng yếu tố vào điểm của mô hình cho riêng {config.subjectNoun} này (trọng số × giá trị đã chuẩn hóa).
        Thanh dài nhất là yếu tố mạnh nhất; đây là mức liên quan trong mô hình, không phải nguyên nhân đã được chứng minh.
      </p>
    </div>
  );
}

export function RiskWorkspace({ config, data, rows, loading, error, onRetry }: {
  config: RiskDomainConfig;
  data: RiskModelData<unknown> | null;
  rows: RiskRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [bandFilter, setBandFilter] = useState<'ALL' | RiskBand>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const wide = useMediaQuery(WIDE_QUERY);
  const Icon = config.icon;

  if (loading && !data) return <Panel><LoadingRows label="Đang chấm điểm rủi ro…" /></Panel>;
  if (error && !data) {
    return <Panel><StateMessage icon={Icon} tone="error" title={`Không thể tải dữ liệu ${config.title.toLowerCase()}`} onRetry={onRetry}>{error}</StateMessage></Panel>;
  }
  if (!data) return null;

  // A model that could not be trained is a valid outcome, not an error - and not "no risk".
  if (data.status === 'INSUFFICIENT_DATA') {
    const reading = describeInsufficientReason(data.reason);
    return (
      <Panel>
        <StateMessage icon={DatabaseZap} tone="notice" title="Chưa đủ dữ liệu để huấn luyện mô hình">
          <p>
            Hệ thống chưa có đủ lịch sử để học {config.eventNoun}, nên không hiển thị dự đoán nào. Điều này không có nghĩa là hiện không có
            {` ${config.subjectNoun}`} rủi ro — chỉ là chưa thể ước tính một cách đáng tin cậy.
          </p>
          {reading ? <p className="text-foreground/85">{reading}</p> : null}
          <p>{config.needs}</p>
          {data.reason ? (
            <p className="text-[11.5px]">Chi tiết kỹ thuật: <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{data.reason}</code></p>
          ) : null}
        </StateMessage>
      </Panel>
    );
  }

  const cutoffs = riskBandCutoffs(data.evaluation);
  const counts: Record<RiskBand, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of rows) counts[row.band] += 1;
  const visible = bandFilter === 'ALL' ? rows : rows.filter((row) => row.band === bandFilter);
  const pastDue = (value: string | null | undefined) => Boolean(value) && new Date(value as string).getTime() < now;
  const bandRange: Record<RiskBand, string> = {
    HIGH: `≥ ${formatPercent(cutoffs.high)}`,
    MEDIUM: `${formatPercent(cutoffs.medium)} – ${formatPercent(cutoffs.high)}`,
    LOW: `< ${formatPercent(cutoffs.medium)}`,
  };

  return (
    <div className="space-y-4">
      {error ? (
        <Panel className="border-red-200 dark:border-red-500/30">
          <StateMessage icon={Icon} tone="error" title="Không thể cập nhật — đang hiển thị kết quả trước đó" onRetry={onRetry}>{error}</StateMessage>
        </Panel>
      ) : null}

      {data.evaluation ? (
        <ModelQuality evaluation={data.evaluation} model={data.model} subjectNoun={config.subjectNoun} eventNoun={config.eventNoun} />
      ) : null}

      <Panel aria-labelledby={`${config.id}-list-title`} className="overflow-hidden">
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div>
            <h2 id={`${config.id}-list-title`} className="text-[14px] font-semibold text-foreground">
              {config.title}
              <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">{formatCount(rows.length)} {config.subjectNoun} đã chấm điểm</span>
            </h2>
            <p className="mt-1 max-w-[95ch] text-[12.5px] leading-relaxed text-muted-foreground">
              {config.modelSummary} Điểm là xác suất ước tính, không phải sự kiện chắc chắn. Nhóm được chia theo ngưỡng của mô hình:
              cao {bandRange.HIGH}, vừa {bandRange.MEDIUM}, thấp {bandRange.LOW}.
            </p>
          </div>
          {rows.length ? (
            <FilterPills
              label="Lọc theo nhóm rủi ro"
              value={bandFilter}
              onChange={setBandFilter}
              options={[
                { value: 'ALL', label: 'Tất cả', count: rows.length, icon: Layers },
                ...RISK_BAND_ORDER.map((band) => ({ value: band, label: BAND_META[band].label, count: counts[band], icon: BAND_META[band].icon, title: `Điểm ${bandRange[band]}` })),
              ]}
            />
          ) : null}
        </div>

        <div aria-busy={loading} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {rows.length === 0 ? (
            <StateMessage icon={Icon} title={config.emptyTitle}>{config.emptyText}</StateMessage>
          ) : visible.length === 0 ? (
            <StateMessage icon={Layers} title="Không có trường hợp nào trong nhóm này" />
          ) : wide ? (
            <div role="region" aria-label={`Bảng ${config.title.toLowerCase()}`} tabIndex={0} className="max-h-[min(72vh,760px)] overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
              <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-[13px]">
                <caption className="sr-only">{config.title}, xếp theo điểm rủi ro giảm dần. Mở từng dòng để xem các yếu tố ảnh hưởng.</caption>
                <thead className="sticky top-0 z-10 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  <tr className="[&>th]:border-b [&>th]:border-border [&>th]:bg-muted/50 [&>th]:py-2.5">
                    <th scope="col" className="pl-4 pr-3">Bạn đọc · sách</th>
                    <th scope="col" className="w-[170px] px-3">{config.toLabel}</th>
                    <th scope="col" className="w-[110px] px-3">Điểm rủi ro</th>
                    <th scope="col" className="w-[130px] px-3">Nhóm</th>
                    <th scope="col" className="w-[230px] px-3">Yếu tố chính</th>
                    <th scope="col" className="w-12 pr-3"><span className="sr-only">Chi tiết</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const open = expanded === row.key;
                    const cell = 'border-b border-border px-3 py-3 align-top';
                    return (
                      <Fragment key={row.key}>
                        <tr className="transition-colors duration-150 hover:bg-muted/35">
                          <td className={cn(cell, 'pl-4')}>
                            <p className="truncate font-semibold text-foreground" title={row.customer}>{row.customer}</p>
                            <p className="truncate text-[12px] text-muted-foreground" title={row.title}>{row.title}</p>
                          </td>
                          <td className={cell}>
                            <p className="tabular-nums text-foreground">{formatDateTime(row.to)}</p>
                            <p className="text-[11.5px] text-muted-foreground">
                              {pastDue(row.to) ? <span className="font-medium text-foreground">{config.pastDueLabel}</span> : `${config.fromLabel} ${formatDateTime(row.from)}`}
                            </p>
                          </td>
                          <td className={cell}><ScoreCell row={row} /></td>
                          <td className={cell}><BandChip band={row.band} /></td>
                          <td className={cell}><FactorSummary factors={row.factors} labels={config.factorLabels} /></td>
                          <td className={cn(cell, 'pr-3 pt-2')}>
                            <button
                              type="button"
                              onClick={() => setExpanded(open ? null : row.key)}
                              aria-expanded={open}
                              aria-controls={`risk-detail-${row.key}`}
                              aria-label={`${open ? 'Ẩn' : 'Xem'} các yếu tố rủi ro của ${row.customer}`}
                              className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                            >
                              <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                        {open ? (
                          <tr id={`risk-detail-${row.key}`}>
                            <td colSpan={6} className="border-b border-border bg-muted/20 px-4 py-4 sm:px-6"><RiskDetail row={row} config={config} /></td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="divide-y divide-border" aria-label={config.title}>
              {visible.map((row) => {
                const open = expanded === row.key;
                return (
                  <li key={row.key} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold leading-snug text-foreground">{row.customer}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{row.title}</p>
                      </div>
                      <div className="shrink-0 text-right"><ScoreCell row={row} /></div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                      <BandChip band={row.band} />
                      <span>{config.toLabel}: <span className="tabular-nums text-foreground">{formatDateTime(row.to)}</span></span>
                      {pastDue(row.to) ? <span className="font-medium text-foreground">· {config.pastDueLabel}</span> : null}
                    </div>
                    <div className="mt-2"><FactorSummary factors={row.factors} labels={config.factorLabels} /></div>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : row.key)}
                      aria-expanded={open}
                      aria-controls={`risk-detail-${row.key}`}
                      className="-ml-2 mt-1 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {open ? 'Ẩn giải thích' : 'Vì sao có điểm này?'}
                      <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                    </button>
                    {open ? <div id={`risk-detail-${row.key}`} className="mt-2"><RiskDetail row={row} config={config} /></div> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}
