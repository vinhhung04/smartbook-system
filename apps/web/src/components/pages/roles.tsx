import { useEffect, useMemo, useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { Shield, Search } from "lucide-react";
import { toast } from "sonner";
import { roleService } from "@/services/role";
import { getApiErrorMessage } from "@/services/api.ts";

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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

export function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-violet-100 to-purple-50 flex items-center justify-center border border-violet-200/40">
            <Shield className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="tracking-[-0.02em]">Role Management</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">Hien thi role va permission tu du lieu DB</p>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-[12px] border border-violet-100 bg-gradient-to-br from-violet-50 to-purple-50/60 p-4">
            <p className="text-[11px] text-violet-700">Total Roles</p>
            <p className="mt-1 text-[28px] text-violet-700" style={{ fontWeight: 700 }}>{roles.length}</p>
          </div>
          <div className="rounded-[12px] border border-blue-100 bg-gradient-to-br from-blue-50 to-cyan-50/60 p-4">
            <p className="text-[11px] text-blue-700">Users Assigned</p>
            <p className="mt-1 text-[28px] text-blue-700" style={{ fontWeight: 700 }}>{totalUsers}</p>
          </div>
          <div className="rounded-[12px] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-teal-50/60 p-4">
            <p className="text-[11px] text-emerald-700">Granted Permissions</p>
            <p className="mt-1 text-[28px] text-emerald-700" style={{ fontWeight: 700 }}>{totalGrantedPermissions}</p>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tim theo role code, ten, mo ta..."
            className="w-full rounded-[10px] border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-[13px] outline-none focus:border-violet-300 focus:ring-[3px] focus:ring-violet-500/10"
          />
        </div>
      </FadeItem>

      <FadeItem>
        <div className="overflow-hidden rounded-[16px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-gradient-to-r from-violet-50/40 to-transparent">
                {[
                  "Role",
                  "Code",
                  "Description",
                  "Users",
                  "Permissions",
                  "System",
                  "Created",
                ].map((header) => (
                  <th key={header} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-[13px] text-slate-400">Dang tai du lieu...</td>
                </tr>
              ) : filteredRoles.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-[13px] text-slate-400">Khong co role nao</td>
                </tr>
              ) : (
                filteredRoles.map((role) => (
                  <motion.tr key={role.id} className="border-b border-slate-50 last:border-0 hover:bg-violet-50/20" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <td className="px-5 py-3.5 text-[13px] font-semibold">{role.name}</td>
                    <td className="px-5 py-3.5 text-[12px] font-mono text-violet-700">{role.code}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-500 max-w-[280px]">{role.description || "-"}</td>
                    <td className="px-5 py-3.5 text-[13px]">{role.user_count || 0}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {(role.permissions || []).slice(0, 4).map((permission) => (
                          <span key={permission.id} className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
                            {permission.code}
                          </span>
                        ))}
                        {(role.permissions || []).length > 4 ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                            +{(role.permissions || []).length - 4}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${role.is_system ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>
                        {role.is_system ? "SYSTEM" : "CUSTOM"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-500">{formatDate(role.created_at)}</td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
