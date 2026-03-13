// src/pages/OrdersPage.jsx
// Danh sách Phiếu Yêu Cầu Nhập Kho

import { Link } from 'react-router-dom';
import { Plus, FileText } from 'lucide-react';

// =====================  MOCK DATA  =====================
const MOCK_ORDERS = [
  {
    id: 'PNK-2026-001',
    supplier: 'NXB Tổng hợp TP.HCM',
    total: 12_500_000,
    itemCount: 3,
    status: 'approved',
    createdBy: 'admin@smartbook.ai',
    createdAt: '25/02/2026',
  },
  {
    id: 'PNK-2026-002',
    supplier: 'Công ty Fahasa',
    total: 8_200_000,
    itemCount: 5,
    status: 'pending',
    createdBy: 'bich.tran@smartbook.ai',
    createdAt: '27/02/2026',
  },
  {
    id: 'PNK-2026-003',
    supplier: 'NXB Kim Đồng',
    total: 4_750_000,
    itemCount: 2,
    status: 'draft',
    createdBy: 'cuong.le@smartbook.ai',
    createdAt: '28/02/2026',
  },
  {
    id: 'PNK-2026-004',
    supplier: 'Đinh Tị Books',
    total: 19_300_000,
    itemCount: 8,
    status: 'pending',
    createdBy: 'admin@smartbook.ai',
    createdAt: '28/02/2026',
  },
];

// =====================  CONFIG  =====================
const STATUS_CONFIG = {
  draft:    { label: 'Bản nháp',          className: 'bg-gray-100 text-gray-600' },
  pending:  { label: 'Chờ phê duyệt',     className: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'Đã duyệt',          className: 'bg-green-100 text-green-700' },
  rejected: { label: 'Bị từ chối',        className: 'bg-red-100 text-red-600' },
};

function formatVND(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

// =====================  MAIN PAGE  =====================
export default function OrdersPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Phiếu nhập kho</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Quản lý toàn bộ yêu cầu nhập hàng từ nhà cung cấp
          </p>
        </div>
        <Link
          to="/orders/create"
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-sm"
        >
          <Plus size={16} />
          Tạo phiếu nhập mới
        </Link>
      </div>

      {/* Stats nhanh */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Tổng phiếu',      value: MOCK_ORDERS.length,                                              color: 'text-gray-800' },
          { label: 'Bản nháp',        value: MOCK_ORDERS.filter(o => o.status === 'draft').length,             color: 'text-gray-500' },
          { label: 'Chờ phê duyệt',  value: MOCK_ORDERS.filter(o => o.status === 'pending').length,           color: 'text-yellow-600' },
          { label: 'Đã duyệt',        value: MOCK_ORDERS.filter(o => o.status === 'approved').length,         color: 'text-green-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 text-center">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Bảng */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left border-b border-gray-200">
                <th className="px-5 py-3 font-semibold">Mã phiếu</th>
                <th className="px-5 py-3 font-semibold">Nhà cung cấp</th>
                <th className="px-5 py-3 font-semibold text-center">Số đầu sách</th>
                <th className="px-5 py-3 font-semibold text-right">Tổng tiền</th>
                <th className="px-5 py-3 font-semibold">Trạng thái</th>
                <th className="px-5 py-3 font-semibold">Người tạo</th>
                <th className="px-5 py-3 font-semibold">Ngày tạo</th>
                <th className="px-5 py-3 font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MOCK_ORDERS.map((order) => {
                const status = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
                return (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-indigo-600">
                      {order.id}
                    </td>
                    <td className="px-5 py-3.5 text-gray-700 font-medium">{order.supplier}</td>
                    <td className="px-5 py-3.5 text-center text-gray-600">{order.itemCount}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-800">
                      {formatVND(order.total)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs">{order.createdBy}</td>
                    <td className="px-5 py-3.5 text-gray-500 text-sm">{order.createdAt}</td>
                    <td className="px-5 py-3.5">
                      <Link
                        to={`/orders/${order.id}`}
                        className="text-xs text-indigo-600 hover:underline font-medium"
                      >
                        Xem chi tiết
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
