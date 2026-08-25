import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileText, Hash, Loader2, RefreshCw, Sparkles, Tags, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { PostIsbnAiSuggestions } from "@/services/ai";
import type { AiFieldCandidate, AiFieldCandidates, AiFieldKey } from "./types";

function AiFieldCard({
  label,
  icon: Icon,
  candidate,
  loading,
  onRegenerate,
  onApply,
  multiline,
  className = "",
}: {
  label: string;
  icon: LucideIcon;
  candidate: AiFieldCandidate | null;
  loading: boolean;
  onRegenerate: () => void;
  onApply: () => void;
  multiline?: boolean;
  className?: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  const hasValue = Boolean(candidate?.value.trim());

  return (
    <div className={`flex flex-col rounded-xl border border-violet-200/70 bg-card p-4 dark:border-violet-500/20 ${className}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-[13px] font-semibold text-foreground">{label}</span>
        {candidate?.source === "postIsbn" ? <StatusBadge label="Từ ISBN" variant="cyan" /> : null}
      </div>

      <div className="min-h-[44px] flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={candidate?.value || "empty"}
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
            className={`${multiline ? "line-clamp-4 whitespace-pre-wrap" : "truncate"} text-[13px] leading-5 ${hasValue ? "text-muted-foreground" : "italic text-muted-foreground/70"}`}
          >
            {hasValue ? candidate!.value : "Chưa có đề xuất"}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={loading}
          className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-violet-200 bg-card px-3 py-1.5 text-[11px] font-semibold text-violet-700 transition-[background-color,border-color,transform] duration-150 hover:border-violet-300 hover:bg-violet-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 dark:border-violet-500/20 dark:text-violet-400 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/10"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : hasValue ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span>{loading ? "Đang tạo..." : hasValue ? "Tạo lại" : "Tạo bằng AI"}</span>
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={!hasValue}
          className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-[8px] border border-violet-200 bg-violet-50 px-3.5 text-[11px] font-semibold text-violet-700 transition-[background-color,transform] duration-150 hover:bg-violet-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
        >
          Áp dụng
        </button>
      </div>
    </div>
  );
}

export function AiAssistTab({
  title,
  aiFieldCandidates,
  aiFieldLoading,
  onRegenerateField,
  onApplyField,
  onApplyAllFields,
  aiSuggestionCount,
  qualityCheckLoading,
  qualityCheckResult,
  onQualityCheck,
  onDismissQualityCheck,
  postIsbnSuggestions,
  hasPostIsbnSuggestions,
  onFocusField,
}: {
  title: string;
  aiFieldCandidates: AiFieldCandidates;
  aiFieldLoading: Record<AiFieldKey, boolean>;
  onRegenerateField: (field: AiFieldKey) => void;
  onApplyField: (field: AiFieldKey) => void;
  onApplyAllFields: () => void;
  aiSuggestionCount: number;
  qualityCheckLoading: boolean;
  qualityCheckResult: { provider: string; warnings: string[] } | null;
  onQualityCheck: () => void;
  onDismissQualityCheck: () => void;
  postIsbnSuggestions: PostIsbnAiSuggestions | null;
  hasPostIsbnSuggestions: boolean;
  onFocusField: (fieldId: string) => void;
}) {
  if (!title.trim()) {
    return (
      <div className="flex min-h-40 items-center justify-center border-y border-border py-8 text-center">
        <div>
          <Sparkles className="mx-auto h-6 w-6 text-violet-500" aria-hidden="true" />
          <p className="mt-3 text-[14px] font-semibold text-foreground">Cần tên sách để dùng AI hỗ trợ</p>
          <button type="button" onClick={() => onFocusField("title")} className="mt-2 cursor-pointer text-[13px] font-medium text-cyan-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:text-cyan-300">Bổ sung tên sách</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <section aria-labelledby="ai-workspace-title">
        <div className="mb-5 flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">AI hỗ trợ catalog</p>
            <h2 id="ai-workspace-title" className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">Đề xuất AI theo trường</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Tạo, xem và áp dụng đề xuất AI cho từng trường; hồ sơ chỉ đổi khi bạn bấm áp dụng.</p>
          </div>
          <div className="flex items-center gap-2">
            {hasPostIsbnSuggestions && postIsbnSuggestions ? (
              <span className="text-[12px] text-muted-foreground">
                {postIsbnSuggestions.provider === "none" ? "AI không khả dụng" : `${postIsbnSuggestions.provider} · ${Math.round((postIsbnSuggestions.confidence || 0) * 100)}%`}
              </span>
            ) : null}
            <StatusBadge label={aiSuggestionCount ? `${aiSuggestionCount} chờ duyệt` : "Chưa có"} variant={aiSuggestionCount ? "violet" : "neutral"} />
            <button
              type="button"
              onClick={onQualityCheck}
              disabled={qualityCheckLoading}
              className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              {qualityCheckLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
              Kiểm tra chất lượng
            </button>
          </div>
        </div>

        {qualityCheckResult ? (
          <div className={`mb-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px] ${qualityCheckResult.warnings.length === 0 ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}`}>
            <div className="flex-1">
              {qualityCheckResult.warnings.length === 0 ? (
                <span className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-4 w-4" />Metadata đạt chất lượng tốt</span>
              ) : (
                <>
                  <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Cảnh báo chất lượng metadata</div>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {qualityCheckResult.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                  </ul>
                </>
              )}
            </div>
            <button type="button" onClick={onDismissQualityCheck} aria-label="Đóng" className="cursor-pointer text-current/70 hover:text-current">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">Mỗi trường có một đề xuất AI riêng; áp dụng từng mục hoặc tất cả.</p>
          {aiSuggestionCount > 0 ? (
            <button
              type="button"
              onClick={onApplyAllFields}
              className="inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-violet-600 px-3.5 text-[12px] font-semibold text-white transition-[background-color,transform,box-shadow] duration-150 hover:bg-violet-700 hover:shadow-[0_4px_12px_rgba(124,58,237,0.22)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:bg-violet-500 dark:hover:bg-violet-600"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Áp dụng tất cả
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AiFieldCard
            className="sm:col-span-2"
            multiline
            label="Mô tả"
            icon={FileText}
            candidate={aiFieldCandidates.description}
            loading={aiFieldLoading.description}
            onRegenerate={() => onRegenerateField("description")}
            onApply={() => onApplyField("description")}
          />
          <AiFieldCard
            multiline
            label="Tóm tắt ngắn cho chatbot"
            icon={ClipboardCheck}
            candidate={aiFieldCandidates.summaryVi}
            loading={aiFieldLoading.summaryVi}
            onRegenerate={() => onRegenerateField("summaryVi")}
            onApply={() => onApplyField("summaryVi")}
          />
          <AiFieldCard
            label="Từ khóa"
            icon={Hash}
            candidate={aiFieldCandidates.keywords}
            loading={aiFieldLoading.keywords}
            onRegenerate={() => onRegenerateField("keywords")}
            onApply={() => onApplyField("keywords")}
          />
          <AiFieldCard
            label="Thể loại"
            icon={Tags}
            candidate={aiFieldCandidates.categories}
            loading={aiFieldLoading.categories}
            onRegenerate={() => onRegenerateField("categories")}
            onApply={() => onApplyField("categories")}
          />
        </div>
      </section>
    </div>
  );
}
