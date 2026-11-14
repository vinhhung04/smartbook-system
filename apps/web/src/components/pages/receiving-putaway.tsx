import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, ChevronDown, Plus, RefreshCw, ScanLine, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { FadeItem, PageWrapper } from "../motion-utils";
import { getApiErrorMessage } from "@/services/api.ts";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import {
  receivingPutawayService,
  type PutawayCandidate,
  type ReceivingItem,
  type ReceivingLocation,
  type VariantLookupMatch,
} from "@/services/receiving-putaway";
import { StorageSuggestionPanel } from "@/components/inventory/StorageSuggestionPanel";
import { authService } from "@/services/auth";
import { canManageReceiving } from "@/lib/rbac";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/components/ui/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { numberInputValue, zeroFieldProps } from "@/lib/number-input";

interface DraftAllocationLine {
  id: string;
  target_location_id: string;
  quantity: number;
  reason: string;
  scanned_location_barcode: string;
  scanned_product_barcode: string;
}

const LOCATION_TYPE_LABEL: Record<string, string> = {
  RECEIVING: "Khu nhận hàng",
  STAGING: "Khu tập kết",
};

function makeLineId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface PutawayContext {
  warehouseId?: string;
  variantId?: string;
  bookTitle?: string;
  goodsReceiptId?: string;
  maxQuantity?: number;
}

export function ReceivingPutawayPage() {
  const routerLocation = useLocation();
  const lockedCtx: PutawayContext = (routerLocation.state as PutawayContext) || {};
  const isWarehouseLocked = Boolean(lockedCtx.warehouseId);
  const isVariantLocked = Boolean(lockedCtx.variantId);
  const [receiptMaxQty, setReceiptMaxQty] = useState<number | null>(
    typeof lockedCtx.maxQuantity === 'number' ? lockedCtx.maxQuantity : null
  );

  const currentUser = authService.getCurrentUser();
  const isManager = canManageReceiving(currentUser);

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

  // The line auto-created from the first candidate. Picking a suggested
  // location replaces it while the user has not edited it yet.
  const [defaultLineId, setDefaultLineId] = useState<string | null>(null);

  const selectedVariantItem = useMemo(
    () => receivingItems.find((item) => item.variant_id === selectedVariantId) || null,
    [receivingItems, selectedVariantId],
  );

  const totalDraftQty = useMemo(
    () => draftLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    [draftLines],
  );

  // How many books this putaway still has to place: the source stock, capped
  // by what the goods receipt has left when coming from a receipt.
  const neededQty = selectedVariantItem
    ? Math.min(selectedVariantItem.on_hand_qty, receiptMaxQty ?? Number.POSITIVE_INFINITY)
    : 0;
  const remainingToAllocate = Math.max(0, neededQty - totalDraftQty);
  // Picking a suggestion replaces the untouched default line, so suggestions
  // are requested for everything not covered by lines the user chose.
  const defaultLineQty = Number(draftLines.find((line) => line.id === defaultLineId)?.quantity || 0);
  const remainingForSuggestions = neededQty - (totalDraftQty - defaultLineQty);
  // Once chosen lines cover everything, stop re-ranking so the list the user
  // picked from stays on screen.
  const suggestionsPaused = remainingForSuggestions <= 0;
  // Coming from a goods receipt whose remaining quantity is now fully on shelves.
  const receiptDone = receiptMaxQty !== null && receiptMaxQty <= 0;
  const suggestionQty = Math.max(1, suggestionsPaused ? neededQty : remainingForSuggestions);

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

  const loadReceivingItems = useCallback(async (receivingId: string) => {
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
    const lockedVariantExists = lockedCtx.variantId && items.some((i) => i.variant_id === lockedCtx.variantId);
    if (lockedCtx.variantId && !lockedVariantExists) {
      toast.warning("Không tìm thấy sách này trong khu nhận hàng đang chọn. Hãy thử chọn khu khác.");
    }
    const preferredVariantId = (lockedVariantExists ? lockedCtx.variantId : items[0]?.variant_id) || "";
    setSelectedVariantId(preferredVariantId);
    setDraftLines([]);
    setCandidates([]);
  }, [lockedCtx.variantId]);

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
      setDefaultLineId(null);
      if ((res.candidates || []).length > 0) {
        const top = res.candidates[0];
        const lineId = makeLineId();
        setDefaultLineId(lineId);
        setDraftLines([
          {
            id: lineId,
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
        const data = await warehouseService.getReceivingWarehouses();
        const rows = Array.isArray(data) ? data : [];
        setWarehouses(rows);
        const preferredWarehouseId = lockedCtx.warehouseId || rows[0]?.id || "";
        setSelectedWarehouseId(preferredWarehouseId);
        await loadWarehouseContext(preferredWarehouseId);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được dữ liệu kho"));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [lockedCtx.warehouseId]);

  useEffect(() => {
    if (!selectedWarehouseId) return;
    void loadWarehouseContext(selectedWarehouseId).catch((error) => {
      toast.error(getApiErrorMessage(error, "Không tải được dữ liệu kho"));
    });
  }, [selectedWarehouseId]);

  useEffect(() => {
    if (!selectedReceivingId) return;
    void loadReceivingItems(selectedReceivingId).catch((error) => {
      toast.error(getApiErrorMessage(error, "Không tải được tồn kho khu nhận hàng"));
    });
  }, [selectedReceivingId, loadReceivingItems]);

  useEffect(() => {
    if (!selectedReceivingId || !selectedVariantId) return;
    void loadCandidates(selectedReceivingId, selectedVariantId).catch((error) => {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách vị trí để xếp"));
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
        toast.error(getApiErrorMessage(error, "Không tải được SKU trong ngăn"));
      } finally {
        setLoadingReverseItems(false);
      }
    };

    void run();
  }, [selectedReverseCompartmentId]);

  const addDraftLine = () => {
    if (candidates.length === 0) {
      toast.error("Không còn vị trí nào có chỗ trống");
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
    if (id === defaultLineId) setDefaultLineId(null);
    setDraftLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const removeLine = (id: string) => {
    setDraftLines((prev) => prev.filter((line) => line.id !== id));
  };

  const handleScanSku = async () => {
    const input = scanSkuInput.trim().replace(/[^0-9]/g, "");
    if (!input) {
      toast.error("Nhập ISBN13 trước khi quét");
      return;
    }

    if (!/^\d{13}$/.test(input)) {
      toast.error("ISBN13 phải đúng 13 chữ số");
      return;
    }

    try {
      const res = await receivingPutawayService.lookupVariantByIsbn13(input);
      if (res.ambiguous) {
        setAmbiguousVariantMatches(res.matches || []);
        toast.error("ISBN13 trùng nhiều SKU, vui lòng chọn thủ công");
        return;
      }

      const selected = res.selected;
      if (!selected) {
        toast.error("Không tìm thấy SKU hợp lệ");
        return;
      }

      setAmbiguousVariantMatches([]);

      const inReceiving = receivingItems.find((item) => item.variant_id === selected.variant_id);
      if (!inReceiving) {
        toast.error("Sách này không có trong khu nhận hàng đang chọn");
        return;
      }

      setSelectedVariantId(selected.variant_id);
      setDraftLines((prev) => prev.map((line) => ({ ...line, scanned_product_barcode: input })));
      toast.success(`Đã chọn SKU: ${selected.book_title}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Quét SKU thất bại"));
    }
  };

  const handleScanTargetLocation = async () => {
    if (!selectedWarehouseId || draftLines.length === 0) {
      toast.error("Vui lòng chọn kho và tạo dòng phân bổ trước");
      return;
    }

    const barcode = scanTargetBarcodeInput.trim();
    if (!barcode) {
      toast.error("Nhập barcode vị trí đích trước khi quét");
      return;
    }

    try {
      console.debug("[receiving-putaway] scan target location", {
        raw_input: barcode,
        normalized_input: barcode.toUpperCase(),
        api: "/api/receiving-putaway/lookup/location-by-barcode",
      });

      const location = await receivingPutawayService.lookupLocationByBarcode(selectedWarehouseId, barcode);
      const matchedCandidate = candidateMap.get(location.id);
      if (!matchedCandidate) {
        console.debug("[receiving-putaway] scan target location result", {
          raw_input: barcode,
          normalized_barcode: location.normalized_barcode,
          matched_location_id: location.id,
          matched_compartment: location.location_code,
          result: "NOT_IN_CANDIDATES",
        });
        toast.error("Vị trí quét được không nằm trong danh sách ngăn còn chỗ trống");
        return;
      }

      const firstLineId = draftLines[0].id;
      updateLine(firstLineId, {
        target_location_id: location.id,
        scanned_location_barcode: location.normalized_barcode,
      });
      console.debug("[receiving-putaway] scan target location result", {
        raw_input: barcode,
        normalized_barcode: location.normalized_barcode,
        matched_location_id: location.id,
        matched_compartment: location.location_code,
        remaining_capacity: matchedCandidate.remaining_capacity,
        result: "SUCCESS",
      });
      toast.success(`Đã áp dụng vị trí ${location.location_code} cho dòng đầu tiên`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Quét vị trí thất bại"));
    }
  };

  const validateDraft = (): string | null => {
    if (!selectedVariantItem) return "Chưa chọn sách cần cất";
    if (draftLines.length === 0) return "Chưa có dòng phân bổ nào";

    for (const line of draftLines) {
      const qty = Number(line.quantity || 0);
      if (!line.target_location_id || !Number.isFinite(qty) || qty <= 0) {
        return "Mỗi dòng phân bổ phải có vị trí đích và số lượng lớn hơn 0";
      }

      if (!line.reason.trim()) {
        return "Mỗi dòng phân bổ bắt buộc có lý do";
      }

      const candidate = candidateMap.get(line.target_location_id);
      if (!candidate) {
        return "Có vị trí đích không hợp lệ";
      }

      if (qty > candidate.remaining_capacity) {
        return `Số lượng vượt quá sức chứa còn lại tại ${candidate.location_code}`;
      }
    }

    if (totalDraftQty > selectedVariantItem.on_hand_qty) {
      return "Tổng số lượng phân bổ vượt quá tồn trong khu nhận hàng";
    }

    if (receiptMaxQty !== null && totalDraftQty > receiptMaxQty) {
      return `Phiếu này còn ${receiptMaxQty} cuốn chưa nhập kệ. Không thể nhập quá số lượng còn lại của phiếu.`;
    }

    return null;
  };

  const handleConfirmTransfer = async () => {
    if (!selectedWarehouseId || !selectedReceivingId || !selectedVariantId) {
      toast.error("Chưa chọn đủ kho / khu nhận hàng / sách");
      return;
    }

    if (savingTransfer) return;

    const validationError = validateDraft();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      setSavingTransfer(true);
      const idempotencyKey = `transfer-${selectedReceivingId}-${selectedVariantId}-${Date.now()}`;
      const payload = {
        warehouse_id: selectedWarehouseId,
        source_receiving_location_id: selectedReceivingId,
        variant_id: selectedVariantId,
        goods_receipt_id: lockedCtx.goodsReceiptId || null,
        allocations: draftLines.map((line) => ({
          target_location_id: line.target_location_id,
          quantity: Number(line.quantity),
          reason: line.reason.trim(),
          scanned_location_barcode: line.scanned_location_barcode || null,
          scanned_product_barcode: line.scanned_product_barcode || null,
        })),
        idempotency_key: idempotencyKey,
      };

      const movedQty: number = draftLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
      const res = await receivingPutawayService.transfer(payload);

      setDraftLines([]);
      setScanSkuInput("");
      setScanTargetBarcodeInput("");
      setAmbiguousVariantMatches([]);
      if (receiptMaxQty !== null) {
        setReceiptMaxQty(Math.max(0, receiptMaxQty - movedQty));
      }

      await Promise.all([
        loadWarehouseContext(selectedWarehouseId),
        loadReceivingItems(selectedReceivingId),
        loadCandidates(selectedReceivingId, selectedVariantId),
      ]);

      toast.success(`Đã chuyển ${res.data.moved_quantity} quyển lên kệ (${res.data.allocation_count} vị trí)`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xác nhận chuyển thất bại"));
    } finally {
      setSavingTransfer(false);
    }
  };

  const handleReverse = async () => {
    if (!selectedWarehouseId || !selectedReverseCompartmentId || !reverseReceivingId || !reverseVariantId) {
      toast.error("Vui lòng chọn đủ thông tin hoàn trả");
      return;
    }

    if (savingReverse) return;

    const qty = Number(reverseQuantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Số lượng hoàn trả phải lớn hơn 0");
      return;
    }

    if (!reverseReason.trim()) {
      toast.error("Lý do hoàn trả là bắt buộc");
      return;
    }

    if (!reverseItem || qty > reverseItem.on_hand_qty) {
      toast.error("Số lượng hoàn trả vượt quá tồn trong ngăn");
      return;
    }

    try {
      setSavingReverse(true);
      const idempotencyKey = `reverse-${selectedReverseCompartmentId}-${reverseVariantId}-${Date.now()}`;
      const res = await receivingPutawayService.reverse({
        warehouse_id: selectedWarehouseId,
        source_compartment_location_id: selectedReverseCompartmentId,
        target_receiving_location_id: reverseReceivingId,
        variant_id: reverseVariantId,
        quantity: qty,
        reason: reverseReason.trim(),
        idempotency_key: idempotencyKey,
      });

      setReverseReason("");
      setReverseQuantity(0);

      await Promise.all([
        loadWarehouseContext(selectedWarehouseId),
        selectedReceivingId ? loadReceivingItems(selectedReceivingId) : Promise.resolve(),
        selectedReceivingId && selectedVariantId ? loadCandidates(selectedReceivingId, selectedVariantId) : Promise.resolve(),
      ]);

      toast.success(`Đã trả ${res.data.moved_quantity} quyển về khu nhận hàng`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Hoàn trả thất bại"));
    } finally {
      setSavingReverse(false);
    }
  };

  // Picking a suggested location never finalises anything: it only fills an
  // allocation line that the user still reviews and confirms.
  const handleSelectSuggestedLocation = (location: {
    locationId: string;
    locationCode: string;
    zone: string | null;
    shelf: string | null;
    bin: string | null;
  }) => {
    const candidate = candidateMap.get(location.locationId);
    if (!candidate) {
      toast.warning("Trạng thái vị trí đã thay đổi. Vui lòng lấy gợi ý mới.");
      return;
    }
    if (draftLines.some((line) => line.target_location_id === location.locationId && line.id !== defaultLineId)) {
      toast.info(`Vị trí ${location.locationCode} đã có trong danh sách phân bổ`);
      return;
    }

    const replacing = draftLines.length === 1 && draftLines[0].id === defaultLineId;
    const stillNeeded = replacing ? neededQty : remainingToAllocate;
    if (stillNeeded <= 0) {
      toast.info("Đã phân bổ đủ số lượng cần cất. Giảm số lượng ở dòng khác trước khi thêm vị trí mới.");
      return;
    }
    const quantity = Math.max(1, Math.min(stillNeeded, candidate.remaining_capacity));
    const line: DraftAllocationLine = {
      id: makeLineId(),
      target_location_id: location.locationId,
      quantity,
      reason: `Theo gợi ý hệ thống: ${location.locationCode}`,
      scanned_location_barcode: "",
      scanned_product_barcode: "",
    };
    setDraftLines((prev) => (replacing ? [line] : [...prev, line]));
    setDefaultLineId(null);
    toast.success(
      quantity < stillNeeded
        ? `Đã thêm ${location.locationCode} (${quantity} cuốn). Còn ${stillNeeded - quantity} cuốn — chọn thêm một vị trí.`
        : `Đã thêm ${location.locationCode} (${quantity} cuốn)`,
    );
  };

  // Presentation only: managers switch between the two jobs instead of seeing both stacked.
  const [mode, setMode] = useState<"putaway" | "reverse">("putaway");

  if (loading) {
    return (
      <PageWrapper>
        <LoadingOverlay />
      </PageWrapper>
    );
  }

  const overAllocated = totalDraftQty > neededQty;
  const allocatedPct = neededQty > 0 ? Math.min(100, Math.round((totalDraftQty / neededQty) * 100)) : 0;
  const fieldLabel = "mb-1.5 block text-[12px] font-medium text-foreground";

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        {lockedCtx.goodsReceiptId && (
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2 text-muted-foreground">
            <Link to={`/putaway/${lockedCtx.goodsReceiptId}`}><ArrowLeft className="h-4 w-4" /> Phiếu nhập</Link>
          </Button>
        )}
        <PageHeader
          icon={ArrowRightLeft}
          title="Nhận & cất hàng lên kệ"
          description={isVariantLocked ? (
            <>Đang cất theo phiếu nhập: chỉ xếp <span className="font-semibold text-foreground">{lockedCtx.bookTitle || "sách đã chọn"}</span>. Kho và sách đã được khoá theo phiếu.</>
          ) : (
            <>
              Chuyển sách đang nằm ở khu nhận hàng lên ngăn kệ. Việc đã giao cho nhân viên nằm ở{" "}
              <Link to="/putaway" className="whitespace-nowrap rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Cất hàng vào kệ</Link>.
            </>
          )}
          actions={(
            <Button variant="outline" size="sm" onClick={() => selectedWarehouseId && loadWarehouseContext(selectedWarehouseId)}>
              <RefreshCw className="h-3.5 w-3.5" /> Tải lại
            </Button>
          )}
        />
      </FadeItem>

      <FadeItem>
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border bg-card p-4">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="rp-warehouse" className={fieldLabel}>
              Kho {isWarehouseLocked && <span className="font-normal text-muted-foreground">(khoá theo phiếu)</span>}
            </label>
            <Select
              value={selectedWarehouseId}
              onValueChange={(value) => setSelectedWarehouseId(value === "none" ? "" : value)}
              disabled={isWarehouseLocked}
            >
              <SelectTrigger id="rp-warehouse" className="w-full">
                <SelectValue placeholder="Chọn kho" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="rp-receiving" className={fieldLabel}>Khu nhận hàng nguồn</label>
            <Select value={selectedReceivingId} onValueChange={(value) => setSelectedReceivingId(value === "none" ? "" : value)}>
              <SelectTrigger id="rp-receiving" className="w-full">
                <SelectValue placeholder="Chọn khu nhận hàng" />
              </SelectTrigger>
              <SelectContent>
                {receivings.map((location) => (
                  <SelectItem key={location.id} value={location.id}>{location.location_code}, {LOCATION_TYPE_LABEL[location.location_type] ?? location.location_type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isManager && (
            <div className="max-w-full overflow-x-auto">
              <SegmentedControl
                options={[
                  { value: "putaway", label: "Cất lên kệ" },
                  { value: "reverse", label: "Hoàn trả về khu nhận" },
                ]}
                value={mode}
                onChange={(v) => setMode(v as "putaway" | "reverse")}
                layoutId="receiving-putaway-mode"
                className="w-max"
              />
            </div>
          )}
        </div>
      </FadeItem>

      {mode === "putaway" ? (
        <FadeItem>
          <div className="@container/page">
            <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-4">
                <section aria-labelledby="rp-step-1" className="rounded-2xl border border-border bg-card p-5">
                  <StepHeading id="rp-step-1" n={1}>Sách cần cất</StepHeading>
                  {receivingItems.length === 0 ? (
                    <p className="mt-3 text-[13px] text-muted-foreground">Khu nhận hàng này không có sách nào chờ cất. Chọn khu nhận hàng hoặc kho khác.</p>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-4 @2xl:grid-cols-2">
                      <div className="min-w-0">
                        <label htmlFor="rp-variant" className={fieldLabel}>
                          Sách trong khu nhận hàng {isVariantLocked && <span className="font-normal text-muted-foreground">(khoá theo phiếu)</span>}
                        </label>
                        <Select
                          value={selectedVariantId}
                          onValueChange={(value) => setSelectedVariantId(value === "none" ? "" : value)}
                          disabled={isVariantLocked}
                        >
                          <SelectTrigger id="rp-variant" className="w-full">
                            <SelectValue placeholder="Chọn sách" />
                          </SelectTrigger>
                          <SelectContent>
                            {receivingItems.map((item) => (
                              <SelectItem key={item.variant_id} value={item.variant_id}>
                                {item.book_title} ({item.on_hand_qty} cuốn)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {selectedVariantItem && (
                          <p className="mt-1.5 text-[12px] text-muted-foreground">
                            <span className="font-mono">{selectedVariantItem.isbn13 || selectedVariantItem.sku || selectedVariantItem.barcode || selectedVariantItem.variant_id.slice(0, 8)}</span>, đang có {selectedVariantItem.on_hand_qty} cuốn ở khu nhận hàng
                          </p>
                        )}
                      </div>

                      {!isVariantLocked && (
                        <div className="min-w-0">
                          <label htmlFor="rp-scan-isbn" className={fieldLabel}>Hoặc quét ISBN-13</label>
                          <div className="flex gap-2">
                            <Input
                              id="rp-scan-isbn"
                              value={scanSkuInput}
                              onChange={(event) => setScanSkuInput(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void handleScanSku();
                                }
                              }}
                              placeholder="13 chữ số"
                              inputMode="numeric"
                              autoComplete="off"
                              className="h-10 min-w-0 flex-1 font-mono"
                            />
                            <IconButton variant="outline" onClick={handleScanSku} label="Quét ISBN-13" className="h-10 w-10 shrink-0">
                              <ScanLine className="h-4 w-4" />
                            </IconButton>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {ambiguousVariantMatches.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                      <p className="text-[13px] font-medium text-amber-900 dark:text-amber-200">ISBN-13 này khớp nhiều SKU. Chọn đúng SKU:</p>
                      <Select
                        onValueChange={(variantId) => {
                          setSelectedVariantId(variantId);
                          setAmbiguousVariantMatches([]);
                        }}
                      >
                        <SelectTrigger className="mt-2 w-full border-amber-200 dark:border-amber-500/20" aria-label="Chọn SKU đúng">
                          <SelectValue placeholder="Chọn SKU đúng" />
                        </SelectTrigger>
                        <SelectContent>
                          {ambiguousVariantMatches.map((item) => (
                            <SelectItem key={item.variant_id} value={item.variant_id}>
                              {item.book_title}, {item.isbn13 || item.sku || item.internal_barcode || item.isbn10} (khớp theo {item.matched_by})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </section>

                <section aria-labelledby="rp-step-2" className="rounded-2xl border border-border bg-card p-5">
                  <StepHeading id="rp-step-2" n={2}>Chọn ngăn kệ</StepHeading>
                  {receiptDone ? (
                    <p role="status" className="mt-3 flex items-start gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Đã cất đủ số lượng của phiếu cho sách này.{" "}
                        {lockedCtx.goodsReceiptId && (
                          <Link to={`/putaway/${lockedCtx.goodsReceiptId}`} className="underline underline-offset-4">Quay lại phiếu nhập</Link>
                        )}
                      </span>
                    </p>
                  ) : !selectedVariantItem ? (
                    <p className="mt-3 text-[13px] text-muted-foreground">Chọn sách ở bước 1 để xem các ngăn còn chỗ.</p>
                  ) : loadingCandidates ? (
                    <p className="mt-3 text-[13px] text-muted-foreground">Đang tính toán vị trí...</p>
                  ) : candidates.length === 0 ? (
                    <EmptyState
                      variant="no-data"
                      title="Không có ngăn còn chỗ trống"
                      description="Kho này chưa có ngăn kệ nào còn chỗ. Hãy kiểm tra cấu hình kệ và ngăn của kho trước khi cất hàng."
                      action={<Link to="/shelves" className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">Mở trang Kệ hàng</Link>}
                      className="mt-2 py-6"
                    />
                  ) : (
                    <div className="mt-4 space-y-4">
                      {/* Primary path: ranked suggestions for what is still left to place. */}
                      <StorageSuggestionPanel
                        warehouseId={selectedWarehouseId}
                        variantId={selectedVariantId}
                        quantity={suggestionQty}
                        autoRequest
                        disabled={suggestionsPaused}
                        selectedLocationIds={draftLines.filter((line) => line.id !== defaultLineId).map((line) => line.target_location_id)}
                        onSelectLocation={handleSelectSuggestedLocation}
                      />

                      <div className="max-w-md">
                        <label htmlFor="rp-scan-location" className={fieldLabel}>Hoặc quét mã ngăn cho dòng đầu tiên</label>
                        <div className="flex gap-2">
                          <Input
                            id="rp-scan-location"
                            value={scanTargetBarcodeInput}
                            onChange={(event) => setScanTargetBarcodeInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleScanTargetLocation();
                              }
                            }}
                            placeholder="Mã vạch ngăn kệ"
                            autoComplete="off"
                            className="h-10 min-w-0 flex-1 font-mono"
                          />
                          <IconButton variant="outline" onClick={handleScanTargetLocation} label="Quét vị trí đích" className="h-10 w-10 shrink-0">
                            <ScanLine className="h-4 w-4" />
                          </IconButton>
                        </div>
                      </div>

                      <Collapsible>
                        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-1 text-left text-[13px] font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50">
                          Tất cả ngăn còn chỗ ({candidates.length})
                          <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                          <div className="overflow-x-auto rounded-xl border border-border">
                            <Table>
                              <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                  {["Ngăn", "Khu", "Kệ", "Hiện có", "Tối đa", "Còn lại", "SKU khác nhau", "Ưu tiên"].map((head) => (
                                    <TableHead key={head} className="text-[12px] font-medium text-muted-foreground">{head}</TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {candidates.map((candidate) => (
                                  <TableRow key={candidate.id} className="hover:bg-muted/40">
                                    <TableCell className="font-mono text-[12px] font-semibold">{candidate.location_code}</TableCell>
                                    <TableCell className="text-[12px] text-muted-foreground">{candidate.zone_code}</TableCell>
                                    <TableCell className="text-[12px] text-muted-foreground">{candidate.shelf_code}</TableCell>
                                    <TableCell className="text-[12px] tabular-nums text-muted-foreground">{candidate.current_on_hand}</TableCell>
                                    <TableCell className="text-[12px] tabular-nums text-muted-foreground">{candidate.max_capacity}</TableCell>
                                    <TableCell className="text-[12px] font-semibold tabular-nums text-foreground">{candidate.remaining_capacity}</TableCell>
                                    <TableCell className="text-[12px] tabular-nums text-muted-foreground">{candidate.mixed_sku_count}</TableCell>
                                    <TableCell className="text-[12px] text-muted-foreground">{candidate.priority_group === 0 ? "Cùng kệ" : candidate.priority_group === 1 ? "Cùng khu" : "Khác"}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  )}
                </section>

                {!receiptDone && selectedVariantItem && candidates.length > 0 && (
                  <section aria-labelledby="rp-step-3" className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <StepHeading id="rp-step-3" n={3}>Số lượng cho từng ngăn</StepHeading>
                      <Button variant="outline" size="sm" onClick={addDraftLine}><Plus className="h-3.5 w-3.5" /> Thêm ngăn thủ công</Button>
                    </div>
                    <div className="mt-4 space-y-3">
                      {draftLines.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground">Chưa có dòng nào. Chọn một vị trí gợi ý ở bước 2 hoặc thêm ngăn thủ công.</p>
                      ) : draftLines.map((line, index) => {
                        const lineCandidate = candidateMap.get(line.target_location_id);
                        return (
                          <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-end gap-3 rounded-xl border border-border p-4 @2xl:grid-cols-[minmax(0,12rem)_96px_minmax(0,1fr)_auto]">
                            <div className="min-w-0">
                              <label htmlFor={`rp-line-${line.id}-loc`} className={fieldLabel}>Ngăn đích</label>
                              <Select
                                value={line.target_location_id || "none"}
                                // A barcode scanned for the previous target says nothing about the new one — the server checks it.
                                onValueChange={(value) => updateLine(line.id, { target_location_id: value === "none" ? "" : value, scanned_location_barcode: "" })}
                              >
                                <SelectTrigger id={`rp-line-${line.id}-loc`} className="w-full font-mono">
                                  <SelectValue placeholder="Chọn vị trí đích" />
                                </SelectTrigger>
                                <SelectContent>
                                  {candidates.map((candidate) => (
                                    <SelectItem key={candidate.id} value={candidate.id}>{candidate.location_code} (còn {candidate.remaining_capacity})</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label htmlFor={`rp-line-${line.id}-qty`} className={fieldLabel}>Số lượng</label>
                              <Input
                                id={`rp-line-${line.id}-qty`}
                                type="number"
                                min={1}
                                max={Math.min(
                                  lineCandidate?.remaining_capacity ?? Infinity,
                                  receiptMaxQty !== null ? receiptMaxQty : Infinity,
                                )}
                                value={line.quantity}
                                onChange={(event) => updateLine(line.id, { quantity: Math.max(1, Math.trunc(Number(event.target.value || 1))) })}
                                className="h-10 tabular-nums"
                              />
                            </div>
                            <IconButton
                              variant="ghost"
                              onClick={() => removeLine(line.id)}
                              label={`Xóa dòng ${index + 1}`}
                              className="h-10 w-10 text-muted-foreground hover:text-red-600 @2xl:order-last"
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                            <div className="col-span-3 min-w-0 @2xl:col-span-1">
                              <label htmlFor={`rp-line-${line.id}-reason`} className={fieldLabel}>Lý do <span className="font-normal text-muted-foreground">(bắt buộc)</span></label>
                              <Input
                                id={`rp-line-${line.id}-reason`}
                                value={line.reason}
                                onChange={(event) => updateLine(line.id, { reason: event.target.value })}
                                placeholder="Ví dụ: sắp xếp lại"
                                data-testid="putaway-reason-input"
                                className="h-10"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>

              <aside aria-labelledby="rp-summary-title" className="@4xl/page:sticky @4xl/page:top-4">
                <section className="rounded-2xl border border-border bg-card p-5">
                  <h2 id="rp-summary-title" className="font-serif text-[17px] font-semibold tracking-tight">Xác nhận cất hàng</h2>
                  {selectedVariantItem ? (
                    <div className="mt-4" aria-live="polite">
                      <p className="text-[12px] text-muted-foreground">Đã phân bổ</p>
                      <p className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground">
                        {totalDraftQty}<span className="font-sans text-[14px] font-normal text-muted-foreground"> / {neededQty} cuốn</span>
                      </p>
                      <Progress value={allocatedPct} className="mt-2.5 h-1.5" aria-label={`Đã phân bổ ${allocatedPct}%`} />
                      <p className={cn(
                        "mt-1.5 text-[12px]",
                        overAllocated ? "font-medium text-red-600 dark:text-red-400" : remainingToAllocate === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-800 dark:text-amber-300",
                      )}>
                        {overAllocated ? `Vượt ${totalDraftQty - neededQty} cuốn so với số cần cất.` : remainingToAllocate === 0 ? "Đã phân bổ đủ." : `Còn ${remainingToAllocate} cuốn chưa có ngăn.`}
                      </p>
                      {receiptMaxQty !== null && <p className="mt-1 text-[12px] text-muted-foreground">Giới hạn theo phiếu: {receiptMaxQty} cuốn.</p>}
                    </div>
                  ) : (
                    <p className="mt-3 text-[13px] text-muted-foreground">Chọn sách cần cất để bắt đầu.</p>
                  )}
                  <Button
                    onClick={handleConfirmTransfer}
                    disabled={draftLines.length === 0 || receiptDone}
                    loading={savingTransfer}
                    data-testid="putaway-confirm-button"
                    className="mt-4 h-11 w-full"
                  >
                    Xác nhận chuyển lên kệ
                  </Button>
                  <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">Mỗi dòng cần ngăn đích, số lượng và lý do. Tồn kho chỉ thay đổi sau khi bạn xác nhận.</p>
                </section>
              </aside>
            </div>
          </div>
        </FadeItem>
      ) : (
        <FadeItem>
          <section aria-labelledby="rp-reverse-title" className="@container rounded-2xl border border-border bg-card p-5">
            <h2 id="rp-reverse-title" className="font-serif text-[18px] font-semibold tracking-tight">Hoàn trả từ kệ về khu nhận hàng</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Trả sách đang nằm trên một ngăn kệ về khu nhận hàng, ví dụ khi cất nhầm ngăn.</p>
            <div className="mt-4 grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
              <div className="min-w-0">
                <label htmlFor="rp-rev-compartment" className={fieldLabel}>Ngăn nguồn</label>
                <Select
                  value={selectedReverseCompartmentId}
                  onValueChange={(value) => setSelectedReverseCompartmentId(value === "none" ? "" : value)}
                >
                  <SelectTrigger id="rp-rev-compartment" className="w-full">
                    <SelectValue placeholder="Chọn ngăn" />
                  </SelectTrigger>
                  <SelectContent>
                    {occupiedCompartments.map((compartment) => (
                      <SelectItem key={compartment.id} value={compartment.id}>{compartment.location_code} ({compartment.on_hand_qty} cuốn)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <label htmlFor="rp-rev-variant" className={fieldLabel}>Sách trong ngăn</label>
                <Select
                  value={reverseVariantId}
                  onValueChange={(value) => setReverseVariantId(value === "none" ? "" : value)}
                  disabled={loadingReverseItems}
                >
                  <SelectTrigger id="rp-rev-variant" className="w-full">
                    <SelectValue placeholder="Chọn sách" />
                  </SelectTrigger>
                  <SelectContent>
                    {reverseItems.map((item) => (
                      <SelectItem key={item.variant_id} value={item.variant_id}>
                        {item.book_title || item.isbn13 || item.sku || item.barcode || item.variant_id.slice(0, 8)} ({item.on_hand_qty} cuốn)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <label htmlFor="rp-rev-receiving" className={fieldLabel}>Khu nhận hàng đích</label>
                <Select
                  value={reverseReceivingId}
                  onValueChange={(value) => setReverseReceivingId(value === "none" ? "" : value)}
                >
                  <SelectTrigger id="rp-rev-receiving" className="w-full">
                    <SelectValue placeholder="Chọn khu nhận hàng" />
                  </SelectTrigger>
                  <SelectContent>
                    {receivings.map((receiving) => (
                      <SelectItem key={receiving.id} value={receiving.id}>{receiving.location_code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label htmlFor="rp-rev-qty" className={fieldLabel}>Số lượng</label>
                <Input
                  id="rp-rev-qty"
                  type="number"
                  min={1}
                  max={reverseItem?.on_hand_qty || 1}
                  {...zeroFieldProps}
                  value={reverseQuantity}
                  onChange={(event) => setReverseQuantity(Math.max(0, Math.trunc(Number(numberInputValue(event) || 0))))}
                  className="h-10 tabular-nums"
                />
                {reverseItem && <p className="mt-1 text-[12px] text-muted-foreground">Tối đa {reverseItem.on_hand_qty} cuốn.</p>}
              </div>

              <div className="min-w-0 @xl:col-span-2">
                <label htmlFor="rp-rev-reason" className={fieldLabel}>Lý do <span className="font-normal text-muted-foreground">(bắt buộc)</span></label>
                <Input
                  id="rp-rev-reason"
                  value={reverseReason}
                  onChange={(event) => setReverseReason(event.target.value)}
                  placeholder="Ví dụ: cất nhầm ngăn"
                  className="h-10"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <Button onClick={handleReverse} loading={savingReverse} className="bg-amber-600 text-white hover:bg-amber-700">
                <Undo2 className="h-4 w-4" /> Hoàn trả về khu nhận hàng
              </Button>
            </div>
          </section>
        </FadeItem>
      )}
    </PageWrapper>
  );
}

function StepHeading({ id, n, children }: { id: string; n: number; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2.5 font-serif text-[18px] font-semibold tracking-tight">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-sans text-[12px] font-semibold text-primary-foreground" aria-hidden="true">{n}</span>
      {children}
    </h2>
  );
}
