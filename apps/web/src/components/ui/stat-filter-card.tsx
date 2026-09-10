import type { ComponentType } from "react";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import { StatCard } from "./stat-card";

interface StatFilterCardProps {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  variant: "default" | "success" | "warning" | "danger" | "info" | "primary";
  isActive: boolean;
  onClick: () => void;
  /** motion layoutId shared across the cards in one filter group, so the active badge slides between them */
  layoutId: string;
}

/** A StatCard that doubles as a filter toggle: click to filter by it, shown active via a corner checkmark badge. */
export function StatFilterCard({ label, value, icon, variant, isActive, onClick, layoutId }: StatFilterCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className="group relative w-full rounded-xl text-left transition-transform duration-150 active:scale-[0.97]"
    >
      <StatCard label={label} value={value} icon={icon} variant={variant} animateValue />
      {isActive && (
        <motion.span
          layoutId={layoutId}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
        >
          <Check className="h-3 w-3" />
        </motion.span>
      )}
    </button>
  );
}
