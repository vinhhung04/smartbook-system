import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-2 flex items-center gap-1 text-[12px] font-semibold text-foreground">
        {label}
        {required ? <span className="text-destructive" aria-hidden="true">*</span> : null}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-required={required || undefined}
        className={`${mono ? "font-mono tabular-nums" : ""} ${
          variant === "underline"
            ? "min-h-9 rounded-none border-x-0 border-t-0 border-b border-border/80 bg-transparent px-0 shadow-none focus-visible:border-b-primary focus-visible:ring-0"
            : "min-h-11 border-border/80 bg-muted/[0.12] shadow-none focus-visible:bg-card"
        } text-[14px] transition-colors ${inputClassName || ""}`.trim()}
      />
    </div>
  );
}

/** Book cover preview with graceful fallback. Remount via `key` when the URL changes. */
export function CoverPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-cyan-600 dark:text-cyan-400">
        <BookOpen className="h-9 w-9" />
        <span className="text-[10px] font-medium">Chưa có ảnh bìa</span>
      </div>
    );
  }
  return <img src={src} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />;
}
