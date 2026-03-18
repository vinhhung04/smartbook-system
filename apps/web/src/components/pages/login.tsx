import { useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff, Mail, Lock, BookOpen, Warehouse, BarChart3, Users } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";

export function LoginPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [credentials, setCredentials] = useState({ identifier: "admin@smartbook.vn", password: "password123" });

  const handleLogin = async () => {
    if (!credentials.identifier || !credentials.password) {
      toast.error("Please enter both account and password");
      return;
    }

    try {
      setIsSubmitting(true);
      await authService.login(credentials);
      toast.success("Login successful");
      navigate("/");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Login failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-white">
      {/* Left - Branding */}
      <div className="hidden lg:flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 p-8">
        {/* Animated Shapes */}
        <motion.div animate={{ y: [0, 20, 0], x: [0, 10, 0] }} transition={{ duration: 6, repeat: Infinity }} className="absolute w-40 h-40 bg-blue-400/10 rounded-full top-10 left-10" />
        <motion.div animate={{ y: [0, -20, 0], x: [0, -10, 0] }} transition={{ duration: 8, repeat: Infinity, delay: 1 }} className="absolute w-60 h-60 bg-purple-400/10 rounded-full bottom-20 right-10" />
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }} className="absolute w-32 h-32 border-2 border-blue-300/20 rounded-lg top-1/3 right-1/4" />

        <div className="relative z-10 text-center">
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
            <div className="w-16 h-16 rounded-[16px] bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center mx-auto mb-6 shadow-2xl">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
          </motion.div>

          <h1 className="text-4xl text-white mb-3 tracking-[-0.02em]" style={{ fontWeight: 800 }}>SmartBook</h1>
          <p className="text-blue-100 text-lg mb-8">Inventory Management System</p>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="space-y-6">
            {[
              { icon: Warehouse, label: "Multi-Warehouse", desc: "Manage inventory across multiple locations" },
              { icon: BarChart3, label: "Smart Analytics", desc: "Data-driven insights for optimization" },
              { icon: Users, label: "Team Collaboration", desc: "Seamless workflows for your team" },
            ].map((f, i) => (
              <motion.div key={i} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.1 }} className="flex items-center gap-4 text-left">
                <f.icon className="w-6 h-6 text-blue-200 shrink-0" />
                <div>
                  <p className="text-white" style={{ fontWeight: 600 }}>{f.label}</p>
                  <p className="text-blue-100 text-sm">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Right - Login Form */}
      <div className="flex flex-col items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <div className="w-12 h-12 rounded-[12px] bg-gradient-to-br from-blue-100 to-indigo-50 flex items-center justify-center border border-blue-200/40 mx-auto mb-3">
              <BookOpen className="w-6 h-6 text-blue-600" />
            </div>
            <h1 className="text-2xl tracking-[-0.02em]" style={{ fontWeight: 700 }}>SmartBook</h1>
          </div>

          <h2 className="text-[24px] mb-2 tracking-[-0.02em]" style={{ fontWeight: 700 }}>Welcome back</h2>
          <p className="text-slate-500 mb-8">Sign in to your account to continue</p>

          <div className="space-y-4 mb-6">
            <div>
              <label className="text-[12px] text-slate-600 block mb-2" style={{ fontWeight: 550 }}>Email or Username</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={credentials.identifier} onChange={e => setCredentials({ ...credentials, identifier: e.target.value })} type="text" placeholder="admin@smartbook.vn"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-[10px] text-[13px] outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-400/60 transition-all" />
              </div>
            </div>

            <div>
              <label className="text-[12px] text-slate-600 block mb-2" style={{ fontWeight: 550 }}>Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={credentials.password} onChange={e => setCredentials({ ...credentials, password: e.target.value })} type={showPassword ? "text" : "password"} placeholder="password123"
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-[10px] text-[13px] outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-400/60 transition-all" />
                <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-slate-300" />
              <span className="text-[12px] text-slate-600">Remember me</span>
            </label>
          </div>

          <motion.button onClick={handleLogin} disabled={isSubmitting} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            className="w-full py-3 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] font-semibold shadow-lg shadow-blue-600/20 hover:shadow-xl transition-all mb-4 disabled:opacity-70 disabled:cursor-not-allowed">
            {isSubmitting ? "Signing in..." : "Sign In"}
          </motion.button>

          <div className="text-center text-[12px] text-slate-600">
            Don't have an account?{" "}
            <NavLink to="/register" className="text-blue-600 hover:text-blue-800 font-semibold">
              Sign up
            </NavLink>
          </div>

          <button className="w-full mt-6 py-2.5 rounded-[10px] border border-slate-200 text-slate-700 text-[12px] hover:bg-slate-50 transition-all">
            Forgot password?
          </button>
        </motion.div>
      </div>
    </div>
  );
}
