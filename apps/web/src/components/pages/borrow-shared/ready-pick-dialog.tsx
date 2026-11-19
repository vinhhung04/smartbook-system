import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { borrowService, type Reservation } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { PickLinesEditor } from './pick-lines-editor';
import { pickCountsToLines, pickCountsTotal, type PickCounts } from './pick-counts';

/**
 * "Ready for pickup": the librarian has the copies in hand and says which shelves they came from,
 * so stock is held, and later lent out, from those shelves.
 */
export function ReadyPickDialog({
  reservation,
  bookTitle,
  onOpenChange,
  onDone,
}: {
  reservation: Reservation | null;
  bookTitle: string;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [counts, setCounts] = useState<PickCounts>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { setCounts({}); }, [reservation?.id]);

  if (!reservation) return null;
  const total = pickCountsTotal(counts);

  const submit = async () => {
    if (total !== reservation.quantity) {
      toast.error(`Cần nhập đủ ${reservation.quantity} cuốn đã lấy (hiện ${total})`);
      return;
    }
    setSaving(true);
    try {
      await borrowService.confirmReservation(reservation.id, { status: 'READY_FOR_PICKUP', picks: pickCountsToLines(counts) });
      toast.success('Đặt trước sẵn sàng lấy sách');
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Báo sẵn sàng thất bại'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Đã lấy sách cho {reservation.reservation_number}</DialogTitle>
          <DialogDescription>
            {bookTitle}, {reservation.quantity} cuốn. Nhập số cuốn đã lấy ở từng vị trí; tồn kho sẽ trừ đúng các vị trí này.
          </DialogDescription>
        </DialogHeader>
        <PickLinesEditor
          variantId={reservation.variant_id}
          warehouseId={reservation.warehouse_id}
          reservationId={reservation.id}
          quantity={reservation.quantity}
          value={counts}
          onChange={setCounts}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Hủy</Button>
          <Button onClick={() => void submit()} disabled={saving || total !== reservation.quantity} data-testid="confirm-ready-pick-button">
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Báo sẵn sàng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
