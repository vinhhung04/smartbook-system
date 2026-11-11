import { useState } from 'react';
import { ChevronDown, Gauge } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import type { RiskModelEvaluation, RiskModelInfo } from '@/services/analytics';
import { formatCount, formatDateTime, formatPercent } from '@/lib/reorder-intelligence';
import { Panel } from './primitives';

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-semibold tabular-nums text-foreground">{value}</dd>
      <dd className="text-[11px] leading-snug text-muted-foreground">{hint}</dd>
    </div>
  );
}

/**
 * How far the model can be trusted, in its own test numbers. No "good / bad"
 * verdicts: only what each number means, plus the two fixed reference points
 * the metrics have by definition (AUC 0.5 and lift 1x are chance level).
 */
export function ModelQuality({ evaluation, model, subjectNoun, eventNoun }: {
  evaluation: RiskModelEvaluation;
  model?: RiskModelInfo;
  /** e.g. "khoản mượn" */
  subjectNoun: string;
  /** e.g. "trả trễ" */
  eventNoun: string;
}) {
  const [open, setOpen] = useState(false);
  const lift = evaluation.lift.find((entry) => entry.k === 50) ?? evaluation.lift[0];
  const threshold = evaluation.best_threshold;

  return (
    <Panel aria-labelledby="model-quality-title" className="px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="model-quality-title" className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Độ tin cậy của mô hình
        </h3>
        <p className="text-[11.5px] text-muted-foreground">
          Kiểm tra trên {formatCount(evaluation.samples)} {subjectNoun} gần nhất ({formatCount(evaluation.positives)} {eventNoun})
          {model ? ` · huấn luyện trên ${formatCount(model.train_size)} trường hợp trước đó` : ''}
          {model?.trained_at ? ` · ${formatDateTime(model.trained_at)}` : ''}
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="AUC" value={evaluation.auc !== null ? evaluation.auc.toFixed(2).replace('.', ',') : '—'} hint="khả năng xếp hạng; 0,5 = ngẫu nhiên" />
        <Metric label="Precision" value={formatPercent(threshold.precision)} hint="nhóm cao thực sự xảy ra" />
        <Metric label="Recall" value={formatPercent(threshold.recall)} hint="ca thực tế được xếp nhóm cao" />
        <Metric label="Tỷ lệ nền" value={evaluation.base_rate !== null ? formatPercent(evaluation.base_rate, 1) : '—'} hint={`tỷ lệ ${eventNoun} thực tế`} />
        {lift ? (
          <Metric
            label={`Lift @top-${lift.k}`}
            value={lift.lift !== null ? `${lift.lift.toFixed(1).replace('.', ',')}x` : '—'}
            hint="so với chọn ngẫu nhiên (1x)"
          />
        ) : null}
      </dl>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="model-quality-explain"
        className="mt-3 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        Các chỉ số này nghĩa là gì?
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <ul id="model-quality-explain" className="mt-1 max-w-[95ch] list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-muted-foreground">
          <li>
            Mô hình được đánh giá trên các {subjectNoun} gần nhất theo thời gian mà nó chưa thấy khi huấn luyện, nên các số dưới đây
            phản ánh dữ liệu quá khứ của thư viện — không bảo đảm cho từng trường hợp mới.
          </li>
          <li><strong className="font-medium text-foreground">AUC</strong>: xác suất mô hình chấm điểm một trường hợp {eventNoun} thật cao hơn một trường hợp không {eventNoun}, chọn ngẫu nhiên. 0,5 tương đương đoán ngẫu nhiên.</li>
          <li>
            <strong className="font-medium text-foreground">Precision / Recall / F1</strong> tính tại ngưỡng nhóm “nguy cơ cao” {formatPercent(threshold.threshold)}
            (ngưỡng cho F1 cao nhất trên tập kiểm tra). Precision {formatPercent(threshold.precision)}: trong các {subjectNoun} bị xếp nhóm cao, tỷ lệ đó thực sự {eventNoun}.
            Recall {formatPercent(threshold.recall)}: trong các {subjectNoun} thực sự {eventNoun}, tỷ lệ đó được xếp nhóm cao. F1 {formatPercent(threshold.f1)} cân bằng hai chỉ số.
          </li>
          {lift ? (
            <li>
              <strong className="font-medium text-foreground">Lift @top-{lift.k}</strong>: trong {lift.k} trường hợp có điểm cao nhất, tỷ lệ {eventNoun} là {formatPercent(lift.precision_at_k)},
              so với tỷ lệ chung {formatPercent(lift.base_rate, 1)}.
            </li>
          ) : null}
          {evaluation.brier !== null ? (
            <li><strong className="font-medium text-foreground">Brier</strong> {evaluation.brier.toFixed(3).replace('.', ',')}: sai số bình phương giữa xác suất dự đoán và kết quả thật — càng thấp, xác suất càng sát thực tế.</li>
          ) : null}
        </ul>
      ) : null}
    </Panel>
  );
}
