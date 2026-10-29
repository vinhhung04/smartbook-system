import { memo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Check, Copy, FileSearch, LibraryBig, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import type { AiEvidenceItem } from '@/services/ai';
import { verificationNotice } from '@/lib/copilot-verification';
import { EASE_STANDARD } from '@/components/motion-utils';
import { cn } from '@/components/ui/utils';
import {
  CopilotAnswerText,
  CopilotCaveats,
  CopilotDataAsOf,
  CopilotExplanation,
  CopilotFaithfulness,
  CopilotFollowups,
  CopilotRecommendations,
} from '@/components/ai-copilot-insights';
import { CopilotVisualizationNotes, CopilotVisualizations } from '@/components/ai-copilot-visualization';
import { CopilotDecision } from '@/components/ai-copilot-decision';
import { ActionCard } from '@/components/ai-action-card';
import type { AssistantMessage } from './model';

// One turn of the conversation. An assistant answer is laid out as a
// structured brief, not a chat bubble: conclusion -> trust warnings -> key
// figures and charts -> analysis -> tables -> decision and proposed action ->
// recommendations -> basis and limits -> sources/time -> follow-ups.
// Everything shown comes from the backend response as-is.

/** Phase of the answer being streamed, driven only by real stream signals. */
export type StreamPhase = 'waiting' | 'draft' | 'verifying';

function formatPlainValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return value.toLocaleString('vi-VN');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Every evidence item is a citation backing the answer above — numbered like
 * footnotes. The backend returns a flat list with no per-word anchor, so they
 * are numbered in order rather than tied to specific claims in the text. */
function EvidenceCitations({ evidence }: { evidence: AiEvidenceItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const active = openIndex !== null ? evidence[openIndex] : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
          <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
          Bằng chứng số liệu
        </span>
        {evidence.map((item, i) => (
          <button key={i} type="button" aria-expanded={openIndex === i}
            aria-label={`Xem bằng chứng số ${i + 1}: ${item.label}`}
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            className={cn('inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md border px-1.5 text-[11.5px] font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              openIndex === i ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground')}>
            {i + 1}
          </button>
        ))}
      </div>
      {active && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[13px] font-medium text-foreground">{active.label}</span>
            <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">{active.source_type}</span>
          </div>
          <div className="mt-1 text-[15px] font-semibold tabular-nums text-foreground">
            {formatPlainValue(active.value)}
            {active.unit ? <span className="ml-1 text-[12.5px] font-normal text-muted-foreground">{active.unit}</span> : null}
          </div>
          <div className="text-[11.5px] text-muted-foreground">Chỉ số: {active.metric}</div>
          {active.description && <div className="mt-1 text-[12px] text-muted-foreground">{active.description}</div>}
        </div>
      )}
    </div>
  );
}

const PHASES: Array<{ key: StreamPhase | 'done'; label: string }> = [
  { key: 'draft', label: 'Soạn nháp' },
  { key: 'verifying', label: 'Đối chiếu dữ liệu' },
  { key: 'done', label: 'Hoàn tất' },
];

/** Where the answer is, from real stream events only: no tool step is claimed
 * before the backend signals it. */
function StreamProgress({ phase, elapsed }: { phase: StreamPhase; elapsed: number }) {
  const current = phase === 'waiting' ? -1 : PHASES.findIndex((p) => p.key === phase);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
      <ol className="flex items-center gap-1.5" aria-label="Tiến trình trả lời">
        {PHASES.map((p, i) => (
          <li key={p.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-3 bg-border" aria-hidden="true" />}
            <span className={cn('inline-flex items-center gap-1', i === current ? 'font-medium text-foreground' : i < current ? 'text-foreground/70' : 'text-muted-foreground/70')}
              aria-current={i === current ? 'step' : undefined}>
              {i < current ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                : <span className={cn('h-1.5 w-1.5 rounded-full', i === current ? 'bg-primary motion-safe:animate-pulse' : 'bg-border')} aria-hidden="true" />}
              {p.label}
            </span>
          </li>
        ))}
      </ol>
      <span className="tabular-nums text-muted-foreground/80">{elapsed}s</span>
    </div>
  );
}

function AnswerHeader({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary">
          <LibraryBig className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        SmartBook AI
      </span>
      {children}
    </div>
  );
}

function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }, () => toast.error('Không sao chép được câu trả lời.'));
      }}
      aria-label="Sao chép câu trả lời"
      className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? 'Đã sao chép' : 'Sao chép'}
    </button>
  );
}

interface MessageItemProps {
  message: AssistantMessage;
  /** Set only on the answer being streamed. */
  phase: StreamPhase | null;
  elapsed: number;
  isLast: boolean;
  /** Any request is in flight: buttons that would send a new question are disabled. */
  busy: boolean;
  onAsk: (question: string) => void;
  onRetry: () => void;
  onActionConfirmed: (actionId: string, result: unknown) => void;
  onActionCancelled: () => void;
}

function MessageItemImpl({ message, phase, elapsed, isLast, busy, onAsk, onRetry, onActionConfirmed, onActionCancelled }: MessageItemProps) {
  if (message.role === 'user') {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE_STANDARD }}
        className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[14.5px] leading-relaxed text-foreground sm:max-w-[75%]">
          <span className="sr-only">Bạn hỏi: </span>
          {message.content}
        </p>
      </motion.div>
    );
  }

  const streaming = phase !== null;

  if (phase === 'waiting') {
    return (
      <motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} aria-label="Câu trả lời đang được chuẩn bị">
        <AnswerHeader>
          <StreamProgress phase={phase} elapsed={elapsed} />
        </AnswerHeader>
        <div className="space-y-2 pl-8" aria-hidden="true">
          <span className="block h-3 w-[78%] rounded bg-muted motion-safe:animate-pulse" />
          <span className="block h-3 w-[62%] rounded bg-muted motion-safe:animate-pulse" />
          <span className="block h-3 w-[40%] rounded bg-muted motion-safe:animate-pulse" />
        </div>
        <p className="mt-3 pl-8 text-[12.5px] text-muted-foreground">
          {elapsed < 45
            ? 'Trợ lý đang tra cứu dữ liệu và soạn câu trả lời.'
            : 'Vẫn đang xử lý — câu hỏi phân tích nhiều bước có thể mất đến khoảng 2 phút.'}
        </p>
      </motion.article>
    );
  }

  if (message.isError) {
    return (
      <article aria-label="Lỗi khi trả lời">
        <AnswerHeader />
        <div className="ml-8 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
          <p className="flex items-start gap-2 text-[13.5px] leading-relaxed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {message.content}
          </p>
          {isLast && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
              <button type="button" onClick={onRetry} disabled={busy}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[12.5px] font-medium text-rose-700 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/40 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-500/15">
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                Gửi lại câu hỏi
              </button>
              <span className="text-[12px] opacity-80">Nếu lỗi lặp lại, kiểm tra kết nối hoặc thử câu hỏi ngắn hơn.</span>
            </div>
          )}
        </div>
      </article>
    );
  }

  // Text and charts interleave only once the answer is final: the conclusion,
  // then KPIs/charts, then the analysis, then tables.
  const visuals = streaming ? [] : message.visualizations ?? [];
  const leadVisuals = visuals.filter((v) => v.type !== 'table');
  const tableVisuals = visuals.filter((v) => v.type === 'table');
  const splitAnswer = visuals.length > 0;
  const notice = streaming ? null : verificationNotice(message.verification, message.faithfulness);
  const hasRetrievalWarnings = Boolean(message.retrievalWarnings && message.retrievalWarnings.length > 0);
  const caveats = message.caveats ?? [];
  const showCitations = Boolean(message.evidence && message.evidence.length > 0 && !message.explanation?.display);
  const hasBasis = !streaming && (Boolean(message.explanation?.display) || caveats.length > 0 || showCitations);

  return (
    <motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
      aria-label={streaming ? 'Câu trả lời đang soạn' : 'Câu trả lời của trợ lý'}
      aria-busy={streaming || undefined}>
      <AnswerHeader>
        {phase && <StreamProgress phase={phase} elapsed={elapsed} />}
        {!streaming && message.fromHistory && (
          <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">Từ lịch sử</span>
        )}
      </AnswerHeader>

      <div className="space-y-4 sm:pl-8">
        <div className={cn('max-w-[72ch] text-[14.5px] leading-[1.7]', streaming ? 'text-foreground/70' : 'text-foreground')}>
          <CopilotAnswerText
            text={message.content}
            part={splitAnswer ? 'lead' : 'all'}
            emphasizeLead={!streaming && Boolean(message.explanation?.display)}
          />
          {streaming && (
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] bg-primary motion-safe:animate-pulse" aria-hidden="true" />
          )}
          {streaming && (
            // The streamed text is a draft: the verified answer replaces it when done.
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="copilot-draft-status">
              <span className="rounded border border-dashed border-border px-1.5 py-px text-[11px] font-medium">Nháp</span>
              {phase === 'verifying'
                ? 'Đang đối chiếu với dữ liệu…'
                : 'Bản nháp — sẽ được đối chiếu với dữ liệu trước khi hoàn tất'}
            </p>
          )}
        </div>

        {/* Trust warnings sit right under the conclusion: they change how every figure below should be read. */}
        {notice && notice.tone !== 'checked' && (
          <CopilotFaithfulness result={message.faithfulness} verification={message.verification} />
        )}
        {(message.groundingWarning || hasRetrievalWarnings) && (
          <div className="flex gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">
                {message.groundingWarning ||
                  'Một số số liệu trong câu trả lời chưa khớp hoàn toàn với dữ liệu tra cứu được. Vui lòng đối chiếu lại trước khi sử dụng.'}
              </p>
              {hasRetrievalWarnings && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {message.retrievalWarnings!.map((warning, i) => <li key={i}>{warning}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {splitAnswer && (
          <>
            <CopilotVisualizations items={leadVisuals} onAsk={onAsk} disabled={busy} snapshot={message.fromHistory} />
            <div className="max-w-[72ch] text-[14.5px] leading-[1.7] text-foreground">
              <CopilotAnswerText text={message.content} part="rest" />
            </div>
            <CopilotVisualizations items={tableVisuals} onAsk={onAsk} disabled={busy} snapshot={message.fromHistory} />
            {message.fromHistory && (
              <p className="text-[12px] italic text-muted-foreground">
                Biểu đồ hiển thị dữ liệu tại thời điểm trả lời (xem mốc thời gian ở từng biểu đồ), không tự cập nhật.
              </p>
            )}
          </>
        )}
        {!streaming && message.visualizationNotes && message.visualizationNotes.length > 0 && (
          <CopilotVisualizationNotes notes={message.visualizationNotes} />
        )}

        {!streaming && (
          <CopilotDecision decision={message.decision} onDraft={isLast ? onAsk : undefined} disabled={busy} />
        )}
        {message.pendingAction && (
          <ActionCard action={message.pendingAction} onConfirmed={onActionConfirmed} onCancelled={onActionCancelled} />
        )}
        {!streaming && message.recommendations && message.recommendations.length > 0 && (
          <CopilotRecommendations items={message.recommendations} />
        )}

        {hasBasis && (
          <section aria-label="Cơ sở và giới hạn của câu trả lời" className="space-y-3">
            <CopilotExplanation explanation={message.explanation} />
            {caveats.length > 0 && <CopilotCaveats items={caveats} />}
            {showCitations && <EvidenceCitations evidence={message.evidence!} />}
          </section>
        )}

        {!streaming && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 pt-2.5">
            {notice?.tone === 'checked' && <CopilotFaithfulness result={message.faithfulness} verification={message.verification} />}
            <CopilotDataAsOf iso={message.dataAsOf} />
            {message.content && (
              <span className="ml-auto">
                <CopyAnswer text={message.content} />
              </span>
            )}
          </div>
        )}

        {isLast && !busy && message.followups && message.followups.length > 0 && (
          <CopilotFollowups items={message.followups} onPick={onAsk} disabled={busy} />
        )}
      </div>
    </motion.article>
  );
}

/** Memoised: while an answer streams only the last message re-renders per token. */
export const MessageItem = memo(MessageItemImpl);
