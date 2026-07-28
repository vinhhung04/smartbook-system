import { useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff, Lock, BookOpen } from "lucide-react";
import { NavLink, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSubmit = async () => {
    if (!token) {
      toast.error("Missing or invalid reset link");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    try {
      setIsSubmitting(true);
      await authService.confirmPasswordReset(token, newPassword);
      toast.success("Password reset successful. Please sign in.");
      navigate("/login");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Reset failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 p-8">
        <motion.div animate={{ y: [0, 20, 0], x: [0, 10, 0] }} transition={{ duration: 6, repeat: Infinity }} className="absolute w-40 h-40 bg-blue-400/10 rounded-full top-10 left-10" />
        <motion.div animate={{ y: [0, -20, 0], x: [0, -10, 0] }} transition={{ duration: 8, repeat: Infinity, delay: 1 }} className="absolute w-60 h-60 bg-purple-400/10 rounded-full bottom-20 right-10" />
        <div className="relative z-10 text-center">
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
            <div className="w-16 h-16 rounded-[16px] bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center mx-auto mb-6 shadow-2xl">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
          </motion.div>
          <h1 className="text-4xl text-white mb-3 tracking-[-0.02em]" style={{ fontWeight: 800 }}>SmartBook</h1>
          <p className="text-blue-100 text-lg">Inventory Management System</p>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center p-8 bg-card">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <div className="w-12 h-12 rounded-[12px] bg-gradient-to-br from-blue-100 to-indigo-50 flex items-center justify-center border border-blue-200/40 mx-auto mb-3">
              <BookOpen className="w-6 h-6 text-blue-600" />
            </div>
            <h1 className="text-2xl tracking-[-0.02em]" style={{ fontWeight: 700 }}>SmartBook</h1>
          </div>

          <h2 className="text-[24px] text-foreground mb-2 tracking-[-0.02em]" style={{ fontWeight: 700 }}>Reset password</h2>
          <p className="text-muted-foreground mb-8">Enter a new password for your account.</p>

          {!token && (
            <p className="text-[13px] text-red-500 mb-4">This reset link is invalid or missing a token. Please request a new one.</p>
          )}

          <form
            className="space-y-4 mb-6"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div>
              <label className="text-[12px] text-muted-foreground block mb-2" style={{ fontWeight: 550 }}>New password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="Enter new password" autoComplete="new-password"
                  className="w-full pl-10 pr-10 py-3 bg-muted/50 border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-400/60 transition-all" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-2" style={{ fontWeight: 550 }}>Confirm new password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="Confirm new password" autoComplete="new-password"
                  className="w-full pl-10 pr-4 py-3 bg-muted/50 border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-400/60 transition-all" />
              </div>
            </div>

            <motion.button type="submit" disabled={isSubmitting || !token} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="w-full py-3 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] font-semibold shadow-lg shadow-blue-600/20 hover:shadow-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed">
              {isSubmitting ? "Resetting..." : "Reset password"}
            </motion.button>
          </form>

          <div className="text-center text-[12px] text-muted-foreground">
            <NavLink to="/login" className="text-blue-600 hover:text-blue-800 font-semibold">
              Back to login
            </NavLink>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
