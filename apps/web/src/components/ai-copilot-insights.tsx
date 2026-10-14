import { Fragment, useId, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, Clock3, HelpCircle, Info, Lightbulb, ShieldAlert, Sparkles } from 'lucide-react';
import type { AiExplanation, AiExplanationClaim, AiRecommendation } from '@/services/ai';

// Renders the structured parts of a copilot answer that the backend computes
// from tool data (never from the model): recommendations with their evidence,
// risks and data confidence; the "why" explanation; risks and limits;
// follow-up questions; data timestamp.

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

/** Light markdown for answers: section headings, bullet and numbered lists.
 * `emphasizeLead` marks the opening paragraph as the key conclusion (the
 * prompt makes the first sentence the conclusion) - used for analytical
 * answers, so the conclusion is not repeated in a separate box. */
export function CopilotAnswerText({ text, emphasizeLead = false }: { text: string; emphasizeLead?: boolean }) {
  return (
    <div className="space-y-2">
      {toBlocks(text).map((block, i) => {
        if (i === 0 && emphasizeLead && block.kind === 'paragraph') {
          return (
            <div key={i} className="border-l-2 border-violet-400 pl-2.5 dark:border-violet-500">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">Kết luận chính</p>
              <p className="font-medium text-foreground">{renderInline(block.text)}</p>
            </div>
          );
        }
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

// The backend prefixes assumptions and unknowns it moved into this list.
const CAVEAT_TAGS: Array<{ prefix: string; label: string; tone: string }> = [
  { prefix: 'Giả định: ', label: 'Giả định', tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' },
  { prefix: 'Chưa biết: ', label: 'Chưa biết', tone: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-300' },
];

export function CopilotCaveats({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <section aria-label="Rủi ro và giới hạn" className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 dark:border-sky-500/20 dark:bg-sky-500/5">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-sky-800 dark:text-sky-300">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        Rủi ro và giới hạn
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-sky-900 marker:text-sky-400 dark:text-sky-200">
        {items.map((item) => {
          const tag = CAVEAT_TAGS.find((t) => item.startsWith(t.prefix));
          return (
            <li key={item}>
              {tag && (
                <span className={`mr-1.5 inline-block rounded border px-1 py-px text-[10px] font-medium ${tag.tone}`}>{tag.label}</span>
              )}
              {tag ? item.slice(tag.prefix.length) : item}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const CLAIM_KIND: Record<'FACT' | 'INFERENCE', { label: string; tone: string }> = {
  INFERENCE: { label: 'Suy luận', tone: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300' },
  FACT: { label: 'Dữ kiện', tone: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300' },
};

function ClaimItem({ claim }: { claim: AiExplanationClaim }) {
  const kind = CLAIM_KIND[claim.kind as 'FACT' | 'INFERENCE'];
  return (
    <li className="space-y-1">
      <p className="text-[12px] leading-relaxed text-foreground">
        <span className={`mr-1.5 inline-block rounded border px-1 py-px align-[1px] text-[10px] font-medium ${kind.tone}`}>{kind.label}</span>
        {claim.statement}
      </p>
      {claim.meaning && <p className="text-[12px] leading-relaxed text-muted-foreground">{claim.meaning}</p>}
      {claim.evidence.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-md bg-muted/40 px-2 py-1.5 sm:grid-cols-3" aria-label="Số liệu minh chứng">
          {claim.evidence.map((item) => (
            <div key={`${item.label}-${String(item.value)}`} className="min-w-0">
              <dt className="truncate text-[10px] text-muted-foreground" title={item.source ? `${item.label} · ${item.source}` : item.label}>
                {item.label}
              </dt>
              <dd className="text-[12px] font-medium tabular-nums text-foreground">{formatMetric(item.value, item.unit)}</dd>
            </div>
          ))}
        </dl>
      )}
      {claim.kind === 'INFERENCE' && claim.basis && (
        <p className="text-[11px] text-muted-foreground">
          Mức chắc chắn {claim.certainty ?? '—'} · Cơ sở: {claim.basis}
        </p>
      )}
    </li>
  );
}

/** "Vì sao AI đưa ra nhận định này?" - the backend's reasoning chain (suy luận
 * and the dữ kiện behind them, each with its figures), alternatives and next
 * steps. Assumptions and unknowns are shown in "Rủi ro và giới hạn" instead,
 * so nothing appears twice. Collapsed by default. */
export function CopilotExplanation({ explanation }: { explanation?: AiExplanation | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!explanation?.display) return null;
  const reasoning = explanation.claims.filter((c) => c.kind === 'INFERENCE' || c.kind === 'FACT');
  if (!reasoning.length && !explanation.alternatives.length && !explanation.next_actions.length) return null;
  const inferences = explanation.counts?.INFERENCE ?? 0;
  const facts = explanation.counts?.FACT ?? 0;
  const tone = explanation.certainty ? CONFIDENCE_TONE[explanation.certainty] : undefined;
  return (
    <section className="rounded-xl border border-border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <HelpCircle className="h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
          Vì sao AI đưa ra nhận định này?
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {inferences > 0 && <span>{inferences} suy luận</span>}
          {inferences > 0 && facts > 0 && <span aria-hidden="true">·</span>}
          {facts > 0 && <span>{facts} dữ kiện</span>}
          {tone && (
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
              Mức chắc chắn: {explanation.certainty}
            </span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div id={panelId} className="space-y-3 border-t border-border px-3 py-2.5">
          {reasoning.length > 0 && (
            <ol className="space-y-2.5">
              {reasoning.map((claim) => <ClaimItem key={`${claim.kind}-${claim.statement}`} claim={claim} />)}
            </ol>
          )}
          {explanation.alternatives.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Phương án thay thế</p>
              <ul className="space-y-1.5">
                {explanation.alternatives.map((alt) => (
                  <li key={alt.option} className="text-[12px] leading-relaxed">
                    <span className="font-medium text-foreground">{alt.option}</span>
                    <span className="text-foreground"> — {alt.outcome}</span>
                    <span className="block text-muted-foreground">{alt.tradeoff}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {explanation.next_actions.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
                Bước tiếp theo hợp lý
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-foreground marker:text-muted-foreground">
                {explanation.next_actions.map((step) => <li key={step}>{step}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
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
