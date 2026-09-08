import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Boxes, Camera, ChevronRight, Check, ClipboardCheck, ClipboardList, Minus, PackageCheck, Plus, RefreshCw, ScanLine, Search, UserCheck, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { stockAuditService, type StockAudit, type StockAuditDetail, type StockAuditLine } from "@/services/stock-audit";
import { warehouseService } from "@/services/warehouse";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { authService } from "@/services/auth";
import { hasAnyRole } from "@/lib/rbac";
import { getApiErrorMessage } from "@/services/api";
import { usePackingCamera } from "@/hooks/usePackingCamera";
import { useHardwareScanner } from "@/hooks/useHardwareScanner";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { PageWrapper, FadeItem } from "../motion-utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingSpinner, SkeletonCard, SkeletonTableRow } from "@/components/ui/loading-state";
import { StatCard } from "@/components/ui/stat-card";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { getPaginationRange } from "@/lib/pagination";
import { cn } from "@/components/ui/utils";

const MANAGER_ROLES = ["ADMIN", "WAREHOUSE_MANAGER"];
const PAGE_SIZE = 10;

function statusMeta(status: string) {
  if (status === "DRAFT") return { label: "Nháp", variant: "neutral" as const };
  if (status === "IN_PROGRESS") return { label: "Đang kiểm", variant: "primary" as const };
  if (status === "SUBMITTED") return { label: "Chờ duyệt", variant: "warning" as const };
  if (status === "COMPLETED") return { label: "Hoàn tất", variant: "success" as const };
  if (status === "CANCELLED") return { label: "Đã hủy", variant: "danger" as const };
  return { label: status, variant: "neutral" as const };
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN");
}

export function StockAuditsPage() {
  const { id } = useParams();
  return id ? <StockAuditDetailView id={id} /> : <StockAuditListView />;
}

function StockAuditListView() {
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();
  const isManager = hasAnyRole(currentUser, MANAGER_ROLES);

  const [audits, setAudits] = useState<StockAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [warehouses, setWarehouses] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await stockAuditService.getAll();
      setAudits(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách phiếu kiểm kê"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isManager) return;
    warehouseService.getReceivingWarehouses()
      .then((data) => setWarehouses(data as Array<{ id: string; code: string; name: string }>))
      .catch(() => {});
  }, [isManager]);

  const filtered = useMemo(() => {
    const byStatus = statusFilter === "ALL" ? audits : audits.filter((a) => a.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter(
      (a) =>
        a.audit_number.toLowerCase().includes(q) ||
        (a.warehouse_name || "").toLowerCase().includes(q) ||
        (a.warehouse_code || "").toLowerCase().includes(q),
    );
  }, [audits, statusFilter, search]);

  const counts = useMemo(() => ({
    total: audits.length,
    inProgress: audits.filter((a) => ["DRAFT", "IN_PROGRESS"].includes(a.status)).length,
    submitted: audits.filter((a) => a.status === "SUBMITTED").length,
    completed: audits.filter((a) => a.status === "COMPLETED").length,
  }), [audits]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const handleCreate = async () => {
    if (!selectedWarehouseId) {
      toast.error("Vui lòng chọn kho cần kiểm kê");
      return;
    }
    setCreating(true);
    try {
      const response = await stockAuditService.create({ warehouse_id: selectedWarehouseId, note: note || undefined });
      toast.success(`Đã tạo phiếu kiểm kê ${response.data.audit_number}`);
      setNote("");
      setSelectedWarehouseId("");
      void navigate(`/stock-audits/${response.data.id}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể tạo phiếu kiểm kê"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <div className="rounded-2xl border border-border bg-gradient-to-br from-amber-50 via-card to-card dark:from-amber-500/[0.07] dark:via-card dark:to-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
          <PageHeader
            icon={ClipboardList}
            title="Kiểm kê kho"
            description="Đối chiếu tồn kho thực tế với hệ thống, phát hiện và điều chỉnh chênh lệch"
            iconBg="bg-gradient-to-br from-amber-100 to-orange-50 dark:from-amber-500/20 dark:to-orange-500/10"
            iconColor="text-amber-600 dark:text-amber-400"
            actions={
              <Button variant="outline" size="sm" onClick={() => void load()} loading={loading}>
                <RefreshCw className="h-3.5 w-3.5" /> Làm mới
              </Button>
            }
          />
        </div>
      </FadeItem>

      {!loading && audits.length > 0 && (
        <FadeItem>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { key: "ALL", label: "Tổng phiếu", value: counts.total, icon: Boxes, variant: "default" as const },
              { key: "IN_PROGRESS", label: "Đang kiểm", value: counts.inProgress, icon: ClipboardList, variant: "info" as const },
              { key: "SUBMITTED", label: "Chờ duyệt", value: counts.submitted, icon: AlertTriangle, variant: "warning" as const },
              { key: "COMPLETED", label: "Đã hoàn tất", value: counts.completed, icon: PackageCheck, variant: "success" as const },
            ].map((card) => {
              const isActive = statusFilter === card.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => setStatusFilter(isActive ? "ALL" : card.key)}
                  aria-pressed={isActive}
                  className="relative w-full rounded-xl text-left transition-all cursor-pointer active:scale-[0.97]"
                >
                  <StatCard label={card.label} value={card.value} icon={card.icon} variant={card.variant} />
                  {isActive && (
                    <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </FadeItem>
      )}

      {isManager && (
        <FadeItem>
          <SectionCard title="Tạo phiếu kiểm kê mới" icon={ClipboardCheck}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Kho cần kiểm kê</label>
                <Select value={selectedWarehouseId || "none"} onValueChange={(v) => setSelectedWarehouseId(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chọn kho" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Ghi chú (không bắt buộc)</label>
                <Input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Kiểm kê định kỳ quý 3" className="h-auto py-2" />
              </div>
              <Button onClick={() => void handleCreate()} loading={creating} className="shrink-0">
                <ClipboardCheck className="h-3.5 w-3.5" /> Tạo phiếu kiểm kê
              </Button>
            </div>
          </SectionCard>
        </FadeItem>
      )}

      <FadeItem>
        <SectionCard noPadding>
          {!loading && audits.length > 0 && (
            <div className="border-b border-border p-4">
              <div className="relative max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm theo số phiếu hoặc kho..."
                  aria-label="Tìm kiếm phiếu kiểm kê"
                  className="h-10 pl-9"
                />
              </div>
            </div>
          )}

          {/* Mobile cards (< md) */}
          {loading ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="md:hidden">
              {audits.length === 0 ? (
                <EmptyState variant="no-data" title="Chưa có phiếu kiểm kê" description="Tạo phiếu kiểm kê để bắt đầu đối chiếu tồn kho." className="py-12" />
              ) : (
                <EmptyState variant="no-results" title="Không tìm thấy phiếu nào" description="Thử đổi từ khóa tìm kiếm hoặc bộ lọc trạng thái." className="py-12" />
              )}
            </div>
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
              {paged.map((audit) => {
                const meta = statusMeta(audit.status);
                return (
                  <NavLink key={audit.id} to={`/stock-audits/${audit.id}`} className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/20 active:scale-[0.99]">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold text-indigo-600 dark:text-indigo-400">{audit.audit_number}</p>
                        <StatusBadge label={meta.label} variant={meta.variant} dot />
                      </div>
                      <p className="truncate text-[12px] text-muted-foreground">{audit.warehouse_name || audit.warehouse_code || "-"}</p>
                      <div className="mt-1 flex items-center justify-between text-[12px] text-muted-foreground">
                        <span>{audit.line_count ?? 0} mục</span>
                        <span>{formatDate(audit.created_at)}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  </NavLink>
                );
              })}
            </div>
          )}

          {/* Desktop table (>= md) */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {["Phiếu kiểm kê", "Kho", "Số mục", "Trạng thái", "Tạo lúc", ""].map((heading) => (
                    <TableHead key={heading} className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{heading}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonTableRow columns={6} rows={4} />
                ) : filtered.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="whitespace-normal">
                      {audits.length === 0 ? (
                        <EmptyState variant="no-data" title="Chưa có phiếu kiểm kê" description="Tạo phiếu kiểm kê để bắt đầu đối chiếu tồn kho." className="py-12" />
                      ) : (
                        <EmptyState variant="no-results" title="Không tìm thấy phiếu nào" description="Thử đổi từ khóa tìm kiếm hoặc bộ lọc trạng thái." className="py-12" />
                      )}
                    </TableCell>
                  </TableRow>
                ) : paged.map((audit) => {
                  const meta = statusMeta(audit.status);
                  return (
                    <TableRow
                      key={audit.id}
                      onClick={() => navigate(`/stock-audits/${audit.id}`)}
                      className="cursor-pointer"
                    >
                      <TableCell className="px-5 py-3.5">
                        <NavLink
                          to={`/stock-audits/${audit.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                        >
                          {audit.audit_number}
                        </NavLink>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-[13px]">{audit.warehouse_name || audit.warehouse_code || "-"}</TableCell>
                      <TableCell className="px-5 py-3.5 text-[13px] text-muted-foreground">{audit.line_count ?? 0}</TableCell>
                      <TableCell className="px-5 py-3.5"><StatusBadge label={meta.label} variant={meta.variant} dot /></TableCell>
                      <TableCell className="px-5 py-3.5 text-[12px] text-muted-foreground whitespace-nowrap">{formatDate(audit.created_at)}</TableCell>
                      <TableCell className="px-5 py-3.5 text-right">
                        <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/60" aria-label="Xem chi tiết" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {!loading && filtered.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-muted-foreground">
                Hiển thị <span className="font-medium text-foreground">{paged.length}</span> / {filtered.length} phiếu
              </p>
              {totalPages > 1 && (
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((current) => Math.max(1, current - 1));
                        }}
                        className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
                      />
                    </PaginationItem>
                    {getPaginationRange(page, totalPages).map((item) => (
                      <PaginationItem key={item}>
                        {typeof item === "number" ? (
                          <PaginationLink
                            isActive={item === page}
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
                        className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}

function StockAuditDetailView({ id }: { id: string }) {
  const currentUser = authService.getCurrentUser();
  const isManager = hasAnyRole(currentUser, MANAGER_ROLES);

  const [audit, setAudit] = useState<StockAuditDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staffOptions, setStaffOptions] = useState<WarehouseStaffOption[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [localCounts, setLocalCounts] = useState<Record<string, string>>({});
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await stockAuditService.getById(id);
      setAudit(response.data);
      setLocalCounts(
        Object.fromEntries(response.data.items.map((item) => [item.id, item.counted_qty === null ? "" : String(item.counted_qty)])),
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được phiếu kiểm kê"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { setSelectedLineId(null); void load(); }, [load]);

  useEffect(() => {
    if (!isManager) return;
    userService.getWarehouseStaff()
      .then((res) => setStaffOptions(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, [isManager]);

  const isAssignedToMe = audit?.assigned_to_user_id && currentUser?.id === audit.assigned_to_user_id;
  const canCount = audit?.status === "IN_PROGRESS" && (isManager || isAssignedToMe);
  const allCounted = audit ? audit.items.every((item) => item.counted_qty !== null) : false;

  const handleAssign = async () => {
    if (!audit || !selectedStaffId) {
      toast.error("Vui lòng chọn nhân viên kho");
      return;
    }
    setSaving(true);
    try {
      await stockAuditService.assign(audit.id, selectedStaffId);
      toast.success("Đã giao phiếu kiểm kê cho nhân viên kho");
      void load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể giao phiếu kiểm kê"));
    } finally {
      setSaving(false);
    }
  };

  const applyLineCount = async (item: StockAuditLine, newQty: number) => {
    if (!audit) return;
    try {
      const response = await stockAuditService.submitLineCount(audit.id, item.id, newQty);
      setLocalCounts((current) => ({ ...current, [item.id]: String(newQty) }));
      setAudit((current) =>
        current
          ? { ...current, items: current.items.map((line) => (line.id === item.id ? response.data : line)) }
          : current,
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể lưu số lượng đếm được"));
    }
  };

  const handleLineBlur = (item: StockAuditLine) => {
    const raw = localCounts[item.id] ?? "";
    if (raw === "") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed === item.counted_qty) return;
    void applyLineCount(item, Math.trunc(parsed));
  };

  // +/- buttons for quick manual adjustment alongside scanning — same "current draft or last
  // saved count" base as handleScanCode, so stepping and scanning never fight over the value.
  const adjustLineCount = (item: StockAuditLine, delta: number) => {
    const currentQty = Number(localCounts[item.id] ?? item.counted_qty ?? 0) || 0;
    void applyLineCount(item, Math.max(0, currentQty + delta));
  };

  // Every scan source (hardware scanner, camera auto-scan, manual modal) funnels through here.
  // A scanned SKU/ISBN increments that line's counted_qty by 1 — mirrors a real cycle-count:
  // walk the aisle, scan each physical copy, the count climbs on its own.
  const handleScanCode = (code: string) => {
    if (!audit) return;
    const trimmed = code.trim();
    const matches = audit.items.filter((item) => item.sku === trimmed || item.isbn13 === trimmed);

    if (matches.length === 0) {
      toast.error(`Mã "${trimmed}" không thuộc phiếu kiểm kê này`);
      return;
    }

    let target = matches.find((m) => m.id === selectedLineId);
    if (!target) {
      target = matches.length === 1
        ? matches[0]
        : matches.find((m) => (m.counted_qty ?? 0) < m.expected_qty) ?? matches[0];
      if (matches.length > 1) {
        toast.info(`"${target.title || target.sku}" trùng ở ${matches.length} vị trí — đã cộng vào ${target.location_code || "vị trí đầu"}. Bấm chọn dòng khác nếu cần.`);
      }
    }

    const currentQty = Number(localCounts[target.id] ?? target.counted_qty ?? 0) || 0;
    void applyLineCount(target, currentQty + 1);
  };

  const handleSubmitAudit = async () => {
    if (!audit) return;
    setSaving(true);
    try {
      await stockAuditService.submit(audit.id);
      toast.success("Đã nộp phiếu kiểm kê, chờ quản lý duyệt");
      void load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể nộp phiếu kiểm kê"));
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!audit) return;
    setSaving(true);
    try {
      const response = await stockAuditService.approve(audit.id);
      toast.success(`Đã duyệt phiếu, điều chỉnh ${response.data.adjustments_posted} mục tồn kho`);
      void load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể duyệt phiếu kiểm kê"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!audit) return;
    setSaving(true);
    try {
      await stockAuditService.cancel(audit.id);
      toast.success("Đã hủy phiếu kiểm kê");
      void load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể hủy phiếu kiểm kê"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto flex justify-center py-16">
        <LoadingSpinner message="Đang tải..." />
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <EmptyState variant="no-data" title="Không tìm thấy phiếu kiểm kê" description="Phiếu này có thể đã bị xóa." />
      </div>
    );
  }

  const meta = statusMeta(audit.status);
  const steps: WorkflowStep[] = [
    { id: "create", label: "Tạo phiếu", icon: ClipboardList, status: "completed" },
    { id: "assign", label: "Giao việc", icon: UserCheck, status: audit.assigned_to_user_id ? "completed" : audit.status === "DRAFT" ? "active" : "completed" },
    { id: "count", label: "Đang kiểm", icon: Boxes, status: audit.status === "IN_PROGRESS" ? "active" : ["SUBMITTED", "COMPLETED"].includes(audit.status) ? "completed" : "pending" },
    { id: "review", label: "Chờ duyệt", icon: AlertTriangle, status: audit.status === "SUBMITTED" ? "active" : audit.status === "COMPLETED" ? "completed" : "pending" },
    { id: "done", label: "Hoàn tất", icon: PackageCheck, status: audit.status === "COMPLETED" ? "completed" : "pending" },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="rounded-xl border border-border bg-gradient-to-br from-amber-50 via-card to-card dark:from-amber-500/[0.07] dark:via-card dark:to-card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <Button variant="outline" size="sm" asChild>
              <NavLink to="/stock-audits">
                <ArrowLeft className="h-3.5 w-3.5" /> Quay lại
              </NavLink>
            </Button>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-amber-100 to-orange-50 dark:from-amber-500/20 dark:to-orange-500/10">
              <Warehouse className="w-[18px] h-[18px] text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[15px] font-semibold tracking-tight">{audit.audit_number}</h1>
                <StatusBadge label={meta.label} variant={meta.variant} dot />
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {audit.warehouse_name || audit.warehouse_code || "-"} · {audit.items.length} mục kiểm kê
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} loading={saving}>
            <RefreshCw className="h-3.5 w-3.5" /> Làm mới
          </Button>
        </div>
      </div>

      <SectionCard noPadding>
        <div className="p-5">
          <WorkflowStepper steps={steps} />
        </div>
      </SectionCard>

      {isManager && audit.status === "DRAFT" && (
        <SectionCard title="Giao phiếu kiểm kê cho nhân viên kho" icon={UserCheck}>
          <div className="flex flex-col gap-3 p-1 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Nhân viên kho thực hiện</label>
              <Select value={selectedStaffId || "none"} onValueChange={(v) => setSelectedStaffId(v === "none" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn nhân viên kho" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((staff) => (
                    <SelectItem key={staff.id} value={staff.id}>{staff.full_name || staff.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void handleAssign()} loading={saving} disabled={!selectedStaffId} className="shrink-0">
              <UserCheck className="h-4 w-4" /> Giao việc
            </Button>
          </div>
        </SectionCard>
      )}

      {canCount && <ScanCountPanel onScan={handleScanCode} />}

      <SectionCard title="Danh sách mục kiểm kê" noPadding>
        <div className="divide-y divide-border">
          {audit.items.map((item) => {
            const hasVariance = item.variance_qty !== null && item.variance_qty !== 0;
            const varianceColor = item.variance_qty === null
              ? "text-muted-foreground"
              : item.variance_qty === 0
                ? "text-emerald-600 dark:text-emerald-400"
                : item.variance_qty > 0
                  ? "text-sky-600 dark:text-sky-400"
                  : "text-red-500 dark:text-red-400";
            const isSelected = canCount && selectedLineId === item.id;
            return (
              <div
                key={item.id}
                onClick={canCount ? () => setSelectedLineId(item.id) : undefined}
                className={`flex flex-col gap-3 px-5 py-3.5 transition-colors sm:flex-row sm:items-center sm:gap-4 ${canCount ? "cursor-pointer hover:bg-muted/30" : ""} ${isSelected ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground truncate">{item.title || item.sku || "-"}</p>
                  <p className="text-[11px] font-mono text-muted-foreground">{item.sku || item.isbn13 || "-"} · Vị trí {item.location_code || "-"}</p>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-4 text-[12px] sm:justify-end">
                  <div className="text-center">
                    <p className="text-muted-foreground">Hệ thống</p>
                    <p className="font-mono font-semibold">{item.expected_qty}</p>
                  </div>
                  <div className="text-center">
                    <p className="mb-1 text-muted-foreground">Đếm được</p>
                    {canCount ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => adjustLineCount(item, -1)}
                          aria-label="Giảm 1"
                          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted active:scale-95"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={localCounts[item.id] ?? ""}
                          onChange={(e) => setLocalCounts((current) => ({ ...current, [item.id]: e.target.value }))}
                          onBlur={() => void handleLineBlur(item)}
                          className="h-11 w-16 text-center text-[14px]"
                        />
                        <button
                          type="button"
                          onClick={() => adjustLineCount(item, 1)}
                          aria-label="Tăng 1"
                          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted active:scale-95"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <p className="font-mono font-semibold">{item.counted_qty ?? "-"}</p>
                    )}
                  </div>
                  <div className="w-16 text-center">
                    <p className="text-muted-foreground">Chênh lệch</p>
                    <p className={`flex items-center justify-center gap-0.5 font-mono font-semibold ${varianceColor}`}>
                      {item.variance_qty !== null && item.variance_qty > 0 && <ArrowUp className="h-3 w-3" />}
                      {item.variance_qty !== null && item.variance_qty < 0 && <ArrowDown className="h-3 w-3" />}
                      {item.variance_qty === null ? "-" : item.variance_qty > 0 ? `+${item.variance_qty}` : item.variance_qty}
                    </p>
                  </div>
                  {hasVariance && item.adjustment_posted && (
                    <StatusBadge label="Đã điều chỉnh" variant="success" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {canCount && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <p className="text-[12px] text-muted-foreground">
            {allCounted ? "Đã đếm đủ tất cả mục. Nộp phiếu để quản lý duyệt." : "Cần nhập số lượng đếm được cho tất cả mục trước khi nộp."}
          </p>
          <Button onClick={() => void handleSubmitAudit()} disabled={!allCounted} loading={saving} className="shrink-0">
            <ClipboardCheck className="h-4 w-4" /> Nộp phiếu kiểm kê
          </Button>
        </div>
      )}

      {isManager && audit.status === "SUBMITTED" && (
        <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border border-border bg-card/95 p-5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-muted-foreground">
            {audit.items.some((i) => i.variance_qty)
              ? "Có chênh lệch giữa số đếm và hệ thống. Duyệt để tự động điều chỉnh tồn kho."
              : "Không có chênh lệch nào."}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void handleCancel()} loading={saving}>Hủy phiếu</Button>
            <Button onClick={() => void handleApprove()} loading={saving}>
              <Check className="h-4 w-4" /> Duyệt & điều chỉnh tồn kho
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mounted only while `canCount` — so viewing a read-only (already-submitted/completed) audit
 *  never prompts for camera access. Every scan source funnels into the same `onScan` callback. */
function ScanCountPanel({ onScan }: { onScan: (code: string) => void }) {
  const { videoRef, isLive, cameraError, setBarcodeHandler } = usePackingCamera();
  const [isManualScanOpen, setIsManualScanOpen] = useState(false);

  useEffect(() => {
    setBarcodeHandler(onScan);
    return () => setBarcodeHandler(null);
  }, [setBarcodeHandler, onScan]);

  useHardwareScanner(onScan);

  return (
    <SectionCard noPadding>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-lg border border-border bg-slate-900">
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            {isLive && (
              <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
              </span>
            )}
            {!isLive && (
              <div className="absolute inset-0 flex items-center justify-center px-1 text-center text-[10px] leading-tight text-slate-300">
                {cameraError ? "Không có camera" : "Đang mở..."}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <ScanLine className="h-3.5 w-3.5 text-primary" /> Quét mã để đếm
            </p>
            <p className="text-[11px] text-muted-foreground">
              Máy quét cầm tay, camera tự động, hoặc quét thủ công — mỗi lần quét cộng thêm 1 vào dòng tương ứng.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setIsManualScanOpen(true)} className="shrink-0">
          <Camera className="h-3.5 w-3.5" /> Quét thủ công
        </Button>
      </div>

      <BarcodeScanModal
        isOpen={isManualScanOpen}
        onClose={() => setIsManualScanOpen(false)}
        onDetected={(code) => {
          setIsManualScanOpen(false);
          onScan(code);
        }}
        title="Quét mã để đếm"
      />
    </SectionCard>
  );
}
