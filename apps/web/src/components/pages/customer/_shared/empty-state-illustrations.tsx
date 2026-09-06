export function EmptyBooksIllustration() {
  return (
    <div className="relative h-20 w-28">
      <div className="absolute left-0 top-4 h-14 w-10 rounded-[6px] border border-cyan-200 bg-cyan-50" />
      <div className="absolute left-8 top-1 h-16 w-10 rounded-[6px] border border-indigo-200 bg-indigo-50" />
      <div className="absolute left-16 top-6 h-12 w-10 rounded-[6px] border border-border bg-card" />
      <div className="absolute left-2 top-7 h-1 w-6 rounded bg-cyan-200" />
      <div className="absolute left-10 top-5 h-1 w-6 rounded bg-indigo-200" />
      <div className="absolute left-18 top-9 h-1 w-5 rounded bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}

export function EmptyGenericIllustration() {
  return (
    <div className="h-16 w-16 rounded-full border border-border bg-muted" />
  );
}
