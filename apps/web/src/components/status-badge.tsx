const variants: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200/70 shadow-emerald-100/40",
  warning: "bg-amber-50 text-amber-700 border-amber-200/70 shadow-amber-100/40",
  danger: "bg-red-50 text-red-600 border-red-200/70 shadow-red-100/40",
  info: "bg-sky-50 text-sky-700 border-sky-200/70 shadow-sky-100/40",
  neutral: "bg-slate-50 text-slate-600 border-slate-200/70",
  primary: "bg-indigo-50 text-indigo-700 border-indigo-200/70 shadow-indigo-100/40",
  violet: "bg-violet-50 text-violet-700 border-violet-200/70 shadow-violet-100/40",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200/70 shadow-cyan-100/40",
  teal: "bg-teal-50 text-teal-700 border-teal-200/70 shadow-teal-100/40",
  amber: "bg-amber-50 text-amber-700 border-amber-200/70",
  rose: "bg-rose-50 text-rose-600 border-rose-200/70",
};

const dotColors: Record<string, string> = {
  success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500",
  info: "bg-sky-500", neutral: "bg-slate-400", primary: "bg-indigo-500",
  violet: "bg-violet-500", cyan: "bg-cyan-500", teal: "bg-teal-500",
  amber: "bg-amber-500", rose: "bg-rose-500",
};

export function StatusBadge({ label, variant = "neutral", dot = false }: { label: string; variant?: string; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[11px] border shadow-sm ${variants[variant] || variants.neutral}`} style={{ fontWeight: 550, letterSpacing: "0.01em" }}>
      {dot && <span className={`w-[5px] h-[5px] rounded-full ${dotColors[variant] || dotColors.neutral}`} />}
      {label}
    </span>
  );
}
