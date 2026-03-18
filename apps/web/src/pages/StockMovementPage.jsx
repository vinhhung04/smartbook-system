// src/pages/StockMovementPage.jsx
// Trang Lịch sử biến động kho — bảng log giao dịch + bộ lọc

import { useEffect, useMemo, useState } from 'react';
import { Filter, Loader2, RefreshCw } from 'lucide-react';
import { getStockMovements } from '../services/api';

// =====================  TYPE CONFIG  =====================
const TYPE_CONFIG = {
  inbound:  { label: 'Nhập kho',       className: 'bg-green-100 text-green-700' },
  outbound: { label: 'Xuất kho',       className: 'bg-red-100 text-red-700' },
  transfer: { label: 'Chuyển vị trí',  className: 'bg-blue-100 text-blue-700' },
};

function TypeBadge({ type }) {
  const cfg = TYPE_CONFIG[type] ?? { label: type, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function DeltaCell({ type, delta, note }) {
  if (type === 'transfer') {
    return <span className="text-blue-600 text-xs font-medium">{note ?? '—'}</span>;
  }
  const positive = delta > 0;
  return (
    <span className={`font-bold text-sm ${positive ? 'text-green-600' : 'text-red-600'}`}>
      {positive ? `+${delta}` : delta}
    </span>
  );
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function isSameDate(value, filterDate) {
  if (!filterDate) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateString = `${year}-${month}-${day}`;
  return dateString === filterDate;
}

// =====================  MAIN PAGE  =====================
export default function StockMovementPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [movements, setMovements] = useState([]);
  const [filterType, setFilterType] = useState('all');   // all | inbound | outbound | transfer
  const [filterDate, setFilterDate] = useState('');

  async function loadMovements(showRefreshing = false) {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setErrorMessage('');
    try {
      const response = await getStockMovements();
      setMovements(Array.isArray(response) ? response : []);
    } catch (error) {
      setErrorMessage(error.message || 'Không tải được lịch sử kho từ DB.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadMovements(false);
  }, []);

  const filtered = useMemo(() => movements.filter((t) => {
    const matchType = filterType === 'all' || t.type === filterType;
    const matchDate = isSameDate(t.created_at, filterDate);
    return matchType && matchDate;
  }), [movements, filterType, filterDate]);

  return (
    <div className="space-y-6">
      {/* Page header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Lịch sử giao dịch kho</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Toàn bộ log nhập / xuất / chuyển vị trí tồn kho
          </p>
        </div>

        {/* Bộ lọc */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => loadMovements(true)}
            className="inline-flex items-center gap-2 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg"
          >
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Làm mới
          </button>

          <div className="flex items-center gap-1.5 text-gray-500">
            <Filter size={15} />
            <span className="text-sm font-medium">Lọc:</span>
          </div>

          {/* Chọn ngày */}
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-700"
          />

          {/* Chọn loại giao dịch */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-700"
          >
            <option value="all">Tất cả loại</option>
            <option value="inbound">Nhập kho</option>
            <option value="outbound">Xuất kho</option>
            <option value="transfer">Chuyển vị trí</option>
          </select>

          {/* Reset */}
          {(filterType !== 'all' || filterDate) && (
            <button
              onClick={() => { setFilterType('all'); setFilterDate(''); }}
              className="text-xs text-indigo-600 hover:underline"
            >
              Xoá bộ lọc
            </button>
          )}
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      ) : null}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {/* Summary row */}
        <div className="px-6 py-3 border-b border-gray-100 text-xs text-gray-500">
          Hiển thị <span className="font-semibold text-gray-700">{filtered.length}</span> giao dịch
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left">
                <th className="px-5 py-3 font-semibold">Thời gian</th>
                <th className="px-5 py-3 font-semibold">Mã GD</th>
                <th className="px-5 py-3 font-semibold">Loại</th>
                <th className="px-5 py-3 font-semibold">Tên sách / SKU</th>
                <th className="px-5 py-3 font-semibold text-center">Số lượng</th>
                <th className="px-5 py-3 font-semibold">Người thực hiện</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Đang tải dữ liệu từ DB...
                    </span>
                  </td>
                </tr>
              ) : null}

              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                    Không tìm thấy giao dịch nào phù hợp.
                  </td>
                </tr>
              ) : (
                !loading && filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    {/* Thời gian */}
                    <td className="px-5 py-3.5 text-gray-500 text-xs whitespace-nowrap">{formatDateTime(t.created_at)}</td>

                    {/* Mã GD */}
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-600 font-semibold">
                      #{t.movement_number || t.id}
                    </td>

                    {/* Loại */}
                    <td className="px-5 py-3.5">
                      <TypeBadge type={t.type} />
                    </td>

                    {/* Tên sách & SKU */}
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-gray-800 truncate max-w-[220px]">{t.book_title}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{t.sku || t.barcode || '-'}</p>
                    </td>

                    {/* Số lượng */}
                    <td className="px-5 py-3.5 text-center">
                      <DeltaCell type={t.type} delta={t.delta} note={t.transfer_note} />
                    </td>

                    {/* Người thực hiện */}
                    <td className="px-5 py-3.5 text-gray-500 text-xs">{t.created_by_user_id || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
