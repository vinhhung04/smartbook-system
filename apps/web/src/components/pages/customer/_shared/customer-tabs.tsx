import { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';

export interface CustomerTabItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

interface CustomerTabsProps {
  items: CustomerTabItem[];
}

export function CustomerTabs({ items }: CustomerTabsProps) {
  return (
    <nav className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[13px] transition-colors ${
              isActive
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'border-border bg-card text-slate-600 dark:text-slate-300 hover:bg-muted'
            }`
          }
        >
          <item.icon className="h-3.5 w-3.5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
