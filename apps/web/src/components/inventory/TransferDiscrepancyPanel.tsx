import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getApiErrorMessage } from '@/services/api';
import { transferDiscrepancyService, type TransferDiscrepancy, type TransferDiscrepancyItem, type TransferResolution } from '@/services/transfer-receiving';

const BUCKET_LABEL = { MISSING: 'Thiếu trong vận chuyển', DAMAGED: 'Hàng hỏng cách ly', REJECTED: 'Hàng từ chối cách ly' };
const ACTION_LABEL = { FOUND: 'Đã tìm thấy hàng của chuyến gốc', REDELIVERED: 'Đối chiếu chuyến giao bù đã nhận', RETURN_TO_SOURCE: 'Xác nhận hàng hoàn về kho nguồn', WRITE_OFF: 'Duyệt mất / loại bỏ hàng' };
const bucketQuantity = (item: TransferDiscrepancyItem, bucket: TransferResolution['bucket']) =>
  bucket === 'MISSING' ? item.remaining_missing_qty : bucket === 'DAMAGED' ? item.remaining_damaged_qty : item.remaining_rejected_qty;

export function TransferDiscrepancyPanel({ warehouseId, refreshKey, canManage }: { warehouseId?: string; refreshKey: number; canManage: boolean }) {
  const [cases, setCases] = useState<TransferDiscrepancy[]>([]);
  const [status, setStatus] = useState('OPEN');
  const [selected, setSelected] = useState<TransferDiscrepancy | null>(null);
  const [form, setForm] = useState<TransferResolution | null>(null);
  const [requestKey, setRequestKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setCases((await transferDiscrepancyService.list(warehouseId, status)).data); }
    catch (error) { toast.error(getApiErrorMessage(error, 'Không tải được hồ sơ chênh lệch')); }
    finally { setLoading(false); }
  }, [warehouseId, status]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const open = async (row: TransferDiscrepancy) => {
    try {
      const detail = (await transferDiscrepancyService.get(row.transfer_order_id)).data;
      setSelected({ ...detail, transfer_number: row.transfer_number });
      const item = detail.items.find(value => value.remaining_missing_qty + value.remaining_damaged_qty + value.remaining_rejected_qty > 0);
      const bucket = item?.remaining_missing_qty ? 'MISSING' : item?.remaining_damaged_qty ? 'DAMAGED' : 'REJECTED';
      setForm(item ? { discrepancy_item_id: item.id, bucket, action: bucket === 'MISSING' ? 'FOUND' : 'WRITE_OFF', quantity: 1, reason: '', evidence_reference: '' } : null);
      setRequestKey(crypto.randomUUID());
    } catch (error) { toast.error(getApiErrorMessage(error, 'Không tải được chi tiết chênh lệch')); }
  };
  const update = (changes: Partial<TransferResolution>) => {
    setForm(current => current ? { ...current, ...changes } : null);
    setRequestKey(crypto.randomUUID());
  };
  const resolve = async () => {
    if (!selected || !form || !form.reason.trim() || !form.evidence_reference.trim()) return;
    setSaving(true);
    try {
      const result = await transferDiscrepancyService.resolve(selected.transfer_order_id, form, requestKey);
      setSelected({ ...result.data, transfer_number: selected.transfer_number });
      setForm(null);
      setConfirmOpen(false);
      toast.success(result.data.status === 'RESOLVED' ? 'Đã xử lý xong hồ sơ chênh lệch' : 'Đã ghi nhận phần chênh lệch được xử lý');
      await load();
    } catch (error) { toast.error(getApiErrorMessage(error, 'Xử lý chênh lệch thất bại')); }
    finally { setSaving(false); }
  };
  const item = selected?.items.find(value => value.id === form?.discrepancy_item_id);
  const actions: TransferResolution['action'][] = form?.bucket === 'MISSING' ? ['FOUND', 'REDELIVERED', 'WRITE_OFF'] : ['RETURN_TO_SOURCE', 'WRITE_OFF'];
  const selectClass = 'h-9 w-full rounded-md border border-border bg-background px-3 text-sm';
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5" aria-labelledby="transfer-discrepancy-title" data-testid="transfer-discrepancies">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="transfer-discrepancy-title" className="text-lg font-semibold">Chênh lệch chuyển kho</h2>
          <p className="text-sm text-muted-foreground">Hàng đạt được cất bình thường. Hàng hỏng, từ chối ở khu cách ly; hàng thiếu cần xác minh riêng.</p></div>
        <label className="text-sm">Hồ sơ
          <select aria-label="Tình trạng hồ sơ chênh lệch" value={status} onChange={event => { setStatus(event.target.value); setSelected(null); setForm(null); }} className={selectClass}>
            <option value="OPEN">Chưa xử lý xong</option><option value="RESOLVED">Đã xử lý xong</option>
          </select>
        </label>
      </div>
      {loading ? <p role="status" className="text-sm text-muted-foreground">Đang tải hồ sơ…</p> : cases.length === 0 ? <p className="text-sm text-muted-foreground">Không có hồ sơ trong phạm vi kho đang xem.</p> : (
        <ul className="divide-y divide-border">{cases.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="font-medium">{row.transfer_number || row.transfer_order_id}</p>
            <p className="text-sm text-muted-foreground">Thiếu {row.items.reduce((sum, value) => sum + value.remaining_missing_qty, 0)} · Hỏng {row.items.reduce((sum, value) => sum + value.remaining_damaged_qty, 0)} · Từ chối {row.items.reduce((sum, value) => sum + value.remaining_rejected_qty, 0)}</p></div>
          <Button variant="outline" size="sm" onClick={() => void open(row)}>{canManage && row.status === 'OPEN' ? 'Xem và xử lý' : 'Xem hồ sơ'}</Button>
        </li>)}</ul>
      )}
      {selected && <div className="space-y-4 border-t border-border pt-4">
        <h3 className="font-semibold">{selected.transfer_number || selected.transfer_order_id} · {selected.status === 'RESOLVED' ? 'Đã xử lý xong' : 'Đang xác minh'}</h3>
        <ul className="space-y-2 text-sm">{selected.items.map(value => <li key={value.id}><span className="font-medium">{value.title || value.sku || value.variant_id}</span>: xuất {value.shipped_qty}, đến {value.delivered_qty}, đạt {value.accepted_qty}; còn thiếu {value.remaining_missing_qty}, hỏng {value.remaining_damaged_qty}, từ chối {value.remaining_rejected_qty}</li>)}</ul>
        {canManage && form && <div className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-2">
          <label className="text-sm">Sách<select className={selectClass} value={form.discrepancy_item_id} onChange={event => {
            const next = selected.items.find(value => value.id === event.target.value)!;
            const bucket = next.remaining_missing_qty ? 'MISSING' : next.remaining_damaged_qty ? 'DAMAGED' : 'REJECTED';
            update({ discrepancy_item_id: next.id, bucket, action: bucket === 'MISSING' ? 'FOUND' : 'WRITE_OFF', quantity: 1, redelivery_transfer_id: undefined });
          }}>{selected.items.filter(value => value.remaining_missing_qty + value.remaining_damaged_qty + value.remaining_rejected_qty > 0).map(value => <option key={value.id} value={value.id}>{value.title || value.sku || value.variant_id}</option>)}</select></label>
          <label className="text-sm">Loại chênh lệch<select className={selectClass} value={form.bucket} onChange={event => {
            const bucket = event.target.value as TransferResolution['bucket'];
            update({ bucket, action: bucket === 'MISSING' ? 'FOUND' : 'WRITE_OFF', quantity: 1, redelivery_transfer_id: undefined });
          }}>{(Object.keys(BUCKET_LABEL) as TransferResolution['bucket'][]).filter(bucket => item && bucketQuantity(item, bucket) > 0).map(bucket => <option value={bucket} key={bucket}>{BUCKET_LABEL[bucket]}</option>)}</select></label>
          <label className="text-sm">Phương án<select className={selectClass} value={form.action} onChange={event => update({ action: event.target.value as TransferResolution['action'], redelivery_transfer_id: undefined })}>{actions.map(action => <option key={action} value={action}>{ACTION_LABEL[action]}</option>)}</select></label>
          <label className="text-sm">Số lượng<Input type="number" min={1} max={item ? bucketQuantity(item, form.bucket) : 1} value={form.quantity} onChange={event => update({ quantity: Number(event.target.value) })} /></label>
          <label className="text-sm">Lý do phê duyệt<Input value={form.reason} maxLength={2000} onChange={event => update({ reason: event.target.value })} /></label>
          <label className="text-sm">Tham chiếu bằng chứng<Input value={form.evidence_reference} maxLength={1000} placeholder="Biên bản, ảnh hoặc mã hồ sơ" onChange={event => update({ evidence_reference: event.target.value })} /></label>
          {form.action === 'REDELIVERED' && <label className="text-sm md:col-span-2">Mã định danh phiếu giao bù đã nhận<Input value={form.redelivery_transfer_id || ''} onChange={event => update({ redelivery_transfer_id: event.target.value })} /></label>}
          <p className="text-sm text-muted-foreground md:col-span-2">{form.action === 'FOUND' ? 'Chỉ xác nhận hàng thuộc chuyến gốc đã được tìm thấy và thực nhận tại kho đích.' : form.action === 'REDELIVERED' ? 'Phiếu giao bù phải cùng kho nguồn/đích và đã được nhận. Hệ thống đối chiếu số lượng, không nhập kho thêm lần nữa.' : form.action === 'RETURN_TO_SOURCE' ? 'Chỉ xác nhận khi hàng đã thực về kho nguồn. Cần quyền WRITE cả hai kho; hàng vẫn ở khu cách ly.' : 'Phê duyệt trách nhiệm phần thiếu hoặc loại bỏ hàng cách ly, có lưu đầy đủ bằng chứng.'}</p>
          <Button className="md:col-span-2" loading={saving} disabled={saving || !form.reason.trim() || !form.evidence_reference.trim() || !Number.isInteger(form.quantity) || form.quantity <= 0 || (form.action === 'REDELIVERED' && !form.redelivery_transfer_id)} onClick={() => setConfirmOpen(true)}>Phê duyệt xử lý số lượng này</Button>
        </div>}
        {selected.status === 'OPEN' && canManage && !form && <Button variant="outline" onClick={() => void open(selected)}>Xử lý phần còn lại</Button>}
        <h4 className="text-sm font-medium">Lịch sử phê duyệt</h4>
        <ul className="space-y-2 text-sm text-muted-foreground">{selected.resolutions?.map(row => <li key={row.id}>{new Date(row.created_at).toLocaleString('vi-VN')} · {ACTION_LABEL[row.action as keyof typeof ACTION_LABEL]} · {row.quantity} cuốn · {row.reason} · {row.evidence_reference}</li>)}</ul>
      </div>}
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Phê duyệt xử lý chênh lệch"
        description={form ? `${ACTION_LABEL[form.action]}: ${form.quantity} cuốn. Hệ thống sẽ ghi nhận biến động và lưu bằng chứng phê duyệt.` : ''}
        variant={form?.action === 'WRITE_OFF' ? 'destructive' : 'default'} onConfirm={resolve} loading={saving} />
    </section>
  );
}
