import { useEffect, useState } from 'react';
import { Clock, KeyRound, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { authService, type AuthUser, type OtpChallenge } from '@/services/auth';
import { getApiErrorMessage } from '@/services/api';
import { getApiErrorCode } from '@/services/http-clients';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { PageHeader } from '@/components/ui/page-header';
import { roleLabel } from '@/lib/role-labels';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OtpVerificationStep } from '@/components/auth/otp-verification';

function formatDateTime(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function getInitials(name?: string | null) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function AccountPage() {
  const [user, setUser] = useState<AuthUser | null>(authService.getCurrentUser());

  useEffect(() => {
    authService.getMe().then(setUser).catch(() => {
      // Keep the cached user — a failed refresh shouldn't blank the page.
    });
  }, []);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={UserRound}
          title="Tài khoản của tôi"
          description="Thông tin liên hệ, trạng thái email và mật khẩu đăng nhập của bạn."
        />
      </FadeItem>
      <FadeItem>
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-5 @4xl/page:grid-cols-[300px_minmax(0,1fr)]">
            <AccountHeaderCard user={user} onRefresh={() => authService.getMe().then(setUser).catch(() => {})} />
            <div className="min-w-0 space-y-5">
              <ProfileSection user={user} onUpdated={setUser} />
              <ChangePasswordSection />
            </div>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}

function AccountHeaderCard({ user, onRefresh }: { user: AuthUser | null; onRefresh: () => void }) {
  const [resending, setResending] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const verified = Boolean(user?.email_verified_at);
  const lastLogin = formatDateTime(user?.last_login_at);

  const handleResend = async () => {
    try {
      setResending(true);
      const res = await authService.resendVerification();
      if (res.status === 'OTP_SENT' && res.challenge) {
        setChallenge(res.challenge);
      } else {
        toast.success('Email đã được xác thực');
        onRefresh();
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Không thể gửi mã xác thực'));
    } finally {
      setResending(false);
    }
  };

  const verifyCode = async (code: string) => {
    if (!challenge) return;
    await authService.verifyEmailOtp(challenge.id, code);
    setChallenge(null);
    toast.success('Đã xác thực email');
    onRefresh();
  };

  return (
    <aside aria-label="Thông tin tài khoản" className="rounded-2xl border border-border bg-card p-5 @4xl/page:sticky @4xl/page:top-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.full_name}
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-[16px] font-semibold text-primary">
              {getInitials(user?.full_name || user?.username)}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-display text-[19px] font-semibold leading-tight tracking-tight text-foreground">{user?.full_name || user?.username || '-'}</p>
            <p className="truncate text-[13px] text-muted-foreground">{user?.username}</p>
          </div>
        </div>

        <dl className="space-y-3 border-t border-border pt-4 text-[13px]">
          <div>
            <dt className="text-muted-foreground">Vai trò</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {Array.isArray(user?.roles) && user.roles.length ? user.roles.map((role) => (
                <span key={role} title={role} className="rounded-full border border-border px-2 py-0.5 text-[12px] font-medium text-foreground">
                  {roleLabel(role)}
                </span>
              )) : <span className="text-muted-foreground">Chưa có vai trò</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="mt-0.5 break-all text-foreground">{user?.email || 'Chưa có email'}</dd>
            <dd className={`mt-1 inline-flex items-center gap-1 text-[12px] font-medium ${verified ? 'text-primary' : 'text-amber-700 dark:text-amber-300'}`}>
              {verified ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}
              {verified ? 'Đã xác thực' : 'Chưa xác thực'}
            </dd>
          </div>
          {Array.isArray(user?.permissions) ? (
            <div>
              <dt className="text-muted-foreground">Quyền được cấp</dt>
              <dd className="mt-0.5 text-foreground">{user?.is_superuser ? 'Toàn quyền (siêu quản trị)' : `${user.permissions.length} quyền theo vai trò`}</dd>
            </div>
          ) : null}
          {lastLogin ? (
            <div>
              <dt className="text-muted-foreground">Đăng nhập lần cuối</dt>
              <dd className="mt-0.5 inline-flex items-center gap-1.5 tabular-nums text-foreground"><Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{lastLogin}</dd>
            </div>
          ) : null}
        </dl>

        {!verified && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/25 dark:bg-amber-500/[0.06]">
            <p className="text-[13px] text-foreground">Xác thực email để nhận mã đăng nhập và thông báo của hệ thống.</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void handleResend()} loading={resending} loadingLabel="Đang gửi">
              Gửi mã xác thực
            </Button>
          </div>
        )}
      </div>
      <Dialog open={Boolean(challenge)} onOpenChange={(open) => { if (!open) setChallenge(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xác thực email</DialogTitle>
            <DialogDescription>
              Nhập mã 6 chữ số vừa gửi tới {challenge?.masked_email}.
            </DialogDescription>
          </DialogHeader>
          {challenge ? (
            <OtpVerificationStep
              key={challenge.id}
              challenge={challenge}
              onVerify={verifyCode}
              onBack={() => setChallenge(null)}
              backLabel="Để sau"
              submitLabel="Xác thực email"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function ProfileSection({ user, onUpdated }: { user: AuthUser | null; onUpdated: (user: AuthUser) => void }) {
  const [form, setForm] = useState({ full_name: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ full_name: user?.full_name || '', email: user?.email || '', phone: user?.phone || '' });
  }, [user?.full_name, user?.email, user?.phone]);

  const dirty =
    form.full_name !== (user?.full_name || '') ||
    form.email !== (user?.email || '') ||
    form.phone !== (user?.phone || '');

  const handleSave = async () => {
    if (form.full_name.trim().length < 2) { toast.error('Họ tên phải có ít nhất 2 ký tự'); return; }
    if (!form.email.trim().includes('@')) { toast.error('Email không hợp lệ'); return; }
    try {
      setSaving(true);
      const updated = await authService.updateMe({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
      });
      onUpdated(updated);
      toast.success(updated.email_verified_at || updated.email === user?.email
        ? 'Đã cập nhật thông tin tài khoản'
        : 'Đã cập nhật. Email mới cần được xác thực lại.');
    } catch (err) {
      toast.error(getApiErrorCode(err) === 'EMAIL_CHANGE_REQUIRES_ADMIN'
        ? 'Tài khoản dùng mã đăng nhập qua email nên không tự đổi email được. Liên hệ quản trị viên.'
        : getApiErrorMessage(err, 'Cập nhật thông tin thất bại'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="profile-title" className="rounded-2xl border border-border bg-card p-5">
      <h2 id="profile-title" className="font-display text-[18px] font-semibold tracking-tight">Thông tin cá nhân</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">Họ tên, email và số điện thoại liên hệ. Đổi email thì cần xác thực lại.</p>
      <div className="mt-4 grid grid-cols-1 gap-4 @2xl/page:grid-cols-2">
        <div className="@2xl/page:col-span-2">
          <label htmlFor="account-full-name" className="mb-1.5 block text-[13px] font-medium text-foreground">Họ và tên</label>
          <input id="account-full-name" autoComplete="name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className="h-10 w-full rounded-xl border border-input bg-background px-4 text-[14px] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
        </div>
        <div>
          <label htmlFor="account-email" className="mb-1.5 block text-[13px] font-medium text-foreground">Email</label>
          <input id="account-email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="h-10 w-full rounded-xl border border-input bg-background px-4 text-[14px] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
        </div>
        <div>
          <label htmlFor="account-phone" className="mb-1.5 block text-[13px] font-medium text-foreground">Số điện thoại</label>
          <input id="account-phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Chưa cập nhật"
            className="h-10 w-full rounded-xl border border-input bg-background px-4 text-[14px] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={!dirty} loading={saving} loadingLabel="Đang lưu">
          Lưu thay đổi
        </Button>
      </div>
    </section>
  );
}

function ChangePasswordSection() {
  const [form, setForm] = useState({ current: '', newPwd: '', confirm: '' });
  const [saving, setSaving] = useState(false);

  const handleChange = async () => {
    if (!form.current || !form.newPwd) { toast.error('Vui lòng điền đầy đủ các trường'); return; }
    if (form.newPwd.length < 6) { toast.error('Mật khẩu mới phải có ít nhất 6 ký tự'); return; }
    if (form.newPwd !== form.confirm) { toast.error('Mật khẩu xác nhận không khớp'); return; }
    try {
      setSaving(true);
      await authService.changePassword(form.current, form.newPwd);
      toast.success('Đã đổi mật khẩu thành công');
      setForm({ current: '', newPwd: '', confirm: '' });
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Đổi mật khẩu thất bại'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="password-title" className="rounded-2xl border border-border bg-card p-5">
      <h2 id="password-title" className="font-display text-[18px] font-semibold tracking-tight">Đổi mật khẩu</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">Mật khẩu mới có ít nhất 6 ký tự.</p>
      <div className="mt-4 grid grid-cols-1 gap-4 @2xl/page:grid-cols-2">
        <div className="@2xl/page:col-span-2">
          <label htmlFor="account-current-password" className="mb-1.5 block text-[13px] font-medium text-foreground">Mật khẩu hiện tại</label>
          <input id="account-current-password" type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })}
            className="h-10 w-full rounded-xl border border-input bg-background px-4 text-[14px] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
        </div>
        <div>
          <label htmlFor="account-new-password" className="mb-1.5 block text-[13px] font-medium text-foreground">Mật khẩu mới</label>
          <input id="account-new-password" type="password" autoComplete="new-password" value={form.newPwd} onChange={(e) => setForm({ ...form, newPwd: e.target.value })}
            className="h-10 w-full rounded-xl border border-input bg-background px-4 text-[14px] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
        </div>
        <div>
          <label htmlFor="account-confirm-password" className="mb-1.5 block text-[13px] font-medium text-foreground">Xác nhận mật khẩu mới</label>
          <input id="account-confirm-password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            className="h-10 w-full rounded-xl border border-input bg-background px-4 text-[14px] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={() => void handleChange()} loading={saving} loadingLabel="Đang đổi" className="gap-2">
          <KeyRound className="h-4 w-4" />
          Đổi mật khẩu
        </Button>
      </div>
    </section>
  );
}
