import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { Shield, Search, Plus, Settings2, Loader2, X, LayoutList, Grid3x3, Check } from "lucide-react";
import { toast } from "sonner";
import { roleService } from "@/services/role";
import { getApiErrorMessage } from "@/services/api.ts";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/components/ui/utils";
import { StageTabs, type StageTab } from "./borrow-shared/stage-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/status-badge";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { useDialogA11y } from "@/hooks/useDialogA11y";

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
      <div ref={modalRef} className="w-full max-w-xl rounded-xl border border-border bg-card shadow-[0_12px_38px_rgba(15,23,42,0.2)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 id="role-create-modal-title" className="text-[16px] font-semibold text-foreground">Tạo vai trò mới</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Vai trò sẽ được lưu trực tiếp vào auth_db</p>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-foreground">Code</span>
            <input
              value={form.code}
              onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value.toUpperCase().replace(/\s+/g, "_") }))}
              placeholder="VD: AUDITOR"
              className="w-full rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-foreground">Tên vai trò</span>
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="VD: Thủ kho"
              className="w-full rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-foreground">Mô tả</span>
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
      <div ref={modalRef} className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_12px_42px_rgba(15,23,42,0.28)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 id="role-permission-modal-title" className="text-[16px] font-semibold text-foreground">Phân quyền: {role.name}</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Code: {role.code} · Tick để cấp/thu hồi quyền và lưu vào DB</p>
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
                placeholder="Tìm quyền theo code/module/mô tả"
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
                  <div className="border-b border-border bg-muted/50 px-3 py-2 text-[12px] font-semibold text-foreground">
                    {moduleName}
                  </div>
                  <div className="divide-y divide-border">
                    {modulePermissions.map((permission) => {
                      const checked = selected.has(permission.id);
                      return (
                        <label key={permission.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-violet-50/40 dark:hover:bg-violet-500/10">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggle(permission.id)}
                            className="mt-0.5 h-4 w-4 rounded border-input text-violet-600 dark:text-violet-500 focus:ring-violet-400 dark:focus:ring-violet-500/40"
                          />
                          <div>
                            <p className="text-[13px] font-semibold text-foreground">{permission.code}</p>
                            <p className="text-[12px] text-muted-foreground">{permission.description || `${permission.module_name}.${permission.action_name}`}</p>
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

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Shield}
          title="Quản lý vai trò"
          description={`${roles.length} vai trò, gán cho ${totalUsers} người dùng với ${totalGrantedPermissions} lượt cấp quyền`}
          iconBg="bg-violet-50 dark:bg-violet-500/10"
          iconColor="text-violet-600 dark:text-violet-400"
          actions={
            <Button size="sm" onClick={() => setShowCreateModal(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Tạo vai trò
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="rounded-xl border border-border bg-card">
          <StageTabs label="Lọc theo loại vai trò" tabs={tabs} value={scope} onChange={setScope} loading={loading} />
          <div className="border-t border-border px-4 py-3">
            <FilterBar
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Tìm theo code, tên, mô tả vai trò..."
              showSearchClear
              actions={
                <div role="group" aria-label="Kiểu hiển thị" className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
                  {([
                    { key: "list", label: "Danh sách", icon: LayoutList },
                    { key: "matrix", label: "Ma trận quyền", icon: Grid3x3 },
                  ] as const).map((mode) => (
                    <button
                      key={mode.key}
                      type="button"
                      aria-pressed={viewMode === mode.key}
                      onClick={() => {
                        setViewMode(mode.key);
                        if (mode.key === "matrix") void loadPermissions();
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        viewMode === mode.key ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <mode.icon className="h-3.5 w-3.5" /> {mode.label}
                    </button>
                  ))}
                </div>
              }
            />
          </div>
        </div>
      </FadeItem>

      {viewMode === "matrix" && (
        <FadeItem>
          <SectionCard
            noPadding
            title="Ma trận vai trò và quyền"
            subtitle="Mỗi dòng là một quyền, mỗi cột là một vai trò. Bấm mã vai trò để sửa quyền."
            actions={loadingPermissions ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : undefined}
          >
            {permissions.length === 0 && !loadingPermissions ? (
              <p className="p-5 text-center text-[13px] text-muted-foreground">Chưa tải được dữ liệu quyền</p>
            ) : (
              <div className="max-h-[70vh] overflow-auto border-t border-border">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-20 bg-card">
                    <tr className="border-b border-border">
                      <th scope="col" className="sticky left-0 z-10 min-w-[220px] bg-card px-4 py-2.5 text-left font-medium text-muted-foreground">Quyền</th>
                      {visibleRoles.map((role) => (
                        <th key={role.id} scope="col" className="min-w-[96px] px-2 py-2.5 text-center font-medium">
                          <button
                            type="button"
                            onClick={() => void openPermissionModal(role)}
                            title={`Sửa quyền của ${role.name}`}
                            className="mx-auto block max-w-[96px] truncate rounded px-1 font-mono text-[11px] text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-violet-400"
                          >
                            {role.code}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(groupByModule(permissions)).map(([moduleName, modulePerms]) => (
                      <Fragment key={moduleName}>
                        <tr className="border-b border-border bg-muted/40">
                          <th scope="rowgroup" colSpan={visibleRoles.length + 1} className="sticky left-0 px-4 py-1.5 text-left text-[12px] font-semibold text-foreground">
                            {moduleName}
                            <span className="ml-2 font-normal text-muted-foreground">{modulePerms.length} quyền</span>
                          </th>
                        </tr>
                        {modulePerms.map((perm) => (
                          <tr key={perm.id} className="border-b border-border/60 hover:bg-muted/20">
                            <th scope="row" className="sticky left-0 bg-card px-4 py-2 text-left font-normal">
                              <span className="block text-foreground">{perm.action_name}</span>
                              {perm.description ? <span className="block text-[11px] text-muted-foreground">{perm.description}</span> : null}
                            </th>
                            {visibleRoles.map((role) => (
                              <td key={role.id} className="px-2 py-2 text-center">
                                {role.permissions.some((rp) => rp.id === perm.id) ? (
                                  <Check className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="Có quyền" />
                                ) : (
                                  <span className="text-muted-foreground/30" aria-label="Không có quyền">–</span>
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
            )}
          </SectionCard>
        </FadeItem>
      )}

      {viewMode === "list" && (
        <FadeItem>
          <SectionCard noPadding>
            {!loading && visibleRoles.length === 0 ? (
              <EmptyState
                variant={search ? "no-results" : "no-data"}
                title={search ? "Không tìm thấy vai trò" : "Chưa có vai trò nào ở mục này"}
                description={search ? "Thử tìm theo code, tên hoặc mô tả." : "Tạo vai trò mới để bắt đầu phân quyền."}
                className="py-12"
              />
            ) : (
              <Table className="table-fixed">
                <TableHeader className="bg-muted/50">
                  <TableRow className="hover:bg-transparent">
                    {[
                      { label: "Vai trò", className: "" },
                      { label: "Mô tả", className: "hidden w-[30%] xl:table-cell" },
                      { label: "Người dùng", className: "hidden w-[110px] text-right md:table-cell" },
                      { label: "Quyền theo module", className: "hidden w-[260px] lg:table-cell" },
                      { label: "Thao tác", className: "w-[132px] text-right" },
                    ].map((header) => (
                      <TableHead key={header.label} className={cn("px-4 py-3 text-xs font-medium text-muted-foreground", header.className)}>
                        {header.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <SkeletonTableRow columns={5} rows={5} />
                  ) : (
                    visibleRoles.map((role) => {
                      const modules = Object.entries(groupByModule(role.permissions || [])).sort((a, b) => b[1].length - a[1].length);
                      return (
                        <TableRow key={role.id} className="hover:bg-muted/30">
                          <TableCell className="px-4 py-3 align-top">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">{role.name}</span>
                              <StatusBadge label={role.is_system ? "Hệ thống" : "Tùy chỉnh"} variant={role.is_system ? "amber" : "neutral"} />
                            </div>
                            <p className="mt-0.5 font-mono text-xs text-violet-700 dark:text-violet-400">{role.code}</p>
                            {role.description ? <p className="mt-1 line-clamp-2 whitespace-normal text-xs text-muted-foreground xl:hidden">{role.description}</p> : null}
                            <p className="mt-1 text-xs text-muted-foreground lg:hidden">
                              {role.user_count || 0} người dùng, {(role.permissions || []).length} quyền
                            </p>
                          </TableCell>
                          <TableCell className="hidden px-4 py-3 align-top xl:table-cell">
                            <p className="line-clamp-3 whitespace-normal text-[13px] text-muted-foreground">{role.description || "Chưa có mô tả"}</p>
                          </TableCell>
                          <TableCell className="hidden px-4 py-3 text-right align-top md:table-cell">
                            <span className="text-sm font-semibold tabular-nums text-foreground">{role.user_count || 0}</span>
                          </TableCell>
                          <TableCell className="hidden px-4 py-3 align-top lg:table-cell">
                            <p className="text-[13px] text-foreground"><span className="font-semibold tabular-nums">{(role.permissions || []).length}</span> quyền</p>
                            <p className="mt-0.5 line-clamp-2 whitespace-normal text-xs text-muted-foreground">
                              {modules.length
                                ? modules.slice(0, 3).map(([name, list]) => `${name} ${list.length}`).join(", ") + (modules.length > 3 ? `, thêm ${modules.length - 3} module` : "")
                                : "Chưa cấp quyền nào"}
                            </p>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-right align-top">
                            <Button variant="outline" size="sm" onClick={() => void openPermissionModal(role)} className="gap-1.5">
                              <Settings2 className="h-3.5 w-3.5" /> Phân quyền
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </FadeItem>
      )}

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
