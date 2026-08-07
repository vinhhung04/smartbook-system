import { Check, X } from "lucide-react";
import { cn } from "./utils";
import type { LucideIcon } from "lucide-react";

export type StepStatus = "completed" | "active" | "pending" | "error";

export interface WorkflowStep {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  status: StepStatus;
}

interface WorkflowStepperProps {
  steps: WorkflowStep[];
  orientation?: "horizontal" | "vertical";
  compact?: boolean;
  className?: string;
}

const stepIconClasses: Record<StepStatus, string> = {
  completed: "bg-emerald-500 border-emerald-500 text-white",
  active: "bg-primary border-primary text-primary-foreground ring-2 ring-primary/20",
  pending: "bg-card border-border text-muted-foreground",
  error: "bg-red-50 border-red-400 text-red-600 dark:bg-red-500/10 dark:border-red-500/40 dark:text-red-400",
};

const stepLabelClasses: Record<StepStatus, string> = {
  completed: "text-emerald-700 dark:text-emerald-400 font-medium",
  active: "text-primary font-semibold",
  pending: "text-muted-foreground",
  error: "text-red-600 dark:text-red-400 font-medium",
};

function StepIcon({ step, compact }: { step: WorkflowStep; compact: boolean }) {
  const size = compact ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  const Icon = step.icon;

  return (
    <div className={cn("rounded-full border-2 flex items-center justify-center shrink-0 transition-all", size, stepIconClasses[step.status])}>
      {step.status === "completed" ? (
        <Check className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : step.status === "error" ? (
        <X className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : Icon ? (
        <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : null}
    </div>
  );
}

function HorizontalStepper({ steps, compact }: { steps: WorkflowStep[]; compact: boolean }) {
  const n = steps.length;
  // Track spans center-to-center between the first and last circle. Each circle sits at the
  // center of its own 1/n grid column, so that center is at (i + 0.5) / n — symmetric offsets.
  const edgeOffsetPct = n > 1 ? 50 / n : 50;
  const trackSpanPct = n > 1 ? ((n - 1) / n) * 100 : 0;
  const doneCount = steps.filter((s) => s.status === "completed" || s.status === "active").length;
  const progressIdx = Math.max(0, doneCount - 1);
  const filledPct = n > 1 ? trackSpanPct * (progressIdx / (n - 1)) : 0;
  const circleCenterPx = compact ? 12 : 16;

  return (
    <div className="relative w-full">
      <div
        className="absolute h-[2px] rounded bg-border"
        style={{ top: circleCenterPx, left: `${edgeOffsetPct}%`, right: `${edgeOffsetPct}%` }}
      />
      <div
        className="absolute h-[2px] rounded bg-emerald-400 transition-all duration-300"
        style={{ top: circleCenterPx, left: `${edgeOffsetPct}%`, width: `${filledPct}%` }}
      />
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {steps.map((step) => (
          <div key={step.id} className="flex flex-col items-center gap-1">
            <StepIcon step={step} compact={compact} />
            <div className={cn("text-center px-1", compact ? "text-[10px]" : "text-[11px]", stepLabelClasses[step.status])}>
              <span className="leading-tight">{step.label}</span>
              {!compact && step.description && step.status === "active" && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{step.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerticalStepper({ steps, compact }: { steps: WorkflowStep[]; compact: boolean }) {
  return (
    <div className="flex flex-col gap-0">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <StepIcon step={step} compact={compact} />
            {idx < steps.length - 1 && (
              <div className={cn(
                "w-[2px] flex-1 my-1 rounded",
                compact ? "min-h-[16px]" : "min-h-[24px]",
                step.status === "completed" ? "bg-emerald-400" : "bg-border",
              )} />
            )}
          </div>
          <div className={cn("pb-2 min-w-0", compact ? "pt-0.5" : "pt-0.5")}>
            <p className={cn(compact ? "text-[11px]" : "text-[12px]", stepLabelClasses[step.status])}>
              {step.label}
            </p>
            {step.description && (
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{step.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkflowStepper({ steps, orientation = "horizontal", compact = false, className }: WorkflowStepperProps) {
  return (
    <div className={cn("w-full", className)}>
      {orientation === "horizontal" ? (
        <HorizontalStepper steps={steps} compact={compact} />
      ) : (
        <VerticalStepper steps={steps} compact={compact} />
      )}
    </div>
  );
}
