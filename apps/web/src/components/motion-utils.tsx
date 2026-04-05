import { motion } from "motion/react";
import type { ReactNode } from "react";

export const stagger = {
  container: {
    hidden: {},
    show: { transition: { staggerChildren: 0.05 } },
  },
  item: {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  },
};

export const fadeIn = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

export const slideIn = {
  hidden: { opacity: 0, x: -16 },
  show: { opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

export function PageWrapper({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={stagger.container}
      className={`p-6 lg:p-8 max-w-7xl mx-auto ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function FadeItem({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={stagger.item as any} className={className}>
      {children}
    </motion.div>
  );
}

export function AnimatedCounter({ value, className = "" }: { value: number; className?: string }) {
  return (
    <motion.span
      className={className}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      {value.toLocaleString()}
    </motion.span>
  );
}
