import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { NavLink } from "react-router";
import { AlertTriangle, BookOpen, Check, Loader2, Plus, RefreshCw, Search, ShoppingCart, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BlockError } from "@/components/pages/dashboard/panel";
import { ChoiceChips, Field, FormSheet, ListFooter, QueueTabs, RefCode, RowsSkeleton } from "@/components/ops/ops-kit";
import { fieldAria, formatDateTime, formatShortDate, timeAgo, darkFieldClass } from "@/components/ops/ops-utils";
import { cn } from "@/components/ui/utils";
import { getApiErrorMessage } from "@/services/api";
import { purchaseRequestService, type PurchaseRequest, type PurchaseRequestCreateInput } from "@/services/purchase-requests";
import { warehouseService } from "@/services/warehouse";
import { bookService } from "@/services/book";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { getStatusVariant } from "@/lib/status-registry";

const PAGE_SIZE = 10;
const PANEL_ID = "purchase-request-list";

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

function reasonLabel(reason: string) {
  return REASONS.find((r) => r.value === reason)?.label || reason;
}

function bookTitleOf(req: PurchaseRequest) {
  return req.book_variants?.books?.title || req.book_title_hint || "";
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

function bookMeta(book: CatalogBook) {
  return [book.author, book.isbn && book.isbn !== "-" ? `ISBN ${book.isbn}` : null].filter(Boolean).join(" · ");
}

interface Warehouse { id: string; code: string; name: string }

interface FormState {
  warehouse_id: string;
  book: CatalogBook | null;
  book_title_hint: string;
  /** Kept as typed so an emptied field stays empty instead of turning into 0. */
  quantity_requested: string;
  reason: string;
  note: string;
}

type FormErrors = Partial<Record<"book" | "warehouse" | "quantity" | "reason", string>>;

const emptyForm: FormState = {
  warehouse_id: "",
  book: null,
  book_title_hint: "",
  quantity_requested: "1",
  reason: "",
  note: "",
};

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.book && !form.book_title_hint.trim()) errors.book = "Nhập tên sách hoặc chọn sách trong danh mục.";
  if (!form.warehouse_id) errors.warehouse = "Chọn kho cần bổ sung hàng.";
  const quantity = Number(form.quantity_requested);
  if (!form.quantity_requested.trim()) errors.quantity = "Nhập số lượng cần đặt.";
  else if (!Number.isInteger(quantity) || quantity < 1) errors.quantity = "Số lượng phải là số nguyên từ 1 trở lên.";
  if (!form.reason) errors.reason = "Chọn lý do cần bổ sung.";
  return errors;
}

/**
 * Where the request is on its way to a purchase order. Only the branches the API has:
 * sent → approved → in a PO, or sent → rejected / withdrawn.
 */
function RequestTrail({ req, canOpenPurchaseOrder }: { req: PurchaseRequest; canOpenPurchaseOrder: boolean }) {
  const s = String(req.status || "").toUpperCase();
  type Step = { label: ReactNode; key: string; state: "done" | "current" | "todo" | "stopped"; when?: string | null };
  const po = req.purchase_orders;
  const poLabel = po && canOpenPurchaseOrder ? (
    <>Vào đơn <NavLink to={`/purchase-orders/${po.id}`} className="rounded font-mono font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{po.po_number}</NavLink></>
  ) : po ? <>Vào đơn <span className="font-mono font-semibold">{po.po_number}</span></> : "Đã vào đơn PO";
  const sent: Step = { key: "sent", label: "Đã gửi", state: "done", when: formatShortDate(req.created_at) };
  const steps: Step[] =
    s === "REJECTED" ? [sent, { key: "rejected", label: "Bị từ chối", state: "stopped", when: formatShortDate(req.rejected_at) }]
      : s === "WITHDRAWN" ? [sent, { key: "withdrawn", label: "Bạn đã rút", state: "stopped" }]
        : s === "CONVERTED" ? [sent, { key: "approved", label: "Đã duyệt", state: "done", when: formatShortDate(req.approved_at) }, { key: "po", label: poLabel, state: "done" }]
          : s === "APPROVED" ? [sent, { key: "approved", label: "Đã duyệt", state: "done", when: formatShortDate(req.approved_at) }, { key: "po", label: "Chờ tạo đơn PO", state: "current" }]
            : [sent, { key: "review", label: "Chờ quản lý duyệt", state: "current" }, { key: "po", label: "Vào đơn PO", state: "todo" }];

  return (
    <ol aria-label="Tiến trình yêu cầu" className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden="true" className="h-px w-3 bg-border" /> : null}
          <span
            aria-hidden="true"
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              step.state === "done" && "bg-emerald-500",
              step.state === "current" && "bg-amber-500 ring-2 ring-amber-500/20",
              step.state === "todo" && "border border-muted-foreground/40",
              step.state === "stopped" && (s === "REJECTED" ? "bg-red-500" : "bg-muted-foreground/50"),
            )}
          />
          <span className={cn(step.state === "todo" ? "text-muted-foreground" : "text-foreground", step.state === "current" && "font-medium")}>
            {step.label}
            {step.when ? <span className="tabular-nums text-muted-foreground"> {step.when}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RejectionReason({ req }: { req: PurchaseRequest }) {
  if (String(req.status || "").toUpperCase() !== "REJECTED") return null;
  return (
    <p className="mt-2 max-w-prose rounded-md bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-800 dark:bg-red-500/10 dark:text-red-300">
      <span className="font-semibold">Lý do từ chối:</span> {req.rejection_reason || "Quản lý không ghi lý do."}
    </p>
  );
}

export function MyPurchaseRequestsPage() {
  const currentUser = authService.getCurrentUser();
  const canOpenPurchaseOrder = canAccess(currentUser, ROUTE_ACCESS.purchaseRead);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [composeOpen, setComposeOpen] = useState(false);

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

  const load = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") setLoading(true); else setRefreshing(true);
    try {
      const [res, wRes] = await Promise.all([
        purchaseRequestService.getMyRequests(),
        warehouseService.getReceivingWarehouses(),
      ]);
      setRequests(Array.isArray(res.data) ? res.data : []);
      setWarehouses(Array.isArray(wRes) ? wRes : []);
      setLoadError(null);
    } catch (err) {
      const message = getApiErrorMessage(err, "Không tải được yêu cầu mua hàng");
      setLoadError(message);
      if (mode === "refresh") toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load("initial"); }, [load]);

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
      const haystack = [req.request_number, bookTitleOf(req), reasonLabel(req.reason), statusLabel(req.status), req.purchase_orders?.po_number, req.warehouses?.code]
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

  const updateForm = (patch: Partial<FormState>, clears?: keyof FormErrors) => {
    setForm((f) => ({ ...f, ...patch }));
    if (clears) setErrors((e) => ({ ...e, [clears]: undefined }));
  };

  const pickBook = (book: CatalogBook) => {
    updateForm({ book, book_title_hint: book.title }, "book");
    setPickerOpen(false);
  };

  const clearBook = () => {
    updateForm({ book: null, book_title_hint: "" });
    setSuggestions([]);
    requestAnimationFrame(() => document.getElementById(fieldId("book"))?.focus());
  };

  const showSuggestions = pickerOpen && !form.book && titleQuery.length >= 2;

  // A blur schedules the list to close; focus or typing that comes back first must cancel it.
  const cancelBlurClose = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false);
      return;
    }
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pickBook(suggestions[highlight]);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const found = validate(form);
    setErrors(found);
    const firstInvalid = (["book", "warehouse", "quantity", "reason"] as const).find((key) => found[key]);
    if (firstInvalid) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }

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
      toast.success("Đã gửi yêu cầu mua hàng", { description: "Yêu cầu nằm ở mục Chờ duyệt cho đến khi quản lý xử lý." });
      setForm(emptyForm);
      setErrors({});
      setComposeOpen(false);
      setStatusFilter("ALL");
      await load();
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

  const statusTabs = STATUS_FILTERS
    .filter((key) => key === "ALL" || key === "PENDING" || (counts[key] ?? 0) > 0)
    .map((key) => ({ key, label: key === "ALL" ? "Tất cả" : statusLabel(key), count: counts[key] ?? 0 }));

  const activeOptionId = showSuggestions && suggestions[highlight] ? fieldId(`book-opt-${highlight}`) : undefined;
  const quantityNumber = Number(form.quantity_requested);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={ShoppingCart}
          title="Yêu cầu mua hàng của tôi"
          description="Báo cho quản lý những sách kho cần bổ sung và theo dõi kết quả duyệt"
          iconBg="bg-orange-100 dark:bg-orange-500/15"
          iconColor="text-orange-700 dark:text-orange-400"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading || refreshing}>
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} />
                Làm mới
              </Button>
              <Button type="button" size="sm" onClick={() => setComposeOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Tạo yêu cầu
              </Button>
            </>
          )}
        />
      </FadeItem>

      <FadeItem>
        <section aria-label="Yêu cầu của tôi" className="min-w-0 rounded-xl border border-border bg-card">
          <QueueTabs label="Lọc theo trạng thái" tabs={statusTabs} value={statusFilter} onChange={setStatusFilter} panelId={PANEL_ID} loading={loading} />

          <div className="border-b border-border px-4 py-3 sm:px-5">
            <div className="relative min-w-0 sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm mã yêu cầu, tên sách, mã PO…"
                aria-label="Tìm yêu cầu"
                className="h-10 w-full rounded-md border border-input bg-input-background pl-9 pr-3 text-[14px] outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-border dark:bg-muted/40 sm:h-9 sm:text-[13px]"
              />
            </div>
          </div>

          <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-tab-${statusFilter}`} aria-busy={loading || refreshing}>
            {loading ? (
              <RowsSkeleton rows={5} />
            ) : loadError && requests.length === 0 ? (
              <div className="p-4 sm:p-5"><BlockError what="yêu cầu mua hàng của bạn" onRetry={() => void load("initial")} /></div>
            ) : pagedRequests.length === 0 ? (
              <div className="px-5 py-8">
                <EmptyState
                  icon={requests.length === 0 ? ShoppingCart : Search}
                  title={requests.length === 0 ? "Bạn chưa gửi yêu cầu nào" : "Không có yêu cầu phù hợp"}
                  description={requests.length === 0 ? "Khi kho thiếu sách, gửi yêu cầu để quản lý đặt hàng bổ sung." : "Thử trạng thái khác hoặc từ khóa khác."}
                  action={requests.length === 0 ? (
                    <Button type="button" size="sm" onClick={() => setComposeOpen(true)}>
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
                    <li key={req.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-6 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className={cn("text-[14px] font-semibold", title ? "text-foreground" : "italic text-muted-foreground")}>{title || "Chưa ghi tên sách"}</p>
                          {!req.book_variant_id && title ? (
                            <span className="rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground" title="Sách được nhập tên, chưa gắn với danh mục">Nhập tay</span>
                          ) : null}
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted-foreground">
                          <span className="font-semibold tabular-nums text-foreground">{req.quantity_requested} cuốn</span>
                          <span aria-hidden="true">·</span>
                          <span title={req.warehouses?.name}>{req.warehouses?.code || "Chưa rõ kho"}</span>
                          <span aria-hidden="true">·</span>
                          <span>{reasonLabel(req.reason)}</span>
                          <span aria-hidden="true">·</span>
                          <RefCode value={req.request_number} />
                        </p>
                        {req.note ? <p className="mt-1 line-clamp-2 max-w-prose text-[12px] text-muted-foreground" title={req.note}>Ghi chú: {req.note}</p> : null}
                        <RequestTrail req={req} canOpenPurchaseOrder={canOpenPurchaseOrder} />
                        <RejectionReason req={req} />
                      </div>
                      <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
                        <StatusBadge label={statusLabel(req.status)} variant={getStatusVariant("purchaseRequest", req.status)} dot />
                        <span className="text-[12px] tabular-nums text-muted-foreground" title={formatDateTime(req.created_at) ?? undefined}>Gửi {timeAgo(req.created_at)}</span>
                        {isPending ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setWithdrawTarget(req)} className="h-9 px-2 text-[12px] text-muted-foreground hover:text-foreground sm:h-7" aria-label={`Rút yêu cầu ${req.request_number}`}>
                            <Undo2 className="h-3.5 w-3.5" />Rút yêu cầu
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {!loading ? <ListFooter page={page} pageSize={PAGE_SIZE} total={filteredRequests.length} noun="yêu cầu" onPageChange={setPage} /> : null}
        </section>
      </FadeItem>

      <FormSheet
        open={composeOpen}
        onOpenChange={setComposeOpen}
        title="Tạo yêu cầu mua hàng"
        description="Mỗi yêu cầu cho một đầu sách. Nội dung đang nhập được giữ lại nếu bạn đóng bảng này."
        onSubmit={(e) => void handleSubmit(e)}
        onEscapeKeyDown={(event) => { if (showSuggestions) event.preventDefault(); }}
        footer={(
          <>
            <Button type="button" variant="ghost" className="mr-auto px-2 sm:px-3" onClick={() => { setForm(emptyForm); setErrors({}); }}>
              Xóa nội dung
            </Button>
            <Button type="button" variant="outline" onClick={() => setComposeOpen(false)}>Đóng</Button>
            <Button type="submit" loading={submitting} data-testid="new-pr-submit">
              {submitting ? "Đang gửi…" : "Gửi yêu cầu"}
            </Button>
          </>
        )}
      >
        <Field
          id={fieldId("book")}
          label="Sách cần bổ sung"
          required
          error={form.book ? null : errors.book}
          hint={form.book ? null : titleQuery.length >= 2 ? `Chưa chọn từ danh mục: nếu gửi, quản lý nhận tên “${titleQuery}” dưới dạng nhập tay.` : "Gõ tên sách hoặc ISBN để tìm trong danh mục. Sách chưa có trong danh mục thì nhập tên."}
        >
          {form.book ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-foreground">{form.book.title}</p>
                  {bookMeta(form.book) ? <p className="text-[12px] text-muted-foreground">{bookMeta(form.book)}</p> : null}
                  <p className="text-[12px] text-muted-foreground">Trong danh mục</p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={clearBook} className="h-8 shrink-0 px-2 text-[12px]">
                <X className="h-3.5 w-3.5" />Đổi sách
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input
                {...fieldAria(fieldId("book"), errors.book, true)}
                type="text"
                role="combobox"
                aria-expanded={showSuggestions}
                aria-controls={fieldId("book-list")}
                aria-autocomplete="list"
                aria-activedescendant={activeOptionId}
                autoComplete="off"
                placeholder="Ví dụ: Nhà Giả Kim hoặc 978604…"
                value={form.book_title_hint}
                onChange={(e) => { cancelBlurClose(); updateForm({ book_title_hint: e.target.value }, "book"); setPickerOpen(true); }}
                onFocus={() => { cancelBlurClose(); setPickerOpen(true); }}
                onBlur={() => { blurTimer.current = setTimeout(() => setPickerOpen(false), 150); }}
                onKeyDown={handleTitleKeyDown}
                className={cn("h-10 pr-16", darkFieldClass)}
                data-testid="new-pr-book-title"
              />
              <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {searchingBooks ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Đang tìm sách" /> : null}
                {form.book_title_hint ? (
                  <button type="button" onClick={clearBook} aria-label="Xóa tên sách" className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </span>
              {showSuggestions ? (
                <ul
                  id={fieldId("book-list")}
                  role="listbox"
                  aria-label="Sách trong danh mục"
                  className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
                  onMouseDown={cancelBlurClose}
                >
                  {searchingBooks && suggestions.length === 0 ? (
                    <li className="px-3 py-2 text-[13px] text-muted-foreground">Đang tìm trong danh mục…</li>
                  ) : suggestions.length === 0 ? (
                    <li className="px-3 py-2 text-[13px] text-muted-foreground">Không thấy “{titleQuery}” trong danh mục. Bạn vẫn gửi được với tên đã nhập.</li>
                  ) : suggestions.map((book, i) => (
                    <li
                      key={book.id}
                      id={fieldId(`book-opt-${i}`)}
                      role="option"
                      aria-selected={i === highlight}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pickBook(book)}
                      className={cn("flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2", i === highlight && "bg-muted")}
                    >
                      <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-foreground">{book.title}</p>
                        {bookMeta(book) ? <p className="truncate text-[12px] text-muted-foreground">{bookMeta(book)}</p> : null}
                      </div>
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                        {selectedWarehouse ? `${selectedWarehouse.code}: ${stockAt(book, selectedWarehouse.id)}` : `Tồn ${book.quantity ?? 0}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </Field>

        <Field id={fieldId("warehouse")} label="Kho cần bổ sung" required error={errors.warehouse}>
          <Select value={form.warehouse_id} onValueChange={(v) => updateForm({ warehouse_id: v }, "warehouse")}>
            <SelectTrigger {...fieldAria(fieldId("warehouse"), errors.warehouse)} className={cn("h-10 w-full", darkFieldClass)} data-testid="new-pr-warehouse-select">
              <SelectValue placeholder="Chọn kho" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.code} - {w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.book && selectedWarehouse ? (
            <p className="mt-2 flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-[13px]">
              <span className="text-muted-foreground">Tồn hiện tại ở {selectedWarehouse.code}</span>
              <span className="font-semibold tabular-nums text-foreground">{stockAt(form.book, selectedWarehouse.id)} cuốn</span>
            </p>
          ) : null}
        </Field>

        <Field id={fieldId("quantity")} label="Số lượng cần đặt" required error={errors.quantity} hint="Đơn vị: cuốn.">
          <Input
            {...fieldAria(fieldId("quantity"), errors.quantity, true)}
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={form.quantity_requested}
            onChange={(e) => updateForm({ quantity_requested: e.target.value }, "quantity")}
            className={cn("h-10 sm:w-40", darkFieldClass)}
            data-testid="new-pr-quantity"
          />
        </Field>

        <div>
          <p id={fieldId("reason-label")} className="mb-1.5 text-[13px] font-medium text-foreground">
            Lý do cần bổ sung<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
          </p>
          <div id={fieldId("reason")} tabIndex={-1} className="outline-none">
            <ChoiceChips
              labelledBy={fieldId("reason-label")}
              options={REASONS}
              value={form.reason}
              onChange={(value) => updateForm({ reason: value }, "reason")}
              invalid={Boolean(errors.reason)}
              describedBy={errors.reason ? fieldId("reason-error") : undefined}
            />
          </div>
          {errors.reason ? <p id={fieldId("reason-error")} role="alert" className="mt-1.5 text-[12px] text-red-600 dark:text-red-400">{errors.reason}</p> : null}
        </div>

        <Field id={fieldId("note")} label="Ghi chú cho quản lý" hint="Không bắt buộc.">
          <Textarea className={darkFieldClass}
            {...fieldAria(fieldId("note"), null, true)}
            rows={3}
            placeholder="Ví dụ: khách đặt trước 3 cuốn, cần trước ngày 20"
            value={form.note}
            onChange={(e) => updateForm({ note: e.target.value })}
          />
        </Field>

        {duplicate ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-5 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Có thể trùng với yêu cầu đang mở</p>
              <p className="mt-0.5">
                <span className="font-mono">{duplicate.request_number}</span>: {duplicate.quantity_requested} cuốn tại {duplicate.warehouses?.code || "kho này"}, {statusLabel(duplicate.status).toLowerCase()}.
                Bạn vẫn gửi được; quản lý sẽ nhận thêm một yêu cầu riêng cho cùng cuốn sách.
              </p>
            </div>
          </div>
        ) : null}

        {Number.isInteger(quantityNumber) && quantityNumber >= 1 && (form.book || form.book_title_hint.trim()) && selectedWarehouse ? (
          <p className="text-[12px] text-muted-foreground">
            Sẽ gửi: <span className="font-medium text-foreground">{quantityNumber} cuốn “{(form.book?.title || form.book_title_hint).trim()}”</span> cho {selectedWarehouse.code}.
          </p>
        ) : null}
      </FormSheet>

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
