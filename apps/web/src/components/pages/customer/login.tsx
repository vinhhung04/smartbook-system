import { useState } from 'react';
import { useNavigate, NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Eye, EyeOff, Mail, Lock, BookOpen, Calendar, Star, ShieldCheck, ArrowRight } from 'lucide-react';
import { authService } from '@/services/auth';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';

export function CustomerLoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!identifier || !password) {
      toast.error('Please provide account and password');
      return;
    }

    try {
      setIsSubmitting(true);
      const loginData = await authService.login({ identifier, password });
      if (!loginData.user?.roles?.includes('CUSTOMER')) {
        toast.error('This account is not a customer account');
        await authService.logout();
        return;
      }
      toast.success('Login successful');
      navigate('/customer');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Login failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-white">
      {/* Left — Brand Panel */}
      <div className="hidden lg:flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-700 p-10">
        {/* Decorative shapes */}
        <motion.div
          animate={{ y: [0, 20, 0], x: [0, 10, 0] }}
          transition={{ duration: 7, repeat: Infinity }}
          className="absolute w-48 h-48 bg-blue-400/10 rounded-full top-16 left-10"
        />
        <motion.div
          animate={{ y: [0, -20, 0], x: [0, -10, 0] }}
          transition={{ duration: 9, repeat: Infinity, delay: 1.5 }}
          className="absolute w-64 h-64 bg-purple-400/10 rounded-full bottom-24 right-8"
        />
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
          className="absolute w-36 h-36 border-2 border-white/10 rounded-xl top-1/3 right-1/4"
        />
        <motion.div
          animate={{ y: [-15, 15, -15] }}
          transition={{ duration: 5, repeat: Infinity }}
          className="absolute w-20 h-20 border border-white/10 rounded-full bottom-32 left-16"
        />

        <div className="relative z-10 text-center max-w-sm">
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
            <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center mx-auto mb-6 shadow-2xl">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="text-4xl text-white mb-3 tracking-tight" style={{ fontWeight: 800 }}>
            SmartBook
          </motion.h1>
          <p className="text-blue-100 text-lg mb-10">Your Personal Reading Portal</p>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="space-y-5 text-left">
            {[
              { icon: BookOpen, title: 'Browse Catalog', desc: 'Explore thousands of titles from our collection' },
              { icon: Calendar, title: 'Reserve Books', desc: 'Pick up ready reservations at your convenience' },
              { icon: Star, title: 'Track Loans', desc: 'Monitor due dates and manage renewals' },
              { icon: ShieldCheck, title: 'Earn Rewards', desc: 'Loyalty program for active readers' },
            ].map((f, i) => (
              <motion.div key={i} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center shrink-0">
                  <f.icon className="w-5 h-5 text-blue-200" />
                </div>
                <div>
                  <p className="text-white text-[14px]" style={{ fontWeight: 600 }}>{f.title}</p>
                  <p className="text-blue-100 text-[12px]">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Right — Login Form */}
      <div className="flex flex-col items-center justify-center p-8 bg-white">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-100 to-blue-50 flex items-center justify-center border border-indigo-200/40 mx-auto mb-3 shadow-lg">
              <BookOpen className="w-6 h-6 text-indigo-600" />
            </div>
            <p className="text-[12px] text-muted-foreground">Customer Portal</p>
          </div>

          <div className="mb-8">
            <h2 className="text-[26px] tracking-tight text-foreground" style={{ fontWeight: 700 }}>Welcome back</h2>
            <p className="text-[13px] text-muted-foreground mt-1.5">Sign in to your customer account</p>
          </div>

          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
            {/* Email or Username */}
            <div>
              <label htmlFor="identifier" className="block text-[12px] font-medium text-muted-foreground mb-1.5">
                Email or Username
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Enter your email or username"
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-input bg-background text-[13px] placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-[12px] font-medium text-muted-foreground mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full pl-10 pr-11 py-3 rounded-xl border border-input bg-background text-[13px] placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 rounded border-input bg-background accent-primary" />
                <span className="text-[12px] text-muted-foreground">Remember me</span>
              </label>
              <button type="button" className="text-[12px] text-primary hover:text-primary/80 transition-colors" style={{ fontWeight: 500 }}>
                Forgot password?
              </button>
            </div>

            {/* Submit */}
            <motion.button type="submit" disabled={isSubmitting}
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-[14px] font-semibold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed mt-2">
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                  Signing in...
                </span>
              ) : 'Sign In'}
            </motion.button>
          </form>

          <div className="mt-6 text-center text-[13px] text-muted-foreground">
            Don't have an account?{' '}
            <NavLink to="/customer/register" className="text-primary font-semibold hover:text-primary/80 transition-colors">
              Create account
            </NavLink>
          </div>

          {/* Back to admin */}
          <div className="mt-5 pt-5 border-t border-border text-center">
            <NavLink to="/login" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
              <ArrowRight className="w-3 h-3 rotate-180" />
              Back to staff login
            </NavLink>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
