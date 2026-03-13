// src/pages/RoleManagementPage.jsx
// Trang Ma trận Phân quyền (Permission Matrix) — checkbox tương tác

import { useState } from 'react';
import { Plus, Check, Info } from 'lucide-react';

// =====================  MOCK DATA  =====================

const ROLES = [
  { id: 'manager',         label: 'Quản lý',         color: 'text-purple-700 bg-purple-50' },
  { id: 'inventory_staff', label: 'Thủ kho',          color: 'text-teal-700 bg-teal-50' },
  { id: 'sales',           label: 'Nhân viên bán',    color: 'text-orange-700 bg-orange-50' },
];

const PERMISSION_GROUPS = [
  {
    group: 'Kho hàng',
    permissions: [
      { id: 'view_inventory',   label: 'Xem tồn kho',            desc: 'Tra cứu số lượng và vị trí sách' },
      { id: 'create_import',    label: 'Tạo phiếu nhập kho',     desc: 'Nhập sách mới vào hệ thống' },
      { id: 'create_export',    label: 'Tạo phiếu xuất kho',     desc: 'Xuất sách ra khỏi kho' },
      { id: 'edit_book',        label: 'Chỉnh sửa thông tin sách', desc: 'Cập nhật tên, ISBN, vị trí kệ' },
    ],
  },
  {
    group: 'Tính năng AI',
    permissions: [
      { id: 'use_ai_import',    label: 'Nhập kho bằng AI',       desc: 'Dùng camera/ảnh để nhận diện sách' },
      { id: 'view_ai_suggest',  label: 'Xem gợi ý AI',           desc: 'Đọc báo cáo và đề xuất nhập hàng' },
      { id: 'use_chatbot',      label: 'Sử dụng Chatbot AI',     desc: 'Tra cứu qua trợ lý ảo' },
    ],
  },
  {
    group: 'Báo cáo & Lịch sử',
    permissions: [
      { id: 'view_movements',   label: 'Xem lịch sử giao dịch',  desc: 'Tra cứu log nhập/xuất/chuyển vị trí' },
      { id: 'export_report',    label: 'Xuất báo cáo',           desc: 'Tải file Excel/PDF báo cáo kho' },
    ],
  },
  {
    group: 'Hệ thống',
    permissions: [
      { id: 'manage_users',     label: 'Quản lý nhân viên',      desc: 'Thêm, khóa, sửa tài khoản' },
      { id: 'manage_roles',     label: 'Thiết lập phân quyền',   desc: 'Chỉnh sửa ma trận quyền hạn' },
    ],
  },
];

// Mock permission matrix — roleId -> Set of permissionIds
const INITIAL_MATRIX = {
  manager: new Set([
    'view_inventory', 'create_import', 'create_export', 'edit_book',
    'use_ai_import', 'view_ai_suggest', 'use_chatbot',
    'view_movements', 'export_report',
    'manage_users', 'manage_roles',
  ]),
  inventory_staff: new Set([
    'view_inventory', 'create_import', 'create_export',
    'use_ai_import', 'use_chatbot',
    'view_movements',
  ]),
  sales: new Set([
    'view_inventory',
    'use_chatbot',
  ]),
};

// =====================  MAIN PAGE  =====================
export default function RoleManagementPage() {
  const [matrix, setMatrix] = useState(INITIAL_MATRIX);
  const [tooltip, setTooltip] = useState(null); // permissionId đang hover

  const toggle = (roleId, permId) => {
    setMatrix((prev) => {
      const next = { ...prev };
      const set  = new Set(next[roleId]);
      set.has(permId) ? set.delete(permId) : set.add(permId);
      next[roleId] = set;
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Thiết lập Vai trò &amp; Quyền hạn</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Tick vào ô để cấp hoặc thu hồi quyền cho từng vai trò.
          </p>
        </div>
        <button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-sm">
          <Plus size={16} />
          Tạo vai trò mới
        </button>
      </div>

      {/* Permission Matrix */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-200">
                {/* Corner cell */}
                <th className="px-5 py-4 text-left text-xs text-gray-400 uppercase tracking-wide font-semibold w-72">
                  Nhóm quyền / Chức năng
                </th>
                {ROLES.map((role) => (
                  <th key={role.id} className="px-4 py-4 text-center min-w-[140px]">
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${role.color}`}>
                      {role.label}
                    </span>
                    <p className="text-[11px] text-gray-400 mt-1 font-normal">
                      {[...matrix[role.id]].length} quyền
                    </p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((group, gi) => (
                <>
                  {/* Group header row */}
                  <tr key={`group-${gi}`} className="bg-slate-50/70">
                    <td
                      colSpan={ROLES.length + 1}
                      className="px-5 py-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100"
                    >
                      {group.group}
                    </td>
                  </tr>

                  {/* Permission rows */}
                  {group.permissions.map((perm, pi) => (
                    <tr
                      key={perm.id}
                      className={`border-t border-gray-100 hover:bg-indigo-50/30 transition-colors ${
                        pi === group.permissions.length - 1 ? 'border-b border-gray-200' : ''
                      }`}
                    >
                      {/* Permission label */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-700 font-medium">{perm.label}</span>
                          <button
                            onMouseEnter={() => setTooltip(perm.id)}
                            onMouseLeave={() => setTooltip(null)}
                            className="relative text-gray-300 hover:text-gray-500 transition-colors"
                          >
                            <Info size={13} />
                            {tooltip === perm.id && (
                              <div className="absolute left-5 top-0 z-10 w-52 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl leading-relaxed pointer-events-none">
                                {perm.desc}
                              </div>
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Checkboxes */}
                      {ROLES.map((role) => {
                        const checked = matrix[role.id]?.has(perm.id);
                        return (
                          <td key={role.id} className="px-4 py-3.5 text-center">
                            <button
                              onClick={() => toggle(role.id, perm.id)}
                              className={`w-6 h-6 rounded-md border-2 flex items-center justify-center mx-auto transition-all ${
                                checked
                                  ? 'bg-indigo-600 border-indigo-600 shadow-sm'
                                  : 'border-gray-300 hover:border-indigo-400 bg-white'
                              }`}
                              aria-label={`${checked ? 'Thu hồi' : 'Cấp'} quyền ${perm.label} cho ${role.label}`}
                            >
                              {checked && <Check size={13} className="text-white" strokeWidth={3} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        <div className="px-5 py-3 border-t border-gray-100 bg-slate-50 flex items-center gap-2">
          <Info size={13} className="text-gray-400 flex-shrink-0" />
          <p className="text-xs text-gray-400">
            Thay đổi được lưu tạm thời trong phiên làm việc. Tích hợp API sẽ lưu vĩnh viễn vào backend.
          </p>
        </div>
      </div>
    </div>
  );
}
