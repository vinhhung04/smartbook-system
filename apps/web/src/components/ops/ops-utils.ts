// Formatting and form helpers shared by the warehouse-operation screens (see ops-kit.tsx).

export function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatShortDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

/** "12 phút", "3 giờ", "5 ngày" since `value`; `stale` once it has waited a working day. */
export function elapsedSince(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 60) return { text: `${minutes} phút`, stale: false };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { text: `${hours} giờ`, stale: hours >= 8 };
  return { text: `${Math.round(hours / 24)} ngày`, stale: true };
}

export function timeAgo(value: string | null | undefined) {
  const elapsed = elapsedSince(value);
  return elapsed ? `${elapsed.text} trước` : null;
}

/** aria props for a control wrapped in <Field>, so its hint or error is read with it. */
export function fieldAria(id: string, error?: string | null, hasHint?: boolean) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
  } as const;
}

/** Native select styled like the design-system inputs (keeps selectOption working in e2e). */
export const nativeSelectClass =
  "h-10 w-full rounded-md border border-input bg-input-background px-3 text-[14px] text-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive dark:border-border dark:bg-muted/40 sm:text-[13px]";

/** The design-system inputs are borderless and transparent in dark mode; on these screens fields stay visible. */
export const darkFieldClass = "dark:border-border dark:bg-muted/40";
