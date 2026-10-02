import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, BookOpen, ClipboardList, Layers3, Warehouse } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { warehouseService, type Warehouse as WarehouseItem } from "@/services/warehouse";
import {
  shelfService,
  type ShelfOverviewItem,
  type ShelfDetailResponse,
  type ShelfCompartmentItem,
} from "@/services/shelf";
import { reslottingSuggestionsService, type ReslottingSuggestionItem } from "@/services/reslotting-suggestions";
import { occupancyBandFromRatio } from "@/lib/occupancy";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingOverlay, SkeletonTableRow } from "@/components/ui/loading-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIRecommendationNotice, DecisionSection } from "@/components/ai/decision-card";
import { hasPermission } from "@/services/http-clients";
import { staffTaskService } from "@/services/staff-tasks";
import { userService, type WarehouseStaffOption } from "@/services/user";

function formatQty(value: number | null | undefined): string {
  if (value == null) return "-";
  return Intl.NumberFormat("vi-VN").format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UtilizationBar({ value }: { value: number | null }) {
  const width = value == null ? 0 : Math.min(Math.max(value, 0), 100);
  const band = occupancyBandFromRatio(width / 100);
  return (
    <div className="space-y-1">
      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className={`h-full rounded-full ${band.line}`}
        />
      </div>
      <p className={`text-[10px] font-medium ${band.ink}`}>
        {value == null ? "-" : `${value.toFixed(2)}%`} · {band.label}
      </p>
    </div>
  );
}

function CompartmentCard({ compartment }: { compartment: ShelfCompartmentItem }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-foreground font-semibold">{compartment.code}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{formatQty(compartment.occupiedQty)} / {formatQty(compartment.capacityQty)} cuốn</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">Khả dụng</p>
          <p className="text-[12px] text-emerald-700 dark:text-emerald-400 font-semibold">{formatQty(compartment.availableQty)}</p>
        </div>
      </div>

      <UtilizationBar value={compartment.utilizationPct} />

      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="bg-muted/50">
              {[
                "Sách",
                "Mã sách",
                "SKU",
                "ISBN-13",
                "Tồn hiện tại",
                "Ngày nhập",
              ].map((header) => (
                <th key={header} className="text-left text-[11px] text-muted-foreground px-3 py-2 uppercase tracking-wider font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {compartment.books.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-[12px] text-muted-foreground text-center">Ngăn này chưa có sách.</td>
              </tr>
            ) : (
              compartment.books.map((book) => (
                <tr key={`${compartment.id}:${book.variantId}`} className="border-t border-border">
                  <td className="px-3 py-2.5 text-[12px] text-foreground font-medium">{book.title}</td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{book.bookCode || "-"}</td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{book.sku}</td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{book.isbn13 || "-"}</td>
                  <td className="px-3 py-2.5 text-[12px] text-foreground font-medium">{formatQty(book.onHandQty)}</td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{formatDate(book.inboundAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LocationBox({ label, code, emphasis }: { label: string; code: string; emphasis?: boolean }) {
  return (
    <div className={`min-w-0 flex-1 rounded-lg border px-3 py-2 ${emphasis ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-border bg-muted/40"}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-[14px] font-semibold text-foreground">{code}</p>
    </div>
  );
}

// One re-slotting proposal: which book, where it is, where it should go, why.
// Figures come straight from the API (90-day loans, rank out of all evaluated
// placements); nothing is estimated client-side.
function ReslottingSuggestionRow({
  item,
  total,
  canCreateTask,
  onCreateTask,
}: {
  item: ReslottingSuggestionItem;
  total: number;
  canCreateTask: boolean;
  onCreateTask: (item: ReslottingSuggestionItem) => void;
}) {
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-[14px] font-semibold text-foreground">{item.title}</p>
        <p className="text-[12px] text-muted-foreground">
          {formatQty(item.turnover_count)} lượt mượn / 90 ngày · phổ biến hạng {item.turnover_rank}/{total}
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <LocationBox label={`Hiện tại · dễ lấy hạng ${item.accessibility_rank}/${total}`} code={item.current_location_code} />
        <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        <ArrowDown className="mx-auto h-4 w-4 text-muted-foreground sm:hidden" aria-hidden="true" />
        <LocationBox label="Đề xuất (dễ tiếp cận hơn)" code={item.suggested_location_code} emphasis />
      </div>
      <p className="text-[13px] text-foreground/85">
        Sách được mượn nhiều nhưng đang ở vị trí khó lấy hơn; đề xuất hoán đổi với sách ít được mượn đang ở {item.suggested_location_code}.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <DecisionSection title="Chi tiết" collapsible>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{item.reason}</p>
          </DecisionSection>
        </div>
        {canCreateTask && (
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onCreateTask(item)}>
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            Tạo task di chuyển
          </Button>
        )}
      </div>
    </li>
  );
}

// Human confirmation step: the proposal only becomes a staff task after a
// manager picks who does it and presses "Tạo nhiệm vụ". Stock itself does not
// move until staff carry the task out.
function MoveTaskDialog({
  item,
  warehouseId,
  onClose,
}: {
  item: ReslottingSuggestionItem | null;
  warehouseId: string;
  onClose: () => void;
}) {
  const [staff, setStaff] = useState<WarehouseStaffOption[] | null>(null);
  const [staffError, setStaffError] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item || staff) return;
    userService.getWarehouseStaff()
      .then((resp) => setStaff(resp.data || []))
      .catch(() => { setStaffError(true); setStaff([]); });
  }, [item, staff]);

  useEffect(() => { if (!item) setAssigneeId(""); }, [item]);

  const submit = async () => {
    if (!item || !assigneeId) return;
    setSaving(true);
    try {
      await staffTaskService.create({
        title: `Hoán đổi vị trí: "${item.title}" ${item.current_location_code} → ${item.suggested_location_code}`,
        description: `Chuyển "${item.title}" từ ${item.current_location_code} sang ${item.suggested_location_code} và chuyển sách đang ở ${item.suggested_location_code} về ${item.current_location_code}. Lý do (đề xuất hệ thống): ${item.reason}`,
        task_type: "GENERAL",
        priority: "MEDIUM",
        assignee_user_id: assigneeId,
        warehouse_id: warehouseId,
      });
      toast.success("Đã tạo nhiệm vụ di chuyển");
      onClose();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể tạo nhiệm vụ"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo nhiệm vụ di chuyển</DialogTitle>
          <DialogDescription>
            Hệ thống chỉ tạo nhiệm vụ cho nhân viên kho. Tồn kho chỉ thay đổi khi nhân viên thực hiện chuyển vị trí.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <div className="space-y-3">
            <p className="text-[14px] font-semibold text-foreground">{item.title}</p>
            <div className="flex items-center gap-2">
              <LocationBox label="Từ" code={item.current_location_code} />
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <LocationBox label="Đến" code={item.suggested_location_code} emphasis />
            </div>
            <div className="space-y-1">
              <label htmlFor="move-task-assignee" className="text-[12px] font-medium text-foreground">Người thực hiện <span className="text-red-600">*</span></label>
              {staffError ? (
                <p className="text-[12px] text-red-600 dark:text-red-400" role="alert">Không tải được danh sách nhân viên kho.</p>
              ) : staff === null ? (
                <p className="text-[12px] text-muted-foreground">Đang tải danh sách nhân viên…</p>
              ) : staff.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">Chưa có nhân viên kho nào để giao.</p>
              ) : (
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger id="move-task-assignee" className="w-full"><SelectValue placeholder="Chọn nhân viên" /></SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name || s.username}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Hủy</Button>
          <Button type="button" onClick={() => void submit()} disabled={!assigneeId} loading={saving} loadingLabel="Đang tạo…">
            Tạo nhiệm vụ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ShelvesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [query, setQuery] = useState("");
  const [loadingShelves, setLoadingShelves] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [shelves, setShelves] = useState<ShelfOverviewItem[]>([]);
  const [selectedShelfId, setSelectedShelfId] = useState("");
  const [detail, setDetail] = useState<ShelfDetailResponse | null>(null);
  const [reslottingItems, setReslottingItems] = useState<ReslottingSuggestionItem[]>([]);
  const [loadingReslotting, setLoadingReslotting] = useState(false);
  const [reslottingError, setReslottingError] = useState<{ forbidden: boolean; message: string } | null>(null);
  const [reslottingTotal, setReslottingTotal] = useState(0);
  const [taskItem, setTaskItem] = useState<ReslottingSuggestionItem | null>(null);
  const canCreateMoveTask = hasPermission("inventory.operation.decide");

  const selectedShelf = useMemo(
    () => shelves.find((item) => item.id === selectedShelfId) || null,
    [shelves, selectedShelfId],
  );

  useEffect(() => {
    const loadWarehouses = async () => {
      try {
        const data = await warehouseService.getAll();
        setWarehouses(Array.isArray(data) ? data : []);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được danh sách kho"));
      }
    };

    void loadWarehouses();
  }, []);

  useEffect(() => {
    const loadShelves = async () => {
      try {
        setLoadingShelves(true);
        const rows = await shelfService.getOverview({
          warehouseId: warehouseId || undefined,
          query: query.trim() || undefined,
        });

        setShelves(rows);

        if (rows.length === 0) {
          setSelectedShelfId("");
          setDetail(null);
          return;
        }

        setSelectedShelfId((currentShelfId) => (
          rows.some((item) => item.id === currentShelfId) ? currentShelfId : rows[0].id
        ));
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được danh sách kệ"));
        setShelves([]);
        setSelectedShelfId("");
        setDetail(null);
      } finally {
        setLoadingShelves(false);
      }
    };

    void loadShelves();
  }, [warehouseId, query]);

  useEffect(() => {
    const loadDetail = async () => {
      if (!selectedShelfId) {
        setDetail(null);
        return;
      }

      try {
        setLoadingDetail(true);
        const data = await shelfService.getById(selectedShelfId);
        setDetail(data);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được chi tiết kệ"));
        setDetail(null);
      } finally {
        setLoadingDetail(false);
      }
    };

    void loadDetail();
  }, [selectedShelfId]);

  const loadReslotting = useCallback(async () => {
    if (!warehouseId) {
      setReslottingItems([]);
      return;
    }
    try {
      setLoadingReslotting(true);
      setReslottingError(null);
      const data = await reslottingSuggestionsService.getSuggestions(warehouseId);
      setReslottingItems(data.items);
      setReslottingTotal(data.total_placements_evaluated);
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      setReslottingError({
        forbidden: status === 403,
        message: getApiErrorMessage(error, "Không tải được đề xuất tối ưu vị trí"),
      });
      setReslottingItems([]);
    } finally {
      setLoadingReslotting(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    void loadReslotting();
  }, [loadReslotting]);

  const totals = useMemo(() => {
    return shelves.reduce(
      (acc, shelf) => {
        acc.occupied += shelf.occupiedQty;
        acc.capacity += shelf.capacityQty || 0;
        acc.compartments += shelf.compartmentCount;
        return acc;
      },
      { occupied: 0, capacity: 0, compartments: 0 },
    );
  }, [shelves]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
      >
        <PageHeader
          icon={Layers3}
          title="Quản lý kệ sách"
          description={`${shelves.length} kệ · ${totals.compartments} ngăn · ${formatQty(totals.occupied)} đang chứa`}
          iconBg="bg-gradient-to-br from-cyan-100 to-blue-50 dark:from-cyan-500/20 dark:to-blue-500/10"
          iconColor="text-cyan-700 dark:text-cyan-400"
        />

        <div className="grid grid-cols-3 gap-2.5 sm:min-w-[300px]">
          <StatCard label="Đang chứa" value={formatQty(totals.occupied)} variant="warning" />
          <StatCard label="Sức chứa" value={formatQty(totals.capacity)} variant="info" />
          <StatCard label="Ngăn kệ" value={formatQty(totals.compartments)} variant="default" />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Tìm kệ theo mã, khu vực, kho"
          showSearchClear
          filters={
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 rounded-lg border border-input bg-card px-2">
                <Warehouse className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <Select value={warehouseId || "all"} onValueChange={(v) => setWarehouseId(v === "all" ? "" : v)}>
                  <SelectTrigger className="min-w-[220px] border-0 bg-transparent shadow-none">
                    <SelectValue placeholder="Tất cả kho" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả kho</SelectItem>
                    {warehouses.map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>
                        {warehouse.code} - {warehouse.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!warehouseId && (
                <p className="text-[10px] text-muted-foreground">Chọn kho để xem đề xuất tối ưu vị trí bên dưới</p>
              )}
            </div>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <SectionCard noPadding>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Kệ", "Kho", "Ngăn", "Đang chứa", "Sức chứa", "Khả dụng", "Tỷ lệ lấp đầy"].map((header) => (
                  <th key={header} className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingShelves ? (
                <SkeletonTableRow columns={7} rows={4} />
              ) : shelves.length === 0 ? (
                <tr>
                  <td colSpan={7}><EmptyState variant="no-data" title="Không tìm thấy kệ nào" description="Thử điều chỉnh tìm kiếm hoặc bộ lọc" className="py-12" /></td>
                </tr>
              ) : (
                shelves.map((shelf) => (
                  <tr
                    key={shelf.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedShelfId(shelf.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedShelfId(shelf.id);
                      }
                    }}
                    className={`border-b border-border last:border-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 ${selectedShelfId === shelf.id ? "bg-cyan-50/30 dark:bg-cyan-500/10" : "hover:bg-muted/60"}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                        <div>
                          <p className="text-[13px] text-foreground font-semibold">{shelf.code}</p>
                          <p className="text-[11px] text-muted-foreground">Khu vực: {shelf.zone || "-"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{shelf.warehouse.code} - {shelf.warehouse.name}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatQty(shelf.compartmentCount)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-foreground font-semibold">{formatQty(shelf.occupiedQty)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatQty(shelf.capacityQty)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-emerald-700 dark:text-emerald-400 font-semibold">{formatQty(shelf.availableQty)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground min-w-[160px]">
                      <UtilizationBar value={shelf.utilizationPct} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </SectionCard>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <SectionCard
          title={selectedShelf ? `Chi tiết kệ - ${selectedShelf.code}` : "Chi tiết kệ"}
          subtitle="Xem ngăn chứa, số lượng hiện tại và ngày nhập theo biến thể sách."
          actions={detail?.shelf ? (
            <div className="grid grid-cols-3 gap-2 sm:min-w-[280px]">
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Đang chứa</p>
                <p className="text-[14px] text-foreground font-bold">{formatQty(detail.shelf.occupiedQty)}</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Sức chứa</p>
                <p className="text-[14px] text-foreground font-bold">{formatQty(detail.shelf.capacityQty)}</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Khả dụng</p>
                <p className="text-[14px] text-emerald-700 dark:text-emerald-400 font-bold">{formatQty(detail.shelf.availableQty)}</p>
              </div>
            </div>
          ) : undefined}
        >
          {loadingDetail ? (
            <LoadingOverlay />
          ) : !detail ? (
            <EmptyState variant="no-data" title="Chọn kệ để xem chi tiết" description="Nhấn vào một hàng kệ ở trên để xem ngăn và sách" />
          ) : detail.compartments.length === 0 ? (
            <EmptyState variant="no-data" title="Chưa có ngăn kệ" description="Kệ này chưa được cấu hình ngăn" />
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {detail.compartments.map((compartment) => (
                <CompartmentCard key={compartment.id} compartment={compartment} />
              ))}
            </div>
          )}
        </SectionCard>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <SectionCard
          title="Đề xuất tối ưu vị trí"
          subtitle="Sách được mượn nhiều nhưng đang ở vị trí khó lấy — hệ thống đề xuất hoán đổi với vị trí dễ tiếp cận hơn"
        >
          {!warehouseId ? (
            <EmptyState variant="no-data" title="Chọn kho để xem đề xuất" description="Chọn một kho ở bộ lọc phía trên để xem đề xuất tối ưu vị trí" />
          ) : loadingReslotting ? (
            <LoadingOverlay />
          ) : reslottingError ? (
            <EmptyState
              variant={reslottingError.forbidden ? "no-permission" : "error"}
              title={reslottingError.forbidden ? "Không có quyền xem đề xuất" : "Không tải được đề xuất"}
              description={reslottingError.message}
              action={reslottingError.forbidden ? undefined : <Button variant="outline" size="sm" onClick={() => void loadReslotting()}>Thử lại</Button>}
            />
          ) : reslottingItems.length === 0 ? (
            <EmptyState variant="no-data" title="Chưa có đề xuất" description="Vị trí sách trong kho này hiện đã hợp lý theo tần suất mượn 90 ngày gần nhất" />
          ) : (
            <div>
              <AIRecommendationNotice />
              <ul className="divide-y divide-border">
                {reslottingItems.map((item) => (
                  <ReslottingSuggestionRow
                    key={`${item.variant_id}-${item.current_location_id}`}
                    item={item}
                    total={reslottingTotal}
                    canCreateTask={canCreateMoveTask}
                    onCreateTask={setTaskItem}
                  />
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      </motion.div>

      <MoveTaskDialog item={taskItem} warehouseId={warehouseId} onClose={() => setTaskItem(null)} />
    </div>
  );
}
