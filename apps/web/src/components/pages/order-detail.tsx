import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { StatusBadge } from "../status-badge";
import { NavLink, useParams } from "react-router";
import { ArrowLeft, Download, FileText, CheckCircle, XCircle, ClipboardCheck, ScanBarcode, Save, UserCheck } from "lucide-react";
import { goodsReceiptService } from "@/services/goods-receipt";
import { getApiErrorMessage } from "@/services/api.ts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/components/ui/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { authService } from "@/services/auth";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { canManageReceiving, canViewUnitCost, canViewLocationCode } from "@/lib/rbac";
import { exportToCsv } from "@/lib/export-utils";
import { GoodsReceiptPrintSheet } from "./goods-receipt-print-sheet";
import { formatCurrency, formatDate } from "./goods-receipt-format";
import { GoodsReceiptProcurementPanel } from "@/components/procurement/goods-receipt-procurement-panel";

export interface ReceiptDetailItem {
  id: string;
  barcode: string | null;
  book_title: string;
  location_code: string | null;
  quantity: number;
  actual_quantity: number | null;
  unit_cost: number;
  line_total: number;
  damaged_qty?: number | null;
  rejected_qty?: number | null;
}

export interface InvoiceItem {
  id: string;
  variant_id: string;
  title: string | null;
  isbn13: string | null;
  sku: string | null;
  barcode: string | null;
  invoiced_qty: number;
}

export interface EmbeddedInvoice {
  id: string;
  invoice_number: string;
  supplier_name: string | null;
  po_number: string | null;
  expected_delivery_date: string | null;
  items: InvoiceItem[];
}

export interface ReceiptDetail {
  id: string;
  receipt_number: string;
  purchase_order_id?: string | null;
  po_number?: string | null;
  supplier_delivery_invoice_id?: string | null;
  source_type?: string | null;
  warehouse_code?: string;
  warehouse_name?: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  created_at: string;
  note?: string;
  total_amount: number;
  received_by_user_id?: string | null;
  received_at?: string | null;
  items: ReceiptDetailItem[];
  invoice?: EmbeddedInvoice | null;
}

// Staff read Vietnamese; the API keeps its codes.
const STATUS_LABELS: Record<string, string> = { DRAFT: "Nháp", POSTED: "Đã duyệt", CANCELLED: "Đã hủy" };
const SOURCE_LABELS: Record<string, string> = { SUPPLIER_INVOICE: "Theo phiếu giao nhà cung cấp", PURCHASE_ORDER: "Theo đơn đặt hàng" };

export function OrderDetailPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
  const [selectedReceiverId, setSelectedReceiverId] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const currentUser = authService.getCurrentUser();
  const showManageReceiving = canManageReceiving(currentUser);
  const showUnitCost = canViewUnitCost(currentUser);
  const showLocation = canViewLocationCode(currentUser);

  // countedQty maps receipt item id → quantity staff physically counted
  const [countedQty, setCountedQty] = useState<Record<string, number>>({});
  const [isSavingItems, setIsSavingItems] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchDetail = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await goodsReceiptService.getById(id);
        const detail = data as ReceiptDetail;
        setReceipt(detail);
        // Init counted qty: dùng actual_quantity nếu đã kiểm đếm, không thì dùng planned quantity
        const init: Record<string, number> = {};
        for (const item of detail.items ?? []) {
          init[item.id] = item.actual_quantity ?? item.quantity;
        }
        setCountedQty(init);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được chi tiết phiếu nhập"));
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [id]);


  const handleScanBarcode = (barcode: string) => {
    const cleaned = barcode.trim();
    if (!cleaned || !receipt) return;
    // Match barcode against receipt items
    const matched = receipt.items.find(
      (item) => item.barcode === cleaned || item.barcode?.replace(/[^0-9]/g, "") === cleaned.replace(/[^0-9]/g, "")
    );
    if (matched) {
      setHighlightedItemId(matched.id);
      setCountedQty((prev) => ({ ...prev, [matched.id]: (prev[matched.id] ?? 0) + 1 }));
      setTimeout(() => setHighlightedItemId(null), 1500);
    } else {
      toast.warning(`Không tìm thấy sách có mã: ${cleaned}`);
    }
    setScanInput("");
  };

  const handleSaveItemQty = async () => {
    if (!id || !receipt) return;
    try {
      setIsSavingItems(true);
      // Lưu vào actual_quantity (không ghi đè quantity gốc từ PO)
      const items = receipt.items.map((item) => ({
        id: item.id,
        actual_quantity: countedQty[item.id] ?? item.quantity,
      }));
      await goodsReceiptService.verifyItems(id, items);
      const refreshed = await goodsReceiptService.getById(id);
      setReceipt(refreshed as ReceiptDetail);
      toast.success("Đã lưu số lượng kiểm đếm");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lưu số lượng thất bại"));
    } finally {
      setIsSavingItems(false);
    }
  };

  useEffect(() => {
    if (!showManageReceiving) return;
    void userService.getWarehouseStaff()
      .then((response) => setWarehouseStaff(Array.isArray(response.data) ? response.data : []))
      .catch((error) => toast.error(getApiErrorMessage(error, "Không tải được danh sách nhân viên kho")));
  }, [showManageReceiving]);

  const handleUpdateStatus = async (nextStatus: "POSTED" | "CANCELLED") => {
    if (!id) return;
    try {
      setIsUpdatingStatus(true);
      await goodsReceiptService.updateStatus(id, nextStatus);
      const refreshed = await goodsReceiptService.getById(id);
      setReceipt(refreshed as ReceiptDetail);
      toast.success(nextStatus === "POSTED" ? "Đã duyệt phiếu nhập" : "Đã hủy phiếu nhập");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cập nhật trạng thái thất bại"));
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleAssignReceiver = async () => {
    if (!id || !selectedReceiverId) {
      toast.error("Chọn nhân viên kho trước khi giao phiếu");
      return;
    }

    try {
      setIsAssigning(true);
      await goodsReceiptService.assign(id, selectedReceiverId);
      const refreshed = await goodsReceiptService.getById(id);
      setReceipt(refreshed as ReceiptDetail);
      toast.success("Đã giao phiếu nhập cho nhân viên kho");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Giao phiếu nhập thất bại"));
    } finally {
      setIsAssigning(false);
    }
  };

  const handleDownload = () => {
    if (!receipt) return;
    exportToCsv(
      receipt.items.map((item) => ({
        barcode: item.barcode || '',
        book_title: item.book_title,
        location_code: item.location_code || '',
        quantity: item.quantity,
        actual_quantity: item.actual_quantity ?? '',
        unit_cost: item.unit_cost,
        line_total: item.line_total,
      })),
      [
        { header: 'Mã vạch', key: 'barcode' },
        { header: 'Tên sách', key: 'book_title' },
        { header: 'Vị trí', key: 'location_code' },
        { header: 'Số lượng đặt', key: 'quantity' },
        { header: 'Số lượng thực nhận', key: 'actual_quantity' },
        { header: 'Đơn giá', key: 'unit_cost' },
        { header: 'Thành tiền', key: 'line_total' },
      ],
      `phieu-nhap-${receipt.receipt_number}`,
    );
  };

  const totalQty = useMemo(() => receipt?.items?.reduce((s, i) => s + i.quantity, 0) || 0, [receipt]);
  const receiverName = useMemo(() => {
    if (!receipt?.received_by_user_id) return null;
    const staff = warehouseStaff.find((s) => s.id === receipt.received_by_user_id);
    return staff?.full_name || staff?.username || null;
  }, [receipt, warehouseStaff]);
  const isVerified = useMemo(
    () => Boolean(receipt && receipt.items.length > 0 && receipt.items.every((i) => i.actual_quantity !== null)),
    [receipt],
  );

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <LoadingOverlay />
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <EmptyState variant="no-data" title="Không tìm thấy phiếu nhập" description="Phiếu này có thể đã bị xóa hoặc không tồn tại" />
      </div>
    );
  }

  const isDraft = receipt.status === "DRAFT";
  const isPosted = receipt.status === "POSTED";
  const isCancelled = receipt.status === "CANCELLED";
  const countedTotal = receipt.items.reduce((sum, item) => sum + (item.actual_quantity ?? 0), 0);
  const hasExceptions = receipt.items.some((item) => (item.damaged_qty ?? 0) > 0 || (item.rejected_qty ?? 0) > 0);
  const receiverLabel = receiverName
    || (receipt.received_by_user_id && receipt.received_by_user_id === currentUser?.id ? "Bạn" : null)
    || (receipt.received_by_user_id ? "Đã giao nhân viên" : "Chưa giao nhân viên");
  const steps: Array<{ key: string; title: string; detail: string; state: "done" | "current" | "todo" | "stopped" }> = [
    { key: "created", title: "Tạo phiếu", detail: formatDate(receipt.created_at), state: "done" },
    {
      key: "count",
      title: "Kiểm đếm",
      detail: isVerified || isPosted ? `${receiverLabel}, đã lưu số đếm` : receiverLabel,
      state: isVerified || isPosted ? "done" : isDraft ? "current" : "todo",
    },
    {
      key: "approve",
      title: "Quản lý duyệt",
      detail: isPosted ? "Tồn kho đã cập nhật" : isCancelled ? "Phiếu đã hủy" : isVerified ? "Đang chờ duyệt" : "Sau khi kiểm đếm",
      state: isPosted ? "done" : isCancelled ? "stopped" : isVerified ? "current" : "todo",
    },
    { key: "putaway", title: "Cất hàng vào kệ", detail: isPosted ? "Bước tiếp theo" : "Sau khi duyệt", state: isPosted ? "current" : "todo" },
  ];
  const facts: Array<{ label: string; value: ReactNode }> = [
    { label: "Kho nhận", value: receipt.warehouse_name ? `${receipt.warehouse_name}${receipt.warehouse_code ? ` (${receipt.warehouse_code})` : ""}` : receipt.warehouse_code || "-" },
    ...(receipt.purchase_order_id ? [{ label: "Đơn đặt hàng", value: <NavLink to={`/purchase-orders/${receipt.purchase_order_id}`} className="font-mono text-primary underline-offset-2 hover:underline">{receipt.po_number || receipt.purchase_order_id}</NavLink> }] : []),
    ...(receipt.invoice ? [
      { label: "Hóa đơn nhà cung cấp", value: <span className="font-mono">{receipt.invoice.invoice_number}</span> },
      { label: "Nhà cung cấp", value: receipt.invoice.supplier_name || "-" },
    ] : []),
    { label: "Nguồn phiếu", value: SOURCE_LABELS[receipt.source_type ?? ""] ?? receipt.source_type ?? "Tạo tay" },
    { label: "Người kiểm đếm", value: receiverLabel },
    ...(receipt.received_at ? [{ label: "Nhận hàng lúc", value: formatDate(receipt.received_at) }] : []),
    ...(receipt.note ? [{ label: "Ghi chú", value: receipt.note }] : []),
  ];
  const diffTone = (diff: number) => (diff > 0 ? "text-red-700 dark:text-red-400" : diff < 0 ? "text-amber-700 dark:text-amber-300" : "text-foreground");
  const countInput = (itemId: string, value: number, label: string) => (
    <input
      type="number"
      min={0}
      value={value}
      aria-label={`Số thực đếm — ${label}`}
      onChange={(e) => setCountedQty((prev) => ({ ...prev, [itemId]: Math.max(0, Number(e.target.value) || 0) }))}
      className="h-9 w-20 rounded-md border border-input bg-input-background px-2 text-right text-[14px] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-muted/40"
    />
  );
  const scanBar = (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative min-w-0 flex-1">
        <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={scanInputRef}
          type="text"
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { handleScanBarcode(scanInput); } }}
          placeholder="Quét hoặc nhập mã vạch rồi Enter, mỗi lần cộng 1 cuốn"
          aria-label="Quét mã vạch để đếm"
          className="h-10 w-full rounded-md border border-input bg-input-background pl-9 pr-3 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-muted/40"
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setShowScannerModal(true)}>
          <ScanBarcode className="h-4 w-4" /> Camera
        </Button>
        <Button type="button" onClick={() => void handleSaveItemQty()} disabled={isSavingItems} data-testid="save-received-count-button">
          <Save className="h-4 w-4" />
          {isSavingItems ? "Đang lưu..." : "Lưu kiểm đếm"}
        </Button>
      </div>
    </div>
  );
  const verifiedNote = (
    <p className="flex items-center gap-2 rounded-xl bg-primary/[0.05] px-4 py-3 text-[13px] font-medium text-foreground">
      <CheckCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      Đã kiểm đếm xong, chờ manager duyệt phiếu nhập.
    </p>
  );

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <GoodsReceiptPrintSheet
        receipt={receipt}
        totalQty={totalQty}
        showLocation={showLocation}
        showUnitCost={showUnitCost}
        receiverName={receiverName}
      />
      {showManageReceiving ? (
        <NavLink to="/orders" className="-ml-1 inline-flex items-center gap-1.5 rounded px-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Phiếu nhập kho
        </NavLink>
      ) : null}

      {/* Object header: which receipt, where it stands, and what it holds. */}
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">Phiếu nhập kho</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <h1 className="break-all font-mono text-[22px] font-semibold tracking-tight text-foreground">{receipt.receipt_number}</h1>
            <span data-testid="goods-receipt-status">
              <StatusBadge label={STATUS_LABELS[receipt.status] ?? receipt.status} variant={isPosted ? "success" : isDraft ? "info" : "danger"} dot />
            </span>
          </div>
          <p className="mt-1 max-w-prose text-[14px] text-muted-foreground">
            {totalQty.toLocaleString("vi-VN")} cuốn, {receipt.items.length} đầu sách vào {receipt.warehouse_code || receipt.warehouse_name || "kho"}
            {receipt.invoice?.supplier_name ? ` từ ${receipt.invoice.supplier_name}` : ""}. Tạo lúc {formatDate(receipt.created_at)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" /> Tải CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <FileText className="h-3.5 w-3.5" /> In phiếu
          </Button>
        </div>
      </motion.header>

      {/* Step strip: the receipt's whole path, with the current step marked. */}
      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4" aria-label="Tiến trình phiếu nhập">
        {steps.map((step, index) => (
          <li key={step.key} className="bg-card p-4" aria-current={step.state === "current" ? "step" : undefined}>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums",
                  step.state === "done" && "bg-primary text-primary-foreground",
                  step.state === "current" && "bg-primary/10 text-primary ring-2 ring-primary/40",
                  step.state === "todo" && "bg-muted text-muted-foreground",
                  step.state === "stopped" && "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
                )}
                aria-hidden="true"
              >
                {step.state === "done" ? <CheckCircle className="h-3.5 w-3.5" /> : step.state === "stopped" ? <XCircle className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className={cn("text-[14px]", step.state === "todo" ? "text-muted-foreground" : "font-semibold text-foreground")}>{step.title}</span>
            </span>
            <span className="mt-1 block pl-8 text-[12px] text-muted-foreground">{step.detail}</span>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {/* Staff verification — shown for ANY DRAFT GR, not restricted to invoice GRs */}
          {isDraft && !receipt.invoice ? (
            <section aria-labelledby="count-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
              <div className="space-y-3 px-5 pb-4 pt-4">
                <div>
                  <h2 id="count-title" className="font-serif text-[18px] font-semibold tracking-tight">Kiểm đếm hàng nhận</h2>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">Nhập hoặc quét số lượng thực tế trước khi quản lý duyệt.</p>
                </div>
                {!isVerified ? scanBar : verifiedNote}
              </div>
              {!isVerified ? (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Sách</TableHead>
                      <TableHead className="w-[88px] text-right text-[12px] font-normal text-muted-foreground">Kế hoạch</TableHead>
                      <TableHead className="w-[132px] pr-5 text-right text-[12px] font-normal text-muted-foreground">Thực đếm</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receipt.items.map((item) => {
                      const counted = countedQty[item.id] ?? item.quantity;
                      const diff = counted - item.quantity;
                      return (
                        <TableRow key={item.id} className={cn("transition-colors", item.id === highlightedItemId ? "bg-primary/[0.08]" : "hover:bg-muted/30")}>
                          <TableCell className="whitespace-normal py-3 pl-5 pr-3 align-top">
                            <p className="text-[14px] font-medium text-foreground">{item.book_title}</p>
                            <p className="font-mono text-[12px] text-muted-foreground">{item.barcode || "-"}</p>
                          </TableCell>
                          <TableCell className="py-3 text-right align-top text-[14px] tabular-nums">{item.quantity}</TableCell>
                          <TableCell className="py-2 pr-5 text-right align-top">
                            <div className="flex items-center justify-end gap-2">
                              {diff !== 0 ? <span className={cn("text-[12px] font-semibold tabular-nums", diffTone(diff))}>{diff > 0 ? `+${diff}` : diff}</span> : null}
                              {countInput(item.id, counted, item.book_title)}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : null}
            </section>
          ) : null}

          {/* NCC invoice comparison — visible to all roles */}
          {receipt.invoice ? (
            <section aria-labelledby="invoice-count-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
              <div className="space-y-3 px-5 pb-4 pt-4">
                <div>
                  <h2 id="invoice-count-title" className="font-serif text-[18px] font-semibold tracking-tight">Kiểm đếm theo phiếu giao nhà cung cấp</h2>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    So số nhà cung cấp xuất trên hóa đơn <span className="font-mono">{receipt.invoice.invoice_number}</span> với số đếm thực tế.
                  </p>
                </div>
                {isDraft && !isVerified ? scanBar : null}
                {isDraft && isVerified ? verifiedNote : null}
              </div>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Sách</TableHead>
                    <TableHead className="w-[80px] text-right text-[12px] font-normal text-muted-foreground">NCC xuất</TableHead>
                    <TableHead className="w-[112px] pr-5 text-right text-[12px] font-normal text-muted-foreground @2xl:pr-2">Thực đếm</TableHead>
                    <TableHead className="hidden w-[112px] pr-5 text-right text-[12px] font-normal text-muted-foreground @2xl:table-cell">Kết quả</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipt.invoice.items.map((invItem) => {
                    const receiptItem = receipt.items.find(
                      (ri) => ri.barcode === invItem.barcode || ri.barcode === invItem.isbn13 || ri.barcode === invItem.sku || ri.book_title === invItem.title
                    );
                    const expected = Number(invItem.invoiced_qty || 0);
                    const counted = receiptItem ? (countedQty[receiptItem.id] ?? receiptItem.quantity) : 0;
                    const diff = counted - expected;
                    const result = (
                      <>
                        <StatusBadge label={diff === 0 ? "Đủ" : diff > 0 ? `Thừa ${diff}` : `Thiếu ${Math.abs(diff)}`} variant={diff === 0 ? "success" : diff > 0 ? "danger" : "warning"} />
                      </>
                    );
                    return (
                      <TableRow key={invItem.id} className={cn("transition-colors", receiptItem?.id === highlightedItemId ? "bg-primary/[0.08]" : "hover:bg-muted/30")}>
                        <TableCell className="whitespace-normal py-3 pl-5 pr-3 align-top">
                          <p className="text-[14px] font-medium text-foreground">{invItem.title || "-"}</p>
                          <p className="font-mono text-[12px] text-muted-foreground">{invItem.isbn13 || invItem.sku || "-"}</p>
                          <div className="mt-1.5 @2xl:hidden">{result}</div>
                        </TableCell>
                        <TableCell className="py-3 text-right align-top text-[14px] tabular-nums">{expected}</TableCell>
                        <TableCell className="py-2 pr-5 text-right align-top @2xl:pr-2">
                          {receiptItem && isDraft && !isVerified ? (
                            <div className="flex justify-end">{countInput(receiptItem.id, countedQty[receiptItem.id] ?? receiptItem.quantity, invItem.title || invItem.variant_id)}</div>
                          ) : (
                            <span className={cn("text-[14px] font-semibold tabular-nums", diffTone(diff))}>{counted}</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden py-3 pr-5 text-right align-top @2xl:table-cell">{result}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          ) : null}

          <section aria-labelledby="items-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
            <div className="px-5 pb-3 pt-4">
              <h2 id="items-title" className="font-serif text-[18px] font-semibold tracking-tight">Danh sách hàng nhận</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{receipt.items.length} đầu sách trên phiếu, số kế hoạch và số đã đếm.</p>
            </div>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Sách</TableHead>
                  {showLocation ? <TableHead className="hidden w-[120px] text-[12px] font-normal text-muted-foreground @3xl:table-cell">Vị trí</TableHead> : null}
                  <TableHead className="w-[80px] text-right text-[12px] font-normal text-muted-foreground">Kế hoạch</TableHead>
                  <TableHead className={cn("w-[88px] text-right text-[12px] font-normal text-muted-foreground", showUnitCost ? "pr-5 @2xl:pr-2" : "pr-5")}>Thực đếm</TableHead>
                  {showUnitCost ? <TableHead className="hidden w-[112px] text-right text-[12px] font-normal text-muted-foreground @4xl:table-cell">Đơn giá</TableHead> : null}
                  {showUnitCost ? <TableHead className="hidden w-[124px] pr-5 text-right text-[12px] font-normal text-muted-foreground @2xl:table-cell">Thành tiền</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.items.map((item) => {
                  const diff = item.actual_quantity !== null ? item.actual_quantity - item.quantity : null;
                  const damaged = item.damaged_qty ?? 0;
                  const rejected = item.rejected_qty ?? 0;
                  return (
                    <TableRow key={item.id} className="hover:bg-muted/30">
                      <TableCell className="whitespace-normal py-3 pl-5 pr-3 align-top">
                        <p className="text-[14px] font-medium text-foreground">{item.book_title}</p>
                        <p className="font-mono text-[12px] text-muted-foreground">{item.barcode || "-"}</p>
                        {/* Columns the container hides move here, so no field is dropped. */}
                        {showLocation ? <p className="mt-0.5 text-[12px] text-muted-foreground @3xl:hidden">Vị trí <span className="font-mono">{item.location_code || "-"}</span></p> : null}
                        {showUnitCost ? (
                          <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground @4xl:hidden">
                            {formatCurrency(item.unit_cost)} mỗi cuốn<span className="@2xl:hidden">, thành tiền {formatCurrency(item.line_total)}</span>
                          </p>
                        ) : null}
                        {damaged > 0 || rejected > 0 ? (
                          <p className="mt-0.5 text-[12px] font-medium text-amber-800 dark:text-amber-300">{[damaged ? `${damaged} hỏng` : null, rejected ? `${rejected} từ chối` : null].filter(Boolean).join(", ")}</p>
                        ) : null}
                      </TableCell>
                      {showLocation ? <TableCell className="hidden py-3 align-top font-mono text-[12px] text-muted-foreground @3xl:table-cell">{item.location_code || "-"}</TableCell> : null}
                      <TableCell className="py-3 text-right align-top text-[14px] tabular-nums">{item.quantity}</TableCell>
                      <TableCell className={cn("py-3 text-right align-top", showUnitCost ? "pr-5 @2xl:pr-2" : "pr-5")}>
                        {item.actual_quantity !== null ? (
                          <span className={cn("text-[14px] font-semibold tabular-nums", diffTone(diff ?? 0))}>
                            {item.actual_quantity}
                            {diff ? <span className="ml-1 text-[12px] font-medium">({diff > 0 ? "+" : ""}{diff})</span> : null}
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">Chưa đếm</span>
                        )}
                      </TableCell>
                      {showUnitCost ? <TableCell className="hidden py-3 text-right align-top text-[13px] tabular-nums text-muted-foreground @4xl:table-cell">{formatCurrency(item.unit_cost)}</TableCell> : null}
                      {showUnitCost ? <TableCell className="hidden py-3 pr-5 text-right align-top text-[14px] font-medium tabular-nums @2xl:table-cell">{formatCurrency(item.line_total)}</TableCell> : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {/* Totals sit under the table, not in a colSpan row that would fight the hidden columns. */}
            <dl className="flex flex-wrap justify-end gap-x-8 gap-y-2 border-t border-border px-5 py-3 text-[13px]">
              <div className="flex items-baseline gap-2"><dt className="text-muted-foreground">Kế hoạch</dt><dd className="font-semibold tabular-nums">{totalQty} cuốn</dd></div>
              <div className="flex items-baseline gap-2"><dt className="text-muted-foreground">Đã đếm</dt><dd className="font-semibold tabular-nums">{isVerified ? `${countedTotal} cuốn` : "Chưa đủ"}</dd></div>
              {hasExceptions ? (
                <div className="flex items-baseline gap-2"><dt className="text-muted-foreground">Hỏng, từ chối</dt><dd className="font-semibold tabular-nums">{receipt.items.reduce((s, i) => s + (i.damaged_qty ?? 0) + (i.rejected_qty ?? 0), 0)} cuốn</dd></div>
              ) : null}
              {showUnitCost ? <div className="flex items-baseline gap-2"><dt className="text-muted-foreground">Tổng giá trị</dt><dd className="font-semibold tabular-nums">{formatCurrency(receipt.total_amount || 0)}</dd></div> : null}
            </dl>
          </section>

          {receipt.purchase_order_id ? <GoodsReceiptProcurementPanel receiptId={receipt.id} /> : null}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-4">
          <section aria-labelledby="actions-title" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="actions-title" className="font-serif text-[18px] font-semibold tracking-tight">Việc cần làm</h2>
            <div className="mt-3 space-y-3">
              {isPosted ? (
                <>
                  <p className="text-[13px] text-muted-foreground">Phiếu đã duyệt, tồn kho đã cộng. Bước tiếp theo là cất hàng lên kệ.</p>
                  <Button asChild className="w-full">
                    <NavLink to={`/putaway/${receipt.id}`} data-testid="go-to-putaway-link">
                      <ClipboardCheck className="h-4 w-4" /> Cất hàng vào kệ
                    </NavLink>
                  </Button>
                </>
              ) : isCancelled ? (
                <p className="text-[13px] text-muted-foreground">Phiếu đã hủy, không còn thao tác nào.</p>
              ) : showManageReceiving ? (
                <>
                  {receipt.received_by_user_id && !selectedReceiverId ? (
                    // Already assigned — show who + option to reassign
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[12px] text-muted-foreground">Nhân viên kiểm đếm</p>
                        <p className="truncate text-[13px] font-medium text-foreground">
                          {warehouseStaff.find((s) => s.id === receipt.received_by_user_id)?.full_name
                            || warehouseStaff.find((s) => s.id === receipt.received_by_user_id)?.username
                            || "Đã giao"}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedReceiverId(receipt.received_by_user_id ?? "")}>Đổi</Button>
                    </div>
                  ) : (
                    // Not assigned or reassigning
                    <div className="space-y-2">
                      <label htmlFor="receipt-receiver" className="block text-[13px] font-medium text-foreground">
                        {receipt.received_by_user_id ? "Đổi nhân viên kiểm đếm" : "Giao phiếu cho nhân viên kho"}
                      </label>
                      <select
                        id="receipt-receiver"
                        value={selectedReceiverId}
                        onChange={(event) => setSelectedReceiverId(event.target.value)}
                        className="h-10 w-full rounded-md border border-input bg-input-background px-3 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-muted/40"
                      >
                        <option value="">Chọn nhân viên</option>
                        {warehouseStaff.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.full_name || staff.username || staff.email}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" className="flex-1" onClick={() => void handleAssignReceiver()} disabled={isAssigning || !selectedReceiverId}>
                          <UserCheck className="h-4 w-4" /> {isAssigning ? "Đang giao" : "Giao"}
                        </Button>
                        {receipt.received_by_user_id && (
                          <Button type="button" variant="ghost" onClick={() => setSelectedReceiverId("")}>Hủy</Button>
                        )}
                      </div>
                    </div>
                  )}
                  {!isVerified ? <p className="text-[12px] text-amber-800 dark:text-amber-300">Nhân viên chưa lưu số kiểm đếm cho mọi dòng.</p> : null}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={isUpdatingStatus}
                    onClick={() => void handleUpdateStatus("POSTED")}
                    data-testid="approve-goods-receipt-button"
                  >
                    <CheckCircle className="h-4 w-4" /> {isUpdatingStatus ? "Đang xử lý..." : "Duyệt phiếu"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-muted-foreground hover:text-red-700 dark:hover:text-red-400"
                    disabled={isUpdatingStatus}
                    onClick={() => void handleUpdateStatus("CANCELLED")}
                  >
                    <XCircle className="h-4 w-4" /> Hủy phiếu
                  </Button>
                </>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  {isVerified ? "Bạn đã lưu số đếm. Quản lý sẽ duyệt phiếu để cộng tồn kho." : "Đếm hàng thực tế rồi bấm Lưu kiểm đếm. Quản lý duyệt phiếu sau đó."}
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby="facts-title" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="facts-title" className="font-serif text-[18px] font-semibold tracking-tight">Thông tin phiếu</h2>
            <dl className="mt-3 space-y-2.5">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-[12px] text-muted-foreground">{fact.label}</dt>
                  <dd className="mt-0.5 break-words text-[13px] text-foreground">{fact.value}</dd>
                </div>
              ))}
              {showUnitCost ? (
                <div className="border-t border-border pt-2.5">
                  <dt className="text-[12px] text-muted-foreground">Tổng giá trị</dt>
                  <dd className="mt-0.5 font-serif text-[22px] font-semibold tabular-nums text-foreground">{formatCurrency(receipt.total_amount || 0)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>

      {showScannerModal && (
        <BarcodeScanModal
          isOpen={true}
          onDetected={(barcode) => { handleScanBarcode(barcode); setShowScannerModal(false); }}
          onClose={() => setShowScannerModal(false)}
        />
      )}
    </div>
  );
}
