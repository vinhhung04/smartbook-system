import { useState } from "react";
import { motion } from "motion/react";
import { Mail, ArrowLeft } from "lucide-react";
import { NavLink, useSearchParams } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";
import { AuthLayout } from "@/components/auth-layout";

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const isCustomerPortal = searchParams.get("portal") === "customer";
  const backTo = isCustomerPortal ? "/customer/login" : "/login";
  const backLabel = isCustomerPortal ? "Quay lại đăng nhập khách hàng" : "Quay lại đăng nhập";
  const [identifier, setIdentifier] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!identifier) {
      toast.error("Vui lòng nhập email hoặc tên đăng nhập");
      return;
    }

    try {
      setIsSubmitting(true);
      await authService.requestPasswordReset(identifier);
      setSubmitted(true);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Yêu cầu thất bại"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title={submitted ? "Kiểm tra email của bạn" : "Quên mật khẩu?"}
      subtitle={
        submitted
          ? "Nếu tài khoản tồn tại, chúng tôi đã gửi liên kết đặt lại mật khẩu đến đó."
          : "Nhập email hoặc tên đăng nhập, chúng tôi sẽ gửi liên kết đặt lại mật khẩu."
      }
      footer={
        <div className="text-center text-[12px] text-muted-foreground">
          <NavLink to={backTo} className="inline-flex items-center gap-1.5 text-primary hover:opacity-80 font-semibold">
            <ArrowLeft className="w-3.5 h-3.5" />
            {backLabel}
          </NavLink>
        </div>
      }
    >
      {!submitted && (
        <form
          className="space-y-4 mb-6"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div>
            <label htmlFor="forgot-identifier" className="text-[12px] text-muted-foreground block mb-2 font-medium">
              Email hoặc tên đăng nhập <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input id="forgot-identifier" value={identifier} onChange={e => setIdentifier(e.target.value)} type="text" placeholder="Nhập email hoặc tên đăng nhập" autoComplete="username" required
                className="w-full pl-10 pr-4 py-3 bg-input-background border border-input rounded-[10px] text-[13px] text-foreground outline-none focus:ring-[3px] focus:ring-ring/20 focus:border-ring transition-all" />
            </div>
          </div>

          <motion.button type="submit" disabled={isSubmitting} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            className="w-full py-3 rounded-[10px] bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[13px] font-semibold shadow-lg shadow-indigo-600/20 hover:shadow-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed">
            {isSubmitting ? "Đang gửi..." : "Gửi liên kết đặt lại"}
          </motion.button>
        </form>
      )}
    </AuthLayout>
  );
}
