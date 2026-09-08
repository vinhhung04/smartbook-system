import { ReactNode } from 'react';
import { visualEnhancementTokens } from './visual-enhancement-tokens';

interface CustomerStatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  variant?: 'default' | 'info' | 'success' | 'warning' | 'critical';
}

export function CustomerStatCard({ label, value, hint, icon, variant = 'default' }: CustomerStatCardProps) {
  return (
    <div className={`rounded-[14px] border p-5 ${visualEnhancementTokens.statVariants[variant]} ${visualEnhancementTokens.motion.card} hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]`}>
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-[20px] text-foreground" style={{ fontWeight: 700 }}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-[12px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
