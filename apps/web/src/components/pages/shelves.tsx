import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, ClipboardList, Layers3 } from "lucide-react";
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
import { FadeItem, PageWrapper } from "../motion-utils";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingOverlay, Skeleton } from "@/components/ui/loading-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIRecommendationNotice, DecisionSection } from "@/components/ai/decision-card";
import { hasPermission } from "@/services/http-clients";
import { staffTaskService } from "@/services/staff-tasks";
import { useAssignableStaff } from "@/hooks/useAssignableStaff";

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

function formatPct(value: number | null): string {
  return value == null ? "-" : `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

function UtilizationBar({ value, label }: { value: number | null; label: string }) {
  const width = value == null ? 0 : Math.min(Math.max(value, 0), 100);
  const band = occupancyBandFromRatio(width / 100);
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: lấp đầy ${formatPct(value)}, ${band.label.toLowerCase()}`}>
        <div className={cn("h-full rounded-full", band.line)} style={{ width: `${width}%` }} />
      </div>
      <p className={cn("text-[12px] font-medium", band.ink)} aria-hidden="true">{formatPct(value)}, {band.label.toLowerCase()}</p>
    </div>
  );
}

// One compartment: its fill, then the books in it as a compact list.
function CompartmentBlock({ compartment }: { compartment: ShelfCompartmentItem }) {
  return (
    <li className="@container py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-[14px] font-semibold text-foreground">{compartment.code}</p>
        <p className="text-[13px] text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{formatQty(compartment.occupiedQty)}</span> / {formatQty(compartment.capacityQty)} cuốn, còn trống {formatQty(compartment.availableQty)}
        </p>
      </div>
      <div className="mt-2 max-w-sm">
        <UtilizationBar value={compartment.utilizationPct} label={`Ngăn ${compartment.code}`} />
      </div>

      {compartment.books.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">Ngăn này chưa có sách.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {compartment.books.map((book) => (
            <li key={`${compartment.id}:${book.variantId}`} className="flex items-start justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <p className="line-clamp-2 text-[13px] font-medium text-foreground" title={book.title}>{book.title}</p>
                <p className="mt-0.5 break-all font-mono text-[12px] text-muted-foreground">
                  {[book.isbn13, book.sku, book.bookCode].filter(Boolean).join(", ")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-serif text-[17px] font-semibold leading-tight tabular-nums text-foreground">
                  {formatQty(book.onHandQty)}<span className="font-sans text-[12px] font-normal text-muted-foreground"> cuốn</span>
                </p>
                <p className="text-[12px] tabular-nums text-muted-foreground">Nhập {formatDate(book.inboundAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function LocationBox({ label, code, emphasis }: { label: string; code: string; emphasis?: boolean }) {
  return (
    <div className={cn("min-w-0 flex-1 rounded-xl border px-3 py-2", emphasis ? "border-primary/30 bg-primary/[0.06]" : "border-border bg-muted/40")}>
      <p className="text-[12px] text-muted-foreground">{label}</p>
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
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-[14px] font-semibold text-foreground">{item.title}</p>
        <p className="text-[12px] text-muted-foreground">
          {formatQty(item.turnover_count)} lượt mượn trong 90 ngày, phổ biến hạng {item.turnover_rank}/{total}
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <LocationBox label={`Hiện tại, dễ lấy hạng ${item.accessibility_rank}/${total}`} code={item.current_location_code} />
        <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        <ArrowDown className="mx-auto h-4 w-4 text-muted-foreground sm:hidden" aria-hidden="true" />
        <LocationBox label="Đề xuất, dễ tiếp cận hơn" code={item.suggested_location_code} emphasis />
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
            Tạo nhiệm vụ di chuyển
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
  // only staff who can act in this warehouse (the backend checks the same rule)
  const assignable = useAssignableStaff(item ? warehouseId : null);
  const staff = assignable.loading ? null : assignable.staff;
  const staffError = Boolean(assignable.error);
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);

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
                <p className="text-[12px] text-muted-foreground">Kho này chưa có nhân viên nào nhận được việc.</p>
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

  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId);
  const totalPct = totals.capacity > 0 ? (totals.occupied / totals.capacity) * 100 : null;
  const lede = loadingShelves && shelves.length === 0
    ? "Sức chứa của từng kệ và ngăn, cùng sách đang nằm trong đó."
    : `${shelves.length} kệ, ${formatQty(totals.compartments)} ngăn${selectedWarehouse ? ` ở ${selectedWarehouse.name}` : ""}: đang chứa ${formatQty(totals.occupied)} / ${formatQty(totals.capacity)} cuốn${totalPct == null ? "" : ` (${formatPct(totalPct)})`}.`;

  const railButton = (active: boolean, onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-primary/[0.08] text-primary" : "text-foreground hover:bg-muted/60",
      )}
    >
      <span className={cn("min-w-0 line-clamp-2 text-[13px]", active ? "font-semibold" : "font-medium")} title={label}>{label}</span>
    </button>
  );

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader icon={Layers3} title="Quản lý kệ sách" description={lede} />
      </FadeItem>

      <FadeItem>
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="Lọc kệ theo kho" className="hidden max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Kho</p>
              {railButton(!warehouseId, () => setWarehouseId(""), "Tất cả kho")}
              {warehouses.map((warehouse) => (
                <div key={warehouse.id}>{railButton(warehouseId === warehouse.id, () => setWarehouseId(warehouse.id), warehouse.name)}</div>
              ))}
            </nav>

            <div className="min-w-0 space-y-4">
              <div className="@container/shelves">
                <div className="grid grid-cols-1 items-start gap-4 @3xl/shelves:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
                  <section aria-labelledby="shelf-list-title" className="overflow-hidden rounded-2xl border border-border bg-card @3xl/shelves:sticky @3xl/shelves:top-4">
                    <div className="px-4 pb-2 pt-4">
                      <h2 id="shelf-list-title" className="font-serif text-[17px] font-semibold tracking-tight">Kệ</h2>
                    </div>
                    <div className="border-b border-border px-3 pb-3">
                      <FilterBar
                        searchValue={query}
                        onSearchChange={setQuery}
                        searchPlaceholder="Mã kệ hoặc khu vực"
                        showSearchClear
                        filters={(
                          <div className="w-full @4xl/page:hidden">
                            <Select value={warehouseId || "all"} onValueChange={(v) => setWarehouseId(v === "all" ? "" : v)}>
                              <SelectTrigger size="sm" className="w-full" aria-label="Kho">
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
                        )}
                      />
                    </div>
                    {loadingShelves ? (
                      <div className="space-y-3 p-4">
                        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
                      </div>
                    ) : shelves.length === 0 ? (
                      <EmptyState variant="no-data" title="Không tìm thấy kệ nào" description="Thử đổi từ khóa hoặc kho." className="py-10" />
                    ) : (
                      <ul className="max-h-[calc(100vh-14rem)] divide-y divide-border overflow-y-auto">
                        {shelves.map((shelf) => {
                          const active = selectedShelfId === shelf.id;
                          return (
                            <li key={shelf.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedShelfId(shelf.id)}
                                aria-pressed={active}
                                className={cn(
                                  "w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                                  active ? "bg-primary/[0.06]" : "hover:bg-muted/50",
                                )}
                              >
                                <div className="flex items-baseline justify-between gap-3">
                                  <span className={cn("font-mono text-[14px] font-semibold", active ? "text-primary" : "text-foreground")}>{shelf.code}</span>
                                  <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                                    <span className="font-semibold text-foreground">{formatQty(shelf.occupiedQty)}</span> / {formatQty(shelf.capacityQty)}
                                  </span>
                                </div>
                                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                                  Khu {shelf.zone || "-"}, {shelf.compartmentCount} ngăn{warehouseId ? "" : `, ${shelf.warehouse.name}`}
                                </p>
                                <div className="mt-2">
                                  <UtilizationBar value={shelf.utilizationPct} label={`Kệ ${shelf.code}`} />
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section aria-labelledby="shelf-detail-title" className="min-w-0 rounded-2xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                      <div className="min-w-0">
                        <h2 id="shelf-detail-title" className="font-serif text-[17px] font-semibold tracking-tight">
                          {selectedShelf ? <>Kệ <span className="font-mono">{selectedShelf.code}</span></> : "Chi tiết kệ"}
                        </h2>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                          {selectedShelf ? `Khu ${selectedShelf.zone || "-"}, ${selectedShelf.warehouse.code} - ${selectedShelf.warehouse.name}` : "Chọn một kệ để xem ngăn và sách bên trong."}
                        </p>
                      </div>
                      {detail?.shelf && (
                        <dl className="flex gap-5">
                          {[
                            { label: "Đang chứa", value: formatQty(detail.shelf.occupiedQty) },
                            { label: "Sức chứa", value: formatQty(detail.shelf.capacityQty) },
                            { label: "Còn trống", value: formatQty(detail.shelf.availableQty) },
                          ].map((item) => (
                            <div key={item.label}>
                              <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
                              <dd className="font-serif text-[20px] font-semibold leading-tight tabular-nums text-foreground">{item.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>

                    <div className="mt-5 border-t border-border pt-4">
                      {loadingDetail ? (
                        <LoadingOverlay />
                      ) : !detail ? (
                        <EmptyState variant="no-data" title="Chọn kệ để xem chi tiết" description="Bấm vào một kệ trong danh sách để xem ngăn và sách." className="py-8" />
                      ) : detail.compartments.length === 0 ? (
                        <EmptyState variant="no-data" title="Chưa có ngăn kệ" description="Kệ này chưa được cấu hình ngăn." className="py-8" />
                      ) : (
                        <ul className="divide-y divide-border">
                          {detail.compartments.map((compartment) => (
                            <CompartmentBlock key={compartment.id} compartment={compartment} />
                          ))}
                        </ul>
                      )}
                    </div>
                  </section>
                </div>
              </div>

              <section aria-labelledby="reslotting-title" className="rounded-2xl border border-border bg-card p-5">
                <h2 id="reslotting-title" className="font-serif text-[17px] font-semibold tracking-tight">Đề xuất tối ưu vị trí</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Sách được mượn nhiều nhưng đang ở vị trí khó lấy. Hệ thống đề xuất hoán đổi với vị trí dễ tiếp cận hơn.</p>
                <div className="mt-4">
                  {!warehouseId ? (
                    <p className="text-[13px] text-muted-foreground">Chọn một kho để xem đề xuất cho kho đó.</p>
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
                    <p className="text-[13px] text-muted-foreground">Chưa có đề xuất: vị trí sách trong kho này đã hợp lý theo tần suất mượn 90 ngày gần nhất.</p>
                  ) : (
                    <div>
                      <AIRecommendationNotice className="mb-4" />
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
                </div>
              </section>
            </div>
          </div>
        </div>
      </FadeItem>

      <MoveTaskDialog item={taskItem} warehouseId={warehouseId} onClose={() => setTaskItem(null)} />
    </PageWrapper>
  );
}
