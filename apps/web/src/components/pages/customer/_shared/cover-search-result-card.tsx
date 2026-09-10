import { BookCoverPlaceholder } from './book-cover-placeholder';
import { StatusBadge } from './status-badge';
import { CoverSearchCandidate } from '@/services/cover-search';

interface CoverSearchResultCardProps {
  candidate: CoverSearchCandidate;
  onReserve: (candidate: CoverSearchCandidate) => void;
  reserving?: boolean;
}

/** One integrated card per match — confidence lives as a badge on the cover
 * art itself and evidence as a caption line, not a second bordered box
 * stacked underneath BookCard. Two same-shape containers for one result read
 * as two separate things; a reader shouldn't have to reconcile them. */
export function CoverSearchResultCard({ candidate, onReserve, reserving = false }: CoverSearchResultCardProps) {
  const availableStock = Number(candidate.available_quantity ?? candidate.quantity ?? 0);
  const isAvailable = availableStock > 0;
  const canReserve = Boolean(candidate.reservable && isAvailable);
  const stockLabel = isAvailable ? `${availableStock} cuốn sẵn sàng` : 'Hết sách';

  const confidencePct = Math.round(candidate.confidence * 100);
  const confidenceTone =
    confidencePct >= 85 ? 'bg-emerald-500' : confidencePct >= 65 ? 'bg-amber-500' : 'bg-slate-500';

  return (
    <article className="rounded-[14px] border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
      <div className="relative">
        <BookCoverPlaceholder category={candidate.category} title={candidate.title} imageUrl={candidate.cover_image_url} />
        <span
          className={`absolute right-2 top-2 rounded-full ${confidenceTone} px-2 py-0.5 text-[10px] text-white shadow-sm`}
          style={{ fontWeight: 700 }}
        >
          {confidencePct}% khớp
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="max-w-[70%] truncate rounded-[8px] border border-border bg-muted/90 px-2 py-1 text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
          {candidate.category || 'Chưa phân loại'}
        </span>
        <StatusBadge status={isAvailable ? 'ACTIVE' : 'OUT_OF_STOCK'} />
      </div>

      <h3 className="mt-2 line-clamp-2 text-[14px] text-foreground" style={{ fontWeight: 700 }}>
        {candidate.title}
      </h3>
      <p className="mt-1 text-[12px] text-muted-foreground">{candidate.author || 'Không rõ tác giả'}</p>

      {candidate.evidence.length > 0 && (
        <p className="mt-1.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
          {candidate.evidence.map((item) => item.label).join(' · ')}
        </p>
      )}

      <div className={`mt-2 text-[11px] ${isAvailable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
        {stockLabel}
      </div>

      <button
        disabled={!canReserve || reserving}
        onClick={() => onReserve(candidate)}
        className="mt-3 w-full rounded-[10px] bg-indigo-600 px-3 py-2 text-[12px] text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 dark:bg-slate-700 disabled:text-muted-foreground"
        style={{ fontWeight: 600 }}
      >
        {reserving ? 'Đang đặt trước...' : canReserve ? 'Đặt trước' : 'Hết sách'}
      </button>
    </article>
  );
}
