import { useEffect, useMemo, useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { Shield, Search, Plus, Settings2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { roleService } from "@/services/role";
import { getApiErrorMessage } from "@/services/api.ts";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";

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

  useEffect(() => {
    if (!open) {
      setForm({ code: "", name: "", description: "" });
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4">
      <div className="w-full max-w-xl rounded-xl border border-white/70 bg-card shadow-[0_12px_38px_rgba(15,23,42,0.2)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-[16px] font-semibold text-foreground">Tao role moi</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Role se duoc luu truc tiep vao auth_db</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
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
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Ten role</span>
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="VD: Thu kho"
              className="w-full rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Mo ta</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Mo ta ngan cho role"
              className="w-full resize-none rounded-lg border border-input px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            Huy
          </Button>
          <Button
            disabled={creating || !form.code.trim() || !form.name.trim()}
            onClick={() => void onSubmit(form)}
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {creating ? "Dang tao..." : "Tao role"}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-5">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-white/70 bg-card shadow-[0_12px_42px_rgba(15,23,42,0.28)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-[16px] font-semibold text-foreground">Phan quyen role: {role.name}</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Code: {role.code} · Tick de cap/thu hoi quyen va luu vao DB</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[280px] flex-1">
              <input
                value={keyword}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Tim permission theo code/module/mo ta"
                className="w-full rounded-lg border border-input bg-card py-2.5 pl-9 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/10"
              />
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
            <Button variant="outline" size="sm" onClick={onSelectAllFiltered}>
              Chon tat ca ket qua
            </Button>
            <Button variant="outline" size="sm" onClick={onClearFiltered}>
              Bo chon ket qua
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadingPermissions ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Dang tai danh sach permission...
            </div>
          ) : groupedPermissions.length === 0 ? (
            <EmptyState variant="no-results" title="Khong co permission phu hop" description="Thu doi tu khoa tim kiem" className="py-8" />
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
                        <label key={permission.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-violet-50/40">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggle(permission.id)}
                            className="mt-0.5 h-4 w-4 rounded border-input text-violet-600 focus:ring-violet-400"
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
          <p className="text-[12px] text-muted-foreground">Da chon {selected.size} permission</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Huy
            </Button>
            <Button
              disabled={saving}
              onClick={() => void onSave()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "Dang luu..." : "Luu thay doi"}
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

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await roleService.getAll();
      setRoles((response?.data || []) as RoleRow[]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach role"));
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
      toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach permission"));
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
      toast.success(`Da cap nhat permission cho role ${editingRole.code}`);
      await loadData();
      closePermissionModal();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong cap nhat duoc permission"));
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
      toast.success("Tao role thanh cong");
      setShowCreateModal(false);
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong tao duoc role"));
    } finally {
      setCreatingRole(false);
    }
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-purple-50 flex items-center justify-center border border-violet-200/40">
            <Shield className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Role Management</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">Hien thi role va permission tu du lieu DB</p>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Total Roles" value={roles.length} variant="primary" />
          <StatCard label="Users Assigned" value={totalUsers} variant="info" />
          <StatCard label="Granted Permissions" value={totalGrantedPermissions} variant="success" />
        </div>
      </FadeItem>

      <FadeItem>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Tim theo role code, ten, mo ta..."
            showSearchClear
            actions={
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4" />
                Tao role
              </Button>
            }
          />
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  "Role",
                  "Code",
                  "Description",
                  "Users",
                  "Permissions",
                  "System",
                  "Created",
                  "Actions",
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
                  <td colSpan={8} className="px-5 py-10 text-center text-[13px] text-muted-foreground">Dang tai du lieu...</td>
                </tr>
              ) : filteredRoles.length === 0 ? (
                <tr>
                  <td colSpan={8}><EmptyState variant="no-data" title="Khong co role nao" description="Tao role moi de bat dau" className="py-12" /></td>
                </tr>
              ) : (
                filteredRoles.map((role) => (
                  <motion.tr key={role.id} className="border-b border-border last:border-0 hover:bg-muted/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <td className="px-5 py-3.5 text-[13px] font-semibold">{role.name}</td>
                    <td className="px-5 py-3.5 text-[12px] font-mono text-violet-700">{role.code}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground max-w-[280px]">{role.description || "-"}</td>
                    <td className="px-5 py-3.5 text-[13px]">{role.user_count || 0}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {(role.permissions || []).slice(0, 4).map((permission) => (
                          <span key={permission.id} className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
                            {permission.code}
                          </span>
                        ))}
                        {(role.permissions || []).length > 4 ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                            +{(role.permissions || []).length - 4}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${role.is_system ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-muted-foreground"}`}>
                        {role.is_system ? "SYSTEM" : "CUSTOM"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(role.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <Button variant="outline" size="sm" onClick={() => void openPermissionModal(role)}>
                        <Settings2 className="h-3.5 w-3.5" />
                        Phan quyen
                      </Button>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </SectionCard>
      </FadeItem>

      <RoleCreateModal
        open={showCreateModal}
        creating={creatingRole}
        onClose={() => {
          if (!creatingRole) setShowCreateModal(false);
        }}
        onSubmit={handleCreateRole}
      />

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
