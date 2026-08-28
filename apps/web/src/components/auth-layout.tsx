import { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BookOpen, Warehouse, Sparkles } from "lucide-react";

const FEATURES = [
  { icon: Warehouse, label: "Quản lý đa kho", desc: "Theo dõi tồn kho theo thời gian thực trên nhiều chi nhánh" },
  { icon: BookOpen, label: "Mượn & trả sách thông minh", desc: "Đặt sách, nhận mã QR, quản lý mượn trả tự động" },
  { icon: Sparkles, label: "Báo cáo & AI hỗ trợ", desc: "Phân tích tồn kho, gợi ý nhập hàng bằng AI" },
];

// A shelf of book spines instead of an abstract floating shape — grounded in the
// actual subject (a library) rather than a generic SaaS gradient-blob hero.
const SPINE_COLORS = ["bg-white/20", "bg-indigo-300/25", "bg-violet-300/25", "bg-teal-300/20", "bg-amber-300/20", "bg-white/15", "bg-rose-300/20"];
const SPINES = [
  { w: 14, h: 88 }, { w: 9, h: 120 }, { w: 20, h: 70 }, { w: 11, h: 140 }, { w: 16, h: 95 },
  { w: 24, h: 60 }, { w: 10, h: 110 }, { w: 13, h: 130 }, { w: 18, h: 80 }, { w: 9, h: 150 },
  { w: 22, h: 75 }, { w: 12, h: 105 }, { w: 15, h: 90 }, { w: 19, h: 65 }, { w: 11, h: 125 },
];

function BookshelfSpines() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center gap-1.5 px-4" aria-hidden="true">
      {SPINES.map((spine, i) => (
        <motion.div
          key={i}
          className={`rounded-t-[3px] ${SPINE_COLORS[i % SPINE_COLORS.length]}`}
          style={{ width: spine.w }}
          initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: spine.h, opacity: 1 }}
          transition={{ duration: 0.5, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
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
      <div className="hidden lg:flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 p-8">
        <BookshelfSpines />

        <div className="relative z-10 text-center">
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
      </div>

      {/* Right - Form */}
      <div className="flex flex-col items-center justify-center p-8 bg-card">
        <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <LogoMark size="sm" />
            <h1 className="text-2xl tracking-[-0.02em] font-bold text-foreground">SmartBook</h1>
          </div>

          <h2 className="text-[24px] text-foreground mb-2 tracking-[-0.02em] font-bold">{title}</h2>
          <p className="text-muted-foreground mb-8">{subtitle}</p>

          {children}

          {footer}
        </motion.div>
      </div>
    </div>
  );
}
