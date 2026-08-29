import { useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff, Mail, Lock, Check, X } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";
import { AuthLayout } from "@/components/auth-layout";

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
      toast.error("Vui lòng điền đầy đủ thông tin");
      return;
    }
    if (!allChecksPassed) {
      toast.error("Mật khẩu chưa đáp ứng đủ yêu cầu");
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
      toast.success("Tạo tài khoản thành công. Vui lòng đăng nhập.");
      navigate("/login");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Đăng ký thất bại"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Tạo tài khoản mới"
      subtitle="Tham gia SmartBook để quản lý thư viện và kho vận hiệu quả hơn"
      footer={
        <>
          <div className="text-center text-[12px] text-muted-foreground mt-4">
            Đã có tài khoản?{" "}
            <NavLink to="/login" className="text-primary hover:opacity-80 font-semibold">
              Đăng nhập
            </NavLink>
          </div>
          <div className="text-center text-[12px] text-muted-foreground mt-2">
            Bạn là bạn đọc thư viện?{" "}
            <NavLink to="/customer/register" className="text-primary hover:opacity-80 font-semibold">
              Tạo tài khoản khách hàng
            </NavLink>
          </div>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleRegister();
        }}
      >
        <div className="space-y-4 mb-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="register-first-name" className="text-[12px] text-muted-foreground block mb-2 font-medium">
                Tên <span className="text-destructive">*</span>
              </label>
              <input id="register-first-name" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} type="text" placeholder="Văn" required
                className="w-full px-4 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
            </div>
            <div>
              <label htmlFor="register-last-name" className="text-[12px] text-muted-foreground block mb-2 font-medium">
                Họ <span className="text-destructive">*</span>
              </label>
              <input id="register-last-name" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} type="text" placeholder="Nguyễn" required
                className="w-full px-4 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
            </div>
          </div>

          <div>
            <label htmlFor="register-email" className="text-[12px] text-muted-foreground block mb-2 font-medium">
              Email <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input id="register-email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} type="email" placeholder="ten@congty.com" required
                className="w-full pl-10 pr-4 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
            </div>
          </div>

          <div>
            <label htmlFor="register-org" className="text-[12px] text-muted-foreground block mb-2 font-medium">
              Tổ chức <span className="text-destructive">*</span>
            </label>
            <input id="register-org" value={formData.organization} onChange={e => setFormData({ ...formData, organization: e.target.value })} type="text" placeholder="Tên đơn vị của bạn" required
              className="w-full px-4 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
          </div>

          <div>
            <label htmlFor="register-password" className="text-[12px] text-muted-foreground block mb-2 font-medium">
              Mật khẩu <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input id="register-password" value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="Tạo mật khẩu mạnh" autoComplete="new-password" required
                className="w-full pl-10 pr-10 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Password Strength */}
            {password && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 space-y-2">
                {[
                  { label: "Tối thiểu 8 ký tự", check: passwordChecks.length },
                  { label: "Có chữ hoa", check: passwordChecks.uppercase },
                  { label: "Có chữ số", check: passwordChecks.number },
                ].map(p => (
                  <div key={p.label} className="flex items-center gap-2 text-[11px]">
                    {p.check ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <X className="w-4 h-4 text-muted-foreground/50" />
                    )}
                    <span className={p.check ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{p.label}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded border-input" />
            <span className="text-[12px] text-muted-foreground">Tôi đồng ý với Điều khoản dịch vụ</span>
          </label>
        </div>

        <motion.button type="submit" disabled={!allChecksPassed || isSubmitting} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          className={`w-full py-3 rounded-[10px] text-white text-[13px] font-semibold transition-all ${allChecksPassed ? "bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg shadow-indigo-600/20 hover:shadow-xl" : "bg-muted-foreground/40 cursor-not-allowed"}`}>
          {isSubmitting ? "Đang tạo..." : "Tạo tài khoản"}
        </motion.button>
      </form>
    </AuthLayout>
  );
}
