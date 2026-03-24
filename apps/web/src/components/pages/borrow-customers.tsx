import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserPlus, Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

function getBadgeVariant(status: CustomerStatus) {
  if (status === 'ACTIVE') return 'default';
  if (status === 'SUSPENDED') return 'destructive';
  if (status === 'BLOCKED') return 'destructive';
  return 'outline';
}

export function BorrowCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CustomerStatus>('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState<CustomerFormState>(initialFormState);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const response = await borrowService.getCustomers();
      setCustomers(response.data ?? []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load customers'));
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
      toast.error('Full name must be at least 2 characters');
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
        toast.success('Customer updated successfully');
      } else {
        await borrowService.createCustomer(payload);
        toast.success('Customer created successfully');
      }
      resetForm();
      await loadCustomers();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to save customer'));
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
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-100 to-emerald-50 flex items-center justify-center border border-teal-200/40 shadow-sm">
            <svg className="w-6 h-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Borrow Customers</h1>
            <p className="text-sm text-muted-foreground">{customers.length} customers</p>
          </div>
        </div>
        <Button size="sm" onClick={() => { setFormState(initialFormState); setFormOpen(true); }} className="gap-2">
          <UserPlus className="w-4 h-4" />
          New Customer
        </Button>
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
          searchPlaceholder="Search customer..."
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
                  {['Code', 'Name', 'Email', 'Phone', 'Status', 'Fine Balance', 'Action'].map((header) => (
                    <th key={header} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-14">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading customers...</span>
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        variant="no-results"
                        title="No customers found"
                        description="Try adjusting your search or filters."
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
                        <Badge variant={getBadgeVariant(customer.status)}>{customer.status}</Badge>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-medium text-rose-600">
                        {Number(customer.total_fine_balance).toLocaleString('vi-VN')} VND
                      </td>
                      <td className="px-5 py-3.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-blue-200 text-blue-700 hover:bg-blue-50"
                          onClick={() => openEdit(customer)}
                        >
                          Edit
                        </Button>
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
              <h3 className="text-base font-semibold mb-4">{formState.id ? 'Edit Customer' : 'New Customer'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <label className="text-xs font-medium text-muted-foreground">
                  Full name*
                  <input
                    value={formState.full_name}
                    onChange={(event) => setFormState((prev) => ({ ...prev, full_name: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Status
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
                  Phone
                  <input
                    value={formState.phone}
                    onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Birth date
                  <input
                    type="date"
                    value={formState.birth_date}
                    onChange={(event) => setFormState((prev) => ({ ...prev, birth_date: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                  Address
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
                  Cancel
                </Button>
                <Button className="flex-1" onClick={() => void onSave()} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
