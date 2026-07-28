import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { purchaseOrderService, type PurchaseOrderSummary } from "@/services/purchase-order";
import { supplierService, type Supplier } from "@/services/supplier";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import { getApiErrorMessage } from "@/services/api";
import { StatusBadge } from "@/components/status-badge";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";

const statuses = ["ALL", "DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED", "RECEIVED", "CANCELLED"];

function statusVariant(status: string) {
  if (status === "RECEIVED") return "success";
  if (status === "APPROVED" || status === "SUPPLIER_CONFIRMED") return "primary";
  if (status === "PENDING_APPROVAL" || status === "SENT_TO_SUPPLIER" || status === "SHORTAGE_REPORTED") return "warning";
  if (status === "PARTIALLY_RECEIVED") return "cyan";
  if (status === "REJECTED" || status === "CANCELLED") return "danger";
  return "neutral";
}

function formatCurrency(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

export function PurchaseOrdersPage() {
  const currentUser = authService.getCurrentUser();
  const canCreatePurchaseOrder = canAccess(currentUser, ROUTE_ACCESS.purchaseWrite);
  const [rows, setRows] = useState<PurchaseOrderSummary[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [view, setView] = useState("all");

  const load = async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { view };
      if (search.trim()) params.search = search.trim();
      if (status !== "ALL") params.status = status;
      if (supplierId) params.supplier_id = supplierId;
      if (warehouseId) params.warehouse_id = warehouseId;
      const [poResp, supplierRows, warehouseRows] = await Promise.all([
        purchaseOrderService.getAll(params),
        supplierService.getAll(),
        warehouseService.getAll(),
      ]);
      setRows(Array.isArray(poResp.data) ? poResp.data : []);
      setSuppliers(Array.isArray(supplierRows) ? supplierRows : []);
      setWarehouses(Array.isArray(warehouseRows) ? warehouseRows : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to load purchase orders"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, supplierId, warehouseId, view]);

  const counts = useMemo(() => ({
    draft: rows.filter((row) => row.status === "DRAFT").length,
    pending: rows.filter((row) => row.status === "PENDING_APPROVAL").length,
    approved: rows.filter((row) => row.status === "APPROVED").length,
    partial: rows.filter((row) => row.status === "PARTIALLY_RECEIVED").length,
    received: rows.filter((row) => row.status === "RECEIVED").length,
  }), [rows]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="Đơn đặt hàng"
        description="Lập đơn đặt hàng, phê duyệt và đối soát nhập hàng"
        iconBg="bg-gradient-to-br from-indigo-600 to-sky-600 shadow-lg shadow-indigo-500/20"
        iconColor="text-white"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
            {canCreatePurchaseOrder ? <NavLink to="/purchase-orders/new" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground shadow-sm">
              <Plus className="h-3.5 w-3.5" />
              Tạo PO mới
            </NavLink> : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Nháp" value={counts.draft} variant="default" />
        <StatCard label="Chờ duyệt" value={counts.pending} variant="warning" />
        <StatCard label="Đã duyệt" value={counts.approved} variant="primary" />
        <StatCard label="Nhận một phần" value={counts.partial} variant="info" />
        <StatCard label="Đã nhận" value={counts.received} variant="success" />
      </div>

      <SectionCard>
        <div className="grid gap-3 md:grid-cols-5">
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} placeholder="Tìm PO, nhà cung cấp, kho..." className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]">
            {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]">
            <option value="">Tất cả nhà cung cấp</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]">
            <option value="">Tất cả kho</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>)}
          </select>
          <select value={view} onChange={(e) => setView(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]">
            <option value="all">Tất cả</option>
            <option value="my">Của tôi</option>
            <option value="approval">Chờ duyệt</option>
          </select>
        </div>
      </SectionCard>

      <SectionCard noPadding>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Số PO", "Nhà cung cấp", "Kho", "Trạng thái", "Ngày đặt", "Dự kiến", "Dòng", "SL đặt", "SL nhận", "Tổng tiền", "Đối soát"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={11} rows={5} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={11}><EmptyState variant="no-data" title="Chưa có đơn đặt hàng" description="Tạo PO để bắt đầu quy trình phê duyệt và đối soát nhập hàng" className="py-12" /></td></tr>
              ) : rows.map((row, index) => (
                <motion.tr key={row.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.02 }} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3.5"><NavLink to={`/purchase-orders/${row.id}`} className="text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">{row.po_number}</NavLink></td>
                  <td className="px-5 py-3.5 text-[13px]">{row.supplier_name || "-"}</td>
                  <td className="px-5 py-3.5 text-[13px]">{row.warehouse_code || row.warehouse_name || "-"}</td>
                  <td className="px-5 py-3.5"><StatusBadge label={row.status} variant={statusVariant(row.status)} dot /></td>
                  <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(row.order_date)}</td>
                  <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(row.expected_date)}</td>
                  <td className="px-5 py-3.5 text-[13px]">{row.item_count}</td>
                  <td className="px-5 py-3.5 text-[13px]">{row.total_ordered_qty}</td>
                  <td className="px-5 py-3.5 text-[13px]">{row.total_received_qty}</td>
                  <td className="px-5 py-3.5 text-[12px] font-mono">{formatCurrency(row.total_amount)}</td>
                  <td className="px-5 py-3.5"><StatusBadge label={row.reconciliation_status} variant={row.reconciliation_status === "FULLY_RECEIVED" ? "success" : row.reconciliation_status === "NOT_RECEIVED" ? "neutral" : "warning"} /></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
