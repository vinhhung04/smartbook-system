import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/ui/utils";

// One frame for both supplier entrances: the signed-in account (/supplier) and the
// per-order link (/supplier/portal/:token). Each page keeps its own workflow; they share
// the header, sections, figures, tabs and status words so they read as one product.

export function SupplierShell({ supplierName, access, actions, children }: {
  supplierName?: string | null;
  /** How the visitor got here, shown under the name. */
  access: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-display text-[20px] font-semibold tracking-tight text-foreground">SmartBook</span>
            <span className="h-5 w-px bg-border" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-foreground">{supplierName || "Nhà cung cấp"}</p>
              <p className="text-[12px] text-muted-foreground">{access}</p>
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        <p className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-[13px] text-muted-foreground">
          Tại đây bạn xác nhận đơn, gửi hóa đơn và phiếu giao hàng, xử lý báo thiếu. Việc kiểm đếm và nhập kho do nhân viên kho SmartBook thực hiện, kết quả hiện lại ở mục chứng từ.
        </p>
        {children}
      </main>
    </div>
  );
}

export function SupplierSection({ title, icon: Icon, description, children, className }: {
  title: string;
  icon?: LucideIcon;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}>
      <div className="border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 font-display text-[18px] font-semibold tracking-tight text-foreground">
          {Icon ? <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : null}
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

/** Hairline-divided figures; units belong in the labels. */
export function SupplierFigures({ items, className }: { items: Array<{ label: string; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-card px-4 py-3">
          <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 truncate font-display text-[22px] font-semibold leading-tight tabular-nums text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SupplierTabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: Array<[T, string]>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
      {tabs.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            value === key ? "border-primary/30 bg-primary/[0.08] font-semibold text-primary" : "border-border bg-card font-medium text-foreground hover:bg-muted/60",
          )}
        >
          {text}
        </button>
      ))}
    </nav>
  );
}
