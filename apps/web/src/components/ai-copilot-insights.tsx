import { Fragment, useState, type ReactNode } from 'react';
import { ChevronDown, Clock3, Info, Lightbulb, ShieldAlert, Sparkles } from 'lucide-react';
import type { AiRecommendation } from '@/services/ai';

// Renders the structured parts of a copilot answer that the backend computes
// from tool data (never from the model): recommendations with their evidence,
// risks and data confidence; caveats; follow-up questions; data timestamp.

/** Inline **bold** and *italic* - the only inline markup the copilot prompt uses. */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; items: string[] };

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[-*•])\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^(?:#{1,4}\s+(.+)|\*\*([^*]+?)\*\*:?)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === 'bullets') last.items.push(bullet[1]);
      else blocks.push({ kind: 'bullets', items: [bullet[1]] });
    } else if (numbered) {
      if (last?.kind === 'numbered') last.items.push(numbered[1]);
      else blocks.push({ kind: 'numbered', items: [numbered[1]] });
    } else if (heading) {
      blocks.push({ kind: 'heading', text: (heading[1] ?? heading[2]).replace(/:$/, '') });
    } else {
      blocks.push({ kind: 'paragraph', text: line });
    }
  }
  return blocks;
}

/** Light markdown for answers: section headings, bullet and numbered lists. */
export function CopilotAnswerText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {toBlocks(text).map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <p key={i} className="pt-1 text-[13px] font-semibold text-foreground">
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.kind === 'bullets') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
              {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ul>
          );
        }
        if (block.kind === 'numbered') {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
              {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ol>
          );
        }
        return <p key={i}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

function formatMetric(value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'number' ? value.toLocaleString('vi-VN') : String(value);
  if (!unit) return text;
  return unit === 'đ' || unit === '₫' ? `${text} ₫` : `${text} ${unit}`;
}

function formatTime(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

const CONFIDENCE_TONE: Record<string, string> = {
  CAO: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400',
  'TRUNG BÌNH': 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400',
  THẤP: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400',
};

function RecommendationCard({ rec }: { rec: AiRecommendation }) {
  const [open, setOpen] = useState(false);
  const tone = CONFIDENCE_TONE[rec.confidence?.level] ?? 'border-border bg-muted/40 text-muted-foreground';
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground" title={rec.title}>{rec.title}</p>
          <p className="text-[12px] text-violet-700 dark:text-violet-400">{rec.action}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {rec.priority && (
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {rec.priority}
            </span>
          )}
          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${tone}`} title={rec.confidence?.basis}>
            Độ tin cậy dữ liệu: {rec.confidence?.level ?? '—'}
          </span>
        </div>
      </div>
      {rec.metrics.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
          {rec.metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{metric.label}</dt>
              <dd className="text-[13px] font-medium tabular-nums text-foreground">{formatMetric(metric.value, metric.unit)}</dd>
            </div>
          ))}
        </dl>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mt-2 flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        Lý do, rủi ro và nguồn dữ liệu
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 text-[12px] leading-relaxed">
          {rec.reason && <p className="text-foreground">{rec.reason}</p>}
          {rec.risks.length > 0 && (
            <ul className="space-y-0.5">
              {rec.risks.map((risk) => (
                <li key={risk} className="flex gap-1.5 text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  {risk}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Cơ sở độ tin cậy: {rec.confidence?.basis ?? '—'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Nguồn: {rec.source}
            {formatTime(rec.retrieved_at) ? ` · truy xuất ${formatTime(rec.retrieved_at)}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

export function CopilotRecommendations({ items }: { items: AiRecommendation[] }) {
  if (!items.length) return null;
  return (
    <section aria-label="Đề xuất" className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
        Đề xuất có căn cứ
      </p>
      <div className="grid gap-2">
        {items.slice(0, 3).map((rec) => <RecommendationCard key={`${rec.title}-${rec.action}`} rec={rec} />)}
      </div>
    </section>
  );
}

export function CopilotCaveats({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <section aria-label="Lưu ý" className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 dark:border-sky-500/20 dark:bg-sky-500/5">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-sky-800 dark:text-sky-300">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        Lưu ý về dữ liệu
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-sky-900 marker:text-sky-400 dark:text-sky-200">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}

export function CopilotFollowups({ items, onPick, disabled }: { items: string[]; onPick: (text: string) => void; disabled?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Câu hỏi tiếp theo gợi ý">
      <Sparkles className="h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
      {items.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          disabled={disabled}
          className="cursor-pointer rounded-full border border-violet-200 bg-violet-50/60 px-3 py-1 text-[12px] text-violet-800 transition-colors hover:border-violet-300 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function CopilotDataAsOf({ iso }: { iso?: string | null }) {
  const formatted = formatTime(iso);
  if (!formatted) return null;
  return (
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <Clock3 className="h-3 w-3" aria-hidden="true" />
      Số liệu truy xuất lúc {formatted}
    </p>
  );
}
