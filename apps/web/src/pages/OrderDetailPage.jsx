import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getGoodsReceiptDetail } from '../services/api';

function formatVND(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);
}

function formatDateTime(input) {
  if (!input) return '-';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('vi-VN');
}

const STATUS_CONFIG = {
  DRAFT: { label: 'Bản nháp', className: 'bg-gray-100 text-gray-700' },
  POSTED: { label: 'Đã duyệt', className: 'bg-green-100 text-green-700' },
  CANCELLED: { label: 'Đã hủy', className: 'bg-red-100 text-red-700' },
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      setLoading(true);
      setErrorMessage('');

      try {
        const data = await getGoodsReceiptDetail(id);
        if (!cancelled) {
          setReceipt(data);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error.message || 'Không tải được chi tiết phiếu nhập kho.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDetail();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const status = useMemo(() => {
    if (!receipt) return STATUS_CONFIG.DRAFT;
    return STATUS_CONFIG[receipt.status] || STATUS_CONFIG.DRAFT;
  }, [receipt]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <div className="inline-flex items-center gap-2">
          <Loader2 size={18} className="animate-spin" />
          Đang tải chi tiết phiếu nhập kho...
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="space-y-4">
        <Link to="/orders" className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline">
          <ArrowLeft size={15} />
          Quay lại danh sách
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link to="/orders" className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline mb-2">
            <ArrowLeft size={15} />
            Quay lại danh sách
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">Chi tiết phiếu nhập kho</h1>
          <p className="text-sm text-gray-500 mt-1">Mã phiếu: {receipt.receipt_number}</p>
        </div>
        <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${status.className}`}>
          {status.label}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-100 p-4">
          <p className="text-xs text-gray-500">Kho</p>
          <p className="text-sm font-semibold text-gray-800 mt-1">{receipt.warehouse_name || '-'} ({receipt.warehouse_code || '-'})</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-4">
          <p className="text-xs text-gray-500">Người tạo</p>
          <p className="text-sm font-semibold text-gray-800 mt-1">{receipt.received_by_user_id}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-4">
          <p className="text-xs text-gray-500">Thời gian tạo</p>
          <p className="text-sm font-semibold text-gray-800 mt-1">{formatDateTime(receipt.created_at)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-4">
          <p className="text-xs text-gray-500">Tổng tiền</p>
          <p className="text-sm font-semibold text-indigo-700 mt-1">{formatVND(receipt.total_amount)}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-100 p-4">
        <p className="text-xs text-gray-500">Ghi chú</p>
        <p className="text-sm text-gray-700 mt-1">{receipt.note || 'Không có ghi chú'}</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Danh sách sách đã nhập ({receipt.item_count})</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left border-b border-gray-200">
                <th className="px-4 py-3 font-semibold">Sách</th>
                <th className="px-4 py-3 font-semibold">Barcode/SKU</th>
                <th className="px-4 py-3 font-semibold">Vị trí</th>
                <th className="px-4 py-3 font-semibold text-center">Số lượng</th>
                <th className="px-4 py-3 font-semibold text-right">Đơn giá</th>
                <th className="px-4 py-3 font-semibold text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receipt.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-gray-800 font-medium">{item.book_title}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs font-mono">{item.barcode || item.sku || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{item.location_code || '-'} {item.location_type ? `(${item.location_type})` : ''}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{item.quantity}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatVND(item.unit_cost)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">{formatVND(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
