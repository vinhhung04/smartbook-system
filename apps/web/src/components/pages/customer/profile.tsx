import { useEffect, useState } from 'react';
import { User, Save } from 'lucide-react';
import { customerService, CustomerProfile } from '@/services/customer';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';

export function CustomerProfilePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [form, setForm] = useState({ full_name: '', phone: '', birth_date: '', address: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
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
        setError(getApiErrorMessage(err, 'Failed to load profile'));
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, []);

  const handleSave = async () => {
    if (!form.full_name.trim()) {
      toast.error('Full name is required');
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
      toast.success('Profile updated successfully');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update profile'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <LoadingOverlay />;
  if (error) return <EmptyState variant="error" title="Failed to load profile" description={error} action={<button onClick={() => window.location.reload()} className="text-primary font-medium hover:underline">Try again</button>} />;
  if (!profile) return <EmptyState variant="no-data" title="Profile not found" description="Unable to load your profile. Please contact support." />;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      {/* Hero */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-100 to-blue-50 flex items-center justify-center border border-indigo-200/40">
          <User className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">My Profile</h1>
          <p className="text-[13px] text-muted-foreground">Manage your personal information</p>
        </div>
      </div>

      <SectionCard
        title="Personal Information"
        subtitle={`Customer code: ${profile.customer_code || '—'} | Keep your contact details up to date.`}
      >
        {/* Email notice */}
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[12px] text-amber-700">
            <strong>Note:</strong> Your email is managed by your account login and cannot be edited here. Contact support to change your email.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Email (read-only)</label>
            <input value={profile.email || ''} disabled className="w-full h-10 rounded-xl border border-input bg-muted/30 px-4 text-[13px] text-muted-foreground cursor-not-allowed" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Full Name *</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" placeholder="Not set" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Birth Date</label>
            <input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} className="w-full h-10 rounded-xl border border-input bg-background px-4 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Address</label>
            <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={3} className="w-full rounded-xl border border-input bg-background px-4 py-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all resize-none" placeholder="Your address..." />
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={() => void handleSave()} disabled={isSaving} className="inline-flex items-center gap-2 h-10 rounded-xl bg-primary text-primary-foreground px-6 text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
