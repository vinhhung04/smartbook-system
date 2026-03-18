// src/pages/OrdersPage.jsx
// Danh sách Phiếu Yêu Cầu Nhập Kho

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { getGoodsReceipts, updateGoodsReceipt } from '../services/api';

// =====================  CONFIG  =====================
const STATUS_CONFIG = {
  DRAFT: { label: 'Bản nháp', className: 'bg-gray-100 text-gray-600' },
  POSTED: { label: 'Đã duyệt', className: 'bg-green-100 text-green-700' },
  CANCELLED: { label: 'Đã hủy', className: 'bg-red-100 text-red-600' },
};

function formatVND(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function formatDate(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('vi-VN');
}

// =====================  MAIN PAGE  =====================
export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [updatingId, setUpdatingId] = useState('');

  const stats = useMemo(() => {
    return {
      total: orders.length,
      draft: orders.filter((order) => order.status === 'DRAFT').length,
      posted: orders.filter((order) => order.status === 'POSTED').length,
      cancelled: orders.filter((order) => order.status === 'CANCELLED').length,
    };
  }, [orders]);

  async function loadOrders(showRefreshing = false) {
    setErrorMessage('');
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await getGoodsReceipts();
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      setErrorMessage(error.message || 'Không tải được danh sách phiếu nhập kho.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadOrders(false);
  }, []);

  async function handleUpdateStatus(orderId, nextStatus) {
    setUpdatingId(orderId);
    setErrorMessage('');

    try {
      const response = await updateGoodsReceipt(orderId, { status: nextStatus });
      const updated = response?.data;

      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? { ...order, ...updated } : order))
      );
    } catch (error) {
      setErrorMessage(error.message || 'Cập nhật trạng thái phiếu nhập thất bại.');
    } finally {
      setUpdatingId('');
    }
  }

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

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => loadOrders(true)}
          className="inline-flex items-center gap-2 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Làm mới
        </button>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {/* Stats nhanh */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Tổng phiếu', value: stats.total, color: 'text-gray-800' },
          { label: 'Bản nháp', value: stats.draft, color: 'text-gray-500' },
          { label: 'Đã duyệt', value: stats.posted, color: 'text-green-600' },
          { label: 'Đã hủy', value: stats.cancelled, color: 'text-red-600' },
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
                <th className="px-5 py-3 font-semibold">Kho</th>
                <th className="px-5 py-3 font-semibold text-center">Số đầu sách</th>
                <th className="px-5 py-3 font-semibold text-right">Tổng tiền</th>
                <th className="px-5 py-3 font-semibold">Trạng thái</th>
                <th className="px-5 py-3 font-semibold">Người tạo</th>
                <th className="px-5 py-3 font-semibold">Ngày tạo</th>
                <th className="px-5 py-3 font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-gray-500">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Đang tải phiếu nhập kho...
                    </div>
                  </td>
                </tr>
              ) : null}

              {!loading && orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-gray-500">
                    Chưa có phiếu nhập kho nào.
                  </td>
                </tr>
              ) : null}

              {!loading && orders.map((order) => {
                const status = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.DRAFT;
                const isUpdating = updatingId === order.id;

                return (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-indigo-600">
                      {order.receipt_number}
                    </td>
                    <td className="px-5 py-3.5 text-gray-700 font-medium">
                      {order.warehouse_name || '-'}
                    </td>
                    <td className="px-5 py-3.5 text-center text-gray-600">{order.item_count}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-800">
                      {formatVND(order.total_amount || 0)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs">{order.received_by_user_id}</td>
                    <td className="px-5 py-3.5 text-gray-500 text-sm">{formatDate(order.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/orders/${order.id}`}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                        >
                          Xem chi tiết
                        </Link>

                        {order.status === 'DRAFT' ? (
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => handleUpdateStatus(order.id, 'POSTED')}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:bg-green-300"
                          >
                            {isUpdating ? <Loader2 size={12} className="animate-spin" /> : null}
                            Duyệt
                          </button>
                        ) : null}

                        {order.status !== 'CANCELLED' ? (
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => handleUpdateStatus(order.id, 'CANCELLED')}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {isUpdating ? <Loader2 size={12} className="animate-spin" /> : null}
                            Hủy
                          </button>
                        ) : null}
                      </div>
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
