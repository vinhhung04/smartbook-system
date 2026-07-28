import { useState } from "react";
import { motion } from "motion/react";
import { Mail, BookOpen, ArrowLeft } from "lucide-react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";

export function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!identifier) {
      toast.error("Please enter your email or username");
      return;
    }

    try {
      setIsSubmitting(true);
      await authService.requestPasswordReset(identifier);
      setSubmitted(true);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Request failed"));
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

          {submitted ? (
            <>
              <h2 className="text-[24px] text-foreground mb-2 tracking-[-0.02em]" style={{ fontWeight: 700 }}>Check your email</h2>
              <p className="text-muted-foreground mb-8">If an account exists for that email or username, we've sent a password reset link to it.</p>
            </>
          ) : (
            <>
              <h2 className="text-[24px] text-foreground mb-2 tracking-[-0.02em]" style={{ fontWeight: 700 }}>Forgot password?</h2>
              <p className="text-muted-foreground mb-8">Enter your email or username and we'll send you a link to reset your password.</p>

              <form
                className="space-y-4 mb-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
              >
                <div>
                  <label className="text-[12px] text-muted-foreground block mb-2" style={{ fontWeight: 550 }}>Email or Username</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={identifier} onChange={e => setIdentifier(e.target.value)} type="text" placeholder="Enter email or username" autoComplete="username"
                      className="w-full pl-10 pr-4 py-3 bg-muted/50 border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-400/60 transition-all" />
                  </div>
                </div>

                <motion.button type="submit" disabled={isSubmitting} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  className="w-full py-3 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] font-semibold shadow-lg shadow-blue-600/20 hover:shadow-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed">
                  {isSubmitting ? "Sending..." : "Send reset link"}
                </motion.button>
              </form>
            </>
          )}

          <div className="text-center text-[12px] text-muted-foreground">
            <NavLink to="/login" className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-semibold">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to login
            </NavLink>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
