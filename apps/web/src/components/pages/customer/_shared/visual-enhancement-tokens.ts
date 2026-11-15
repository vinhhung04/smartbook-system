export const visualEnhancementTokens = {
  motion: {
    card: 'transition-all duration-200 ease-out',
    button: 'transition-colors duration-200 ease-out',
  },
  statVariants: {
    default: 'border-slate-200 bg-white text-slate-900',
    info: 'border-cyan-200 bg-cyan-50/70 text-cyan-900',
    success: 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50/80 text-amber-900',
    critical: 'border-rose-200 bg-rose-50/80 text-rose-900',
  },
  emptyFrame: 'rounded-[14px] border border-dashed border-border bg-card py-14',
  primaryAction: 'inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
  secondaryAction: 'inline-flex items-center gap-2 rounded-xl border border-input bg-card px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
  accentGlow: 'bg-[radial-gradient(circle_at_20%_0%,rgba(59,130,246,0.16),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(6,182,212,0.14),transparent_42%)]',
};
