import { AlertCircle, ArrowRight, CheckCircle2, Info } from "lucide-react";

export interface ChecklistItem {
  key: string;
  label: string;
  /** Required items mirror exactly what handleSave refuses; the others never block. */
  required: boolean;
  done: boolean;
  detail?: string;
  onGo?: () => void;
}

function Item({ item }: { item: ChecklistItem }) {
  const Icon = item.done ? CheckCircle2 : item.required ? AlertCircle : Info;
  const tone = item.done ? "text-emerald-600 dark:text-emerald-400" : item.required ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={`text-[13.5px] ${item.done ? "text-muted-foreground" : "font-medium text-foreground"}`}>
          {item.label}
          <span className="sr-only">{item.done ? " — đã xong" : item.required ? " — bắt buộc, chưa xong" : " — nên xem, chưa xong"}</span>
        </p>
        {item.detail && !item.done ? <p className="mt-0.5 text-[12px] text-muted-foreground">{item.detail}</p> : null}
      </div>
      {!item.done && item.onGo ? (
        <button type="button" onClick={item.onGo}
          className="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring">
          Xử lý<span className="sr-only"> {item.label.toLowerCase()}</span><ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

/** What is done, what blocks the save and what is only advised - one list per kind. */
export function ReviewChecklist({ items }: { items: ChecklistItem[] }) {
  const required = items.filter((item) => item.required);
  const advised = items.filter((item) => !item.required);
  const open = required.filter((item) => !item.done).length;
  return (
    <section aria-labelledby="review-checklist-title" className="rounded-2xl border border-border bg-card px-5 py-4">
      <h3 id="review-checklist-title" className="text-[15px] font-semibold text-foreground">Trước khi lưu</h3>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground" aria-live="polite">
        {open ? `Còn ${open} việc bắt buộc — nút Lưu sẽ từ chối cho tới khi xong.` : "Các điều kiện bắt buộc đã đủ. Sách chỉ được lưu khi bạn bấm Lưu."}
      </p>
      <h4 className="mt-4 text-[12.5px] font-semibold text-muted-foreground">Bắt buộc</h4>
      <ul className="divide-y divide-border/70">{required.map((item) => <Item key={item.key} item={item} />)}</ul>
      {advised.length ? (
        <>
          <h4 className="mt-3 text-[12.5px] font-semibold text-muted-foreground">Nên xem lại</h4>
          <ul className="divide-y divide-border/70">{advised.map((item) => <Item key={item.key} item={item} />)}</ul>
        </>
      ) : null}
    </section>
  );
}
