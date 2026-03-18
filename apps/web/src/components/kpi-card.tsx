import { type LucideIcon } from "lucide-react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { stagger } from "./motion-utils";
import { useEffect, useState } from "react";

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const controls = animate(0, value, {
      duration: 1.2,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return controls.stop;
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

export function KpiCard({ title, value, numericValue, change, icon: Icon, trend, tintFrom, tintTo, iconBg, iconColor, accentBorder }: {
  title: string; value: string; numericValue?: number; change?: string; icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  tintFrom?: string; tintTo?: string; iconBg?: string; iconColor?: string; accentBorder?: string;
}) {
  return (
    <motion.div
      variants={stagger.item}
      whileHover={{ y: -3, boxShadow: "0 12px 32px -4px rgba(0,0,0,0.08)" }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={`relative overflow-hidden bg-white rounded-[14px] border border-white/80 p-5 flex flex-col gap-3 shadow-[0_1px_4px_rgba(0,0,0,0.03)] cursor-default`}
    >
      {/* Accent top border */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] rounded-t-[14px] bg-gradient-to-r ${accentBorder || "from-indigo-500 to-blue-500"}`} />
      {/* Tinted background */}
      <div className={`absolute inset-0 bg-gradient-to-br ${tintFrom || "from-indigo-50/40"} ${tintTo || "to-transparent"} pointer-events-none`} />

      <div className="flex items-center justify-between relative">
        <span className="text-[11px] text-slate-500 uppercase tracking-[0.06em]" style={{ fontWeight: 550 }}>{title}</span>
        <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${iconBg || "bg-indigo-100/80"}`}>
          <Icon className={`w-[18px] h-[18px] ${iconColor || "text-indigo-600"}`} />
        </div>
      </div>
      <div className="flex items-end gap-2.5 relative">
        <span className="text-[30px] tracking-[-0.03em]" style={{ fontWeight: 700, lineHeight: 1 }}>
          {numericValue !== undefined ? <AnimatedNumber value={numericValue} /> : value}
        </span>
        {change && (
          <span className={`text-[11px] mb-[4px] px-2 py-0.5 rounded-full ${
            trend === "up" ? "text-emerald-700 bg-emerald-50" : trend === "down" ? "text-red-600 bg-red-50" : "text-slate-500 bg-slate-50"
          }`} style={{ fontWeight: 550 }}>
            {change}
          </span>
        )}
      </div>
    </motion.div>
  );
}
