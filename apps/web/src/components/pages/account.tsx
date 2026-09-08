import { useState } from 'react';
import { Lock, UserCircle } from 'lucide-react';
import { authService } from '@/services/auth';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { SectionCard } from '@/components/ui/section-card';

export function AccountPage() {
  const user = authService.getCurrentUser();

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-[20px] font-bold text-foreground">Tài khoản của tôi</h1>
        <p className="text-[13px] text-muted-foreground">Thông tin đăng nhập và bảo mật tài khoản.</p>
      </div>

      <SectionCard title="Thông tin tài khoản" subtitle="Thông tin cơ bản của tài khoản đang đăng nhập">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/20">
            <UserCircle className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-foreground">{user?.full_name || user?.username || '-'}</p>
            <p className="text-[12px] text-muted-foreground">{user?.username} {user?.email ? `· ${user.email}` : ''}</p>
            {Array.isArray(user?.roles) && user.roles.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Vai trò: {user.roles.join(', ')}
              </p>
            )}
          </div>
        </div>
      </SectionCard>

      <ChangePasswordSection />
    </div>
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
        <button onClick={() => void handleChange()} disabled={saving}
          className="inline-flex items-center gap-2 h-10 rounded-xl bg-rose-600 text-white px-6 text-[13px] font-semibold hover:bg-rose-700 disabled:opacity-50 transition-colors">
          <Lock className="w-4 h-4" />
          {saving ? 'Đang đổi...' : 'Đổi mật khẩu'}
        </button>
      </div>
    </SectionCard>
  );
}
