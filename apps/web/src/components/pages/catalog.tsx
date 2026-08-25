import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, BookOpen, Download, X, ScanBarcode, Sparkles, ChevronDown, Eye, RefreshCw, Package, AlertTriangle, Trash2, AlertOctagon } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { motion, AnimatePresence } from "motion/react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { BarcodeScanModal } from "../barcode-scan-modal";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDialogA11y } from "@/hooks/useDialogA11y";

const FILTERS = [
  { value: "All", label: "Tất cả" },
  { value: "Complete", label: "Hoàn chỉnh" },
  { value: "Incomplete", label: "Chưa hoàn chỉnh" },
  { value: "Low Stock", label: "Sắp hết hàng" },
  { value: "Out of Stock", label: "Hết hàng" },
];

interface CatalogBook {
  id: string;
  barcode?: string;
  isbn?: string;
  title: string;
  author: string;
  category: string;
  quantity: number;
  location: string;
  is_incomplete: boolean;
  updated_at?: string;
}

function toDisplayDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

export function CatalogPage() {
  const [activeFilter, setActiveFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDrawer, setShowDrawer] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeDrawer = () => setShowDrawer(false);
  useDialogA11y(showDrawer, closeDrawer, drawerRef);
  const [books, setBooks] = useState<CatalogBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sortField, setSortField] = useState<"title" | "stock" | "updatedAt">("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteBook, setDeleteBook] = useState<CatalogBook | null>(null);
  const deleteModalRef = useRef<HTMLDivElement>(null);
  const closeDeleteBook = () => setDeleteBook(null);
  useDialogA11y(Boolean(deleteBook), closeDeleteBook, deleteModalRef);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  const [newBook, setNewBook] = useState({ barcode: "", title: "", author: "", category: "", isbn: "" });

  const loadBooks = async () => {
    try {
      setLoading(true);
      const response = await bookService.getAll();
      const rows = (Array.isArray(response) ? response : []).map((row: any) => ({
        id: row.id,
        barcode: row.isbn || "",
        isbn: row.isbn || "",
        title: row.title,
        author: row.author || "-",
        category: row.category || "Chưa phân loại",
        quantity: Number(row.quantity || 0),
        location: row.location || "-",
        is_incomplete: Boolean(row.is_incomplete),
        updated_at: row.updated_at,
      })) as CatalogBook[];
      setBooks(rows);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách sách"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBooks();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    books.forEach((book) => set.add(book.category || "Chưa phân loại"));
    return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [books]);

  const filtered = books
    .filter((book) => {
      if (activeFilter === "Complete") return !book.is_incomplete;
      if (activeFilter === "Incomplete") return book.is_incomplete;
      if (activeFilter === "Low Stock") return book.quantity > 0 && book.quantity <= 10;
      if (activeFilter === "Out of Stock") return book.quantity === 0;
      return true;
    })
    .filter((book) => selectedCategory === "All" || book.category === selectedCategory)
    .filter(
      (book) =>
        searchQuery.trim() === ""
        || book.title.toLowerCase().includes(searchQuery.toLowerCase())
        || String(book.barcode || "").includes(searchQuery)
        || String(book.author || "").toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortField === "stock") return (a.quantity - b.quantity) * dir;
      if (sortField === "updatedAt") {
        return ((new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime()) || 0) * dir;
      }
      return a.title.localeCompare(b.title) * dir;
    });

  const handleAddBook = async () => {
    const isbn13 = newBook.barcode.trim().replace(/[^0-9]/g, "");
    const title = newBook.title.trim();

    if (!isbn13 || !title) {
      toast.error("ISBN13 và tên sách là bắt buộc");
      return;
    }

    if (!/^\d{13}$/.test(isbn13)) {
      toast.error("ISBN13 phải gồm đúng 13 chữ số");
      return;
    }

    try {
      setSaving(true);
      await bookService.createIncomplete({
        isbn13,
        title,
        price: 0,
        language: "vi",
      });

      toast.success(`Đã thêm sách mới: ${title}`);
      setShowDrawer(false);
      setNewBook({ barcode: "", title: "", author: "", category: "", isbn: "" });
      await loadBooks();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Thêm sách thất bại"));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBook = async () => {
    if (!deleteBook) return;
    try {
      setDeleting(deleteBook.id);
      await bookService.delete(deleteBook.id);
      toast.success(`Đã xóa sách: ${deleteBook.title}`);
      setDeleteBook(null);
      await loadBooks();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xóa sách thất bại"));
    } finally {
      setDeleting(null);
    }
  };

  const handleExport = () => {
    toast.success("Export started", { description: `${filtered.length} books will be exported to CSV` });
  };

  const handleOpenManualInput = () => {
    requestAnimationFrame(() => {
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select();
    });
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const completeCount = books.filter((book) => !book.is_incomplete).length;
  const incompleteCount = books.filter((book) => book.is_incomplete).length;
  const lowStockCount = books.filter((book) => book.quantity > 0 && book.quantity <= 10).length;
  const outOfStockCount = books.filter((book) => book.quantity === 0).length;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <PageHeader
          icon={BookOpen}
          title="Danh mục sách"
          description={`${books.length} đầu sách — ${completeCount} hoàn chỉnh, ${incompleteCount} chưa hoàn chỉnh`}
          iconBg="bg-gradient-to-br from-blue-100 to-indigo-50 dark:from-blue-500/20 dark:to-indigo-500/10"
          iconColor="text-blue-600 dark:text-blue-400"
          actions={
            <>
              <Button variant="outline" onClick={handleExport}>
                <Download className="w-4 h-4" />
                Xuất file
              </Button>
              <Button variant="outline" asChild>
                <NavLink to="/ai-import">
                  <Sparkles className="w-4 h-4" />
                  Nhập bằng AI
                </NavLink>
              </Button>
              <Button onClick={() => setShowDrawer(true)}>
                <Plus className="w-4 h-4" />
                Thêm sách
              </Button>
            </>
          }
        />
      </motion.div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.3 }}
        >
          <StatCard
            label="Tổng đầu sách"
            value={books.length}
            icon={BookOpen}
            variant="default"
            animateValue
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <StatCard
            label="Hoàn chỉnh"
            value={completeCount}
            icon={Package}
            variant="success"
            animateValue
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
        >
          <StatCard
            label="Sắp hết hàng"
            value={lowStockCount}
            icon={AlertTriangle}
            variant="warning"
            animateValue
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
        >
          <StatCard
            label="Hết hàng"
            value={outOfStockCount}
            icon={AlertTriangle}
            variant="danger"
            animateValue
          />
        </motion.div>
      </div>

      {/* Filter Bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
      >
        <div className="rounded-xl border border-black/5 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
          <FilterBar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Tìm theo tên sách, mã vạch, tác giả..."
            filters={
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category === "All" ? "Tất cả danh mục" : category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <SegmentedControl
                  options={FILTERS}
                  value={activeFilter}
                  onChange={setActiveFilter}
                  layoutId="catalog-filter"
                  gradientClassName="from-blue-600 to-indigo-600"
                  className="overflow-x-auto"
                />
              </div>
            }
            actions={
              <Button variant="outline" onClick={() => void loadBooks()} loading={loading}>
                <RefreshCw className="w-3.5 h-3.5" />
                Làm mới
              </Button>
            }
          />
        </div>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
      >
        <SectionCard noPadding className="overflow-hidden">
          {loading ? (
            <LoadingOverlay />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                      Mã vạch
                    </th>
                    <th
                      className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3 cursor-pointer select-none hover:text-foreground transition-colors"
                      style={{ fontWeight: 550 }}
                      onClick={() => toggleSort("title")}
                    >
                      <span className="inline-flex items-center gap-1">
                        Tên sách {sortField === "title" && <ChevronDown className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}
                      </span>
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                      Tác giả
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                      Danh mục
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                      Trạng thái
                    </th>
                    <th
                      className="text-right text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3 cursor-pointer select-none hover:text-foreground transition-colors"
                      style={{ fontWeight: 550 }}
                      onClick={() => toggleSort("stock")}
                    >
                      <span className="inline-flex items-center gap-1 justify-end">
                        Tồn kho {sortField === "stock" && <ChevronDown className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}
                      </span>
                    </th>
                    <th
                      className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3 cursor-pointer select-none hover:text-foreground transition-colors"
                      style={{ fontWeight: 550 }}
                      onClick={() => toggleSort("updatedAt")}
                    >
                      <span className="inline-flex items-center gap-1">
                        Cập nhật {sortField === "updatedAt" && <ChevronDown className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}
                      </span>
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                      Vị trí
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <EmptyState
                          variant="no-results"
                          title="Không tìm thấy sách"
                          description="Thử điều chỉnh tìm kiếm hoặc bộ lọc."
                          action={
                            <button
                              onClick={() => {
                                setSearchQuery("");
                                setActiveFilter("All");
                                setSelectedCategory("All");
                              }}
                              className="mt-2 text-[12px] text-primary hover:underline font-medium"
                            >
                              Xóa tất cả bộ lọc
                            </button>
                          }
                        />
                      </td>
                    </tr>
                  ) : filtered.map((book, index) => (
                    <motion.tr
                      key={book.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02, duration: 0.2 }}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer group"
                    >
                      <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{book.barcode || "-"}</td>
                      <td className="px-5 py-3.5 text-[13px] group-hover:text-primary transition-colors" style={{ fontWeight: 550 }}>
                        <NavLink to={`/book/${book.id}`} className="hover:underline">
                          {book.title}
                        </NavLink>
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-muted-foreground">{book.author || "-"}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge label={book.category || "Chưa phân loại"} variant="teal" />
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge
                          label={book.is_incomplete ? "Chưa hoàn chỉnh" : "Hoàn chỉnh"}
                          variant={book.is_incomplete ? "warning" : "success"}
                          dot
                        />
                      </td>
                      <td className="px-5 py-3.5 text-right text-[13px] font-mono" style={{ fontWeight: 600 }}>
                        <span className={
                          book.quantity === 0 ? "text-destructive" :
                          book.quantity <= 10 ? "text-amber-600" :
                          "text-emerald-600"
                        }>
                          {book.quantity}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{toDisplayDate(book.updated_at)}</td>
                      <td className="px-5 py-3.5 text-[13px] text-muted-foreground">{book.location || "-"}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-140">
                          <IconButton asChild variant="ghost" size="sm-icon" label="Xem chi tiết sách">
                            <NavLink to={`/book/${book.id}`}>
                              <Eye className="w-3.5 h-3.5 text-primary" />
                            </NavLink>
                          </IconButton>
                          <IconButton
                            variant="ghost"
                            size="sm-icon"
                            label="Xóa sách"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteBook(book);
                            }}
                            className="hover:bg-red-50 dark:hover:bg-red-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
                          </IconButton>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
                <span>Hiển thị {filtered.length} / {books.length} sách</span>
              </div>
            </div>
          )}
        </SectionCard>
      </motion.div>

      {/* Drawer */}
      <AnimatePresence>
        {showDrawer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40"
              onClick={() => setShowDrawer(false)}
            />
            <motion.div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-book-drawer-title"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="fixed right-0 top-0 h-full w-[440px] bg-background border-l border-border shadow-2xl z-50 flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-50 border border-blue-200/40 flex items-center justify-center">
                    <Plus className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <h3 id="add-book-drawer-title" className="text-[15px]" style={{ fontWeight: 650 }}>Thêm sách mới</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Tạo bản ghi sách chưa hoàn chỉnh</p>
                  </div>
                </div>
                <IconButton variant="ghost" size="sm-icon" label="Đóng" onClick={() => setShowDrawer(false)}>
                  <X className="w-4 h-4 text-muted-foreground" />
                </IconButton>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                <div className="relative overflow-hidden p-4 rounded-xl bg-gradient-to-r from-blue-50/80 to-indigo-50/40 border border-blue-100/50">
                  <div className="flex items-center gap-2 text-[12px] text-blue-700">
                    <ScanBarcode className="w-4 h-4" />
                    <span style={{ fontWeight: 550 }}>
                      Nhập mã vạch và tên sách để tạo bản ghi sách mới
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] text-muted-foreground block" style={{ fontWeight: 550 }}>
                    Mã vạch / ISBN *
                  </label>
                  <div className="mb-2 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowBarcodeModal(true)}
                      className="border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-400 dark:hover:bg-cyan-500/15"
                    >
                      <ScanBarcode className="h-3.5 w-3.5" />
                      Quét mã vạch
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleOpenManualInput}>
                      Nhập thủ công
                    </Button>
                  </div>
                  <input
                    ref={barcodeInputRef}
                    value={newBook.barcode}
                    onChange={(event) => setNewBook({ ...newBook, barcode: event.target.value })}
                    placeholder="Quét hoặc nhập mã vạch..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-[14px] font-mono outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] text-muted-foreground block" style={{ fontWeight: 550 }}>
                    Tên sách *
                  </label>
                  <Input
                    value={newBook.title}
                    onChange={(event) => setNewBook({ ...newBook, title: event.target.value })}
                    placeholder="Tên sách..."
                    className="h-auto py-2.5"
                  />
                </div>
              </div>

              <div className="p-6 border-t border-border space-y-2">
                <Button
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90"
                  onClick={() => void handleAddBook()}
                  loading={saving}
                >
                  Thêm vào danh mục
                </Button>
                <Button variant="outline" className="w-full" onClick={() => setShowDrawer(false)}>
                  Hủy
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <BarcodeScanModal
        isOpen={showBarcodeModal}
        onClose={() => setShowBarcodeModal(false)}
        onDetected={(barcode) => {
          setNewBook((prev) => ({
            ...prev,
            barcode,
            isbn: prev.isbn || barcode,
          }));
          setShowBarcodeModal(false);
          toast.success(`Đã quét mã: ${barcode}`);
        }}
        title="Quét mã vạch sách"
      />

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteBook && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-50"
              onClick={() => setDeleteBook(null)}
            />
            <motion.div
              ref={deleteModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-book-modal-title"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] bg-background rounded-2xl border border-border shadow-2xl z-50 overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
                    <AlertOctagon className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <h3 id="delete-book-modal-title" className="text-[15px] font-semibold">Xóa sách</h3>
                    <p className="text-[11px] text-muted-foreground">Hành động này không thể hoàn tác</p>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border mb-5">
                  <p className="text-[13px] font-medium mb-1">{deleteBook.title}</p>
                  <p className="text-[12px] text-muted-foreground">
                    ISBN: {deleteBook.barcode || "N/A"} | Tồn kho: {deleteBook.quantity}
                  </p>
                </div>
                <p className="text-[13px] text-muted-foreground mb-5">
                  Bạn có chắc muốn xóa sách này? Sách sẽ bị xóa vĩnh viễn khỏi danh mục.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => void handleDeleteBook()}
                    loading={deleting === deleteBook.id}
                  >
                    Xóa
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setDeleteBook(null)}>
                    Hủy
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
