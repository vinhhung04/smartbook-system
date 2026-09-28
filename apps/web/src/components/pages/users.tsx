import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Plus, X, Pencil, Trash2, Users } from "lucide-react";
import { Lock, Unlock } from "lucide"; // icon data (not components) — MorphIcon needs this, not lucide-react
import { MorphIcon } from "morphicons/react";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { useDialogA11y } from "@/hooks/useDialogA11y";

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

const PAGE_SIZE = 10;

const ROLE_CHIP_CLASS = "whitespace-nowrap rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-400";
const ICON_BUTTON_CLASS = "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60";
const MAX_VISIBLE_ROLES = 2;

function userInitials(fullName: string, username: string) {
  const source = (fullName || username || "?").trim();
  const words = source.split(/\s+/);
  const letters = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

function RoleChips({ roles }: { roles: RoleItem[] }) {
  if (roles.length === 0) return <span className="text-[12px] text-muted-foreground">Chưa có vai trò</span>;
  const hidden = roles.slice(MAX_VISIBLE_ROLES);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {roles.slice(0, MAX_VISIBLE_ROLES).map((role) => (
        <span key={role.id} className={ROLE_CHIP_CLASS}>{role.code}</span>
      ))}
      {hidden.length > 0 ? (
        <span className={cn(ROLE_CHIP_CLASS, "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground")} title={hidden.map((role) => role.code).join(", ")}>
          +{hidden.length}
        </span>
      ) : null}
    </div>
  );
}

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<UserRow | null>(null);
  const [form, setForm] = useState<CreateUserForm>(EMPTY_FORM);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const closeUserModal = () => {
    setShowCreateModal(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
  };

  useDialogA11y(showCreateModal, closeUserModal, modalRef);

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
    try {
      setDeletingUserId(user.id);
      await userService.delete(user.id);
      toast.success("Đã xóa người dùng");
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xóa người dùng thất bại"));
    } finally {
      setDeletingUserId(null);
      setPendingDeleteUser(null);
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
            <Button onClick={() => { setEditingUser(null); setForm(EMPTY_FORM); setShowCreateModal(true); }} data-testid="create-user-button">
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
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  { label: "Người dùng", className: "" },
                  { label: "Vai trò", className: "hidden w-[220px] md:table-cell" },
                  { label: "Trạng thái", className: "hidden w-[120px] sm:table-cell" },
                  { label: "Ngày tạo", className: "hidden w-[110px] xl:table-cell" },
                  { label: "Hành động", className: "w-[124px] text-right" },
                ].map((header) => (
                  <th key={header.label} className={cn("px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", header.className)}>
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={5} rows={5} />
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      variant="no-data"
                      title={search.trim() ? "Không tìm thấy người dùng phù hợp" : "Không có người dùng nào"}
                      description={search.trim() ? "Thử từ khóa khác hoặc xóa bộ lọc tìm kiếm" : "Tạo người dùng mới để bắt đầu"}
                      className="py-12"
                    />
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((user) => (
                  <motion.tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                            user.status === "LOCKED"
                              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                              : "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
                          )}
                        >
                          {userInitials(user.full_name, user.username)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold" title={user.full_name}>{user.full_name || user.username}</p>
                          <p className="truncate text-[12px] text-muted-foreground" title={`${user.username} · ${user.email || "-"}`}>
                            {user.username} · {user.email || "-"}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 md:hidden">
                            <RoleChips roles={user.roles || []} />
                            <span className="sm:hidden"><StatusBadge label={user.status} variant={statusBadgeVariant(user.status)} /></span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <RoleChips roles={user.roles || []} />
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <StatusBadge label={user.status} variant={statusBadgeVariant(user.status)} />
                    </td>
                    <td className="hidden px-4 py-3 text-[12px] text-muted-foreground xl:table-cell">{formatDate(user.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEditUser(user)}
                          aria-label={`Sửa ${user.username}`}
                          title="Sửa"
                          className={cn(ICON_BUTTON_CLASS, "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void handleToggleLock(user)}
                          data-testid="toggle-lock-user-button"
                          aria-label={`${user.status === "LOCKED" ? "Mở khóa" : "Khóa"} ${user.username}`}
                          title={user.status === "LOCKED" ? "Mở khóa" : "Khóa"}
                          className={cn(ICON_BUTTON_CLASS, "border-input hover:bg-muted")}
                        >
                          <MorphIcon icon={user.status === "LOCKED" ? Unlock : Lock} className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setPendingDeleteUser(user)}
                          disabled={deletingUserId === user.id}
                          aria-label={`Xóa ${user.username}`}
                          title={deletingUserId === user.id ? "Đang xóa..." : "Xóa"}
                          className={cn(ICON_BUTTON_CLASS, "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
          </div>
          <div className="flex flex-col gap-3 px-5 py-3 border-t border-border text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Hiển thị {paginatedUsers.length} / {filteredUsers.length} người dùng</span>
            {totalPages > 1 && (
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={(event) => {
                        event.preventDefault();
                        setPage((current) => Math.max(1, current - 1));
                      }}
                      className={cn("cursor-pointer", currentPage === 1 && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                  {getPaginationRange(currentPage, totalPages).map((item) => (
                    <PaginationItem key={item}>
                      {typeof item === "number" ? (
                        <PaginationLink
                          isActive={item === currentPage}
                          onClick={(event) => {
                            event.preventDefault();
                            setPage(item);
                          }}
                          className="cursor-pointer"
                        >
                          {item}
                        </PaginationLink>
                      ) : (
                        <PaginationEllipsis />
                      )}
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={(event) => {
                        event.preventDefault();
                        setPage((current) => Math.min(totalPages, current + 1));
                      }}
                      className={cn("cursor-pointer", currentPage === totalPages && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        </SectionCard>
      </FadeItem>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
          <motion.div ref={modalRef} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-lg rounded-xl bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 id="user-modal-title" className="text-[16px] font-semibold">{editingUser ? "Sửa người dùng" : "Tạo người dùng mới"}</h3>
              <button onClick={closeUserModal} aria-label="Đóng" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {!editingUser && <input value={form.username} onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))} placeholder="Tên đăng nhập *" data-testid="new-user-username" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />}
                <input value={form.full_name} onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))} placeholder="Họ tên *" data-testid="new-user-full-name" className={`rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 ${editingUser ? 'col-span-2' : ''}`} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="Email *" data-testid="new-user-email" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
                <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="Số điện thoại" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {!editingUser && <input type="password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Mật khẩu *" data-testid="new-user-password" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />}
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
                        <input type="checkbox" checked={form.role_ids.includes(role.id)} onChange={() => handleToggleRole(role.id)} data-testid={`new-user-role-${role.code}`} />
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
              <Button className="flex-1" onClick={() => void (editingUser ? handleEditUser() : handleCreateUser())} disabled={creating} data-testid="create-user-submit">
                {creating ? "Đang xử lý..." : editingUser ? "Cập nhật" : "Tạo người dùng"}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}

      <ConfirmDialog
        open={!!pendingDeleteUser}
        onOpenChange={(open) => { if (!open) setPendingDeleteUser(null); }}
        title="Xóa người dùng?"
        description={pendingDeleteUser ? `Xóa người dùng ${pendingDeleteUser.username}? Thao tác này không thể hoàn tác.` : undefined}
        variant="destructive"
        confirmLabel="Xóa"
        onConfirm={async () => { if (pendingDeleteUser) await handleDeleteUser(pendingDeleteUser); }}
        loading={!!deletingUserId}
      />
    </PageWrapper>
  );
}
