import { useState } from 'react';
import { BookOpen, ChevronDown, ScanSearch } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import type { BookRecognition, RecognitionCandidate } from '@/services/ai-experience';

// The result of a cover photo: what was recognised, on what evidence, and -
// when several books are possible - a choice the user makes (never a silent
// pick). Scores are shown as similarity / match scores, never as a chance of
// being right: none of them is calibrated as a probability.

const STATUS_TEXT: Record<BookRecognition['status'], { label: string; tone: string }> = {
  IDENTIFIED: { label: 'Đã nhận diện', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900' },
  AMBIGUOUS: { label: 'Cần bạn chọn đúng sách', tone: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900' },
  NO_MATCH: { label: 'Không đủ bằng chứng để nhận diện', tone: 'bg-slate-100 text-slate-800 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700' },
};
const BASIS: Record<RecognitionCandidate['match_basis'], string> = {
  BOTH_SIGNALS: 'Khớp chữ trên bìa + hình ảnh bìa',
  TEXT_ONLY: 'Khớp chữ trên bìa',
  VISUAL_ONLY: 'Khớp hình ảnh bìa',
};

function Candidate({ c, choosable, chosen, onChoose }: {
  c: RecognitionCandidate; choosable: boolean; chosen: boolean; onChoose?: (c: RecognitionCandidate) => void;
}) {
  const avail = c.availability;
  return (
    <li className={cn('flex gap-2.5 rounded-lg border p-2', chosen ? 'border-primary/60 bg-primary/5' : 'border-border bg-card')}>
      {c.cover_image_url ? (
        // Some sources (Google Books) return http:// cover URLs, which the CSP's https-only img-src blocks.
        <img src={c.cover_image_url.replace(/^http:\/\//i, 'https://')} alt={`Bìa sách ${c.title ?? ''}`} className="h-16 w-11 shrink-0 rounded object-cover" loading="lazy" />
      ) : (
        <div className="grid h-16 w-11 shrink-0 place-items-center rounded bg-muted" aria-hidden="true">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[12.5px] font-semibold leading-snug text-foreground">{c.title}</p>
        {c.authors.length > 0 && <p className="truncate text-[11.5px] text-muted-foreground">{c.authors.join(', ')}</p>}
        <p className="text-[11px] text-muted-foreground">
          {[c.isbn && `ISBN ${c.isbn}`, c.publisher].filter(Boolean).join(' · ')}
        </p>
        <p className="text-[11px] text-foreground/80">
          {BASIS[c.match_basis]}
          {c.visual_similarity != null && ` · tương đồng ảnh ${c.visual_similarity.toFixed(2)}`}
          {c.text_match_score != null && ` · điểm khớp chữ ${c.text_match_score.toFixed(2)}`}
        </p>
        {avail ? (
          <p className="text-[11px] text-foreground">
            {avail.available_quantity ? `${avail.available_quantity} bản sẵn sàng` : 'Hiện chưa có bản sẵn sàng'}
            {avail.branches.length > 0 && ` — ${avail.branches.map((b) => `${b.name}: ${b.available_quantity}`).join('; ')}`}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {choosable && onChoose && (
            <button type="button" onClick={() => onChoose(c)} aria-pressed={chosen}
              className="inline-flex h-7 cursor-pointer items-center rounded-md bg-primary px-2.5 text-[11.5px] font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {chosen ? 'Đã chọn' : 'Đúng sách này'}
            </button>
          )}
          <a href={`/books/${c.book_id}`} target="_blank" rel="noreferrer"
            className="text-[11.5px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            Xem chi tiết
          </a>
        </div>
      </div>
    </li>
  );
}

export function BookRecognitionCard({ recognition, chosenBookId, onChoose, onRetake }: {
  recognition: BookRecognition;
  chosenBookId?: string | null;
  onChoose?: (candidate: RecognitionCandidate) => void;
  onRetake?: () => void;
}) {
  const [why, setWhy] = useState(false);
  const status = STATUS_TEXT[recognition.status];
  const shown = recognition.status === 'IDENTIFIED' ? recognition.candidates.slice(0, 1) : recognition.candidates;
  const expl = recognition.explanation;
  return (
    <section aria-label="Kết quả nhận diện ảnh bìa" className="mt-1.5 w-full space-y-2 rounded-xl border border-border bg-card p-2.5">
      <div className="flex items-center gap-2">
        <ScanSearch className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', status.tone)}>{status.label}</span>
      </div>
      {(recognition.ocr.title || recognition.ocr.author) && (
        <p className="text-[11.5px] text-muted-foreground">
          Chữ đọc được trên bìa: {[recognition.ocr.title, recognition.ocr.author].filter(Boolean).join(' — ')}
        </p>
      )}
      {shown.length > 0 ? (
        <ul className="space-y-1.5">
          {shown.map((c) => (
            <Candidate key={c.book_id} c={c} choosable={recognition.status === 'AMBIGUOUS'}
              chosen={chosenBookId === c.book_id} onChoose={onChoose} />
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-foreground">
          Không tìm thấy sách khớp trong thư viện. Bạn có thể chụp lại rõ phần tên sách, hoặc tìm theo tên/ISBN.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why}
          className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">
          Vì sao có kết quả này?
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform motion-reduce:transition-none', why && 'rotate-180')} aria-hidden="true" />
        </button>
        {onRetake && recognition.status !== 'IDENTIFIED' && (
          <button type="button" onClick={onRetake}
            className="cursor-pointer text-[11.5px] font-medium text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            Thử ảnh khác
          </button>
        )}
      </div>
      {why && (
        <div className="space-y-1.5 rounded-lg bg-muted/50 p-2 text-[11.5px] leading-relaxed text-foreground">
          {expl.facts.length > 0 && <List title="Dữ kiện từ OCR / so khớp ảnh / danh mục" items={expl.facts} />}
          {expl.inferences.length > 0 && <List title="Kết luận theo quy tắc" items={expl.inferences} />}
          {expl.unknowns.length > 0 && <List title="Chưa xác định" items={expl.unknowns} />}
          <List title="Giới hạn" items={expl.limitations} muted />
        </div>
      )}
    </section>
  );
}

function List({ title, items, muted }: { title: string; items: string[]; muted?: boolean }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className={cn('ml-4 list-disc', muted && 'text-muted-foreground')}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
