import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Lightbulb, Mic, Square } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from '@/lib/gsap';
import type { SuggestionGroup } from './model';
import { useSpeechInput } from '@/hooks/use-speech-input';
import { cn } from '@/components/ui/utils';

// The question box. Typing stays possible while an answer streams (the next
// question can be drafted), sending does not: one request at a time, as the
// chat flow requires. The only attachment is a book-cover photo (Phase F,
// /vision/identify). Speech goes through the browser's own recogniser and only
// fills the box; the question is still sent by the person.

const MAX_HEIGHT = 200;

interface AssistantComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  /** An answer is streaming: block sending, keep typing. */
  sending: boolean;
  /** Stops the streaming answer; the send button becomes "Dừng" while sending. */
  onStop?: () => void;
  /** A conversation is opening: sending now would race the history load. */
  blocked: boolean;
  /** Starter questions, offered once the conversation has begun. */
  suggestions?: SuggestionGroup[];
  /** Phase F: the photo attach button and the pending-photo preview. */
  attachSlot?: ReactNode;
  previewSlot?: ReactNode;
  /** A photo is pending: sending with an empty question identifies it. */
  allowEmpty?: boolean;
}

export function AssistantComposer({ value, onChange, onSubmit, sending, onStop, blocked, suggestions, attachSlot, previewSlot, allowEmpty }: AssistantComposerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const speechBase = useRef('');
  const speech = useSpeechInput({ onText: (text) => onChange(speechBase.current ? `${speechBase.current} ${text}` : text) });
  const toggleSpeech = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    speechBase.current = value.trim();
    speech.start();
  };
  const canSend = !sending && !blocked && (value.trim().length > 0 || Boolean(allowEmpty));

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
        className="rounded-2xl border border-border bg-card transition-[border-color,box-shadow] focus-within:border-primary/45 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_12%,transparent)]">
        {previewSlot}
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
            {attachSlot}
            {speech.supported && (
              <button type="button" onClick={toggleSpeech} disabled={blocked}
                aria-pressed={speech.listening}
                aria-label={speech.listening ? 'Dừng nói' : 'Nói câu hỏi'}
                title={speech.listening ? 'Dừng nói' : 'Nói câu hỏi (trình duyệt chuyển giọng nói thành chữ)'}
                className={cn('relative grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40',
                  speech.listening ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80')}>
                {speech.listening && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-lg bg-primary/15 motion-reduce:animate-none" />}
                <Mic className="relative h-4 w-4" aria-hidden="true" />
              </button>
            )}
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
              {speech.listening ? 'Đang nghe. Nói xong, kiểm tra lại rồi bấm gửi' : sending ? 'Đang trả lời. Bạn có thể soạn câu tiếp theo hoặc bấm Dừng' : 'Enter để gửi, Shift + Enter để xuống dòng'}
            </span>
          </div>
          {sending && onStop ? (
            <button type="button" onClick={onStop} aria-label="Dừng trả lời" title="Dừng trả lời"
              className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl bg-foreground text-background transition-[opacity,transform] hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" disabled={!canSend} aria-label="Gửi câu hỏi" title={sending ? 'Đang trả lời câu trước' : 'Gửi (Enter)'}
              className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl bg-primary text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-35">
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
      <p className="mt-2 px-1 text-center text-[11.5px] text-muted-foreground">
        Câu hỏi phân tích có thể mất từ 30 đến 120 giây. Hãy kiểm tra số liệu quan trọng trước khi quyết định.
      </p>
    </div>
  );
}
