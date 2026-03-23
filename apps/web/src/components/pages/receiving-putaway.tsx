import { useEffect, useMemo, useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { ArrowRightLeft, RefreshCw, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import {
  receivingPutawayService,
  type PutawayCandidate,
  type ReceivingItem,
  type ReceivingLocation,
  type VariantLookupMatch,
} from "@/services/receiving-putaway";

interface DraftAllocationLine {
  id: string;
  target_location_id: string;
  quantity: number;
  reason: string;
  scanned_location_barcode: string;
  scanned_product_barcode: string;
}

function makeLineId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ReceivingPutawayPage() {
  const [loading, setLoading] = useState(true);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [loadingReverseItems, setLoadingReverseItems] = useState(false);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [savingReverse, setSavingReverse] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");

  const [receivings, setReceivings] = useState<ReceivingLocation[]>([]);
  const [selectedReceivingId, setSelectedReceivingId] = useState("");
  const [receivingItems, setReceivingItems] = useState<ReceivingItem[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");

  const [candidates, setCandidates] = useState<PutawayCandidate[]>([]);
  const [draftLines, setDraftLines] = useState<DraftAllocationLine[]>([]);
  const [scanSkuInput, setScanSkuInput] = useState("");
  const [scanTargetBarcodeInput, setScanTargetBarcodeInput] = useState("");
  const [ambiguousVariantMatches, setAmbiguousVariantMatches] = useState<VariantLookupMatch[]>([]);

  const [occupiedCompartments, setOccupiedCompartments] = useState<Array<{ id: string; location_code: string; on_hand_qty: number }>>([]);
  const [selectedReverseCompartmentId, setSelectedReverseCompartmentId] = useState("");
  const [reverseItems, setReverseItems] = useState<ReceivingItem[]>([]);
  const [reverseVariantId, setReverseVariantId] = useState("");
  const [reverseReceivingId, setReverseReceivingId] = useState("");
  const [reverseQuantity, setReverseQuantity] = useState(0);
  const [reverseReason, setReverseReason] = useState("");

  const selectedVariantItem = useMemo(
    () => receivingItems.find((item) => item.variant_id === selectedVariantId) || null,
    [receivingItems, selectedVariantId],
  );

  const totalDraftQty = useMemo(
    () => draftLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    [draftLines],
  );

  const candidateMap = useMemo(() => {
    const map = new Map<string, PutawayCandidate>();
    candidates.forEach((item) => map.set(item.id, item));
    return map;
  }, [candidates]);

  const reverseItem = useMemo(
    () => reverseItems.find((item) => item.variant_id === reverseVariantId) || null,
    [reverseItems, reverseVariantId],
  );

  const loadWarehouseContext = async (warehouseId: string) => {
    if (!warehouseId) {
      setReceivings([]);
      setReceivingItems([]);
      setSelectedReceivingId("");
      setSelectedVariantId("");
      setCandidates([]);
      setDraftLines([]);
      setOccupiedCompartments([]);
      setSelectedReverseCompartmentId("");
      setReverseItems([]);
      setReverseVariantId("");
      setReverseReceivingId("");
      return;
    }

    const [receivingRes, occupiedRes] = await Promise.all([
      receivingPutawayService.getReceivings(warehouseId),
      receivingPutawayService.getOccupiedCompartments(warehouseId),
    ]);

    const nextReceivings = receivingRes.receivings || [];
    setReceivings(nextReceivings);
    setOccupiedCompartments(occupiedRes.compartments || []);

    const nextReceivingId = nextReceivings[0]?.id || "";
    setSelectedReceivingId(nextReceivingId);
    setReverseReceivingId(nextReceivingId);

    setReceivingItems([]);
    setSelectedVariantId("");
    setCandidates([]);
    setDraftLines([]);
  };

  const loadReceivingItems = async (receivingId: string) => {
    if (!receivingId) {
      setReceivingItems([]);
      setSelectedVariantId("");
      setCandidates([]);
      setDraftLines([]);
      return;
    }

    const res = await receivingPutawayService.getReceivingItems(receivingId);
    const items = res.items || [];
    setReceivingItems(items);
    const preferredVariantId = items[0]?.variant_id || "";
    setSelectedVariantId(preferredVariantId);
    setDraftLines([]);
    setCandidates([]);
  };

  const loadCandidates = async (receivingId: string, variantId: string) => {
    if (!receivingId || !variantId) {
      setCandidates([]);
      return;
    }

    setLoadingCandidates(true);
    try {
      const res = await receivingPutawayService.getCandidates(receivingId, variantId);
      setCandidates(res.candidates || []);
      setDraftLines([]);
      if ((res.candidates || []).length > 0) {
        const top = res.candidates[0];
        setDraftLines([
          {
            id: makeLineId(),
            target_location_id: top.id,
            quantity: 1,
            reason: "",
            scanned_location_barcode: "",
            scanned_product_barcode: "",
          },
        ]);
      }
    } finally {
      setLoadingCandidates(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const data = await warehouseService.getAll();
        const rows = Array.isArray(data) ? data : [];
        setWarehouses(rows);
        const preferredWarehouseId = rows[0]?.id || "";
        setSelectedWarehouseId(preferredWarehouseId);
        await loadWarehouseContext(preferredWarehouseId);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc du lieu kho"));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    if (!selectedWarehouseId) return;
    void loadWarehouseContext(selectedWarehouseId).catch((error) => {
      toast.error(getApiErrorMessage(error, "Khong tai duoc du lieu warehouse"));
    });
  }, [selectedWarehouseId]);

  useEffect(() => {
    if (!selectedReceivingId) return;
    void loadReceivingItems(selectedReceivingId).catch((error) => {
      toast.error(getApiErrorMessage(error, "Khong tai duoc ton RECEIVING"));
    });
  }, [selectedReceivingId]);

  useEffect(() => {
    if (!selectedReceivingId || !selectedVariantId) return;
    void loadCandidates(selectedReceivingId, selectedVariantId).catch((error) => {
      toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach vi tri de xep"));
    });
  }, [selectedReceivingId, selectedVariantId]);

  useEffect(() => {
    if (!selectedReverseCompartmentId) {
      setReverseItems([]);
      setReverseVariantId("");
      setReverseQuantity(0);
      return;
    }

    const run = async () => {
      try {
        setLoadingReverseItems(true);
        const res = await receivingPutawayService.getCompartmentItems(selectedReverseCompartmentId);
        setReverseItems(res.items || []);
        setReverseVariantId(res.items?.[0]?.variant_id || "");
        setReverseQuantity(0);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc SKU trong compartment"));
      } finally {
        setLoadingReverseItems(false);
      }
    };

    void run();
  }, [selectedReverseCompartmentId]);

  const addDraftLine = () => {
    if (candidates.length === 0) {
      toast.error("Khong con vi tri nao co cho trong");
      return;
    }

    setDraftLines((prev) => ([
      ...prev,
      {
        id: makeLineId(),
        target_location_id: candidates[0].id,
        quantity: 1,
        reason: "",
        scanned_location_barcode: "",
        scanned_product_barcode: "",
      },
    ]));
  };

  const updateLine = (id: string, patch: Partial<DraftAllocationLine>) => {
    setDraftLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const removeLine = (id: string) => {
    setDraftLines((prev) => prev.filter((line) => line.id !== id));
  };

  const handleScanSku = async () => {
    const input = scanSkuInput.trim().replace(/[^0-9]/g, "");
    if (!input) {
      toast.error("Nhap ISBN13 truoc khi scan");
      return;
    }

    if (!/^\d{13}$/.test(input)) {
      toast.error("ISBN13 phai gom dung 13 chu so");
      return;
    }

    try {
      const res = await receivingPutawayService.lookupVariantByIsbn13(input);
      if (res.ambiguous) {
        setAmbiguousVariantMatches(res.matches || []);
        toast.error("ISBN13 trung nhieu SKU, vui long chon thu cong");
        return;
      }

      const selected = res.selected;
      if (!selected) {
        toast.error("Khong tim thay SKU hop le");
        return;
      }

      setAmbiguousVariantMatches([]);

      const inReceiving = receivingItems.find((item) => item.variant_id === selected.variant_id);
      if (!inReceiving) {
        toast.error("SKU nay khong ton tai trong RECEIVING dang chon");
        return;
      }

      setSelectedVariantId(selected.variant_id);
      setDraftLines((prev) => prev.map((line) => ({ ...line, scanned_product_barcode: input })));
      toast.success(`Da chon SKU: ${selected.book_title}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Scan SKU that bai"));
    }
  };

  const handleScanTargetLocation = async () => {
    if (!selectedWarehouseId || draftLines.length === 0) {
      toast.error("Vui long chon warehouse va tao draft line truoc");
      return;
    }

    const barcode = scanTargetBarcodeInput.trim();
    if (!barcode) {
      toast.error("Nhap barcode vi tri dich truoc khi scan");
      return;
    }

    try {
      const location = await receivingPutawayService.lookupLocationByBarcode(selectedWarehouseId, barcode);
      if (!candidateMap.has(location.id)) {
        toast.error("Vi tri scan duoc khong nam trong danh sach compartment con cho trong");
        return;
      }

      const firstLineId = draftLines[0].id;
      updateLine(firstLineId, {
        target_location_id: location.id,
        scanned_location_barcode: barcode,
      });
      toast.success(`Da ap dung vi tri ${location.location_code} cho dong dau tien`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Scan vi tri that bai"));
    }
  };

  const validateDraft = (): string | null => {
    if (!selectedVariantItem) return "Chua chon SKU nguon";
    if (draftLines.length === 0) return "Chua co allocation nao";

    for (const line of draftLines) {
      const qty = Number(line.quantity || 0);
      if (!line.target_location_id || !Number.isFinite(qty) || qty <= 0) {
        return "Moi dong allocation phai co vi tri dich va so luong > 0";
      }

      if (!line.reason.trim()) {
        return "Moi dong allocation bat buoc co ly do";
      }

      const candidate = candidateMap.get(line.target_location_id);
      if (!candidate) {
        return "Co vi tri dich khong hop le";
      }

      if (qty > candidate.remaining_capacity) {
        return `So luong vuot qua suc chua con lai tai ${candidate.location_code}`;
      }
    }

    if (totalDraftQty > selectedVariantItem.on_hand_qty) {
      return "Tong so luong allocation vuot qua ton trong RECEIVING";
    }

    return null;
  };

  const handleConfirmTransfer = async () => {
    if (!selectedWarehouseId || !selectedReceivingId || !selectedVariantId) {
      toast.error("Chua chon day du warehouse / receiving / sku");
      return;
    }

    const validationError = validateDraft();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      setSavingTransfer(true);
      const payload = {
        warehouse_id: selectedWarehouseId,
        source_receiving_location_id: selectedReceivingId,
        variant_id: selectedVariantId,
        allocations: draftLines.map((line) => ({
          target_location_id: line.target_location_id,
          quantity: Number(line.quantity),
          reason: line.reason.trim(),
          scanned_location_barcode: line.scanned_location_barcode || null,
          scanned_product_barcode: line.scanned_product_barcode || null,
        })),
      };

      const res = await receivingPutawayService.transfer(payload);

      // Draft remains frontend-only and is fully cleared after successful commit.
      setDraftLines([]);
      setScanSkuInput("");
      setScanTargetBarcodeInput("");
      setAmbiguousVariantMatches([]);

      await Promise.all([
        loadReceivingItems(selectedReceivingId),
        loadCandidates(selectedReceivingId, selectedVariantId),
      ]);

      toast.success(`Da chuyen ${res.data.moved_quantity} quyen len ke (${res.data.allocation_count} vi tri)`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xac nhan chuyen that bai"));
    } finally {
      setSavingTransfer(false);
    }
  };

  const handleReverse = async () => {
    if (!selectedWarehouseId || !selectedReverseCompartmentId || !reverseReceivingId || !reverseVariantId) {
      toast.error("Vui long chon day du thong tin reverse");
      return;
    }

    const qty = Number(reverseQuantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("So luong reverse phai > 0");
      return;
    }

    if (!reverseReason.trim()) {
      toast.error("Ly do reverse la bat buoc");
      return;
    }

    if (!reverseItem || qty > reverseItem.on_hand_qty) {
      toast.error("So luong reverse vuot qua ton trong compartment");
      return;
    }

    try {
      setSavingReverse(true);
      const res = await receivingPutawayService.reverse({
        warehouse_id: selectedWarehouseId,
        source_compartment_location_id: selectedReverseCompartmentId,
        target_receiving_location_id: reverseReceivingId,
        variant_id: reverseVariantId,
        quantity: qty,
        reason: reverseReason.trim(),
      });

      setReverseReason("");
      setReverseQuantity(0);

      await Promise.all([
        loadWarehouseContext(selectedWarehouseId),
        selectedReceivingId ? loadReceivingItems(selectedReceivingId) : Promise.resolve(),
        selectedReceivingId && selectedVariantId ? loadCandidates(selectedReceivingId, selectedVariantId) : Promise.resolve(),
      ]);

      toast.success(`Da tra ve RECEIVING ${res.data.moved_quantity} quyen`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Reverse that bai"));
    } finally {
      setSavingReverse(false);
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-400">Dang tai module Receiving - Shelf Putaway...</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-amber-100 to-orange-50 flex items-center justify-center border border-amber-200/40">
            <ArrowRightLeft className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h1 className="tracking-[-0.02em]">Receiving - Shelf Putaway</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">Chuyen hang tu RECEIVING len SHELF_COMPARTMENT va reverse nguoc lai</p>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[12px] border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <p className="text-[11px] text-slate-500 mb-1">Warehouse</p>
            <select
              value={selectedWarehouseId}
              onChange={(event) => setSelectedWarehouseId(event.target.value)}
              className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
            >
              <option value="">Chon warehouse</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 mb-1">Receiving source</p>
            <select
              value={selectedReceivingId}
              onChange={(event) => setSelectedReceivingId(event.target.value)}
              className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
            >
              <option value="">Chon RECEIVING/STAGING</option>
              {receivings.map((location) => (
                <option key={location.id} value={location.id}>{location.location_code} ({location.location_type})</option>
              ))}
            </select>
          </div>
          <div className="flex items-end justify-end">
            <button
              onClick={() => selectedWarehouseId && loadWarehouseContext(selectedWarehouseId)}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 px-3 py-2 text-[12px] hover:bg-slate-50"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reload
            </button>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[12px] border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-[13px]" style={{ fontWeight: 650 }}>A. Receiving -&gt; Shelf</h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] text-slate-500 mb-1">SKU trong RECEIVING</p>
              <select
                value={selectedVariantId}
                onChange={(event) => setSelectedVariantId(event.target.value)}
                className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
              >
                <option value="">Chon SKU</option>
                {receivingItems.map((item) => (
                  <option key={item.variant_id} value={item.variant_id}>
                    {(item.isbn13 || item.sku || item.barcode || item.variant_id.slice(0, 8))} | {item.book_title} | on_hand {item.on_hand_qty}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 mb-1">Scan ISBN13 cua sach</p>
              <div className="flex gap-2">
                <input
                  value={scanSkuInput}
                  onChange={(event) => setScanSkuInput(event.target.value)}
                  placeholder="Nhap ISBN13"
                  className="flex-1 rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
                />
                <button onClick={handleScanSku} className="rounded-[10px] border border-slate-200 px-3 py-2 text-[12px] hover:bg-slate-50">
                  <ScanLine className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 mb-1">Scan barcode vi tri dich</p>
              <div className="flex gap-2">
                <input
                  value={scanTargetBarcodeInput}
                  onChange={(event) => setScanTargetBarcodeInput(event.target.value)}
                  placeholder="locations.barcode (SHELF_COMPARTMENT)"
                  className="flex-1 rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
                />
                <button onClick={handleScanTargetLocation} className="rounded-[10px] border border-slate-200 px-3 py-2 text-[12px] hover:bg-slate-50">
                  <ScanLine className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {ambiguousVariantMatches.length > 0 ? (
            <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-3">
              <p className="text-[12px] text-amber-800" style={{ fontWeight: 600 }}>ISBN13 trung nhieu SKU, vui long chon thu cong:</p>
              <select
                className="mt-2 w-full rounded-[10px] border border-amber-200 px-3 py-2 text-[12px]"
                onChange={(event) => {
                  const variantId = event.target.value;
                  if (!variantId) return;
                  setSelectedVariantId(variantId);
                  setAmbiguousVariantMatches([]);
                }}
                value=""
              >
                <option value="">Chon SKU dung</option>
                {ambiguousVariantMatches.map((item) => (
                  <option key={item.variant_id} value={item.variant_id}>
                    {item.isbn13 || item.sku || item.internal_barcode || item.isbn10} | {item.book_title} | {item.matched_by}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="rounded-[10px] border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {[
                    'Compartment',
                    'Zone',
                    'Shelf',
                    'Current',
                    'Max',
                    'Remaining',
                    'Mixed SKU',
                    'Priority',
                  ].map((head) => (
                    <th key={head} className="px-3 py-2 text-left text-[11px] text-slate-500 uppercase">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingCandidates ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-[12px] text-slate-400">Dang tinh goi y vi tri...</td></tr>
                ) : candidates.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-[12px] text-slate-400">Khong co compartment con cho trong</td></tr>
                ) : candidates.map((candidate) => (
                  <tr key={candidate.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 text-[12px]" style={{ fontWeight: 600 }}>{candidate.location_code}</td>
                    <td className="px-3 py-2 text-[12px]">{candidate.zone_code}</td>
                    <td className="px-3 py-2 text-[12px]">{candidate.shelf_code}</td>
                    <td className="px-3 py-2 text-[12px]">{candidate.current_on_hand}</td>
                    <td className="px-3 py-2 text-[12px]">{candidate.max_capacity}</td>
                    <td className="px-3 py-2 text-[12px] text-emerald-700" style={{ fontWeight: 600 }}>{candidate.remaining_capacity}</td>
                    <td className="px-3 py-2 text-[12px]">{candidate.mixed_sku_count}</td>
                    <td className="px-3 py-2 text-[12px]">{candidate.priority_group === 0 ? 'Same shelf' : candidate.priority_group === 1 ? 'Same zone' : 'Other'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-500">Draft allocation frontend-only. Tong draft: {totalDraftQty} / on_hand source: {selectedVariantItem?.on_hand_qty || 0}</p>
            <button onClick={addDraftLine} className="rounded-[10px] border border-slate-200 px-3 py-2 text-[12px] hover:bg-slate-50">Them dong allocation</button>
          </div>

          <div className="space-y-2">
            {draftLines.length === 0 ? (
              <p className="text-[12px] text-slate-400">Chua co draft allocation.</p>
            ) : draftLines.map((line) => {
              const lineCandidate = candidateMap.get(line.target_location_id);
              return (
                <div key={line.id} className="rounded-[10px] border border-slate-200 p-3 grid grid-cols-1 lg:grid-cols-6 gap-2 items-end">
                  <div>
                    <p className="text-[11px] text-slate-500 mb-1">Compartment</p>
                    <select
                      value={line.target_location_id}
                      onChange={(event) => updateLine(line.id, { target_location_id: event.target.value })}
                      className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
                    >
                      <option value="">Chon vi tri dich</option>
                      {candidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.location_code} (rem {candidate.remaining_capacity})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 mb-1">Quantity</p>
                    <input
                      type="number"
                      min={1}
                      max={lineCandidate?.remaining_capacity || 1}
                      value={line.quantity}
                      onChange={(event) => updateLine(line.id, { quantity: Math.max(1, Math.trunc(Number(event.target.value || 1))) })}
                      className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <p className="text-[11px] text-slate-500 mb-1">Ly do (bat buoc)</p>
                    <input
                      value={line.reason}
                      onChange={(event) => updateLine(line.id, { reason: event.target.value })}
                      placeholder="Vi du: sap xep lai de de thao tac"
                      className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 mb-1">Scan tags</p>
                    <p className="text-[11px] text-slate-400 truncate">{line.scanned_location_barcode || '-'} | {line.scanned_product_barcode || '-'}</p>
                  </div>
                  <div>
                    <button
                      onClick={() => removeLine(line.id)}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Xoa
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleConfirmTransfer}
              disabled={savingTransfer || draftLines.length === 0}
              className="rounded-[10px] bg-violet-600 text-white px-4 py-2.5 text-[12px] font-semibold disabled:opacity-60"
            >
              {savingTransfer ? 'Dang chuyen...' : 'Xac nhan chuyen tu RECEIVING len ke'}
            </button>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[12px] border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-[13px]" style={{ fontWeight: 650 }}>B. Reverse tu Shelf ve Receiving</h2>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Source compartment</p>
              <select
                value={selectedReverseCompartmentId}
                onChange={(event) => setSelectedReverseCompartmentId(event.target.value)}
                className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
              >
                <option value="">Chon compartment co hang</option>
                {occupiedCompartments.map((compartment) => (
                  <option key={compartment.id} value={compartment.id}>{compartment.location_code} (on_hand {compartment.on_hand_qty})</option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 mb-1">SKU trong compartment</p>
              <select
                value={reverseVariantId}
                onChange={(event) => setReverseVariantId(event.target.value)}
                className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
                disabled={loadingReverseItems}
              >
                <option value="">Chon SKU</option>
                {reverseItems.map((item) => (
                  <option key={item.variant_id} value={item.variant_id}>
                    {(item.isbn13 || item.sku || item.barcode || item.variant_id.slice(0, 8))} | on_hand {item.on_hand_qty}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 mb-1">Receiving dich</p>
              <select
                value={reverseReceivingId}
                onChange={(event) => setReverseReceivingId(event.target.value)}
                className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
              >
                <option value="">Chon RECEIVING dich</option>
                {receivings.map((receiving) => (
                  <option key={receiving.id} value={receiving.id}>{receiving.location_code}</option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 mb-1">Quantity reverse</p>
              <input
                type="number"
                min={1}
                max={reverseItem?.on_hand_qty || 1}
                value={reverseQuantity}
                onChange={(event) => setReverseQuantity(Math.max(0, Math.trunc(Number(event.target.value || 0))))}
                className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
              />
            </div>

            <div>
              <p className="text-[11px] text-slate-500 mb-1">Ly do reverse</p>
              <input
                value={reverseReason}
                onChange={(event) => setReverseReason(event.target.value)}
                placeholder="Ly do bat buoc"
                className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleReverse}
              disabled={savingReverse}
              className="rounded-[10px] bg-amber-600 text-white px-4 py-2.5 text-[12px] font-semibold disabled:opacity-60"
            >
              {savingReverse ? 'Dang reverse...' : 'Reverse ve RECEIVING'}
            </button>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
