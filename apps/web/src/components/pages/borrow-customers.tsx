import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, UserPlus, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonTableRow } from '@/components/ui/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { borrowService, type Customer, type CustomerPayload, type CustomerStatus } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';

const customerStatuses: CustomerStatus[] = ['ACTIVE', 'SUSPENDED', 'BLOCKED', 'INACTIVE'];

interface CustomerFormState {
  id?: string;
  full_name: string;
  email: string;
  phone: string;
  birth_date: string;
  address: string;
  status: CustomerStatus;
}

const initialFormState: CustomerFormState = {
  full_name: '',
  email: '',
  phone: '',
  birth_date: '',
  address: '',
  status: 'ACTIVE',
};

function getStatusVariant(status: CustomerStatus) {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SUSPENDED') return 'warning';
  if (status === 'BLOCKED') return 'danger';
  return 'neutral';
}

export function BorrowCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CustomerStatus>('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState<CustomerFormState>(initialFormState);
  const [notifyTarget, setNotifyTarget] = useState<Customer | null>(null);
  const [notifyForm, setNotifyForm] = useState({ subject: '', body: '' });
  const [notifySending, setNotifySending] = useState(false);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const response = await borrowService.getCustomers();
      setCustomers(response.data ?? []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được danh sách khách hàng'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCustomers();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return customers.filter((customer) => {
      if (statusFilter !== 'ALL' && customer.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        customer.full_name.toLowerCase().includes(keyword)
        || customer.customer_code.toLowerCase().includes(keyword)
        || String(customer.email || '').toLowerCase().includes(keyword)
        || String(customer.phone || '').toLowerCase().includes(keyword)
      );
    });
  }, [customers, search, statusFilter]);

  const resetForm = () => {
    setFormState(initialFormState);
    setFormOpen(false);
  };

  const openEdit = (customer: Customer) => {
    setFormState({
      id: customer.id,
      full_name: customer.full_name,
      email: customer.email || '',
      phone: customer.phone || '',
      birth_date: customer.birth_date ? customer.birth_date.slice(0, 10) : '',
      address: customer.address || '',
      status: customer.status,
    });
    setFormOpen(true);
  };

  const onSave = async () => {
    if (formState.full_name.trim().length < 2) {
      toast.error('Tên đầy đủ phải ít nhất 2 ký tự');
      return;
    }

    const payload: CustomerPayload = {
      full_name: formState.full_name.trim(),
      email: formState.email.trim() || undefined,
      phone: formState.phone.trim() || undefined,
      birth_date: formState.birth_date || undefined,
      address: formState.address.trim() || undefined,
      status: formState.status,
    };

    try {
      setSaving(true);
      if (formState.id) {
        await borrowService.updateCustomer(formState.id, payload);
        toast.success('Đã cập nhật khách hàng thành công');
      } else {
        await borrowService.createCustomer(payload);
        toast.success('Đã tạo khách hàng thành công');
      }
      resetForm();
      await loadCustomers();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Lưu khách hàng thất bại'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Hero Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <PageHeader
          icon={Users}
          title="Khách hàng thư viện"
          description={`${customers.length} khách hàng`}
          iconBg="bg-gradient-to-br from-teal-100 to-emerald-50 border border-teal-200/40 shadow-sm dark:from-teal-500/15 dark:to-emerald-500/10 dark:border-teal-500/20"
          iconColor="text-teal-600 dark:text-teal-400"
          actions={
            <Button size="sm" onClick={() => { setFormState(initialFormState); setFormOpen(true); }} className="gap-2">
              <UserPlus className="w-4 h-4" />
              Khách hàng mới
            </Button>
          }
        />
      </motion.div>

      {/* Filter Bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
      >
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Tìm khách hàng..."
          filters={
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
              {(['ALL', ...customerStatuses] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className="relative px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all"
                >
                  {statusFilter === status ? (
                    <motion.div
                      layoutId="customer-filter"
                      className="absolute inset-0 rounded-md bg-primary"
                      transition={{ duration: 0.15 }}
                    />
                  ) : (
                    <span className="text-muted-foreground hover:text-foreground"> {status}</span>
                  )}
                  <span className="relative z-10">{status}</span>
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

      {/* Customers Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2, ease: 'easeOut' }}
      >
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {['Mã KH', 'Tên', 'Email', 'Điện thoại', 'Trạng thái', 'Dư nợ phạt', 'Thao tác'].map((header) => (
                    <th key={header} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={7} rows={5} />
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        variant="no-results"
                        title="Không tìm thấy khách hàng"
                        description="Thử điều chỉnh tìm kiếm hoặc bộ lọc."
                        className="py-12"
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((customer, index) => (
                    <motion.tr
                      key={customer.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: index * 0.02 }}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5 text-sm font-medium">{customer.customer_code}</td>
                      <td className="px-5 py-3.5 text-sm">{customer.full_name}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{customer.email || '-'}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{customer.phone || '-'}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge label={customer.status} variant={getStatusVariant(customer.status)} dot />
                      </td>
                      <td className="px-5 py-3.5 text-sm font-medium text-rose-600 dark:text-rose-400">
                        {Number(customer.total_fine_balance).toLocaleString('vi-VN')} VND
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" className="border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/10" onClick={() => openEdit(customer)}>
                            Sửa
                          </Button>
                          <Button size="sm" variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/20 dark:text-indigo-400 dark:hover:bg-indigo-500/10" onClick={() => { setNotifyTarget(customer); setNotifyForm({ subject: '', body: '' }); }}>
                            <Send className="w-3 h-3 mr-1" /> Thông báo
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </motion.div>

      {/* Create/Edit Form Modal */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-background rounded-xl p-6 w-full max-w-lg shadow-2xl border border-border"
            >
              <h3 className="text-base font-semibold mb-4">{formState.id ? 'Sửa khách hàng' : 'Khách hàng mới'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <label className="text-xs font-medium text-muted-foreground">
                  Tên đầy đủ *
                  <input
                    value={formState.full_name}
                    onChange={(event) => setFormState((prev) => ({ ...prev, full_name: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Trạng thái
                  <select
                    value={formState.status}
                    onChange={(event) => setFormState((prev) => ({ ...prev, status: event.target.value as CustomerStatus }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  >
                    {customerStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Email
                  <input
                    type="email"
                    value={formState.email}
                    onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Số điện thoại
                  <input
                    value={formState.phone}
                    onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Ngày sinh
                  <input
                    type="date"
                    value={formState.birth_date}
                    onChange={(event) => setFormState((prev) => ({ ...prev, birth_date: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                  Địa chỉ
                  <textarea
                    value={formState.address}
                    onChange={(event) => setFormState((prev) => ({ ...prev, address: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    rows={2}
                  />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" className="flex-1" onClick={resetForm}>
                  Hủy
                </Button>
                <Button className="flex-1" onClick={() => void onSave()} disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {notifyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-card rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold">Gửi thông báo</h3>
              <button onClick={() => setNotifyTarget(null)} aria-label="Đóng" className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[12px] text-muted-foreground mb-3">Gửi đến: <strong>{notifyTarget.full_name}</strong> ({notifyTarget.customer_code})</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1">Tiêu đề</label>
                <input value={notifyForm.subject} onChange={(e) => setNotifyForm({ ...notifyForm, subject: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  placeholder="Tiêu đề thông báo..." />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1">Nội dung</label>
                <textarea value={notifyForm.body} onChange={(e) => setNotifyForm({ ...notifyForm, body: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none"
                  rows={4} placeholder="Nhập nội dung thông báo..." />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setNotifyTarget(null)}>Hủy</Button>
              <Button className="flex-1" disabled={notifySending || !notifyForm.body.trim()} onClick={async () => {
                try {
                  setNotifySending(true);
                  await borrowService.sendNotificationToCustomer({ customer_id: notifyTarget.id, subject: notifyForm.subject || 'Thông báo từ thư viện', body: notifyForm.body });
                  toast.success('Đã gửi thông báo');
                  setNotifyTarget(null);
                } catch (error) { toast.error(getApiErrorMessage(error, 'Gửi thông báo thất bại')); } finally { setNotifySending(false); }
              }}>
                <Send className="w-3.5 h-3.5 mr-1" /> {notifySending ? 'Đang gửi...' : 'Gửi'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
