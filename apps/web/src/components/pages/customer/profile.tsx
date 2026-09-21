import { useCallback, useEffect, useState } from 'react';
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
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8" aria-busy="true">
        <div className="h-20 animate-pulse rounded-xl border bg-card" />
        <div className="h-72 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
        <EmptyState variant="error" title="Không tải được hồ sơ" description={error} action={<button onClick={() => void load()} className="font-medium text-primary hover:underline">Thử lại</button>} />
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
        <EmptyState variant="no-data" title="Không tìm thấy hồ sơ" description="Không thể tải hồ sơ. Vui lòng liên hệ hỗ trợ." />
      </div>
    );
  }

  const initials = (profile.full_name || 'U').trim().split(/\s+/).slice(-2).map((w) => w[0]?.toUpperCase() || '').join('') || 'U';

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader title="Hồ sơ của tôi" subtitle="Thông tin cá nhân, thông báo và bảo mật tài khoản" />

      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[18px] font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[16px] font-bold text-foreground">{profile.full_name}</p>
          <p className="truncate text-[13px] text-muted-foreground">{profile.email || 'Chưa có email'}</p>
          <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">Mã khách hàng: {profile.customer_code || '—'}</p>
        </div>
      </div>

      <SectionCard
        title="Thông tin cá nhân"
        subtitle="Cập nhật thông tin liên lạc của bạn"
      >
        {/* Email notice */}
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-950/30">
          <p className="text-[12px] text-amber-700 dark:text-amber-400">
            <strong>Lưu ý:</strong> Email được quản lý bởi tài khoản đăng nhập và không thể chỉnh sửa ở đây. Liên hệ hỗ trợ để đổi email.
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
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${checked ? 'bg-indigo-600' : 'bg-muted'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-card shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );

  return (
    <SectionCard title="Cài đặt thông báo" subtitle="Kiểm soát cách bạn nhận thông báo">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Bell className="w-4 h-4 text-indigo-500" /><span className="text-[13px]">Thông báo trong ứng dụng</span></div>
          <Toggle checked={prefs.notify_in_app} onChange={(v) => setPrefs({ ...prefs, notify_in_app: v })} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Bell className="w-4 h-4 text-blue-500" /><span className="text-[13px]">Thông báo Email</span></div>
          <Toggle checked={prefs.notify_email} onChange={(v) => setPrefs({ ...prefs, notify_email: v })} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Bell className="w-4 h-4 text-emerald-500" /><span className="text-[13px]">Thông báo SMS</span></div>
          <Toggle checked={prefs.notify_sms} onChange={(v) => setPrefs({ ...prefs, notify_sms: v })} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-amber-500" /><span className="text-[13px]">Ngôn ngữ</span></div>
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
          className="inline-flex items-center gap-2 h-10 rounded-xl bg-rose-600 text-white px-6 text-[13px] font-semibold hover:bg-rose-700 disabled:opacity-50 transition-colors">
          <Lock className="w-4 h-4" />
          {saving ? 'Đang đổi...' : 'Đổi mật khẩu'}
        </button>
      </div>
    </SectionCard>
  );
}
