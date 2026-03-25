import { useState } from 'react';
import { useNavigate, NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Eye, EyeOff, Mail, Lock, User, BookOpen, ArrowRight, CheckCircle2, Star, Calendar, ShieldCheck } from 'lucide-react';
import { authService } from '@/services/auth';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';

export function CustomerRegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    username: '',
    password: '',
    confirm_password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const passwordStrength = (() => {
    const p = form.password;
    if (!p) return { score: 0, label: '', color: '' };
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' };
    if (score === 2) return { score, label: 'Fair', color: 'bg-amber-500' };
    if (score === 3) return { score, label: 'Good', color: 'bg-blue-500' };
    return { score, label: 'Strong', color: 'bg-emerald-500' };
  })();

  const handleSubmit = async () => {
    if (!form.full_name || !form.email || !form.username || !form.password) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (form.password !== form.confirm_password) {
      toast.error('Passwords do not match');
      return;
    }
    if (form.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (!agreed) {
      toast.error('Please agree to the terms of service');
      return;
    }

    try {
      setIsSubmitting(true);
      await authService.register({
        full_name: form.full_name,
        email: form.email,
        username: form.username,
        password: form.password,
      });
      toast.success('Registration successful. Please sign in.');
      navigate('/customer/login');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Register failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background">
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

        <div className="relative z-10 text-center max-w-sm">
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
            <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center mx-auto mb-6 shadow-2xl">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="text-4xl text-white mb-3 tracking-tight" style={{ fontWeight: 800 }}>
            Join SmartBook
          </motion.h1>
          <p className="text-blue-100 text-lg mb-10">Start your reading journey today</p>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="space-y-4 text-left">
            {[
              { icon: CheckCircle2, title: 'Free account registration', desc: 'Join in seconds with your email' },
              { icon: BookOpen, title: 'Browse thousands of titles', desc: 'Access our full catalog online' },
              { icon: Star, title: 'Earn reading rewards', desc: 'Loyalty points for every borrow' },
              { icon: Calendar, title: 'Reserve & borrow books', desc: 'Convenient pickup at your local branch' },
            ].map((f, i) => (
              <motion.div key={i} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-lg bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center shrink-0">
                  <f.icon className="w-4 h-4 text-blue-200" />
                </div>
                <div>
                  <p className="text-white text-[13px]" style={{ fontWeight: 600 }}>{f.title}</p>
                  <p className="text-blue-100 text-[11px]">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Right — Registration Form */}
      <div className="flex flex-col items-center justify-center p-8 bg-card">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-100 to-blue-50 flex items-center justify-center border border-indigo-200/40 mx-auto mb-3 shadow-lg">
              <BookOpen className="w-6 h-6 text-indigo-600" />
            </div>
            <p className="text-[12px] text-muted-foreground">Create your account</p>
          </div>

          <div className="mb-7">
            <h2 className="text-[26px] tracking-tight text-foreground" style={{ fontWeight: 700 }}>Create account</h2>
            <p className="text-[13px] text-muted-foreground mt-1.5">Join SmartBook and start reading today</p>
          </div>

          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
            {/* Full Name */}
            <div>
              <label htmlFor="full_name" className="block text-[12px] font-medium text-muted-foreground mb-1.5">Full Name *</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  id="full_name"
                  type="text"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  placeholder="Nguyen Van A"
                  autoComplete="name"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-input bg-background text-[13px] placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-[12px] font-medium text-muted-foreground mb-1.5">Email *</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-input bg-background text-[13px] placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
                />
              </div>
            </div>

            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-[12px] font-medium text-muted-foreground mb-1.5">Username *</label>
              <input
                id="username"
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="your_username"
                autoComplete="username"
                className="w-full px-4 py-3 rounded-xl border border-input bg-background text-[13px] placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-[12px] font-medium text-muted-foreground mb-1.5">Password *</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Min. 6 characters"
                  autoComplete="new-password"
                  className="w-full pl-10 pr-11 py-3 rounded-xl border border-input bg-background text-[13px] placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Password strength */}
              {form.password && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${passwordStrength.color}`}
                        style={{ width: `${(passwordStrength.score / 4) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">{passwordStrength.label}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirm_password" className="block text-[12px] font-medium text-muted-foreground mb-1.5">Confirm Password *</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  id="confirm_password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={form.confirm_password}
                  onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  className="w-full pl-10 pr-11 py-3 rounded-xl border border-input bg-background text-[13px] placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
                />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.confirm_password && form.password !== form.confirm_password && (
                <p className="text-[11px] text-destructive mt-1">Passwords do not match</p>
              )}
            </div>

            {/* Terms */}
            <div className="flex items-start gap-2.5">
              <input
                id="agree"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-input bg-background accent-primary cursor-pointer"
              />
              <label htmlFor="agree" className="text-[12px] text-muted-foreground leading-relaxed cursor-pointer">
                I agree to the{' '}
                <button type="button" className="text-primary hover:underline" style={{ fontWeight: 500 }}>Terms of Service</button>
                {' '}and{' '}
                <button type="button" className="text-primary hover:underline" style={{ fontWeight: 500 }}>Privacy Policy</button>
              </label>
            </div>

            {/* Submit */}
            <motion.button type="submit" disabled={isSubmitting}
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-[14px] font-semibold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed mt-1">
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                  Creating account...
                </span>
              ) : 'Create Account'}
            </motion.button>
          </form>

          <div className="mt-5 text-center text-[13px] text-muted-foreground">
            Already registered?{' '}
            <NavLink to="/customer/login" className="text-primary font-semibold hover:text-primary/80 transition-colors">
              Sign in
            </NavLink>
          </div>

          {/* Back to admin */}
          <div className="mt-4 pt-4 border-t border-border text-center">
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
