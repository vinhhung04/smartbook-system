import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, UserPlus, Send, X, Pencil, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { FilterBar, EmptyState } from '@/components/ui';
import { Button, IconButton } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RowsSkeleton } from '@/components/ops/ops-kit';
import { cn } from '@/components/ui/utils';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/status-badge';
import { getBorrowLabel, getStatusVariant } from '@/lib/status-registry';
import { WALLET_TOPUP_AMOUNTS } from '@/lib/wallet-topup';
import { borrowService, type Customer, type CustomerAccountView, type CustomerPayload, type CustomerStatus } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { type StageTab } from './borrow-shared/stage-tabs';
import { ListFooter } from './borrow-shared/list-footer';
import { sumCounts, useServerList } from './borrow-shared/use-server-list';

const customerStatuses: CustomerStatus[] = ['ACTIVE', 'SUSPENDED', 'BLOCKED', 'INACTIVE'];
const PAGE_SIZE = 20;


function customerInitials(fullName: string) {
  const words = (fullName || '?').trim().split(/\s+/);
  const letters = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : words[0].slice(0, 2);
  return letters.toUpperCase();
}

function formatDay(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('vi-VN');
}

function formatFine(value: number) {
  return `${Number(value || 0).toLocaleString('vi-VN')} VND`;
}

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

export function BorrowCustomersPage() {
  const [statusFilter, setStatusFilter] = useState<'ALL' | CustomerStatus>('ALL');
  const list = useServerList(borrowService.getCustomers, {
    pageSize: PAGE_SIZE,
    errorMessage: 'Không tải được danh sách khách hàng',
    params: statusFilter === 'ALL' ? {} : { status: statusFilter },
  });
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState<CustomerFormState>(initialFormState);
  const [notifyTarget, setNotifyTarget] = useState<Customer | null>(null);
  const [notifyForm, setNotifyForm] = useState({ subject: '', body: '' });
  const [notifySending, setNotifySending] = useState(false);
  // Wallet + counter top-up. The idempotency key is fixed while the dialog is open,
  // so a double click or a retry after a timeout records the money only once.
  const [walletTarget, setWalletTarget] = useState<Customer | null>(null);
  const [walletAccount, setWalletAccount] = useState<CustomerAccountView | null>(null);
  const [topupForm, setTopupForm] = useState({ amount: '', method: 'CASH' as 'CASH' | 'TRANSFER', note: '' });
  const [topupKey, setTopupKey] = useState('');
  const [topupSaving, setTopupSaving] = useState(false);

  const counts = list.meta.status_counts;
  const tabs: StageTab<'ALL' | CustomerStatus>[] = [
    { key: 'ALL', label: 'Tất cả', count: sumCounts(counts, Object.keys(counts ?? {})) },
    ...customerStatuses.map((status) => ({
      key: status,
      label: getBorrowLabel('borrowCustomer', status),
      count: counts?.[status] ?? 0,
      attention: status === 'SUSPENDED' || status === 'BLOCKED',
    })),
  ];

  const resetForm = () => {
    setFormState(initialFormState);
    setFormOpen(false);
  };

  const formModalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(formOpen, resetForm, formModalRef);
  const notifyModalRef = useRef<HTMLDivElement>(null);
  const closeNotify = () => setNotifyTarget(null);
  useDialogA11y(Boolean(notifyTarget), closeNotify, notifyModalRef);
  const walletModalRef = useRef<HTMLDivElement>(null);
  const closeWallet = () => { setWalletTarget(null); setWalletAccount(null); };
  useDialogA11y(Boolean(walletTarget), closeWallet, walletModalRef);

  const loadWallet = async (customerId: string) => {
    try {
      const response = await borrowService.getCustomerAccount(customerId);
      setWalletAccount(response.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được ví khách hàng'));
    }
  };

  const openWallet = (customer: Customer) => {
    setWalletTarget(customer);
    setWalletAccount(null);
    setTopupForm({ amount: '', method: 'CASH', note: '' });
    setTopupKey(crypto.randomUUID());
    void loadWallet(customer.id);
  };

  const submitTopup = async () => {
    if (!walletTarget) return;
    const amount = Number(topupForm.amount);
    if (!WALLET_TOPUP_AMOUNTS.some((allowed) => allowed === amount)) {
      toast.error('Chọn một mức nạp tiền');
      return;
    }
    try {
      setTopupSaving(true);
      const response = await borrowService.topupCustomerAccount(
        walletTarget.id,
        { amount, method: topupForm.method, ...(topupForm.note.trim() ? { note: topupForm.note.trim() } : {}) },
        topupKey,
      );
      toast.success(`Đã nạp ${formatFine(response.data.credited_amount)} vào ví`);
      setTopupForm({ amount: '', method: topupForm.method, note: '' });
      setTopupKey(crypto.randomUUID());
      await loadWallet(walletTarget.id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Nạp tiền thất bại'));
    } finally {
      setTopupSaving(false);
    }
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
      await list.reload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Lưu khách hàng thất bại'));
    } finally {
      setSaving(false);
    }
  };

  const vn = (value: number) => value.toLocaleString('vi-VN');
  const totalCustomers = sumCounts(counts, Object.keys(counts ?? {}));
  const lede = !counts
    ? 'Hồ sơ bạn đọc, tình trạng tài khoản và dư nợ tiền phạt.'
    : `${vn(totalCustomers)} bạn đọc, ${vn(counts.ACTIVE ?? 0)} đang hoạt động${[
        counts.SUSPENDED ? `${vn(counts.SUSPENDED)} tạm khóa` : null,
        counts.BLOCKED ? `${vn(counts.BLOCKED)} bị chặn` : null,
        counts.INACTIVE ? `${vn(counts.INACTIVE)} ngừng hoạt động` : null,
      ].filter(Boolean).map((part) => `, ${part}`).join('')}.`;
  const railButton = (tab: StageTab<'ALL' | CustomerStatus>) => {
    const active = statusFilter === tab.key;
    return (
      <button
        key={tab.key}
        type="button"
        onClick={() => setStatusFilter(tab.key)}
        aria-pressed={active}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          active ? 'bg-primary/[0.08] text-primary' : 'text-foreground hover:bg-muted/60',
        )}
      >
        <span className={cn('min-w-0 truncate text-[13px]', active ? 'font-semibold' : 'font-medium')}>{tab.label}</span>
        <span
          className={cn(
            'min-w-6 shrink-0 rounded-full px-1.5 text-center text-[12px] tabular-nums',
            tab.attention && tab.count > 0 ? 'bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : active ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {!counts ? '–' : vn(tab.count)}
        </span>
      </button>
    );
  };
  const fieldClass = 'mt-1 h-10 w-full rounded-md border border-input bg-input-background px-3 text-[14px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-muted/40';
  const labelClass = 'block text-[13px] font-medium text-foreground';
  const rowAction = 'h-9 w-9 text-muted-foreground hover:text-foreground sm:h-8 sm:w-8';

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <PageHeader
          icon={Users}
          title="Khách hàng thư viện"
          description={lede}
          actions={
            <Button size="sm" onClick={() => { setFormState(initialFormState); setFormOpen(true); }} className="gap-2">
              <UserPlus className="w-4 h-4" />
              Khách hàng mới
            </Button>
          }
        />
      </motion.div>

      {/* Named so the toolbar inside the list (its own container) can still ask whether the rail is showing. */}
      <div className="@container/page">
        <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[232px_minmax(0,1fr)]">
          <nav aria-label="Lọc theo tình trạng tài khoản" className="hidden rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
            <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Tình trạng tài khoản</p>
            {tabs.map(railButton)}
          </nav>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl/page:hidden" role="group" aria-label="Lọc theo tình trạng tài khoản">
            {tabs.map((tab) => {
              const active = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  aria-pressed={active}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    active ? 'border-primary/30 bg-primary/[0.08] font-semibold text-primary' : 'border-border bg-card font-medium hover:bg-muted/60',
                  )}
                >
                  <span className="whitespace-nowrap">{tab.label}</span>
                  <span className="tabular-nums text-muted-foreground">{!counts ? '–' : vn(tab.count)}</span>
                </button>
              );
            })}
          </div>

          <section aria-label="Danh sách khách hàng" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="px-5 pb-1 pt-4">
              <h2 className="font-display text-[18px] font-semibold tracking-tight">{statusFilter === 'ALL' ? 'Tất cả bạn đọc' : getBorrowLabel('borrowCustomer', statusFilter)}</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Bấm vào số điện thoại hoặc email để liên hệ. Ví, thông báo và sửa hồ sơ ở cột cuối.</p>
            </div>
            <div className="border-b border-border px-4 py-3">
              <FilterBar
                searchValue={list.search}
                onSearchChange={list.setSearch}
                searchPlaceholder="Tìm tên, mã khách, email, số điện thoại..."
                showSearchClear
              />
            </div>

            {list.loading && list.rows.length === 0 ? (
              <RowsSkeleton rows={6} />
            ) : list.rows.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  variant={list.search ? 'no-results' : 'no-data'}
                  title={list.search ? 'Không tìm thấy khách hàng' : 'Không có khách hàng nào ở mục này'}
                  description={list.search ? 'Thử tìm theo tên, mã khách, email hoặc số điện thoại.' : 'Chọn mục khác hoặc tạo khách hàng mới.'}
                  className="py-0"
                />
              </div>
            ) : (
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Bạn đọc</TableHead>
                    <TableHead className="hidden w-[250px] text-[12px] font-normal text-muted-foreground @3xl:table-cell">Liên hệ</TableHead>
                    <TableHead className="hidden w-[132px] text-right text-[12px] font-normal text-muted-foreground @2xl:table-cell">Dư nợ phạt</TableHead>
                    <TableHead className="w-[136px] pr-5 text-right text-[12px] font-normal text-muted-foreground">Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((customer) => {
                    const fine = Number(customer.total_fine_balance) || 0;
                    const contact = (
                      <>
                        {customer.phone ? <a href={`tel:${customer.phone}`} className="block truncate text-[13px] tabular-nums text-primary underline-offset-2 hover:underline">{customer.phone}</a> : null}
                        {customer.email ? <a href={`mailto:${customer.email}`} className="block truncate text-[13px] text-primary underline-offset-2 hover:underline" title={customer.email}>{customer.email}</a> : null}
                        {!customer.phone && !customer.email ? <p className="text-[13px] text-muted-foreground">Chưa có liên hệ</p> : null}
                        {customer.address ? <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground" title={customer.address}>{customer.address}</p> : null}
                      </>
                    );
                    return (
                      <TableRow key={customer.id} className="hover:bg-muted/30">
                        <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                          <div className="flex min-w-0 items-start gap-3">
                            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-[12px] font-semibold text-primary">
                              {customerInitials(customer.full_name)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[14px] font-semibold text-foreground">{customer.full_name}</p>
                              <p className="font-mono text-[12px] text-muted-foreground">{customer.customer_code}</p>
                              <p className="mt-0.5 text-[12px] text-muted-foreground">
                                {[customer.birth_date ? `Sinh ${formatDay(customer.birth_date)}` : null, `Hồ sơ từ ${formatDay(customer.created_at)}`].filter(Boolean).join(', ')}
                              </p>
                              {/* Columns the container hides move here, so no field is dropped. */}
                              <div className="mt-1.5 @3xl:hidden">{contact}</div>
                              {fine > 0 ? <p className="mt-1 text-[13px] font-semibold tabular-nums text-red-700 @2xl:hidden dark:text-red-400">Nợ phạt {formatFine(fine)}</p> : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden whitespace-normal py-3.5 align-top @3xl:table-cell">{contact}</TableCell>
                        <TableCell className={cn('hidden py-3.5 text-right align-top text-[14px] tabular-nums @2xl:table-cell', fine > 0 ? 'font-semibold text-red-700 dark:text-red-400' : 'text-muted-foreground')}>
                          {fine > 0 ? formatFine(fine) : 'Không nợ'}
                        </TableCell>
                        <TableCell className="py-3.5 pr-5 text-right align-top">
                          <div className="flex flex-col items-end gap-1.5">
                            <StatusBadge label={getBorrowLabel('borrowCustomer', customer.status)} variant={getStatusVariant('borrowCustomer', customer.status)} dot />
                            <div className="-mr-2 flex items-center">
                              <IconButton variant="ghost" size="sm-icon" label={`Sửa ${customer.full_name}`} title="Sửa" onClick={() => openEdit(customer)} className={rowAction}>
                                <Pencil className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton variant="ghost" size="sm-icon" label={`Gửi thông báo cho ${customer.full_name}`} title="Gửi thông báo" onClick={() => { setNotifyTarget(customer); setNotifyForm({ subject: '', body: '' }); }} className={rowAction}>
                                <Send className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton variant="ghost" size="sm-icon" label={`Ví của ${customer.full_name}`} title="Ví & nạp tiền" onClick={() => openWallet(customer)} className={rowAction}>
                                <Wallet className="h-3.5 w-3.5" />
                              </IconButton>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            <ListFooter
              page={list.page}
              pageSize={PAGE_SIZE}
              total={list.meta.total}
              totalPages={list.meta.totalPages}
              shown={list.rows.length}
              noun="khách hàng"
              onPageChange={list.setPage}
            />
          </section>
        </div>
      </div>

      {/* Create/Edit Form Modal */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-form-modal-title"
          >
            <motion.div
              ref={formModalRef}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl"
            >
              <h3 id="customer-form-modal-title" className="mb-4 font-display text-[20px] font-semibold tracking-tight">{formState.id ? 'Sửa khách hàng' : 'Khách hàng mới'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                <label className={labelClass}>
                  Tên đầy đủ <span className="text-red-600 dark:text-red-400">*</span>
                  <input
                    value={formState.full_name}
                    onChange={(event) => setFormState((prev) => ({ ...prev, full_name: event.target.value }))}
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  Trạng thái
                  <select
                    value={formState.status}
                    onChange={(event) => setFormState((prev) => ({ ...prev, status: event.target.value as CustomerStatus }))}
                    className={fieldClass}
                  >
                    {customerStatuses.map((status) => (
                      <option key={status} value={status}>{getBorrowLabel('borrowCustomer', status)}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Email
                  <input
                    type="email"
                    value={formState.email}
                    onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  Số điện thoại
                  <input
                    value={formState.phone}
                    onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))}
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  Ngày sinh
                  <input
                    type="date"
                    value={formState.birth_date}
                    onChange={(event) => setFormState((prev) => ({ ...prev, birth_date: event.target.value }))}
                    className={fieldClass}
                  />
                </label>
                <label className={cn(labelClass, 'md:col-span-2')}>
                  Địa chỉ
                  <textarea
                    value={formState.address}
                    onChange={(event) => setFormState((prev) => ({ ...prev, address: event.target.value }))}
                    className={cn(fieldClass, 'h-auto py-2')}
                    rows={2}
                  />
                </label>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={resetForm}>
                  Hủy
                </Button>
                <Button onClick={() => void onSave()} disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {notifyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="notify-modal-title">
          <motion.div ref={notifyModalRef} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 id="notify-modal-title" className="font-display text-[20px] font-semibold tracking-tight">Gửi thông báo</h3>
              <IconButton variant="ghost" size="sm-icon" label="Đóng" onClick={() => setNotifyTarget(null)}><X className="h-4 w-4" /></IconButton>
            </div>
            <p className="mb-3 text-[13px] text-muted-foreground">Gửi đến <span className="font-medium text-foreground">{notifyTarget.full_name}</span> <span className="font-mono">{notifyTarget.customer_code}</span></p>
            <div className="space-y-3">
              <label className={labelClass}>
                Tiêu đề
                <input value={notifyForm.subject} onChange={(e) => setNotifyForm({ ...notifyForm, subject: e.target.value })}
                  className={fieldClass} placeholder="Để trống sẽ dùng: Thông báo từ thư viện" />
              </label>
              <label className={labelClass}>
                Nội dung <span className="text-red-600 dark:text-red-400">*</span>
                <textarea value={notifyForm.body} onChange={(e) => setNotifyForm({ ...notifyForm, body: e.target.value })}
                  className={cn(fieldClass, 'h-auto resize-none py-2')}
                  rows={4} placeholder="Nhập nội dung thông báo..." />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNotifyTarget(null)}>Hủy</Button>
              <Button disabled={notifySending || !notifyForm.body.trim()} onClick={async () => {
                try {
                  setNotifySending(true);
                  await borrowService.sendNotificationToCustomer({ customer_id: notifyTarget.id, subject: notifyForm.subject || 'Thông báo từ thư viện', body: notifyForm.body });
                  toast.success('Đã gửi thông báo');
                  setNotifyTarget(null);
                } catch (error) { toast.error(getApiErrorMessage(error, 'Gửi thông báo thất bại')); } finally { setNotifySending(false); }
              }}>
                <Send className="h-3.5 w-3.5" /> {notifySending ? 'Đang gửi...' : 'Gửi'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {walletTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
          <motion.div ref={walletModalRef} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 id="wallet-modal-title" className="font-display text-[20px] font-semibold tracking-tight">Ví khách hàng</h3>
              <IconButton variant="ghost" size="sm-icon" label="Đóng" onClick={closeWallet}><X className="h-4 w-4" /></IconButton>
            </div>
            <p className="mb-3 text-[13px] text-muted-foreground"><span className="font-medium text-foreground">{walletTarget.full_name}</span> <span className="font-mono">{walletTarget.customer_code}</span></p>

            {walletAccount ? (
              <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
                <div className="bg-card p-3">
                  <dt className="text-[12px] text-muted-foreground">Số dư khả dụng</dt>
                  <dd className="mt-0.5 font-display text-[20px] font-semibold tabular-nums">{formatFine(walletAccount.available_balance)}</dd>
                </div>
                <div className="bg-card p-3">
                  <dt className="text-[12px] text-muted-foreground">Đang giữ (tiền cọc)</dt>
                  <dd className="mt-0.5 font-display text-[20px] font-semibold tabular-nums text-muted-foreground">{formatFine(walletAccount.held_balance)}</dd>
                </div>
                {!walletAccount.reconciliation.ok && (
                  <dd className="col-span-2 bg-card px-3 pb-3 text-[12px] text-red-700 dark:text-red-400">Số dư không khớp sổ giao dịch, cần kiểm tra trước khi nạp thêm.</dd>
                )}
              </dl>
            ) : (
              <p className="mb-4 text-[13px] text-muted-foreground">Đang tải ví…</p>
            )}

            <p className="mb-2 text-[14px] font-semibold">Ghi nhận nạp tiền tại quầy</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="topup-amount" className={labelClass}>Số tiền (VND)</label>
                  <select id="topup-amount" value={topupForm.amount}
                    onChange={(e) => setTopupForm({ ...topupForm, amount: e.target.value })}
                    className={fieldClass}>
                    <option value="">Chọn mức nạp</option>
                    {WALLET_TOPUP_AMOUNTS.map((amount) => (
                      <option key={amount} value={String(amount)}>{formatFine(amount)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="topup-method" className={labelClass}>Hình thức</label>
                  <select id="topup-method" value={topupForm.method}
                    onChange={(e) => setTopupForm({ ...topupForm, method: e.target.value as 'CASH' | 'TRANSFER' })}
                    className={fieldClass}>
                    <option value="CASH">Tiền mặt</option>
                    <option value="TRANSFER">Chuyển khoản</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="topup-note" className={labelClass}>Ghi chú</label>
                <input id="topup-note" value={topupForm.note} onChange={(e) => setTopupForm({ ...topupForm, note: e.target.value })}
                  className={fieldClass}
                  placeholder="Mã giao dịch chuyển khoản, số biên lai…" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={closeWallet}>Đóng</Button>
              <Button disabled={topupSaving || !topupForm.amount} onClick={() => void submitTopup()}>
                {topupSaving ? 'Đang ghi nhận...' : 'Nạp tiền'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
