import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, MoreHorizontal, BookOpen, Download, X, ScanBarcode, Sparkles, ChevronDown, Eye, RefreshCw, Package, AlertTriangle } from "lucide-react";
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

const filters = ["All", "Complete", "Incomplete", "Low Stock", "Out of Stock"];

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
  const [books, setBooks] = useState<CatalogBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sortField, setSortField] = useState<"title" | "stock" | "updatedAt">("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [saving, setSaving] = useState(false);
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
        category: row.category || "Uncategorized",
        quantity: Number(row.quantity || 0),
        location: row.location || "-",
        is_incomplete: Boolean(row.is_incomplete),
        updated_at: row.updated_at,
      })) as CatalogBook[];
      setBooks(rows);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach sach"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBooks();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    books.forEach((book) => set.add(book.category || "Uncategorized"));
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
      toast.error("ISBN13 va title la bat buoc");
      return;
    }

    if (!/^\d{13}$/.test(isbn13)) {
      toast.error("ISBN13 phai gom dung 13 chu so");
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

      toast.success(`Da them sach moi: ${title}`);
      setShowDrawer(false);
      setNewBook({ barcode: "", title: "", author: "", category: "", isbn: "" });
      await loadBooks();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Them sach that bai"));
    } finally {
      setSaving(false);
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
      {/* Hero Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 p-6 shadow-xl shadow-blue-500/15"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.12)_0%,transparent_50%)]" />
        <div className="absolute top-0 right-0 w-60 h-60 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center backdrop-blur-sm">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white tracking-tight" style={{ fontWeight: 700, fontSize: 20 }}>
                Book Catalog
              </h1>
              <p className="text-white/60 text-[12px] mt-0.5">
                {books.length} titles — {completeCount} complete, {incompleteCount} incomplete
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2.5">
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/15 border border-white/20 backdrop-blur-sm text-white text-[13px] hover:bg-white/25 active:scale-[0.98] transition-all"
              style={{ fontWeight: 600 }}
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            <NavLink
              to="/ai-import"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-indigo-700 text-[13px] shadow-md hover:shadow-lg hover:bg-indigo-50 active:scale-[0.98] transition-all"
              style={{ fontWeight: 600 }}
            >
              <Sparkles className="w-4 h-4" />
              AI Import
            </NavLink>
            <button
              onClick={() => setShowDrawer(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-blue-700 text-[13px] shadow-lg hover:shadow-xl hover:bg-blue-50 active:scale-[0.98] transition-all"
              style={{ fontWeight: 600 }}
            >
              <Plus className="w-4 h-4" />
              Add Book
            </button>
          </div>
        </div>
      </motion.div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.3 }}
        >
          <StatCard
            label="Total Titles"
            value={books.length}
            icon={BookOpen}
            variant="default"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <StatCard
            label="Complete"
            value={completeCount}
            icon={Package}
            variant="success"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
        >
          <StatCard
            label="Low Stock"
            value={lowStockCount}
            icon={AlertTriangle}
            variant="warning"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
        >
          <StatCard
            label="Out of Stock"
            value={outOfStockCount}
            icon={AlertTriangle}
            variant="danger"
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
            searchPlaceholder="Search by title, barcode, author..."
            filters={
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                  className="px-3 py-2 rounded-lg border border-input bg-background text-[13px] outline-none cursor-pointer focus:ring-2 focus:ring-primary/10 transition-all"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1 bg-muted/60 rounded-lg p-[3px]">
                  {filters.map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setActiveFilter(filter)}
                      className="relative px-3.5 py-1.5 rounded-md text-[12px] transition-all duration-160"
                      style={{ fontWeight: 550 }}
                    >
                      {activeFilter === filter && (
                        <motion.div
                          layoutId="catalog-filter"
                          className="absolute inset-0 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm"
                          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        />
                      )}
                      <span className={`relative z-10 ${activeFilter === filter ? "text-white" : "text-muted-foreground hover:text-foreground"}`}>
                        {filter}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            }
            actions={
              <button
                onClick={() => void loadBooks()}
                className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-input bg-background px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                style={{ fontWeight: 500 }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
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
                      Barcode
                    </th>
                    <th
                      className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3 cursor-pointer select-none hover:text-foreground transition-colors"
                      style={{ fontWeight: 550 }}
                      onClick={() => toggleSort("title")}
                    >
                      <span className="inline-flex items-center gap-1">
                        Title {sortField === "title" && <ChevronDown className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}
                      </span>
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                      Author
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                      Category
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                      Status
                    </th>
                    <th
                      className="text-right text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3 cursor-pointer select-none hover:text-foreground transition-colors"
                      style={{ fontWeight: 550 }}
                      onClick={() => toggleSort("stock")}
                    >
                      <span className="inline-flex items-center gap-1 justify-end">
                        Stock {sortField === "stock" && <ChevronDown className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}
                      </span>
                    </th>
                    <th
                      className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3 cursor-pointer select-none hover:text-foreground transition-colors"
                      style={{ fontWeight: 550 }}
                      onClick={() => toggleSort("updatedAt")}
                    >
                      <span className="inline-flex items-center gap-1">
                        Updated {sortField === "updatedAt" && <ChevronDown className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}
                      </span>
                    </th>
                    <th className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3" style={{ fontWeight: 550 }}>
                      Location
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
                          title="No books found"
                          description="Try adjusting your search or filters."
                          action={
                            <button
                              onClick={() => {
                                setSearchQuery("");
                                setActiveFilter("All");
                                setSelectedCategory("All");
                              }}
                              className="mt-2 text-[12px] text-primary hover:underline font-medium"
                            >
                              Clear all filters
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
                        <StatusBadge label={book.category || "Uncategorized"} variant="teal" />
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge
                          label={book.is_incomplete ? "Incomplete" : "Complete"}
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
                          <NavLink
                            to={`/book/${book.id}`}
                            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-primary/10 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5 text-primary" />
                          </NavLink>
                          <button className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted transition-colors">
                            <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
                <span>Showing {filtered.length} of {books.length} books</span>
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
                    <h3 className="text-[15px]" style={{ fontWeight: 650 }}>Add New Book</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Create an incomplete book record</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowDrawer(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                <div className="relative overflow-hidden p-4 rounded-xl bg-gradient-to-r from-blue-50/80 to-indigo-50/40 border border-blue-100/50">
                  <div className="flex items-center gap-2 text-[12px] text-blue-700">
                    <ScanBarcode className="w-4 h-4" />
                    <span style={{ fontWeight: 550 }}>
                      Enter barcode and title to create a new book record
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] text-muted-foreground block" style={{ fontWeight: 550 }}>
                    Barcode / ISBN *
                  </label>
                  <div className="mb-2 flex items-center gap-2">
                    <button
                      onClick={() => setShowBarcodeModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[12px] font-semibold text-cyan-700 hover:bg-cyan-100 transition-colors"
                    >
                      <ScanBarcode className="h-3.5 w-3.5" />
                      Scan Barcode
                    </button>
                    <button
                      onClick={handleOpenManualInput}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Manual Input
                    </button>
                  </div>
                  <input
                    ref={barcodeInputRef}
                    value={newBook.barcode}
                    onChange={(event) => setNewBook({ ...newBook, barcode: event.target.value })}
                    placeholder="Scan or type barcode..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-[14px] font-mono outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] text-muted-foreground block" style={{ fontWeight: 550 }}>
                    Title *
                  </label>
                  <input
                    value={newBook.title}
                    onChange={(event) => setNewBook({ ...newBook, title: event.target.value })}
                    placeholder="Book title..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-[14px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
                  />
                </div>
              </div>

              <div className="p-6 border-t border-border space-y-2">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => void handleAddBook()}
                  disabled={saving}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] shadow-md shadow-blue-500/15 hover:shadow-lg transition-all disabled:opacity-60"
                  style={{ fontWeight: 600 }}
                >
                  {saving ? "Dang luu..." : "Add to Catalog"}
                </motion.button>
                <button
                  onClick={() => setShowDrawer(false)}
                  className="w-full py-2.5 rounded-xl border border-input bg-background text-[13px] hover:bg-muted transition-colors"
                  style={{ fontWeight: 500 }}
                >
                  Cancel
                </button>
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
          toast.success(`Da quet ma: ${barcode}`);
        }}
        title="Quet barcode sach"
      />
    </div>
  );
}
