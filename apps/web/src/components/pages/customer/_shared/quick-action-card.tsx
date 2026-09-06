import { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';

interface QuickActionCardProps {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export function QuickActionCard({ to, title, description, icon: Icon }: QuickActionCardProps) {
  return (
    <NavLink
      to={to}
      className="group rounded-[14px] border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
    >
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-indigo-100 to-cyan-100 text-indigo-700 transition-transform duration-200 group-hover:scale-105">
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="mt-3 text-[14px] text-foreground" style={{ fontWeight: 700 }}>
        {title}
      </h3>
      <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
    </NavLink>
  );
}
