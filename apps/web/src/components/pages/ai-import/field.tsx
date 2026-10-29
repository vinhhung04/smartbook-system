import { useState } from "react";
import { AlertCircle, BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Where a field's current value came from - shown next to the label. */
export interface FieldOrigin {
  label: string;
  tone: "edited" | "ocr" | "ocr-weak" | "lookup";
}

const ORIGIN_CLASS: Record<FieldOrigin["tone"], string> = {
  edited: "text-primary",
  ocr: "text-emerald-700 dark:text-emerald-400",
  "ocr-weak": "text-sky-700 dark:text-sky-300",
  lookup: "text-muted-foreground",
};

export function OriginTag({ origin }: { origin?: FieldOrigin }) {
  if (!origin) return null;
  return <span className={`ml-auto shrink-0 text-[11px] font-normal ${ORIGIN_CLASS[origin.tone]}`}>{origin.label}</span>;
}

export function Field({
  id,
  label,
  value,
  onChange,
  mono,
  placeholder,
  className,
  required,
  variant = "boxed",
  inputClassName,
  origin,
  error,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
  className?: string;
  required?: boolean;
  /** "underline" trades the boxed input chrome for a thin bottom rule — used by the
   *  Hồ sơ catalog record fields for a less generic-admin-form rhythm. Defaults to
   *  "boxed" so every other existing call site is unaffected. */
  variant?: "boxed" | "underline";
  /** Extra classes merged onto the Input itself (e.g. a serif accent on one field). */
  inputClassName?: string;
  origin?: FieldOrigin;
  /** Shown under the input and announced; marks the input invalid. */
  error?: string | null;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-foreground">
        {label}
        {required ? <span className="text-destructive" aria-hidden="true">*</span> : null}
        <OriginTag origin={origin} />
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`${mono ? "font-mono tabular-nums" : ""} ${
          variant === "underline"
            ? "min-h-9 rounded-none border-x-0 border-t-0 border-b border-border/80 bg-transparent px-0 shadow-none focus-visible:border-b-primary focus-visible:ring-0"
            : "min-h-11 border-border/80 bg-muted/[0.12] shadow-none focus-visible:bg-card"
        } ${error ? "border-red-400 dark:border-red-500/60" : ""} text-[14px] transition-colors ${inputClassName || ""}`.trim()}
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1 flex items-center gap-1 text-[12px] text-red-700 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}
        </p>
      ) : null}
    </div>
  );
}

/** Book cover preview with graceful fallback. Remount via `key` when the URL changes. */
export function CoverPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground">
        <BookOpen className="h-7 w-7" aria-hidden="true" />
        <span className="px-1 text-center text-[10px] font-medium">Chưa có ảnh bìa</span>
      </div>
    );
  }
  // Google Books returns http:// cover URLs, which the page's CSP (https-only img-src) blocks.
  return <img src={src.replace(/^http:\/\//i, "https://")} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />;
}
