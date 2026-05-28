import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { StatusBadge } from "../status-badge";
import { NavLink, useParams } from "react-router";
import { ArrowLeft, Download, FileText, CheckCircle, XCircle, AlertCircle, ClipboardCheck } from "lucide-react";
import { goodsReceiptService } from "@/services/goods-receipt";
import { getApiErrorMessage } from "@/services/api.ts";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { authService } from "@/services/auth";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { canManageReceiving, canViewUnitCost, canViewLocationCode } from "@/lib/rbac";

interface ReceiptDetailItem {
  id: string;
  barcode: string | null;
  book_title: string;
  location_code: string | null;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

interface ReceiptDetail {
  id: string;
  receipt_number: string;
  purchase_order_id?: string | null;
  po_number?: string | null;
  source_type?: string | null;
  warehouse_code?: string;
  warehouse_name?: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  created_at: string;
  note?: string;
  total_amount: number;
  items: ReceiptDetailItem[];
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

  useEffect(() => {
    const fetchDetail = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await goodsReceiptService.getById(id);
        setReceipt(data as ReceiptDetail);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được chi tiết phiếu nhập"));
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [id]);

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
          <button className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm font-medium">
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
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Mã vạch</th>
                    <th className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Tên sách</th>
                    {showLocation ? <th className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Vị trí</th> : null}
                    <th className="text-right text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Số lượng</th>
                    {showUnitCost ? <th className="text-right text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Đơn giá</th> : null}
                    {showUnitCost ? <th className="text-right text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">Thành tiền</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map(item => (
                    <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{item.barcode || "-"}</td>
                      <td className="px-5 py-3.5 text-[13px] font-medium">{item.book_title}</td>
                      {showLocation ? <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{item.location_code || "-"}</td> : null}
                      <td className="px-5 py-3.5 text-right text-[13px] font-medium">{item.quantity}</td>
                      {showUnitCost ? <td className="px-5 py-3.5 text-right text-[12px] font-mono text-muted-foreground">{formatCurrency(item.unit_cost)}</td> : null}
                      {showUnitCost ? <td className="px-5 py-3.5 text-right text-[13px] font-mono font-medium">{formatCurrency(item.line_total)}</td> : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td colSpan={showLocation ? 3 : 2} className="px-5 py-3 text-right text-[13px] font-semibold">Tổng:</td>
                    <td className="px-5 py-3 text-right text-[14px] font-mono font-bold">{totalQty}</td>
                    {showUnitCost ? <td colSpan={2} className="px-5 py-3 text-right text-[14px] font-mono font-bold">{formatCurrency(receipt.total_amount || 0)}</td> : null}
                  </tr>
                </tfoot>
              </table>
            </SectionCard>
          </motion.div>
        </div>

        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <SectionCard title="Tóm tắt phiếu nhập" className="bg-gradient-to-br from-blue-50/80 to-indigo-50/50 border-blue-100/60">
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Kho</p>
                  <p className="text-[13px] font-medium mt-1">{receipt.warehouse_code || receipt.warehouse_name || "-"}</p>
                </div>
                {receipt.purchase_order_id && (
                  <>
                    <div className="h-px bg-blue-200/40" />
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">PO liên kết</p>
                      <NavLink to={`/purchase-orders/${receipt.purchase_order_id}`} className="text-[13px] font-medium text-indigo-600 hover:text-indigo-800">
                        {receipt.po_number || receipt.purchase_order_id}
                      </NavLink>
                    </div>
                  </>
                )}
                <div className="h-px bg-blue-200/40" />
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Số dòng sách</p>
                  <p className="text-[26px] text-blue-700 font-bold mt-1" style={{ lineHeight: 1 }}>{receipt.items.length}</p>
                </div>
                <div className="h-px bg-blue-200/40" />
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Tổng số lượng</p>
                  <p className="text-[26px] text-emerald-700 font-bold mt-1" style={{ lineHeight: 1 }}>{totalQty}</p>
                </div>
                {showUnitCost ? (
                  <>
                    <div className="h-px bg-blue-200/40" />
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Tổng giá trị</p>
                      <p className="text-[18px] font-mono font-bold text-indigo-600 mt-1">{formatCurrency(receipt.total_amount || 0)}</p>
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
                {showManageReceiving ? (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                    <p className="mb-2 text-[12px] font-semibold text-emerald-800">Giao phiếu cho nhân viên kho</p>
                    <div className="flex gap-2">
                      <select
                        value={selectedReceiverId}
                        onChange={(event) => setSelectedReceiverId(event.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-2 text-[12px]"
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
                    </div>
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
                      ? "border border-red-200 bg-red-50 text-red-700"
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
    </div>
  );
}
