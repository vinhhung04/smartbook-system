import { useRef } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from '@/lib/gsap';
import type { SuggestionGroup } from './model';
import { BookTaskIcon, SmartBookAiMark } from '@/components/ai-experience/smartbook-icons';

function briefingTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `${time} hôm nay` : `${time} ngày ${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}`;
}

// First screen of a new conversation: what the assistant is for, and starter
// questions grouped by management need. Only questions the role can actually
// get answered are passed in (see suggestionGroupsFor).

export interface BriefingCard {
  summary: string;
  createdAt: string;
  onOpen: () => void;
}

export function AssistantEmptyState({ groups, onAsk, disabled, briefing }: {
  groups: SuggestionGroup[];
  onAsk: (question: string) => void;
  disabled?: boolean;
  /** The report the nightly agent left (a pending CREATE_REPORT_DRAFT with no conversation). */
  briefing?: BriefingCard | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // One entrance, on mount only. GSAP owns these nodes - nothing here is a
  // motion/react element - and reduced motion gets the final layout untouched.
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.timeline({ defaults: { ease: EASE_OUT, duration: 0.7 } })
        .from('[data-intro]', { autoAlpha: 0, y: 14, stagger: 0.07 })
        .from('[data-group]', { autoAlpha: 0, y: 10, stagger: 0.06, duration: 0.55 }, '-=0.45');
    });
    return () => mm.revert();
  }, { scope: rootRef });

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-3xl flex-col justify-center py-6 sm:py-10">
      <div className="space-y-4">
        <div className="space-y-2">
          <span data-intro className="mb-1 grid h-11 w-11 place-items-center rounded-[13px] bg-brand-ink dark:ring-1 dark:ring-brand-mist/20" aria-hidden="true">
            <SmartBookAiMark tone="tile" className="h-10 w-10" />
          </span>
          <h2 data-intro className="max-w-[22ch] text-balance font-[family-name:var(--font-display)] text-[28px] font-medium leading-[1.15] tracking-[-0.01em] text-foreground sm:text-[34px]">
            Hôm nay bạn cần quyết định điều gì?
          </h2>
          <p data-intro className="max-w-[60ch] text-pretty text-[14px] leading-relaxed text-muted-foreground">
            Hỏi bằng tiếng Việt về tồn kho, nhu cầu mượn và nhập hàng. Trợ lý tra cứu dữ liệu thật của hệ thống,
            trả lời kèm số liệu, nguồn và kết quả đối chiếu. Mọi hành động đề xuất đều chờ bạn xác nhận.
          </p>
        </div>
      </div>

      {briefing && (
        <button type="button" data-intro onClick={briefing.onOpen}
          className="group mt-7 flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-primary/25 bg-primary/[0.05] px-4 py-3.5 text-left transition-colors hover:border-primary/45 hover:bg-primary/[0.08] active:bg-primary/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-card text-primary ring-1 ring-primary/15">
            <BookTaskIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-medium text-primary">Bản tin trợ lý soạn lúc {briefingTime(briefing.createdAt)}</span>
            <span className="mt-0.5 block truncate text-[14.5px] font-semibold text-foreground">{briefing.summary}</span>
          </span>
          <span className="hidden shrink-0 items-center gap-1 text-[13px] font-medium text-primary sm:inline-flex">
            Xem bản tin
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
          </span>
        </button>
      )}

      <div className="mt-8 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(({ label, icon: Icon, questions }) => (
          <section key={label} data-group aria-label={label} className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </h3>
            <ul className="space-y-1.5">
              {questions.map((question) => (
                <li key={question}>
                  <button type="button" onClick={() => onAsk(question)} disabled={disabled}
                    className="group flex w-full cursor-pointer items-start justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left text-[13.5px] leading-snug text-foreground transition-[border-color,background-color,transform] duration-200 hover:border-primary/35 hover:bg-primary/[0.04] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
                    <span>{question}</span>
                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
