import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, BookOpen, Download, X, ScanBarcode, Camera, Sparkles, ChevronDown, Eye, RefreshCw, AlertTriangle, Trash2, Copy, Check } from "lucide-react";
import { CatalogBookThumbnail } from "./catalog-book-thumbnail";
import { motion, AnimatePresence } from "motion/react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { BarcodeScanModal } from "../barcode-scan-modal";
import { CoverSearchModal } from "../cover-search-modal";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api";
import { PageWrapper, FadeItem } from "../motion-utils";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { useDialogA11y } from "@/hooks/useDialogA11y";

const PAGE_SIZE = 10;

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
  cover_image_url?: string | null;
  list_price?: number;
  publisher?: string | null;
  publish_year?: number | null;
  available_quantity: number;
  receiving_quantity: number;
  location_count: number;
}

function toDisplayPrice(value?: number) {
  if (!value) return "-";
  return value.toLocaleString("vi-VN") + " đ";
}

function csvCell(value: string | number) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
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
  const [showCoverSearchModal, setShowCoverSearchModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteBook, setDeleteBook] = useState<CatalogBook | null>(null);
  const [page, setPage] = useState(1);
  const [copiedBarcode, setCopiedBarcode] = useState("");
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
        cover_image_url: row.cover_image_url || null,
        list_price: Number(row.list_price || 0),
        publisher: row.publisher || null,
        publish_year: row.publish_year || null,
        available_quantity: Number(row.available_quantity || 0),
        receiving_quantity: Number(row.receiving_quantity || 0),
        location_count: Number(row.location_count || 0),
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedBooks = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, activeFilter, selectedCategory]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

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
      await bookService.delete(deleteBook.id);
      toast.success(`Đã xóa sách: ${deleteBook.title}`);
      setDeleteBook(null);
      await loadBooks();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Xóa sách thất bại"));
    }
  };

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("Không có sách nào để xuất");
      return;
    }

    const header = ["Mã vạch", "Tên sách", "Tác giả", "Danh mục", "Trạng thái", "Giá", "Tồn kho", "Vị trí", "Cập nhật"];
    const rows = filtered.map((book) => [
      book.barcode || "",
      book.title,
      book.author || "",
      book.category || "",
      book.is_incomplete ? "Chưa hoàn chỉnh" : "Hoàn chỉnh",
      book.list_price || 0,
      book.quantity,
      book.location || "",
      toDisplayDate(book.updated_at),
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const csvBom = String.fromCharCode(0xfeff);
    const blob = new Blob([csvBom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `danh-muc-sach-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success("Đã xuất file", { description: `${filtered.length} sách đã được xuất ra CSV` });
  };

  const handleCopyBarcode = (barcode: string) => {
    if (!barcode) return;
    navigator.clipboard.writeText(barcode)
      .then(() => setCopiedBarcode(barcode))
      .then(() => setTimeout(() => setCopiedBarcode(""), 1500))
      .catch(() => toast.error("Không thể sao chép"));
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

  const STATUS_OPTIONS = [
    { value: "All", label: "Tất cả", count: books.length, hint: "Mọi đầu sách trong danh mục." },
    { value: "Complete", label: "Hoàn chỉnh", count: completeCount, hint: "Đã đủ thông tin để bán và cho mượn." },
    { value: "Incomplete", label: "Chưa hoàn chỉnh", count: incompleteCount, hint: "Thiếu thông tin, cần bổ sung trong trang chi tiết." },
    { value: "Low Stock", label: "Sắp hết", count: lowStockCount, hint: "Còn từ 1 đến 10 cuốn trong kho." },
    { value: "Out of Stock", label: "Hết hàng", count: outOfStockCount, hint: "Không còn cuốn nào trong kho." },
  ];
  const activeStatus = STATUS_OPTIONS.find((o) => o.value === activeFilter) ?? STATUS_OPTIONS[0];
  const categoryCounts = new Map<string, number>();
  for (const book of books) categoryCounts.set(book.category, (categoryCounts.get(book.category) ?? 0) + 1);
  const receivingCount = books.filter((book) => book.receiving_quantity > 0).length;
  const hasFilters = activeFilter !== "All" || selectedCategory !== "All" || searchQuery.trim() !== "";
  const clearFilters = () => {
    setSearchQuery("");
    setActiveFilter("All");
    setSelectedCategory("All");
  };

  // The finding first: how much of the catalog is stocked, and what needs attention.
  const lede = loading
    ? "Danh mục sách của thư viện, kèm tồn kho và vị trí."
    : books.length === 0
      ? "Danh mục chưa có sách nào. Thêm sách hoặc nhập bằng AI để bắt đầu."
      : `${books.length} đầu sách. ${[
          outOfStockCount ? `${outOfStockCount} hết hàng` : null,
          lowStockCount ? `${lowStockCount} sắp hết` : null,
          incompleteCount ? `${incompleteCount} chưa đủ thông tin` : null,
          receivingCount ? `${receivingCount} đang có hàng ở khu nhận` : null,
        ].filter(Boolean).join(", ") || "Tất cả đều đủ thông tin và còn hàng"}.`;

  const railButton = (active: boolean, onClick: () => void, label: string, count: number, attention = false) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-primary/[0.08] text-primary" : "text-foreground hover:bg-muted/60",
      )}
    >
      <span className={cn("min-w-0 truncate text-[13px]", active ? "font-semibold" : "font-medium")} title={label}>{label}</span>
      <span
        className={cn(
          "min-w-6 shrink-0 rounded-full px-1.5 text-center text-[12px] tabular-nums",
          attention && count > 0 ? "bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {loading ? "–" : count}
      </span>
    </button>
  );

  const sortHead = (field: typeof sortField, label: string, className: string, alignEnd = false) => (
    <TableHead className={className} aria-sort={sortField === field ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className={cn("inline-flex items-center gap-1 rounded text-[12px] font-normal transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", alignEnd && "flex-row-reverse")}
      >
        {label}
        <ChevronDown className={cn("h-3 w-3 transition-transform", sortField === field ? "opacity-100" : "opacity-0", sortField === field && sortDir === "desc" && "rotate-180")} aria-hidden="true" />
      </button>
    </TableHead>
  );

  const rowActions = (book: CatalogBook) => (
    <div className="flex items-center justify-end gap-1">
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
        <Trash2 className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
      </IconButton>
    </div>
  );

  const stockTone = (quantity: number) => (quantity === 0 ? "text-red-700 dark:text-red-400" : quantity <= 10 ? "text-amber-700 dark:text-amber-300" : "text-foreground");

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={BookOpen}
          title="Danh mục sách"
          description={lede}
          actions={
            <>
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
      </FadeItem>

      <FadeItem>
        {/* Named so the toolbar inside the list (its own container) can still ask whether the rail is showing. */}
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[232px_minmax(0,1fr)]">
            <nav aria-label="Lọc danh mục sách" className="hidden max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Tình trạng</p>
              <div role="group" aria-label="Lọc theo tình trạng">
                {STATUS_OPTIONS.map((o) => (
                  <div key={o.value}>{railButton(activeFilter === o.value, () => setActiveFilter(o.value), o.label, o.count, o.value === "Low Stock" || o.value === "Incomplete")}</div>
                ))}
              </div>
              <div className="mt-3 border-t border-border pt-3" role="group" aria-label="Lọc theo danh mục">
                <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Danh mục</p>
                {categories.map((category) => (
                  <div key={category}>
                    {railButton(selectedCategory === category, () => setSelectedCategory(category), category === "All" ? "Tất cả danh mục" : category, category === "All" ? books.length : categoryCounts.get(category) ?? 0)}
                  </div>
                ))}
              </div>
            </nav>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl/page:hidden" role="group" aria-label="Lọc theo tình trạng">
              {STATUS_OPTIONS.map((o) => {
                const active = activeFilter === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setActiveFilter(o.value)}
                    aria-pressed={active}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      active ? "border-primary/30 bg-primary/[0.08] font-semibold text-primary" : "border-border bg-card font-medium hover:bg-muted/60",
                    )}
                  >
                    <span className="whitespace-nowrap">{o.label}</span>
                    <span className="tabular-nums text-muted-foreground">{loading ? "–" : o.count}</span>
                  </button>
                );
              })}
            </div>

            <section aria-label="Danh sách sách" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-4">
                <div className="min-w-0">
                  <h2 className="font-serif text-[18px] font-semibold tracking-tight">{activeFilter === "All" ? "Tất cả đầu sách" : activeStatus.label}</h2>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {activeStatus.hint}{selectedCategory !== "All" ? ` Đang xem danh mục ${selectedCategory}.` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setShowCoverSearchModal(true)}>
                    <Camera className="h-3.5 w-3.5" />Tìm bằng ảnh
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleExport}>
                    <Download className="h-3.5 w-3.5" />Xuất CSV
                  </Button>
                  <IconButton variant="ghost" size="sm-icon" label="Làm mới danh sách" onClick={() => void loadBooks()} disabled={loading}>
                    <RefreshCw className={cn("h-3.5 w-3.5 motion-reduce:animate-none", loading && "animate-spin")} />
                  </IconButton>
                </div>
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={searchQuery}
                  onSearchChange={setSearchQuery}
                  searchPlaceholder="Tìm theo tên sách, mã vạch, tác giả..."
                  showSearchClear
                  filters={
                    <>
                      {/* The rail lists categories on wide screens; here it is a select. */}
                      <div className="@4xl/page:hidden">
                        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                          <SelectTrigger size="sm" className="w-[200px]" aria-label="Danh mục">
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
                      </div>
                      {hasFilters && (
                        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                          <X className="h-3.5 w-3.5" />Xóa lọc
                        </Button>
                      )}
                    </>
                  }
                />
              </div>

              {loading ? (
                <LoadingOverlay />
              ) : filtered.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    variant="no-results"
                    title="Không tìm thấy sách"
                    description="Thử điều chỉnh tìm kiếm hoặc bộ lọc."
                    action={<Button variant="outline" size="sm" onClick={clearFilters}>Xóa tất cả bộ lọc</Button>}
                  />
                </div>
              ) : (
                <>
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {sortHead("title", "Sách", "pl-5 text-[12px] font-normal text-muted-foreground")}
                        <TableHead className="hidden w-[160px] text-[12px] font-normal text-muted-foreground @3xl:table-cell">Danh mục, giá bìa</TableHead>
                        {sortHead("stock", "Tồn kho", "w-[92px] text-right @2xl:w-[132px] text-[12px] font-normal text-muted-foreground", true)}
                        {sortHead("updatedAt", "Cập nhật", "hidden w-[104px] text-[12px] font-normal text-muted-foreground @4xl:table-cell")}
                        <TableHead className="hidden w-[84px] pr-4 @2xl:table-cell"><span className="sr-only">Thao tác</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedBooks.map((book) => (
                        <TableRow key={book.id} className="group hover:bg-muted/30">
                          <TableCell className="whitespace-normal py-3 pl-5 pr-3 align-top">
                            <div className="flex items-start gap-3">
                              <CatalogBookThumbnail category={book.category} title={book.title} imageUrl={book.cover_image_url} />
                              <div className="min-w-0 flex-1">
                                <NavLink
                                  to={`/book/${book.id}`}
                                  className="line-clamp-2 text-[14px] font-semibold text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
                                  title={book.title}
                                >
                                  {book.title}
                                </NavLink>
                                <p className="truncate text-[13px] text-muted-foreground">
                                  {book.author || "-"}
                                  {book.publisher && book.publisher !== "Chưa cập nhật" ? `, ${book.publisher}` : ""}
                                  {book.publish_year ? `, ${book.publish_year}` : ""}
                                </p>
                                {book.barcode && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCopyBarcode(book.barcode!);
                                    }}
                                    className="mt-0.5 inline-flex items-center gap-1.5 rounded font-mono text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                                    aria-label={`Sao chép mã vạch ${book.barcode}`}
                                  >
                                    {book.barcode}
                                    {copiedBarcode === book.barcode ? (
                                      <Check className="h-3 w-3 text-success" />
                                    ) : (
                                      <Copy className="h-3 w-3 opacity-40 group-hover:opacity-70" />
                                    )}
                                  </button>
                                )}
                                {/* Columns the container hides move here, so no field is dropped. */}
                                <p className="mt-1 text-[12px] text-muted-foreground @3xl:hidden">
                                  {book.category}
                                  {book.list_price ? `, ${toDisplayPrice(book.list_price)}` : ""}
                                </p>
                                <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground @4xl:hidden">Cập nhật {toDisplayDate(book.updated_at)}</p>
                                {book.is_incomplete ? (
                                  <p className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-amber-800 dark:text-amber-300">
                                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />Chưa hoàn chỉnh
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden whitespace-normal py-3 align-top @3xl:table-cell">
                            <p className="text-[13px] text-foreground">{book.category}</p>
                            <p className="text-[12px] tabular-nums text-muted-foreground">{book.list_price ? toDisplayPrice(book.list_price) : "Chưa có giá"}</p>
                          </TableCell>
                          <TableCell className="whitespace-normal py-3 text-right align-top">
                            <p className={cn("font-serif text-[18px] font-semibold leading-tight tabular-nums", stockTone(book.quantity))}>
                              {book.quantity}<span className="font-sans text-[12px] font-normal text-muted-foreground"> cuốn</span>
                            </p>
                            {book.available_quantity !== book.quantity ? (
                              <p className="text-[12px] tabular-nums text-muted-foreground">{book.available_quantity} sẵn sàng</p>
                            ) : null}
                            {book.receiving_quantity > 0 ? (
                              <p className="text-[12px] tabular-nums text-muted-foreground">{book.receiving_quantity} ở khu nhận</p>
                            ) : null}
                            <p className="truncate text-[12px] text-muted-foreground" title={book.location || undefined}>
                              {book.location || "-"}{book.location_count > 1 ? ` +${book.location_count - 1}` : ""}
                            </p>
                            <div className="mt-1 @2xl:hidden">{rowActions(book)}</div>
                          </TableCell>
                          <TableCell className="hidden py-3 align-top text-[12px] tabular-nums text-muted-foreground @4xl:table-cell">{toDisplayDate(book.updated_at)}</TableCell>
                          <TableCell className="hidden py-3 pr-4 align-top @2xl:table-cell">
                            {rowActions(book)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-[13px] text-muted-foreground">
                      Hiển thị <span className="font-medium tabular-nums text-foreground">{(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + pagedBooks.length}</span> trong {filtered.length} sách
                    </span>
                    {totalPages > 1 && (
                      <Pagination className="mx-0 w-auto justify-end">
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              onClick={(event) => {
                                event.preventDefault();
                                setPage((current) => Math.max(1, current - 1));
                              }}
                              className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
                            />
                          </PaginationItem>
                          {getPaginationRange(page, totalPages).map((item) => (
                            <PaginationItem key={item}>
                              {typeof item === "number" ? (
                                <PaginationLink
                                  isActive={item === page}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    setPage(item);
                                  }}
                                  className="cursor-pointer"
                                >
                                  {item}
                                </PaginationLink>
                              ) : (
                                <PaginationEllipsis />
                              )}
                            </PaginationItem>
                          ))}
                          <PaginationItem>
                            <PaginationNext
                              onClick={(event) => {
                                event.preventDefault();
                                setPage((current) => Math.min(totalPages, current + 1));
                              }}
                              className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </FadeItem>

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
                  <div className="w-9 h-9 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                    <Plus className="w-4 h-4 text-primary" />
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
                <div className="p-4 rounded-xl bg-primary/[0.05]">
                  <div className="flex items-center gap-2 text-[13px] text-foreground">
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
                  className="w-full"
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

      <CoverSearchModal
        isOpen={showCoverSearchModal}
        onClose={() => setShowCoverSearchModal(false)}
      />

      <ConfirmDialog
        open={!!deleteBook}
        onOpenChange={(open) => { if (!open) setDeleteBook(null); }}
        title="Xóa sách"
        description="Hành động này không thể hoàn tác."
        confirmLabel="Xóa"
        cancelLabel="Hủy"
        variant="destructive"
        onConfirm={handleDeleteBook}
      >
        {deleteBook && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="mb-1 text-[13px] font-medium text-foreground">{deleteBook.title}</p>
              <p className="text-[12px] text-muted-foreground">
                ISBN: {deleteBook.barcode || "N/A"} | Tồn kho: {deleteBook.quantity}
              </p>
            </div>
            <p className="text-[13px] text-muted-foreground">
              Bạn có chắc muốn xóa sách này? Sách sẽ bị xóa vĩnh viễn khỏi danh mục.
            </p>
          </div>
        )}
      </ConfirmDialog>
    </PageWrapper>
  );
}
