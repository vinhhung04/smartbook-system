import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { StatusBadge } from "../status-badge";
import { NavLink, useParams } from "react-router";
import { ArrowLeft, Download, FileText, CheckCircle, XCircle, AlertCircle, ClipboardCheck, ScanBarcode, Save, Truck } from "lucide-react";
import { goodsReceiptService } from "@/services/goods-receipt";
import { getApiErrorMessage } from "@/services/api.ts";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { authService } from "@/services/auth";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { canManageReceiving, canViewUnitCost, canViewLocationCode } from "@/lib/rbac";

interface ReceiptDetailItem {
  id: string;
  barcode: string | null;
  book_title: string;
  location_code: string | null;
  quantity: number;
  actual_quantity: number | null;
  unit_cost: number;
  line_total: number;
}

interface InvoiceItem {
  id: string;
  variant_id: string;
  title: string | null;
  isbn13: string | null;
  sku: string | null;
  barcode: string | null;
  invoiced_qty: number;
}

interface EmbeddedInvoice {
  id: string;
  invoice_number: string;
  supplier_name: string | null;
  po_number: string | null;
  expected_delivery_date: string | null;
  items: InvoiceItem[];
}

interface ReceiptDetail {
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
  items: ReceiptDetailItem[];
  invoice?: EmbeddedInvoice | null;
}

function formatCurrency(value: number): string {
  return `${value.toLocaleString("vi-VN")} VND`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

  const totalQty = useMemo(() => receipt?.items?.reduce((s, i) => s + i.quantity, 0) || 0, [receipt]);
  const isVerified = useMemo(
    () => Boolean(receipt && receipt.items.length > 0 && receipt.items.every((i) => i.actual_quantity !== null)),
    [receipt],
  );
  const timeline = useMemo(() => {
    const created = { step: 1, title: "Tạo phiếu nhập", time: formatDate(receipt?.created_at || ""), completed: true, description: "Đã tạo bản nháp" };
    const posted = {
      step: 2,
      title: receipt?.status === "POSTED" ? "Đã duyệt" : "Chờ duyệt",
      time: receipt?.status === "POSTED" ? "Hoàn tất" : "Đang chờ",
      completed: receipt?.status === "POSTED",
      description: receipt?.status === "POSTED" ? "Tồn kho đã được cập nhật" : "Phiếu vẫn ở trạng thái nháp",
    };
    return [created, posted];
  }, [receipt]);

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

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {showManageReceiving ? (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <NavLink to="/orders" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors font-medium">
          <ArrowLeft className="w-3.5 h-3.5" /> Quay lại danh sách phiếu
        </NavLink>
      </motion.div>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="flex items-start justify-between gap-4"
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{receipt.receipt_number}</h1>
          <p className="text-[12px] text-muted-foreground mt-1">Tạo lúc {formatDate(receipt.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge label={receipt.status} variant={receipt.status === "POSTED" ? "success" : receipt.status === "DRAFT" ? "info" : "danger"} dot />
          <button className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-blue-100 bg-card text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm font-medium dark:border-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/10">
            <Download className="w-3.5 h-3.5" /> Tải xuống
          </button>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <SectionCard title="Tiến trình phiếu" subtitle="Theo dõi tiến trình phiếu nhập">
              <div className="space-y-3">
                {timeline.map((t, i) => (
                  <div key={t.step} className="flex gap-4">
                    <div className="flex flex-col items-center gap-2">
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.1 }}
                        className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${t.completed ? "bg-gradient-to-br from-emerald-500 to-teal-600 border-emerald-400 text-white" : "bg-card border-muted-foreground/30 text-muted-foreground"}`}>
                        {t.completed ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      </motion.div>
                      {i < timeline.length - 1 && <div className="w-0.5 h-12 bg-gradient-to-b from-emerald-400 to-muted-foreground/20" />}
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2.5 mb-0.5">
                        <span className="text-[13px] font-semibold">{t.title}</span>
                        <span className="text-[11px] text-muted-foreground">{t.time}</span>
                      </div>
                      <p className="text-[12px] text-muted-foreground">{t.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
          >
            <SectionCard title={`Danh sách hàng nhận (${receipt.items.length})`} noPadding>
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Mã vạch</th>
                    <th className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Tên sách</th>
                    {showLocation ? <th className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Vị trí</th> : null}
                    <th className="text-right text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">SL kế hoạch</th>
                    <th className="text-right text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">SL thực đếm</th>
                    {showUnitCost ? <th className="text-right text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Đơn giá</th> : null}
                    {showUnitCost ? <th className="text-right text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Thành tiền</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map(item => {
                    const diff = item.actual_quantity !== null ? item.actual_quantity - item.quantity : null;
                    return (
                    <tr key={item.id} className={`border-b border-border last:border-0 hover:bg-muted/20 transition-colors ${diff !== null && diff !== 0 ? "bg-amber-50/40 dark:bg-amber-500/10" : ""}`}>
                      <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{item.barcode || "-"}</td>
                      <td className="px-5 py-3.5 text-[13px] font-medium">{item.book_title}</td>
                      {showLocation ? <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{item.location_code || "-"}</td> : null}
                      <td className="px-5 py-3.5 text-right text-[13px] font-medium">{item.quantity}</td>
                      <td className="px-5 py-3.5 text-right text-[13px] font-medium">
                        {item.actual_quantity !== null ? (
                          <span className={diff === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                            {item.actual_quantity}
                            {diff !== 0 && diff !== null && (
                              <span className="ml-1 text-[11px]">({diff > 0 ? "+" : ""}{diff})</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[12px]">—</span>
                        )}
                      </td>
                      {showUnitCost ? <td className="px-5 py-3.5 text-right text-[12px] font-mono text-muted-foreground">{formatCurrency(item.unit_cost)}</td> : null}
                      {showUnitCost ? <td className="px-5 py-3.5 text-right text-[13px] font-mono font-medium">{formatCurrency(item.line_total)}</td> : null}
                    </tr>
                  );})}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td colSpan={showLocation ? 3 : 2} className="px-5 py-3 text-right text-[13px] font-semibold">Tổng:</td>
                    <td className="px-5 py-3 text-right text-[14px] font-mono font-bold">{totalQty}</td>
                    <td className="px-5 py-3 text-right text-[13px] text-muted-foreground">—</td>
                    {showUnitCost ? <td colSpan={2} className="px-5 py-3 text-right text-[14px] font-mono font-bold">{formatCurrency(receipt.total_amount || 0)}</td> : null}
                  </tr>
                </tfoot>
              </table>
              </div>
            </SectionCard>
          </motion.div>
        </div>

        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <SectionCard title="Tóm tắt phiếu nhập" className="bg-gradient-to-br from-blue-50/80 to-indigo-50/50 border-blue-100/60 dark:from-blue-500/10 dark:to-indigo-500/5 dark:border-blue-500/20">
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Kho</p>
                  <p className="text-[13px] font-medium mt-1">{receipt.warehouse_code || receipt.warehouse_name || "-"}</p>
                </div>
                {receipt.purchase_order_id && (
                  <>
                    <div className="h-px bg-blue-200/40 dark:bg-blue-500/20" />
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">PO liên kết</p>
                      <NavLink to={`/purchase-orders/${receipt.purchase_order_id}`} className="text-[13px] font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">
                        {receipt.po_number || receipt.purchase_order_id}
                      </NavLink>
                    </div>
                  </>
                )}
                <div className="h-px bg-blue-200/40 dark:bg-blue-500/20" />
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Số dòng sách</p>
                  <p className="text-[26px] text-blue-700 dark:text-blue-400 font-bold mt-1" style={{ lineHeight: 1 }}>{receipt.items.length}</p>
                </div>
                <div className="h-px bg-blue-200/40 dark:bg-blue-500/20" />
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Tổng số lượng</p>
                  <p className="text-[26px] text-emerald-700 dark:text-emerald-400 font-bold mt-1" style={{ lineHeight: 1 }}>{totalQty}</p>
                </div>
                {showUnitCost ? (
                  <>
                    <div className="h-px bg-blue-200/40 dark:bg-blue-500/20" />
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Tổng giá trị</p>
                      <p className="text-[18px] font-mono font-bold text-indigo-600 dark:text-indigo-400 mt-1">{formatCurrency(receipt.total_amount || 0)}</p>
                    </div>
                  </>
                ) : null}
              </div>
            </SectionCard>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
          >
            <SectionCard title="Thao tác" className="overflow-hidden">
              <div className="space-y-2">
                {showManageReceiving && receipt.status === "DRAFT" ? (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 space-y-2 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                    {receipt.received_by_user_id && !selectedReceiverId ? (
                      // Already assigned — show who + option to reassign
                      <>
                        <p className="text-[12px] font-semibold text-emerald-800 dark:text-emerald-300">Nhân viên kiểm đếm</p>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span className="text-[12px] font-medium text-emerald-900 dark:text-emerald-300">
                              {warehouseStaff.find((s) => s.id === receipt.received_by_user_id)?.full_name
                                || warehouseStaff.find((s) => s.id === receipt.received_by_user_id)?.username
                                || "Đã giao"}
                            </span>
                          </div>
                          <button
                            onClick={() => setSelectedReceiverId(receipt.received_by_user_id ?? "")}
                            className="text-[11px] text-emerald-700 underline hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-300"
                          >
                            Đổi
                          </button>
                        </div>
                      </>
                    ) : (
                      // Not assigned or reassigning
                      <>
                        <p className="text-[12px] font-semibold text-emerald-800 dark:text-emerald-300">
                          {receipt.received_by_user_id ? "Đổi nhân viên kiểm đếm" : "Giao phiếu cho nhân viên kho"}
                        </p>
                        <div className="flex gap-2">
                          <select
                            value={selectedReceiverId}
                            onChange={(event) => setSelectedReceiverId(event.target.value)}
                            className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-card px-2.5 py-2 text-[12px] dark:border-emerald-500/20"
                          >
                            <option value="">Chọn nhân viên</option>
                            {warehouseStaff.map((staff) => (
                              <option key={staff.id} value={staff.id}>
                                {staff.full_name || staff.username || staff.email}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => void handleAssignReceiver()}
                            disabled={isAssigning || !selectedReceiverId}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60"
                          >
                            {isAssigning ? "Đang giao" : "Giao"}
                          </button>
                          {receipt.received_by_user_id && (
                            <button
                              onClick={() => setSelectedReceiverId("")}
                              className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-muted"
                            >
                              Hủy
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
                <button onClick={() => window.print()} className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] hover:shadow-lg transition-all shadow-md shadow-blue-500/15 font-medium">
                  <FileText className="w-3.5 h-3.5" /> In phiếu
                </button>
                <NavLink
                  to={`/putaway/${receipt.id}`}
                  className={`w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-[13px] transition-all font-medium ${
                    receipt.status === "POSTED"
                      ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                      : "cursor-not-allowed border border-input bg-muted text-muted-foreground pointer-events-none"
                  }`}
                >
                  <ClipboardCheck className="w-3.5 h-3.5" /> Cất hàng vào kệ
                </NavLink>
                <button
                  disabled={!showManageReceiving || receipt.status !== "DRAFT" || isUpdatingStatus}
                  onClick={() => void handleUpdateStatus("POSTED")}
                  className={`w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-[13px] transition-all font-medium ${
                    showManageReceiving && receipt.status === "DRAFT" && !isUpdatingStatus
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
                      : "cursor-not-allowed border border-input bg-muted text-muted-foreground"
                  }`}
                >
                  <CheckCircle className="w-3.5 h-3.5" /> {isUpdatingStatus ? "Đang xử lý..." : "Duyệt phiếu"}
                </button>
                <button
                  disabled={!showManageReceiving || receipt.status !== "DRAFT" || isUpdatingStatus}
                  onClick={() => void handleUpdateStatus("CANCELLED")}
                  className={`w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-[13px] transition-all font-medium ${
                    showManageReceiving && receipt.status === "DRAFT" && !isUpdatingStatus
                      ? "border border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
                      : "cursor-not-allowed border border-input bg-muted text-muted-foreground"
                  }`}
                >
                  <XCircle className="w-3.5 h-3.5" /> Hủy phiếu
                </button>
              </div>
            </SectionCard>
          </motion.div>
        </div>
      </div>
      {/* Staff verification scan bar — shown for ANY DRAFT GR, not restricted to invoice GRs */}
      {receipt.status === "DRAFT" && !receipt.invoice && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
          <SectionCard title="Kiểm đếm hàng nhận" subtitle="Nhập hoặc scan số lượng thực tế trước khi manager duyệt">
            {!isVerified ? (
              <>
                <div className="flex gap-2 mb-4">
                  <div className="relative flex-1">
                    <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      ref={scanInputRef}
                      type="text"
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { handleScanBarcode(scanInput); } }}
                      placeholder="Scan hoặc nhập mã vạch để đếm..."
                      className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-border focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10"
                    />
                  </div>
                  <button type="button" onClick={() => setShowScannerModal(true)}
                    className="px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted text-[13px] font-medium flex items-center gap-1.5">
                    <ScanBarcode className="h-4 w-4" /> Camera
                  </button>
                  <button type="button" onClick={() => void handleSaveItemQty()} disabled={isSavingItems}
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-60">
                    <Save className="h-4 w-4" />
                    {isSavingItems ? "Đang lưu..." : "Lưu kiểm đếm"}
                  </button>
                </div>
                {/* Per-item quantity inputs — allows manual entry without barcode scanner */}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-muted border-b border-border">
                        {["Tên sách", "Mã vạch", "SL kế hoạch", "SL thực đếm"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {receipt.items.map((item) => {
                        const counted = countedQty[item.id] ?? item.quantity;
                        const diff = counted - item.quantity;
                        const isHighlighted = item.id === highlightedItemId;
                        return (
                          <tr key={item.id} className={`border-b border-border last:border-0 transition-colors ${isHighlighted ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-muted/40"}`}>
                            <td className="px-4 py-3 text-[13px] font-medium">{item.book_title}</td>
                            <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">{item.barcode || "-"}</td>
                            <td className="px-4 py-3 text-[13px] font-semibold text-indigo-700 dark:text-indigo-400">{item.quantity}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  value={counted}
                                  onChange={(e) => setCountedQty((prev) => ({ ...prev, [item.id]: Math.max(0, Number(e.target.value) || 0) }))}
                                  className="w-20 rounded-[6px] border border-border px-2 py-1 text-[12px] outline-none focus:border-indigo-400"
                                />
                                {diff !== 0 && (
                                  <span className={`text-[11px] font-semibold ${diff > 0 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>
                                    {diff > 0 ? `+${diff}` : diff}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <p className="text-[13px] text-emerald-800 dark:text-emerald-300 font-medium">Đã kiểm đếm xong — chờ manager duyệt phiếu nhập</p>
              </div>
            )}
          </SectionCard>
        </motion.div>
      )}

      {/* NCC invoice comparison — full width, below the main grid, visible to all roles */}
      {receipt.invoice && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
          <SectionCard
            title="Kiểm đếm theo phiếu xuất nhà cung cấp"
            subtitle={`${receipt.invoice.po_number || ""} · ${receipt.invoice.supplier_name || ""} · Hóa đơn ${receipt.invoice.invoice_number}`}
          >
            {/* Invoice info banner */}
            <div className="flex flex-wrap gap-4 mb-4 p-3 rounded-lg bg-sky-50 border border-sky-100 dark:bg-sky-500/10 dark:border-sky-500/20">
              <div className="flex items-center gap-2 text-[12px]">
                <Truck className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                <span className="text-muted-foreground">NCC:</span>
                <span className="font-semibold">{receipt.invoice.supplier_name || "-"}</span>
              </div>
              <div className="text-[12px]">
                <span className="text-muted-foreground">PO:</span>{" "}
                <span className="font-semibold">{receipt.invoice.po_number || "-"}</span>
              </div>
              <div className="text-[12px]">
                <span className="text-muted-foreground">Hóa đơn NCC:</span>{" "}
                <span className="font-semibold">{receipt.invoice.invoice_number}</span>
              </div>
              <div className="text-[12px]">
                <span className="text-muted-foreground">Kho nhận:</span>{" "}
                <span className="font-semibold">{receipt.warehouse_code || receipt.warehouse_name || "-"}</span>
              </div>
            </div>

            {/* Scan bar — only on DRAFT and not yet verified */}
            {receipt.status === "DRAFT" && !isVerified && (
              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    ref={scanInputRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { handleScanBarcode(scanInput); } }}
                    placeholder="Scan hoặc nhập mã vạch để đếm..."
                    className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-border focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10"
                  />
                </div>
                <button type="button" onClick={() => setShowScannerModal(true)}
                  className="px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted text-[13px] font-medium flex items-center gap-1.5">
                  <ScanBarcode className="h-4 w-4" /> Camera
                </button>
                <button type="button" onClick={() => void handleSaveItemQty()} disabled={isSavingItems}
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-60">
                  <Save className="h-4 w-4" />
                  {isSavingItems ? "Đang lưu..." : "Lưu kiểm đếm"}
                </button>
              </div>
            )}
            {/* Locked banner — shown after verification is saved */}
            {receipt.status === "DRAFT" && isVerified && (
              <div className="flex items-center gap-2 mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <p className="text-[13px] text-emerald-800 dark:text-emerald-300 font-medium">
                  Đã kiểm đếm xong — chờ manager duyệt phiếu nhập
                </p>
              </div>
            )}

            {/* Comparison table */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    {["Tên sách", "ISBN/Mã vạch", "NCC xuất", "Thực đếm", "Lệch", "Trạng thái"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {receipt.invoice.items.map((invItem) => {
                    const receiptItem = receipt.items.find(
                      (ri) => ri.barcode === invItem.barcode || ri.barcode === invItem.isbn13 || ri.barcode === invItem.sku || ri.book_title === invItem.title
                    );
                    const expected = Number(invItem.invoiced_qty || 0);
                    const counted = receiptItem ? (countedQty[receiptItem.id] ?? receiptItem.quantity) : 0;
                    const diff = counted - expected;
                    const isHighlighted = receiptItem?.id === highlightedItemId;
                    const statusLabel = diff === 0 ? "Đủ" : diff > 0 ? "Thừa" : "Thiếu";
                    const statusColor = diff === 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" : diff > 0 ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400";
                    return (
                      <tr key={invItem.id} className={`border-b border-border last:border-0 transition-colors ${isHighlighted ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-muted/60"}`}>
                        <td className="px-4 py-3 text-[13px] font-medium">{invItem.title || "-"}</td>
                        <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">{invItem.isbn13 || invItem.sku || "-"}</td>
                        <td className="px-4 py-2.5 text-[13px] font-semibold text-indigo-700 dark:text-indigo-400">{expected}</td>
                        <td className="px-4 py-2.5">
                          {receiptItem && receipt.status === "DRAFT" && !isVerified ? (
                            <input type="number" min={0}
                              value={countedQty[receiptItem.id] ?? receiptItem.quantity}
                              onChange={(e) => setCountedQty((prev) => ({ ...prev, [receiptItem.id]: Math.max(0, Number(e.target.value) || 0) }))}
                              className="w-20 rounded-[6px] border border-border px-2 py-1 text-[12px] outline-none focus:border-indigo-400"
                            />
                          ) : (
                            <span className="text-[13px]">{counted}</span>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 text-[13px] font-semibold ${diff > 0 ? "text-rose-600 dark:text-rose-400" : diff < 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {diff > 0 ? `+${diff}` : diff}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor}`}>{statusLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </motion.div>
      )}

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
