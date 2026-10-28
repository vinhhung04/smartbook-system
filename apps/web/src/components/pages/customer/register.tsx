import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AtSign, Lock, Mail, User } from 'lucide-react';
import { toast } from 'sonner';
import { authService } from '@/services/auth';
import { getApiErrorMessage } from '@/services/api';
import { safeReturnUrl, withReturnUrl } from '@/lib/return-url';
import { cn } from '@/components/ui/utils';
import { AuthLayout } from '@/components/auth-layout';
import { AuthConsentCheckbox, AuthField, AuthFormAlert, AuthPasswordField, AuthPortalSwitch, AuthSubmitButton } from '@/components/auth/auth-fields';

type Field = 'full_name' | 'email' | 'username' | 'password' | 'confirm_password';
type FieldErrors = Partial<Record<Field | 'agreed', string>>;
const FIELD_ORDER: Field[] = ['full_name', 'email', 'username', 'password', 'confirm_password'];
const LINK = 'rounded-sm font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:text-indigo-300';

/** Guidance only: the rule that blocks sign-up is still "at least 6 characters". */
function strengthOf(password: string) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { score, label: 'Yếu', bar: 'bg-red-500' };
  if (score === 2) return { score, label: 'Trung bình', bar: 'bg-amber-500' };
  if (score === 3) return { score, label: 'Tốt', bar: 'bg-indigo-500' };
  return { score, label: 'Mạnh', bar: 'bg-emerald-500' };
}

export function CustomerRegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Carried through to login so a new reader still lands back on the book they wanted.
  const returnUrl = safeReturnUrl(searchParams.get('returnUrl'));
  const [form, setForm] = useState<Record<Field, string>>({ full_name: '', email: '', username: '', password: '', confirm_password: '' });
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const strength = strengthOf(form.password);

  const update = (field: Field, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    const next: FieldErrors = {};
    if (!form.full_name.trim()) next.full_name = 'Nhập họ tên.';
    if (!form.email.trim()) next.email = 'Nhập email.';
    if (!form.username.trim()) next.username = 'Nhập tên đăng nhập.';
    if (!form.password) next.password = 'Tạo mật khẩu.';
    else if (form.password.length < 6) next.password = 'Mật khẩu phải có ít nhất 6 ký tự.';
    if (form.password && form.password !== form.confirm_password) next.confirm_password = 'Mật khẩu xác nhận không khớp.';
    if (!agreed) next.agreed = 'Cần đồng ý với điều khoản để tạo tài khoản.';
    const firstInvalid = FIELD_ORDER.find((field) => next[field]);
    if (firstInvalid || next.agreed) {
      setErrors(next);
      if (firstInvalid) refs.current[firstInvalid]?.focus();
      else document.getElementById('register-agree')?.focus();
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await authService.register({
        full_name: form.full_name,
        email: form.email,
        username: form.username,
        password: form.password,
      });
      toast.success('Đăng ký thành công. Vui lòng đăng nhập.');
      navigate(withReturnUrl('/customer/login', returnUrl));
    } catch (error) {
      setFormError(getApiErrorMessage(error, 'Chưa tạo được tài khoản. Vui lòng thử lại.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const bind = (field: Field) => ({
    ref: (node: HTMLInputElement | null) => { refs.current[field] = node; },
    value: form[field],
    onChange: (event: ChangeEvent<HTMLInputElement>) => update(field, event.target.value),
    error: errors[field],
    readOnly: isSubmitting,
  });

  return (
    <AuthLayout
      portal="customer"
      title="Tạo tài khoản bạn đọc"
      subtitle="Miễn phí. Sau khi tạo, bạn có thể đặt trước sách và theo dõi hạn trả của mình."
      footer={
        <div className="space-y-4">
          <p className="text-[14px] text-muted-foreground">
            Đã có tài khoản?{' '}
            <Link to={withReturnUrl('/customer/login', returnUrl)} className={LINK}>Đăng nhập</Link>
          </p>
          <p className="text-[14px]">
            <Link to={returnUrl || '/'} className="rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
              Tiếp tục xem sách mà không cần tài khoản
            </Link>
          </p>
          <div className="border-t border-border pt-4">
            <AuthPortalSwitch question="Bạn là nhân viên thư viện?" action="Cổng nội bộ" to="/login" />
          </div>
        </div>
      }
    >
      <form className="space-y-5" noValidate onSubmit={handleSubmit} aria-busy={isSubmitting || undefined}>
        <AuthFormAlert message={formError} />
        <AuthField {...bind('full_name')} id="register-full-name" label="Họ tên" icon={User} placeholder="Nguyễn Văn A" autoComplete="name" />
        <AuthField {...bind('email')} id="register-email" label="Email" icon={Mail} type="email" placeholder="ban@example.com" autoComplete="email" autoCapitalize="none" spellCheck={false} />
        <AuthField {...bind('username')} id="register-username" label="Tên đăng nhập" icon={AtSign} placeholder="ten_dang_nhap" autoComplete="username" autoCapitalize="none" spellCheck={false} />
        <div>
          <AuthPasswordField {...bind('password')} id="register-password" label="Mật khẩu" icon={Lock} placeholder="Tối thiểu 6 ký tự" autoComplete="new-password" />
          {form.password ? (
            <div className="mt-2.5 flex items-center gap-3" aria-live="polite">
              <span className="flex flex-1 gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((step) => (
                  <span key={step} className={cn('h-1.5 flex-1 rounded-full transition-colors duration-200', step <= strength.score ? strength.bar : 'bg-muted')} />
                ))}
              </span>
              <span className="min-w-[5.5rem] text-right text-[12.5px] font-medium text-muted-foreground">Độ mạnh: {strength.label}</span>
            </div>
          ) : null}
        </div>
        <AuthPasswordField {...bind('confirm_password')} id="register-confirm-password" label="Xác nhận mật khẩu" icon={Lock} placeholder="Nhập lại mật khẩu" autoComplete="new-password" />
        <AuthConsentCheckbox
          id="register-agree"
          checked={agreed}
          onChange={(value) => { setAgreed(value); setErrors((prev) => ({ ...prev, agreed: undefined })); }}
          error={errors.agreed}
        >
          Tôi đồng ý với điều khoản dịch vụ và chính sách bảo mật của thư viện SmartBook.
        </AuthConsentCheckbox>
        <AuthSubmitButton submitting={isSubmitting} label="Tạo tài khoản" busyLabel="Đang tạo tài khoản…" />
      </form>
    </AuthLayout>
  );
}
