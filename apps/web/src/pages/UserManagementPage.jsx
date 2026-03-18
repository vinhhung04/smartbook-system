import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Lock, Unlock, X } from 'lucide-react';
import { createUser, getRoles, getUsers, updateUser } from '../services/api';

const STATUS_CONFIG = {
  ACTIVE: { label: 'Hoạt động', className: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  LOCKED: { label: 'Đã khóa', className: 'bg-red-100 text-red-600', dot: 'bg-red-400' },
  INACTIVE: { label: 'Ngừng hoạt động', className: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  PENDING: { label: 'Chờ kích hoạt', className: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
};

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('vi-VN');
}

function roleBadgeClass(code = '') {
  if (code === 'ADMIN') return 'bg-purple-100 text-purple-700';
  if (code === 'MANAGER') return 'bg-blue-100 text-blue-700';
  if (code === 'STAFF') return 'bg-teal-100 text-teal-700';
  return 'bg-slate-100 text-slate-700';
}

function UserModal({ title, initialValues, roles, onClose, onSubmit, submitting }) {
  const [form, setForm] = useState({
    username: initialValues.username || '',
    full_name: initialValues.full_name || '',
    email: initialValues.email || '',
    phone: initialValues.phone || '',
    password: '',
    status: initialValues.status || 'ACTIVE',
    role_ids: initialValues.role_ids || [],
  });

  const toggleRole = (roleId) => {
    setForm((prev) => {
      const exists = prev.role_ids.includes(roleId);
      return {
        ...prev,
        role_ids: exists ? prev.role_ids.filter((id) => id !== roleId) : [...prev.role_ids, roleId],
      };
    });
  };

  const isCreate = !initialValues.id;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Username</label>
            <input
              value={form.username}
              disabled={!isCreate}
              onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Họ tên</label>
            <input
              value={form.full_name}
              onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
            <input
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Số điện thoại</label>
            <input
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          {isCreate && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Mật khẩu</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Trạng thái</label>
            <select
              value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="LOCKED">LOCKED</option>
              <option value="INACTIVE">INACTIVE</option>
              <option value="PENDING">PENDING</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <p className="block text-xs font-semibold text-gray-500 mb-2">Vai trò</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2">
                  <input
                    type="checkbox"
                    checked={form.role_ids.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                  />
                  {role.name} ({role.code})
                </label>
              ))}
            </div>
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
            {submitting ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError('');
      const [usersRes, rolesRes] = await Promise.all([getUsers(), getRoles()]);
      setUsers(usersRes?.data || []);
      setRoles(rolesRes?.data || []);
    } catch (e) {
      setError(e.message || 'Không tải được dữ liệu người dùng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter((u) => {
      const fullName = String(u.full_name || '').toLowerCase();
      const email = String(u.email || '').toLowerCase();
      const username = String(u.username || '').toLowerCase();
      return fullName.includes(q) || email.includes(q) || username.includes(q);
    });
  }, [users, search]);

  const activeCount = users.filter((u) => u.status === 'ACTIVE').length;

  const handleToggleLock = async (user) => {
    try {
      const nextStatus = user.status === 'LOCKED' ? 'ACTIVE' : 'LOCKED';
      await updateUser(user.id, { status: nextStatus });
      await fetchAll();
    } catch (e) {
      window.alert(e.message || 'Cập nhật trạng thái thất bại');
    }
  };

  const handleCreate = async (payload) => {
    try {
      setSaving(true);
      await createUser(payload);
      setCreateOpen(false);
      await fetchAll();
    } catch (e) {
      window.alert(e.message || 'Tạo người dùng thất bại');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (payload) => {
    try {
      setSaving(true);
      await updateUser(editingUser.id, payload);
      setEditingUser(null);
      await fetchAll();
    } catch (e) {
      window.alert(e.message || 'Cập nhật người dùng thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Quản lý người dùng</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {users.length} tài khoản — {activeCount} đang hoạt động
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-sm"
        >
          <Plus size={16} />
          Thêm người dùng
        </button>
      </div>

      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Tìm theo họ tên, username hoặc email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left border-b border-gray-200">
                <th className="px-5 py-3 font-semibold">Người dùng</th>
                <th className="px-5 py-3 font-semibold">Email</th>
                <th className="px-5 py-3 font-semibold">Vai trò</th>
                <th className="px-5 py-3 font-semibold">Ngày tham gia</th>
                <th className="px-5 py-3 font-semibold">Trạng thái</th>
                <th className="px-5 py-3 font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                    Đang tải dữ liệu...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                    Không tìm thấy người dùng nào.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => {
                  const status = STATUS_CONFIG[user.status] || STATUS_CONFIG.ACTIVE;
                  const name = user.full_name || user.username;
                  const avatar = (name || 'U').trim().charAt(0).toUpperCase();
                  const rolesText = Array.isArray(user.roles) ? user.roles : [];
                  return (
                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold bg-indigo-600">
                            {avatar}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800">{name}</p>
                            <p className="text-xs text-gray-400 font-mono">{user.username}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-3.5 text-gray-500 text-sm">{user.email || '-'}</td>

                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          {rolesText.length === 0 ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                              Chưa gán
                            </span>
                          ) : (
                            rolesText.map((role) => (
                              <span key={role.id} className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${roleBadgeClass(role.code)}`}>
                                {role.code}
                              </span>
                            ))
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-3.5 text-gray-500 text-sm">{formatDate(user.created_at)}</td>

                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${status.className}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                          {status.label}
                        </span>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            title="Chỉnh sửa"
                            onClick={() => {
                              setEditingUser({
                                id: user.id,
                                username: user.username,
                                full_name: user.full_name,
                                email: user.email || '',
                                phone: user.phone || '',
                                status: user.status,
                                role_ids: (user.roles || []).map((r) => r.id),
                              });
                            }}
                            className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            title={user.status === 'LOCKED' ? 'Mở khóa' : 'Khóa tài khoản'}
                            onClick={() => handleToggleLock(user)}
                            className={`p-1.5 rounded-md transition-colors ${
                              user.status !== 'LOCKED'
                                ? 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                                : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {user.status === 'LOCKED' ? <Unlock size={15} /> : <Lock size={15} />}
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

      {createOpen && (
        <UserModal
          title="Thêm người dùng"
          initialValues={{ status: 'ACTIVE', role_ids: [] }}
          roles={roles}
          submitting={saving}
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreate}
        />
      )}

      {editingUser && (
        <UserModal
          title="Cập nhật người dùng"
          initialValues={editingUser}
          roles={roles}
          submitting={saving}
          onClose={() => setEditingUser(null)}
          onSubmit={handleUpdate}
        />
      )}
    </div>
  );
}
