/** Only active branches are public; the dot is decoration, the words carry the status. */
export function BranchStatus() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/25 bg-emerald-50 px-2.5 py-0.5 text-[12px] font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Đang hoạt động
    </span>
  );
}
