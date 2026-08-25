import { useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";
import { getHomePathForUser } from "@/lib/rbac";
import { AuthLayout } from "@/components/auth-layout";

export function LoginPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('smartbook-remember') === 'true');
  const [credentials, setCredentials] = useState(() => {
    const saved = localStorage.getItem('smartbook-saved-identifier');
    return { identifier: saved || "", password: "" };
  });

  const handleLogin = async () => {
    if (!credentials.identifier || !credentials.password) {
      toast.error("Vui lòng nhập tài khoản và mật khẩu");
      return;
    }

    try {
      setIsSubmitting(true);
      const loginData = await authService.login(credentials);
      if (rememberMe) {
        localStorage.setItem('smartbook-remember', 'true');
        localStorage.setItem('smartbook-saved-identifier', credentials.identifier);
      } else {
        localStorage.removeItem('smartbook-remember');
        localStorage.removeItem('smartbook-saved-identifier');
      }
      toast.success("Đăng nhập thành công");
      navigate(getHomePathForUser(loginData.user));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Đăng nhập thất bại"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Chào mừng trở lại"
      subtitle="Đăng nhập để tiếp tục quản lý thư viện và kho vận"
      footer={
        <>
          <div className="text-center text-[12px] text-muted-foreground">
            Chưa có tài khoản?{" "}
            <NavLink to="/register" className="text-primary hover:opacity-80 font-semibold">
              Đăng ký
            </NavLink>
          </div>

          <NavLink to="/forgot-password" className="block w-full mt-6 py-2.5 rounded-[10px] border border-input text-muted-foreground text-[12px] text-center hover:bg-muted/50 transition-all">
            Quên mật khẩu?
          </NavLink>
        </>
      }
    >
      <form
        className="space-y-4 mb-6"
        onSubmit={(event) => {
          event.preventDefault();
          void handleLogin();
        }}
      >
        <div>
          <label htmlFor="login-identifier" className="text-[12px] text-muted-foreground block mb-2 font-medium">
            Tên đăng nhập hoặc email <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id="login-identifier" value={credentials.identifier} onChange={e => setCredentials({ ...credentials, identifier: e.target.value })} type="text" placeholder="Nhập email hoặc tên đăng nhập" autoComplete="username" required
              className="w-full pl-10 pr-4 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
          </div>
        </div>

        <div>
          <label htmlFor="login-password" className="text-[12px] text-muted-foreground block mb-2 font-medium">
            Mật khẩu <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id="login-password" value={credentials.password} onChange={e => setCredentials({ ...credentials, password: e.target.value })} type={showPassword ? "text" : "password"} placeholder="Nhập mật khẩu" autoComplete="current-password" required
              className="w-full pl-10 pr-10 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
            <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-4 h-4 rounded border-input accent-primary" />
          <span className="text-[12px] text-muted-foreground">Ghi nhớ đăng nhập</span>
        </label>
        <motion.button type="submit" disabled={isSubmitting} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          className="w-full py-3 rounded-[10px] bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[13px] font-semibold shadow-lg shadow-indigo-600/20 hover:shadow-xl transition-all mb-4 disabled:opacity-70 disabled:cursor-not-allowed">
          {isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
        </motion.button>
      </form>
    </AuthLayout>
  );
}
