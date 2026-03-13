// src/pages/InventoryPage.jsx
// Trang Quản lý Kho Sách - hiển thị danh sách với Mock Data

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, BookOpen } from 'lucide-react';

// =====================  MOCK DATA  =====================
const mockBooks = [
  {
    id: 'BK001',
    title: 'Đắc Nhân Tâm',
    author: 'Dale Carnegie',
    isbn: '9786049228438',
    location: 'Kệ A-1',
    quantity: 45,
    status: 'in_stock',
  },
  {
    id: 'BK002',
    title: 'Nhà Giả Kim',
    author: 'Paulo Coelho',
    isbn: '9786041062146',
    location: 'Kệ A-2',
    quantity: 8,
    status: 'low_stock',
  },
  {
    id: 'BK003',
    title: 'Sapiens: Lược Sử Loài Người',
    author: 'Yuval Noah Harari',
    isbn: '9786041113015',
    location: 'Kệ B-1',
    quantity: 0,
    status: 'out_of_stock',
  },
  {
    id: 'BK004',
    title: 'Tư Duy Nhanh Và Chậm',
    author: 'Daniel Kahneman',
    isbn: '9786041177277',
    location: 'Kệ B-3',
    quantity: 22,
    status: 'in_stock',
  },
  {
    id: 'BK005',
    title: 'Atomic Habits',
    author: 'James Clear',
    isbn: '9780735211292',
    location: 'Kệ C-1',
    quantity: 5,
    status: 'low_stock',
  },
];

// =====================  HELPER: Badge trạng thái  =====================
const STATUS_CONFIG = {
  in_stock:    { label: 'Còn hàng',  className: 'bg-green-100 text-green-700' },
  low_stock:   { label: 'Sắp hết',   className: 'bg-orange-100 text-orange-600' },
  out_of_stock:{ label: 'Hết hàng',  className: 'bg-red-100 text-red-600' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.in_stock;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// =====================  MAIN PAGE  =====================
export default function InventoryPage() {
  const [books] = useState(mockBooks);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Kho sách</h1>
          <p className="text-sm text-gray-500 mt-0.5">Quản lý toàn bộ đầu sách trong hệ thống</p>
        </div>
        <button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-sm">
          <Plus size={16} />
          Thêm sách
        </button>
      </div>

      {/* Stats nhanh */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Tổng đầu sách', value: books.length, color: 'text-indigo-600' },
          { label: 'Sắp hết hàng',  value: books.filter(b => b.status === 'low_stock').length,    color: 'text-orange-500' },
          { label: 'Hết hàng',      value: books.filter(b => b.status === 'out_of_stock').length,  color: 'text-red-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Mã sách</th>
                <th className="px-4 py-3 font-semibold">Ảnh bìa</th>
                <th className="px-4 py-3 font-semibold">Tên sách</th>
                <th className="px-4 py-3 font-semibold">Tác giả</th>
                <th className="px-4 py-3 font-semibold">ISBN</th>
                <th className="px-4 py-3 font-semibold">Vị trí kho</th>
                <th className="px-4 py-3 font-semibold text-center">Số lượng</th>
                <th className="px-4 py-3 font-semibold">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {books.map((book) => (
                <tr key={book.id} className="hover:bg-slate-50 transition-colors">
                  {/* Mã sách */}
                  <td className="px-4 py-3.5 text-gray-500 font-mono text-xs">{book.id}</td>

                  {/* Ảnh bìa (placeholder icon) */}
                  <td className="px-4 py-3.5">
                    <div className="w-10 h-14 bg-indigo-50 rounded flex items-center justify-center border border-indigo-100">
                      <BookOpen size={18} className="text-indigo-400" />
                    </div>
                  </td>

                  {/* Tên sách */}
                  <td className="px-4 py-3.5 max-w-[180px] truncate">
                    <Link
                      to={`/inventory/${book.id}`}
                      className="font-semibold text-gray-800 hover:text-indigo-600 transition-colors"
                    >
                      {book.title}
                    </Link>
                  </td>

                  {/* Tác giả */}
                  <td className="px-4 py-3.5 text-gray-600">{book.author}</td>

                  {/* ISBN */}
                  <td className="px-4 py-3.5 text-gray-500 font-mono text-xs">{book.isbn}</td>

                  {/* Vị trí kho */}
                  <td className="px-4 py-3.5">
                    <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-1 rounded">
                      {book.location}
                    </span>
                  </td>

                  {/* Số lượng */}
                  <td className="px-4 py-3.5 text-center font-bold text-gray-700">{book.quantity}</td>

                  {/* Trạng thái */}
                  <td className="px-4 py-3.5">
                    <StatusBadge status={book.status} />
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
