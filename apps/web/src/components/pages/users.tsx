import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Lock, Plus, Unlock, X, Edit, Users } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { userService } from "@/services/user";
import { roleService } from "@/services/role";
import { getApiErrorMessage } from "@/services/api";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { StatusBadge } from "@/components/status-badge";

interface RoleItem {
  id: string;
  code: string;
  name: string;
}

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  email: string;
  phone?: string;
  status: "ACTIVE" | "INACTIVE" | "LOCKED" | "PENDING";
  created_at: string;
  roles: RoleItem[];
}

interface CreateUserForm {
  username: string;
  full_name: string;
  email: string;
  phone: string;
  password: string;
  status: "ACTIVE" | "INACTIVE" | "LOCKED" | "PENDING";
  role_ids: string[];
}

const EMPTY_FORM: CreateUserForm = {
  username: "",
  full_name: "",
  email: "",
  phone: "",
  password: "",
  status: "ACTIVE",
  role_ids: [],
};

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

function statusBadgeVariant(status: UserRow["status"]): "success" | "danger" | "warning" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "LOCKED") return "danger";
  if (status === "PENDING") return "warning";
  return "neutral";
}

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateUserForm>(EMPTY_FORM);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [usersResponse, rolesResponse] = await Promise.all([userService.getAll(), roleService.getAll()]);
      setUsers((usersResponse?.data || []) as UserRow[]);
      setRoles((rolesResponse?.data || []) as RoleItem[]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách người dùng"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return users;

    return users.filter((user) => {
      return (
        user.username.toLowerCase().includes(keyword)
        || user.full_name.toLowerCase().includes(keyword)
        || String(user.email || "").toLowerCase().includes(keyword)
      );
    });
  }, [search, users]);

  const closeUserModal = () => {
    setShowCreateModal(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
  };

  const validateUserForm = (isEdit: boolean) => {
    const email = form.email.trim().toLowerCase();

    if (!isEdit && !form.username.trim()) {
      toast.error("Tên đăng nhập là bắt buộc");
      return false;
    }

    if (!form.full_name.trim()) {
      toast.error("Họ tên là bắt buộc");
      return false;
    }

    if (!email) {
      toast.error("Email là bắt buộc");
      return false;
    }

    if (!email.includes("@") || !email.split("@")[1]?.includes(".")) {
      toast.error("Email không hợp lệ");
      return false;
    }

    if (!isEdit && !form.password.trim()) {
      toast.error("Mật khẩu là bắt buộc");
      return false;
    }

    if (!isEdit && form.password.length < 6) {
      toast.error("Mật khẩu phải có ít nhất 6 ký tự");
      return false;
    }

    if (form.role_ids.length === 0) {
      toast.error("Chọn ít nhất một vai trò cho người dùng");
      return false;
    }

    return true;
  };

  const handleToggleRole = (roleId: string) => {
    setForm((prev) => {
      const exists = prev.role_ids.includes(roleId);
      return {
        ...prev,
        role_ids: exists ? prev.role_ids.filter((id) => id !== roleId) : [...prev.role_ids, roleId],
      };
    });
  };

  const handleCreateUser = async () => {
    if (!validateUserForm(false)) {
      return;
    }

    try {
      setCreating(true);
      await userService.create({
        username: form.username.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        password: form.password,
        status: form.status,
        role_ids: form.role_ids,
      });

      toast.success("Đã tạo người dùng mới");
      closeUserModal();
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tạo người dùng thất bại"));
    } finally {
      setCreating(false);
    }
  };

  const openEditUser = (user: UserRow) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      full_name: user.full_name,
      email: user.email || "",
      phone: user.phone || "",
      password: "",
      status: user.status,
      role_ids: (user.roles || []).map((r) => r.id),
    });
    setShowCreateModal(true);
  };

  const handleEditUser = async () => {
    if (!editingUser) return;
    if (!validateUserForm(true)) return;

    try {
      setCreating(true);
      await userService.update(editingUser.id, {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        status: form.status,
        role_ids: form.role_ids,
      });
      toast.success("Đã cập nhật người dùng");
      closeUserModal();
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cập nhật người dùng thất bại"));
    } finally { setCreating(false); }
  };

  const handleToggleLock = async (user: UserRow) => {
    const nextStatus = user.status === "LOCKED" ? "ACTIVE" : "LOCKED";
    try {
      await userService.update(user.id, { status: nextStatus });
      toast.success(nextStatus === "LOCKED" ? "Đã khóa người dùng" : "Đã mở khóa người dùng");
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cập nhật trạng thái thất bại"));
    }
  };

  const handleDeleteUser = async (user: UserRow) => {
    const accepted = window.confirm(`Xóa người dùng ${user.username}?`);
    if (!accepted) return;

    try {
      setDeletingUserId(user.id);
      await userService.delete(user.id);
      toast.success("Đã xóa người dùng");
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xóa người dùng thất bại"));
    } finally {
      setDeletingUserId(null);
    }
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Users}
          title="Người dùng"
          description="Quản lý tài khoản người dùng trong hệ thống"
          iconBg="bg-gradient-to-br from-slate-500 to-indigo-600 shadow-lg shadow-slate-500/25"
          iconColor="text-white"
          actions={
            <Button onClick={() => { setEditingUser(null); setForm(EMPTY_FORM); setShowCreateModal(true); }}>
              <Plus className="h-3.5 w-3.5" /> Tạo người dùng mới
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Tìm theo tên đăng nhập, họ tên, email..."
          showSearchClear
        />
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  "Tên đăng nhập",
                  "Họ tên",
                  "Email",
                  "Vai trò",
                  "Trạng thái",
                  "Ngày tạo",
                  "Hành động",
                ].map((header) => (
                  <th key={header} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={7} rows={5} />
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7}><EmptyState variant="no-data" title="Không có người dùng nào" description="Tạo người dùng mới để bắt đầu" className="py-12" /></td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <motion.tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <td className="px-5 py-3.5 text-[13px] font-semibold">{user.username}</td>
                    <td className="px-5 py-3.5 text-[13px]">{user.full_name}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{user.email || "-"}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {(user.roles || []).map((role) => (
                          <span key={role.id} className="rounded-full bg-blue-100 dark:bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                            {role.code}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge label={user.status} variant={statusBadgeVariant(user.status)} />
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(user.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditUser(user)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[12px] text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20"
                        >
                          <Edit className="h-3.5 w-3.5" />
                          Sửa
                        </button>
                        <button
                          onClick={() => void handleToggleLock(user)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-[12px] hover:bg-muted"
                        >
                          {user.status === "LOCKED" ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                          {user.status === "LOCKED" ? "Mở khóa" : "Khóa"}
                        </button>
                        <button
                          onClick={() => void handleDeleteUser(user)}
                          disabled={deletingUserId === user.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[12px] text-red-700 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 disabled:opacity-60"
                        >
                          <X className="h-3.5 w-3.5" />
                          {deletingUserId === user.id ? "Đang xóa..." : "Xóa"}
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </SectionCard>
      </FadeItem>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-lg rounded-xl bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold">{editingUser ? "Sửa người dùng" : "Tạo người dùng mới"}</h3>
              <button onClick={closeUserModal} aria-label="Đóng" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {!editingUser && <input value={form.username} onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))} placeholder="Tên đăng nhập *" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />}
                <input value={form.full_name} onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))} placeholder="Họ tên *" className={`rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 ${editingUser ? 'col-span-2' : ''}`} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="Email *" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
                <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="Số điện thoại" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {!editingUser && <input type="password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Mật khẩu *" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />}
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as CreateUserForm["status"] }))} className={`rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 ${editingUser ? 'col-span-2' : ''}`}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PENDING">PENDING</option>
                  <option value="LOCKED">LOCKED</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              <div>
                <p className="mb-2 text-[12px] font-semibold text-muted-foreground">Gán vai trò *</p>
                <div className="grid grid-cols-2 gap-2">
                  {loading ? (
                    <div className="col-span-2 rounded-lg border border-dashed border-input px-3 py-3 text-[12px] text-muted-foreground">
                      Đang tải vai trò...
                    </div>
                  ) : roles.length === 0 ? (
                    <div className="col-span-2 rounded-lg border border-dashed border-input px-3 py-3 text-[12px] text-muted-foreground">
                      Chưa có vai trò nào
                    </div>
                  ) : (
                    roles.map((role) => (
                      <label key={role.id} className="flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-[12px]">
                        <input type="checkbox" checked={form.role_ids.includes(role.id)} onChange={() => handleToggleRole(role.id)} />
                        {role.name} ({role.code})
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Button variant="outline" className="flex-1" onClick={closeUserModal}>
                Hủy
              </Button>
              <Button className="flex-1" onClick={() => void (editingUser ? handleEditUser() : handleCreateUser())} disabled={creating}>
                {creating ? "Đang xử lý..." : editingUser ? "Cập nhật" : "Tạo người dùng"}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </PageWrapper>
  );
}
