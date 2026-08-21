import { useEffect, useMemo, useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { Shield, Search, Plus, Settings2, Loader2, X, LayoutList, Grid3x3, Check } from "lucide-react";
import { toast } from "sonner";
import { roleService } from "@/services/role";
import { getApiErrorMessage } from "@/services/api.ts";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/status-badge";
import { SkeletonTableRow } from "@/components/ui/loading-state";

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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

function RoleCreateModal(props: {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onSubmit: (payload: RoleCreateForm) => Promise<void>;
}) {
  const { open, creating, onClose, onSubmit } = props;
  const [form, setForm] = useState<RoleCreateForm>({ code: "", name: "", description: "" });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-[0_12px_38px_rgba(15,23,42,0.2)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-[16px] font-semibold text-foreground">Tạo vai trò mới</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Vai trò sẽ được lưu trực tiếp vào auth_db</p>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Code</span>
            <input
              value={form.code}
              onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value.toUpperCase().replace(/\s+/g, "_") }))}
              placeholder="VD: AUDITOR"
              className="w-full rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Tên vai trò</span>
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="VD: Thủ kho"
              className="w-full rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Mô tả</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-5">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_12px_42px_rgba(15,23,42,0.28)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-[16px] font-semibold text-foreground">Phân quyền: {role.name}</h3>
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
                  <div className="border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
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

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Shield}
          title="Quản lý vai trò"
          description="Hiển thị vai trò và quyền từ dữ liệu DB"
          iconBg="bg-gradient-to-br from-violet-100 to-purple-50 border border-violet-200/40 dark:from-violet-500/15 dark:to-purple-500/10 dark:border-violet-500/20"
          iconColor="text-violet-600 dark:text-violet-400"
        />
      </FadeItem>

      <FadeItem>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Tổng vai trò" value={roles.length} variant="primary" />
          <StatCard label="Người dùng được gán" value={totalUsers} variant="info" />
          <StatCard label="Quyền đã cấp" value={totalGrantedPermissions} variant="success" />
        </div>
      </FadeItem>

      <FadeItem>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Tìm theo code, tên, mô tả vai trò..."
            showSearchClear
            actions={
              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${viewMode === "list" ? "bg-background shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <LayoutList className="h-3.5 w-3.5" /> Danh sách
                  </button>
                  <button
                    type="button"
                    onClick={() => { setViewMode("matrix"); void loadPermissions(); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${viewMode === "matrix" ? "bg-background shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Grid3x3 className="h-3.5 w-3.5" /> Ma trận
                  </button>
                </div>
                <Button onClick={() => setShowCreateModal(true)}>
                  <Plus className="h-4 w-4" />
                  Tạo vai trò
                </Button>
              </div>
            }
          />
        </div>
      </FadeItem>

      {viewMode === "matrix" && (
        <FadeItem>
          <SectionCard noPadding>
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <p className="text-[13px] font-semibold">Ma trận Vai trò × Quyền</p>
              {loadingPermissions && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {permissions.length === 0 && !loadingPermissions ? (
              <div className="p-5 text-center text-[13px] text-muted-foreground">Chưa tải được dữ liệu quyền</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="sticky left-0 bg-muted/30 px-4 py-2.5 text-left font-semibold text-muted-foreground min-w-[200px] z-10">Module / Quyền</th>
                      {filteredRoles.map((role) => (
                        <th key={role.id} className="px-3 py-2.5 text-center font-semibold text-muted-foreground min-w-[90px]">
                          <div className="truncate max-w-[80px] mx-auto">{role.code}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(
                      permissions.reduce<Record<string, PermissionRow[]>>((acc, p) => {
                        if (!acc[p.module_name]) acc[p.module_name] = [];
                        acc[p.module_name].push(p);
                        return acc;
                      }, {})
                    ).map(([moduleName, modulePerms]) => (
                      <>
                        <tr key={`module-${moduleName}`} className="bg-muted/50 border-b border-border">
                          <td colSpan={filteredRoles.length + 1} className="px-4 py-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{moduleName}</span>
                          </td>
                        </tr>
                        {modulePerms.map((perm) => (
                          <tr key={perm.id} className="border-b border-border/60 hover:bg-muted/20">
                            <td className="sticky left-0 bg-background px-4 py-2 text-[12px] text-muted-foreground">
                              {perm.action_name}
                            </td>
                            {filteredRoles.map((role) => {
                              const hasPermission = role.permissions.some((rp) => rp.id === perm.id);
                              return (
                                <td key={role.id} className="px-3 py-2 text-center">
                                  {hasPermission ? (
                                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 mx-auto" />
                                  ) : (
                                    <span className="text-muted-foreground/30">–</span>
                                  )}
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
            )}
          </SectionCard>
        </FadeItem>
      )}

      {viewMode === "list" && (
      <FadeItem>
        <SectionCard noPadding>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  "Vai trò",
                  "Code",
                  "Mô tả",
                  "Người dùng",
                  "Quyền",
                  "Hệ thống",
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
                <SkeletonTableRow columns={8} rows={5} />
              ) : filteredRoles.length === 0 ? (
                <tr>
                  <td colSpan={8}><EmptyState variant="no-data" title="Không có vai trò nào" description="Tạo vai trò mới để bắt đầu" className="py-12" /></td>
                </tr>
              ) : (
                filteredRoles.map((role) => (
                  <motion.tr key={role.id} className="border-b border-border last:border-0 hover:bg-muted/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <td className="px-5 py-3.5 text-[13px] font-semibold">{role.name}</td>
                    <td className="px-5 py-3.5 text-[12px] font-mono text-violet-700 dark:text-violet-400">{role.code}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground max-w-[280px]">{role.description || "-"}</td>
                    <td className="px-5 py-3.5 text-[13px]">{role.user_count || 0}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {(role.permissions || []).slice(0, 4).map((permission) => (
                          <span key={permission.id} className="rounded-full bg-violet-100 dark:bg-violet-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-400">
                            {permission.code}
                          </span>
                        ))}
                        {(role.permissions || []).length > 4 ? (
                          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                            +{(role.permissions || []).length - 4}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge label={role.is_system ? "SYSTEM" : "CUSTOM"} variant={role.is_system ? "amber" : "neutral"} />
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(role.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <Button variant="outline" size="sm" onClick={() => void openPermissionModal(role)}>
                        <Settings2 className="h-3.5 w-3.5" />
                        Phân quyền
                      </Button>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
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
