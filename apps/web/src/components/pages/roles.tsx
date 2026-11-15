import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { Shield, Search, Plus, Settings2, Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { roleService } from "@/services/role";
import { getApiErrorMessage } from "@/services/api.ts";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/components/ui/utils";
import { type StageTab } from "./borrow-shared/stage-tabs";
import { RowsSkeleton } from "@/components/ops/ops-kit";
import { PageHeader } from "@/components/ui/page-header";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { roleLabel } from "@/lib/role-labels";

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  user_count: number;
  permissions: Array<{
    id: string;
    code: string;
    module_name: string;
    action_name: string;
    description?: string;
  }>;
  created_at: string;
}

interface PermissionRow {
  id: string;
  code: string;
  module_name: string;
  action_name: string;
  description?: string;
}

interface RoleCreateForm {
  code: string;
  name: string;
  description: string;
}

type RoleScope = "all" | "system" | "custom";

// Permission modules come from the auth-service seed in English; staff read them in Vietnamese.
const MODULE_LABELS: Record<string, string> = {
  inventory: "Kho và danh mục",
  borrow: "Mượn trả",
  auth: "Tài khoản và phân quyền",
  analytics: "Phân tích",
  platform: "Hệ thống",
  customer: "Cổng bạn đọc",
  supplier: "Nhà cung cấp",
  ai: "Trợ lý AI",
  chatbot: "Chatbot",
  audit: "Nhật ký",
  other: "Khác",
};

function moduleLabel(name: string) {
  return MODULE_LABELS[name] ?? name;
}

function groupByModule<T extends { module_name: string }>(items: T[]) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    (acc[item.module_name || "other"] ??= []).push(item);
    return acc;
  }, {});
}

function RoleCreateModal(props: {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onSubmit: (payload: RoleCreateForm) => Promise<void>;
}) {
  const { open, creating, onClose, onSubmit } = props;
  const [form, setForm] = useState<RoleCreateForm>({ code: "", name: "", description: "" });
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, onClose, modalRef);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true" aria-labelledby="role-create-modal-title">
      <div ref={modalRef} className="w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 id="role-create-modal-title" className="font-display text-[20px] font-semibold tracking-tight text-foreground">Tạo vai trò mới</h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Vai trò mới chưa có quyền nào. Tạo xong, bấm Phân quyền để cấp quyền.</p>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block space-y-1">
            <span className="text-[13px] font-medium text-foreground">Mã vai trò</span>
            <input
              value={form.code}
              onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value.toUpperCase().replace(/\s+/g, "_") }))}
              placeholder="VD: AUDITOR"
              className="w-full rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[13px] font-medium text-foreground">Tên vai trò</span>
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="VD: Thủ kho"
              className="w-full rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[13px] font-medium text-foreground">Mô tả</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Mô tả ngắn cho vai trò"
              className="w-full resize-none rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button
            disabled={creating || !form.code.trim() || !form.name.trim()}
            onClick={() => void onSubmit(form)}
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {creating ? "Đang tạo..." : "Tạo vai trò"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RolePermissionModal(props: {
  open: boolean;
  role: RoleRow | null;
  permissions: PermissionRow[];
  selected: Set<string>;
  loadingPermissions: boolean;
  saving: boolean;
  keyword: string;
  onClose: () => void;
  onToggle: (permissionId: string) => void;
  onSearchChange: (value: string) => void;
  onSelectAllFiltered: () => void;
  onClearFiltered: () => void;
  onSave: () => Promise<void>;
}) {
  const {
    open,
    role,
    permissions,
    selected,
    loadingPermissions,
    saving,
    keyword,
    onClose,
    onToggle,
    onSearchChange,
    onSelectAllFiltered,
    onClearFiltered,
    onSave,
  } = props;

  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, onClose, modalRef);

  const filteredPermissions = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return permissions;
    return permissions.filter((permission) => {
      return (
        permission.code.toLowerCase().includes(key)
        || String(permission.description || "").toLowerCase().includes(key)
        || String(permission.module_name || "").toLowerCase().includes(key)
      );
    });
  }, [keyword, permissions]);

  const groupedPermissions = useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    for (const permission of filteredPermissions) {
      const group = permission.module_name || "other";
      if (!map.has(group)) map.set(group, []);
      map.get(group)?.push(permission);
    }
    return [...map.entries()];
  }, [filteredPermissions]);

  if (!open || !role) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-5" role="dialog" aria-modal="true" aria-labelledby="role-permission-modal-title">
      <div ref={modalRef} className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 id="role-permission-modal-title" className="font-display text-[20px] font-semibold tracking-tight text-foreground">Phân quyền: {roleLabel(role.code, role.name)}</h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Mã {role.code}. Đánh dấu để cấp hoặc thu hồi quyền, rồi bấm Lưu thay đổi.</p>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[280px] flex-1">
              <input
                value={keyword}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Tìm quyền theo mã, nhóm hoặc mô tả"
                className="w-full rounded-lg border border-input bg-card py-2.5 pl-9 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
              />
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
            <Button variant="outline" size="sm" onClick={onSelectAllFiltered}>
              Chọn tất cả kết quả
            </Button>
            <Button variant="outline" size="sm" onClick={onClearFiltered}>
              Bỏ chọn kết quả
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadingPermissions ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải danh sách quyền...
            </div>
          ) : groupedPermissions.length === 0 ? (
            <EmptyState variant="no-results" title="Không có quyền phù hợp" description="Thử đổi từ khóa tìm kiếm" className="py-8" />
          ) : (
            <div className="space-y-4">
              {groupedPermissions.map(([moduleName, modulePermissions]) => (
                <div key={moduleName} className="rounded-xl border border-border">
                  <div className="border-b border-border bg-muted/50 px-3 py-2 text-[13px] font-semibold text-foreground">
                    {moduleLabel(moduleName)}
                  </div>
                  <div className="divide-y divide-border">
                    {modulePermissions.map((permission) => {
                      const checked = selected.has(permission.id);
                      return (
                        <label key={permission.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-primary/[0.04]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggle(permission.id)}
                            className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                          />
                          <div>
                            <p className="text-[13px] font-medium text-foreground">{permission.description || `${permission.module_name}.${permission.action_name}`}</p>
                            <p className="font-mono text-[12px] text-muted-foreground">{permission.code}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          <p className="text-[12px] text-muted-foreground">Đã chọn {selected.size} quyền</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button
              disabled={saving}
              onClick={() => void onSave()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [permissionKeyword, setPermissionKeyword] = useState("");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "matrix">("list");
  const [scope, setScope] = useState<RoleScope>("all");

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await roleService.getAll();
      setRoles((response?.data || []) as RoleRow[]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách vai trò"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const loadPermissions = async () => {
    if (permissions.length > 0) return;
    try {
      setLoadingPermissions(true);
      const response = await roleService.getPermissions();
      setPermissions((response?.data || []) as PermissionRow[]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách quyền"));
    } finally {
      setLoadingPermissions(false);
    }
  };

  const filteredRoles = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return roles;

    return roles.filter((role) => {
      return (
        role.name.toLowerCase().includes(keyword)
        || role.code.toLowerCase().includes(keyword)
        || String(role.description || "").toLowerCase().includes(keyword)
      );
    });
  }, [roles, search]);

  const totalUsers = useMemo(() => roles.reduce((sum, role) => sum + Number(role.user_count || 0), 0), [roles]);
  const totalGrantedPermissions = useMemo(
    () => roles.reduce((sum, role) => sum + (Array.isArray(role.permissions) ? role.permissions.length : 0), 0),
    [roles],
  );

  const openPermissionModal = async (role: RoleRow) => {
    setEditingRole(role);
    setPermissionKeyword("");
    setSelectedPermissionIds(new Set((role.permissions || []).map((permission) => permission.id)));
    await loadPermissions();
  };

  const closePermissionModal = () => {
    if (savingPermissions) return;
    setEditingRole(null);
    setPermissionKeyword("");
    setSelectedPermissionIds(new Set());
  };

  const togglePermission = (permissionId: string) => {
    setSelectedPermissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) {
        next.delete(permissionId);
      } else {
        next.add(permissionId);
      }
      return next;
    });
  };

  const selectAllFilteredPermissions = () => {
    const key = permissionKeyword.trim().toLowerCase();
    const filtered = !key
      ? permissions
      : permissions.filter((permission) => {
        return (
          permission.code.toLowerCase().includes(key)
          || String(permission.description || "").toLowerCase().includes(key)
          || String(permission.module_name || "").toLowerCase().includes(key)
        );
      });

    setSelectedPermissionIds((prev) => {
      const next = new Set(prev);
      for (const permission of filtered) {
        next.add(permission.id);
      }
      return next;
    });
  };

  const clearFilteredPermissions = () => {
    const key = permissionKeyword.trim().toLowerCase();
    const filteredIds = new Set(
      (!key
        ? permissions
        : permissions.filter((permission) => {
          return (
            permission.code.toLowerCase().includes(key)
            || String(permission.description || "").toLowerCase().includes(key)
            || String(permission.module_name || "").toLowerCase().includes(key)
          );
        })
      ).map((permission) => permission.id),
    );

    setSelectedPermissionIds((prev) => {
      const next = new Set(prev);
      for (const id of filteredIds) {
        next.delete(id);
      }
      return next;
    });
  };

  const saveRolePermissions = async () => {
    if (!editingRole) return;
    try {
      setSavingPermissions(true);
      await roleService.update(editingRole.id, {
        permission_ids: [...selectedPermissionIds],
      });
      toast.success(`Đã cập nhật quyền cho vai trò ${editingRole.code}`);
      await loadData();
      closePermissionModal();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không cập nhật được quyền"));
    } finally {
      setSavingPermissions(false);
    }
  };

  const handleCreateRole = async (payload: RoleCreateForm) => {
    try {
      setCreatingRole(true);
      await roleService.create({
        code: payload.code.trim().toUpperCase(),
        name: payload.name.trim(),
        description: payload.description.trim() || undefined,
      });
      toast.success("Tạo vai trò thành công");
      setShowCreateModal(false);
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tạo được vai trò"));
    } finally {
      setCreatingRole(false);
    }
  };

  const tabs: StageTab<RoleScope>[] = [
    { key: "all", label: "Tất cả vai trò", count: roles.length },
    { key: "system", label: "Vai trò hệ thống", count: roles.filter((role) => role.is_system).length },
    { key: "custom", label: "Vai trò tùy chỉnh", count: roles.filter((role) => !role.is_system).length },
  ];
  const visibleRoles = filteredRoles.filter((role) => scope === "all" || (scope === "system") === role.is_system);

  const railButton = (key: string, label: string, count: number | undefined, active: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-primary/[0.08] text-primary" : "text-foreground hover:bg-muted/60",
      )}
    >
      <span className={cn("min-w-0 truncate text-[13px]", active ? "font-semibold" : "font-medium")}>{label}</span>
      {count !== undefined ? <span className={cn("shrink-0 text-[12px] tabular-nums", active ? "text-primary" : "text-muted-foreground")}>{loading ? "–" : count}</span> : null}
    </button>
  );
  const chip = (key: string, label: string, active: boolean, onClick: () => void, count?: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "border-primary/30 bg-primary/[0.08] font-semibold text-primary" : "border-border bg-card font-medium hover:bg-muted/60",
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
      {count !== undefined ? <span className="tabular-nums text-muted-foreground">{loading ? "–" : count}</span> : null}
    </button>
  );
  const chooseView = (mode: "list" | "matrix") => {
    setViewMode(mode);
    if (mode === "matrix") void loadPermissions();
  };
  const moduleCount = new Set(roles.flatMap((role) => (role.permissions || []).map((perm) => perm.module_name))).size;

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Shield}
          title="Vai trò và phân quyền"
          description={loading ? "Vai trò quyết định người dùng được xem và làm gì." : `${roles.length} vai trò, gán cho ${totalUsers} người dùng với ${totalGrantedPermissions} lượt cấp quyền trên ${moduleCount} nhóm chức năng.`}
          actions={
            <Button size="sm" onClick={() => setShowCreateModal(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Tạo vai trò
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[232px_minmax(0,1fr)]">
            <nav aria-label="Bộ lọc vai trò" className="hidden rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <p id="roles-scope-label" className="px-3 pb-1.5 text-[12px] font-medium text-muted-foreground">Loại vai trò</p>
              <div role="group" aria-labelledby="roles-scope-label">
                {tabs.map((tab) => railButton(`scope-${tab.key}`, tab.label, tab.count, scope === tab.key, () => setScope(tab.key)))}
              </div>
              <p id="roles-view-label" className="mt-3 border-t border-border px-3 pb-1.5 pt-3 text-[12px] font-medium text-muted-foreground">Cách xem</p>
              <div role="group" aria-labelledby="roles-view-label">
                {railButton("view-list", "Danh sách vai trò", undefined, viewMode === "list", () => chooseView("list"))}
                {railButton("view-matrix", "Ma trận quyền", undefined, viewMode === "matrix", () => chooseView("matrix"))}
              </div>
              <p className="mt-3 border-t border-border px-3 pt-3 text-[12px] leading-relaxed text-muted-foreground">
                Vai trò hệ thống có sẵn khi cài đặt. Đổi quyền của chúng ảnh hưởng mọi người dùng mang vai trò đó.
              </p>
            </nav>

            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl/page:hidden" role="group" aria-label="Lọc theo loại vai trò">
              {tabs.map((tab) => chip(`chip-${tab.key}`, tab.label, scope === tab.key, () => setScope(tab.key), tab.count))}
              {chip("chip-matrix", viewMode === "matrix" ? "Xem danh sách" : "Xem ma trận quyền", false, () => chooseView(viewMode === "matrix" ? "list" : "matrix"))}
            </div>

            <section aria-label={viewMode === "matrix" ? "Ma trận vai trò và quyền" : "Danh sách vai trò"} className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-4">
                <div>
                  <h2 className="font-display text-[18px] font-semibold tracking-tight">{viewMode === "matrix" ? "Ma trận vai trò và quyền" : tabs.find((tab) => tab.key === scope)?.label}</h2>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {viewMode === "matrix" ? "Mỗi dòng là một quyền, mỗi cột là một vai trò. Bấm tên vai trò để sửa quyền." : "Bấm Phân quyền để cấp hoặc thu hồi quyền của vai trò."}
                  </p>
                </div>
                {loadingPermissions && viewMode === "matrix" ? <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" aria-label="Đang tải quyền" /> : null}
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={search}
                  onSearchChange={setSearch}
                  searchPlaceholder="Tìm theo mã, tên, mô tả vai trò..."
                  showSearchClear
                />
              </div>

              {viewMode === "matrix" ? (
                permissions.length === 0 && !loadingPermissions ? (
                  <p className="p-5 text-center text-[13px] text-muted-foreground">Chưa tải được dữ liệu quyền</p>
                ) : (
                  <div className="max-h-[70vh] overflow-auto">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 z-20 bg-card">
                        <tr className="border-b border-border">
                          <th scope="col" className="sticky left-0 z-10 min-w-[240px] bg-card px-5 py-2.5 text-left text-[12px] font-normal text-muted-foreground">Quyền</th>
                          {visibleRoles.map((role) => (
                            <th key={role.id} scope="col" className="min-w-[104px] px-2 py-2.5 text-center font-medium">
                              <button
                                type="button"
                                onClick={() => void openPermissionModal(role)}
                                title={`Sửa quyền của ${roleLabel(role.code, role.name)} (${role.code})`}
                                className="mx-auto block max-w-[104px] truncate rounded px-1 text-[12px] font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {roleLabel(role.code, role.name)}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(groupByModule(permissions)).map(([moduleName, modulePerms]) => (
                          <Fragment key={moduleName}>
                            <tr className="border-b border-border bg-muted/40">
                              <th scope="rowgroup" colSpan={visibleRoles.length + 1} className="sticky left-0 px-5 py-1.5 text-left text-[13px] font-semibold text-foreground">
                                {moduleLabel(moduleName)}
                                <span className="ml-2 font-normal text-muted-foreground">{modulePerms.length} quyền</span>
                              </th>
                            </tr>
                            {modulePerms.map((perm) => (
                              <tr key={perm.id} className="border-b border-border/60 hover:bg-muted/20">
                                <th scope="row" className="sticky left-0 bg-card px-5 py-2 text-left font-normal">
                                  <span className="block text-foreground">{perm.description || perm.action_name}</span>
                                  <span className="block font-mono text-[12px] text-muted-foreground">{perm.code}</span>
                                </th>
                                {visibleRoles.map((role) => (
                                  <td key={role.id} className="px-2 py-2 text-center">
                                    {role.permissions.some((rp) => rp.id === perm.id) ? (
                                      <Check className="mx-auto h-4 w-4 text-primary" aria-label="Có quyền" />
                                    ) : (
                                      <span className="text-muted-foreground/40" aria-label="Không có quyền">–</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : loading ? (
                <RowsSkeleton rows={6} />
              ) : visibleRoles.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    variant={search ? "no-results" : "no-data"}
                    title={search ? "Không tìm thấy vai trò" : "Chưa có vai trò nào ở mục này"}
                    description={search ? "Thử tìm theo mã, tên hoặc mô tả." : "Tạo vai trò mới để bắt đầu phân quyền."}
                    className="py-0"
                  />
                </div>
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Vai trò</TableHead>
                      <TableHead className="hidden w-[96px] text-right text-[12px] font-normal text-muted-foreground @2xl:table-cell">Người dùng</TableHead>
                      <TableHead className="hidden w-[34%] text-[12px] font-normal text-muted-foreground @3xl:table-cell">Quyền theo nhóm chức năng</TableHead>
                      <TableHead className="w-[140px] pr-5 text-right text-[12px] font-normal text-muted-foreground">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRoles.map((role) => {
                      const modules = Object.entries(groupByModule(role.permissions || [])).sort((a, b) => b[1].length - a[1].length);
                      const modulesLine = modules.length
                        ? modules.slice(0, 3).map(([name, list]) => `${moduleLabel(name)} ${list.length}`).join(", ") + (modules.length > 3 ? `, thêm ${modules.length - 3} nhóm` : "")
                        : "Chưa cấp quyền nào";
                      return (
                        <TableRow key={role.id} className="hover:bg-muted/30">
                          <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                            <p className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-[14px] font-semibold text-foreground">{roleLabel(role.code, role.name)}</span>
                              <span className="font-mono text-[12px] text-muted-foreground">{role.code}</span>
                            </p>
                            <p className="text-[12px] text-muted-foreground">{role.is_system ? "Vai trò hệ thống" : "Vai trò tùy chỉnh"}</p>
                            {role.description ? <p className="mt-1 line-clamp-2 max-w-prose text-[13px] text-muted-foreground" title={role.description}>{role.description}</p> : null}
                            {/* Columns the container hides move here, so no field is dropped. */}
                            <p className="mt-1 text-[12px] text-muted-foreground @2xl:hidden">{role.user_count || 0} người dùng</p>
                            <p className="mt-1 text-[12px] text-muted-foreground @3xl:hidden">{(role.permissions || []).length} quyền: {modulesLine}</p>
                          </TableCell>
                          <TableCell className="hidden py-3.5 text-right align-top @2xl:table-cell">
                            <span className="text-[14px] font-semibold tabular-nums text-foreground">{role.user_count || 0}</span>
                          </TableCell>
                          <TableCell className="hidden whitespace-normal py-3.5 align-top @3xl:table-cell">
                            <p className="text-[13px] text-foreground"><span className="font-semibold tabular-nums">{(role.permissions || []).length}</span> quyền</p>
                            <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{modulesLine}</p>
                          </TableCell>
                          <TableCell className="py-3.5 pr-5 text-right align-top">
                            <Button variant="outline" size="sm" onClick={() => void openPermissionModal(role)} className="gap-1.5">
                              <Settings2 className="h-3.5 w-3.5" /> Phân quyền
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </section>
          </div>
        </div>
      </FadeItem>

      {showCreateModal && <RoleCreateModal
        open={showCreateModal}
        creating={creatingRole}
        onClose={() => {
          if (!creatingRole) setShowCreateModal(false);
        }}
        onSubmit={handleCreateRole}
      />}

      <RolePermissionModal
        open={Boolean(editingRole)}
        role={editingRole}
        permissions={permissions}
        selected={selectedPermissionIds}
        loadingPermissions={loadingPermissions}
        saving={savingPermissions}
        keyword={permissionKeyword}
        onClose={closePermissionModal}
        onToggle={togglePermission}
        onSearchChange={setPermissionKeyword}
        onSelectAllFiltered={selectAllFilteredPermissions}
        onClearFiltered={clearFilteredPermissions}
        onSave={saveRolePermissions}
      />
    </PageWrapper>
  );
}
