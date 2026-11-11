import { Link, useNavigate, useSearchParams } from 'react-router';
import { Lock, User } from 'lucide-react';
import { safeReturnUrl, withReturnUrl } from '@/lib/return-url';
import { AuthLayout } from '@/components/auth-layout';
import { useLoginForm } from '@/components/auth/use-login-form';
import { AuthField, AuthFormAlert, AuthPasswordField, AuthPortalSwitch, AuthRememberCheckbox, AuthSubmitButton } from '@/components/auth/auth-fields';
import { OtpVerificationStep } from '@/components/auth/otp-verification';
import { otpStepCopy } from '@/lib/otp';

const LINK = 'rounded-sm font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:text-indigo-300';

export function CustomerLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = safeReturnUrl(searchParams.get('returnUrl'));
  // "Đặt trước" on a book sends visitors here with ?reserve=1 on the way back.
  const reserving = Boolean(returnUrl && /[?&]reserve=1(&|$)/.test(returnUrl));
  const {
    identifier, setIdentifier, password, setPassword, remember, setRemember,
    errors, formError, submitting, submit, identifierRef, passwordRef,
    challenge, verifyCode, cancelChallenge,
  } = useLoginForm({
    portal: 'customer',
    // Staff accounts are refused here and their session cleared again, as before.
    refuse: (data) => (data.user?.roles?.includes('CUSTOMER')
      ? null
      : 'Tài khoản này không phải tài khoản bạn đọc. Nhân viên vui lòng đăng nhập ở cổng nội bộ.'),
    onSuccess: () => navigate(returnUrl || '/customer'),
  });

  // returnUrl stays in the address bar the whole time, so the reader still lands on their book.
  if (challenge) {
    const copy = otpStepCopy(challenge.challenge.purpose, challenge.challenge.masked_email);
    return (
      <AuthLayout portal="customer" title={copy.title} subtitle={copy.subtitle}>
        <OtpVerificationStep
          key={challenge.challenge.id}
          challenge={challenge.challenge}
          onVerify={verifyCode}
          onBack={cancelChallenge}
          backLabel="Quay lại đăng nhập"
          submitLabel={challenge.status === 'OTP_REQUIRED' ? 'Xác nhận và đăng nhập' : 'Xác thực và đăng nhập'}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      portal="customer"
      title="Chào mừng trở lại"
      subtitle={reserving
        ? 'Đăng nhập để hoàn tất đặt trước. Bạn sẽ quay lại đúng cuốn sách vừa chọn.'
        : 'Đăng nhập bằng tài khoản bạn đọc của bạn.'}
      footer={
        <div className="space-y-4">
          <p className="text-[14px] text-muted-foreground">
            Chưa có tài khoản?{' '}
            <Link to={withReturnUrl('/customer/register', returnUrl)} className={LINK}>Tạo tài khoản bạn đọc</Link>
          </p>
          <p className="text-[14px]">
            <Link to={returnUrl || '/'} className="rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
              Tiếp tục xem sách mà không cần đăng nhập
            </Link>
          </p>
          <div className="border-t border-border pt-4">
            <AuthPortalSwitch question="Bạn là nhân viên thư viện?" action="Cổng nội bộ" to="/login" />
          </div>
        </div>
      }
    >
      <form className="space-y-5" noValidate onSubmit={submit} aria-busy={submitting || undefined}>
        <AuthFormAlert message={formError} />
        <AuthField
          ref={identifierRef}
          id="customer-login-identifier"
          label="Email hoặc tên đăng nhập"
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
          id="customer-login-password"
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
          <Link to="/forgot-password?portal=customer" className={`inline-flex min-h-10 items-center text-[13.5px] ${LINK}`}>
            Quên mật khẩu?
          </Link>
        </div>
        <AuthSubmitButton submitting={submitting} label="Đăng nhập" busyLabel="Đang đăng nhập…" testId="customer-login-submit" />
      </form>
    </AuthLayout>
  );
}
