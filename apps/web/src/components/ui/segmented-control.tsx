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
  /** @deprecated pages used to pick their own gradient; the web style has one accent, so it is ignored. */
  gradientClassName?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={cn("flex items-center gap-1 rounded-full border border-border bg-card p-[3px]", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "relative cursor-pointer rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            value === option.value ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === option.value && (
            <motion.div
              layoutId={layoutId}
              className="absolute inset-0 rounded-full bg-primary"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          <span className="relative z-10">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
