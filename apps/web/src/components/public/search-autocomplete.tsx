import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import axios from 'axios';
import { Search, Sparkles } from 'lucide-react';
import { publicCatalogService, type PublicBook } from '@/services/public-catalog';
import { cn } from '@/components/ui/utils';
import { BookCover } from './book-cover';

const SUGGEST_DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
const MAX_SUGGESTIONS = 6;
const SEE_ALL = '__see-all__';

interface Suggestions {
  q: string;
  books: PublicBook[];
  failed: boolean;
}

interface SearchAutocompleteProps {
  variant?: 'hero' | 'compact';
  placeholder?: string;
  /** Called after any navigation (e.g. to close the mobile menu). */
  onNavigate?: () => void;
}

/**
 * Search box with instant suggestions from the real catalog (ARIA combobox).
 * Enter on a highlighted book opens it; otherwise Enter opens the full results.
 */
export function SearchAutocomplete({ variant = 'compact', placeholder = 'Tên sách, tác giả hoặc ISBN', onNavigate }: SearchAutocompleteProps) {
  const navigate = useNavigate();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  // Highlight is an option identity (book id or SEE_ALL), not an index: results
  // arriving mid-navigation must not silently change what Enter opens.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions>({ q: '', books: [], failed: false });

  const query = value.trim();
  const hero = variant === 'hero';

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debounced.length < MIN_CHARS) return undefined;
    const controller = new AbortController();
    publicCatalogService.getBooks({ q: debounced, pageSize: MAX_SUGGESTIONS, sort: 'relevance' }, controller.signal)
      .then((page) => setSuggestions({ q: debounced, books: page.data, failed: false }))
      .catch((err) => { if (!axios.isCancel(err)) setSuggestions({ q: debounced, books: [], failed: true }); });
    return () => controller.abort();
  }, [debounced]);

  const ready = suggestions.q === query && query.length >= MIN_CHARS;
  const books = ready ? suggestions.books : [];
  // Last option is always "see all results", so the keyboard can reach it too.
  const optionKeys = query.length >= MIN_CHARS ? [...books.map((book) => book.id), SEE_ALL] : [];
  const active = activeKey ? optionKeys.indexOf(activeKey) : -1;
  const showPanel = open && query.length >= MIN_CHARS;

  const go = (path: string) => {
    setOpen(false);
    setActiveKey(null);
    inputRef.current?.blur();
    navigate(path);
    onNavigate?.();
  };
  const searchAll = () => go(query ? `/search?q=${encodeURIComponent(query)}` : '/books');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (active >= 0 && active < books.length) go(`/books/${books[active].id}`);
    else searchAll();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && optionKeys.length) {
      event.preventDefault();
      setOpen(true);
      setActiveKey(optionKeys[(active + 1) % optionKeys.length]);
    } else if (event.key === 'ArrowUp' && optionKeys.length) {
      event.preventDefault();
      setActiveKey(optionKeys[active <= 0 ? optionKeys.length - 1 : active - 1]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveKey(null);
    }
  };

  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  return (
    <form role="search" onSubmit={submit} className={cn('relative w-full', hero && 'max-w-xl')}>
      <div
        className={cn(
          'flex items-center gap-2 border border-border bg-card transition-shadow focus-within:border-indigo-500',
          hero ? 'rounded-xl p-1.5 shadow-sm focus-within:ring-4 focus-within:ring-indigo-500/15' : 'rounded-md focus-within:ring-2 focus-within:ring-indigo-500/20',
        )}
      >
        <Search className={cn('shrink-0 text-muted-foreground', hero ? 'ml-2.5 h-5 w-5' : 'ml-3 h-4 w-4')} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Tìm sách"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(event) => { setValue(event.target.value); setOpen(true); setActiveKey(null); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(
            'min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden',
            hero ? 'h-11 text-[15px]' : 'h-9 pr-3 text-[13px]',
          )}
        />
        {hero ? (
          <button type="submit" className="h-11 shrink-0 rounded-lg bg-indigo-700 px-5 text-[14px] font-semibold text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400">
            Tìm sách
          </button>
        ) : null}
      </div>

      {showPanel ? (
        <div
          // Keep focus in the input while clicking an option.
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            'absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_18px_40px_-16px_rgba(15,23,42,0.35)]',
            !hero && 'min-w-[22rem]',
          )}
        >
          <ul id={listboxId} role="listbox" aria-label="Gợi ý sách" className="max-h-[min(70vh,26rem)] overflow-y-auto py-1.5">
            {!ready ? (
              <li className="px-4 py-3 text-[13px] text-muted-foreground" aria-live="polite">Đang tìm…</li>
            ) : books.length === 0 ? (
              <li className="px-4 py-3 text-[13px] text-muted-foreground" aria-live="polite">
                {suggestions.failed ? 'Chưa tải được gợi ý.' : `Không có tên sách hay tác giả nào khớp “${query}”.`}
              </li>
            ) : (
              books.map((book, index) => (
                <li
                  key={book.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={active === index}
                  onMouseEnter={() => setActiveKey(book.id)}
                  onClick={() => go(`/books/${book.id}`)}
                  className={cn('flex cursor-pointer items-center gap-3 px-3 py-2', active === index && 'bg-muted')}
                >
                  <BookCover title={book.title} author={book.author} imageUrl={book.cover_image_url} className="w-9 shrink-0 rounded-[3px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{book.title}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{book.author || 'Chưa rõ tác giả'}</span>
                  </span>
                  <span className={cn('shrink-0 text-[11.5px]', book.available_quantity > 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                    {book.available_quantity > 0 ? `Còn ${book.available_quantity}` : 'Hết'}
                  </span>
                </li>
              ))
            )}
            <li
              id={optionId(books.length)}
              role="option"
              aria-selected={active === books.length}
              onMouseEnter={() => setActiveKey(SEE_ALL)}
              onClick={searchAll}
              className={cn('mt-1 flex cursor-pointer items-center gap-2 border-t border-border px-4 py-2.5 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300', active === books.length && 'bg-muted')}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" /> Xem tất cả kết quả cho “{query}”
            </li>
          </ul>
          {ready && books.length === 0 && query.length >= 6 ? (
            <button
              type="button"
              onClick={() => go(`/discover?q=${encodeURIComponent(query)}`)}
              className="flex w-full items-center gap-2 border-t border-border bg-indigo-50/60 px-4 py-2.5 text-left text-[12.5px] text-foreground hover:bg-indigo-50 dark:bg-indigo-950/20"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
              Tìm theo ý nghĩa bằng AI: “{query}”
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
