import { useRef } from 'react';
import { ArrowUpRight, LibraryBig } from 'lucide-react';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from '@/lib/gsap';
import type { SuggestionGroup } from './model';

// First screen of a new conversation: what the assistant is for, and starter
// questions grouped by management need. Only questions the role can actually
// get answered are passed in (see suggestionGroupsFor).

export function AssistantEmptyState({ groups, onAsk, disabled }: {
  groups: SuggestionGroup[];
  onAsk: (question: string) => void;
  disabled?: boolean;
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
        <span data-intro className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <LibraryBig className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="space-y-2">
          <p data-intro className="text-[13px] font-medium text-primary">SmartBook AI</p>
          <h2 data-intro className="max-w-[22ch] text-balance font-[family-name:var(--font-display)] text-[28px] font-medium leading-[1.15] tracking-[-0.01em] text-foreground sm:text-[34px]">
            Hôm nay bạn cần quyết định điều gì?
          </h2>
          <p data-intro className="max-w-[60ch] text-pretty text-[14px] leading-relaxed text-muted-foreground">
            Hỏi bằng tiếng Việt về tồn kho, nhu cầu mượn và nhập hàng. Trợ lý tra cứu dữ liệu thật của hệ thống,
            trả lời kèm số liệu, nguồn và kết quả đối chiếu — mọi hành động đề xuất đều chờ bạn xác nhận.
          </p>
        </div>
      </div>

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
                    className="group flex w-full cursor-pointer items-start justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left text-[13.5px] leading-snug text-foreground shadow-xs transition-[border-color,box-shadow,transform] duration-200 hover:border-primary/35 hover:shadow-sm active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
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
