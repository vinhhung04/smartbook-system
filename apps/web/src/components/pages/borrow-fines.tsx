import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { borrowService, type Fine } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';

function getBadgeVariant(status: string) {
  if (status === 'PAID') return 'default';
  if (status === 'WAIVED') return 'outline';
  if (status === 'UNPAID') return 'destructive';
  return 'secondary';
}

export function BorrowFinesPage() {
  const [fines, setFines] = useState<Fine[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED'>('ALL');

  const loadFines = async () => {
    try {
      setLoading(true);
      const response = await borrowService.getFines();
      setFines(response.data ?? []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load fines'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFines();
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return fines.filter((fine) => {
      if (statusFilter !== 'ALL' && fine.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        fine.id.toLowerCase().includes(keyword)
        || fine.customers?.full_name?.toLowerCase().includes(keyword)
        || fine.customers?.customer_code?.toLowerCase().includes(keyword)
        || fine.fine_type.toLowerCase().includes(keyword)
      );
    });
  }, [fines, query, statusFilter]);

  const viewDetail = async (id: string) => {
    try {
      const detail = await borrowService.getFineById(id);
      const remaining = Number(detail.data.summary?.remaining_balance || 0).toLocaleString('vi-VN');
      toast.message(`Fine ${id}`, {
        description: `Type: ${detail.data.fine_type} | Remaining: ${remaining} VND | Status: ${detail.data.status}`,
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load fine detail'));
    }
  };

  const recordPayment = async (fine: Fine) => {
    const remaining = Number(fine.summary?.remaining_balance || 0);
    if (remaining <= 0) {
      toast.error('No remaining balance to pay');
      return;
    }

    const raw = window.prompt(`Enter payment amount (remaining ${remaining.toLocaleString('vi-VN')} VND):`, String(remaining));
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Payment amount must be a positive number');
      return;
    }

    try {
      await borrowService.recordFinePayment(fine.id, {
        amount,
        payment_method: 'CASH',
      });
      toast.success('Fine payment recorded');
      await loadFines();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to record fine payment'));
    }
  };

  const waiveFine = async (fine: Fine) => {
    const remaining = Number(fine.summary?.remaining_balance || 0);
    if (remaining <= 0) {
      toast.error('No remaining balance to waive');
      return;
    }

    const raw = window.prompt(`Enter waive/reduce amount (remaining ${remaining.toLocaleString('vi-VN')} VND):`, String(remaining));
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Waive amount must be a positive number');
      return;
    }

    const note = window.prompt('Waive reason (optional):', '') || undefined;

    try {
      await borrowService.waiveFine(fine.id, { amount, note });
      toast.success('Fine waived/reduced');
      await loadFines();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to waive fine'));
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
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-100 to-orange-50 flex items-center justify-center border border-amber-200/40 shadow-sm">
            <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Borrow Fines</h1>
            <p className="text-sm text-muted-foreground">{fines.length} fines</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadFines()}
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </motion.div>

      {/* Filter Bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
      >
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search fine..."
          filters={
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
              {(['ALL', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                    statusFilter === status
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

      {/* Fines Table */}
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
                  {['Fine', 'Customer', 'Type', 'Amount', 'Remaining', 'Status', 'Action'].map((header) => (
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
                        <span className="text-sm">Loading fines...</span>
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        variant="no-results"
                        title="No fines found"
                        description="Try adjusting your search or filters."
                        className="py-12"
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((fine, index) => (
                    <motion.tr
                      key={fine.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: index * 0.02 }}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5 text-sm font-medium text-muted-foreground">{fine.id.slice(0, 8)}</td>
                      <td className="px-5 py-3.5 text-sm">{fine.customers?.full_name || fine.customer_id}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{fine.fine_type}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{Number(fine.amount || 0).toLocaleString('vi-VN')} VND</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{Number(fine.summary?.remaining_balance || 0).toLocaleString('vi-VN')} VND</td>
                      <td className="px-5 py-3.5">
                        <Badge variant={getBadgeVariant(fine.status)}>{fine.status}</Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void viewDetail(fine.id)}
                          >
                            Detail
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => void recordPayment(fine)}
                            disabled={Number(fine.summary?.remaining_balance || 0) <= 0}
                          >
                            Pay
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-200 text-amber-700 hover:bg-amber-50"
                            onClick={() => void waiveFine(fine)}
                            disabled={Number(fine.summary?.remaining_balance || 0) <= 0}
                          >
                            Waive/Reduce
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
    </div>
  );
}
