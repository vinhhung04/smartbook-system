import { useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff, Mail, Lock, BookOpen, Check, X } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";

export function RegisterPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState("");
  const [formData, setFormData] = useState({ firstName: "", lastName: "", email: "", organization: "", password: "" });

  const passwordChecks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
  };

  const allChecksPassed = Object.values(passwordChecks).every(Boolean);

  const handleRegister = async () => {
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.organization || !password) {
      toast.error("Please fill in all fields");
      return;
    }
    if (!allChecksPassed) {
      toast.error("Password requirements not met");
      return;
    }

    try {
      setIsSubmitting(true);
      await authService.register({
        username: `${formData.firstName}.${formData.lastName}`.toLowerCase().replace(/\s+/g, "."),
        email: formData.email,
        full_name: `${formData.firstName} ${formData.lastName}`.trim(),
        password,
      });
      toast.success("Account created successfully. Please sign in.");
      navigate("/login");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Register failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background">
      {/* Left - Branding */}
      <div className="hidden lg:flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 p-8">
        {/* Animated Shapes */}
        <motion.div animate={{ y: [0, 30, 0], x: [0, 15, 0] }} transition={{ duration: 7, repeat: Infinity }} className="absolute w-52 h-52 bg-indigo-400/10 rounded-full top-16 right-20" />
        <motion.div animate={{ y: [0, -25, 0], x: [0, -12, 0] }} transition={{ duration: 9, repeat: Infinity, delay: 1.5 }} className="absolute w-64 h-64 bg-pink-400/10 rounded-full bottom-10 left-10" />

        <div className="relative z-10 text-center">
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
            <div className="w-16 h-16 rounded-[16px] bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center mx-auto mb-6 shadow-2xl">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
          </motion.div>

          <h1 className="text-4xl text-white mb-3 tracking-[-0.02em]" style={{ fontWeight: 800 }}>SmartBook</h1>
          <p className="text-purple-100 text-lg mb-8">Start managing inventory like a pro</p>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="space-y-5">
            {[
              { icon: "👥", label: "Team Collaboration", desc: "Invite your team and work together" },
              { icon: "🏢", label: "Multi-Warehouse", desc: "Support for multiple locations" },
              { icon: "📊", label: "AI Analytics", desc: "Smart recommendations powered by AI" },
            ].map((f, i) => (
              <motion.div key={i} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.1 }} className="flex items-center gap-4 text-left">
                <span className="text-3xl">{f.icon}</span>
                <div>
                  <p className="text-white" style={{ fontWeight: 600 }}>{f.label}</p>
                  <p className="text-purple-100 text-sm">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Right - Register Form */}
      <div className="flex flex-col items-center justify-center p-8 bg-card">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <div className="w-12 h-12 rounded-[12px] bg-gradient-to-br from-indigo-100 to-purple-50 flex items-center justify-center border border-indigo-200/40 mx-auto mb-3">
              <BookOpen className="w-6 h-6 text-indigo-600" />
            </div>
            <h1 className="text-2xl tracking-[-0.02em]" style={{ fontWeight: 700 }}>SmartBook</h1>
          </div>

          <h2 className="text-[24px] text-foreground mb-2 tracking-[-0.02em]" style={{ fontWeight: 700 }}>Create your account</h2>
          <p className="text-muted-foreground mb-8">Join SmartBook to streamline your inventory</p>

          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] text-muted-foreground block mb-2" style={{ fontWeight: 550 }}>First Name</label>
                <input value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} type="text" placeholder="John"
                  className="w-full px-4 py-3 bg-muted/50 border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-indigo-500/10 focus:border-indigo-400/60 transition-all" />
              </div>
              <div>
                <label className="text-[12px] text-muted-foreground block mb-2" style={{ fontWeight: 550 }}>Last Name</label>
                <input value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} type="text" placeholder="Doe"
                  className="w-full px-4 py-3 bg-muted/50 border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-indigo-500/10 focus:border-indigo-400/60 transition-all" />
              </div>
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-2" style={{ fontWeight: 550 }}>Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} type="email" placeholder="john@company.com"
                  className="w-full pl-10 pr-4 py-3 bg-muted/50 border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-indigo-500/10 focus:border-indigo-400/60 transition-all" />
              </div>
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-2" style={{ fontWeight: 550 }}>Organization</label>
              <input value={formData.organization} onChange={e => setFormData({ ...formData, organization: e.target.value })} type="text" placeholder="Your company name"
                className="w-full px-4 py-3 bg-muted/50 border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-indigo-500/10 focus:border-indigo-400/60 transition-all" />
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-2" style={{ fontWeight: 550 }}>Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="Create a strong password"
                  className="w-full pl-10 pr-10 py-3 bg-muted/50 border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-indigo-500/10 focus:border-indigo-400/60 transition-all" />
                <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Password Strength */}
              {password && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 space-y-2">
                  {[
                    { label: "At least 8 characters", check: passwordChecks.length },
                    { label: "Uppercase letter", check: passwordChecks.uppercase },
                    { label: "Number", check: passwordChecks.number },
                  ].map(p => (
                    <div key={p.label} className="flex items-center gap-2 text-[11px]">
                      {p.check ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <X className="w-4 h-4 text-slate-300" />
                      )}
                      <span className={p.check ? "text-emerald-600" : "text-slate-500"}>{p.label}</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-slate-300" />
              <span className="text-[12px] text-slate-600">I agree to the Terms of Service</span>
            </label>
          </div>

          <motion.button onClick={handleRegister} disabled={!allChecksPassed || isSubmitting} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            className={`w-full py-3 rounded-[10px] text-white text-[13px] font-semibold transition-all ${allChecksPassed ? "bg-gradient-to-r from-indigo-600 to-purple-600 shadow-lg shadow-indigo-600/20 hover:shadow-xl" : "bg-slate-300 cursor-not-allowed"}`}>
            {isSubmitting ? "Creating..." : "Create Account"}
          </motion.button>

          <div className="text-center text-[12px] text-muted-foreground mt-4">
            Already have an account?{" "}
            <NavLink to="/login" className="text-indigo-600 hover:text-indigo-800 font-semibold">
              Sign in
            </NavLink>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
