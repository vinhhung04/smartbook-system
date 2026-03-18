import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, MoreHorizontal, BookOpen, Download, X, ScanBarcode, Sparkles, ChevronDown, Eye } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion, AnimatePresence } from "motion/react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { BarcodeScanModal } from "../barcode-scan-modal";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api.ts";

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
    const barcode = newBook.barcode.trim();
    const title = newBook.title.trim();

    if (!barcode || !title) {
      toast.error("Barcode va title la bat buoc");
      return;
    }

    try {
      setSaving(true);
      await bookService.createIncomplete({
        barcode,
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
    <>
      <PageWrapper className="space-y-5">
        <FadeItem>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-blue-100 to-teal-50 flex items-center justify-center border border-blue-200/40">
                <BookOpen className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h1 className="tracking-[-0.02em]">Book Catalog</h1>
                <p className="text-[12px] text-slate-400 mt-0.5">{books.length} titles - {completeCount} complete - {incompleteCount} incomplete</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <button onClick={handleExport} className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm" style={{ fontWeight: 550 }}>
                <Download className="w-3.5 h-3.5" /> Export
              </button>
              <NavLink to="/ai-import" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border border-cyan-100 bg-white text-cyan-700 text-[13px] hover:bg-cyan-50 transition-all shadow-sm" style={{ fontWeight: 550 }}>
                <Sparkles className="w-3.5 h-3.5" /> AI Import
              </NavLink>
              <button onClick={() => setShowDrawer(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[11px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] shadow-lg shadow-blue-500/15 hover:shadow-xl hover:shadow-blue-500/25 active:scale-[0.98] transition-all" style={{ fontWeight: 550 }}>
                <Plus className="w-4 h-4" /> Add Book
              </button>
            </div>
          </div>
        </FadeItem>

        <FadeItem>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Total", value: books.length, color: "text-blue-700", bg: "from-blue-50 to-indigo-50/30 border-blue-100/60" },
              { label: "Complete", value: completeCount, color: "text-emerald-700", bg: "from-emerald-50 to-teal-50/30 border-emerald-100/60" },
              { label: "Low Stock", value: lowStockCount, color: "text-amber-700", bg: "from-amber-50 to-orange-50/30 border-amber-100/60" },
              { label: "Out of Stock", value: outOfStockCount, color: "text-rose-700", bg: "from-rose-50 to-red-50/30 border-rose-100/60" },
            ].map((stat) => (
              <motion.div key={stat.label} whileHover={{ y: -1 }} className={`bg-gradient-to-br ${stat.bg} rounded-[11px] border px-4 py-3 flex items-center justify-between`}>
                <span className="text-[12px] text-slate-500" style={{ fontWeight: 500 }}>{stat.label}</span>
                <span className={`text-[18px] ${stat.color} tracking-[-0.02em]`} style={{ fontWeight: 700 }}>{stat.value}</span>
              </motion.div>
            ))}
          </div>
        </FadeItem>

        <FadeItem>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by title, barcode, author..."
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-blue-100/60 rounded-[10px] text-[13px] outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-300/60 transition-all shadow-sm" />
            </div>
            <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} className="px-3 py-2.5 bg-white border border-blue-100/60 rounded-[10px] text-[13px] outline-none shadow-sm cursor-pointer">
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <div className="flex items-center gap-1 bg-white border border-slate-200/60 rounded-[10px] p-[3px] shadow-sm">
              {filters.map((filter) => (
                <button key={filter} onClick={() => setActiveFilter(filter)}
                  className={`relative px-3.5 py-1.5 rounded-[8px] text-[12px] transition-all duration-160 ${activeFilter === filter ? "text-white" : "text-slate-500 hover:text-slate-700"}`} style={{ fontWeight: 550 }}>
                  {activeFilter === filter && <motion.div layoutId="catalog-filter" className="absolute inset-0 rounded-[8px] bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
                  <span className="relative z-10">{filter}</span>
                </button>
              ))}
            </div>
          </div>
        </FadeItem>

        <FadeItem>
          <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-gradient-to-r from-blue-50/40 to-transparent">
                    <th className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>Barcode</th>
                    <th className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em] cursor-pointer select-none" style={{ fontWeight: 550 }} onClick={() => toggleSort("title")}>
                      <span className="inline-flex items-center gap-1">Title {sortField === "title" && <ChevronDown className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}</span>
                    </th>
                    <th className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>Author</th>
                    <th className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>Category</th>
                    <th className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>Status</th>
                    <th className="text-right text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em] cursor-pointer select-none" style={{ fontWeight: 550 }} onClick={() => toggleSort("stock")}>
                      <span className="inline-flex items-center gap-1 justify-end">Stock {sortField === "stock" && <ChevronDown className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}</span>
                    </th>
                    <th className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em] cursor-pointer select-none" style={{ fontWeight: 550 }} onClick={() => toggleSort("updatedAt")}>
                      <span className="inline-flex items-center gap-1">Updated {sortField === "updatedAt" && <ChevronDown className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`} />}</span>
                    </th>
                    <th className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>Location</th>
                    <th className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="text-center py-16">
                        <p className="text-[13px] text-slate-500">Dang tai danh sach sach...</p>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-16">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-100 to-teal-50 flex items-center justify-center border border-blue-200/30">
                            <BookOpen className="w-6 h-6 text-blue-400" />
                          </div>
                          <div>
                            <p className="text-[13px] text-slate-500" style={{ fontWeight: 550 }}>No books found</p>
                            <p className="text-[12px] text-slate-400 mt-0.5">Try adjusting your search or filters</p>
                          </div>
                          <button onClick={() => { setSearchQuery(""); setActiveFilter("All"); setSelectedCategory("All"); }} className="text-[12px] text-blue-600 hover:underline mt-1" style={{ fontWeight: 550 }}>Clear all filters</button>
                        </div>
                      </td>
                    </tr>
                  ) : filtered.map((book, index) => (
                    <motion.tr key={book.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.02, duration: 0.28 }}
                      className="border-b border-slate-50 last:border-0 hover:bg-gradient-to-r hover:from-blue-50/30 hover:to-transparent transition-all duration-140 cursor-pointer group">
                      <td className="px-5 py-3.5 text-[12px] font-mono text-slate-400">{book.barcode || "-"}</td>
                      <td className="px-5 py-3.5 text-[13px] group-hover:text-blue-600 transition-colors" style={{ fontWeight: 550 }}>
                        <NavLink to={`/book/${book.id}`}>{book.title}</NavLink>
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-slate-500">{book.author || "-"}</td>
                      <td className="px-5 py-3.5"><StatusBadge label={book.category || "Uncategorized"} variant="teal" /></td>
                      <td className="px-5 py-3.5">
                        <StatusBadge label={book.is_incomplete ? "Incomplete" : "Complete"} variant={book.is_incomplete ? "warning" : "success"} dot />
                      </td>
                      <td className="px-5 py-3.5 text-right text-[13px] font-mono" style={{ fontWeight: 600 }}>
                        <span className={book.quantity === 0 ? "text-red-500" : book.quantity <= 10 ? "text-amber-600" : "text-emerald-600"}>{book.quantity}</span>
                      </td>
                      <td className="px-5 py-3.5 text-[12px] text-slate-500">{toDisplayDate(book.updated_at)}</td>
                      <td className="px-5 py-3.5 text-[13px] text-slate-400">{book.location || "-"}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-140">
                          <NavLink to={`/book/${book.id}`} className="w-7 h-7 rounded-[7px] flex items-center justify-center hover:bg-blue-50 transition-colors">
                            <Eye className="w-3.5 h-3.5 text-blue-500" />
                          </NavLink>
                          <button className="w-7 h-7 rounded-[7px] flex items-center justify-center hover:bg-slate-100 transition-colors">
                            <MoreHorizontal className="w-4 h-4 text-slate-400" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-[12px] text-slate-400">
              <span>Showing {filtered.length} of {books.length} books</span>
            </div>
          </div>
        </FadeItem>
      </PageWrapper>

      <AnimatePresence>
        {showDrawer && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40" onClick={() => setShowDrawer(false)} />
            <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="fixed right-0 top-0 h-full w-[440px] bg-white border-l border-[#e2e4ed] shadow-2xl z-50 flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[9px] bg-gradient-to-br from-blue-100 to-teal-50 flex items-center justify-center border border-blue-200/40">
                    <Plus className="w-4 h-4 text-blue-600" />
                  </div>
                  <h3 className="text-[15px]" style={{ fontWeight: 650 }}>Add New Book</h3>
                </div>
                <button onClick={() => setShowDrawer(false)} className="w-7 h-7 rounded-[7px] flex items-center justify-center hover:bg-slate-100 transition-colors">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                <div className="relative overflow-hidden p-4 rounded-[12px] bg-gradient-to-r from-blue-50/60 to-teal-50/40 border border-blue-100/40">
                  <div className="flex items-center gap-2 text-[12px] text-blue-700">
                    <ScanBarcode className="w-4 h-4" />
                    <span style={{ fontWeight: 550 }}>Nhap barcode va ten sach de tao ban ghi moi tu DB</span>
                  </div>
                </div>
                <div>
                  <label className="text-[12px] text-slate-500 mb-1.5 block" style={{ fontWeight: 550 }}>Barcode / ISBN *</label>
                  <div className="mb-2 flex items-center gap-2">
                    <button
                      onClick={() => setShowBarcodeModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-[12px] font-semibold text-cyan-700"
                    >
                      <ScanBarcode className="h-3.5 w-3.5" /> Quet barcode
                    </button>
                    <button
                      onClick={handleOpenManualInput}
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-600"
                    >
                      Nhap thu cong
                    </button>
                  </div>
                  <input ref={barcodeInputRef} value={newBook.barcode} onChange={(event) => setNewBook({ ...newBook, barcode: event.target.value })} placeholder="Scan or type barcode..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200/60 rounded-[10px] text-[14px] font-mono outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-300/60 focus:bg-white transition-all" autoFocus />
                </div>
                <div>
                  <label className="text-[12px] text-slate-500 mb-1.5 block" style={{ fontWeight: 550 }}>Title *</label>
                  <input value={newBook.title} onChange={(event) => setNewBook({ ...newBook, title: event.target.value })} placeholder="Book title..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200/60 rounded-[10px] text-[14px] outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-300/60 focus:bg-white transition-all" />
                </div>
              </div>
              <div className="p-6 border-t border-slate-100 space-y-2">
                <motion.button whileTap={{ scale: 0.98 }} onClick={() => void handleAddBook()} disabled={saving} className="w-full py-2.5 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] shadow-md shadow-blue-500/15 hover:shadow-lg transition-all disabled:opacity-60" style={{ fontWeight: 550 }}>
                  {saving ? "Dang luu..." : "Add to Catalog"}
                </motion.button>
                <button onClick={() => setShowDrawer(false)} className="w-full py-2.5 rounded-[10px] border border-slate-200 bg-white text-[13px] hover:bg-slate-50 transition-all" style={{ fontWeight: 500 }}>
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
    </>
  );
}
