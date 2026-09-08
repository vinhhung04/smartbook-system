import { useEffect, useMemo, useState } from "react";
import { Package, Plus, Download, MoreVertical, ClipboardCheck, Eye } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { motion } from "motion/react";
import { NavLink, useNavigate } from "react-router";
import { goodsReceiptService, type GoodsReceipt } from "@/services/goods-receipt";
import { getApiErrorMessage } from "@/services/api.ts";
import { toast } from "sonner";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { exportToCsv } from "@/lib/export-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STATUS_FILTER_OPTIONS = [
  { value: "All", label: "Tất cả" },
  { value: "Draft", label: "Nháp" },
  { value: "Posted", label: "Đã ghi sổ" },
  { value: "Cancelled", label: "Đã hủy" },
];

const PAGE_SIZE = 10;

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

export function OrdersPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [receiptsData, setReceiptsData] = useState<GoodsReceipt[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchReceipts = async () => {
      try {
        setLoading(true);
        const data = await goodsReceiptService.getAll();
        setReceiptsData(Array.isArray(data) ? data : []);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Failed to load goods receipts"));
      } finally {
        setLoading(false);
      }
    };

    fetchReceipts();
  }, []);

  const filtered = useMemo(() => receiptsData.filter((r) => {
    if (statusFilter === "Draft" && r.status !== "DRAFT") return false;
    if (statusFilter === "Posted" && r.status !== "POSTED") return false;
    if (statusFilter === "Cancelled" && r.status !== "CANCELLED") return false;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      r.receipt_number.toLowerCase().includes(query)
      || (r.warehouse_code || "").toLowerCase().includes(query)
      || (r.warehouse_name || "").toLowerCase().includes(query)
    );
  }), [receiptsData, statusFilter, searchQuery]);

  const handleExport = () => {
    exportToCsv(
      filtered.map((r) => ({
        receipt_number: r.receipt_number,
        po_number: r.po_number || '',
        warehouse_name: r.warehouse_name || '',
        item_count: r.item_count,
        total_amount: r.total_amount,
        status: r.status,
        created_at: formatDate(r.created_at),
      })),
      [
        { header: 'Số phiếu', key: 'receipt_number' },
        { header: 'Số PO', key: 'po_number' },
        { header: 'Kho', key: 'warehouse_name' },
        { header: 'Số mặt hàng', key: 'item_count' },
        { header: 'Tổng tiền', key: 'total_amount' },
        { header: 'Trạng thái', key: 'status' },
        { header: 'Ngày tạo', key: 'created_at' },
      ],
      'phieu-nhap-kho',
    );
  };

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const draftCount = receiptsData.filter(r => r.status === "DRAFT").length;
  const postedCount = receiptsData.filter(r => r.status === "POSTED").length;
  const totalUnits = receiptsData.reduce((s, r) => s + r.item_count, 0);

  const postedToday = receiptsData.filter((r) => {
    if (r.status !== "POSTED") return false;
    const d = new Date(r.created_at);
    const now = new Date();
    return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <PageHeader
          icon={Package}
          title="Phiếu nhập hàng"
          description={`${receiptsData.length} phiếu · ${totalUnits} sản phẩm`}
          iconBg="bg-gradient-to-br from-blue-100 to-indigo-50 dark:from-blue-500/15 dark:to-indigo-500/10"
          iconColor="text-blue-600 dark:text-blue-400"
          actions={
            <>
              <NavLink to="/putaway" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-emerald-100 dark:border-emerald-500/20 bg-card text-emerald-700 dark:text-emerald-400 text-[13px] hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-all shadow-sm font-medium">
                <ClipboardCheck className="w-3.5 h-3.5" /> Putaway
              </NavLink>
              <button onClick={handleExport} className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-blue-100 dark:border-blue-500/20 bg-card text-blue-700 dark:text-blue-400 text-[13px] hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all shadow-sm font-medium">
                <Download className="w-3.5 h-3.5" /> Xuất
              </button>
              <NavLink to="/orders/new" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] shadow-md shadow-blue-500/15 hover:shadow-lg transition-all font-medium">
                <Plus className="w-3.5 h-3.5" /> Phiếu mới
              </NavLink>
            </>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <StatCard label="Nháp" value={draftCount} variant="default" />
        <StatCard label="Đã ghi sổ" value={postedCount} variant="success" />
        <StatCard label="Tổng sản phẩm" value={totalUnits} variant="info" />
        <StatCard label="Ghi sổ hôm nay" value={postedToday} variant="primary" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <FilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Tìm theo mã phiếu hoặc kho..."
          showSearchClear
          filters={
            <SegmentedControl
              options={STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={setStatusFilter}
              layoutId="orders-status-filter"
              gradientClassName="from-blue-600 to-indigo-600"
            />
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {["Mã phiếu", "Kho", "Trạng thái", "Người tạo", "Ngày", "Sản phẩm", "Tổng tiền", "Thao tác"].map(h => (
                    <th key={h} className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={8} rows={4} />
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState variant="no-results" title="Không tìm thấy phiếu nào" description="Thử điều chỉnh tìm kiếm hoặc bộ lọc" className="py-12" /></td></tr>
                ) : paginated.map((r, i) => (
                  <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <NavLink to={`/orders/${r.id}`} className="text-[13px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium">{r.receipt_number}</NavLink>
                    </td>
                    <td className="px-5 py-3.5 text-[13px]">{r.warehouse_code || r.warehouse_name || "-"}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge label={r.status} variant={r.status === "DRAFT" ? "info" : r.status === "POSTED" ? "success" : "danger"} dot />
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-muted-foreground">{r.received_by_user_id?.slice(0, 8) || "-"}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(r.created_at)}</td>
                    <td className="px-5 py-3.5 text-[13px] font-medium">{r.item_count}</td>
                    <td className="px-5 py-3.5 text-[13px] font-mono font-medium">{formatCurrency(r.total_amount || 0)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button aria-label="Thao tác khác" className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/orders/${r.id}`)}>
                            <Eye className="w-3.5 h-3.5" /> Xem chi tiết
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
            <span>Hiển thị {paginated.length} / {filtered.length} phiếu</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-3 py-1 rounded border border-input text-blue-600 dark:text-blue-400 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Trước
              </button>
              <span className="px-2">Trang {currentPage} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-3 py-1 rounded border border-input text-blue-600 dark:text-blue-400 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Tiếp
              </button>
            </div>
          </div>
        </SectionCard>
      </motion.div>
    </div>
  );
}
