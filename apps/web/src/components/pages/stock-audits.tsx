import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { ArrowLeft, Camera, Check, ChevronRight, ClipboardCheck, ClipboardList, Minus, Plus, RefreshCw, ScanLine, UserCheck } from "lucide-react";
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
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/loading-state";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FilterBar } from "@/components/ui/filter-bar";
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

// Ledger dates: sortable, aligned in a column.
function formatShortDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** A variance is a signal only when it is not zero: missing copies in the negative colour, surplus in amber. */
function varianceText(value: number | null) {
  if (value === null) return { text: "-", className: "text-muted-foreground" };
  if (value === 0) return { text: "0", className: "text-muted-foreground" };
  return value > 0
    ? { text: `+${value}`, className: "font-semibold text-amber-800 dark:text-amber-300" }
    : { text: `−${Math.abs(value)}`, className: "font-semibold text-red-700 dark:text-red-400" };
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
  const [showCreate, setShowCreate] = useState(false);
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
    const byStatus = statusFilter === "ALL"
      ? audits
      : statusFilter === "IN_PROGRESS"
        ? audits.filter((a) => ["DRAFT", "IN_PROGRESS"].includes(a.status))
        : audits.filter((a) => a.status === statusFilter);
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
    cancelled: audits.filter((a) => a.status === "CANCELLED").length,
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

  // The count cards are the status filter (taste sheet: "count cards that filter").
  const statusCards = [
    { value: "ALL", label: "Tất cả phiếu", count: counts.total },
    { value: "IN_PROGRESS", label: "Đang kiểm", count: counts.inProgress },
    { value: "SUBMITTED", label: "Chờ duyệt", count: counts.submitted },
    { value: "COMPLETED", label: "Hoàn tất", count: counts.completed },
    ...(counts.cancelled > 0 ? [{ value: "CANCELLED", label: "Đã hủy", count: counts.cancelled }] : []),
  ];
  const lede = loading
    ? "Đối chiếu số sách đếm được trên kệ với tồn kho trên hệ thống."
    : counts.total === 0
      ? "Chưa có phiếu kiểm kê nào."
      : `${counts.total} phiếu kiểm kê: ${counts.inProgress} đang kiểm, ${counts.submitted} chờ duyệt, ${counts.completed} hoàn tất.`;
  const createOpen = isManager && (showCreate || (!loading && audits.length === 0));

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title="Kiểm kê kho"
          description={lede}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => void load()} loading={loading}>
                <RefreshCw className="h-3.5 w-3.5" /> Làm mới
              </Button>
              {isManager && (
                <Button size="sm" onClick={() => setShowCreate((open) => !open)} aria-expanded={showCreate}>
                  <Plus className="h-3.5 w-3.5" /> Tạo phiếu mới
                </Button>
              )}
            </>
          }
        />
      </FadeItem>

      {createOpen && (
        <FadeItem>
          <section aria-labelledby="create-audit-title" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="create-audit-title" className="text-[16px] font-semibold text-foreground">Tạo phiếu kiểm kê mới</h2>
            <p className="mt-0.5 text-[14px] text-muted-foreground">Phiếu lấy toàn bộ tồn kho hiện có của kho được chọn làm số liệu hệ thống để đối chiếu.</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="audit-warehouse" className="mb-1.5 block text-[14px] font-medium text-foreground">Kho cần kiểm kê</label>
                <Select value={selectedWarehouseId} onValueChange={(v) => setSelectedWarehouseId(v === "none" ? "" : v)}>
                  <SelectTrigger id="audit-warehouse" className="w-full">
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
                <label htmlFor="audit-note" className="mb-1.5 block text-[14px] font-medium text-foreground">Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span></label>
                <Input id="audit-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: kiểm kê định kỳ quý 3" className="h-9" />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {showCreate && (
                  <Button variant="ghost" onClick={() => setShowCreate(false)}>Hủy</Button>
                )}
                <Button onClick={() => void handleCreate()} loading={creating}>
                  <ClipboardCheck className="h-3.5 w-3.5" /> Tạo phiếu kiểm kê
                </Button>
              </div>
            </div>
          </section>
        </FadeItem>
      )}

      {!loading && audits.length > 0 && (
        <FadeItem>
          <div role="group" aria-label="Lọc theo trạng thái" className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] sm:overflow-visible sm:pb-0">
            {statusCards.map((card) => {
              const active = statusFilter === card.value;
              return (
                <button
                  key={card.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(card.value)}
                  className={cn(
                    "min-w-[8.5rem] shrink-0 rounded-xl border bg-card px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-w-0",
                    active ? "border-primary/60 bg-primary/[0.06] ring-[0.5px] ring-primary/60" : "border-border hover:border-foreground/25",
                  )}
                >
                  <span className="block text-[13px] text-muted-foreground">{card.label}</span>
                  <span className="block font-serif text-[20px] font-semibold leading-tight tabular-nums text-foreground">{card.count}</span>
                </button>
              );
            })}
          </div>
        </FadeItem>
      )}

      <FadeItem>
        <section aria-labelledby="audit-list-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
            <h2 id="audit-list-title" className="text-[16px] font-semibold text-foreground">
              {statusCards.find((c) => c.value === statusFilter)?.label ?? "Phiếu kiểm kê"}
            </h2>
            {!loading && audits.length > 0 && (
              <div className="w-full @xl:w-auto @xl:min-w-[18rem]">
                <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Số phiếu hoặc kho" showSearchClear />
              </div>
            )}
          </div>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {[
                  { label: "Phiếu kiểm kê", className: "pl-5" },
                  { label: "Trạng thái", className: "hidden w-[140px] @xl:table-cell" },
                  { label: "Số mục", className: "hidden w-[90px] text-right @2xl:table-cell" },
                  { label: "Tạo ngày", className: "hidden w-[130px] text-right @3xl:table-cell" },
                  { label: "", className: "w-[48px] pr-5" },
                ].map((heading, index) => (
                  <TableHead key={index} className={cn("px-3 text-[12px] font-normal text-muted-foreground", heading.className)}>
                    {heading.label || <span className="sr-only">Mở phiếu</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell className="py-3.5 pl-5"><Skeleton className="h-4 w-56 max-w-full" /><Skeleton className="mt-1.5 h-3 w-32" /></TableCell>
                    <TableCell className="hidden @xl:table-cell"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell className="hidden @2xl:table-cell"><Skeleton className="ml-auto h-4 w-6" /></TableCell>
                    <TableCell className="hidden @3xl:table-cell"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                    <TableCell />
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="whitespace-normal">
                    {audits.length === 0 ? (
                      <EmptyState variant="no-data" title="Chưa có phiếu kiểm kê" description={isManager ? "Tạo phiếu ở trên để bắt đầu đối chiếu tồn kho." : "Quản lý kho sẽ giao phiếu kiểm kê cho bạn tại đây."} className="py-12" />
                    ) : (
                      <EmptyState variant="no-results" title="Không tìm thấy phiếu nào" description="Thử đổi từ khóa hoặc trạng thái." className="py-12" />
                    )}
                  </TableCell>
                </TableRow>
              ) : paged.map((audit) => {
                const meta = statusMeta(audit.status);
                return (
                  <TableRow
                    key={audit.id}
                    onClick={() => navigate(`/stock-audits/${audit.id}`)}
                    className="cursor-pointer hover:bg-muted/40"
                  >
                    <TableCell className="whitespace-normal py-3.5 pl-5 pr-3">
                      <NavLink
                        to={`/stock-audits/${audit.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate rounded font-mono text-[14px] font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {audit.audit_number}
                      </NavLink>
                      <p className="mt-0.5 truncate text-[13px] text-muted-foreground" title={audit.warehouse_name || audit.warehouse_code || undefined}>
                        {audit.warehouse_name || audit.warehouse_code || "-"}
                        <span className="@2xl:hidden">, {audit.line_count ?? 0} mục</span>
                        <span className="@3xl:hidden">, tạo {formatShortDate(audit.created_at)}</span>
                      </p>
                      <div className="mt-1.5 @xl:hidden">
                        <StatusBadge label={meta.label} variant={meta.variant} dot />
                      </div>
                    </TableCell>
                    <TableCell className="hidden px-3 py-3.5 @xl:table-cell"><StatusBadge label={meta.label} variant={meta.variant} dot /></TableCell>
                    <TableCell className="hidden px-3 py-3.5 text-right text-[14px] tabular-nums text-foreground @2xl:table-cell">{audit.line_count ?? 0}</TableCell>
                    <TableCell className="hidden px-3 py-3.5 text-right text-[13px] tabular-nums text-muted-foreground @3xl:table-cell" title={formatDate(audit.created_at)}>{formatShortDate(audit.created_at)}</TableCell>
                    <TableCell className="py-3.5 pl-3 pr-5 text-right">
                      <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {!loading && filtered.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-muted-foreground" aria-live="polite">
                {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + paged.length} trong {filtered.length} phiếu
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
        </section>
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
    // The final layout with each value as a flat grey bar at its real size.
    return (
      <PageWrapper className="space-y-5">
        <Skeleton className="h-8 w-40" />
        <div className="rounded-2xl border border-border bg-card p-5"><Skeleton className="h-6 w-72 max-w-full" /><Skeleton className="mt-2 h-4 w-56 max-w-full" /></div>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="bg-card p-5"><Skeleton className="h-3.5 w-20" /><Skeleton className="mt-2 h-6 w-24" /></div>)}
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      </PageWrapper>
    );
  }

  if (!audit) {
    return (
      <PageWrapper className="space-y-5">
        <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
          <NavLink to="/stock-audits"><ArrowLeft className="h-4 w-4" /> Phiếu kiểm kê</NavLink>
        </Button>
        <EmptyState variant="no-data" title="Không tìm thấy phiếu kiểm kê" description="Phiếu này có thể đã bị xóa." />
      </PageWrapper>
    );
  }

  const meta = statusMeta(audit.status);
  // Same conditions the previous workflow stepper used, shown as one line of words.
  const steps: Array<{ id: string; label: string; state: "done" | "active" | "pending" }> = [
    { id: "create", label: "Tạo phiếu", state: "done" },
    { id: "assign", label: "Giao việc", state: audit.assigned_to_user_id ? "done" : audit.status === "DRAFT" ? "active" : "done" },
    { id: "count", label: "Đang kiểm", state: audit.status === "IN_PROGRESS" ? "active" : ["SUBMITTED", "COMPLETED"].includes(audit.status) ? "done" : "pending" },
    { id: "review", label: "Chờ duyệt", state: audit.status === "SUBMITTED" ? "active" : audit.status === "COMPLETED" ? "done" : "pending" },
    { id: "done", label: "Hoàn tất", state: audit.status === "COMPLETED" ? "done" : "pending" },
  ];
  const total = audit.items.length;
  const countedLines = audit.items.filter((item) => item.counted_qty !== null).length;
  const countedPct = total > 0 ? Math.round((countedLines / total) * 100) : 0;
  const varianceLines = audit.items.filter((item) => item.variance_qty !== null && item.variance_qty !== 0);
  const missingQty = varianceLines.reduce((sum, item) => sum + Math.max(0, -(item.variance_qty ?? 0)), 0);
  const surplusQty = varianceLines.reduce((sum, item) => sum + Math.max(0, item.variance_qty ?? 0), 0);
  const postedLines = audit.items.filter((item) => item.adjustment_posted && item.variance_qty).length;
  const actionBar = "sticky bottom-4 z-10 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_4px_16px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between";

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
          <NavLink to="/stock-audits"><ArrowLeft className="h-4 w-4" /> Phiếu kiểm kê</NavLink>
        </Button>
        <section aria-labelledby="audit-title" className="mt-2 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 id="audit-title" className="break-all font-mono text-[22px] font-semibold tracking-tight text-foreground">{audit.audit_number}</h1>
                <StatusBadge label={meta.label} variant={meta.variant} dot />
              </div>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {audit.warehouse_name || audit.warehouse_code || "-"}, {total} mục, tạo ngày {formatShortDate(audit.created_at)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} loading={saving}>
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </Button>
          </div>
          <ol aria-label="Tiến trình phiếu" className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-4 text-[13px]">
            {steps.map((step, index) => (
              <li key={step.id} aria-current={step.state === "active" ? "step" : undefined} className="flex items-center gap-2">
                {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />}
                <span className={cn(
                  "inline-flex items-center gap-1",
                  step.state === "active" ? "font-semibold text-foreground" : step.state === "done" ? "text-muted-foreground" : "text-muted-foreground/70",
                )}>
                  {step.state === "done" && <Check className="h-3.5 w-3.5" aria-label="Xong" />}
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </FadeItem>

      {isManager && audit.status === "DRAFT" && (
        <FadeItem>
          <section aria-labelledby="assign-title" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="assign-title" className="text-[16px] font-semibold text-foreground">Giao phiếu cho nhân viên kho</h2>
            <p className="mt-0.5 text-[14px] text-muted-foreground">Nhân viên được giao sẽ quét và đếm từng mục trên kệ.</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 sm:max-w-sm">
                <label htmlFor="audit-assignee" className="mb-1.5 block text-[14px] font-medium text-foreground">Nhân viên kho thực hiện</label>
                <Select value={selectedStaffId} onValueChange={(v) => setSelectedStaffId(v === "none" ? "" : v)}>
                  <SelectTrigger id="audit-assignee" className="w-full">
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
          </section>
        </FadeItem>
      )}

      <FadeItem>
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
          <div className="bg-card p-5">
            <dt className="text-[13px] text-muted-foreground">Đã đếm</dt>
            <dd className="mt-0.5 font-serif text-[24px] font-semibold leading-tight tabular-nums text-foreground">
              {countedLines}<span className="font-sans text-[14px] font-normal text-muted-foreground"> / {total} mục</span>
            </dd>
            <Progress value={countedPct} className="mt-2.5 h-1.5" aria-label={`Đã đếm ${countedPct}% số mục`} />
          </div>
          <div className="bg-card p-5">
            <dt className="text-[13px] text-muted-foreground">Chênh lệch</dt>
            <dd className="mt-0.5 font-serif text-[24px] font-semibold leading-tight tabular-nums text-foreground">
              {varianceLines.length}<span className="font-sans text-[14px] font-normal text-muted-foreground"> mục</span>
            </dd>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {countedLines === 0
                ? "Chưa có số đếm."
                : varianceLines.length === 0
                  ? "Khớp với hệ thống ở mọi mục đã đếm."
                  : <>Thiếu <span className={cn("tabular-nums", missingQty > 0 && "font-semibold text-red-700 dark:text-red-400")}>{missingQty}</span> cuốn, dư <span className={cn("tabular-nums", surplusQty > 0 && "font-semibold text-amber-800 dark:text-amber-300")}>{surplusQty}</span> cuốn</>}
            </p>
          </div>
          <div className="bg-card p-5">
            <dt className="text-[13px] text-muted-foreground">Điều chỉnh tồn kho</dt>
            {audit.status === "COMPLETED" ? (
              <>
                <dd className="mt-0.5 font-serif text-[24px] font-semibold leading-tight tabular-nums text-foreground">
                  {postedLines}<span className="font-sans text-[14px] font-normal text-muted-foreground"> mục</span>
                </dd>
                <p className="mt-1 text-[13px] text-muted-foreground">Đã ghi vào tồn kho khi duyệt.</p>
              </>
            ) : (
              <>
                <dd className="mt-0.5 text-[16px] font-medium text-foreground">Chưa điều chỉnh</dd>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {audit.status === "CANCELLED" ? "Phiếu đã hủy, tồn kho giữ nguyên." : "Tồn kho chỉ đổi khi quản lý duyệt phiếu."}
                </p>
              </>
            )}
          </div>
        </dl>
      </FadeItem>

      {canCount && <ScanCountPanel onScan={handleScanCode} />}

      <FadeItem>
        <section aria-labelledby="audit-lines-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
          <div className="px-5 pb-2 pt-4">
            <h2 id="audit-lines-title" className="text-[16px] font-semibold text-foreground">Mục kiểm kê</h2>
            {canCount && <p className="mt-0.5 text-[14px] text-muted-foreground">Bấm một dòng để quét cộng vào đúng vị trí khi một mã có ở nhiều vị trí.</p>}
          </div>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Sách và vị trí</TableHead>
                <TableHead className="hidden w-[90px] text-right text-[12px] font-normal text-muted-foreground @xl:table-cell">Hệ thống</TableHead>
                <TableHead className={cn("hidden text-right text-[12px] font-normal text-muted-foreground @xl:table-cell", canCount ? "w-[176px]" : "w-[96px]")}>Đếm được</TableHead>
                <TableHead className="hidden w-[110px] pr-5 text-right text-[12px] font-normal text-muted-foreground @xl:table-cell">Chênh lệch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.items.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-8 text-center text-[14px] text-muted-foreground">Phiếu không có mục nào.</TableCell>
                </TableRow>
              ) : audit.items.map((item) => {
                const variance = varianceText(item.variance_qty);
                const isSelected = canCount && selectedLineId === item.id;
                const stepper = (
                  <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => adjustLineCount(item, -1)}
                      aria-label={`Giảm 1, ${item.title || item.sku}`}
                      className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      aria-label={`Số đếm được, ${item.title || item.sku}`}
                      value={localCounts[item.id] ?? ""}
                      onChange={(e) => setLocalCounts((current) => ({ ...current, [item.id]: e.target.value }))}
                      onBlur={() => void handleLineBlur(item)}
                      className="h-10 w-16 text-center text-[15px] tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => adjustLineCount(item, 1)}
                      aria-label={`Tăng 1, ${item.title || item.sku}`}
                      className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                );
                return (
                  <TableRow
                    key={item.id}
                    onClick={canCount ? () => setSelectedLineId(item.id) : undefined}
                    aria-selected={canCount ? Boolean(isSelected) : undefined}
                    className={cn(canCount && "cursor-pointer", isSelected ? "bg-muted hover:bg-muted" : "hover:bg-muted/40")}
                  >
                    <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                      <p className="line-clamp-2 text-[14px] font-medium text-foreground" title={item.title || undefined}>{item.title || item.sku || "-"}</p>
                      <p className="mt-0.5 break-all text-[13px] text-muted-foreground">
                        <span className="font-mono text-[12px]">{item.sku || item.isbn13 || "-"}</span>, vị trí <span className="font-mono text-[12px] text-foreground/80">{item.location_code || "-"}</span>
                      </p>
                      <p className="mt-1 text-[13px] tabular-nums text-muted-foreground @xl:hidden">
                        Hệ thống <span className="text-foreground">{item.expected_qty}</span>
                        {!canCount && <>, đếm được <span className="text-foreground">{item.counted_qty ?? "-"}</span></>}
                        , chênh lệch <span className={variance.className}>{variance.text}</span>
                      </p>
                      {canCount && <div className="mt-2 @xl:hidden">{stepper}</div>}
                      {item.adjustment_posted && item.variance_qty ? <p className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-400">Đã điều chỉnh tồn kho</p> : null}
                    </TableCell>
                    <TableCell className="hidden py-3.5 text-right align-top text-[15px] tabular-nums text-foreground @xl:table-cell">{item.expected_qty}</TableCell>
                    <TableCell className={cn("hidden text-right align-top @xl:table-cell", canCount ? "py-3" : "py-3.5")}>
                      {canCount ? stepper : <span className="text-[15px] tabular-nums text-foreground">{item.counted_qty ?? <span className="text-muted-foreground">-</span>}</span>}
                    </TableCell>
                    <TableCell className={cn("hidden py-3.5 pr-5 text-right align-top text-[15px] tabular-nums @xl:table-cell", variance.className)}>{variance.text}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      </FadeItem>

      {canCount && (
        <div className={actionBar}>
          <p className="text-[14px] text-muted-foreground">
            {allCounted ? "Đã đếm đủ tất cả mục. Nộp phiếu để quản lý duyệt." : `Còn ${total - countedLines} mục chưa có số đếm. Cần đếm hết trước khi nộp.`}
          </p>
          <Button onClick={() => void handleSubmitAudit()} disabled={!allCounted} loading={saving} className="shrink-0">
            <ClipboardCheck className="h-4 w-4" /> Nộp phiếu kiểm kê
          </Button>
        </div>
      )}

      {isManager && audit.status === "SUBMITTED" && (
        <div className={actionBar}>
          <p className="text-[14px] text-muted-foreground">
            {audit.items.some((i) => i.variance_qty)
              ? `Có ${varianceLines.length} mục chênh lệch. Duyệt để tự động điều chỉnh tồn kho theo số đếm.`
              : "Không có chênh lệch nào. Duyệt để đóng phiếu."}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void handleCancel()} loading={saving} className="text-red-700 hover:text-red-800 dark:text-red-400">Hủy phiếu</Button>
            <Button onClick={() => void handleApprove()} loading={saving}>
              <Check className="h-4 w-4" /> Duyệt và điều chỉnh tồn kho
            </Button>
          </div>
        </div>
      )}
    </PageWrapper>
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
    <section aria-labelledby="scan-title" className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl bg-neutral-900">
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            {isLive && (
              <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Đang quay
              </span>
            )}
            {!isLive && (
              <div className="absolute inset-0 flex items-center justify-center px-1 text-center text-[12px] leading-tight text-neutral-300">
                {cameraError ? "Không có camera" : "Đang mở camera"}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h2 id="scan-title" className="flex items-center gap-1.5 text-[16px] font-semibold text-foreground">
              <ScanLine className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Quét mã để đếm
            </h2>
            <p className="mt-0.5 text-[14px] text-muted-foreground">
              Máy quét cầm tay, camera hoặc quét thủ công: mỗi lần quét cộng thêm 1 cuốn vào dòng tương ứng.
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
    </section>
  );
}
