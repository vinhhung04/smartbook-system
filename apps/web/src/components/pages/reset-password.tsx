import { useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { NavLink, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";
import { AuthLayout } from "@/components/auth-layout";

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
      toast.error("Liên kết đặt lại không hợp lệ hoặc thiếu token");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Mật khẩu phải có ít nhất 6 ký tự");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }

    try {
      setIsSubmitting(true);
      await authService.confirmPasswordReset(token, newPassword);
      toast.success("Đặt lại mật khẩu thành công. Vui lòng đăng nhập.");
      navigate("/login");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Đặt lại mật khẩu thất bại"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Đặt lại mật khẩu"
      subtitle="Nhập mật khẩu mới cho tài khoản của bạn."
      footer={
        <div className="text-center text-[12px] text-muted-foreground">
          <NavLink to="/login" className="text-primary hover:opacity-80 font-semibold">
            Quay lại đăng nhập
          </NavLink>
        </div>
      }
    >
      {!token && (
        <p className="text-[13px] text-destructive mb-4">Liên kết đặt lại không hợp lệ hoặc thiếu token. Vui lòng yêu cầu lại.</p>
      )}

      <form
        className="space-y-4 mb-6"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div>
          <label htmlFor="reset-new-password" className="text-[12px] text-muted-foreground block mb-2 font-medium">
            Mật khẩu mới <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id="reset-new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="Nhập mật khẩu mới" autoComplete="new-password" required
              className="w-full pl-10 pr-10 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
            <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="reset-confirm-password" className="text-[12px] text-muted-foreground block mb-2 font-medium">
            Xác nhận mật khẩu mới <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id="reset-confirm-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="Xác nhận mật khẩu mới" autoComplete="new-password" required
              className="w-full pl-10 pr-4 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
          </div>
        </div>

        <motion.button type="submit" disabled={isSubmitting || !token} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          className="w-full py-3 rounded-[10px] bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[13px] font-semibold shadow-lg shadow-indigo-600/20 hover:shadow-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed">
          {isSubmitting ? "Đang đặt lại..." : "Đặt lại mật khẩu"}
        </motion.button>
      </form>
    </AuthLayout>
  );
}
