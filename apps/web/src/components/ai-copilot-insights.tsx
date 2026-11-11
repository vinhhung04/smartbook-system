import { Fragment, useId, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, CircleDashed, Clock3, Database, HelpCircle, Info, Lightbulb, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AiExplanation, AiExplanationClaim, AiFaithfulness, AiRecommendation } from '@/services/ai';
import { formatDataAsOf } from '@/lib/copilot-visualization';
import { verificationNotice, type AiVerification } from '@/lib/copilot-verification';

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
export function CopilotAnswerText({ text, emphasizeLead = false, part = 'all' }: {
  text: string;
  emphasizeLead?: boolean;
  /** 'lead' = the opening block only, 'rest' = everything after it - so charts
   * can sit between the conclusion and the analysis that reads them. */
  part?: 'all' | 'lead' | 'rest';
}) {
  const blocks = toBlocks(text);
  const shown = part === 'lead' ? blocks.slice(0, 1) : part === 'rest' ? blocks.slice(1) : blocks;
  if (!shown.length) return null;
  const offset = part === 'rest' ? 1 : 0;
  return (
    <div className="space-y-2">
      {shown.map((block, j) => {
        const i = j + offset;
        if (i === 0 && emphasizeLead && block.kind === 'paragraph') {
          return (
            <div key={i} className="rounded-r-lg border-l-[3px] border-primary bg-primary/[0.05] py-2 pl-3.5 pr-3">
              <p className="text-[12px] font-semibold text-primary">Kết luận chính</p>
              <p className="text-[15.5px] font-medium leading-relaxed text-foreground">{renderInline(block.text)}</p>
            </div>
          );
        }
        if (block.kind === 'heading') {
          return (
            <p key={i} className="pt-2 text-[14px] font-semibold text-foreground">
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
  return formatDataAsOf(iso);
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
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-foreground" title={rec.title}>{rec.title}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-primary">
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {rec.action}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {rec.priority && (
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              Ưu tiên: {rec.priority}
            </span>
          )}
          <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${tone}`} title={rec.confidence?.basis}>
            Độ tin cậy dữ liệu: {rec.confidence?.level ?? '—'}
          </span>
        </div>
      </div>
      {rec.metrics.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/70 pt-2.5 sm:grid-cols-4">
          {rec.metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <dt className="truncate text-[11.5px] text-muted-foreground">{metric.label}</dt>
              <dd className="text-[14px] font-semibold tabular-nums text-foreground">{formatMetric(metric.value, metric.unit)}</dd>
            </div>
          ))}
        </dl>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mt-2.5 flex cursor-pointer items-center gap-1 rounded text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        Lý do, rủi ro và nguồn dữ liệu
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 text-[12.5px] leading-relaxed">
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
    <section aria-label="Đề xuất" className="space-y-2">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <Lightbulb className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Đề xuất có căn cứ
      </p>
      <div className="grid gap-2">
        {items.slice(0, 3).map((rec) => <RecommendationCard key={`${rec.title}-${rec.action}`} rec={rec} />)}
      </div>
    </section>
  );
}

// Kinds of statement: each has its own icon and word, so the distinction never
// rests on colour alone. ASSUMPTION/UNKNOWN reach the reader through the
// caveats list, where the backend prefixes them.
const KIND_TAG = {
  FACT: { label: 'Dữ kiện', icon: Database, tone: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300' },
  INFERENCE: { label: 'Suy luận', icon: Lightbulb, tone: 'border-primary/25 bg-primary/[0.07] text-primary' },
  ASSUMPTION: { label: 'Giả định', icon: CircleDashed, tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' },
  UNKNOWN: { label: 'Chưa biết', icon: HelpCircle, tone: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-300' },
} as const;

function KindTag({ kind }: { kind: keyof typeof KIND_TAG }) {
  const { label, icon: Icon, tone } = KIND_TAG[kind];
  return (
    <span className={`mr-1.5 inline-flex items-center gap-0.5 rounded border px-1 py-px align-[1px] text-[11px] font-medium ${tone}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

// The backend prefixes assumptions and unknowns it moved into this list.
const CAVEAT_TAGS: Array<{ prefix: string; kind: 'ASSUMPTION' | 'UNKNOWN' }> = [
  { prefix: 'Giả định: ', kind: 'ASSUMPTION' },
  { prefix: 'Chưa biết: ', kind: 'UNKNOWN' },
];

export function CopilotCaveats({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <section aria-label="Rủi ro và giới hạn" className="rounded-xl border border-border bg-muted/30 px-3.5 py-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Rủi ro và giới hạn
      </p>
      <ul className="space-y-1 text-[13px] leading-relaxed text-foreground">
        {items.map((item) => {
          const tag = CAVEAT_TAGS.find((t) => item.startsWith(t.prefix));
          return (
            <li key={item} className="flex gap-1.5">
              {!tag && <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />}
              <span>
                {tag && <KindTag kind={tag.kind} />}
                {tag ? item.slice(tag.prefix.length) : item}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ClaimItem({ claim }: { claim: AiExplanationClaim }) {
  return (
    <li className="space-y-1.5">
      <p className="text-[13px] leading-relaxed text-foreground">
        <KindTag kind={claim.kind === 'INFERENCE' ? 'INFERENCE' : 'FACT'} />
        {claim.statement}
      </p>
      {claim.meaning && <p className="text-[12.5px] leading-relaxed text-muted-foreground">{claim.meaning}</p>}
      {claim.evidence.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-2.5 py-2 sm:grid-cols-3" aria-label="Số liệu minh chứng">
          {claim.evidence.map((item) => (
            <div key={`${item.label}-${String(item.value)}`} className="min-w-0">
              <dt className="truncate text-[11px] text-muted-foreground" title={item.source ? `${item.label} · ${item.source}` : item.label}>
                {item.label}
              </dt>
              <dd className="text-[13px] font-semibold tabular-nums text-foreground">{formatMetric(item.value, item.unit)}</dd>
            </div>
          ))}
        </dl>
      )}
      {claim.kind === 'INFERENCE' && claim.basis && (
        <p className="text-[11.5px] text-muted-foreground">
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
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <HelpCircle className="h-4 w-4 text-primary" aria-hidden="true" />
          Vì sao AI đưa ra nhận định này?
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
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
        <div id={panelId} className="space-y-4 border-t border-border px-3.5 py-3">
          {reasoning.length > 0 && (
            <ol className="space-y-3">
              {reasoning.map((claim) => <ClaimItem key={`${claim.kind}-${claim.statement}`} claim={claim} />)}
            </ol>
          )}
          {explanation.alternatives.length > 0 && (
            <div>
              <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Phương án thay thế</p>
              <ul className="space-y-1.5">
                {explanation.alternatives.map((alt) => (
                  <li key={alt.option} className="text-[12.5px] leading-relaxed">
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
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
                Bước tiếp theo hợp lý
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-foreground marker:text-muted-foreground">
                {explanation.next_actions.map((step) => <li key={step}>{step}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The verification note under an answer (Copilot 3.2, falling back to the 3.1
 * note for answers stored before it): a quiet "checked against data" line,
 * or what was adjusted / lacks support / could not be verified. */
export function CopilotFaithfulness({ result, verification }: {
  result?: AiFaithfulness | null;
  verification?: AiVerification | null;
}) {
  const notice = verificationNotice(verification, result);
  if (!notice) return null;
  if (notice.tone === 'checked') {
    return (
      <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        {notice.title}
      </p>
    );
  }
  const tone = notice.tone === 'adjusted'
    ? 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200'
    : notice.tone === 'blocked'
      ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';
  return (
    <div role="note" className={`rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed ${tone}`}>
      <p className="flex items-start gap-2 font-semibold">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {notice.title}
      </p>
      {notice.items.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-11">
          {notice.items.map((label) => <li key={label}>{label}</li>)}
        </ul>
      )}
    </div>
  );
}

export function CopilotFollowups({ items, onPick, disabled }: { items: string[]; onPick: (text: string) => void; disabled?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5" role="group" aria-label="Câu hỏi tiếp theo gợi ý">
      <p className="text-[12px] font-medium text-muted-foreground">Hỏi tiếp</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            disabled={disabled}
            className="group inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-left text-[13px] text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {text}
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
          </button>
        ))}
      </div>
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
