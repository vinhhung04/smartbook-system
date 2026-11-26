import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { Lock } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";
import { describeOtpError } from "@/lib/otp";
import { AuthLayout } from "@/components/auth-layout";
import { AuthFormAlert, AuthPasswordField, AuthSubmitButton } from "@/components/auth/auth-fields";
import { OtpCodeInput } from "@/components/auth/otp-verification";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

interface FieldErrors {
  code?: string;
  newPassword?: string;
  confirmPassword?: string;
}

/** Second step of the reset: the 6-digit code emailed by /forgot-password, then a new password. */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isCustomerPortal = searchParams.get("portal") === "customer";
  const loginPath = isCustomerPortal ? "/customer/login" : "/login";
  const forgotPath = `/forgot-password${isCustomerPortal ? "?portal=customer" : ""}`;
  const identifier = String((location.state as { identifier?: string } | null)?.identifier || "");

  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(
    identifier ? null : "Phiên đặt lại mật khẩu không còn. Vui lòng nhập lại email hoặc tên đăng nhập để nhận mã.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(identifier ? RESEND_COOLDOWN_SECONDS : 0);
  const codeRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const handleResend = async () => {
    if (!identifier || resendIn > 0) return;
    try {
      await authService.requestPasswordReset(identifier);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setCode("");
      toast.success("Đã gửi lại mã (nếu tài khoản tồn tại). Mã cũ không còn dùng được.");
    } catch (error) {
      setFormError(getApiErrorMessage(error, "Chưa gửi lại được mã. Vui lòng thử lại."));
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting || !identifier) return;
    const next: FieldErrors = {};
    if (code.length !== CODE_LENGTH) next.code = `Nhập đủ ${CODE_LENGTH} chữ số trong email.`;
    else if (newPassword.length < 6) next.newPassword = "Mật khẩu phải có ít nhất 6 ký tự.";
    else if (newPassword !== confirmPassword) next.confirmPassword = "Mật khẩu xác nhận không khớp.";
    if (next.code || next.newPassword || next.confirmPassword) {
      setErrors(next);
      (next.code ? codeRef : next.newPassword ? newRef : confirmRef).current?.focus();
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await authService.confirmPasswordReset(identifier, code, newPassword);
      toast.success("Đặt lại mật khẩu thành công. Vui lòng đăng nhập.");
      navigate(loginPath);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.code?.startsWith?.("OTP_")) {
        const view = describeOtpError(error.response.status, error.response.data);
        setErrors({ code: view.message });
        if (view.needsNewCode || view.closed) setResendIn(0);
        setCode("");
        codeRef.current?.focus();
      } else {
        setFormError(getApiErrorMessage(error, "Chưa đặt lại được mật khẩu. Vui lòng thử lại."));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      portal={isCustomerPortal ? "customer" : "staff"}
      title="Đặt lại mật khẩu"
      subtitle="Nếu tài khoản tồn tại, chúng tôi đã gửi mã 6 chữ số tới email của tài khoản. Nhập mã và mật khẩu mới."
      footer={
        <Link to={identifier ? loginPath : forgotPath} className="inline-flex min-h-10 items-center rounded-sm text-[14px] font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:text-indigo-300">
          {identifier ? "Quay lại đăng nhập" : "Nhận mã đặt lại mật khẩu"}
        </Link>
      }
    >
      <form className="space-y-5" noValidate onSubmit={handleSubmit} aria-busy={isSubmitting || undefined}>
        <AuthFormAlert message={formError} />
        <div className="space-y-2">
          <label htmlFor="reset-code" className="block text-[14px] font-semibold text-foreground">Mã xác thực</label>
          <OtpCodeInput
            id="reset-code"
            value={code}
            length={CODE_LENGTH}
            onChange={(value) => { setCode(value); setErrors((prev) => ({ ...prev, code: undefined })); }}
            invalid={Boolean(errors.code)}
            disabled={!identifier || isSubmitting}
            describedBy={errors.code ? "reset-code-error" : undefined}
            inputRef={codeRef}
          />
          {errors.code && <p id="reset-code-error" role="alert" className="text-[13px] text-red-700 dark:text-red-400">{errors.code}</p>}
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={!identifier || resendIn > 0}
            className="min-h-10 rounded-sm text-[14px] font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline dark:text-indigo-300"
          >
            {resendIn > 0 ? `Gửi lại mã sau ${resendIn} giây` : "Gửi lại mã"}
          </button>
        </div>
        <AuthPasswordField
          ref={newRef}
          id="reset-new-password"
          label="Mật khẩu mới"
          icon={Lock}
          value={newPassword}
          onChange={(event) => { setNewPassword(event.target.value); setErrors((prev) => ({ ...prev, newPassword: undefined })); }}
          error={errors.newPassword}
          placeholder="Ít nhất 6 ký tự"
          autoComplete="new-password"
          disabled={!identifier}
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
          disabled={!identifier}
          readOnly={isSubmitting}
        />
        <AuthSubmitButton submitting={isSubmitting} label="Đặt lại mật khẩu" busyLabel="Đang đặt lại…" />
      </form>
    </AuthLayout>
  );
}
