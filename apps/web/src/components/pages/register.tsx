import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Building2, Check, Circle, Lock, Mail, User } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api.ts";
import { cn } from "@/components/ui/utils";
import { AuthLayout } from "@/components/auth-layout";
import { AuthField, AuthFormAlert, AuthPasswordField, AuthPortalSwitch, AuthSubmitButton } from "@/components/auth/auth-fields";

type Field = "firstName" | "lastName" | "email" | "organization" | "password";
type FieldErrors = Partial<Record<Field, string>>;

const REQUIRED: Record<Field, string> = {
  firstName: "Nhập tên.",
  lastName: "Nhập họ.",
  email: "Nhập email.",
  organization: "Nhập tên đơn vị.",
  password: "Tạo mật khẩu.",
};
const FIELD_ORDER: Field[] = ["firstName", "lastName", "email", "organization", "password"];

export function RegisterPage() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<Field, string>>({ firstName: "", lastName: "", email: "", organization: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});

  const password = formData.password;
  // The same three rules as before; shown as a checklist that ticks while typing.
  const passwordChecks = [
    { label: "Tối thiểu 8 ký tự", ok: password.length >= 8 },
    { label: "Có chữ hoa", ok: /[A-Z]/.test(password) },
    { label: "Có chữ số", ok: /[0-9]/.test(password) },
  ];
  const allChecksPassed = passwordChecks.every((check) => check.ok);

  const update = (field: Field, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setFormError(null);
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    const next: FieldErrors = {};
    for (const field of FIELD_ORDER) if (!formData[field].trim()) next[field] = REQUIRED[field];
    if (!next.password && !allChecksPassed) next.password = "Mật khẩu chưa đáp ứng đủ yêu cầu bên dưới.";
    const firstInvalid = FIELD_ORDER.find((field) => next[field]);
    if (firstInvalid) {
      setErrors(next);
      refs.current[firstInvalid]?.focus();
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await authService.register({
        username: `${formData.firstName}.${formData.lastName}`.toLowerCase().replace(/\s+/g, "."),
        email: formData.email,
        full_name: `${formData.firstName} ${formData.lastName}`.trim(),
        password,
      });
      toast.success("Tạo tài khoản thành công. Vui lòng đăng nhập.");
      navigate("/login");
    } catch (error) {
      setFormError(getApiErrorMessage(error, "Chưa tạo được tài khoản. Vui lòng thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const bind = (field: Field) => ({
    ref: (node: HTMLInputElement | null) => { refs.current[field] = node; },
    value: formData[field],
    onChange: (event: ChangeEvent<HTMLInputElement>) => update(field, event.target.value),
    error: errors[field],
    readOnly: isSubmitting,
  });

  return (
    <AuthLayout
      title="Tạo tài khoản mới"
      subtitle="Tham gia SmartBook để quản lý thư viện và kho vận hiệu quả hơn."
      footer={
        <div className="space-y-1 border-t border-border pt-5">
          <p className="text-[13.5px] text-muted-foreground">
            Đã có tài khoản?{" "}
            <Link to="/login" className="rounded-sm font-semibold text-foreground hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:text-indigo-300">Đăng nhập</Link>
          </p>
          <AuthPortalSwitch question="Bạn là bạn đọc của thư viện?" action="Tạo tài khoản bạn đọc" to="/customer/register" />
        </div>
      }
    >
      <form className="space-y-5" noValidate onSubmit={handleRegister} aria-busy={isSubmitting || undefined}>
        <AuthFormAlert message={formError} />
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">
          <AuthField {...bind("firstName")} id="register-first-name" label="Tên" icon={User} placeholder="Văn" autoComplete="given-name" />
          <AuthField {...bind("lastName")} id="register-last-name" label="Họ" icon={User} placeholder="Nguyễn" autoComplete="family-name" />
        </div>
        <AuthField {...bind("email")} id="register-email" label="Email" icon={Mail} type="email" placeholder="ten@congty.com" autoComplete="email" autoCapitalize="none" spellCheck={false} />
        <AuthField {...bind("organization")} id="register-org" label="Tổ chức" icon={Building2} placeholder="Tên đơn vị của bạn" autoComplete="organization" />
        <div>
          <AuthPasswordField {...bind("password")} id="register-password" label="Mật khẩu" icon={Lock} placeholder="Tạo mật khẩu mạnh" autoComplete="new-password" />
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-3" aria-label="Yêu cầu mật khẩu">
            {passwordChecks.map((check) => (
              <li key={check.label} className={cn("flex items-center gap-1.5 text-[12.5px]", check.ok ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                {check.ok ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Circle className="h-3 w-3 shrink-0" aria-hidden="true" />}
                {check.label}
                <span className="sr-only">{check.ok ? ": đã đạt" : ": chưa đạt"}</span>
              </li>
            ))}
          </ul>
        </div>
        <AuthSubmitButton submitting={isSubmitting} label="Tạo tài khoản" busyLabel="Đang tạo tài khoản…" />
      </form>
    </AuthLayout>
  );
}
