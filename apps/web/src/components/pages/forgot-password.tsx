import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, MailCheck, User } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";
import { AuthLayout } from "@/components/auth-layout";
import { AuthField, AuthFormAlert, AuthSubmitButton } from "@/components/auth/auth-fields";

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const isCustomerPortal = searchParams.get("portal") === "customer";
  const backTo = isCustomerPortal ? "/customer/login" : "/login";
  const backLabel = isCustomerPortal ? "Quay lại đăng nhập bạn đọc" : "Quay lại đăng nhập nội bộ";
  const [identifier, setIdentifier] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
      setSubmitted(true);
    } catch (error) {
      setFormError(getApiErrorMessage(error, "Chưa gửi được yêu cầu. Vui lòng thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      portal={isCustomerPortal ? "customer" : "staff"}
      title={submitted ? "Kiểm tra email của bạn" : "Quên mật khẩu?"}
      subtitle={
        submitted
          ? "Nếu tài khoản tồn tại, chúng tôi đã gửi liên kết đặt lại mật khẩu đến email của tài khoản đó."
          : isCustomerPortal
            ? "Nhập email hoặc tên đăng nhập của tài khoản bạn đọc, chúng tôi sẽ gửi liên kết đặt lại mật khẩu."
            : "Nhập email hoặc tên đăng nhập của tài khoản nhân viên, chúng tôi sẽ gửi liên kết đặt lại mật khẩu."
      }
      footer={
        <Link to={backTo} className="inline-flex min-h-10 items-center gap-1.5 rounded-sm text-[14px] font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:text-indigo-300">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
      }
    >
      {submitted ? (
        <p role="status" className="flex items-start gap-3 rounded-xl bg-emerald-500/10 px-4 py-3.5 text-[14px] leading-relaxed text-foreground ring-1 ring-emerald-600/25">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          Không thấy email? Hãy kiểm tra thư mục thư rác, hoặc gửi lại yêu cầu sau ít phút.
        </p>
      ) : (
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
          <AuthSubmitButton submitting={isSubmitting} label="Gửi liên kết đặt lại" busyLabel="Đang gửi…" />
        </form>
      )}
    </AuthLayout>
  );
}
