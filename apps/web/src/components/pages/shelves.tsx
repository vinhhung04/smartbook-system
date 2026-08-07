import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, BookOpen, Layers3, Warehouse } from "lucide-react";
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
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingOverlay, SkeletonTableRow } from "@/components/ui/loading-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";

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
  const severity = width >= 90 ? "Đầy" : width >= 70 ? "Gần đầy" : "Còn chỗ";
  return (
    <div className="space-y-1">
      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className={`h-full rounded-full ${width >= 90 ? "bg-red-500" : width >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
        />
      </div>
      <p className={`text-[10px] font-medium ${width >= 90 ? "text-red-600 dark:text-red-400" : width >= 70 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
        {value == null ? "-" : `${value.toFixed(2)}%`} · {severity}
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
          <p className="text-[11px] text-muted-foreground mt-0.5">{formatQty(compartment.occupiedQty)} / {formatQty(compartment.capacityQty)} books</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">Available</p>
          <p className="text-[12px] text-emerald-700 dark:text-emerald-400 font-semibold">{formatQty(compartment.availableQty)}</p>
        </div>
      </div>

      <UtilizationBar value={compartment.utilizationPct} />

      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="bg-muted/50">
              {[
                "Book",
                "Book Code",
                "SKU",
                "ISBN13",
                "On Hand",
                "Inbound At",
              ].map((header) => (
                <th key={header} className="text-left text-[11px] text-muted-foreground px-3 py-2 uppercase tracking-wider font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {compartment.books.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-[12px] text-muted-foreground text-center">Compartment has no books.</td>
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

        const keep = rows.some((item) => item.id === selectedShelfId) ? selectedShelfId : rows[0].id;
        setSelectedShelfId(keep);
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
      const data = await reslottingSuggestionsService.getSuggestions(warehouseId);
      setReslottingItems(data.items);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được gợi ý tối ưu vị trí"));
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
          subtitle="Sách được mượn nhiều nhưng đang ở vị trí khó lấy — đề xuất hoán đổi với vị trí dễ tiếp cận hơn"
        >
          {!warehouseId ? (
            <EmptyState variant="no-data" title="Chọn kho để xem đề xuất" description="Chọn một kho ở bộ lọc phía trên để xem gợi ý tối ưu vị trí" />
          ) : loadingReslotting ? (
            <LoadingOverlay />
          ) : reslottingItems.length === 0 ? (
            <EmptyState variant="no-data" title="Chưa có đề xuất" description="Vị trí sách trong kho này hiện đã hợp lý theo tần suất mượn" />
          ) : (
            <div className="divide-y divide-border">
              {reslottingItems.map((item) => (
                <div key={`${item.variant_id}-${item.current_location_id}`} className="flex items-start justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <p className="text-[13px] text-foreground font-semibold">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{item.reason}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge label={item.current_location_code} variant="neutral" />
                    <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                    <StatusBadge label={item.suggested_location_code} variant="success" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </motion.div>
    </div>
  );
}
