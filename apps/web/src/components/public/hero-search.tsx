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
          'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
          active
            ? key === 'ai'
              ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm'
              : 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
      </button>
    );
  };

  return (
    <div className="max-w-xl">
      <div role="group" aria-label="Cách tìm sách" className="mb-3 inline-flex rounded-full border border-border bg-card/80 p-1 backdrop-blur">
        {modeButton('keyword', 'Tên sách, tác giả', Search)}
        {modeButton('ai', 'Mô tả bằng lời (AI)', Sparkles)}
      </div>

      {mode === 'keyword' ? (
        <>
          <SearchAutocomplete variant="hero" addon={<CoverSearchButton />} />
          {categories.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-muted-foreground">Phổ biến:</span>
              {categories.slice(0, 4).map((category) => (
                <Link
                  key={category.slug}
                  to={`/categories/${category.slug}`}
                  className="rounded-full border border-border bg-card/80 px-3 py-1 text-[12.5px] font-medium text-foreground/85 backdrop-blur transition-colors hover:border-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-300"
                >
                  {category.name}
                </Link>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <form onSubmit={submit} className="relative rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400 p-px shadow-sm">
            <div className="flex items-center gap-2 rounded-[calc(0.75rem-1px)] bg-card p-1.5 focus-within:ring-4 focus-within:ring-indigo-500/15">
              <Sparkles className="ml-2.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden="true" />
              <label className="min-w-0 flex-1">
                <span className="sr-only">Mô tả cuốn sách bạn muốn đọc</span>
                <input
                  ref={aiInputRef}
                  type="text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={200}
                  placeholder="Ví dụ: tiểu thuyết nhẹ nhàng về tuổi thơ"
                  className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                />
              </label>
              <button
                type="submit"
                disabled={text.trim().length < 3}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-4 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 disabled:opacity-40 sm:px-5"
              >
                Gợi ý <ArrowRight className="hidden h-4 w-4 sm:block" aria-hidden="true" />
              </button>
            </div>
          </form>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            AI tìm theo ý nghĩa trong phần giới thiệu sách và chỉ gợi ý những cuốn thư viện đang có.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Ví dụ cách hỏi">
            {DISCOVERY_EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => ask(example)}
                  className="rounded-full border border-border bg-card/80 px-3 py-1 text-[12.5px] text-foreground/85 backdrop-blur transition-colors hover:border-violet-300 hover:text-violet-700 dark:hover:text-violet-300"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
