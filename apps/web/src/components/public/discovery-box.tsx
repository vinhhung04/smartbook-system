import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Sparkles } from 'lucide-react';

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
    <section aria-labelledby="khong-biet-doc-gi" className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-6 dark:border-indigo-500/25 dark:bg-indigo-950/20 sm:p-8">
      <div className="max-w-2xl">
        <h2 id="khong-biet-doc-gi" className="flex items-center gap-2 font-serif text-[22px] font-semibold tracking-tight sm:text-[26px]">
          <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
          Không biết nên đọc gì?
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Mô tả cuốn sách bạn muốn bằng lời của mình. SmartBook tìm theo ý nghĩa trong phần giới thiệu sách và chỉ gợi ý những cuốn thư viện đang có.
        </p>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label className="flex-1">
            <span className="sr-only">Mô tả cuốn sách bạn muốn đọc</span>
            <input
              type="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={200}
              placeholder="Ví dụ: sách về khởi nghiệp viết dễ hiểu"
              className="h-11 w-full rounded-md border border-border bg-card px-3 text-[14.5px] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <button type="submit" disabled={text.trim().length < 3} className="h-11 rounded-md bg-indigo-700 px-5 text-[14px] font-semibold text-white hover:bg-indigo-800 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400">
            Gợi ý cho tôi
          </button>
        </form>
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Ví dụ cách hỏi">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button type="button" onClick={() => go(example)} className="rounded-full border border-border bg-background px-3 py-1 text-[12.5px] text-foreground/80 hover:border-indigo-300 hover:text-foreground">
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
