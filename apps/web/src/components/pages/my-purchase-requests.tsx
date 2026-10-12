import { useEffect, useId, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router";
import { AlertTriangle, BookOpen, Check, Plus, RefreshCw, ShoppingCart, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/loading-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterBar } from "@/components/ui/filter-bar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { getApiErrorMessage } from "@/services/api";
import { purchaseRequestService, type PurchaseRequest, type PurchaseRequestCreateInput } from "@/services/purchase-requests";
import { warehouseService } from "@/services/warehouse";
import { bookService } from "@/services/book";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { getStatusVariant } from "@/lib/status-registry";

type PageTab = "queue" | "compose";

const PAGE_SIZE = 10;

const REASONS = [
  { value: "LOW_STOCK", label: "Tồn kho thấp" },
  { value: "CUSTOMER_REQUEST", label: "Khách hàng yêu cầu" },
  { value: "DAMAGED", label: "Sách hư hỏng" },
  { value: "LOST", label: "Mất sách" },
  { value: "OTHER", label: "Lý do khác" },
];

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  CONVERTED: "Đã vào đơn PO",
  REJECTED: "Bị từ chối",
  WITHDRAWN: "Đã rút",
};

const STATUS_FILTERS = ["ALL", "PENDING", "APPROVED", "CONVERTED", "REJECTED", "WITHDRAWN"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const OPEN_STATUSES = new Set(["PENDING", "APPROVED"]);

function statusLabel(status: string) {
  return STATUS_LABEL[String(status || "").toUpperCase()] ?? status;
}

function statusVariant(status: string) {
  return getStatusVariant("purchaseRequest", status);
}

function reasonLabel(reason: string) {
  return REASONS.find((r) => r.value === reason)?.label || reason;
}

function bookTitleOf(req: PurchaseRequest) {
  return req.book_variants?.books?.title || req.book_title_hint || "";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(value: string | null | undefined) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

// Subset of the /api/books summary the picker needs.
interface CatalogBook {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  variant_id: string | null;
  quantity?: number;
  locations?: Array<{ warehouse_id: string; quantity: number }>;
}

function stockAt(book: CatalogBook, warehouseId: string) {
  return (book.locations || []).filter((l) => l.warehouse_id === warehouseId).reduce((sum, l) => sum + Number(l.quantity || 0), 0);
}

interface Warehouse { id: string; code: string; name: string }

interface FormState {
  warehouse_id: string;
  book: CatalogBook | null;
  book_title_hint: string;
  quantity_requested: number;
  reason: string;
  note: string;
}

const emptyForm: FormState = {
  warehouse_id: "",
  book: null,
  book_title_hint: "",
  quantity_requested: 1,
  reason: "",
  note: "",
};

function ResponseLine({ req, canOpenPurchaseOrder }: { req: PurchaseRequest; canOpenPurchaseOrder: boolean }) {
  const s = String(req.status || "").toUpperCase();
  if (s === "REJECTED") {
    return (
      <p className="rounded-md bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
        <span className="font-medium">Lý do từ chối:</span> {req.rejection_reason || "Quản lý không ghi lý do."}
      </p>
    );
  }
  if (s === "CONVERTED") {
    const po = req.purchase_orders;
    if (po && canOpenPurchaseOrder) {
      return (
        <p className="text-[12px] text-emerald-700 dark:text-emerald-400">
          Đã được đặt trong đơn{" "}
          <NavLink to={`/purchase-orders/${po.id}`} className="rounded font-mono font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{po.po_number}</NavLink>
        </p>
      );
    }
    return <p className="text-[12px] text-emerald-700 dark:text-emerald-400">Đã được đặt trong đơn {po ? <span className="font-mono font-semibold">{po.po_number}</span> : "đặt hàng"}</p>;
  }
  if (s === "APPROVED") return <p className="text-[12px] text-sky-700 dark:text-sky-400">Quản lý đã duyệt, đang chờ tạo đơn đặt hàng{req.approved_at ? ` · ${timeAgo(req.approved_at)}` : ""}</p>;
  if (s === "PENDING") return <p className="text-[12px] text-muted-foreground">Đang chờ quản lý duyệt · gửi {timeAgo(req.created_at)}</p>;
  if (s === "WITHDRAWN") return <p className="text-[12px] text-muted-foreground">Bạn đã rút yêu cầu này</p>;
  return null;
}

export function MyPurchaseRequestsPage() {
  const currentUser = authService.getCurrentUser();
  const canOpenPurchaseOrder = canAccess(currentUser, ROUTE_ACCESS.purchaseRead);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [activeTab, setActiveTab] = useState<PageTab>("queue");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [withdrawTarget, setWithdrawTarget] = useState<PurchaseRequest | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  // Book picker
  const [suggestions, setSuggestions] = useState<CatalogBook[]>([]);
  const [searchingBooks, setSearchingBooks] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ids = useId();
  const fieldId = (name: string) => `${ids}-${name}`;

  const load = async () => {
    setLoading(true);
    try {
      const [res, wRes] = await Promise.all([
        purchaseRequestService.getMyRequests(),
        warehouseService.getReceivingWarehouses(),
      ]);
      setRequests(Array.isArray(res.data) ? res.data : []);
      setWarehouses(Array.isArray(wRes) ? wRes : []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được yêu cầu mua hàng"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Catalog lookup for the book field: debounced, only while nothing is picked yet.
  const titleQuery = form.book ? "" : form.book_title_hint.trim();
  useEffect(() => {
    if (titleQuery.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchingBooks(true);
      try {
        const rows = await bookService.getAll({ search: titleQuery });
        if (!cancelled) {
          setSuggestions((Array.isArray(rows) ? (rows as CatalogBook[]) : []).filter((b) => b.variant_id).slice(0, 6));
          setHighlight(0);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setSearchingBooks(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [titleQuery]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: requests.length };
    for (const req of requests) {
      const key = String(req.status || "").toUpperCase();
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const base = statusFilter === "ALL" ? requests : requests.filter((req) => String(req.status).toUpperCase() === statusFilter);
    const query = search.trim().toLowerCase();
    if (!query) return base;
    return base.filter((req) => {
      const haystack = [req.request_number, bookTitleOf(req), reasonLabel(req.reason), statusLabel(req.status), req.purchase_orders?.po_number]
        .filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [requests, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const pagedRequests = filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, statusFilter]);
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);

  // An open request for the same book and warehouse is probably a duplicate.
  const duplicate = useMemo(() => {
    const title = (form.book?.title || form.book_title_hint).trim().toLowerCase();
    if (!title && !form.book) return null;
    return requests.find((req) => {
      if (!OPEN_STATUSES.has(String(req.status).toUpperCase())) return false;
      if (form.warehouse_id && req.warehouse_id !== form.warehouse_id) return false;
      if (form.book?.variant_id && req.book_variant_id) return req.book_variant_id === form.book.variant_id;
      return bookTitleOf(req).trim().toLowerCase() === title;
    }) ?? null;
  }, [requests, form.book, form.book_title_hint, form.warehouse_id]);

  const selectedWarehouse = warehouses.find((w) => w.id === form.warehouse_id);

  const pickBook = (book: CatalogBook) => {
    setForm((f) => ({ ...f, book, book_title_hint: book.title }));
    setPickerOpen(false);
  };

  const clearBook = () => {
    setForm((f) => ({ ...f, book: null, book_title_hint: "" }));
    setSuggestions([]);
  };

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!pickerOpen || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pickBook(suggestions[highlight]);
    } else if (event.key === "Escape") {
      setPickerOpen(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.warehouse_id) { toast.error("Chọn kho cần bổ sung hàng"); return; }
    if (!form.book && !form.book_title_hint.trim()) { toast.error("Nhập tên sách hoặc chọn sách trong danh mục"); return; }
    if (!form.quantity_requested || form.quantity_requested < 1) { toast.error("Số lượng phải lớn hơn 0"); return; }
    if (!form.reason) { toast.error("Chọn lý do cần bổ sung"); return; }

    setSubmitting(true);
    try {
      const payload: PurchaseRequestCreateInput = {
        warehouse_id: form.warehouse_id,
        quantity_requested: Number(form.quantity_requested),
        reason: form.reason,
        note: form.note.trim() || undefined,
        book_title_hint: (form.book?.title || form.book_title_hint).trim() || undefined,
        book_variant_id: form.book?.variant_id || undefined,
      };
      await purchaseRequestService.createRequest(payload);
      toast.success("Đã gửi yêu cầu mua hàng");
      setForm(emptyForm);
      await load();
      setStatusFilter("ALL");
      setActiveTab("queue");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Gửi yêu cầu thất bại"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      await purchaseRequestService.withdraw(withdrawTarget.id);
      toast.success(`Đã rút yêu cầu ${withdrawTarget.request_number}`);
      setWithdrawTarget(null);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không rút được yêu cầu"));
    } finally {
      setWithdrawing(false);
    }
  };

  const showSuggestions = pickerOpen && !form.book && titleQuery.length >= 2;

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={ShoppingCart}
          title="Yêu cầu mua hàng của tôi"
          description="Báo cho quản lý những sách kho cần bổ sung và theo dõi kết quả"
          iconBg="bg-orange-100 dark:bg-orange-500/15"
          iconColor="text-orange-700 dark:text-orange-400"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
              <Button type="button" size="sm" onClick={() => setActiveTab("compose")}>
                <Plus className="h-3.5 w-3.5" />
                Tạo yêu cầu
              </Button>
            </>
          )}
        />
      </FadeItem>

      <FadeItem>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PageTab)}>
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="queue">Yêu cầu của tôi</TabsTrigger>
            <TabsTrigger value="compose">Tạo yêu cầu mới</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="mt-4">
            <SectionCard noPadding>
              <div className="flex gap-1 overflow-x-auto border-b border-border p-2" role="group" aria-label="Lọc theo trạng thái">
                {STATUS_FILTERS.filter((key) => key === "ALL" || key === "PENDING" || (counts[key] ?? 0) > 0).map((key) => {
                  const active = statusFilter === key;
                  const count = counts[key] ?? 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setStatusFilter(key)}
                      className={cn(
                        "flex shrink-0 flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300"
                          : "border-transparent hover:border-border hover:bg-muted/50",
                      )}
                    >
                      <span className={cn("text-[17px] font-semibold leading-tight tabular-nums", !active && !count && "text-muted-foreground/60")}>{loading ? "–" : count}</span>
                      <span className={cn("whitespace-nowrap text-[11px]", active ? "font-medium" : "text-muted-foreground")}>
                        {key === "ALL" ? "Tất cả" : statusLabel(key)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="border-b border-border px-4 py-3">
                <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Tìm mã yêu cầu, tên sách, mã PO..." showSearchClear />
              </div>

              {loading ? (
                <div>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-2 border-b border-border px-5 py-4 last:border-b-0">
                      <Skeleton className="h-4 w-64" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  ))}
                </div>
              ) : pagedRequests.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    icon={ShoppingCart}
                    title={requests.length === 0 ? "Bạn chưa gửi yêu cầu nào" : "Không có yêu cầu phù hợp"}
                    description={requests.length === 0 ? "Khi kho thiếu sách, gửi yêu cầu để quản lý đặt hàng bổ sung." : "Thử đổi trạng thái hoặc từ khóa tìm kiếm."}
                    action={requests.length === 0 ? (
                      <Button type="button" size="sm" onClick={() => setActiveTab("compose")}>
                        <Plus className="h-3.5 w-3.5" />
                        Tạo yêu cầu
                      </Button>
                    ) : undefined}
                    className="py-0"
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {pagedRequests.map((req) => {
                    const title = bookTitleOf(req);
                    const isPending = String(req.status).toUpperCase() === "PENDING";
                    return (
                      <li key={req.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className={cn("text-[14px] font-medium", title ? "text-foreground" : "italic text-muted-foreground")}>{title || "Chưa ghi tên sách"}</p>
                            {!req.book_variant_id && title ? (
                              <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground" title="Sách được nhập tay, chưa gắn với danh mục">nhập tay</span>
                            ) : null}
                          </div>
                          <p className="text-[12px] text-muted-foreground">
                            <span className="font-semibold text-foreground tabular-nums">{req.quantity_requested} cuốn</span>
                            {" · "}{req.warehouses?.code || "-"}{" · "}{reasonLabel(req.reason)}
                            {" · "}<span className="font-mono" title={formatDate(req.created_at)}>{req.request_number}</span>
                          </p>
                          {req.note ? <p className="line-clamp-2 text-[12px] text-muted-foreground" title={req.note}>Ghi chú: {req.note}</p> : null}
                          <ResponseLine req={req} canOpenPurchaseOrder={canOpenPurchaseOrder} />
                        </div>
                        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                          <StatusBadge label={statusLabel(req.status)} variant={statusVariant(req.status)} dot />
                          {isPending ? (
                            <Button type="button" variant="ghost" size="sm" onClick={() => setWithdrawTarget(req)} className="h-7 px-2 text-[12px] text-muted-foreground">
                              <Undo2 className="h-3.5 w-3.5" />Rút yêu cầu
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!loading && filteredRequests.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[12px] text-muted-foreground">
                    Hiển thị {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredRequests.length)} trong {filteredRequests.length} yêu cầu
                  </p>
                  {totalPages > 1 && (
                    <Pagination className="mx-0 w-auto justify-end">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={(event) => { event.preventDefault(); setPage((current) => Math.max(1, current - 1)); }}
                            className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                        {getPaginationRange(page, totalPages).map((item, i) => (
                          <PaginationItem key={`${item}-${i}`}>
                            {typeof item === "number" ? (
                              <PaginationLink isActive={item === page} onClick={(event) => { event.preventDefault(); setPage(item); }} className="cursor-pointer">
                                {item}
                              </PaginationLink>
                            ) : (
                              <PaginationEllipsis />
                            )}
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext
                            onClick={(event) => { event.preventDefault(); setPage((current) => Math.min(totalPages, current + 1)); }}
                            className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  )}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="compose" className="mt-4">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <SectionCard title="Tạo yêu cầu mua hàng" subtitle="Mỗi yêu cầu dành cho một đầu sách.">
                <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5" noValidate>
                  <div>
                    <label htmlFor={fieldId("book")} className="mb-1 block text-[12px] font-medium">Sách cần bổ sung *</label>
                    {form.book ? (
                      <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-foreground">{form.book.title}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {[form.book.author, form.book.isbn && form.book.isbn !== "-" ? `ISBN ${form.book.isbn}` : null].filter(Boolean).join(" · ")}
                            </p>
                            {selectedWarehouse ? (
                              <p className="mt-0.5 text-[11px] text-foreground">
                                Tồn hiện tại ở {selectedWarehouse.code}: <span className="font-semibold tabular-nums">{stockAt(form.book, selectedWarehouse.id)} cuốn</span>
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={clearBook} className="h-7 shrink-0 px-2 text-[12px]">
                          <X className="h-3.5 w-3.5" />Đổi sách
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <div className="relative">
                          <Input
                            id={fieldId("book")}
                            type="text"
                            role="combobox"
                            aria-expanded={showSuggestions}
                            aria-controls={fieldId("book-list")}
                            aria-autocomplete="list"
                            autoComplete="off"
                            placeholder="Gõ tên sách hoặc ISBN để tìm trong danh mục"
                            value={form.book_title_hint}
                            onChange={(e) => { setForm((f) => ({ ...f, book_title_hint: e.target.value })); setPickerOpen(true); }}
                            onFocus={() => setPickerOpen(true)}
                            onBlur={() => { blurTimer.current = setTimeout(() => setPickerOpen(false), 150); }}
                            onKeyDown={handleTitleKeyDown}
                            data-testid="new-pr-book-title"
                          />
                          {showSuggestions ? (
                            <ul
                              id={fieldId("book-list")}
                              role="listbox"
                              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
                              onMouseDown={() => { if (blurTimer.current) clearTimeout(blurTimer.current); }}
                            >
                              {searchingBooks && suggestions.length === 0 ? (
                                <li className="px-3 py-2 text-[12px] text-muted-foreground">Đang tìm…</li>
                              ) : suggestions.length === 0 ? (
                                <li className="px-3 py-2 text-[12px] text-muted-foreground">Không thấy trong danh mục. Cứ gửi với tên bạn đã nhập, quản lý sẽ tìm giúp.</li>
                              ) : suggestions.map((book, i) => (
                                <li
                                  key={book.id}
                                  role="option"
                                  aria-selected={i === highlight}
                                  onMouseEnter={() => setHighlight(i)}
                                  onClick={() => pickBook(book)}
                                  className={cn("flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2", i === highlight && "bg-muted")}
                                >
                                  <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[13px] text-foreground">{book.title}</p>
                                    <p className="truncate text-[11px] text-muted-foreground">
                                      {[book.author, book.isbn && book.isbn !== "-" ? book.isbn : null].filter(Boolean).join(" · ")}
                                    </p>
                                  </div>
                                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                    {selectedWarehouse ? `${selectedWarehouse.code}: ${stockAt(book, selectedWarehouse.id)}` : `Tồn ${book.quantity ?? 0}`}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">Chọn sách trong danh sách gợi ý để quản lý đặt đúng bản. Sách chưa có trong danh mục thì cứ nhập tên.</p>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={fieldId("warehouse")} className="mb-1 block text-[12px] font-medium">Kho cần bổ sung *</label>
                      <Select value={form.warehouse_id} onValueChange={(v) => setForm((f) => ({ ...f, warehouse_id: v }))}>
                        <SelectTrigger id={fieldId("warehouse")} className="w-full" data-testid="new-pr-warehouse-select">
                          <SelectValue placeholder="Chọn kho" />
                        </SelectTrigger>
                        <SelectContent>
                          {warehouses.map((w) => (
                            <SelectItem key={w.id} value={w.id}>{w.code} - {w.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label htmlFor={fieldId("quantity")} className="mb-1 block text-[12px] font-medium">Số lượng cần đặt *</label>
                      <Input
                        id={fieldId("quantity")}
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={form.quantity_requested}
                        onChange={(e) => setForm((f) => ({ ...f, quantity_requested: Number(e.target.value) }))}
                        required
                        data-testid="new-pr-quantity"
                      />
                    </div>
                  </div>

                  <div>
                    <p id={fieldId("reason")} className="mb-1.5 block text-[12px] font-medium">Lý do cần bổ sung *</p>
                    <div role="radiogroup" aria-labelledby={fieldId("reason")} className="flex flex-wrap gap-1.5">
                      {REASONS.map((r) => {
                        const checked = form.reason === r.value;
                        return (
                          <button
                            key={r.value}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            onClick={() => setForm((f) => ({ ...f, reason: r.value }))}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              checked
                                ? "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300"
                                : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                            )}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label htmlFor={fieldId("note")} className="mb-1 block text-[12px] font-medium">Ghi chú cho quản lý</label>
                    <Textarea
                      id={fieldId("note")}
                      rows={3}
                      placeholder="Ví dụ: khách đặt trước 3 cuốn, cần trước ngày 20"
                      value={form.note}
                      onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    />
                  </div>

                  {duplicate ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300" role="status">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <p>
                        Bạn đã có yêu cầu <span className="font-mono font-semibold">{duplicate.request_number}</span> cho sách này
                        ({duplicate.quantity_requested} cuốn, {statusLabel(duplicate.status).toLowerCase()}). Nếu gửi tiếp, quản lý sẽ nhận thêm một yêu cầu riêng cho cùng cuốn sách.
                      </p>
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2 border-t border-border pt-4">
                    <Button type="button" variant="outline" size="sm" onClick={() => setForm(emptyForm)}>
                      Xóa form
                    </Button>
                    <Button type="submit" size="sm" disabled={submitting} loading={submitting} data-testid="new-pr-submit">
                      Gửi yêu cầu
                    </Button>
                  </div>
                </form>
              </SectionCard>

              <SectionCard title="Sau khi bạn gửi">
                <ol className="space-y-3 text-[12px]">
                  {[
                    { title: "Quản lý xem xét", body: "Yêu cầu hiện ở mục Chờ duyệt. Bạn vẫn rút lại được trong lúc này." },
                    { title: "Duyệt hoặc từ chối", body: "Nếu bị từ chối, lý do sẽ hiện ngay dưới yêu cầu." },
                    { title: "Đặt hàng nhà cung cấp", body: "Yêu cầu được duyệt sẽ được đưa vào một đơn đặt hàng (PO). Mã PO hiện trong danh sách của bạn." },
                  ].map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[11px] font-semibold text-orange-700 dark:bg-orange-500/15 dark:text-orange-400">{i + 1}</span>
                      <div>
                        <p className="font-medium text-foreground">{step.title}</p>
                        <p className="mt-0.5 text-muted-foreground">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </SectionCard>
            </div>
          </TabsContent>
        </Tabs>
      </FadeItem>

      <ConfirmDialog
        open={!!withdrawTarget}
        onOpenChange={(open) => { if (!open && !withdrawing) setWithdrawTarget(null); }}
        title="Rút yêu cầu mua hàng?"
        description={withdrawTarget ? `Rút ${withdrawTarget.request_number}${bookTitleOf(withdrawTarget) ? ` (${bookTitleOf(withdrawTarget)})` : ""}. Quản lý sẽ không còn thấy yêu cầu này để duyệt.` : undefined}
        confirmLabel="Rút yêu cầu"
        variant="destructive"
        loading={withdrawing}
        onConfirm={handleWithdraw}
      />
    </PageWrapper>
  );
}
