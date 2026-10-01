import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Sparkles } from 'lucide-react';

// Example phrasings only — they show how to ask, they are not results.
const EXAMPLES = [
  'Sách dễ đọc về trí tuệ nhân tạo cho người mới',
  'Tiểu thuyết nhẹ nhàng để đọc cuối tuần',
  'Sách kỹ năng giúp quản lý thời gian',
];

/** Entry point for "Không biết nên đọc gì?": describe a book, get real books from the catalog. */
export function DiscoveryBox() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
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
      {/* Gradient hairline border + soft glow: the one "AI" accent on the page. */}
      <div className="pointer-events-none absolute -inset-1 rounded-[1.75rem] bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400 opacity-20 blur-xl dark:opacity-30" aria-hidden="true" />
      <div className="relative rounded-3xl bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400 p-px">
        <div className="rounded-[calc(1.5rem-1px)] bg-card px-6 py-8 sm:px-10 sm:py-10">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Gợi ý bằng AI
            </span>
            <h2 id="khong-biet-doc-gi" className="mt-4 font-serif text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">
              Không biết nên đọc gì?
            </h2>
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
                  maxLength={200}
                  placeholder="Ví dụ: sách về khởi nghiệp viết dễ hiểu"
                  className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                />
              </label>
              <button type="submit" disabled={text.trim().length < 3} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                Gợi ý cho tôi <ArrowRight className="hidden h-4 w-4 sm:block" aria-hidden="true" />
              </button>
            </form>
            <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Ví dụ cách hỏi">
              {EXAMPLES.map((example) => (
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
