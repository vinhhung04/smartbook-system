import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  borrowService,
  type Reservation,
  type ReservationSource,
  type ReservationStatus,
  type VariantLookupItem,
  type WarehouseLookupItem,
} from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { warehouseService, type WarehouseLocation } from '@/services/warehouse';

const statuses: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'CANCELLED', 'EXPIRED', 'CONVERTED_TO_LOAN'];

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

function getBadgeVariant(status: ReservationStatus) {
  if (status === 'PENDING') return 'destructive';
  if (status === 'CONFIRMED' || status === 'READY_FOR_PICKUP') return 'secondary';
  if (status === 'CONVERTED_TO_LOAN') return 'default';
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'outline';
  return 'secondary';
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function BorrowReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
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

  const loadReservations = async () => {
    try {
      setLoading(true);
      const response = await borrowService.getReservations();
      setReservations(response.data ?? []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load reservations'));
    } finally {
      setLoading(false);
    }
  };

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
    const contact = customer.phone || customer.email || 'No contact';
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
      toast.error('Customer, variant_id and warehouse_id are required');
      return;
    }

    const qty = Number.parseInt(formState.quantity, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error('Quantity must be a positive integer');
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
        toast.success('Direct loan created successfully');
      } else {
        await borrowService.createReservation(payload);
        toast.success('Reservation created successfully');
      }

      setFormOpen(false);
      setFormMode('RESERVATION');
      setFormState(initialFormState);
      await loadReservations();
    } catch (error) {
      toast.error(getApiErrorMessage(error, formMode === 'DIRECT_LOAN' ? 'Failed to create direct loan' : 'Failed to create reservation'));
    } finally {
      setSaving(false);
    }
  };

  const cancelReservation = async (id: string) => {
    if (!window.confirm('Cancel this reservation?')) return;

    try {
      await borrowService.cancelReservation(id);
      toast.success('Reservation cancelled');
      await loadReservations();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to cancel reservation'));
    }
  };

  const convertReservation = async (id: string) => {
    if (!window.confirm('Convert this reservation to loan now?')) return;

    try {
      await borrowService.convertReservationToLoan(id);
      toast.success('Reservation converted to loan');
      await loadReservations();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to convert reservation'));
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
      {/* Hero Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-50 flex items-center justify-center border border-indigo-200/40 shadow-sm">
            <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Borrow Reservations</h1>
            <p className="text-sm text-muted-foreground">{reservations.length} reservations</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={openReservationForm} className="gap-2">
            <Plus className="w-4 h-4" />
            New Reservation
          </Button>
          <Button size="sm" variant="outline" onClick={openDirectLoanForm} className="gap-2">
            <Plus className="w-4 h-4" />
            New Direct Loan
          </Button>
        </div>
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
          searchPlaceholder="Search reservation..."
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
                  <span className="relative z-10">{status}</span>
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

      {/* Reservations Table */}
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
                  {['No.', 'Customer', 'Variant', 'Warehouse', 'Qty', 'Expires At', 'Status', 'Action'].map((header) => (
                    <th key={header} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-14">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading reservations...</span>
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        variant="no-results"
                        title="No reservations found"
                        description="Try adjusting your search or filters."
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
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{reservation.variant_id}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{reservation.warehouse_id}</td>
                      <td className="px-5 py-3.5 text-sm">{reservation.quantity}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{new Date(reservation.expires_at).toLocaleString('vi-VN')}</td>
                      <td className="px-5 py-3.5">
                        <Badge variant={getBadgeVariant(reservation.status)}>{reservation.status}</Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        {['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(reservation.status) ? (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                              onClick={() => void convertReservation(reservation.id)}
                            >
                              Convert
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-200 text-amber-700 hover:bg-amber-50"
                              onClick={() => void cancelReservation(reservation.id)}
                            >
                              Cancel
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

      {/* Create Form Modal */}
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
                {formMode === 'DIRECT_LOAN' ? 'New Direct Loan (Counter)' : 'New Reservation'}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                  Customer (phone, name, email)*
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
                      placeholder="Type phone/name/email to search customer"
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />

                    {(customerLoading || customerOptions.length > 0) && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background shadow-lg max-h-52 overflow-auto">
                        {customerLoading ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Searching customers...</p>
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
                              <p className="text-[11px] text-muted-foreground">{customer.phone || customer.email || 'No contact'} • {customer.customer_code}</p>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formState.customer_id ? `Selected customer ID: ${formState.customer_id}` : 'Please select a customer from suggestions'}
                  </p>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Variant (title / ISBN / barcode)*
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
                      placeholder="Type title / ISBN / barcode"
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />

                    {(variantLoading || variantOptions.length > 0) && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background shadow-lg max-h-52 overflow-auto">
                        {variantLoading ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Searching variants...</p>
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
                    {formState.variant_id ? `Selected variant ID: ${formState.variant_id}` : 'Please select a variant from suggestions'}
                  </p>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Warehouse (name / code)*
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
                      placeholder="Type warehouse name/code"
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />

                    {(warehouseLoading || warehouseOptions.length > 0) && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background shadow-lg max-h-52 overflow-auto">
                        {warehouseLoading ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Loading warehouses...</p>
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
                    {formState.warehouse_id ? `Selected warehouse ID: ${formState.warehouse_id}` : 'Please select a warehouse from suggestions'}
                  </p>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Pickup location (code / zone)
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
                      placeholder={formState.warehouse_id ? 'Type location code/zone' : 'Select warehouse first'}
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:bg-muted disabled:text-muted-foreground"
                    />

                    {(pickupLoading || (formState.warehouse_id && filteredPickupLocations.length > 0)) && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background shadow-lg max-h-52 overflow-auto">
                        {pickupLoading ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Loading pickup locations...</p>
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
                    {formState.pickup_location_id ? `Selected pickup location ID: ${formState.pickup_location_id}` : 'Optional: choose pickup location from this warehouse'}
                  </p>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Quantity
                  <input type="number" min={1} value={formState.quantity} onChange={(event) => setFormState((prev) => ({ ...prev, quantity: event.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Source
                  <select value={formState.source_channel} onChange={(event) => setFormState((prev) => ({ ...prev, source_channel: event.target.value as ReservationSource }))}
                    disabled={formMode === 'DIRECT_LOAN'}
                    className="mt-1 w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:bg-muted disabled:text-muted-foreground">
                    {(['WEB', 'MOBILE', 'COUNTER', 'ADMIN'] as const).map((source) => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                  Notes
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
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => void submitReservation()}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : (formMode === 'DIRECT_LOAN' ? 'Create Direct Loan' : 'Create Reservation')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
