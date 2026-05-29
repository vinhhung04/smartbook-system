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
  active: "bg-indigo-600 border-indigo-600 text-white ring-2 ring-indigo-200",
  pending: "bg-white border-slate-300 text-slate-400",
  error: "bg-red-50 border-red-400 text-red-600",
};

const stepLabelClasses: Record<StepStatus, string> = {
  completed: "text-emerald-700 font-medium",
  active: "text-indigo-700 font-semibold",
  pending: "text-muted-foreground",
  error: "text-red-600 font-medium",
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
  return (
    <div className="flex items-center w-full overflow-x-auto">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex items-center min-w-0 flex-1">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <StepIcon step={step} compact={compact} />
            <div className={cn("text-center max-w-[80px]", compact ? "text-[10px]" : "text-[11px]", stepLabelClasses[step.status])}>
              <span className="leading-tight">{step.label}</span>
              {!compact && step.description && step.status === "active" && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{step.description}</p>
              )}
            </div>
          </div>
          {idx < steps.length - 1 && (
            <div className={cn(
              "h-[2px] flex-1 mx-2 rounded transition-colors",
              steps[idx + 1].status === "pending" ? "bg-slate-200" : "bg-emerald-400",
            )} />
          )}
        </div>
      ))}
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
                step.status === "completed" ? "bg-emerald-400" : "bg-slate-200",
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
