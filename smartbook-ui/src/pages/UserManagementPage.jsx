// src/pages/UserManagementPage.jsx
// Trang Quản lý Nhân viên — tìm kiếm, bảng danh sách, badge vai trò & trạng thái

import { useState } from 'react';
import { Plus, Search, Pencil, Lock, Unlock } from 'lucide-react';

// =====================  MOCK DATA  =====================
const MOCK_USERS = [
  {
    id: 'U001',
    name: 'Nguyễn Văn An',
    email: 'an.nguyen@smartbook.ai',
    role: 'director',
    avatar: 'A',
    avatarBg: 'bg-purple-500',
    status: 'active',
    joinDate: '01/06/2024',
  },
  {
    id: 'U002',
    name: 'Trần Thị Bích',
    email: 'bich.tran@smartbook.ai',
    role: 'warehouse_manager',
    avatar: 'B',
    avatarBg: 'bg-blue-500',
    status: 'active',
    joinDate: '15/08/2024',
  },
  {
    id: 'U003',
    name: 'Lê Minh Cường',
    email: 'cuong.le@smartbook.ai',
    role: 'inventory_staff',
    avatar: 'C',
    avatarBg: 'bg-teal-500',
    status: 'active',
    joinDate: '03/11/2024',
  },
  {
    id: 'U004',
    name: 'Phạm Thị Dung',
    email: 'dung.pham@smartbook.ai',
    role: 'inventory_staff',
    avatar: 'D',
    avatarBg: 'bg-orange-400',
    status: 'locked',
    joinDate: '20/01/2025',
  },
];

// =====================  CONFIG  =====================
const ROLE_CONFIG = {
  director:          { label: 'Giám đốc',      className: 'bg-purple-100 text-purple-700' },
  warehouse_manager: { label: 'Quản lý kho',   className: 'bg-blue-100 text-blue-700' },
  inventory_staff:   { label: 'Thủ kho',       className: 'bg-teal-100 text-teal-700' },
  sales:             { label: 'Nhân viên bán',  className: 'bg-orange-100 text-orange-700' },
};

const STATUS_CONFIG = {
  active: { label: 'Hoạt động', className: 'bg-green-100 text-green-700' },
  locked: { label: 'Đã khóa',   className: 'bg-red-100 text-red-600' },
};

// =====================  MAIN PAGE  =====================
export default function UserManagementPage() {
  const [users, setUsers]   = useState(MOCK_USERS);
  const [search, setSearch] = useState('');

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const toggleLock = (id) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id
          ? { ...u, status: u.status === 'active' ? 'locked' : 'active' }
          : u
      )
    );
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Quản lý nhân viên</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {users.length} tài khoản — {users.filter((u) => u.status === 'active').length} đang hoạt động
          </p>
        </div>
        <button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-sm">
          <Plus size={16} />
          Thêm nhân viên
        </button>
      </div>

      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Tìm theo tên hoặc email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left border-b border-gray-200">
                <th className="px-5 py-3 font-semibold">Tên nhân viên</th>
                <th className="px-5 py-3 font-semibold">Email</th>
                <th className="px-5 py-3 font-semibold">Vai trò</th>
                <th className="px-5 py-3 font-semibold">Ngày tham gia</th>
                <th className="px-5 py-3 font-semibold">Trạng thái</th>
                <th className="px-5 py-3 font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                    Không tìm thấy nhân viên nào.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => {
                  const role   = ROLE_CONFIG[user.role]   ?? { label: user.role,   className: 'bg-gray-100 text-gray-600' };
                  const status = STATUS_CONFIG[user.status] ?? STATUS_CONFIG.active;
                  return (
                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                      {/* Tên & Avatar */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold ${user.avatarBg}`}>
                            {user.avatar}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800">{user.name}</p>
                            <p className="text-xs text-gray-400 font-mono">{user.id}</p>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-5 py-3.5 text-gray-500 text-sm">{user.email}</td>

                      {/* Vai trò */}
                      <td className="px-5 py-3.5">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${role.className}`}>
                          {role.label}
                        </span>
                      </td>

                      {/* Ngày tham gia */}
                      <td className="px-5 py-3.5 text-gray-500 text-sm">{user.joinDate}</td>

                      {/* Trạng thái */}
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${status.className}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${user.status === 'active' ? 'bg-green-500' : 'bg-red-400'}`} />
                          {status.label}
                        </span>
                      </td>

                      {/* Hành động */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            title="Chỉnh sửa"
                            className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            title={user.status === 'active' ? 'Khóa tài khoản' : 'Mở khóa'}
                            onClick={() => toggleLock(user.id)}
                            className={`p-1.5 rounded-md transition-colors ${
                              user.status === 'active'
                                ? 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                                : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {user.status === 'active' ? <Lock size={15} /> : <Unlock size={15} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
