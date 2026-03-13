// src/pages/StockMovementPage.jsx
// Trang Lịch sử biến động kho — bảng log giao dịch + bộ lọc

import { useState } from 'react';
import { Filter } from 'lucide-react';

// =====================  MOCK DATA  =====================
const MOCK_TRANSACTIONS = [
  {
    id: 'TRX-001',
    time: '28/02/2026 09:15',
    type: 'inbound',
    book: 'Đắc Nhân Tâm',
    sku: 'BK001-HRD-NEW',
    delta: +50,
    user: 'admin@smartbook.ai',
  },
  {
    id: 'TRX-002',
    time: '28/02/2026 10:02',
    type: 'outbound',
    book: 'Nhà Giả Kim',
    sku: 'BK002-SFT-NEW',
    delta: -12,
    user: 'nhanvien01',
  },
  {
    id: 'TRX-003',
    time: '27/02/2026 14:30',
    type: 'transfer',
    book: 'Atomic Habits',
    sku: 'BK005-SFT-NEW',
    delta: 0,
    note: 'Kệ C-1 → Kệ A-3',
    user: 'nhanvien02',
  },
  {
    id: 'TRX-004',
    time: '27/02/2026 11:55',
    type: 'outbound',
    book: 'Sapiens',
    sku: 'BK003-HRD-NEW',
    delta: -5,
    user: 'nhanvien01',
  },
  {
    id: 'TRX-005',
    time: '26/02/2026 16:00',
    type: 'inbound',
    book: 'Tư Duy Nhanh Và Chậm',
    sku: 'BK004-SFT-NEW',
    delta: +30,
    user: 'admin@smartbook.ai',
  },
  {
    id: 'TRX-006',
    time: '26/02/2026 08:45',
    type: 'transfer',
    book: 'Đắc Nhân Tâm',
    sku: 'BK001-SFT-OLD',
    delta: 0,
    note: 'Kệ D-3 → Kệ B-4',
    user: 'nhanvien02',
  },
  {
    id: 'TRX-007',
    time: '25/02/2026 13:20',
    type: 'inbound',
    book: 'Dune',
    sku: 'BK042-HRD-NEW',
    delta: +20,
    user: 'admin@smartbook.ai',
  },
  {
    id: 'TRX-008',
    time: '25/02/2026 10:10',
    type: 'outbound',
    book: 'Atomic Habits',
    sku: 'BK005-SFT-NEW',
    delta: -8,
    user: 'nhanvien01',
  },
];

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

// =====================  MAIN PAGE  =====================
export default function StockMovementPage() {
  const [filterType, setFilterType] = useState('all');   // all | inbound | outbound | transfer
  const [filterDate, setFilterDate] = useState('');

  const filtered = MOCK_TRANSACTIONS.filter((t) => {
    const matchType = filterType === 'all' || t.type === filterType;
    const matchDate = !filterDate || t.time.startsWith(
      // filterDate is yyyy-mm-dd, convert to dd/mm/yyyy prefix
      `${filterDate.slice(8, 10)}/${filterDate.slice(5, 7)}/${filterDate.slice(0, 4)}`
    );
    return matchType && matchDate;
  });

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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                    Không tìm thấy giao dịch nào phù hợp.
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    {/* Thời gian */}
                    <td className="px-5 py-3.5 text-gray-500 text-xs whitespace-nowrap">{t.time}</td>

                    {/* Mã GD */}
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-600 font-semibold">
                      #{t.id}
                    </td>

                    {/* Loại */}
                    <td className="px-5 py-3.5">
                      <TypeBadge type={t.type} />
                    </td>

                    {/* Tên sách & SKU */}
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-gray-800 truncate max-w-[180px]">{t.book}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{t.sku}</p>
                    </td>

                    {/* Số lượng */}
                    <td className="px-5 py-3.5 text-center">
                      <DeltaCell type={t.type} delta={t.delta} note={t.note} />
                    </td>

                    {/* Người thực hiện */}
                    <td className="px-5 py-3.5 text-gray-500 text-xs">{t.user}</td>
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
