import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Lock, Plus, Unlock, X } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { userService } from "@/services/user";
import { roleService } from "@/services/role";
import { getApiErrorMessage } from "@/services/api";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";

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

function statusBadge(status: UserRow["status"]) {
  if (status === "ACTIVE") return "bg-emerald-100 text-emerald-700";
  if (status === "LOCKED") return "bg-red-100 text-red-700";
  if (status === "PENDING") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
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

  const loadData = async () => {
    try {
      setLoading(true);
      const [usersResponse, rolesResponse] = await Promise.all([userService.getAll(), roleService.getAll()]);
      setUsers((usersResponse?.data || []) as UserRow[]);
      setRoles((rolesResponse?.data || []) as RoleItem[]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach user"));
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
    if (!form.username.trim() || !form.full_name.trim() || !form.password.trim()) {
      toast.error("Username, ho ten va mat khau la bat buoc");
      return;
    }

    try {
      setCreating(true);
      await userService.create({
        username: form.username.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim() || "",
        phone: form.phone.trim() || "",
        password: form.password,
        status: form.status,
        role_ids: form.role_ids,
      });

      toast.success("Da tao user moi");
      setForm(EMPTY_FORM);
      setShowCreateModal(false);
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tao user that bai"));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleLock = async (user: UserRow) => {
    const nextStatus = user.status === "LOCKED" ? "ACTIVE" : "LOCKED";
    try {
      await userService.update(user.id, { status: nextStatus });
      toast.success(nextStatus === "LOCKED" ? "Da khoa user" : "Da mo khoa user");
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cap nhat trang thai that bai"));
    }
  };

  const handleDeleteUser = async (user: UserRow) => {
    const accepted = window.confirm(`Xoa user ${user.username}?`);
    if (!accepted) return;

    try {
      setDeletingUserId(user.id);
      await userService.delete(user.id);
      toast.success("Da xoa user");
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xoa user that bai"));
    } finally {
      setDeletingUserId(null);
    }
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Users</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Quan ly tai khoan nguoi dung trong he thong</p>
          </div>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-3.5 w-3.5" /> Tao user moi
          </Button>
        </div>
      </FadeItem>

      <FadeItem>
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Tim theo username, ho ten, email..."
          showSearchClear
        />
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  "Username",
                  "Ho ten",
                  "Email",
                  "Vai tro",
                  "Trang thai",
                  "Ngay tao",
                  "Hanh dong",
                ].map((header) => (
                  <th key={header} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-[13px] text-muted-foreground">Dang tai du lieu...</td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7}><EmptyState variant="no-data" title="Khong co user nao" description="Tao user moi de bat dau" className="py-12" /></td>
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
                          <span key={role.id} className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
                            {role.code}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusBadge(user.status)}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(user.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void handleToggleLock(user)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-[12px] hover:bg-muted"
                        >
                          {user.status === "LOCKED" ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                          {user.status === "LOCKED" ? "Mo khoa" : "Khoa"}
                        </button>
                        <button
                          onClick={() => void handleDeleteUser(user)}
                          disabled={deletingUserId === user.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[12px] text-red-700 hover:bg-red-100 disabled:opacity-60"
                        >
                          <X className="h-3.5 w-3.5" />
                          {deletingUserId === user.id ? "Dang xoa..." : "Xoa"}
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </SectionCard>
      </FadeItem>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-lg rounded-xl bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold">Tao user moi</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <input value={form.username} onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))} placeholder="Username *" className="rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
                <input value={form.full_name} onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))} placeholder="Ho ten *" className="rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="Email" className="rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
                <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="So dien thoai" className="rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input type="password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Mat khau *" className="rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as CreateUserForm["status"] }))} className="rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10">
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PENDING">PENDING</option>
                  <option value="LOCKED">LOCKED</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              <div>
                <p className="mb-2 text-[12px] font-semibold text-muted-foreground">Gan vai tro</p>
                <div className="grid grid-cols-2 gap-2">
                  {roles.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-[12px]">
                      <input type="checkbox" checked={form.role_ids.includes(role.id)} onChange={() => handleToggleRole(role.id)} />
                      {role.name} ({role.code})
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowCreateModal(false)}>
                Huy
              </Button>
              <Button className="flex-1" onClick={() => void handleCreateUser()} disabled={creating}>
                {creating ? <Unlock className="h-3.5 w-3.5" /> : null}
                {creating ? "Dang tao..." : "Tao user"}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </PageWrapper>
  );
}
