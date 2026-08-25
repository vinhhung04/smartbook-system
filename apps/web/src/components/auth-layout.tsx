import { ReactNode } from "react";
import { motion } from "motion/react";
import { BookOpen, Warehouse, Sparkles } from "lucide-react";

const FEATURES = [
  { icon: Warehouse, label: "Quản lý đa kho", desc: "Theo dõi tồn kho theo thời gian thực trên nhiều chi nhánh" },
  { icon: BookOpen, label: "Mượn & trả sách thông minh", desc: "Đặt sách, nhận mã QR, quản lý mượn trả tự động" },
  { icon: Sparkles, label: "Báo cáo & AI hỗ trợ", desc: "Phân tích tồn kho, gợi ý nhập hàng bằng AI" },
];

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
    <div className="w-16 h-16 rounded-[16px] bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center mx-auto mb-6 shadow-2xl">
      <BookOpen className="w-8 h-8 text-white" />
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background">
      {/* Left - Branding */}
      <div className="hidden lg:flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 p-8">
        {/* Animated Shapes */}
        <motion.div animate={{ y: [0, 20, 0], x: [0, 10, 0] }} transition={{ duration: 6, repeat: Infinity }} className="absolute w-40 h-40 bg-white/10 rounded-full top-10 left-10" />
        <motion.div animate={{ y: [0, -20, 0], x: [0, -10, 0] }} transition={{ duration: 8, repeat: Infinity, delay: 1 }} className="absolute w-60 h-60 bg-white/10 rounded-full bottom-20 right-10" />
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }} className="absolute w-32 h-32 border-2 border-white/15 rounded-lg top-1/3 right-1/4" />

        <div className="relative z-10 text-center">
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
            <LogoMark />
          </motion.div>

          <h1 className="text-4xl text-white mb-3 tracking-[-0.02em] font-extrabold">SmartBook</h1>
          <p className="text-indigo-100 text-lg mb-8">Quản lý thư viện &amp; kho vận thông minh</p>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="space-y-6">
            {FEATURES.map((f, i) => (
              <motion.div key={f.label} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.1 }} className="flex items-center gap-4 text-left">
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
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
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
