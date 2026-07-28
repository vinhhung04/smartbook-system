import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarClock, CheckCircle2, Keyboard, Loader2, Plus, RefreshCw, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonTableRow } from '@/components/ui/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { BarcodeScanModal } from '@/components/barcode-scan-modal';
import {
  borrowService,
  type Reservation,
  type ReservationSource,
  type ReservationStatus,
  type VariantLookupItem,
  type WarehouseLookupItem,
} from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { bookService } from '@/services/book';
import { warehouseService, type WarehouseLocation } from '@/services/warehouse';

const statuses: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'CANCELLED', 'EXPIRED', 'CONVERTED_TO_LOAN'];

const STATUS_LABELS: Record<string, string> = {
  ALL: 'Tất cả',
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  READY_FOR_PICKUP: 'Sẵn lấy',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn',
  CONVERTED_TO_LOAN: 'Đã mượn',
};

interface ReservationFormState {
  customer_id: string;
  variant_id: string;
  warehouse_id: string;
  pickup_location_id: string;
  quantity: string;
  source_channel: ReservationSource;
  notes: string;
}

interface CustomerLookupItem {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  customer_code: string;
}

const initialFormState: ReservationFormState = {
  customer_id: '',
  variant_id: '',
  warehouse_id: '',
  pickup_location_id: '',
  quantity: '1',
  source_channel: 'WEB',
  notes: '',
};

function getStatusVariant(status: ReservationStatus) {
  if (status === 'PENDING') return 'warning';
  if (status === 'CONFIRMED' || status === 'READY_FOR_PICKUP') return 'info';
  if (status === 'CONVERTED_TO_LOAN') return 'success';
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'neutral';
  return 'neutral';
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function BorrowReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ReservationStatus>('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'RESERVATION' | 'DIRECT_LOAN'>('RESERVATION');
  const [formState, setFormState] = useState<ReservationFormState>(initialFormState);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerOptions, setCustomerOptions] = useState<CustomerLookupItem[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [variantQuery, setVariantQuery] = useState('');
  const [variantOptions, setVariantOptions] = useState<VariantLookupItem[]>([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const [warehouseQuery, setWarehouseQuery] = useState('');
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseLookupItem[]>([]);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [pickupQuery, setPickupQuery] = useState('');
  const [pickupLocations, setPickupLocations] = useState<WarehouseLocation[]>([]);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [pickupCode, setPickupCode] = useState('');
  const [pickupConverting, setPickupConverting] = useState(false);
  const [pickupScannerOpen, setPickupScannerOpen] = useState(false);

  const loadReservations = async () => {
    try {
      setLoading(true);
      const [resResp, booksResp] = await Promise.allSettled([
        borrowService.getReservations(),
        bookService.getAll(),
      ]);
      if (resResp.status === 'fulfilled') setReservations(resResp.value.data ?? []);
      if (booksResp.status === 'fulfilled' && Array.isArray(booksResp.value)) setBooks(booksResp.value);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được danh sách đặt trước'));
    } finally {
      setLoading(false);
    }
  };

  const getBookTitle = (variantId: string) =>
    books.find((b) => b.variant_id === variantId)?.title ?? variantId.slice(0, 8) + '...';

  useEffect(() => {
    void loadReservations();
  }, []);

  useEffect(() => {
    if (!formOpen) return;

    const keyword = customerQuery.trim();
    if (keyword.length < 2) {
      setCustomerOptions([]);
      setCustomerLoading(false);
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(async () => {
      try {
        setCustomerLoading(true);
        const response = await borrowService.getCustomers({ q: keyword, pageSize: 8, status: 'ACTIVE' });
        if (!active) return;
        setCustomerOptions(response.data ?? []);
      } catch {
        if (!active) return;
        setCustomerOptions([]);
      } finally {
        if (active) {
          setCustomerLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [customerQuery, formOpen]);

  useEffect(() => {
    if (!formOpen) return;

    const keyword = variantQuery.trim();
    if (!keyword || isUuid(keyword)) {
      setVariantOptions([]);
      setVariantLoading(false);
      return;
    }

    if (keyword.length < 2) {
      setVariantOptions([]);
      setVariantLoading(false);
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(async () => {
      try {
        setVariantLoading(true);
        const response = await borrowService.searchVariants({ q: keyword, limit: 8 });
        if (!active) return;
        setVariantOptions(response.data ?? []);
      } catch {
        if (!active) return;
        setVariantOptions([]);
      } finally {
        if (active) {
          setVariantLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [variantQuery, formOpen]);

  useEffect(() => {
    if (!formOpen) return;

    const keyword = warehouseQuery.trim();
    if (keyword && isUuid(keyword)) {
      setWarehouseOptions([]);
      setWarehouseLoading(false);
      return;
    }

    if (keyword.length === 1) {
      setWarehouseOptions([]);
      setWarehouseLoading(false);
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(async () => {
      try {
        setWarehouseLoading(true);
        const response = await borrowService.searchWarehouses({ q: keyword || undefined, limit: 8 });
        if (!active) return;
        setWarehouseOptions(response.data ?? []);
      } catch {
        if (!active) return;
        setWarehouseOptions([]);
      } finally {
        if (active) {
          setWarehouseLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [warehouseQuery, formOpen]);

  useEffect(() => {
    if (!formOpen) return;

    const warehouseId = formState.warehouse_id.trim();
    if (!warehouseId || !isUuid(warehouseId)) {
      setPickupLocations([]);
      setPickupLoading(false);
      return;
    }

    let active = true;
    const fetchLocations = async () => {
      try {
        setPickupLoading(true);
        const locations = await warehouseService.getLocations(warehouseId);
        if (!active) return;
        setPickupLocations(locations.filter((location) => location.is_active));
      } catch {
        if (!active) return;
        setPickupLocations([]);
      } finally {
        if (active) {
          setPickupLoading(false);
        }
      }
    };

    void fetchLocations();
    return () => {
      active = false;
    };
  }, [formState.warehouse_id, formOpen]);

  const customerLabel = (customer: CustomerLookupItem) => {
    const contact = customer.phone || customer.email || 'Không có liên lạc';
    return `${customer.full_name} (${contact})`;
  };

  const variantLabel = (variant: VariantLookupItem) => {
    const identifier = variant.internal_barcode || variant.isbn || variant.sku;
    return `${variant.title} (${identifier})`;
  };

  const warehouseLabel = (warehouse: WarehouseLookupItem) => `${warehouse.name} (${warehouse.code})`;

  const pickupLabel = (location: WarehouseLocation) => {
    const segments = [location.location_code, location.zone, location.aisle, location.shelf, location.bin].filter(Boolean);
    return segments.join(' • ');
  };

  const filteredPickupLocations = useMemo(() => {
    const keyword = pickupQuery.trim().toLowerCase();
    const source = pickupLocations.slice(0, 30);

    if (!keyword || isUuid(pickupQuery)) {
      return source.slice(0, 8);
    }

    return source
      .filter((location) => {
        const searchable = [location.location_code, location.zone, location.aisle, location.shelf, location.bin]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchable.includes(keyword);
      })
      .slice(0, 8);
  }, [pickupLocations, pickupQuery]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return reservations.filter((reservation) => {
      if (statusFilter !== 'ALL' && reservation.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        reservation.reservation_number.toLowerCase().includes(keyword)
        || reservation.variant_id.toLowerCase().includes(keyword)
        || reservation.customers?.full_name.toLowerCase().includes(keyword)
      );
    });
  }, [reservations, query, statusFilter]);

  const submitReservation = async () => {
    if (!formState.customer_id || !formState.variant_id || !formState.warehouse_id) {
      toast.error('Vui lòng chọn khách hàng, biến thể sách và kho');
      return;
    }

    const qty = Number.parseInt(formState.quantity, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error('Số lượng phải là số nguyên dương');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        customer_id: formState.customer_id.trim(),
        variant_id: formState.variant_id.trim(),
        warehouse_id: formState.warehouse_id.trim(),
        pickup_location_id: formState.pickup_location_id.trim() || undefined,
        quantity: qty,
        source_channel: formMode === 'DIRECT_LOAN' ? 'COUNTER' : formState.source_channel,
        notes: formState.notes.trim() || undefined,
      };

      if (formMode === 'DIRECT_LOAN') {
        await borrowService.createDirectLoan(payload);
        toast.success('Đã tạo phiếu mượn trực tiếp');
      } else {
        await borrowService.createReservation(payload);
        toast.success('Đã tạo đặt trước thành công');
      }

      setFormOpen(false);
      setFormMode('RESERVATION');
      setFormState(initialFormState);
      await loadReservations();
    } catch (error) {
      toast.error(getApiErrorMessage(error, formMode === 'DIRECT_LOAN' ? 'Tạo phiếu mượn trực tiếp thất bại' : 'Tạo đặt trước thất bại'));
    } finally {
      setSaving(false);
    }
  };

  const cancelReservation = async (id: string) => {
    if (!window.confirm('Hủy đặt trước này?')) return;

    try {
      await borrowService.cancelReservation(id);
      toast.success('Đã hủy đặt trước');
      await loadReservations();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Hủy đặt trước thất bại'));
    }
  };

  const convertPickupCode = async (code = pickupCode) => {
    const value = String(code || '').trim();
    if (!value) {
      toast.error('Vui lòng nhập mã nhận sách');
      return;
    }

    try {
      setPickupConverting(true);
      const response = await borrowService.convertPickupCodeToLoan(value);
      toast.success(`Đã tạo phiếu mượn ${response.data.loan_number} từ mã nhận sách`);
      setPickupCode('');
      await loadReservations();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Chuyển đổi mã nhận sách thất bại'));
    } finally {
      setPickupConverting(false);
    }
  };

  const confirmReservation = async (id: string, status: 'CONFIRMED' | 'READY_FOR_PICKUP' = 'CONFIRMED') => {
    try {
      await borrowService.confirmReservation(id, { status });
      toast.success(status === 'READY_FOR_PICKUP' ? 'Đặt trước sẵn sàng lấy sách' : 'Đã xác nhận đặt trước');
      await loadReservations();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Xác nhận đặt trước thất bại'));
    }
  };

  const releaseExpiredReservations = async () => {
    try {
      const response = await borrowService.runExpiredReservationSweep();
      toast.success(`Đã giải phóng ${response.data.expired} đặt trước hết hạn`);
      await loadReservations();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Giải phóng đặt trước hết hạn thất bại'));
    }
  };

  const openReservationForm = () => {
    setFormOpen(true);
    setFormMode('RESERVATION');
    setFormState(initialFormState);
    setCustomerQuery('');
    setCustomerOptions([]);
    setVariantQuery('');
    setVariantOptions([]);
    setWarehouseQuery('');
    setWarehouseOptions([]);
    setPickupQuery('');
    setPickupLocations([]);
  };

  const openDirectLoanForm = () => {
    setFormOpen(true);
    setFormMode('DIRECT_LOAN');
    setFormState({ ...initialFormState, source_channel: 'COUNTER' });
    setCustomerQuery('');
    setCustomerOptions([]);
    setVariantQuery('');
    setVariantOptions([]);
    setWarehouseQuery('');
    setWarehouseOptions([]);
    setPickupQuery('');
    setPickupLocations([]);
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <PageHeader
          icon={CalendarClock}
          title="Đặt trước sách"
          description={`${reservations.length} đặt trước`}
          iconBg="bg-gradient-to-br from-indigo-100 to-purple-50 border border-indigo-200/40 shadow-sm dark:from-indigo-500/15 dark:to-purple-500/10 dark:border-indigo-500/20"
          iconColor="text-indigo-600 dark:text-indigo-400"
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => void releaseExpiredReservations()} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Giải phóng hết hạn
              </Button>
              <Button size="sm" onClick={openReservationForm} className="gap-2">
                <Plus className="w-4 h-4" />
                Đặt trước mới
              </Button>
              <Button size="sm" variant="outline" onClick={openDirectLoanForm} className="gap-2">
                <Plus className="w-4 h-4" />
                Mượn trực tiếp
              </Button>
            </>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05, ease: 'easeOut' }}
      >
        <SectionCard title="Quầy nhận sách">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <label className="flex-1 text-xs font-medium text-muted-foreground">
              Mã nhận sách / Kết quả QR
              <div className="mt-1 flex min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-primary/20">
                <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={pickupCode}
                  onChange={(event) => setPickupCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void convertPickupCode();
                    }
                  }}
                  placeholder="PU-ABCD-1234 hoặc SMARTBOOK:PICKUP:..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPickupScannerOpen(true)}
                className="gap-2"
              >
                <ScanLine className="h-4 w-4" />
                Quét QR
              </Button>
              <Button
                type="button"
                disabled={pickupConverting}
                onClick={() => void convertPickupCode()}
                className="gap-2"
              >
                {pickupConverting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Chuyển thành phiếu mượn
              </Button>
            </div>
          </div>
        </SectionCard>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
      >
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Tìm đặt trước..."
          filters={
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
              {(['ALL', ...statuses] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`relative px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                    statusFilter === status ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {statusFilter === status && (
                    <motion.div
                      layoutId="reservation-filter"
                      className="absolute inset-0 rounded-md bg-primary"
                      transition={{ duration: 0.15 }}
                    />
                  )}
                  <span className="relative z-10">{STATUS_LABELS[status] ?? status}</span>
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

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
                  {['Số đặt trước', 'Khách hàng', 'Tên sách', 'Kho', 'SL', 'Hết hạn lúc', 'Trạng thái', 'Thao tác'].map((header) => (
                    <th key={header} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={8} rows={5} />
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        variant="no-results"
                        title="Không tìm thấy đặt trước"
                        description="Thử điều chỉnh tìm kiếm hoặc bộ lọc."
                        className="py-12"
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((reservation, index) => (
                    <motion.tr
                      key={reservation.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: index * 0.02 }}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5 text-sm font-medium">{reservation.reservation_number}</td>
                      <td className="px-5 py-3.5 text-sm">{reservation.customers?.full_name || reservation.customer_id}</td>
                      <td className="px-5 py-3.5 text-sm" title={reservation.variant_id}>{getBookTitle(reservation.variant_id)}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground" title={reservation.warehouse_id}>{reservation.warehouse_id?.slice(0, 8)}...</td>
                      <td className="px-5 py-3.5 text-sm">{reservation.quantity}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{new Date(reservation.expires_at).toLocaleString('vi-VN')}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge label={reservation.status} variant={getStatusVariant(reservation.status)} dot />
                      </td>
                      <td className="px-5 py-3.5">
                        {['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(reservation.status) ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {reservation.status === 'PENDING' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-sky-200 text-sky-700 hover:bg-sky-50 dark:border-sky-500/20 dark:text-sky-400 dark:hover:bg-sky-500/10"
                                onClick={() => void confirmReservation(reservation.id)}
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                Xác nhận
                              </Button>
                            ) : null}
                            {reservation.status === 'READY_FOR_PICKUP' ? (
                              <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 dark:border-cyan-500/20 dark:bg-cyan-500/10">
                                <p className="text-[10px] font-medium uppercase text-cyan-600 dark:text-cyan-400">Mã nhận sách</p>
                                <p className="font-mono text-xs font-semibold text-cyan-900 dark:text-cyan-300">{reservation.pickup_code || '-'}</p>
                              </div>
                            ) : null}
                            {reservation.status === 'CONFIRMED' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-cyan-200 text-cyan-700 hover:bg-cyan-50 dark:border-cyan-500/20 dark:text-cyan-400 dark:hover:bg-cyan-500/10"
                                onClick={() => void confirmReservation(reservation.id, 'READY_FOR_PICKUP')}
                              >
                                Sẵn sàng
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-500/20 dark:text-amber-400 dark:hover:bg-amber-500/10"
                              onClick={() => void cancelReservation(reservation.id)}
                            >
                              Hủy
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </motion.div>

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
              <h3 className="text-base font-semibold mb-4">
                {formMode === 'DIRECT_LOAN' ? 'Mượn trực tiếp (Quầy)' : 'Đặt trước mới'}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                  Khách hàng (số điện thoại, tên, email) *
                  <div className="relative mt-1">
                    <input
                      value={customerQuery}
                      onChange={(event) => {
                        const value = event.target.value;
                        setCustomerQuery(value);
                        if (!value.trim()) {
                          setFormState((prev) => ({ ...prev, customer_id: '' }));
                        }
                      }}
                      placeholder="Nhập số điện thoại/tên/email để tìm khách hàng"
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />

                    {(customerLoading || customerOptions.length > 0) && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background shadow-lg max-h-52 overflow-auto">
                        {customerLoading ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Đang tìm khách hàng...</p>
                        ) : (
                          customerOptions.map((customer) => (
                            <button
                              key={customer.id}
                              type="button"
                              onClick={() => {
                                setFormState((prev) => ({ ...prev, customer_id: customer.id }));
                                setCustomerQuery(customerLabel(customer));
                                setCustomerOptions([]);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                            >
                              <p className="text-xs font-medium text-foreground">{customer.full_name}</p>
                              <p className="text-[11px] text-muted-foreground">{customer.phone || customer.email || 'Không có liên lạc'} • {customer.customer_code}</p>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formState.customer_id ? `Đã chọn khách hàng: ${formState.customer_id}` : 'Vui lòng chọn khách hàng từ gợi ý'}
                  </p>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Biến thể sách (tên/ISBN/barcode) *
                  <div className="relative mt-1">
                    <input
                      value={variantQuery}
                      onChange={(event) => {
                        const value = event.target.value;
                        setVariantQuery(value);
                        if (!value.trim()) {
                          setFormState((prev) => ({ ...prev, variant_id: '' }));
                          return;
                        }
                        if (isUuid(value)) {
                          setFormState((prev) => ({ ...prev, variant_id: value.trim() }));
                          setVariantOptions([]);
                        } else {
                          setFormState((prev) => ({ ...prev, variant_id: '' }));
                        }
                      }}
                      placeholder="Nhập tên/ISBN/barcode"
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />

                    {(variantLoading || variantOptions.length > 0) && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background shadow-lg max-h-52 overflow-auto">
                        {variantLoading ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Đang tìm biến thể...</p>
                        ) : (
                          variantOptions.map((variant) => {
                            const identifier = variant.internal_barcode || variant.isbn || variant.sku;
                            return (
                              <button
                                key={variant.id}
                                type="button"
                                onClick={() => {
                                  setFormState((prev) => ({ ...prev, variant_id: variant.id }));
                                  setVariantQuery(variantLabel(variant));
                                  setVariantOptions([]);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                              >
                                <p className="text-xs font-medium text-foreground">{variant.title}</p>
                                <p className="text-[11px] text-muted-foreground">{identifier} • {variant.sku}</p>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formState.variant_id ? `Đã chọn biến thể: ${formState.variant_id}` : 'Vui lòng chọn biến thể từ gợi ý'}
                  </p>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Kho (tên/mã) *
                  <div className="relative mt-1">
                    <input
                      value={warehouseQuery}
                      onChange={(event) => {
                        const value = event.target.value;
                        setWarehouseQuery(value);
                        if (!value.trim()) {
                          setFormState((prev) => ({ ...prev, warehouse_id: '', pickup_location_id: '' }));
                          setPickupQuery('');
                          setPickupLocations([]);
                          return;
                        }
                        if (isUuid(value)) {
                          setFormState((prev) => ({ ...prev, warehouse_id: value.trim(), pickup_location_id: '' }));
                          setPickupQuery('');
                          setWarehouseOptions([]);
                        } else {
                          setFormState((prev) => ({ ...prev, warehouse_id: '', pickup_location_id: '' }));
                          setPickupQuery('');
                        }
                      }}
                      placeholder="Nhập tên/mã kho"
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />

                    {(warehouseLoading || warehouseOptions.length > 0) && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background shadow-lg max-h-52 overflow-auto">
                        {warehouseLoading ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Đang tải kho...</p>
                        ) : (
                          warehouseOptions.map((warehouse) => (
                            <button
                              key={warehouse.id}
                              type="button"
                              onClick={() => {
                                setFormState((prev) => ({ ...prev, warehouse_id: warehouse.id, pickup_location_id: '' }));
                                setWarehouseQuery(warehouseLabel(warehouse));
                                setWarehouseOptions([]);
                                setPickupQuery('');
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                            >
                              <p className="text-xs font-medium text-foreground">{warehouse.name}</p>
                              <p className="text-[11px] text-muted-foreground">{warehouse.code} • {warehouse.warehouse_type}</p>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formState.warehouse_id ? `Đã chọn kho: ${formState.warehouse_id}` : 'Vui lòng chọn kho từ gợi ý'}
                  </p>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Vị trí lấy sách (mã/khu vực)
                  <div className="relative mt-1">
                    <input
                      value={pickupQuery}
                      onChange={(event) => {
                        const value = event.target.value;
                        setPickupQuery(value);
                        if (!value.trim()) {
                          setFormState((prev) => ({ ...prev, pickup_location_id: '' }));
                          return;
                        }
                        if (isUuid(value)) {
                          setFormState((prev) => ({ ...prev, pickup_location_id: value.trim() }));
                        } else {
                          setFormState((prev) => ({ ...prev, pickup_location_id: '' }));
                        }
                      }}
                      disabled={!formState.warehouse_id}
                      placeholder={formState.warehouse_id ? 'Nhập mã vị trí/khu vực' : 'Chọn kho trước'}
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:bg-muted disabled:text-muted-foreground"
                    />

                    {(pickupLoading || (formState.warehouse_id && filteredPickupLocations.length > 0)) && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background shadow-lg max-h-52 overflow-auto">
                        {pickupLoading ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Đang tải vị trí lấy sách...</p>
                        ) : (
                          filteredPickupLocations.map((location) => (
                            <button
                              key={location.id}
                              type="button"
                              onClick={() => {
                                setFormState((prev) => ({ ...prev, pickup_location_id: location.id }));
                                setPickupQuery(pickupLabel(location));
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                            >
                              <p className="text-xs font-medium text-foreground">{location.location_code}</p>
                              <p className="text-[11px] text-muted-foreground">{[location.zone, location.aisle, location.shelf, location.bin].filter(Boolean).join(' • ') || location.location_type}</p>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formState.pickup_location_id ? `Đã chọn vị trí: ${formState.pickup_location_id}` : 'Tùy chọn: chọn vị trí lấy sách trong kho này'}
                  </p>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Số lượng
                  <input type="number" min={1} value={formState.quantity} onChange={(event) => setFormState((prev) => ({ ...prev, quantity: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Nguồn
                  <select value={formState.source_channel} onChange={(event) => setFormState((prev) => ({ ...prev, source_channel: event.target.value as ReservationSource }))}
                    disabled={formMode === 'DIRECT_LOAN'}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:bg-muted disabled:text-muted-foreground">
                    {(['WEB', 'MOBILE', 'COUNTER', 'ADMIN'] as const).map((source) => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                  Ghi chú
                  <textarea rows={2} value={formState.notes} onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setFormOpen(false);
                    setFormMode('RESERVATION');
                  }}
                >
                  Hủy
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => void submitReservation()}
                  disabled={saving}
                >
                  {saving ? 'Đang lưu...' : (formMode === 'DIRECT_LOAN' ? 'Tạo phiếu mượn trực tiếp' : 'Tạo đặt trước')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <BarcodeScanModal
        isOpen={pickupScannerOpen}
        onClose={() => setPickupScannerOpen(false)}
        onDetected={(code) => void convertPickupCode(code)}
        title="Quét QR nhận sách"
      />
    </div>
  );
}
