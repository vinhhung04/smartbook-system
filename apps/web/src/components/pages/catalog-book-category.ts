import { Atom, BookOpenText, Globe2, ScrollText, type LucideIcon } from "lucide-react";

// Mirrors the category -> visual language already established in
// customer/_shared/book-cover-placeholder.tsx, adapted for a compact table
// thumbnail instead of a full card face. Kept as a page-local duplicate
// rather than a shared import — this is an admin-only, two-file change and
// the customer catalog is unrelated to this ask.
export type CategoryStyle = { Icon: LucideIcon; tone: "cyan" | "amber" | "primary" | "neutral"; iconClass: string; bgClass: string };

export function pickCategoryStyle(category?: string | null): CategoryStyle {
  const value = String(category || "").toLowerCase();
  if (value.includes("science") || value.includes("technology") || value.includes("khoa học") || value.includes("công nghệ")) {
    return { Icon: Atom, tone: "cyan", iconClass: "text-cyan-700 dark:text-cyan-400", bgClass: "bg-cyan-100 dark:bg-cyan-500/15" };
  }
  if (value.includes("history") || value.includes("geography") || value.includes("lịch sử") || value.includes("địa lý")) {
    return { Icon: Globe2, tone: "amber", iconClass: "text-amber-700 dark:text-amber-400", bgClass: "bg-amber-100 dark:bg-amber-500/15" };
  }
  if (value.includes("literature") || value.includes("fiction") || value.includes("novel") || value.includes("văn học") || value.includes("tiểu thuyết")) {
    return { Icon: ScrollText, tone: "primary", iconClass: "text-indigo-700 dark:text-indigo-400", bgClass: "bg-indigo-100 dark:bg-indigo-500/15" };
  }
  return { Icon: BookOpenText, tone: "neutral", iconClass: "text-slate-700 dark:text-slate-400", bgClass: "bg-slate-100 dark:bg-slate-500/15" };
}

export function getCategoryTone(category?: string | null): "cyan" | "amber" | "primary" | "neutral" {
  return pickCategoryStyle(category).tone;
}
