import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useReducedMotion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { DISCOVERY_EXAMPLES } from '@/lib/discovery-examples';

const TYPE_MS = 45;
const DELETE_MS = 22;
const HOLD_MS = 1800;

/**
 * Placeholder that types each example, holds it, then erases it: it shows how to ask before anyone types.
 * Idea from React Bits `TextType` (github.com/DavidHDev/react-bits, MIT + Commons Clause), reduced to a hook.
 * Stops while `paused` (the field has focus or text) and under reduced motion, where the first example stays.
 */
function useTypingPlaceholder(examples: string[], paused: boolean) {
  const reduce = useReducedMotion();
  const [text, setText] = useState(examples[0] ?? '');

  useEffect(() => {
    if (reduce || paused || examples.length === 0) return undefined;
    let index = 0;
    let length = 0;
    let deleting = false;
    let timer = 0;
    const tick = () => {
      const full = examples[index];
      if (!deleting && length < full.length) length += 1;
      else if (!deleting) deleting = true;
      else if (length > 0) length -= 1;
      else { deleting = false; index = (index + 1) % examples.length; }
      setText(examples[index].slice(0, length));
      const holding = !deleting && length === examples[index].length;
      timer = window.setTimeout(tick, holding ? HOLD_MS : deleting ? DELETE_MS : TYPE_MS);
    };
    timer = window.setTimeout(tick, 400);
    return () => window.clearTimeout(timer);
  }, [reduce, paused, examples]);

  return reduce || paused ? examples[0] ?? '' : text;
}

/** Entry point for "Không biết nên đọc gì?": describe a book, get real books from the catalog. */
export function DiscoveryBox({ headingLevel = 2 }: { headingLevel?: 1 | 2 }) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const placeholder = useTypingPlaceholder(DISCOVERY_EXAMPLES, focused || text.length > 0);
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const go = (value: string) => {
    const q = value.trim();
    if (q.length >= 3) navigate(`/discover?q=${encodeURIComponent(q)}`);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    go(text);
  };

  return (
    <section aria-labelledby="khong-biet-doc-gi" className="relative">
      {/* Soft glow + hairline border in the brand hues: the one "AI" accent on the page. */}
      <div className="pointer-events-none absolute -inset-1 rounded-[1.75rem] bg-gradient-to-r from-indigo-500 via-violet-500 to-amber-400 opacity-20 blur-xl dark:opacity-30" aria-hidden="true" />
      <div className="relative rounded-3xl bg-gradient-to-r from-indigo-500 via-violet-500 to-amber-400 p-px">
        <div className="rounded-[calc(1.5rem-1px)] bg-card px-6 py-8 sm:px-10 sm:py-10">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Gợi ý bằng AI
            </span>
            <Heading id="khong-biet-doc-gi" className="mt-4 font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] sm:text-[38px]">
              Không biết nên đọc gì?
            </Heading>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
              Mô tả cuốn sách bạn muốn bằng lời của mình. SmartBook tìm theo ý nghĩa trong phần giới thiệu sách và chỉ gợi ý những cuốn thư viện đang có.
            </p>
            <form onSubmit={submit} className="mt-6 flex items-center gap-2 rounded-full border border-border bg-background p-1.5 pl-5 shadow-sm focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/15">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Mô tả cuốn sách bạn muốn đọc</span>
                <input
                  type="text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  maxLength={200}
                  placeholder={`Ví dụ: ${placeholder.charAt(0).toLowerCase()}${placeholder.slice(1)}`}
                  className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                />
              </label>
              <button type="submit" disabled={text.trim().length < 3} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-indigo-600 px-5 text-[14px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400">
                Gợi ý cho tôi <ArrowRight className="hidden h-4 w-4 sm:block" aria-hidden="true" />
              </button>
            </form>
            <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Ví dụ cách hỏi">
              {DISCOVERY_EXAMPLES.map((example) => (
                <li key={example}>
                  <button type="button" onClick={() => go(example)} className="rounded-full border border-border bg-background px-3.5 py-1.5 text-[12.5px] text-foreground/80 transition-colors hover:border-indigo-300 hover:text-foreground">
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
