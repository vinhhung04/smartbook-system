import { useMemo, useState } from 'react';
import { X, MapPin, CheckCircle, Loader2 } from 'lucide-react';
import { CustomerCatalogBook } from '@/services/customer-catalog';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';

interface ReserveModalProps {
  book: CustomerCatalogBook | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface WarehouseOption {
  warehouse_id: string;
  warehouse_name: string;
  available_quantity: number;
}

export function ReserveModal({ book, onClose, onSuccess }: ReserveModalProps) {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const availableWarehouses = useMemo<WarehouseOption[]>(() => {
    if (!book?.locations) return [];
    const map = new Map<string, WarehouseOption>();
    for (const loc of book.locations) {
      if (loc.is_receiving) continue;
      const avail = loc.available_quantity ?? loc.quantity;
      if (!avail || avail <= 0 || !loc.warehouse_id) continue;
      const existing = map.get(loc.warehouse_id);
      if (existing) {
        existing.available_quantity += avail;
      } else {
        map.set(loc.warehouse_id, {
          warehouse_id: loc.warehouse_id,
          warehouse_name: loc.warehouse_name || 'Kho không tên',
          available_quantity: avail,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.available_quantity - a.available_quantity);
  }, [book?.locations]);

  const autoSelected = availableWarehouses.length === 1 ? availableWarehouses[0].warehouse_id : '';
  const effectiveWarehouseId = selectedWarehouseId || autoSelected;

  if (!book) return null;

  const handleConfirm = async () => {
    if (!effectiveWarehouseId || !book.variant_id) return;
    try {
      setSubmitting(true);
      await customerBorrowService.createReservation({
        variant_id: book.variant_id,
        warehouse_id: effectiveWarehouseId,
        quantity: 1,
      });
      toast.success('Đặt trước thành công!');
      onSuccess();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Đặt trước sách thất bại'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] text-slate-900" style={{ fontWeight: 700 }}>Chọn cửa hàng đặt trước</h2>
            <p className="mt-0.5 text-[12px] text-slate-400 line-clamp-1">{book.title}</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {availableWarehouses.length === 0 ? (
            <div className="py-6 text-center">
              <MapPin className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="text-[13px] text-slate-500">Hiện không có cửa hàng nào có sách trên kệ</p>
              <p className="mt-1 text-[12px] text-slate-400">Sách có thể đang trong quá trình nhập kho</p>
            </div>
          ) : availableWarehouses.length === 1 ? (
            <div className="space-y-3">
              <p className="text-[12px] text-slate-500">Cửa hàng có sách:</p>
              <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                <CheckCircle className="h-4 w-4 text-indigo-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-slate-900" style={{ fontWeight: 600 }}>{availableWarehouses[0].warehouse_name}</p>
                  <p className="text-[11px] text-emerald-600">{availableWarehouses[0].available_quantity} cuốn sẵn sàng</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[12px] text-slate-500">Chọn cửa hàng bạn muốn đến lấy sách:</p>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {availableWarehouses.map((wh) => {
                  const selected = effectiveWarehouseId === wh.warehouse_id;
                  return (
                    <button
                      key={wh.warehouse_id}
                      onClick={() => setSelectedWarehouseId(wh.warehouse_id)}
                      className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                        selected
                          ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        selected ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300'
                      }`}>
                        {selected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-slate-900" style={{ fontWeight: 600 }}>{wh.warehouse_name}</p>
                        <p className="text-[11px] text-emerald-600">{wh.available_quantity} cuốn sẵn sàng</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {availableWarehouses.length > 0 && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <button
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[13px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              style={{ fontWeight: 500 }}
            >
              Hủy
            </button>
            <button
              onClick={() => void handleConfirm()}
              disabled={!effectiveWarehouseId || submitting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 transition-colors"
              style={{ fontWeight: 600 }}
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Xác nhận đặt trước
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
