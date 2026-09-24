import { useEffect, useState } from 'react';
import { Clock, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { authService, type AuthUser } from '@/services/auth';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { SectionCard } from '@/components/ui/section-card';
import { Button } from '@/components/ui/button';

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
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-[20px] font-bold text-foreground">Tài khoản của tôi</h1>
        <p className="text-[13px] text-muted-foreground">Thông tin đăng nhập và bảo mật tài khoản.</p>
      </div>

      <AccountHeaderCard user={user} onRefresh={() => authService.getMe().then(setUser).catch(() => {})} />
      <ProfileSection user={user} onUpdated={setUser} />
      <ChangePasswordSection />
    </div>
  );
}

function AccountHeaderCard({ user, onRefresh }: { user: AuthUser | null; onRefresh: () => void }) {
  const [resending, setResending] = useState(false);
  const verified = Boolean(user?.email_verified_at);
  const lastLogin = formatDateTime(user?.last_login_at);

  const handleResend = async () => {
    try {
      setResending(true);
      const res = await authService.resendVerification();
      toast.success(res.message === 'Email already verified' ? 'Email đã được xác thực' : 'Đã gửi email xác thực, vui lòng kiểm tra hộp thư');
      onRefresh();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Không thể gửi email xác thực'));
    } finally {
      setResending(false);
    }
  };

  return (
    <SectionCard title="Thông tin tài khoản" subtitle="Thông tin cơ bản của tài khoản đang đăng nhập">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.full_name}
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[16px] font-semibold text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/20">
              {getInitials(user?.full_name || user?.username)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">{user?.full_name || user?.username || '-'}</p>
            <p className="text-[12px] text-muted-foreground">{user?.username} {user?.email ? `· ${user.email}` : ''}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {Array.isArray(user?.roles) && user.roles.map((role) => (
                <span key={role} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {role}
                </span>
              ))}
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                verified
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400'
                  : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400'
              }`}>
                {verified ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                {verified ? 'Email đã xác thực' : 'Email chưa xác thực'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {lastLogin && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Đăng nhập lần cuối: {lastLogin}
            </span>
          )}
          {!verified && (
            <Button type="button" variant="warning-outline" size="sm" onClick={() => void handleResend()} loading={resending} loadingLabel="Đang gửi">
              Gửi lại email xác thực
            </Button>
          )}
        </div>
      </div>
    </SectionCard>
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
      toast.success('Đã cập nhật thông tin tài khoản');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Cập nhật thông tin thất bại'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Thông tin cá nhân" subtitle="Cập nhật họ tên, email và số điện thoại liên hệ">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Họ và tên</label>
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Số điện thoại</label>
          <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Chưa cập nhật"
            className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={!dirty} loading={saving} loadingLabel="Đang lưu">
          Lưu thay đổi
        </Button>
      </div>
    </SectionCard>
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
    <SectionCard title="Bảo mật" subtitle="Đổi mật khẩu tài khoản">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Mật khẩu hiện tại</label>
          <input type="password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })}
            className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Mật khẩu mới</label>
          <input type="password" value={form.newPwd} onChange={(e) => setForm({ ...form, newPwd: e.target.value })}
            className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Xác nhận mật khẩu</label>
          <input type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" variant="destructive" onClick={() => void handleChange()} loading={saving} loadingLabel="Đang đổi">
          <Lock className="w-4 h-4" />
          Đổi mật khẩu
        </Button>
      </div>
    </SectionCard>
  );
}
