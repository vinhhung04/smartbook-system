import { useRef, useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";
import { AuthLayout } from "@/components/auth-layout";
import { AuthFormAlert, AuthPasswordField, AuthSubmitButton } from "@/components/auth/auth-fields";

interface FieldErrors {
  newPassword?: string;
  confirmPassword?: string;
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(token ? null : "Liên kết đặt lại không hợp lệ hoặc thiếu token. Vui lòng yêu cầu lại.");
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting || !token) return;
    const next: FieldErrors = {};
    if (newPassword.length < 6) next.newPassword = "Mật khẩu phải có ít nhất 6 ký tự.";
    else if (newPassword !== confirmPassword) next.confirmPassword = "Mật khẩu xác nhận không khớp.";
    if (next.newPassword || next.confirmPassword) {
      setErrors(next);
      (next.newPassword ? newRef : confirmRef).current?.focus();
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await authService.confirmPasswordReset(token, newPassword);
      toast.success("Đặt lại mật khẩu thành công. Vui lòng đăng nhập.");
      navigate("/login");
    } catch (error) {
      setFormError(getApiErrorMessage(error, "Chưa đặt lại được mật khẩu. Vui lòng thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Đặt lại mật khẩu"
      subtitle="Nhập mật khẩu mới cho tài khoản của bạn."
      footer={
        <Link to="/login" className="inline-flex min-h-10 items-center rounded-sm text-[14px] font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:text-indigo-300">
          Quay lại đăng nhập
        </Link>
      }
    >
      <form className="space-y-5" noValidate onSubmit={handleSubmit} aria-busy={isSubmitting || undefined}>
        <AuthFormAlert message={formError} />
        <AuthPasswordField
          ref={newRef}
          id="reset-new-password"
          label="Mật khẩu mới"
          icon={Lock}
          value={newPassword}
          onChange={(event) => { setNewPassword(event.target.value); setErrors({}); }}
          error={errors.newPassword}
          placeholder="Ít nhất 6 ký tự"
          autoComplete="new-password"
          disabled={!token}
          readOnly={isSubmitting}
        />
        <AuthPasswordField
          ref={confirmRef}
          id="reset-confirm-password"
          label="Xác nhận mật khẩu mới"
          icon={Lock}
          value={confirmPassword}
          onChange={(event) => { setConfirmPassword(event.target.value); setErrors((prev) => ({ ...prev, confirmPassword: undefined })); }}
          error={errors.confirmPassword}
          placeholder="Nhập lại mật khẩu mới"
          autoComplete="new-password"
          disabled={!token}
          readOnly={isSubmitting}
        />
        <AuthSubmitButton submitting={isSubmitting} label="Đặt lại mật khẩu" busyLabel="Đang đặt lại…" />
      </form>
    </AuthLayout>
  );
}
