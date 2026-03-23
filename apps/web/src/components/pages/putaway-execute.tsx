import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { NavLink, useParams } from "react-router";
import { PageWrapper, FadeItem } from "../motion-utils";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import {
  putawayService,
  type PutawayCompartment,
  type PutawayLocationResponse,
  type PutawayReceiptDetail,
  type PutawayShelf,
  type PutawayZone,
} from "@/services/putaway";

interface LineAllocation {
  zone_id: string;
  shelf_id: string;
  compartment_id: string;
  putaway_quantity: number;
}

function getCompartment(
  compartments: PutawayCompartment[],
  compartmentId: string,
): PutawayCompartment | undefined {
  return compartments.find((c) => c.id === compartmentId);
}

/** Max putaway for this line: min(line remaining, compartment slots left vs other lines in form). */
function computeEffectivePutawayMax(
  itemId: string,
  compartmentId: string,
  allocations: Record<string, LineAllocation>,
  compartments: PutawayCompartment[],
  lineRemaining: number,
): number {
  const lineMax = Math.max(0, lineRemaining);
  if (!compartmentId) return lineMax;
  const compartment = getCompartment(compartments, compartmentId);
  if (!compartment || compartment.remaining_capacity == null) return lineMax;
  const othersOnSameCompartment = Object.entries(allocations).reduce((sum, [id, a]) => {
    if (id === itemId) return sum;
    if (a.compartment_id === compartmentId) return sum + (Number(a.putaway_quantity) || 0);
    return sum;
  }, 0);
  return Math.min(lineMax, Math.max(0, compartment.remaining_capacity - othersOnSameCompartment));
}

function validateCompartmentCapacities(
  payload: { compartment_id: string; putaway_quantity: number }[],
  compartments: PutawayCompartment[],
): string | null {
  const byCompartment = new Map<string, number>();
  for (const line of payload) {
    if (line.putaway_quantity > 0 && line.compartment_id) {
      byCompartment.set(
        line.compartment_id,
        (byCompartment.get(line.compartment_id) || 0) + line.putaway_quantity,
      );
    }
  }
  for (const [compId, total] of byCompartment) {
    const comp = getCompartment(compartments, compId);
    if (!comp || comp.remaining_capacity == null) continue;
    if (total > comp.remaining_capacity) {
      return `Ngăn ${comp.location_code}: tổng ${total} vượt sức chứa còn lại (${comp.remaining_capacity}).`;
    }
  }
  return null;
}

export function PutawayExecutePage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<PutawayReceiptDetail | null>(null);
  const [locationData, setLocationData] = useState<PutawayLocationResponse>({ warehouse_id: "", zones: [], shelves: [], compartments: [] });
  const [allocations, setAllocations] = useState<Record<string, LineAllocation>>({});

  const loadData = async () => {
    if (!id) return;

    const [receiptData, locationData] = await Promise.all([
      putawayService.getReceiptDetail(id),
      putawayService.getPutawayLocations(id),
    ]);

    setDetail(receiptData);
    setLocationData(locationData);
    setAllocations(() => {
      const next: Record<string, LineAllocation> = {};
      receiptData.items.forEach((item) => {
        next[item.id] = {
          zone_id: "",
          shelf_id: "",
          compartment_id: "",
          putaway_quantity: item.remaining_quantity > 0 ? item.remaining_quantity : 0,
        };
      });
      return next;
    });
  };

  useEffect(() => {
    const run = async () => {
      if (!id) return;
      try {
        setLoading(true);
        await loadData();
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc du lieu putaway"));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [id]);

  const lineItems = useMemo(() => detail?.items || [], [detail]);
  const invalidLineCount = useMemo(() => {
    return lineItems.filter((item) => {
      const current = allocations[item.id];
      if (!current) return true;
      const lineMax = Math.max(0, item.remaining_quantity);
      if (item.remaining_quantity <= 0) {
        return current.putaway_quantity !== 0;
      }
      if (!Number.isFinite(current.putaway_quantity) || current.putaway_quantity < 0 || current.putaway_quantity > lineMax) {
        return true;
      }
      const effMax = computeEffectivePutawayMax(
        item.id,
        current.compartment_id,
        allocations,
        locationData.compartments || [],
        lineMax,
      );
      if (current.putaway_quantity > effMax) return true;
      if (current.putaway_quantity === 0) {
        return false;
      }
      return !current.zone_id || !current.shelf_id || !current.compartment_id;
    }).length;
  }, [allocations, lineItems, locationData.compartments]);

  const shelfOptionsByZone = useMemo(() => {
    const grouped: Record<string, { id: string; location_code: string }[]> = {};
    (locationData.shelves || []).forEach((shelf: PutawayShelf) => {
      if (!grouped[shelf.zone_id]) grouped[shelf.zone_id] = [];
      grouped[shelf.zone_id].push({ id: shelf.id, location_code: shelf.location_code });
    });
    return grouped;
  }, [locationData.shelves]);

  const compartmentOptionsByShelf = useMemo(() => {
    const grouped: Record<string, PutawayCompartment[]> = {};
    (locationData.compartments || []).forEach((compartment: PutawayCompartment) => {
      if (!grouped[compartment.shelf_id]) grouped[compartment.shelf_id] = [];
      grouped[compartment.shelf_id].push(compartment);
    });
    return grouped;
  }, [locationData.compartments]);

  const updateZone = (itemId: string, zoneId: string) => {
    setAllocations((prev) => ({
      ...prev,
      [itemId]: {
        zone_id: zoneId,
        shelf_id: "",
        compartment_id: "",
        putaway_quantity: prev[itemId]?.putaway_quantity ?? 0,
      },
    }));
  };

  const updateShelf = (itemId: string, shelfId: string) => {
    setAllocations((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || { zone_id: "", shelf_id: "", compartment_id: "", putaway_quantity: 0 }),
        shelf_id: shelfId,
        compartment_id: "",
      },
    }));
  };

  const updateCompartment = (itemId: string, compartmentId: string) => {
    setAllocations((prev) => {
      const base = prev[itemId] || { zone_id: "", shelf_id: "", compartment_id: "", putaway_quantity: 0 };
      const item = lineItems.find((i) => i.id === itemId);
      const lineMax = Math.max(0, item?.remaining_quantity ?? 0);
      const next = { ...base, compartment_id: compartmentId };
      const eff = computeEffectivePutawayMax(
        itemId,
        compartmentId,
        { ...prev, [itemId]: next },
        locationData.compartments || [],
        lineMax,
      );
      return {
        ...prev,
        [itemId]: {
          ...next,
          putaway_quantity: Math.min(next.putaway_quantity, eff),
        },
      };
    });
  };

  const updatePutawayQuantity = (itemId: string, lineRemaining: number, rawValue: string) => {
    setAllocations((prev) => {
      const alloc = prev[itemId] || { zone_id: "", shelf_id: "", compartment_id: "", putaway_quantity: 0 };
      const lineMax = Math.max(0, lineRemaining);
      const effMax = computeEffectivePutawayMax(
        itemId,
        alloc.compartment_id,
        prev,
        locationData.compartments || [],
        lineMax,
      );
      const parsed = Number(rawValue);
      const nextQuantity = Number.isFinite(parsed) ? Math.max(0, Math.min(effMax, Math.trunc(parsed))) : 0;
      return {
        ...prev,
        [itemId]: {
          ...alloc,
          putaway_quantity: nextQuantity,
        },
      };
    });
  };

  const handleConfirm = async () => {
    if (!id || !detail) return;

    const payload = detail.items.map((item) => ({
      item_id: item.id,
      zone_id: allocations[item.id]?.zone_id || "",
      shelf_id: allocations[item.id]?.shelf_id || "",
      compartment_id: allocations[item.id]?.compartment_id || "",
      putaway_quantity: Number(allocations[item.id]?.putaway_quantity || 0),
    }));

    const hasInvalidLine = payload.some((line) => {
      const sourceItem = detail.items.find((item) => item.id === line.item_id);
      if (!sourceItem) return true;
      const lineMax = Math.max(0, sourceItem.remaining_quantity);
      if (sourceItem.remaining_quantity <= 0) {
        return line.putaway_quantity !== 0;
      }
      if (!Number.isFinite(line.putaway_quantity) || line.putaway_quantity < 0 || line.putaway_quantity > lineMax) {
        return true;
      }
      const effMax = computeEffectivePutawayMax(
        line.item_id,
        line.compartment_id,
        allocations,
        locationData.compartments || [],
        lineMax,
      );
      if (line.putaway_quantity > effMax) return true;
      if (line.putaway_quantity === 0) {
        return false;
      }
      return !line.zone_id || !line.shelf_id || !line.compartment_id;
    });
    if (hasInvalidLine) {
      toast.error("Vui long nhap dung so luong va chon du Vi tri/Kệ/Tang-Ngan cho cac dong co nhap ke");
      return;
    }

    const capErr = validateCompartmentCapacities(payload, locationData.compartments || []);
    if (capErr) {
      toast.error(capErr);
      return;
    }

    const allZeroQty = payload.every((line) => line.putaway_quantity === 0);
    if (allZeroQty) {
      toast.error("So luong putaway khong duoc la 0. Vui long nhap so luong lon hon 0.");
      return;
    }

    const accepted = window.confirm("Xac nhan hoan tat phan bo vi tri va ghi nhan ton kho?");
    if (!accepted) return;

    try {
      setSaving(true);
      await putawayService.confirmPutaway(id, { allocations: payload });
      toast.success("Hoan tat putaway thanh cong");
      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Hoan tat putaway that bai"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-400">Dang tai du lieu nhap len ke...</p>
      </PageWrapper>
    );
  }

  if (!detail) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-400">Khong tim thay phieu nhap.</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink to={`/putaway/${detail.id}`} className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-blue-600 transition-colors" style={{ fontWeight: 550 }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Quay lai chi tiet phieu
        </NavLink>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[12px] border border-slate-200 bg-white p-4">
          <h1 className="tracking-[-0.02em]">Nhap len ke · {detail.receipt_number}</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Kho: {detail.warehouse_code || detail.warehouse_name || "-"} · Con {invalidLineCount} dong chua hop le</p>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-gradient-to-r from-blue-50/40 to-transparent">
                {["San pham", "So luong nhap", "Vi tri", "Ke", "Tang/Ngan Ke", "So luong nhap ke", "So du vao ton kho", "Trang thai"].map((header) => (
                  <th key={header} className="text-left text-[11px] text-slate-400 px-4 py-2.5 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => {
                const lineAllocation = allocations[item.id] || { zone_id: "", shelf_id: "", compartment_id: "", putaway_quantity: 0 };
                const shelfOptions = lineAllocation.zone_id ? (shelfOptionsByZone[lineAllocation.zone_id] || []) : [];
                const compartmentOptions = lineAllocation.shelf_id ? (compartmentOptionsByShelf[lineAllocation.shelf_id] || []) : [];
                const lineMax = Math.max(0, item.remaining_quantity);
                const remainToStock = Math.max(item.remaining_quantity - Number(lineAllocation.putaway_quantity || 0), 0);
                const putawayQty = Number(lineAllocation.putaway_quantity || 0);
                const isDone = putawayQty > 0 && Boolean(lineAllocation.zone_id && lineAllocation.shelf_id && lineAllocation.compartment_id);
                const rowDisabled = item.remaining_quantity <= 0;
                return (
                  <tr key={item.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 text-[12px]">
                      <p style={{ fontWeight: 600 }}>{item.book_title}</p>
                      <p className="text-slate-400">{item.isbn13 || item.sku || item.barcode || item.variant_id.slice(0, 8)}</p>
                    </td>
                    <td className="px-4 py-3 text-[12px]" style={{ fontWeight: 600 }}>{item.quantity}</td>
                    <td className="px-4 py-3">
                      <select
                        value={lineAllocation.zone_id}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => updateZone(item.id, event.target.value)}
                        disabled={rowDisabled}
                        className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px] outline-none focus:ring-[3px] focus:ring-violet-500/15 disabled:opacity-60"
                      >
                        <option value="">Chon Zone</option>
                        {locationData.zones.map((zone: PutawayZone) => (
                          <option key={zone.id} value={zone.id}>{zone.location_code}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={lineAllocation.shelf_id}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => updateShelf(item.id, event.target.value)}
                        disabled={rowDisabled || !lineAllocation.zone_id}
                        className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px] outline-none focus:ring-[3px] focus:ring-violet-500/15 disabled:opacity-60"
                      >
                        <option value="">Chon Shelf</option>
                        {shelfOptions.map((shelf: { id: string; location_code: string }) => (
                          <option key={shelf.id} value={shelf.id}>{shelf.location_code}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={lineAllocation.compartment_id}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => updateCompartment(item.id, event.target.value)}
                        disabled={rowDisabled || !lineAllocation.shelf_id}
                        className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px] outline-none focus:ring-[3px] focus:ring-violet-500/15 disabled:opacity-60"
                      >
                        <option value="">Chon Tang/Ngan Ke</option>
                        {compartmentOptions.map((compartment: PutawayCompartment) => (
                          <option key={compartment.id} value={compartment.id}>
                            {compartment.location_code}
                            {compartment.remaining_capacity != null
                              ? ` (con ${compartment.remaining_capacity})`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        max={lineMax}
                        value={lineAllocation.putaway_quantity}
                        disabled={rowDisabled}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => updatePutawayQuantity(item.id, item.remaining_quantity, event.target.value)}
                        className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px] outline-none focus:ring-[3px] focus:ring-violet-500/15 disabled:opacity-60"
                      />
                    </td>
                    <td className="px-4 py-3 text-[12px] text-blue-700" style={{ fontWeight: 600 }}>{remainToStock}</td>
                    <td className="px-4 py-3 text-[12px]" style={{ fontWeight: 600 }}>
                      {rowDisabled ? (
                        <span className="text-slate-400">Da xong</span>
                      ) : isDone ? (
                        <span className="text-emerald-700">Da phan bo</span>
                      ) : putawayQty === 0 ? (
                        <span className="text-slate-500">Khong nhap ke</span>
                      ) : (
                        <span className="text-amber-700">Chua phan bo</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="flex justify-end">
          <button
            onClick={handleConfirm}
            disabled={saving || lineItems.length === 0 || invalidLineCount > 0}
            className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-violet-600 px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? "Dang xu ly..." : "Hoan tat putaway"}
          </button>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
