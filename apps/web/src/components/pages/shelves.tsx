import { useEffect, useMemo, useState } from "react";
import { BookOpen, Layers3, Warehouse } from "lucide-react";
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
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { FilterBar } from "@/components/ui/filter-bar";

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
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${width}%` }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className={`h-full rounded-full ${width >= 90 ? "bg-red-500" : width >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
      />
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
          <p className="text-[12px] text-emerald-700 font-semibold">{formatQty(compartment.availableQty)}</p>
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
                <th key={header} className="text-left text-[10px] text-muted-foreground px-3 py-2 uppercase tracking-[0.06em] font-semibold">{header}</th>
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
        toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach kho"));
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
        toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach ke"));
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
        toast.error(getApiErrorMessage(error, "Khong tai duoc chi tiet ke"));
        setDetail(null);
      } finally {
        setLoadingDetail(false);
      }
    };

    void loadDetail();
  }, [selectedShelfId]);

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
        className="flex items-center justify-between gap-4 flex-wrap"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-100 to-blue-50 flex items-center justify-center border border-cyan-200/40">
            <Layers3 className="w-5 h-5 text-cyan-700" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Shelf Management</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">{shelves.length} shelves · {totals.compartments} compartments · {formatQty(totals.occupied)} on hand</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 min-w-[300px]">
          <StatCard label="Occupied" value={formatQty(totals.occupied)} variant="warning" />
          <StatCard label="Capacity" value={formatQty(totals.capacity)} variant="info" />
          <StatCard label="Compartments" value={formatQty(totals.compartments)} variant="default" />
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
          searchPlaceholder="Search shelf by code, zone, warehouse"
          showSearchClear
          filters={
            <div className="flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2">
              <Warehouse className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
                className="text-[13px] outline-none bg-transparent cursor-pointer"
              >
                <option value="">All warehouses</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} - {warehouse.name}
                  </option>
                ))}
              </select>
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
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Shelf", "Warehouse", "Compartments", "Occupied", "Capacity", "Available", "Utilization"].map((header) => (
                  <th key={header} className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingShelves ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[13px] text-muted-foreground">Loading shelf list...</td>
                </tr>
              ) : shelves.length === 0 ? (
                <tr>
                  <td colSpan={7}><EmptyState variant="no-data" title="No shelves found" description="Try adjusting your search or filters" className="py-12" /></td>
                </tr>
              ) : (
                shelves.map((shelf) => (
                  <tr
                    key={shelf.id}
                    onClick={() => setSelectedShelfId(shelf.id)}
                    className={`border-b border-border last:border-0 cursor-pointer transition-colors ${selectedShelfId === shelf.id ? "bg-cyan-50/30" : "hover:bg-muted/60"}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5 text-cyan-600" />
                        <div>
                          <p className="text-[13px] text-foreground font-semibold">{shelf.code}</p>
                          <p className="text-[11px] text-muted-foreground">Zone: {shelf.zone || "-"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{shelf.warehouse.code} - {shelf.warehouse.name}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatQty(shelf.compartmentCount)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-foreground font-semibold">{formatQty(shelf.occupiedQty)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatQty(shelf.capacityQty)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-emerald-700 font-semibold">{formatQty(shelf.availableQty)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground min-w-[160px]">
                      <div className="space-y-1">
                        <UtilizationBar value={shelf.utilizationPct} />
                        <p>{shelf.utilizationPct == null ? "-" : `${shelf.utilizationPct.toFixed(2)}%`}</p>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SectionCard>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <SectionCard
          title={selectedShelf ? `Shelf Detail - ${selectedShelf.code}` : "Shelf Detail"}
          subtitle="Compartment view with current on_hand and inbound dates per book variant."
          actions={detail?.shelf ? (
            <div className="grid grid-cols-3 gap-2 min-w-[280px]">
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Occupied</p>
                <p className="text-[14px] text-foreground font-bold">{formatQty(detail.shelf.occupiedQty)}</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Capacity</p>
                <p className="text-[14px] text-foreground font-bold">{formatQty(detail.shelf.capacityQty)}</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Available</p>
                <p className="text-[14px] text-emerald-700 font-bold">{formatQty(detail.shelf.availableQty)}</p>
              </div>
            </div>
          ) : undefined}
        >
          {loadingDetail ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-[13px] text-muted-foreground">Loading shelf detail...</div>
          ) : !detail ? (
            <EmptyState variant="no-data" title="Select a shelf to view" description="Click on a shelf row above to see compartments and books" />
          ) : detail.compartments.length === 0 ? (
            <EmptyState variant="no-data" title="No compartments" description="This shelf has no compartments configured" />
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {detail.compartments.map((compartment) => (
                <CompartmentCard key={compartment.id} compartment={compartment} />
              ))}
            </div>
          )}
        </SectionCard>
      </motion.div>
    </div>
  );
}
