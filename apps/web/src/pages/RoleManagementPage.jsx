import { Fragment, useEffect, useMemo, useState } from 'react';
import { Plus, Check, Info, X } from 'lucide-react';
import { createRole, getPermissions, getRoles, updateRolePermissions } from '../services/api';

const MODULE_LABELS = {
  auth: 'Xác thực & người dùng',
  inventory: 'Kho hàng',
  borrow: 'Mượn trả',
  ai: 'AI',
  analytics: 'Phân tích',
  chatbot: 'Chatbot',
  platform: 'Nền tảng',
};

const PERMISSION_VI = {
  'auth.users.read': {
    label: 'Xem danh sách người dùng',
    desc: 'Cho phép xem tài khoản và thông tin người dùng.',
  },
  'auth.users.write': {
    label: 'Tạo và cập nhật người dùng',
    desc: 'Cho phép thêm mới, chỉnh sửa, khóa hoặc mở khóa tài khoản.',
  },
  'auth.roles.read': {
    label: 'Xem vai trò và quyền',
    desc: 'Cho phép xem ma trận phân quyền của hệ thống.',
  },
  'auth.roles.write': {
    label: 'Quản lý vai trò và quyền',
    desc: 'Cho phép tạo vai trò và thay đổi quyền cho vai trò.',
  },
  'inventory.catalog.read': {
    label: 'Xem danh mục sách',
    desc: 'Cho phép xem thông tin đầu sách, biến thể và thuộc tính.',
  },
  'inventory.catalog.write': {
    label: 'Quản lý danh mục sách',
    desc: 'Cho phép tạo mới và cập nhật dữ liệu danh mục sách.',
  },
  'inventory.stock.read': {
    label: 'Xem tồn kho',
    desc: 'Cho phép xem số lượng tồn và lịch sử biến động kho.',
  },
  'inventory.stock.write': {
    label: 'Cập nhật tồn kho',
    desc: 'Cho phép ghi nhận nhập, xuất, điều chỉnh và di chuyển tồn kho.',
  },
  'inventory.purchase.approve': {
    label: 'Duyệt chứng từ nhập/chuyển kho',
    desc: 'Cho phép phê duyệt các chứng từ mua hàng hoặc điều chuyển.',
  },
  'borrow.read': {
    label: 'Xem dữ liệu mượn trả',
    desc: 'Cho phép xem khách hàng, phiếu đặt và giao dịch mượn trả.',
  },
  'borrow.write': {
    label: 'Tạo và xử lý mượn trả',
    desc: 'Cho phép tạo đặt chỗ, cho mượn và ghi nhận trả sách.',
  },
  'borrow.fines.manage': {
    label: 'Quản lý tiền phạt',
    desc: 'Cho phép phát hành, thu và miễn giảm tiền phạt.',
  },
  'ai.read': {
    label: 'Xem kết quả AI',
    desc: 'Cho phép xem job nhận diện và kết quả AI.',
  },
  'ai.write': {
    label: 'Vận hành chức năng AI',
    desc: 'Cho phép tạo job AI và xác minh kết quả nhận diện.',
  },
  'analytics.read': {
    label: 'Xem phân tích và dự báo',
    desc: 'Cho phép xem KPI, dự báo nhu cầu và đề xuất.',
  },
  'chatbot.use': {
    label: 'Sử dụng chatbot',
    desc: 'Cho phép truy vấn dữ liệu qua chatbot và lưu báo cáo.',
  },
  'observability.read': {
    label: 'Xem nhật ký hệ thống',
    desc: 'Cho phép xem audit log và thông tin giám sát hệ thống.',
  },
};

const ACTION_LABELS = {
  read: 'Xem',
  write: 'Cập nhật',
  approve: 'Phê duyệt',
  execute: 'Thực thi',
};

function formatPermissionLabel(permission) {
  if (!permission?.code) return 'Quyền hệ thống';

  if (PERMISSION_VI[permission.code]?.label) {
    return PERMISSION_VI[permission.code].label;
  }

  const moduleName = MODULE_LABELS[permission.module_name] || permission.module_name || 'Hệ thống';
  const actionName = ACTION_LABELS[permission.action_name] || permission.action_name || 'Thao tác';
  return `${actionName} - ${moduleName}`;
}

function formatPermissionDescription(permission) {
  if (!permission?.code) return 'Quyền hệ thống';

  if (PERMISSION_VI[permission.code]?.desc) {
    return PERMISSION_VI[permission.code].desc;
  }

  return permission.description || `${permission.module_name}.${permission.action_name}`;
}

function RoleModal({ onClose, onSubmit, submitting }) {
  const [form, setForm] = useState({ code: '', name: '', description: '' });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">Tạo vai trò mới</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Code</label>
            <input
              value={form.code}
              onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
              placeholder="VD: AUDITOR"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Tên vai trò</label>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="VD: Nhân viên kiểm kê"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Mô tả</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            Hủy
          </button>
          <button
            disabled={submitting}
            onClick={() => onSubmit(form)}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {submitting ? 'Đang tạo...' : 'Tạo vai trò'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoleManagementPage() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingRoleId, setSavingRoleId] = useState('');
  const [error, setError] = useState('');
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError('');
      const [roleRes, permissionRes] = await Promise.all([getRoles(), getPermissions()]);
      setRoles(roleRes?.data || []);
      setPermissions(permissionRes?.data || []);
    } catch (e) {
      setError(e.message || 'Không tải được dữ liệu phân quyền');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const permissionGroups = useMemo(() => {
    const grouped = new Map();

    for (const permission of permissions) {
      const moduleName = permission.module_name || 'other';
      if (!grouped.has(moduleName)) grouped.set(moduleName, []);
      grouped.get(moduleName).push(permission);
    }

    return [...grouped.entries()].map(([moduleName, items]) => ({
      group: MODULE_LABELS[moduleName] || moduleName.toUpperCase(),
      permissions: items,
    }));
  }, [permissions]);

  const rolePermissionMap = useMemo(() => {
    const map = {};
    for (const role of roles) {
      map[role.id] = new Set((role.permissions || []).map((p) => p.id));
    }
    return map;
  }, [roles]);

  const toggle = async (roleId, permissionId) => {
    const current = rolePermissionMap[roleId] || new Set();
    const next = new Set(current);

    if (next.has(permissionId)) {
      next.delete(permissionId);
    } else {
      next.add(permissionId);
    }

    try {
      setSavingRoleId(roleId);
      await updateRolePermissions(roleId, [...next]);
      await fetchAll();
    } catch (e) {
      window.alert(e.message || 'Cập nhật quyền thất bại');
    } finally {
      setSavingRoleId('');
    }
  };

  const handleCreateRole = async (payload) => {
    try {
      setCreating(true);
      await createRole(payload);
      setShowCreateRole(false);
      await fetchAll();
    } catch (e) {
      window.alert(e.message || 'Tạo vai trò thất bại');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Thiết lập Vai trò &amp; Quyền hạn</h1>
          <p className="text-sm text-gray-500 mt-0.5">Tick vào ô để cấp hoặc thu hồi quyền cho từng vai trò.</p>
        </div>
        <button
          onClick={() => setShowCreateRole(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-sm"
        >
          <Plus size={16} />
          Tạo vai trò mới
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

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
                {roles.map((role) => (
                  <th key={role.id} className="px-4 py-4 text-center min-w-[140px]">
                    <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold text-indigo-700 bg-indigo-50">
                      {role.name}
                    </span>
                    <p className="text-[11px] text-gray-400 mt-1 font-normal">
                      {((role.permissions || []).length)} quyền
                    </p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={roles.length + 1} className="px-5 py-10 text-center text-gray-400 text-sm">
                    Đang tải dữ liệu phân quyền...
                  </td>
                </tr>
              ) : permissionGroups.map((group, gi) => (
                <Fragment key={`group-${gi}-${group.group}`}>
                  {/* Group header row */}
                  <tr className="bg-slate-50/70">
                    <td
                      colSpan={roles.length + 1}
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
                          <div>
                            <p className="text-gray-700 font-medium">{formatPermissionLabel(perm)}</p>
                            <p className="text-xs text-gray-400">{perm.code}</p>
                          </div>
                          <button
                            onMouseEnter={() => setTooltip(perm.id)}
                            onMouseLeave={() => setTooltip(null)}
                            className="relative text-gray-300 hover:text-gray-500 transition-colors"
                          >
                            <Info size={13} />
                            {tooltip === perm.id && (
                              <div className="absolute left-5 top-0 z-10 w-52 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl leading-relaxed pointer-events-none">
                                {formatPermissionDescription(perm)}
                              </div>
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Checkboxes */}
                      {roles.map((role) => {
                        const checked = rolePermissionMap[role.id]?.has(perm.id);
                        return (
                          <td key={role.id} className="px-4 py-3.5 text-center">
                            <button
                              disabled={Boolean(savingRoleId)}
                              onClick={() => toggle(role.id, perm.id)}
                              className={`w-6 h-6 rounded-md border-2 flex items-center justify-center mx-auto transition-all ${
                                checked
                                  ? 'bg-indigo-600 border-indigo-600 shadow-sm'
                                  : 'border-gray-300 hover:border-indigo-400 bg-white'
                              }`}
                              aria-label={`${checked ? 'Thu hồi' : 'Cấp'} quyền ${perm.code} cho ${role.name}`}
                            >
                              {checked && <Check size={13} className="text-white" strokeWidth={3} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        <div className="px-5 py-3 border-t border-gray-100 bg-slate-50 flex items-center gap-2">
          <Info size={13} className="text-gray-400 flex-shrink-0" />
          <p className="text-xs text-gray-400">
            Thay đổi quyền được lưu trực tiếp vào cơ sở dữ liệu auth_db.
          </p>
        </div>
      </div>

      {showCreateRole && (
        <RoleModal onClose={() => setShowCreateRole(false)} onSubmit={handleCreateRole} submitting={creating} />
      )}
    </div>
  );
}
