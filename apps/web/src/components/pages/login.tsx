import { Link, useNavigate, useSearchParams } from "react-router";
import { Lock, User } from "lucide-react";
import { getHomePathForUser } from "@/lib/rbac";
import { safeReturnUrl } from "@/lib/return-url";
import { AuthLayout } from "@/components/auth-layout";
import { useLoginForm } from "@/components/auth/use-login-form";
import { AuthField, AuthFormAlert, AuthPasswordField, AuthPortalSwitch, AuthRememberCheckbox, AuthSubmitButton } from "@/components/auth/auth-fields";
import { OtpVerificationStep } from "@/components/auth/otp-verification";
import { otpStepCopy } from "@/lib/otp";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    identifier, setIdentifier, password, setPassword, remember, setRemember,
    errors, formError, submitting, submit, identifierRef, passwordRef,
    challenge, verifyCode, cancelChallenge,
  } = useLoginForm({
    portal: "staff",
    // Where to go is decided by the roles the backend returned, never by this page.
    onSuccess: (data) => navigate(safeReturnUrl(searchParams.get("returnUrl")) || getHomePathForUser(data.user)),
  });

  if (challenge) {
    const copy = otpStepCopy(challenge.challenge.purpose, challenge.challenge.masked_email);
    return (
      <AuthLayout title={copy.title} subtitle={copy.subtitle}>
        <OtpVerificationStep
          key={challenge.challenge.id}
          challenge={challenge.challenge}
          onVerify={verifyCode}
          onBack={cancelChallenge}
          backLabel="Quay lại đăng nhập"
          submitLabel={challenge.status === "OTP_REQUIRED" ? "Xác nhận và đăng nhập" : "Xác thực email"}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Chào mừng trở lại"
      subtitle="Đăng nhập bằng tài khoản được cấp để vào khu vực làm việc của bạn."
      footer={
        <div className="space-y-1 border-t border-border pt-5">
          <AuthPortalSwitch question="Bạn là bạn đọc của thư viện?" action="Cổng bạn đọc" to="/customer/login" />
          {/* Staff accounts are created by an administrator (IAM), never by self sign-up. */}
          <p className="text-[13.5px] text-muted-foreground">
            Chưa có tài khoản nhân viên? Liên hệ quản trị viên thư viện để được cấp tài khoản.
          </p>
        </div>
      }
    >
      <form className="space-y-5" noValidate onSubmit={submit} aria-busy={submitting || undefined}>
        <AuthFormAlert message={formError} />
        <AuthField
          ref={identifierRef}
          id="login-identifier"
          label="Tên đăng nhập hoặc email"
          icon={User}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          error={errors.identifier}
          placeholder="Nhập email hoặc tên đăng nhập"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={submitting}
        />
        <AuthPasswordField
          ref={passwordRef}
          id="login-password"
          label="Mật khẩu"
          icon={Lock}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          placeholder="Nhập mật khẩu"
          autoComplete="current-password"
          readOnly={submitting}
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <AuthRememberCheckbox checked={remember} onChange={setRemember} />
          <Link to="/forgot-password" className="inline-flex min-h-10 items-center rounded-sm text-[13.5px] font-medium text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:text-indigo-300">
            Quên mật khẩu?
          </Link>
        </div>
        <AuthSubmitButton submitting={submitting} label="Đăng nhập" busyLabel="Đang đăng nhập…" testId="login-submit" />
      </form>
    </AuthLayout>
  );
}
