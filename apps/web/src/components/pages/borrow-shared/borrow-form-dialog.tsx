import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/components/ui/utils';
import { getBorrowLabel } from '@/lib/status-registry';
import { borrowService, type ReservationSource } from '@/services/borrow';
import { warehouseService } from '@/services/warehouse';
import { getApiErrorMessage } from '@/services/api';

export type BorrowFormMode = 'RESERVATION' | 'DIRECT_LOAN';

interface Option {
  id: string;
  title: string;
  subtitle: string;
}

const LOOKUP_DEBOUNCE_MS = 250;
const SOURCE_CHANNELS: ReservationSource[] = ['WEB', 'MOBILE', 'COUNTER', 'ADMIN'];
const FIELD_CLASS = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20 disabled:bg-muted disabled:text-muted-foreground';

/** Debounced server lookup, skipped while disabled or shorter than `minLength`. */
function useLookup(query: string, enabled: boolean, minLength: number, fetchOptions: (q: string) => Promise<Option[]>) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const keyword = query.trim();
    if (!enabled || keyword.length < minLength) {
      setOptions([]);
      setLoading(false);
      return;
    }
    let active = true;
    const id = window.setTimeout(async () => {
      setLoading(true);
      try {
        const next = await fetchOptions(keyword);
        if (active) setOptions(next);
      } catch {
        if (active) setOptions([]);
      } finally {
        if (active) setLoading(false);
      }
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(id);
    };
    // fetchOptions is a module-level function per field; it never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, enabled, minLength]);

  return { options, loading };
}

/** Text field with a suggestion list; the field only counts as filled once a suggestion is picked. */
function SearchPicker({
  label,
  required,
  placeholder,
  query,
  onQueryChange,
  options,
  loading,
  selected,
  onSelect,
  disabled,
  className,
}: {
  label: string;
  required?: boolean;
  placeholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  options: Option[];
  loading: boolean;
  selected: boolean;
  onSelect: (option: Option) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const showList = open && !selected && (loading || options.length > 0);

  return (
    <label className={cn('text-xs font-medium text-muted-foreground', className)}>
      {label}{required ? ' *' : ''}
      <div className="relative mt-1">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(FIELD_CLASS, selected && 'pr-8')}
        />
        {selected && <Check className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" aria-label="Đã chọn" />}
        {showList && (
          <div className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-border bg-background shadow-lg">
            {loading ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Đang tìm...</p>
            ) : (
              options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => { onSelect(option); setOpen(false); }}
                  className="w-full px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <p className="text-xs font-medium text-foreground">{option.title}</p>
                  <p className="text-[11px] text-muted-foreground">{option.subtitle}</p>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </label>
  );
}

async function findCustomers(q: string): Promise<Option[]> {
  const response = await borrowService.getCustomers({ q, pageSize: 8, status: 'ACTIVE' });
  return (response.data ?? []).map((customer) => ({
    id: customer.id,
    title: customer.full_name,
    subtitle: [customer.phone || customer.email || 'Không có liên lạc', customer.customer_code].join(' · '),
  }));
}

async function findBooks(q: string): Promise<Option[]> {
  const response = await borrowService.searchVariants({ q, limit: 8 });
  return (response.data ?? []).map((variant) => ({
    id: variant.id,
    title: variant.title,
    subtitle: [variant.internal_barcode || variant.isbn, variant.sku].filter(Boolean).join(' · '),
  }));
}

async function findWarehouses(q: string): Promise<Option[]> {
  const response = await borrowService.searchWarehouses({ q: q || undefined, limit: 8 });
  return (response.data ?? []).map((warehouse) => ({
    id: warehouse.id,
    title: warehouse.name,
    subtitle: warehouse.code,
  }));
}

interface Picked { id: string; query: string }
const EMPTY_PICK: Picked = { id: '', query: '' };

/**
 * Create a reservation, or lend a book straight away at the counter (DIRECT_LOAN). Shared by the
 * reservations and loans pages so both use the same searchable fields.
 */
export function BorrowFormDialog({
  open,
  mode,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  mode: BorrowFormMode;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [customer, setCustomer] = useState<Picked>(EMPTY_PICK);
  const [book, setBook] = useState<Picked>(EMPTY_PICK);
  const [warehouse, setWarehouse] = useState<Picked>(EMPTY_PICK);
  const [pickup, setPickup] = useState<Picked>(EMPTY_PICK);
  const [pickupOptions, setPickupOptions] = useState<Option[]>([]);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [source, setSource] = useState<ReservationSource>('WEB');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomer(EMPTY_PICK);
    setBook(EMPTY_PICK);
    setWarehouse(EMPTY_PICK);
    setPickup(EMPTY_PICK);
    setQuantity('1');
    setSource('WEB');
    setNotes('');
  }, [open, mode]);

  const customers = useLookup(customer.query, open && !customer.id, 2, findCustomers);
  const books = useLookup(book.query, open && !book.id, 2, findBooks);
  const warehouses = useLookup(warehouse.query, open && !warehouse.id, 0, findWarehouses);

  useEffect(() => {
    if (!open || !warehouse.id) {
      setPickupOptions([]);
      return;
    }
    let active = true;
    setPickupLoading(true);
    warehouseService.getLocations(warehouse.id)
      .then((locations) => {
        if (!active) return;
        setPickupOptions(locations.filter((location) => location.is_active).map((location) => ({
          id: location.id,
          title: location.location_code,
          subtitle: [location.zone, location.aisle, location.shelf, location.bin].filter(Boolean).join(' · ') || location.location_type,
        })));
      })
      .catch(() => { if (active) setPickupOptions([]); })
      .finally(() => { if (active) setPickupLoading(false); });
    return () => { active = false; };
  }, [open, warehouse.id]);

  const filteredPickupOptions = useMemo(() => {
    const keyword = pickup.query.trim().toLowerCase();
    return pickupOptions
      .filter((option) => !keyword || `${option.title} ${option.subtitle}`.toLowerCase().includes(keyword))
      .slice(0, 8);
  }, [pickupOptions, pickup.query]);

  const isDirectLoan = mode === 'DIRECT_LOAN';

  const submit = async () => {
    if (!customer.id || !book.id || !warehouse.id) {
      toast.error('Vui lòng chọn khách hàng, sách và kho từ danh sách gợi ý');
      return;
    }
    const qty = Number.parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error('Số lượng phải là số nguyên dương');
      return;
    }

    const payload = {
      customer_id: customer.id,
      variant_id: book.id,
      warehouse_id: warehouse.id,
      pickup_location_id: pickup.id || undefined,
      quantity: qty,
      source_channel: isDirectLoan ? 'COUNTER' as const : source,
      notes: notes.trim() || undefined,
    };

    setSaving(true);
    try {
      if (isDirectLoan) {
        await borrowService.createDirectLoan(payload);
        toast.success('Đã tạo phiếu mượn trực tiếp');
      } else {
        await borrowService.createReservation(payload);
        toast.success('Đã tạo đặt trước thành công');
      }
      onOpenChange(false);
      onCreated();
    } catch (error) {
      toast.error(getApiErrorMessage(error, isDirectLoan ? 'Tạo phiếu mượn trực tiếp thất bại' : 'Tạo đặt trước thất bại'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isDirectLoan ? 'Mượn trực tiếp tại quầy' : 'Đặt trước mới'}</DialogTitle>
          <DialogDescription>
            {isDirectLoan
              ? 'Khách nhận sách ngay; phiếu mượn được tạo và trừ tồn kho luôn.'
              : 'Giữ sách cho khách; khách đến quầy lấy bằng mã nhận sách khi đặt trước sẵn sàng.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SearchPicker
            className="md:col-span-2"
            label="Khách hàng"
            required
            placeholder="Số điện thoại, tên hoặc email"
            query={customer.query}
            onQueryChange={(value) => setCustomer({ id: '', query: value })}
            options={customers.options}
            loading={customers.loading}
            selected={!!customer.id}
            onSelect={(option) => setCustomer({ id: option.id, query: `${option.title} (${option.subtitle})` })}
          />
          <SearchPicker
            className="md:col-span-2"
            label="Sách"
            required
            placeholder="Tên sách, ISBN hoặc mã vạch"
            query={book.query}
            onQueryChange={(value) => setBook({ id: '', query: value })}
            options={books.options}
            loading={books.loading}
            selected={!!book.id}
            onSelect={(option) => setBook({ id: option.id, query: option.title })}
          />
          <SearchPicker
            label="Kho"
            required
            placeholder="Tên hoặc mã kho"
            query={warehouse.query}
            onQueryChange={(value) => { setWarehouse({ id: '', query: value }); setPickup(EMPTY_PICK); }}
            options={warehouses.options}
            loading={warehouses.loading}
            selected={!!warehouse.id}
            onSelect={(option) => { setWarehouse({ id: option.id, query: `${option.title} (${option.subtitle})` }); setPickup(EMPTY_PICK); }}
          />
          <SearchPicker
            label="Vị trí lấy sách"
            placeholder={warehouse.id ? 'Không bắt buộc' : 'Chọn kho trước'}
            query={pickup.query}
            onQueryChange={(value) => setPickup({ id: '', query: value })}
            options={filteredPickupOptions}
            loading={pickupLoading}
            selected={!!pickup.id}
            onSelect={(option) => setPickup({ id: option.id, query: option.title })}
            disabled={!warehouse.id}
          />
          <label className="text-xs font-medium text-muted-foreground">
            Số lượng
            <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} className={cn(FIELD_CLASS, 'mt-1')} />
          </label>
          {!isDirectLoan && (
            <label className="text-xs font-medium text-muted-foreground">
              Kênh đặt
              <select value={source} onChange={(event) => setSource(event.target.value as ReservationSource)} className={cn(FIELD_CLASS, 'mt-1')}>
                {SOURCE_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>{getBorrowLabel('sourceChannel', channel)}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs font-medium text-muted-foreground md:col-span-2">
            Ghi chú
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1" />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Hủy</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isDirectLoan ? 'Tạo phiếu mượn' : 'Tạo đặt trước'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
