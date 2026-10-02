import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { AlertTriangle, ArrowRightLeft, ChevronDown, Filter, Lock, RefreshCw, ScanLine, Trash2 } from "lucide-react";
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
import { SectionCard } from "@/components/ui/section-card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button, IconButton } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

  if (loading) {
    return (
      <PageWrapper>
        <LoadingOverlay />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ArrowRightLeft}
          title="Nhận & cất hàng lên kệ"
          description="Chuyển sách từ khu nhận hàng lên ngăn kệ, hoặc hoàn trả về khu nhận hàng"
          iconBg="bg-violet-100 dark:bg-violet-500/15"
          iconColor="text-violet-600 dark:text-violet-400"
        />
        {isVariantLocked ? (
          <Alert className="mt-3 border-violet-200 bg-violet-50 dark:border-violet-500/20 dark:bg-violet-500/10">
            <Lock className="text-violet-600 dark:text-violet-400" />
            <AlertDescription className="text-violet-800 dark:text-violet-300">
              <p>
                Chế độ nhập hàng theo phiếu — chỉ xếp:{' '}
                <span className="font-semibold">{lockedCtx.bookTitle || "sách đã chọn"}</span>.
                {' '}Kho và sách đã được khoá theo phiếu nhập.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="mt-3 border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10">
            <AlertTriangle className="text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-300">
              <p>
              Màn này dùng cho thao tác điều chuyển trực tiếp. Nếu cần giao việc cho nhân viên, hãy dùng{' '}
              <Link to="/putaway" className="font-semibold underline hover:text-amber-900 dark:hover:text-amber-200">Cất hàng vào kệ</Link>.
              </p>
            </AlertDescription>
          </Alert>
        )}
      </FadeItem>

      {/* Warehouse Filter */}
      <FadeItem>
        <SectionCard title="Phạm vi làm việc" subtitle="Chọn kho và khu nhận hàng đang thao tác" icon={Filter}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Kho {isWarehouseLocked && <Lock className="inline w-3 h-3 text-violet-500 dark:text-violet-400 ml-1" />}</p>
              <Select
                value={selectedWarehouseId || "none"}
                onValueChange={(value) => setSelectedWarehouseId(value === "none" ? "" : value)}
                disabled={isWarehouseLocked}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn kho" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Khu nhận hàng nguồn</p>
              <Select value={selectedReceivingId || "none"} onValueChange={(value) => setSelectedReceivingId(value === "none" ? "" : value)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn khu nhận hàng" />
                </SelectTrigger>
                <SelectContent>
                  {receivings.map((location) => (
                    <SelectItem key={location.id} value={location.id}>{location.location_code} · {LOCATION_TYPE_LABEL[location.location_type] ?? location.location_type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-end">
              <Button variant="outline" onClick={() => selectedWarehouseId && loadWarehouseContext(selectedWarehouseId)}>
                <RefreshCw className="w-3.5 h-3.5" /> Tải lại
              </Button>
            </div>
          </div>
        </SectionCard>
      </FadeItem>

      {/* Section A: Receiving -> Shelf */}
      <FadeItem>
        <SectionCard title="A. Cất hàng lên kệ" subtitle="Chuyển sách từ khu nhận hàng lên ngăn kệ" icon={ArrowRightLeft}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">
                Sách trong khu nhận hàng {isVariantLocked && <Lock className="inline w-3 h-3 text-violet-500 dark:text-violet-400 ml-1" />}
              </p>
              <Select
                value={selectedVariantId || "none"}
                onValueChange={(value) => setSelectedVariantId(value === "none" ? "" : value)}
                disabled={isVariantLocked}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn sách" />
                </SelectTrigger>
                <SelectContent>
                  {receivingItems.map((item) => (
                    <SelectItem key={item.variant_id} value={item.variant_id}>
                      {(item.isbn13 || item.sku || item.barcode || item.variant_id.slice(0, 8))} | {item.book_title} | tồn {item.on_hand_qty}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!isVariantLocked && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Quét ISBN13</p>
                <div className="flex gap-2">
                  <Input
                    value={scanSkuInput}
                    onChange={(event) => setScanSkuInput(event.target.value)}
                    placeholder="Nhập ISBN13"
                    className="flex-1 h-auto py-2.5"
                  />
                  <IconButton variant="outline" onClick={handleScanSku} label="Quét ISBN13">
                    <ScanLine className="w-4 h-4" />
                  </IconButton>
                </div>
              </div>
            )}

            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Quét vị trí đích</p>
              <div className="flex gap-2">
                <Input
                  value={scanTargetBarcodeInput}
                  onChange={(event) => setScanTargetBarcodeInput(event.target.value)}
                  placeholder="Mã vạch ngăn kệ"
                  className="flex-1 h-auto py-2.5"
                />
                <IconButton variant="outline" onClick={handleScanTargetLocation} label="Quét vị trí đích">
                  <ScanLine className="w-4 h-4" />
                </IconButton>
              </div>
            </div>
          </div>

          {ambiguousVariantMatches.length > 0 ? (
            <div className="mt-4 p-4 rounded-[12px] border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/10">
              <p className="text-[12px] text-amber-800 dark:text-amber-300 font-semibold">ISBN13 trùng nhiều SKU, vui lòng chọn thủ công:</p>
              <Select
                onValueChange={(variantId) => {
                  setSelectedVariantId(variantId);
                  setAmbiguousVariantMatches([]);
                }}
              >
                <SelectTrigger className="mt-2 w-full border-amber-200 dark:border-amber-500/20">
                  <SelectValue placeholder="Chọn SKU đúng" />
                </SelectTrigger>
                <SelectContent>
                  {ambiguousVariantMatches.map((item) => (
                    <SelectItem key={item.variant_id} value={item.variant_id}>
                      {item.isbn13 || item.sku || item.internal_barcode || item.isbn10} | {item.book_title} | {item.matched_by}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {receiptDone ? (
            <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
              Đã cất đủ số lượng của phiếu cho sách này.{" "}
              {lockedCtx.goodsReceiptId && (
                <Link to={`/putaway/${lockedCtx.goodsReceiptId}`} className="font-semibold underline">Quay lại phiếu nhập</Link>
              )}
            </div>
          ) : (<>
          {loadingCandidates ? (
            <p className="mt-4 py-4 text-center text-[12px] text-muted-foreground">Đang tính toán vị trí...</p>
          ) : candidates.length === 0 ? (
            <EmptyState
              variant="no-data"
              title="Không có ngăn còn chỗ trống"
              description="Kho này chưa có ngăn kệ nào còn chỗ. Hãy kiểm tra cấu hình kệ/ngăn của kho trước khi cất hàng."
              action={<Link to="/shelves" className="text-[12px] font-medium text-indigo-600 hover:underline">Mở trang Kệ hàng</Link>}
              className="mt-4 py-6"
            />
          ) : null}

          {/* Primary path: ranked suggestions for what is still left to place. */}
          {selectedWarehouseId && selectedVariantId && candidates.length > 0 && (
            <div className="mt-4">
              <StorageSuggestionPanel
                warehouseId={selectedWarehouseId}
                variantId={selectedVariantId}
                quantity={suggestionQty}
                autoRequest
                disabled={suggestionsPaused}
                selectedLocationIds={draftLines.filter((line) => line.id !== defaultLineId).map((line) => line.target_location_id)}
                onSelectLocation={handleSelectSuggestedLocation}
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground" aria-live="polite">
              {selectedVariantItem && (<>
              Cần cất: <span className="font-semibold text-foreground">{neededQty}</span> cuốn
              {" · "}Đã phân bổ: <span className="font-semibold text-foreground">{totalDraftQty}</span>
              {" · "}Còn lại:{" "}
              <span className={`font-semibold ${totalDraftQty > neededQty ? "text-red-600 dark:text-red-400" : remainingToAllocate === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                {totalDraftQty > neededQty ? `vượt ${totalDraftQty - neededQty}` : remainingToAllocate}
              </span>
              {receiptMaxQty !== null && <span className="ml-1">(giới hạn theo phiếu: {receiptMaxQty} cuốn)</span>}
              </>)}
            </p>
            <Button variant="outline" size="sm" onClick={addDraftLine}>Thêm vị trí thủ công</Button>
          </div>
          <div className="mt-3 space-y-2">
            {draftLines.length === 0 ? (
              <p className="text-[12px] text-muted-foreground text-center py-4">Chưa có dòng phân bổ nào — chọn một vị trí đề xuất ở trên hoặc thêm vị trí thủ công.</p>
            ) : draftLines.map((line) => {
              const lineCandidate = candidateMap.get(line.target_location_id);
              return (
                <div key={line.id} className="rounded-[12px] border border-border p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Ngăn đích</p>
                    <Select
                      value={line.target_location_id || "none"}
                      onValueChange={(value) => updateLine(line.id, { target_location_id: value === "none" ? "" : value })}
                    >
                      <SelectTrigger className="w-full">
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
                    <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Số lượng</p>
                    <Input
                      type="number"
                      min={1}
                      max={Math.min(
                        lineCandidate?.remaining_capacity ?? Infinity,
                        receiptMaxQty !== null ? receiptMaxQty : Infinity,
                      )}
                      value={line.quantity}
                      onChange={(event) => updateLine(line.id, { quantity: Math.max(1, Math.trunc(Number(event.target.value || 1))) })}
                      className="h-auto py-2.5"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Lý do (bắt buộc)</p>
                    <Input
                      value={line.reason}
                      onChange={(event) => updateLine(line.id, { reason: event.target.value })}
                      placeholder="Ví dụ: sắp xếp lại"
                      data-testid="putaway-reason-input"
                      className="h-auto py-2.5"
                    />
                  </div>
                  <div>
                    <Button variant="danger-outline" className="w-full" onClick={() => removeLine(line.id)}>
                      <Trash2 className="w-3.5 h-3.5" /> Xóa
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {candidates.length > 0 && !loadingCandidates && (
            <Collapsible className="mt-4">
              <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-1 text-left text-[12px] font-semibold text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50">
                Tất cả ngăn còn chỗ ({candidates.length})
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="overflow-hidden rounded-[12px] border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {['Ngăn', 'Khu', 'Kệ', 'Hiện có', 'Tối đa', 'Còn lại', 'SKU hỗn hợp', 'Ưu tiên'].map((head) => (
                    <TableHead key={head} className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{head}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((candidate) => (
                  <TableRow key={candidate.id} className="hover:bg-muted/30">
                    <TableCell className="text-[12px] font-semibold">{candidate.location_code}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{candidate.zone_code}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{candidate.shelf_code}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{candidate.current_on_hand}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{candidate.max_capacity}</TableCell>
                    <TableCell className="text-[12px] text-emerald-600 dark:text-emerald-400 font-semibold">{candidate.remaining_capacity}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{candidate.mixed_sku_count}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{candidate.priority_group === 0 ? 'Cùng kệ' : candidate.priority_group === 1 ? 'Cùng khu' : 'Khác'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          <div className="flex justify-end mt-4">
            <Button
              onClick={handleConfirmTransfer}
              disabled={draftLines.length === 0}
              loading={savingTransfer}
              data-testid="putaway-confirm-button"
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:opacity-90"
            >
              Xác nhận chuyển lên kệ
            </Button>
          </div>
          </>)}
        </SectionCard>
      </FadeItem>

      {/* Section B: Reverse — chỉ manager/admin mới thấy */}
      {isManager && <FadeItem>
        <SectionCard title="B. Hoàn trả từ kệ về khu nhận hàng" subtitle="Trả sách từ ngăn kệ về khu nhận hàng" icon={RefreshCw}>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Ngăn nguồn</p>
              <Select
                value={selectedReverseCompartmentId || "none"}
                onValueChange={(value) => setSelectedReverseCompartmentId(value === "none" ? "" : value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn ngăn" />
                </SelectTrigger>
                <SelectContent>
                  {occupiedCompartments.map((compartment) => (
                    <SelectItem key={compartment.id} value={compartment.id}>{compartment.location_code} (tồn {compartment.on_hand_qty})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Sách trong ngăn</p>
              <Select
                value={reverseVariantId || "none"}
                onValueChange={(value) => setReverseVariantId(value === "none" ? "" : value)}
                disabled={loadingReverseItems}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn sách" />
                </SelectTrigger>
                <SelectContent>
                  {reverseItems.map((item) => (
                    <SelectItem key={item.variant_id} value={item.variant_id}>
                      {(item.isbn13 || item.sku || item.barcode || item.variant_id.slice(0, 8))} | tồn {item.on_hand_qty}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Khu nhận hàng đích</p>
              <Select
                value={reverseReceivingId || "none"}
                onValueChange={(value) => setReverseReceivingId(value === "none" ? "" : value)}
              >
                <SelectTrigger className="w-full">
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
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Số lượng</p>
              <Input
                type="number"
                min={1}
                max={reverseItem?.on_hand_qty || 1}
                value={reverseQuantity}
                onChange={(event) => setReverseQuantity(Math.max(0, Math.trunc(Number(event.target.value || 0))))}
                className="h-auto py-2.5"
              />
            </div>

            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Lý do</p>
              <Input
                value={reverseReason}
                onChange={(event) => setReverseReason(event.target.value)}
                placeholder="Lý do (bắt buộc)"
                className="h-auto py-2.5"
              />
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <Button
              onClick={handleReverse}
              loading={savingReverse}
              className="bg-gradient-to-r from-amber-600 to-orange-600 hover:opacity-90"
            >
              Hoàn trả về khu nhận hàng
            </Button>
          </div>
        </SectionCard>
      </FadeItem>}
    </PageWrapper>
  );
}
