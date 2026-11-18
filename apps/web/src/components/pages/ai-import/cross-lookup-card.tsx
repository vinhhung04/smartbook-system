import { useId } from "react";
import { Check, ChevronDown, ExternalLink } from "lucide-react";
import type { CrossLookup, CrossLookupCandidate, IsbnSourceName } from "@/services/ai";
import { describeOcrCode } from "@/lib/book-ocr";
import { safeHttpUrl } from "./source-meta";
import type { EditableBookForm } from "./types";
import { crossLookupPatch, SOURCE_LABELS } from "./utils";

/** DOM id, so the review checklist and the save bar can jump here. */
export const CROSS_LOOKUP_CARD_ID = "cross-lookup";

const sourceName = (source: string) => SOURCE_LABELS[source as IsbnSourceName] || source;

/** "Công ty Cổ phần Fonos. Địa chỉ: 119 ..." / "AZ Việt Nam - 50, đường 5 ..." -> the name only. */
function partnerName(partner: string | null): string | null {
  return partner ? partner.split(/\.\s*Địa chỉ|;\s*Địa chỉ|\s+-\s+|;/)[0].trim() || null : null;
}

/** Every linked code as a row: the lookup's candidates, or (codes stated on the same
 *  record as the scanned one) one row per code from the evidence. */
function rowsOf(cross: CrossLookup): CrossLookupCandidate[] {
  if (cross.candidates?.length) return cross.candidates;
  const rows = new Map<string, CrossLookupCandidate>();
  for (const item of cross.evidence) {
    for (const code of item.codes) {
      const row = rows.get(code) || { value: code, isbn10: code === cross.value ? cross.isbn10 : null, sources: [], titles: [],
        publisher: item.publisher ?? null, partner: null, years: [], depositDates: [], sourceUrl: item.sourceUrl ?? null,
        basis: item.basis ?? "TITLE_PUBLISHER", preferred: false };
      row.sources = [...new Set([...row.sources, item.source])];
      if (item.title && !row.titles.includes(item.title)) row.titles.push(item.title);
      rows.set(code, row);
    }
  }
  return [...rows.values()];
}

/**
 * EAN-13 <-> ISBN cross lookup, shown like a field's value comparison: one summary
 * line under the field it fills (ISBN-13 for a scanned EAN, the barcode for a scanned
 * ISBN) and, on demand, every linked code with what tells the printings apart
 * (publisher, partner, deposit dates / year, sources). The one matching the edition's
 * year comes first. A code goes into the field only on "Dùng giá trị này".
 */
export function CrossLookupField({ cross, current, open, onToggle, onApply }: {
  cross: CrossLookup;
  /** The value now in the field this lookup fills. */
  current: string;
  open: boolean;
  onToggle: () => void;
  onApply: (patch: Partial<EditableBookForm>, label: string) => void;
}) {
  const panelId = useId();
  const toIsbn = cross.direction === "EAN_TO_ISBN";
  const rows = rowsOf(cross);
  const several = rows.length > 1;
  const from = toIsbn ? "mã EAN-13" : "ISBN";
  const noun = toIsbn ? "ISBN" : "mã vạch";
  const offered = !several && cross.value && (cross.status === "VERIFIED" || cross.status === "REVIEW_REQUIRED") ? cross.value : null;
  const pick = offered || cross.preferred || null;
  const inField = current.trim();
  const apply = (row: CrossLookupCandidate) =>
    onApply(crossLookupPatch(cross, row.value, row.isbn10), `${toIsbn ? "ISBN" : "mã vạch EAN-13"} từ đối chiếu ${from}`);
  const summary = cross.status === "NOT_FOUND"
    ? cross.reasons.includes("REGISTRY_UNAVAILABLE") ? "sổ lưu chiểu chưa phản hồi — tra lại sau ít phút" : `chưa tìm thấy ${noun} — vẫn lưu được bằng mã đã tra`
    : several ? `${rows.length} ${noun} ứng viên (${toIsbn ? "mỗi lần tái bản một ISBN" : "bìa / đơn vị phát hành khác nhau"})`
      : `${offered || rows[0]?.value || ""} · ${cross.status === "VERIFIED" ? "Đã đối chiếu" : cross.status === "CONFLICTED" ? "Nguồn mâu thuẫn" : "Cần kiểm tra"}`;
  const pickRow = rows.find((row) => row.value === pick);

  return (
    <div id={CROSS_LOOKUP_CARD_ID} data-testid="cross-lookup" className="mt-1.5 scroll-mt-28">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        <span className="min-w-0">
          Đối chiếu từ {from} <span className="font-mono">{cross.scannedCode}</span>: <span className={cross.status === "NOT_FOUND" ? "" : "text-amber-800 dark:text-amber-300"}>{summary}</span>
        </span>
        {rows.length ? (
          <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}
            className="inline-flex min-h-8 pointer-coarse:min-h-[44px] cursor-pointer items-center gap-1 rounded-md px-1 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            {several ? `So sánh ${rows.length} giá trị` : "Xem bằng chứng"}
            <span className="sr-only"> cho {toIsbn ? "ISBN-13" : "mã vạch EAN-13"}</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        ) : null}
        {pickRow && inField !== pickRow.value ? (
          <button type="button" onClick={() => apply(pickRow)}
            className="inline-flex min-h-8 pointer-coarse:min-h-[44px] cursor-pointer items-center gap-1 rounded-md px-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            Dùng {pickRow.value}{several ? " (khớp năm ấn bản)" : ""}
          </button>
        ) : null}
      </div>

      {open && rows.length ? (
        <div id={panelId} className="mt-2 rounded-xl border border-border bg-muted/25 p-3 sm:p-4">
          <ul className="space-y-2" aria-label={`Các ${noun} ứng viên`}>
            {rows.map((row) => {
              const inUse = inField === row.value;
              const partner = partnerName(row.partner);
              const when = row.depositDates.length ? `nộp lưu chiểu ${row.depositDates.join(", ")}` : row.years.length ? `năm ${row.years.join(", ")}` : null;
              const url = safeHttpUrl(row.sourceUrl);
              return (
                <li key={row.value} data-testid="cross-lookup-candidate" className={`rounded-lg border bg-card px-3 py-2.5 ${row.preferred ? "border-amber-300 dark:border-amber-500/40" : "border-border/80"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px] text-foreground">
                        <span className="font-mono font-semibold tabular-nums">{row.value}</span>
                        {toIsbn && row.isbn10 ? <span className="font-mono text-[12px] text-muted-foreground">ISBN-10 {row.isbn10}</span> : null}
                        {row.preferred ? <span className="text-[12px] font-medium text-amber-800 dark:text-amber-300">Khớp năm ấn bản</span> : null}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {[row.publisher, partner ? `liên kết ${partner}` : null, when].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {inUse ? (
                      <span className="inline-flex min-h-8 items-center gap-1 text-[12.5px] font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" aria-hidden="true" />Đang dùng</span>
                    ) : (
                      <button type="button" onClick={() => apply(row)}
                        className="inline-flex min-h-9 pointer-coarse:min-h-[44px] shrink-0 cursor-pointer items-center rounded-lg border border-border bg-card px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
                        Dùng giá trị này<span className="sr-only"> ({row.value})</span>
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 border-t border-border/70 pt-1.5 text-[12px] text-muted-foreground">
                    <span className="font-medium text-foreground">{row.sources.map(sourceName).join(", ")}</span>
                    <span>{row.basis && cross.candidates?.length ? `khớp tên sách, NXB${row.basis === "TITLE_PUBLISHER_AUTHOR" ? ", tác giả" : ""}` : "ghi cùng trang với mã đã tra"}</span>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                        Nguồn<ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-2.5 text-[12px] leading-5 text-muted-foreground">
            {several && toIsbn ? "Mã vạch giữ nguyên qua các lần tái bản, còn ISBN thì đổi: chọn ISBN in ở trang thông tin xuất bản của cuốn trong tay. " : null}
            {several && !toIsbn ? "Chọn mã in ở bìa sau của cuốn trong tay. " : null}
            {cross.reasons.filter((reason) => reason !== "PREFERRED_BY_YEAR").map((reason) => describeOcrCode(reason)).join(" · ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
