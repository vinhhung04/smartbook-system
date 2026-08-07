import { motion } from "motion/react";
import { cn } from "./utils";

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Unique id for the animated background across renders of this control. */
  layoutId: string;
  /** Tailwind gradient classes for the active-pill background, e.g. "from-blue-600 to-indigo-600". */
  gradientClassName?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  gradientClassName = "from-indigo-600 to-blue-600",
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={cn("flex items-center gap-1 bg-card border border-input rounded-lg p-[3px] shadow-sm", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "relative cursor-pointer px-3.5 py-1.5 rounded-lg text-[12px] transition-all duration-160 font-medium",
            value === option.value ? "text-white" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === option.value && (
            <motion.div
              layoutId={layoutId}
              className={cn("absolute inset-0 rounded-lg bg-gradient-to-r shadow-sm", gradientClassName)}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          <span className="relative z-10">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
