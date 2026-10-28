import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Search, Sparkles } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { SearchAutocomplete } from './search-autocomplete';
import { CoverSearchButton } from './cover-search-button';
import { DISCOVERY_EXAMPLES } from '@/lib/discovery-examples';

type Mode = 'keyword' | 'ai';

interface HeroSearchProps {
  /** Shown under the keyword box as quick links. */
  categories: Array<{ name: string; slug: string }>;
}

/**
 * The hero's one input, two ways to ask: by title/author/ISBN (instant
 * suggestions), or by describing the book in plain words (AI semantic search
 * on /discover, which only returns books the library holds).
 */
export function HeroSearch({ categories }: HeroSearchProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('keyword');
  const [text, setText] = useState('');
  const aiInputRef = useRef<HTMLInputElement>(null);
  const focusOnSwitch = useRef(false);

  // The AI box mounts on switch; move focus into it (but not on first render).
  useEffect(() => {
    if (mode === 'ai' && focusOnSwitch.current) aiInputRef.current?.focus();
  }, [mode]);

  const ask = (value: string) => {
    const q = value.trim();
    if (q.length >= 3) navigate(`/discover?q=${encodeURIComponent(q)}`);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(text);
  };
  const switchTo = (next: Mode) => {
    focusOnSwitch.current = true;
    setMode(next);
  };

  const modeButton = (key: Mode, label: string, icon: typeof Search) => {
    const Icon = icon;
    const active = mode === key;
    return (
      <button
        type="button"
        onClick={() => switchTo(key)}
        aria-pressed={active}
        className={cn(
          'relative z-10 inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60',
          active ? 'text-background' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
      </button>
    );
  };

  // Each mode's panel fades up when it mounts; focus and typed text are never touched by it.
  const panelMotion = 'animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none';

  return (
    <div className="max-w-xl">
      <div role="group" aria-label="Cách tìm sách" className="relative mb-3 inline-grid grid-cols-2 rounded-full bg-muted p-1 ring-1 ring-border">
        {/* The dark pill slides under whichever mode is on. */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-foreground shadow-sm transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            mode === 'ai' && 'translate-x-full',
          )}
        />
        {modeButton('keyword', 'Tên sách, tác giả', Search)}
        {modeButton('ai', 'Mô tả bằng lời (AI)', Sparkles)}
      </div>

      {mode === 'keyword' ? (
        <div key="keyword" className={panelMotion}>
          <SearchAutocomplete variant="hero" addon={<CoverSearchButton />} />
          {categories.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-muted-foreground">Phổ biến:</span>
              {categories.slice(0, 4).map((category) => (
                <Link
                  key={category.slug}
                  to={`/categories/${category.slug}`}
                  className="inline-flex min-h-8 items-center rounded-full bg-card px-3 text-[13px] font-medium text-foreground/85 ring-1 ring-border transition-colors hover:text-indigo-700 hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:text-indigo-300"
                >
                  {category.name}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div key="ai" className={panelMotion}>
          <form onSubmit={submit} className="relative">
            <div className="flex items-center gap-2 rounded-2xl bg-card p-1.5 ring-1 ring-indigo-300 transition-shadow focus-within:ring-2 focus-within:ring-indigo-500 dark:ring-indigo-500/50">
              <Sparkles className="ml-3 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
              <label className="min-w-0 flex-1">
                <span className="sr-only">Mô tả cuốn sách bạn muốn đọc</span>
                <input
                  ref={aiInputRef}
                  type="text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={200}
                  placeholder="Ví dụ: tiểu thuyết nhẹ nhàng về tuổi thơ"
                  className="h-12 w-full bg-transparent text-[15.5px] outline-none placeholder:text-muted-foreground"
                />
              </label>
              <button
                type="submit"
                disabled={text.trim().length < 3}
                className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-indigo-700 px-4 text-[14px] font-semibold text-white transition-[background-color,transform] hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400 sm:px-5"
              >
                Gợi ý <ArrowRight className="hidden h-4 w-4 sm:block" aria-hidden="true" />
              </button>
            </div>
          </form>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            AI tìm theo ý nghĩa trong phần giới thiệu sách và chỉ gợi ý những cuốn thư viện đang có.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Ví dụ cách hỏi">
            {DISCOVERY_EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => ask(example)}
                  className="inline-flex min-h-8 items-center rounded-full bg-card px-3 text-left text-[13px] text-foreground/85 ring-1 ring-border transition-colors hover:text-indigo-700 hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:text-indigo-300"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
