import { useEffect, useMemo, useState } from "react";
import { BookOpen, Layers3, Search, Warehouse } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { getApiErrorMessage } from "@/services/api.ts";
import { warehouseService, type Warehouse as WarehouseItem } from "@/services/warehouse";
import {
  shelfService,
  type ShelfOverviewItem,
  type ShelfDetailResponse,
  type ShelfCompartmentItem,
} from "@/services/shelf";

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
    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${width}%` }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className={`h-full rounded-full ${width >= 90 ? "bg-rose-500" : width >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
      />
    </div>
  );
}

function CompartmentCard({ compartment }: { compartment: ShelfCompartmentItem }) {
  return (
    <div className="rounded-[12px] border border-slate-200/70 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-slate-900" style={{ fontWeight: 650 }}>{compartment.code}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{formatQty(compartment.occupiedQty)} / {formatQty(compartment.capacityQty)} books</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-400">Available</p>
          <p className="text-[12px] text-emerald-700" style={{ fontWeight: 650 }}>{formatQty(compartment.availableQty)}</p>
        </div>
      </div>

      <UtilizationBar value={compartment.utilizationPct} />

      <div className="overflow-auto rounded-[10px] border border-slate-100">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="bg-slate-50">
              {[
                "Book",
                "Book Code",
                "SKU",
                "ISBN13",
                "On Hand",
                "Inbound At",
              ].map((header) => (
                <th key={header} className="text-left text-[10px] text-slate-500 px-3 py-2 uppercase tracking-[0.06em]" style={{ fontWeight: 600 }}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {compartment.books.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-[12px] text-slate-400 text-center">Compartment has no books.</td>
              </tr>
            ) : (
              compartment.books.map((book) => (
                <tr key={`${compartment.id}:${book.variantId}`} className="border-t border-slate-100">
                  <td className="px-3 py-2.5 text-[12px] text-slate-700" style={{ fontWeight: 550 }}>{book.title}</td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-500">{book.bookCode || "-"}</td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-500">{book.sku}</td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-500">{book.isbn13 || "-"}</td>
                  <td className="px-3 py-2.5 text-[12px] text-slate-800" style={{ fontWeight: 650 }}>{formatQty(book.onHandQty)}</td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-500">{formatDate(book.inboundAt)}</td>
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
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-cyan-100 to-blue-50 flex items-center justify-center border border-cyan-200/40">
              <Layers3 className="w-5 h-5 text-cyan-700" />
            </div>
            <div>
              <h1 className="tracking-[-0.02em]">Shelf Management</h1>
              <p className="text-[12px] text-slate-400 mt-0.5">{shelves.length} shelves · {totals.compartments} compartments · {formatQty(totals.occupied)} on hand</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 min-w-[300px]">
            <div className="rounded-[10px] border border-cyan-100 bg-cyan-50/60 px-3 py-2">
              <p className="text-[10px] text-cyan-600 uppercase" style={{ fontWeight: 600 }}>Occupied</p>
              <p className="text-[15px] text-cyan-800" style={{ fontWeight: 700 }}>{formatQty(totals.occupied)}</p>
            </div>
            <div className="rounded-[10px] border border-blue-100 bg-blue-50/60 px-3 py-2">
              <p className="text-[10px] text-blue-600 uppercase" style={{ fontWeight: 600 }}>Capacity</p>
              <p className="text-[15px] text-blue-800" style={{ fontWeight: 700 }}>{formatQty(totals.capacity)}</p>
            </div>
            <div className="rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2">
              <p className="text-[10px] text-slate-500 uppercase" style={{ fontWeight: 600 }}>Compartments</p>
              <p className="text-[15px] text-slate-700" style={{ fontWeight: 700 }}>{formatQty(totals.compartments)}</p>
            </div>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search shelf by code, zone, warehouse"
              className="w-full pl-9 pr-3 py-2.5 rounded-[10px] border border-cyan-100/60 bg-white text-[13px] outline-none focus:ring-[3px] focus:ring-cyan-500/10"
            />
          </div>

          <div className="flex items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 py-2">
            <Warehouse className="w-3.5 h-3.5 text-slate-400" />
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
        </div>
      </FadeItem>

      <FadeItem>
        <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-gradient-to-r from-cyan-50/50 to-transparent">
                {["Shelf", "Warehouse", "Compartments", "Occupied", "Capacity", "Available", "Utilization"].map((header) => (
                  <th key={header} className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingShelves ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[13px] text-slate-400">Loading shelf list...</td>
                </tr>
              ) : shelves.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[13px] text-slate-400">No shelves found.</td>
                </tr>
              ) : (
                shelves.map((shelf) => (
                  <tr
                    key={shelf.id}
                    onClick={() => setSelectedShelfId(shelf.id)}
                    className={`border-b border-slate-50 last:border-0 cursor-pointer transition-colors ${selectedShelfId === shelf.id ? "bg-cyan-50/30" : "hover:bg-slate-50/60"}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5 text-cyan-600" />
                        <div>
                          <p className="text-[13px] text-slate-900" style={{ fontWeight: 650 }}>{shelf.code}</p>
                          <p className="text-[11px] text-slate-400">Zone: {shelf.zone || "-"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-600">{shelf.warehouse.code} - {shelf.warehouse.name}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-600">{formatQty(shelf.compartmentCount)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-700" style={{ fontWeight: 600 }}>{formatQty(shelf.occupiedQty)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-600">{formatQty(shelf.capacityQty)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-emerald-700" style={{ fontWeight: 600 }}>{formatQty(shelf.availableQty)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-600 min-w-[160px]">
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
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[16px] border border-slate-200/70 bg-gradient-to-b from-slate-50/80 to-white p-4 md:p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-[16px] text-slate-900" style={{ fontWeight: 700 }}>
                {selectedShelf ? `Shelf Detail - ${selectedShelf.code}` : "Shelf Detail"}
              </h2>
              <p className="text-[12px] text-slate-500 mt-1">Compartment view with current on_hand and inbound dates per book variant.</p>
            </div>
            {detail?.shelf ? (
              <div className="grid grid-cols-3 gap-2 min-w-[280px]">
                <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[10px] text-slate-400 uppercase" style={{ fontWeight: 600 }}>Occupied</p>
                  <p className="text-[14px] text-slate-800" style={{ fontWeight: 700 }}>{formatQty(detail.shelf.occupiedQty)}</p>
                </div>
                <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[10px] text-slate-400 uppercase" style={{ fontWeight: 600 }}>Capacity</p>
                  <p className="text-[14px] text-slate-800" style={{ fontWeight: 700 }}>{formatQty(detail.shelf.capacityQty)}</p>
                </div>
                <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[10px] text-slate-400 uppercase" style={{ fontWeight: 600 }}>Available</p>
                  <p className="text-[14px] text-emerald-700" style={{ fontWeight: 700 }}>{formatQty(detail.shelf.availableQty)}</p>
                </div>
              </div>
            ) : null}
          </div>

          {loadingDetail ? (
            <div className="rounded-[12px] border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-400">Loading shelf detail...</div>
          ) : !detail ? (
            <div className="rounded-[12px] border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-400">Select a shelf to view compartments and books.</div>
          ) : detail.compartments.length === 0 ? (
            <div className="rounded-[12px] border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-400">Shelf has no compartments.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {detail.compartments.map((compartment) => (
                <CompartmentCard key={compartment.id} compartment={compartment} />
              ))}
            </div>
          )}
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
