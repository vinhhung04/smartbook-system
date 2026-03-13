// src/pages/DashboardPage.jsx
// Trang Tổng quan — Metric Cards + Bar Chart + Heatmap + Bảng cảnh báo

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { BookOpen, ScanLine, AlertTriangle, RefreshCw } from 'lucide-react';
import WarehouseHeatmap from '../components/WarehouseHeatmap';

// =====================  MOCK DATA  =====================

// Metric cards
const metrics = [
  {
    label: 'Tổng sách trong kho',
    value: '12,840',
    sub: '+3.2% so tháng trước',
    icon: BookOpen,
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    subColor: 'text-green-600',
  },
  {
    label: 'Sắp hết hàng',
    value: '27',
    sub: '5 đầu sách cần nhập ngay',
    icon: AlertTriangle,
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-500',
    subColor: 'text-orange-500',
  },
  {
    label: 'Nhập kho AI tháng này',
    value: '312',
    sub: '↑ 48 so với tháng trước',
    icon: ScanLine,
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-600',
    subColor: 'text-purple-600',
  },
  {
    label: 'Vòng quay tồn kho (KPI)',
    value: '4.7x',
    sub: 'Mục tiêu: 5x / tháng',
    icon: RefreshCw,
    iconBg: 'bg-teal-50',
    iconColor: 'text-teal-600',
    subColor: 'text-gray-400',
  },
];

// Bar chart — Nhập / Xuất 6 tháng gần nhất
const barChartData = [
  { month: 'Th.9',  import: 410, export: 280 },
  { month: 'Th.10', import: 380, export: 320 },
  { month: 'Th.11', import: 520, export: 410 },
  { month: 'Th.12', import: 610, export: 490 },
  { month: 'Th.1',  import: 290, export: 250 },
  { month: 'Th.2',  import: 470, export: 360 },
];

// Bảng cảnh báo — Top 5 sách cần chú ý
const ALERT_TYPE = {
  low_stock: { label: 'Sắp hết hàng', className: 'bg-orange-100 text-orange-700' },
  ageing:    { label: 'Tồn kho lâu',  className: 'bg-red-100 text-red-700' },
};

const alertBooks = [
  { id: 'BK008', title: 'Atomic Habits',             author: 'James Clear',       quantity: 4,  type: 'low_stock' },
  { id: 'BK015', title: 'Nhà Giả Kim',               author: 'Paulo Coelho',      quantity: 6,  type: 'low_stock' },
  { id: 'BK023', title: 'Tư Duy Nhanh Và Chậm',      author: 'Daniel Kahneman',   quantity: 3,  type: 'low_stock' },
  { id: 'BK031', title: 'Nghệ Thuật Tinh Tế Của Việc Không Quan Tâm', author: 'Mark Manson', quantity: 58, type: 'ageing' },
  { id: 'BK042', title: 'Dune',                       author: 'Frank Herbert',     quantity: 34, type: 'ageing' },
];

// =====================  MAIN PAGE  =====================
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* ---- Page header ---- */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Tổng quan</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Xin chào, Admin! Đây là tổng quan hệ thống hôm nay.
        </p>
      </div>

      {/* ---- PHẦN 1: Metric Cards ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.map(({ label, value, sub, icon: Icon, iconBg, iconColor, subColor }) => (
          <div
            key={label}
            className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex items-start gap-4"
          >
            <div className={`w-11 h-11 rounded-lg flex-shrink-0 flex items-center justify-center ${iconBg}`}>
              <Icon size={20} className={iconColor} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 truncate">{label}</p>
              <p className="text-2xl font-bold text-gray-800 mt-0.5">{value}</p>
              <p className={`text-xs mt-1 ${subColor}`}>{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ---- PHẦN 2 + 3: Bar Chart & Heatmap ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar Chart — 2/3 */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">
              Biểu đồ Nhập – Xuất kho (6 tháng gần nhất)
            </h2>
            <span className="text-xs text-gray-400">Đơn vị: cuốn sách</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barChartData} barGap={4} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }}
                cursor={{ fill: '#f8fafc' }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
              />
              <Bar dataKey="import" name="Nhập kho" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="export" name="Xuất kho" fill="#a5b4fc" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Heatmap — 1/3 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
          <WarehouseHeatmap />
        </div>
      </div>

      {/* ---- PHẦN 4: Bảng cảnh báo ---- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            ⚠️ Cảnh báo tồn kho — Top 5 sách cần xử lý
          </h2>
          <span className="text-xs text-indigo-600 cursor-pointer hover:underline">
            Xem tất cả →
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-5 py-3 text-left font-semibold">Mã sách</th>
                <th className="px-5 py-3 text-left font-semibold">Tên sách</th>
                <th className="px-5 py-3 text-left font-semibold">Tác giả</th>
                <th className="px-5 py-3 text-center font-semibold">Số lượng còn</th>
                <th className="px-5 py-3 text-left font-semibold">Loại cảnh báo</th>
                <th className="px-5 py-3 text-left font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {alertBooks.map((book) => {
                const alert = ALERT_TYPE[book.type];
                return (
                  <tr key={book.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 text-gray-400 font-mono text-xs">{book.id}</td>
                    <td className="px-5 py-3.5 font-medium text-gray-800 max-w-[200px] truncate">
                      {book.title}
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{book.author}</td>
                    <td className="px-5 py-3.5 text-center font-bold text-gray-700">
                      {book.quantity}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${alert.className}`}>
                        {alert.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <button className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
                        {book.type === 'low_stock' ? 'Nhập kho ngay' : 'Xem chi tiết'}
                      </button>
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
