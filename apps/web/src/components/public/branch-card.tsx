import { Link } from 'react-router';
import { ArrowRight, Clock, MapPin, Navigation, Phone } from 'lucide-react';
import type { PublicBranch } from '@/services/public-catalog';
import { branchBooksUrl } from '@/lib/branch-links';
import { BranchStatus } from './branch-status';

const numberFormat = new Intl.NumberFormat('vi-VN');

/** Opens the address in the reader's maps app (a plain search link: no API key, no tracking script). */
function directionsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** One branch: where it is, when it opens, what is on its shelves. Used on /branches and the home page. */
export function BranchCard({ branch, headingLevel = 'h2' }: { branch: PublicBranch; headingLevel?: 'h2' | 'h3' }) {
  const { stats } = branch;
  const Heading = headingLevel;
  return (
    <article aria-labelledby={`chi-nhanh-${branch.id}`} className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <Heading id={`chi-nhanh-${branch.id}`} className="font-serif text-[22px] font-semibold leading-tight tracking-tight">{branch.name}</Heading>
        <span className="shrink-0"><BranchStatus /></span>
      </div>
      <p className="mt-3 flex gap-2 text-[13.5px] leading-relaxed text-foreground/80">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {branch.address ? <span>{branch.address}</span> : <span className="text-muted-foreground">Địa chỉ đang được cập nhật</span>}
      </p>
      {branch.opening_hours ? (
        <p className="mt-1.5 flex gap-2 text-[13px] leading-relaxed text-foreground/80">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span><span className="sr-only">Giờ mở cửa: </span>{branch.opening_hours}</span>
        </p>
      ) : null}
      {branch.phone ? (
        <p className="mt-1.5 flex gap-2 text-[13px] text-foreground/80">
          <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <a href={`tel:${branch.phone.replace(/[^0-9+]/g, '')}`} className="hover:underline">{branch.phone}</a>
        </p>
      ) : null}

      {stats.title_count > 0 ? (
        <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <div>
            <dt className="text-[12px] text-muted-foreground">Đầu sách</dt>
            <dd className="mt-0.5 font-serif text-[24px] font-semibold tabular-nums">{numberFormat.format(stats.title_count)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Có sẵn để mượn</dt>
            <dd className="mt-0.5 font-serif text-[24px] font-semibold tabular-nums">{numberFormat.format(stats.available_title_count)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-5 border-t border-border pt-4 text-[13.5px] text-muted-foreground">Chi nhánh chưa có sách trên kệ.</p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-6">
        {stats.title_count > 0 ? (
          <Link
            to={branchBooksUrl(branch)}
            className="group inline-flex h-10 items-center gap-1.5 rounded-full bg-indigo-700 px-4 text-[13.5px] font-semibold text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            aria-label={`Xem sách tại ${branch.name}`}
          >
            Xem sách tại chi nhánh <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        ) : null}
        <Link
          to={`/branches/${branch.id}`}
          className="inline-flex h-10 items-center rounded-full px-4 text-[13.5px] font-semibold text-foreground ring-1 ring-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
          aria-label={`Xem chi tiết ${branch.name}`}
        >
          Xem chi tiết
        </Link>
        {branch.address ? (
          <a
            href={directionsUrl(branch.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
            aria-label={`Chỉ đường đến ${branch.name} (mở Google Maps trong thẻ mới)`}
          >
            <Navigation className="h-4 w-4" aria-hidden="true" /> Chỉ đường
          </a>
        ) : null}
      </div>
    </article>
  );
}
