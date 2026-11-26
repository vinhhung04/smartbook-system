import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, User } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";
import { AuthLayout } from "@/components/auth-layout";
import { AuthField, AuthFormAlert, AuthSubmitButton } from "@/components/auth/auth-fields";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isCustomerPortal = searchParams.get("portal") === "customer";
  const backTo = isCustomerPortal ? "/customer/login" : "/login";
  const backLabel = isCustomerPortal ? "Quay lại đăng nhập bạn đọc" : "Quay lại đăng nhập nội bộ";
  const [identifier, setIdentifier] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!identifier.trim()) {
      setFieldError("Nhập email hoặc tên đăng nhập.");
      inputRef.current?.focus();
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await authService.requestPasswordReset(identifier);
      // The identifier travels in router state, not in the URL (no personal data in links or logs).
      navigate(`/reset-password${isCustomerPortal ? "?portal=customer" : ""}`, { state: { identifier: identifier.trim() } });
    } catch (error) {
      setFormError(getApiErrorMessage(error, "Chưa gửi được yêu cầu. Vui lòng thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      portal={isCustomerPortal ? "customer" : "staff"}
      title="Quên mật khẩu?"
      subtitle={
        isCustomerPortal
          ? "Nhập email hoặc tên đăng nhập của tài khoản bạn đọc, chúng tôi sẽ gửi mã đặt lại mật khẩu qua email."
          : "Nhập email hoặc tên đăng nhập của tài khoản nhân viên, chúng tôi sẽ gửi mã đặt lại mật khẩu qua email."
      }
      footer={
        <Link to={backTo} className="inline-flex min-h-10 items-center gap-1.5 rounded-sm text-[14px] font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:text-indigo-300">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
      }
    >
      <form className="space-y-5" noValidate onSubmit={handleSubmit} aria-busy={isSubmitting || undefined}>
        <AuthFormAlert message={formError} />
        <AuthField
          ref={inputRef}
          id="forgot-identifier"
          label="Email hoặc tên đăng nhập"
          icon={User}
          value={identifier}
          onChange={(event) => { setIdentifier(event.target.value); setFieldError(undefined); setFormError(null); }}
          error={fieldError}
          placeholder="Nhập email hoặc tên đăng nhập"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={isSubmitting}
        />
        <AuthSubmitButton submitting={isSubmitting} label="Gửi mã đặt lại" busyLabel="Đang gửi…" />
      </form>
    </AuthLayout>
  );
}
