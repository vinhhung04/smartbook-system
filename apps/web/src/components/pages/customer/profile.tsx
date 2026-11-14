import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { Save, Bell, Lock, Globe } from 'lucide-react';
import { customerService, CustomerProfile } from '@/services/customer';
import { customerBorrowService } from '@/services/customer-borrow';
import { authService } from '@/services/auth';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { CustomerPageHeader } from './_shared/customer-page-header';

export function CustomerProfilePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [form, setForm] = useState({ full_name: '', phone: '', birth_date: '', address: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await customerService.getMyProfile();
      setProfile(data);
      setForm({
        full_name: data.full_name || '',
        phone: data.phone || '',
        birth_date: data.birth_date ? String(data.birth_date).slice(0, 10) : '',
        address: data.address || '',
      });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được hồ sơ'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!form.full_name.trim()) {
      toast.error('Họ tên là bắt buộc');
      return;
    }
    try {
      setIsSaving(true);
      const updated = await customerService.updateMyProfile({
        full_name: form.full_name,
        phone: form.phone || null,
        birth_date: form.birth_date || null,
        address: form.address || null,
      });
      setProfile(updated);
      toast.success('Đã cập nhật hồ sơ thành công');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Cập nhật hồ sơ thất bại'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8 *:max-w-3xl" aria-busy="true">
        <div className="h-20 animate-pulse rounded-xl border bg-card" />
        <div className="h-72 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 *:max-w-3xl">
        <EmptyState variant="error" title="Không tải được hồ sơ" description={error} action={<button onClick={() => void load()} className="font-medium text-primary hover:underline">Thử lại</button>} />
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 *:max-w-3xl">
        <EmptyState variant="no-data" title="Không tìm thấy hồ sơ" description="Không thể tải hồ sơ. Vui lòng liên hệ hỗ trợ." />
      </div>
    );
  }

  const initials = (profile.full_name || 'U').trim().split(/\s+/).slice(-2).map((w) => w[0]?.toUpperCase() || '').join('') || 'U';

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 sm:p-6 lg:p-8">
      <CustomerPageHeader title="Hồ sơ của tôi" subtitle="Thông tin liên lạc, cách nhận thông báo và mật khẩu đăng nhập." />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside aria-label="Tóm tắt hồ sơ" className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-20">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-[18px] font-semibold text-primary">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[19px] font-semibold leading-tight text-foreground">{profile.full_name}</p>
            <p className="truncate text-[13px] text-muted-foreground">{profile.email || 'Chưa có email'}</p>
          </div>
        </div>
        <dl className="mt-4 space-y-2.5 border-t border-border pt-4 text-[13px]">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Mã khách hàng</dt><dd className="font-mono text-[12px] text-foreground">{profile.customer_code || '–'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Số điện thoại</dt><dd className="text-foreground">{profile.phone || 'Chưa có'}</dd></div>
        </dl>
        <nav aria-label="Liên kết tài khoản" className="mt-4 grid gap-1.5 border-t border-border pt-4 text-[13px]">
          <NavLink to="/customer/membership" className="rounded-lg px-2 py-1.5 font-medium text-primary hover:bg-primary/[0.06]">Thẻ hội viên và quyền lợi</NavLink>
          <NavLink to="/customer/fines" className="rounded-lg px-2 py-1.5 font-medium text-primary hover:bg-primary/[0.06]">Tiền phạt và ví</NavLink>
        </nav>
      </aside>

      <div className="min-w-0 space-y-5">

      <SectionCard
        title="Thông tin cá nhân"
        subtitle="Cập nhật thông tin liên lạc của bạn"
      >
        {/* Email notice */}
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-950/30">
          <p className="text-[12px] text-amber-700 dark:text-amber-400">
            <strong>Lưu ý:</strong> Email được quản lý bởi tài khoản đăng nhập và không thể chỉnh sửa ở đây.{' '}
            <NavLink to="/customer/support" className="font-medium underline">Liên hệ hỗ trợ</NavLink> để đổi email.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Email (chỉ đọc)</label>
            <input value={profile.email || ''} disabled className="w-full h-10 rounded-xl border border-input bg-muted/30 px-4 text-[13px] text-muted-foreground cursor-not-allowed" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Họ tên *</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Số điện thoại</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" placeholder="Chưa có" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Ngày sinh</label>
            <input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Địa chỉ</label>
            <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={3} className="w-full rounded-xl border border-input bg-background px-4 py-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all resize-none" placeholder="Địa chỉ của bạn..." />
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={() => void handleSave()} disabled={isSaving} className="inline-flex items-center gap-2 h-10 rounded-xl bg-primary text-primary-foreground px-6 text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
            <Save className="w-4 h-4" />
            {isSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </SectionCard>

      {/* Notification Preferences (Feature 4) */}
      <NotificationPreferencesSection />

      {/* Change Password (Feature 5) */}
      <ChangePasswordSection />
      </div>
      </div>
    </div>
  );
}

function NotificationPreferencesSection() {
  const [prefs, setPrefs] = useState({ notify_email: true, notify_sms: false, notify_in_app: true, preferred_language: 'vi' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    customerBorrowService.getMyPreferences().then((res: any) => {
      if (res?.data) setPrefs({
        notify_email: res.data.notify_email ?? true,
        notify_sms: res.data.notify_sms ?? false,
        notify_in_app: res.data.notify_in_app ?? true,
        preferred_language: res.data.preferred_language || 'vi',
      });
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      await customerBorrowService.updateMyPreferences(prefs);
      toast.success('Đã cập nhật tuỳ chọn');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Thất bại'));
    } finally { setSaving(false); }
  };

  if (!loaded) return (
    <SectionCard title="Cài đặt thông báo" subtitle="Đang tải tuỳ chọn...">
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center justify-between">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-6 w-11 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </SectionCard>
  );

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${checked ? 'bg-primary' : 'bg-muted'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-card shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );

  return (
    <SectionCard title="Cài đặt thông báo" subtitle="Kiểm soát cách bạn nhận thông báo">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Bell className="w-4 h-4 text-primary" /><span className="text-[13px]">Thông báo trong ứng dụng</span></div>
          <Toggle checked={prefs.notify_in_app} onChange={(v) => setPrefs({ ...prefs, notify_in_app: v })} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Bell className="w-4 h-4 text-muted-foreground" /><span className="text-[13px]">Thông báo Email</span></div>
          <Toggle checked={prefs.notify_email} onChange={(v) => setPrefs({ ...prefs, notify_email: v })} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Bell className="w-4 h-4 text-primary" /><span className="text-[13px]">Thông báo SMS</span></div>
          <Toggle checked={prefs.notify_sms} onChange={(v) => setPrefs({ ...prefs, notify_sms: v })} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-muted-foreground" /><span className="text-[13px]">Ngôn ngữ</span></div>
          <select value={prefs.preferred_language} onChange={(e) => setPrefs({ ...prefs, preferred_language: e.target.value })}
            className="h-9 rounded-lg border border-input bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/10">
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={() => void handleSave()} disabled={saving}
          className="inline-flex items-center gap-2 h-10 rounded-xl bg-primary text-primary-foreground px-6 text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
          <Save className="w-4 h-4" />
          {saving ? 'Đang lưu...' : 'Lưu tuỳ chọn'}
        </button>
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
    } finally { setSaving(false); }
  };

  return (
    <SectionCard title="Bảo mật" subtitle="Đổi mật khẩu tài khoản">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Mật khẩu hiện tại</label>
          <input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })}
            className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Mật khẩu mới</label>
          <input type="password" autoComplete="new-password" value={form.newPwd} onChange={(e) => setForm({ ...form, newPwd: e.target.value })}
            className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Xác nhận mật khẩu</label>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={() => void handleChange()} disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-6 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
          <Lock className="w-4 h-4" />
          {saving ? 'Đang đổi...' : 'Đổi mật khẩu'}
        </button>
      </div>
    </SectionCard>
  );
}
