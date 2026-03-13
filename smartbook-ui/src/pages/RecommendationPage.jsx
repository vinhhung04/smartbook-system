// src/pages/RecommendationPage.jsx
// Trang AI Phân tích & Gợi ý nhập hàng — dùng Mock Data

import { Zap, Archive, TrendingUp, BookOpen, ClipboardList } from 'lucide-react';

// =====================  MOCK DATA  =====================

// Metric cards
const aiMetrics = [
  {
    label: 'Mã sách cần nhập gấp',
    value: '8',
    sub: 'Dự kiến hết hàng trong 7 ngày',
    icon: Zap,
    iconBg: 'bg-red-50',
    iconColor: 'text-red-500',
    subColor: 'text-red-500',
  },
  {
    label: 'Mã sách tồn đọng (Ageing)',
    value: '14',
    sub: 'Tồn kho > 90 ngày không bán',
    icon: Archive,
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-500',
    subColor: 'text-orange-500',
  },
  {
    label: 'Độ chính xác dự báo AI',
    value: '94%',
    sub: 'Dựa trên 6 tháng dữ liệu bán hàng',
    icon: TrendingUp,
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600',
    subColor: 'text-green-600',
  },
];

// Action badge config
const ACTION_CONFIG = {
  restock:    { label: 'Nhập thêm hàng',     className: 'bg-indigo-100 text-indigo-700' },
  clearance:  { label: 'Xả hàng giảm giá',   className: 'bg-orange-100 text-orange-700' },
  urgent:     { label: 'Nhập gấp',           className: 'bg-red-100 text-red-700' },
  monitor:    { label: 'Theo dõi thêm',      className: 'bg-gray-100 text-gray-600' },
};

const recommendedBooks = [
  {
    id: 'BK001',
    title: 'Đắc Nhân Tâm',
    author: 'Dale Carnegie',
    currentStock: 15,
    salesVelocity: '~20 cuốn/tuần',
    forecastDemand: 85,
    action: 'urgent',
    suggestedQty: 100,
  },
  {
    id: 'BK005',
    title: 'Atomic Habits',
    author: 'James Clear',
    currentStock: 5,
    salesVelocity: '~12 cuốn/tuần',
    forecastDemand: 52,
    action: 'urgent',
    suggestedQty: 60,
  },
  {
    id: 'BK002',
    title: 'Nhà Giả Kim',
    author: 'Paulo Coelho',
    currentStock: 8,
    salesVelocity: '~8 cuốn/tuần',
    forecastDemand: 34,
    action: 'restock',
    suggestedQty: 40,
  },
  {
    id: 'BK004',
    title: 'Tư Duy Nhanh Và Chậm',
    author: 'Daniel Kahneman',
    currentStock: 22,
    salesVelocity: '~5 cuốn/tuần',
    forecastDemand: 22,
    action: 'monitor',
    suggestedQty: null,
  },
  {
    id: 'BK042',
    title: 'Dune',
    author: 'Frank Herbert',
    currentStock: 34,
    salesVelocity: '~1 cuốn/tuần',
    forecastDemand: 4,
    action: 'clearance',
    suggestedQty: null,
  },
  {
    id: 'BK031',
    title: 'Nghệ Thuật Tinh Tế Của Việc Không Quan Tâm',
    author: 'Mark Manson',
    currentStock: 58,
    salesVelocity: '~2 cuốn/tuần',
    forecastDemand: 8,
    action: 'clearance',
    suggestedQty: null,
  },
];

// =====================  SUBCOMPONENTS  =====================
function ActionBadge({ action }) {
  const cfg = ACTION_CONFIG[action] ?? ACTION_CONFIG.monitor;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// Thanh progress nhỏ cho stock vs forecast
function StockBar({ current, forecast }) {
  const max    = Math.max(current, forecast, 1);
  const pct    = Math.round((current / max) * 100);
  const danger = current < forecast;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${danger ? 'bg-red-400' : 'bg-green-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold ${danger ? 'text-red-500' : 'text-green-600'}`}>
        {current}
      </span>
    </div>
  );
}

// =====================  MAIN PAGE  =====================
export default function RecommendationPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">AI Phân tích &amp; Gợi ý nhập hàng</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Dự báo nhu cầu tháng tới dựa trên lịch sử bán hàng và xu hướng thị trường.
        </p>
      </div>

      {/* ---- Metric Cards ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {aiMetrics.map(({ label, value, sub, icon: Icon, iconBg, iconColor, subColor }) => (
          <div key={label} className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex items-start gap-4">
            <div className={`w-11 h-11 rounded-lg flex-shrink-0 flex items-center justify-center ${iconBg}`}>
              <Icon size={20} className={iconColor} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-2xl font-bold text-gray-800 mt-0.5">{value}</p>
              <p className={`text-xs mt-1 ${subColor}`}>{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Bảng đề xuất ---- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            📋 Danh sách gợi ý hành động ({recommendedBooks.length} đầu sách)
          </h2>
          <span className="text-xs text-gray-400">Cập nhật: 28/02/2026 06:00</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left">
                <th className="px-5 py-3 font-semibold">Ảnh bìa &amp; Tên sách</th>
                <th className="px-5 py-3 font-semibold">Tồn kho / Dự báo</th>
                <th className="px-5 py-3 font-semibold">Tốc độ bán</th>
                <th className="px-5 py-3 font-semibold text-center">Cần nhập thêm</th>
                <th className="px-5 py-3 font-semibold">Hành động đề xuất</th>
                <th className="px-5 py-3 font-semibold">Tạo phiếu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recommendedBooks.map((book) => (
                <tr key={book.id} className="hover:bg-slate-50 transition-colors">
                  {/* Ảnh bìa + Tên */}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-12 bg-indigo-50 rounded flex items-center justify-center border border-indigo-100 flex-shrink-0">
                        <BookOpen size={16} className="text-indigo-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 truncate max-w-[160px]">{book.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{book.author}</p>
                      </div>
                    </div>
                  </td>

                  {/* Tồn kho / dự báo với progress bar */}
                  <td className="px-5 py-4 w-36">
                    <StockBar current={book.currentStock} forecast={book.forecastDemand} />
                    <p className="text-xs text-gray-400 mt-1">
                      Dự báo: <span className="font-medium text-gray-600">{book.forecastDemand} cuốn</span>
                    </p>
                  </td>

                  {/* Sales velocity */}
                  <td className="px-5 py-4 text-gray-600 text-xs whitespace-nowrap">
                    {book.salesVelocity}
                  </td>

                  {/* Cần nhập thêm */}
                  <td className="px-5 py-4 text-center">
                    {book.suggestedQty ? (
                      <span className="font-bold text-indigo-600 text-base">+{book.suggestedQty}</span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>

                  {/* Badge hành động */}
                  <td className="px-5 py-4">
                    <ActionBadge action={book.action} />
                  </td>

                  {/* Nút tạo phiếu */}
                  <td className="px-5 py-4">
                    <button
                      disabled={!book.suggestedQty}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors
                        disabled:border-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed
                        enabled:border-indigo-200 enabled:text-indigo-600 enabled:hover:bg-indigo-50"
                    >
                      <ClipboardList size={13} />
                      Tạo phiếu nhập
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
