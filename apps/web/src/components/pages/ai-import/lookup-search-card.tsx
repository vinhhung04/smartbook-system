import { CheckCircle2, Info, Loader2, ScanBarcode, Search } from "lucide-react";
import { normalizeIsbnInput } from "./utils";

/** Advisory only: the lookup also accepts retail barcodes (marketplace search), so nothing is blocked here. */
function isbnShape(raw: string): { tone: "ok" | "info"; text: string } | null {
  if (!raw.trim()) return null;
  const digits = normalizeIsbnInput(raw);
  if (digits.length === 13) return { tone: "ok", text: "Dạng ISBN-13 (13 ký tự)" };
  if (digits.length === 10) return { tone: "ok", text: "Dạng ISBN-10 (10 ký tự)" };
  return { tone: "info", text: `${digits.length} ký tự — không phải độ dài ISBN; hệ thống vẫn thử tra như mã vạch` };
}

export function LookupSearchCard({
  isbnInput,
  onIsbnInputChange,
  onLookup,
  onScanClick,
  lookupLoading,
  hasLookupData,
}: {
  isbnInput: string;
  onIsbnInputChange: (value: string) => void;
  onLookup: () => void;
  onScanClick: () => void;
  lookupLoading: boolean;
  hasLookupData: boolean;
}) {
  const shape = isbnShape(isbnInput);

  return (
    <div className="max-w-3xl space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-foreground">Tra cứu ISBN</h3>
        <span className="text-[12px] text-muted-foreground">
          {lookupLoading ? "Đang tra cứu…" : hasLookupData ? "Tra lại sẽ thay biểu mẫu hiện tại" : "Nhập rồi nhấn Enter"}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="isbnLookup" className="sr-only">ISBN hoặc mã vạch sách (bắt buộc)</label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            id="isbnLookup"
            value={isbnInput}
            onChange={(event) => onIsbnInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onLookup();
              }
            }}
            placeholder="ISBN-10 hoặc ISBN-13"
            inputMode="text"
            autoComplete="off"
            aria-required
            aria-describedby="isbnLookup-hint"
            className="h-12 w-full rounded-xl border border-border bg-input-background pl-10 pr-4 font-mono text-[15px] tabular-nums tracking-wide text-foreground outline-none transition-[border-color,box-shadow] placeholder:font-sans placeholder:text-[13.5px] placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            type="button"
            onClick={onLookup}
            disabled={lookupLoading}
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
            {lookupLoading ? "Đang tra cứu…" : "Tra cứu"}
          </button>
          <button
            type="button"
            onClick={onScanClick}
            disabled={lookupLoading}
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-card px-4 text-[13.5px] font-semibold text-foreground transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ScanBarcode className="h-4 w-4" aria-hidden="true" />
            Quét camera
          </button>
        </div>
      </div>
      <p id="isbnLookup-hint" className="min-h-[18px] text-[12px] text-muted-foreground" aria-live="polite">
        {shape ? (
          <span className={`inline-flex items-center gap-1.5 ${shape.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
            {shape.tone === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Info className="h-3.5 w-3.5" aria-hidden="true" />}
            {shape.text}
          </span>
        ) : "Dấu gạch và khoảng trắng được bỏ tự động. Mã vạch bán lẻ cũng tra được qua nhà sách trực tuyến."}
      </p>
    </div>
  );
}
