import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Plus, X, Pencil, Trash2, Users, Star } from "lucide-react";
import { Lock, Unlock } from "lucide"; // icon data (not components) — MorphIcon needs this, not lucide-react
import { MorphIcon } from "morphicons/react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { userService, type WarehouseScope } from "@/services/user";
import { roleService } from "@/services/role";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import { staffTaskService, type OpenTaskSummaryRow } from "@/services/staff-tasks";
import { getApiErrorMessage } from "@/services/api";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { WarehouseAssignmentFields } from "./user-management/warehouse-assignment-fields";
import { WarehouseStaffPanel } from "./user-management/warehouse-staff-panel";
import { ACCESS_LEVEL_LABELS, diffScopes, hasScopeChanges, toScopes, type ScopeDiff, type ScopeDraft } from "./user-management/warehouse-access";

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
  status: "ACTIVE" | "INACTIVE" | "LOCKED" | "PENDING" | "PENDING_VERIFICATION";
  created_at: string;
  roles: RoleItem[];
  email_verified_at?: string | null;
  email_otp_2fa_enabled?: boolean;
  primary_warehouse_id?: string | null;
  warehouse_scopes?: WarehouseScope[];
}

interface CreateUserForm {
  username: string;
  full_name: string;
  email: string;
  phone: string;
  password: string;
  status: UserRow["status"];
  role_ids: string[];
  email_otp_2fa_enabled: boolean;
  scopes: ScopeDraft[];
  primary_warehouse_id: string | null;
}

const EMPTY_FORM: CreateUserForm = {
  username: "",
  full_name: "",
  email: "",
  phone: "",
  password: "",
  status: "ACTIVE",
  role_ids: [],
  email_otp_2fa_enabled: false,
  scopes: [],
  primary_warehouse_id: null,
};

/** A saved edit whose assignment change needs a confirmation first. */
interface PendingAssignment {
  user: UserRow;
  diff: ScopeDiff;
  primaryBefore: string | null;
  primaryAfter: string | null;
  openTasks: OpenTaskSummaryRow[] | null;
}

const ALL = "ALL";
const STATUS_LABELS: Record<UserRow["status"], string> = {
  ACTIVE: "Đang hoạt động",
  PENDING: "Chờ kích hoạt",
  PENDING_VERIFICATION: "Chờ xác thực email",
  LOCKED: "Đã khóa",
  INACTIVE: "Ngừng hoạt động",
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
  if (status === "PENDING" || status === "PENDING_VERIFICATION") return "warning";
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

function ScopeSummary({ scopes, warehouseById }: { scopes: WarehouseScope[]; warehouseById: Map<string, Warehouse> }) {
  if (scopes.length === 0) return <span className="whitespace-nowrap text-[12px] text-muted-foreground">Chưa phân công</span>;
  const detail = scopes
    .map((s) => `${warehouseById.get(s.warehouse_id)?.code || s.warehouse_id.slice(0, 8)}: ${ACCESS_LEVEL_LABELS[s.access_level] || s.access_level}`)
    .join("\n");
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-[12px] font-medium tabular-nums" title={detail}>
      {scopes.length} kho
    </span>
  );
}

function warehouseLabel(id: string | null | undefined, warehouseById: Map<string, Warehouse>) {
  if (!id) return null;
  const warehouse = warehouseById.get(id);
  return warehouse ? `${warehouse.code} · ${warehouse.name}` : id.slice(0, 8);
}

function OpenTaskNotice({ rows, warehouseIds, warehouseById }: { rows: OpenTaskSummaryRow[] | null; warehouseIds: string[] | null; warehouseById: Map<string, Warehouse> }) {
  if (rows === null) {
    return <p className="text-[12px] text-muted-foreground">Không kiểm tra được việc đang mở của người này.</p>;
  }
  const relevant = rows.filter((row) => (warehouseIds ? row.warehouse_id !== null && warehouseIds.includes(row.warehouse_id) : true));
  const total = relevant.reduce((sum, row) => sum + row.open + row.in_progress, 0);
  if (total === 0) return <p className="text-[12px] text-muted-foreground">Không có task đang mở bị ảnh hưởng.</p>;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <p className="font-semibold">{total} task đang mở sẽ không thể tiếp tục:</p>
      <ul className="mt-1 space-y-0.5">
        {relevant.map((row) => (
          <li key={row.warehouse_id || "none"}>
            {warehouseLabel(row.warehouse_id, warehouseById) || "Không gắn kho"}: {row.open} mới, {row.in_progress} đang làm
          </li>
        ))}
      </ul>
      <p className="mt-1">Giao lại các task này ở trang Giao việc nhân viên.</p>
    </div>
  );
}

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [warehouseFilter, setWarehouseFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [view, setView] = useState<"users" | "by-warehouse">("users");
  const [staffWarehouseId, setStaffWarehouseId] = useState("");
  const [staffRefreshKey, setStaffRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<UserRow | null>(null);
  const [pendingLockUser, setPendingLockUser] = useState<{ user: UserRow; openTasks: OpenTaskSummaryRow[] | null } | null>(null);
  const [pendingAssignment, setPendingAssignment] = useState<PendingAssignment | null>(null);
  const [form, setForm] = useState<CreateUserForm>(EMPTY_FORM);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const warehouseById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

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
    warehouseService.getAll()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setWarehouses(list);
        setStaffWarehouseId((current) => current || list[0]?.id || "");
      })
      .catch((error) => setWarehouseError(getApiErrorMessage(error, "Không tải được danh sách kho")));
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return users.filter((user) => {
      if (keyword && !(
        user.username.toLowerCase().includes(keyword)
        || user.full_name.toLowerCase().includes(keyword)
        || String(user.email || "").toLowerCase().includes(keyword)
      )) return false;
      if (roleFilter !== ALL && !(user.roles || []).some((role) => role.code === roleFilter)) return false;
      if (warehouseFilter !== ALL && !(user.warehouse_scopes || []).some((s) => s.warehouse_id === warehouseFilter)) return false;
      if (statusFilter !== ALL && user.status !== statusFilter) return false;
      return true;
    });
  }, [search, users, roleFilter, warehouseFilter, statusFilter]);

  const hasFilters = Boolean(search.trim()) || roleFilter !== ALL || warehouseFilter !== ALL || statusFilter !== ALL;

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, warehouseFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const closeUserModal = () => {
    setShowCreateModal(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
  };

  // the user form steps aside while its own confirmation is open (state kept)
  const modalVisible = showCreateModal && !pendingAssignment;
  useDialogA11y(modalVisible, closeUserModal, modalRef);

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

    if (form.scopes.some((row) => !row.warehouse_id)) {
      toast.error("Chọn kho cho mọi dòng phân công, hoặc xóa dòng trống");
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
        ...(form.scopes.length ? { warehouse_scopes: toScopes(form.scopes), primary_warehouse_id: form.primary_warehouse_id } : {}),
      });

      toast.success("Đã tạo người dùng mới");
      closeUserModal();
      setStaffRefreshKey((v) => v + 1);
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
      email_otp_2fa_enabled: Boolean(user.email_otp_2fa_enabled),
      scopes: (user.warehouse_scopes || []).map((s) => ({ warehouse_id: s.warehouse_id, access_level: s.access_level })),
      primary_warehouse_id: user.primary_warehouse_id || null,
    });
    setShowCreateModal(true);
  };

  const openEditUserById = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (user) openEditUser(user);
    else toast.error("Không tìm thấy người dùng trong danh sách, hãy tải lại trang");
  };

  const loadOpenTasks = async (userId: string) => {
    try {
      const response = await staffTaskService.getOpenSummary(userId);
      return Array.isArray(response.data) ? response.data : [];
    } catch {
      return null;
    }
  };

  /** Saves profile fields, then the assignment when it changed. */
  const saveEdit = async (user: UserRow) => {
    try {
      setCreating(true);
      await userService.update(user.id, {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        status: form.status,
        role_ids: form.role_ids,
        ...(form.email_otp_2fa_enabled !== Boolean(user.email_otp_2fa_enabled) ? { email_otp_2fa_enabled: form.email_otp_2fa_enabled } : {}),
      });
      const before = user.warehouse_scopes || [];
      const after = toScopes(form.scopes);
      const primaryChanged = (user.primary_warehouse_id || null) !== form.primary_warehouse_id;
      if (hasScopeChanges(diffScopes(before, after)) || primaryChanged) {
        try {
          await userService.updateWarehouseScopes(user.id, after, form.primary_warehouse_id);
        } catch (error) {
          toast.error(getApiErrorMessage(error, "Đã lưu thông tin, nhưng cập nhật phân công kho thất bại"));
          await loadData();
          return;
        }
      }
      toast.success("Đã cập nhật người dùng");
      closeUserModal();
      setStaffRefreshKey((v) => v + 1);
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cập nhật người dùng thất bại"));
    } finally {
      setCreating(false);
    }
  };

  const handleEditUser = async () => {
    if (!editingUser) return;
    if (!validateUserForm(true)) return;

    const diff = diffScopes(editingUser.warehouse_scopes || [], toScopes(form.scopes));
    const primaryBefore = editingUser.primary_warehouse_id || null;
    const primaryAfter = form.primary_warehouse_id;
    // revoking a warehouse or moving the primary one: confirm, showing the open work it affects
    if (diff.removed.length > 0 || (primaryBefore && primaryBefore !== primaryAfter)) {
      setCreating(true);
      const openTasks = diff.removed.length > 0 ? await loadOpenTasks(editingUser.id) : [];
      setCreating(false);
      setPendingAssignment({ user: editingUser, diff, primaryBefore, primaryAfter, openTasks });
      return;
    }
    await saveEdit(editingUser);
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

  const requestToggleLock = async (user: UserRow) => {
    if (user.status === "LOCKED") {
      await handleToggleLock(user);
      return;
    }
    const openTasks = (user.warehouse_scopes || []).length ? await loadOpenTasks(user.id) : [];
    setPendingLockUser({ user, openTasks });
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

  const columns = [
    { label: "Người dùng", className: "" },
    { label: "Vai trò", className: "hidden w-[200px] md:table-cell" },
    { label: "Kho chính", className: "hidden w-[190px] lg:table-cell" },
    { label: "Phạm vi kho", className: "hidden w-[130px] sm:table-cell" },
    { label: "Trạng thái", className: "hidden w-[120px] sm:table-cell" },
    { label: "Ngày tạo", className: "hidden w-[110px] 2xl:table-cell" },
    { label: "Hành động", className: "w-[124px] text-right" },
  ];

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Users}
          title="Người dùng"
          description="Quản lý tài khoản, vai trò và kho làm việc của nhân sự"
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
        <SegmentedControl
          layoutId="users-view"
          value={view}
          onChange={setView}
          options={[
            { value: "users", label: "Danh sách người dùng" },
            { value: "by-warehouse", label: "Nhân sự theo kho" },
          ]}
          className="w-fit"
        />
      </FadeItem>

      {view === "by-warehouse" ? (
        <FadeItem>
          <WarehouseStaffPanel
            warehouses={warehouses}
            warehouseId={staffWarehouseId}
            onWarehouseChange={setStaffWarehouseId}
            onEditUser={openEditUserById}
            refreshKey={staffRefreshKey}
          />
        </FadeItem>
      ) : (
      <>
      <FadeItem>
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Tìm theo tên đăng nhập, họ tên, email..."
          showSearchClear
          filters={(
            <div className="flex flex-wrap items-center gap-2">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[170px]" size="sm" aria-label="Lọc theo vai trò">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Mọi vai trò</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.code}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                <SelectTrigger className="w-[190px]" size="sm" aria-label="Lọc theo kho">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Mọi kho</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[170px]" size="sm" aria-label="Lọc theo trạng thái">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Mọi trạng thái</SelectItem>
                  {(Object.keys(STATUS_LABELS) as UserRow["status"][]).map((status) => (
                    <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {columns.map((header) => (
                  <th key={header.label} className={cn("px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", header.className)}>
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={columns.length} rows={5} />
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState
                      variant="no-data"
                      title={hasFilters ? "Không tìm thấy người dùng phù hợp" : "Không có người dùng nào"}
                      description={hasFilters ? "Thử từ khóa khác hoặc bỏ bớt bộ lọc" : "Tạo người dùng mới để bắt đầu"}
                      className="py-12"
                    />
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((user) => {
                  const scopes = user.warehouse_scopes || [];
                  const primary = warehouseLabel(user.primary_warehouse_id, warehouseById);
                  return (
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
                            <span className="sm:hidden"><ScopeSummary scopes={scopes} warehouseById={warehouseById} /></span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <RoleChips roles={user.roles || []} />
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      {primary ? (
                        <span className="flex min-w-0 items-center gap-1.5 text-[12px]" title={primary}>
                          <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-hidden="true" />
                          <span className="truncate">{primary}</span>
                        </span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <ScopeSummary scopes={scopes} warehouseById={warehouseById} />
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <StatusBadge label={user.status} variant={statusBadgeVariant(user.status)} />
                    </td>
                    <td className="hidden px-4 py-3 text-[12px] text-muted-foreground 2xl:table-cell">{formatDate(user.created_at)}</td>
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
                          onClick={() => void requestToggleLock(user)}
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
                  );
                })
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
      </>
      )}

      {modalVisible ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
          <motion.div ref={modalRef} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-xl bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 id="user-modal-title" className="text-[16px] font-semibold">{editingUser ? "Sửa người dùng" : "Tạo người dùng mới"}</h3>
              <button onClick={closeUserModal} aria-label="Đóng" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {!editingUser && <input value={form.username} onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))} placeholder="Tên đăng nhập *" aria-label="Tên đăng nhập" data-testid="new-user-username" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />}
                <input value={form.full_name} onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))} placeholder="Họ tên *" aria-label="Họ tên" data-testid="new-user-full-name" className={`rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 ${editingUser ? 'sm:col-span-2' : ''}`} />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="Email *" aria-label="Email" data-testid="new-user-email" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
                <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="Số điện thoại" aria-label="Số điện thoại" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {!editingUser && <input type="password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Mật khẩu *" aria-label="Mật khẩu" data-testid="new-user-password" className="rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10" />}
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as CreateUserForm["status"] }))} aria-label="Trạng thái" className={`rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 ${editingUser ? 'sm:col-span-2' : ''}`}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PENDING">PENDING</option>
                  {editingUser?.status === "PENDING_VERIFICATION" ? <option value="PENDING_VERIFICATION">PENDING_VERIFICATION</option> : null}
                  <option value="LOCKED">LOCKED</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              {editingUser ? (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-input px-3 py-2.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={form.email_otp_2fa_enabled}
                    onChange={(event) => setForm((prev) => ({ ...prev, email_otp_2fa_enabled: event.target.checked }))}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
                  />
                  <span>
                    <span className="block font-medium text-foreground">Yêu cầu mã đăng nhập qua email</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {editingUser.email_verified_at
                        ? "Sau mật khẩu, người dùng nhập mã 6 chữ số gửi tới email. Bật lên sẽ đăng xuất các phiên hiện có. Chỉ có hiệu lực khi hệ thống bật STAFF_EMAIL_OTP_MODE."
                        : "Email của tài khoản chưa được xác thực: người dùng cần xác thực email ở trang Tài khoản trước khi bật."}
                    </span>
                  </span>
                </label>
              ) : null}

              <div>
                <p className="mb-2 text-[12px] font-semibold text-muted-foreground">Gán vai trò *</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {loading ? (
                    <div className="col-span-full rounded-lg border border-dashed border-input px-3 py-3 text-[12px] text-muted-foreground">
                      Đang tải vai trò...
                    </div>
                  ) : roles.length === 0 ? (
                    <div className="col-span-full rounded-lg border border-dashed border-input px-3 py-3 text-[12px] text-muted-foreground">
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

              <div className="border-t border-border pt-4">
                <WarehouseAssignmentFields
                  warehouses={warehouses}
                  rows={form.scopes}
                  onRowsChange={(scopes) => setForm((prev) => ({ ...prev, scopes }))}
                  primaryWarehouseId={form.primary_warehouse_id}
                  onPrimaryChange={(primary_warehouse_id) => setForm((prev) => ({ ...prev, primary_warehouse_id }))}
                  loading={!warehouses.length && !warehouseError}
                  error={warehouseError}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-border px-6 py-4">
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
        open={!!pendingAssignment}
        onOpenChange={(open) => { if (!open) setPendingAssignment(null); }}
        title="Xác nhận thay đổi kho làm việc?"
        description={pendingAssignment ? `Áp dụng cho ${pendingAssignment.user.full_name || pendingAssignment.user.username}.` : undefined}
        variant={pendingAssignment?.diff.removed.length ? "destructive" : "default"}
        confirmLabel="Lưu thay đổi"
        onConfirm={async () => {
          const pending = pendingAssignment;
          setPendingAssignment(null);
          if (pending) await saveEdit(pending.user);
        }}
      >
        {pendingAssignment ? (
          <div className="space-y-2 text-[13px]">
            {pendingAssignment.diff.removed.length ? (
              <p>
                Thu hồi quyền ở:{" "}
                <span className="font-semibold">
                  {pendingAssignment.diff.removed.map((row) => warehouseLabel(row.warehouse_id, warehouseById)).join(", ")}
                </span>
              </p>
            ) : null}
            {pendingAssignment.primaryBefore !== pendingAssignment.primaryAfter ? (
              <p>
                Kho chính: <span className="font-semibold">{warehouseLabel(pendingAssignment.primaryBefore, warehouseById) || "—"}</span>
                {" → "}
                <span className="font-semibold">{warehouseLabel(pendingAssignment.primaryAfter, warehouseById) || "không có"}</span>
              </p>
            ) : null}
            {pendingAssignment.diff.removed.length ? (
              <OpenTaskNotice
                rows={pendingAssignment.openTasks}
                warehouseIds={pendingAssignment.diff.removed.map((row) => row.warehouse_id)}
                warehouseById={warehouseById}
              />
            ) : null}
          </div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!pendingLockUser}
        onOpenChange={(open) => { if (!open) setPendingLockUser(null); }}
        title="Khóa tài khoản?"
        description={pendingLockUser ? `${pendingLockUser.user.username} sẽ bị đăng xuất và mất quyền truy cập mọi kho ngay lập tức.` : undefined}
        variant="destructive"
        confirmLabel="Khóa"
        onConfirm={async () => {
          const pending = pendingLockUser;
          setPendingLockUser(null);
          if (pending) await handleToggleLock(pending.user);
        }}
      >
        {pendingLockUser && (pendingLockUser.user.warehouse_scopes || []).length ? (
          <OpenTaskNotice rows={pendingLockUser.openTasks} warehouseIds={null} warehouseById={warehouseById} />
        ) : null}
      </ConfirmDialog>

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
