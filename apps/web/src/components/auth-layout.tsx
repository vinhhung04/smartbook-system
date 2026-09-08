import { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BookOpen, Warehouse, Sparkles } from "lucide-react";

const FEATURES = [
  { icon: Warehouse, label: "Quản lý đa kho", desc: "Theo dõi tồn kho theo thời gian thực trên nhiều chi nhánh" },
  { icon: BookOpen, label: "Mượn & trả sách thông minh", desc: "Đặt sách, nhận mã QR, quản lý mượn trả tự động" },
  { icon: Sparkles, label: "Báo cáo & AI hỗ trợ", desc: "Phân tích tồn kho, gợi ý nhập hàng bằng AI" },
];

// A shelf of book spines instead of an abstract floating shape — grounded in the
// actual subject (a library) rather than a generic SaaS gradient-blob hero. Given
// real layout room at the foot of the panel (not hidden behind the centered copy),
// with a title-tick per spine and a shelf ledge so it reads unmistakably as books
// on a shelf rather than an abstract striped texture.
const SPINE_COLORS = ["bg-white/25", "bg-indigo-200/30", "bg-violet-200/30", "bg-teal-200/25", "bg-white/20", "bg-rose-200/25", "bg-blue-200/25"];
const SPINES = [
  { w: 16, h: 150 }, { w: 10, h: 195 }, { w: 22, h: 120 }, { w: 12, h: 230 }, { w: 18, h: 165 },
  { w: 26, h: 100 }, { w: 11, h: 185 }, { w: 15, h: 210 }, { w: 20, h: 135 }, { w: 10, h: 245 },
  { w: 24, h: 125 }, { w: 13, h: 175 }, { w: 17, h: 150 }, { w: 21, h: 110 }, { w: 12, h: 205 },
];

// The one spine that stands in for SmartBook itself on its own shelf — the single
// deliberate accent, everything else stays in the quiet indigo/violet family.
const FEATURED_SPINE_INDEX = 7;

function BookshelfSpines() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="relative z-10 w-full" aria-hidden="true">
      <div className="flex items-end justify-center gap-1.5 px-6">
        {SPINES.map((spine, i) => {
          const featured = i === FEATURED_SPINE_INDEX;
          return (
            <motion.div
              key={i}
              className={`relative rounded-t-[3px] shadow-[inset_1px_0_0_rgba(255,255,255,0.15)] ${featured ? "bg-amber-300/70" : SPINE_COLORS[i % SPINE_COLORS.length]}`}
              style={{ width: spine.w, height: spine.h, transformOrigin: "bottom" }}
              initial={shouldReduceMotion ? false : { scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
            >
              {spine.w > 12 && (
                <span
                  className={`absolute left-1/2 top-4 h-[2px] -translate-x-1/2 rounded-full ${featured ? "bg-amber-900/40" : "bg-white/35"}`}
                  style={{ width: spine.w - 8 }}
                />
              )}
              {featured && !shouldReduceMotion && (
                <motion.span
                  className="absolute inset-0 rounded-t-[3px] bg-amber-200/60"
                  animate={{ opacity: [0.4, 0.9, 0.4] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </motion.div>
          );
        })}
      </div>
      <div className="relative mt-0 h-3 w-full bg-white/15">
        <div className="absolute inset-x-0 top-0 h-px bg-white/30" />
      </div>
    </div>
  );
}

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

function LogoMark({ size = "lg" }: { size?: "lg" | "sm" }) {
  if (size === "sm") {
    return (
      <div className="w-12 h-12 rounded-[12px] bg-gradient-to-br from-indigo-100 to-violet-50 dark:from-indigo-500/15 dark:to-violet-500/10 flex items-center justify-center border border-indigo-200/40 dark:border-indigo-500/20 mx-auto mb-3">
        <BookOpen className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
      </div>
    );
  }
  return (
    <div className="w-16 h-16 rounded-[16px] bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-indigo-950/30">
      <BookOpen className="w-8 h-8 text-white" />
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background">
      {/* Left - Branding */}
      <div className="hidden lg:flex flex-col overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600">
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 pt-10">
          <motion.div initial={shouldReduceMotion ? false : { scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
            <LogoMark />
          </motion.div>

          <h1 className="text-4xl text-white mb-3 tracking-[-0.02em] font-extrabold">SmartBook</h1>
          <p className="text-indigo-100 text-lg mb-8">Quản lý thư viện &amp; kho vận thông minh</p>

          <motion.div initial={shouldReduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="space-y-6">
            {FEATURES.map((f, i) => (
              <motion.div key={f.label} initial={shouldReduceMotion ? false : { x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.1 }} className="flex items-center gap-4 text-left">
                <f.icon className="w-6 h-6 text-indigo-100 shrink-0" />
                <div>
                  <p className="text-white font-semibold">{f.label}</p>
                  <p className="text-indigo-100 text-sm">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        <BookshelfSpines />
      </div>

      {/* Right - Form */}
      <div className="flex flex-col items-center justify-center p-8 bg-card">
        <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <LogoMark size="sm" />
            <h1 className="text-2xl tracking-[-0.02em] font-bold text-foreground">SmartBook</h1>
          </div>

          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60 mb-2">SmartBook · Nội bộ</p>
          <h2 className="text-[24px] text-foreground mb-2 tracking-[-0.02em] font-bold">{title}</h2>
          <p className="text-muted-foreground mb-8">{subtitle}</p>

          {children}

          {footer}
        </motion.div>
      </div>
    </div>
  );
}
