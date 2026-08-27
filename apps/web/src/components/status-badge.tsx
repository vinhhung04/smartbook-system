import { TONE_CLASSNAME } from "@/lib/status-registry";

const variants: Record<string, string> = TONE_CLASSNAME;

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
