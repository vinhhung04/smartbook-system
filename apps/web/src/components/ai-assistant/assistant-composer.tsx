import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Lightbulb, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from '@/lib/gsap';
import type { SuggestionGroup } from './model';

// The question box. Typing stays possible while an answer streams (the next
// question can be drafted), sending does not: one request at a time, as the
// chat flow requires. No attachment / voice / web-search buttons - the
// assistant API has none of those.

const MAX_HEIGHT = 200;

interface AssistantComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  /** An answer is streaming: block sending, keep typing. */
  sending: boolean;
  /** A conversation is opening: sending now would race the history load. */
  blocked: boolean;
  /** Starter questions, offered once the conversation has begun. */
  suggestions?: SuggestionGroup[];
}

export function AssistantComposer({ value, onChange, onSubmit, sending, blocked, suggestions }: AssistantComposerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const canSend = !sending && !blocked && value.trim().length > 0;

  // Grow with the text up to MAX_HEIGHT, then scroll inside: no layout jump
  // above the box because the thread above simply gets shorter.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.from('[data-composer]', { autoAlpha: 0, y: 12, duration: 0.6, ease: EASE_OUT, delay: 0.1 });
    });
    return () => mm.revert();
  }, { scope: rootRef });

  const submit = () => {
    if (!canSend) return;
    onSubmit(value);
  };

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-3xl">
      <form data-composer
        onSubmit={(event) => { event.preventDefault(); submit(); }}
        className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.14)] transition-[border-color,box-shadow] focus-within:border-primary/45 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_12%,transparent),0_8px_24px_-12px_rgba(15,23,42,0.14)] dark:shadow-none">
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // Vietnamese IMEs (Telex/VNI) compose with Enter: never send mid-composition.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Đặt câu hỏi cho SmartBook AI…"
          aria-label="Câu hỏi cho trợ lý AI"
          aria-describedby="assistant-composer-hint"
          className="block max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-1">
            {suggestions && suggestions.length > 0 && (
              <Popover open={suggestOpen} onOpenChange={setSuggestOpen}>
                <PopoverTrigger asChild>
                  <button type="button"
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                    <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                    Câu hỏi gợi ý
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" className="w-[min(26rem,calc(100vw-2rem))] p-2">
                  {suggestions.map((group) => (
                    <div key={group.label} className="py-1">
                      <p className="px-2 pb-1 text-[11.5px] font-medium text-muted-foreground">{group.label}</p>
                      {group.questions.map((q) => (
                        <button key={q} type="button" disabled={sending || blocked}
                          onClick={() => { setSuggestOpen(false); onSubmit(q); }}
                          className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-[13px] leading-snug text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
                          {q}
                        </button>
                      ))}
                    </div>
                  ))}
                </PopoverContent>
              </Popover>
            )}
            <span id="assistant-composer-hint" className="hidden truncate px-1.5 text-[11.5px] text-muted-foreground sm:inline">
              {sending ? 'Đang trả lời — bạn có thể soạn câu tiếp theo' : 'Enter để gửi · Shift + Enter để xuống dòng'}
            </span>
          </div>
          <button type="submit" disabled={!canSend} aria-label="Gửi câu hỏi" title={sending ? 'Đang trả lời câu trước' : 'Gửi (Enter)'}
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl bg-primary text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-35">
            {sending
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </form>
      <p className="mt-2 px-1 text-center text-[11.5px] text-muted-foreground">
        Câu hỏi phân tích có thể mất 30–120 giây. Hãy kiểm tra số liệu quan trọng trước khi quyết định.
      </p>
    </div>
  );
}
