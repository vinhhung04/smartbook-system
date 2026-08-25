import { Loader2, ScanBarcode, Search, Sparkles, ClipboardCheck } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";

export function LookupSearchCard({
  isbnInput,
  onIsbnInputChange,
  onLookup,
  onScanClick,
  lookupLoading,
  hasLookupData,
  hasPostIsbnSuggestions,
}: {
  isbnInput: string;
  onIsbnInputChange: (value: string) => void;
  onLookup: () => void;
  onScanClick: () => void;
  lookupLoading: boolean;
  hasLookupData: boolean;
  hasPostIsbnSuggestions: boolean;
}) {
  const steps: WorkflowStep[] = [
    { id: "lookup", label: "Tra cứu ISBN", icon: Search, status: hasLookupData ? "completed" : "active" },
    { id: "ai", label: "AI đề xuất", icon: Sparkles, status: hasPostIsbnSuggestions ? "completed" : lookupLoading ? "active" : "pending" },
    { id: "edit", label: "Admin duyệt", icon: ClipboardCheck, status: hasLookupData ? "active" : "pending" },
  ];
  const statusLabel = lookupLoading ? "Đang tra cứu" : hasLookupData ? "Đang review" : "Sẵn sàng";
  const statusVariant = lookupLoading ? "info" : hasLookupData ? "success" : "neutral";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <SectionCard
        icon={Search}
        title="Tra cứu ISBN"
        subtitle="Sau lookup, AI hoàn thiện metadata ở dạng đề xuất để admin chọn áp dụng"
        className="border-cyan-200/70 shadow-[0_4px_20px_rgba(8,145,178,0.06)] dark:border-cyan-500/20"
        headerClassName="border-b border-cyan-100/80 dark:border-cyan-500/15"
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <Label htmlFor="isbnLookup" className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground">
              ISBN hoặc barcode sách
              <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-500" />
              <Input
                id="isbnLookup"
                value={isbnInput}
                onChange={(event) => onIsbnInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onLookup();
                  }
                }}
                placeholder="Nhập hoặc quét ISBN-10 / ISBN-13"
                aria-required
                className="min-h-11 border-cyan-200 bg-card pl-10 pr-4 text-[13px] font-mono tabular-nums focus-visible:border-cyan-400/70 focus-visible:ring-cyan-500/20 dark:border-cyan-500/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button
              type="button"
              onClick={onLookup}
              disabled={lookupLoading}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-cyan-600 px-4 text-[13px] font-semibold text-white transition-[background-color,transform,box-shadow] duration-150 hover:bg-cyan-700 hover:shadow-[0_4px_12px_rgba(8,145,178,0.25)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none disabled:active:scale-100 dark:bg-cyan-500 dark:hover:bg-cyan-600"
            >
              {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span>{lookupLoading ? "Đang tra cứu…" : "Tra cứu"}</span>
            </button>

            <button
              type="button"
              onClick={onScanClick}
              disabled={lookupLoading}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-primary/20 bg-primary/10 px-4 text-[13px] font-semibold text-primary transition-[background-color,transform] duration-150 hover:bg-primary/15 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
            >
              <ScanBarcode className="h-4 w-4" />
              <span>Quét camera</span>
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 text-[12px] text-muted-foreground sm:grid-cols-3">
          <div className="flex items-center gap-2 rounded-[8px] bg-muted/45 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
            Lookup metadata hiện có
          </div>
          <div className="flex items-center gap-2 rounded-[8px] bg-muted/45 px-3 py-2">
            <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            AI tạo đề xuất hậu xử lý
          </div>
          <div className="flex items-center gap-2 rounded-[8px] bg-muted/45 px-3 py-2">
            <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Admin duyệt trước khi lưu
          </div>
        </div>
      </SectionCard>

      <div className="rounded-xl border border-border/80 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:shadow-none">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-foreground">Luồng nhập hiện tại</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">ISBN-first, AI hỗ trợ sau lookup</p>
          </div>
          <StatusBadge label={statusLabel} variant={statusVariant} dot />
        </div>
        <WorkflowStepper steps={steps} orientation="vertical" compact />
      </div>
    </div>
  );
}
