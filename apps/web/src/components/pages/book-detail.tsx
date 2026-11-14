import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageWrapper, FadeItem } from '../motion-utils';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { NavLink, useParams } from 'react-router';
import { ArrowLeft, Edit, ScanBarcode, Sparkles, MapPin, BookOpen, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { aiService } from '@/services/ai';
import { bookService } from '@/services/book';
import { getApiErrorMessage } from '@/services/api.ts';
import { authService } from '@/services/auth';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface BookLocation {
  warehouse_name: string;
  location_code: string;
  quantity: number;
  is_receiving?: boolean;
}

interface BookDetailData {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  summary_vi?: string | null;
  author?: string;
  category?: string;
  publisher?: string;
  isbn?: string;
  language?: string;
  publish_year?: number | null;
  list_price?: number;
  unit_cost?: number;
  quantity?: number;
  is_incomplete?: boolean;
  cover_image_url?: string | null;
  locations?: BookLocation[];
  reservable?: boolean | null;
  variant_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface EditForm {
  title: string;
  subtitle: string;
  author_name: string;
  publisher_name: string;
  category_name: string;
  isbn_or_barcode: string;
  language: string;
  publish_year: string;
  list_price: string;
  unit_cost: string;
  description: string;
  summary_vi: string;
  cover_image_url?: string;
}

function formatCurrency(value: number): string {
  return `${value.toLocaleString("vi-VN")} VND`;
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('vi-VN');
}

function formatDescriptionText(value?: string | null): string {
  if (!value || !value.trim()) return "-";
  return value.replace(/\n{3,}/g, "\n\n").trim();
}

const LOW_STOCK_THRESHOLD = 10;
const DESCRIPTION_PREVIEW_CHARS = 420;

function stockTone(total: number): { label: string; variant: 'danger' | 'warning' | 'success'; text: string } {
  if (total <= 0) return { label: 'Hết hàng', variant: 'danger', text: 'text-red-700 dark:text-red-400' };
  if (total <= LOW_STOCK_THRESHOLD) return { label: 'Sắp hết', variant: 'warning', text: 'text-amber-700 dark:text-amber-300' };
  return { label: 'Còn hàng', variant: 'success', text: 'text-foreground' };
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const empty = value === '-';
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-words text-[13px] ${empty ? 'text-muted-foreground/60' : 'font-medium text-foreground'} ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function toEditForm(book: BookDetailData): EditForm {
  return {
    title: book.title || "",
    subtitle: String(book.subtitle || ""),
    author_name: String(book.author || ""),
    publisher_name: String(book.publisher || ""),
    category_name: String(book.category || ""),
    isbn_or_barcode: String(book.isbn || ""),
    language: String(book.language || "vi"),
    publish_year: book.publish_year ? String(book.publish_year) : "",
    list_price: Number(book.list_price || 0).toString(),
    unit_cost: Number(book.unit_cost || 0).toString(),
    description: String(book.description || ""),
    summary_vi: String(book.summary_vi || ""),
    cover_image_url: String(book.cover_image_url || ""),
  };
}

export function BookDetailPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [book, setBook] = useState<BookDetailData | null>(null);
  const [isApplyingAiMetadata, setIsApplyingAiMetadata] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const editModalRef = useRef<HTMLDivElement>(null);
  const closeEditModal = useCallback(() => setShowEditModal(false), []);
  useDialogA11y(showEditModal, closeEditModal, editModalRef);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    title: "", subtitle: "", author_name: "", publisher_name: "", category_name: "",
    isbn_or_barcode: "", language: "vi", publish_year: "", list_price: "0", unit_cost: "0",
    description: "", summary_vi: "", cover_image_url: "",
  });
  const currentUser = authService.getCurrentUser();
  const currentUserRoles = (currentUser?.roles || []).map((role) => role.toUpperCase());
  const canManageCatalog = Boolean(currentUser?.is_superuser) || currentUserRoles.includes("ADMIN") || currentUserRoles.includes("WAREHOUSE_MANAGER");
  const canCompleteIncompleteBook = currentUserRoles.includes("LIBRARIAN");
  const canCreateReceivingDraft = currentUserRoles.some((role) => ["WAREHOUSE_STAFF", "WAREHOUSE_MANAGER", "ADMIN"].includes(role));
  const canEditBook = Boolean(book && (canManageCatalog || (canCompleteIncompleteBook && book.is_incomplete)));

  const loadBook = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await bookService.getById(id);
      const payload = (data?.data || data) as BookDetailData;
      setBook(payload);
      setEditForm(toEditForm(payload));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được thông tin sách"));
      setBook(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadBook(); }, [loadBook]);

  const totalStock = useMemo(() => {
    return (book?.locations || []).reduce((sum, location) => sum + Number(location.quantity || 0), 0);
  }, [book]);

  const normalizeIsbnOrBarcode = (value: string): string => {
    return String(value || "").trim().replace(/[^0-9Xx]/g, "").toUpperCase();
  };

  const extractPublishYear = (publishedDate?: string | null): string => {
    const matched = String(publishedDate || "").match(/\b(\d{4})\b/);
    if (!matched) return "";
    const year = Number(matched[1]);
    if (!Number.isInteger(year) || year < 1000 || year > 2100) return "";
    return String(year);
  };

  const handleApplyAiMetadata = async () => {
    const isbnOrBarcode = normalizeIsbnOrBarcode(editForm.isbn_or_barcode);
    if (!isbnOrBarcode) {
      toast.error("Vui lòng nhập ISBN trước khi dùng AI");
      return;
    }
    try {
      setIsApplyingAiMetadata(true);
      const lookup = await aiService.lookupBookByIsbn({ isbn: isbnOrBarcode, generateVietnameseSummary: false });
      if (!lookup?.found) {
        toast.info("Không tìm thấy thông tin sách theo ISBN này.");
        return;
      }
      setEditForm((prev) => ({
        ...prev,
        title: lookup.title || prev.title,
        subtitle: lookup.subtitle || prev.subtitle,
        author_name: lookup.authors?.[0] || prev.author_name,
        publisher_name: lookup.publisher || prev.publisher_name,
        category_name: lookup.categories?.[0] || prev.category_name,
        isbn_or_barcode: lookup.isbn || prev.isbn_or_barcode,
        language: lookup.language || prev.language,
        publish_year: extractPublishYear(lookup.publishedDate) || prev.publish_year,
        description: lookup.description?.trim() || prev.description,
        cover_image_url: lookup.thumbnail || prev.cover_image_url,
      }));
      toast.success("Đã điền thông tin từ ISBN");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không lấy được thông tin từ AI"));
    } finally {
      setIsApplyingAiMetadata(false);
    }
  };

  const handleGenerateSummaryVi = async () => {
    if (!editForm.title.trim()) {
      toast.error("Cần có tên sách trước khi tạo tóm tắt AI");
      return;
    }
    setSummaryLoading(true);
    try {
      const result = await aiService.generateSummaryVi({
        title: editForm.title.trim(),
        author: editForm.author_name.trim(),
        description: editForm.description,
        categories: editForm.category_name ? [editForm.category_name] : [],
      });
      setEditForm((prev) => ({ ...prev, summary_vi: result.summaryVi || prev.summary_vi }));
      toast.success(`Đã tạo tóm tắt AI (${result.ai_provider === "openrouter" ? "OpenRouter" : result.ai_provider})`);
    } catch {
      toast.error("Không tạo được tóm tắt. Vui lòng thử lại.");
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleSaveBook = async () => {
    if (!id || !book) return;
    const title = editForm.title.trim();
    if (!title) { toast.error("Tên sách là bắt buộc"); return; }

    const isbnOrBarcode = editForm.isbn_or_barcode.trim();
    const payload: Record<string, unknown> = {
      title,
      subtitle: editForm.subtitle.trim() || null,
      description: editForm.description.trim() || null,
      summary_vi: editForm.summary_vi.trim() || null,
      author_name: editForm.author_name.trim() || null,
      publisher_name: editForm.publisher_name.trim() || null,
      category_name: editForm.category_name.trim() || null,
      language: editForm.language.trim() || "vi",
      list_price: Number(editForm.list_price || 0),
      unit_cost: Number(editForm.unit_cost || 0),
    };
    if (editForm.cover_image_url?.trim()) payload.cover_image_url = editForm.cover_image_url.trim();
    if (editForm.publish_year.trim()) payload.publish_year = Number(editForm.publish_year);
    if (isbnOrBarcode) {
      if (/^\d{13}$/.test(isbnOrBarcode)) payload.isbn13 = isbnOrBarcode;
      else if (/^\d{10}$/.test(isbnOrBarcode)) payload.isbn10 = isbnOrBarcode;
      else payload.internal_barcode = isbnOrBarcode;
    }

    try {
      setIsSaving(true);
      const response = await bookService.update(String(id), payload);
      const updated = (response?.data || response) as BookDetailData;
      setBook(updated);
      setEditForm(toEditForm(updated));
      setShowEditModal(false);
      toast.success("Đã cập nhật sách");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cập nhật sách thất bại"));
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-4 bg-muted rounded w-1/4" />
            <div className="h-48 bg-muted rounded-xl" />
            <div className="h-64 bg-muted rounded-xl" />
          </div>
        </div>
      </PageWrapper>
    );
  }

  if (!book) {
    return (
      <PageWrapper>
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
          <p className="text-[13px] text-muted-foreground">Không tìm thấy sách này.</p>
          <NavLink to="/catalog" className="text-primary hover:underline text-[13px] mt-2 inline-block">Quay lại danh mục</NavLink>
        </div>
      </PageWrapper>
    );
  }

  const tone = stockTone(totalStock);
  const locations = book.locations || [];
  const description = formatDescriptionText(book.description);
  const hasDescription = description !== '-';
  const longDescription = hasDescription && description.length > DESCRIPTION_PREVIEW_CHARS;
  const shownDescription = longDescription && !descriptionExpanded
    ? `${description.slice(0, DESCRIPTION_PREVIEW_CHARS).trimEnd()}…`
    : description;
  const missingFields = [
    !book.author && 'tác giả',
    !book.publisher && 'nhà xuất bản',
    !book.publish_year && 'năm xuất bản',
    !book.category && 'thể loại',
    !hasDescription && 'mô tả',
    !book.cover_image_url && 'ảnh bìa',
  ].filter(Boolean) as string[];

  // Shelf vs receiving, summed from the same location rows as the total.
  const receivingStock = locations.reduce((sum, l) => sum + (l.is_receiving ? Number(l.quantity || 0) : 0), 0);
  const shelfStock = totalStock - receivingStock;
  const byWarehouse = locations.reduce<Array<{ name: string; total: number; rows: BookLocation[] }>>((groups, location) => {
    const name = location.warehouse_name || '-';
    const group = groups.find((g) => g.name === name);
    if (group) { group.rows.push(location); group.total += Number(location.quantity || 0); }
    else groups.push({ name, total: Number(location.quantity || 0), rows: [location] });
    return groups;
  }, []).sort((a, b) => b.total - a.total);
  const listPrice = Number(book.list_price || 0);
  const unitCost = Number(book.unit_cost || 0);
  const details: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'ISBN / Mã vạch', value: book.isbn || '-', mono: true },
    { label: 'Ngôn ngữ', value: book.language || 'vi' },
    { label: 'Tác giả', value: book.author || '-' },
    { label: 'Nhà xuất bản', value: book.publisher || '-' },
    { label: 'Năm xuất bản', value: book.publish_year ? String(book.publish_year) : '-' },
    { label: 'Thể loại', value: book.category || '-' },
    { label: 'Cho đặt trước', value: book.reservable == null ? '-' : book.reservable ? 'Có' : 'Không' },
    { label: 'Phiên bản', value: book.variant_count ? `${book.variant_count}` : '-' },
    { label: 'Tạo lúc', value: formatDate(book.created_at) },
    { label: 'Cập nhật', value: formatDate(book.updated_at) },
  ];

  return (
    <PageWrapper className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <FadeItem>
        <NavLink to="/catalog" className="-ml-1 inline-flex items-center gap-1.5 rounded px-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <ArrowLeft className="w-3.5 h-3.5" /> Danh mục sách
        </NavLink>
      </FadeItem>

      {/* Object header: which book this is, and the one or two things to do with it. */}
      <FadeItem>
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {book.cover_image_url ? (
            <img src={book.cover_image_url} alt={`Bìa sách ${book.title}`} className="h-44 w-32 shrink-0 rounded-xl border border-border object-cover sm:h-48 sm:w-[132px]" />
          ) : (
            <div className="flex h-44 w-32 shrink-0 items-center justify-center rounded-xl border border-border bg-primary/[0.05] sm:h-48 sm:w-[132px]">
              <BookOpen className="h-8 w-8 text-primary/60" aria-hidden="true" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-muted-foreground">
              {book.category || 'Chưa có thể loại'}
              {book.is_incomplete ? <span className="ml-2 inline-flex items-center gap-1 font-medium text-amber-800 dark:text-amber-300"><Info className="h-3 w-3" aria-hidden="true" />Chưa hoàn chỉnh</span> : null}
            </p>
            <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight tracking-tight text-foreground">{book.title}</h1>
            {book.subtitle ? <p className="mt-1 text-[15px] text-muted-foreground">{book.subtitle}</p> : null}
            <p className="mt-3 text-[15px] text-foreground">{book.author || <span className="text-muted-foreground">Chưa có tác giả</span>}</p>
            <p className="text-[13px] text-muted-foreground">
              {[book.publisher, book.publish_year ? String(book.publish_year) : null].filter(Boolean).join(', ') || 'Chưa có nhà xuất bản'}
            </p>
            {book.isbn ? <p className="mt-2 font-mono text-[12px] text-muted-foreground">ISBN {book.isbn}</p> : null}

            {canEditBook || canCreateReceivingDraft ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {canEditBook ? (
                  <Button variant="outline" onClick={() => setShowEditModal(true)}>
                    <Edit className="h-3.5 w-3.5" /> Chỉnh sửa
                  </Button>
                ) : null}
                {canCreateReceivingDraft ? (
                  <Button asChild>
                    <NavLink to="/orders/new"><ScanBarcode className="h-3.5 w-3.5" /> Tạo phiếu nhập</NavLink>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>
      </FadeItem>

      {book.is_incomplete ? (
        <FadeItem>
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="flex-1">
              Sách này chưa hoàn chỉnh{missingFields.length > 0 ? <>: còn thiếu <span className="font-semibold">{missingFields.join(', ')}</span></> : null}.
              {canEditBook ? ' Bổ sung thông tin để sách hiển thị đầy đủ trong danh mục.' : ''}
            </p>
            {canEditBook ? (
              <button onClick={() => setShowEditModal(true)} className="shrink-0 font-semibold underline underline-offset-4 hover:opacity-80">Bổ sung</button>
            ) : null}
          </div>
        </FadeItem>
      ) : null}

      {/* Stock at a glance: the total, then where it actually is. */}
      <FadeItem>
        <dl className="grid grid-cols-1 divide-y divide-border rounded-2xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <dt className="text-[13px] text-muted-foreground">Tổng trong kho, cuốn</dt>
            <dd className={`mt-1 font-display text-[32px] font-semibold leading-none tabular-nums ${tone.text}`}>
              {totalStock}
            </dd>
            <dd className="mt-2 text-[12px] text-muted-foreground">
              {tone.label}{locations.length ? `, ở ${locations.length} vị trí thuộc ${byWarehouse.length} kho` : ''}
            </dd>
          </div>
          <div className="p-5">
            <dt className="text-[13px] text-muted-foreground">Trên kệ, sẵn sàng, cuốn</dt>
            <dd className="mt-1 font-display text-[32px] font-semibold leading-none tabular-nums text-foreground">
              {shelfStock}
            </dd>
            <dd className="mt-2 text-[12px] text-muted-foreground">Có thể bán, cho mượn hoặc lấy hàng.</dd>
          </div>
          <div className="p-5">
            <dt className="text-[13px] text-muted-foreground">Ở khu nhận chờ cất, cuốn</dt>
            <dd className="mt-1 font-display text-[32px] font-semibold leading-none tabular-nums text-foreground">
              {receivingStock}
            </dd>
            <dd className="mt-2 text-[12px] text-muted-foreground">{receivingStock > 0 ? 'Cần cất lên kệ trước khi dùng được.' : 'Không có hàng chờ cất.'}</dd>
          </div>
        </dl>
      </FadeItem>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <FadeItem>
            <section aria-labelledby="book-stock-title" className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="px-5 pb-3 pt-4">
                <h2 id="book-stock-title" className="font-display text-[18px] font-semibold tracking-tight">Tồn kho theo vị trí</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Nhóm theo kho, nhiều nhất ở trên.</p>
              </div>
              {byWarehouse.length === 0 ? (
                <p className="border-t border-border px-5 py-8 text-center text-[13px] text-muted-foreground">Chưa có bản nào của sách này trong kho.</p>
              ) : (
                <div className="border-t border-border">
                  {byWarehouse.map((group) => (
                    <div key={group.name} className="border-b border-border last:border-0">
                      <div className="flex items-baseline justify-between gap-3 bg-muted/40 px-5 py-2">
                        <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">{group.name}</h3>
                        <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{group.total} cuốn</span>
                      </div>
                      <ul className="divide-y divide-border">
                        {group.rows.map((location, index) => {
                          const share = totalStock > 0 ? Math.round((Number(location.quantity || 0) / totalStock) * 100) : 0;
                          return (
                            <li key={`${location.location_code}-${index}`} className="flex items-center gap-4 px-5 py-2.5">
                              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-mono text-[13px] text-foreground">{location.location_code || '-'}</p>
                                {location.is_receiving ? <p className="text-[12px] text-amber-800 dark:text-amber-300">Khu nhận, chờ cất lên kệ</p> : null}
                              </div>
                              <div className="hidden w-24 sm:block" aria-hidden="true">
                                <div className="h-1.5 overflow-hidden rounded-full bg-primary/10">
                                  <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                                </div>
                              </div>
                              <span className="w-12 text-right text-[15px] font-semibold tabular-nums text-foreground">{location.quantity}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </FadeItem>

          <FadeItem>
            <section aria-labelledby="book-about-title" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <h2 id="book-about-title" className="font-display text-[18px] font-semibold tracking-tight">Giới thiệu</h2>
              {hasDescription ? (
                <>
                  <p className="mt-3 max-w-prose whitespace-pre-line text-[14px] leading-relaxed text-foreground/85">{shownDescription}</p>
                  {longDescription ? (
                    <button
                      type="button"
                      onClick={() => setDescriptionExpanded((open) => !open)}
                      aria-expanded={descriptionExpanded}
                      className="mt-2 text-[13px] font-medium text-primary hover:underline"
                    >
                      {descriptionExpanded ? 'Thu gọn' : 'Xem thêm'}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-[13px] text-muted-foreground">Chưa có mô tả cho sách này.</p>
              )}

              {book.summary_vi ? (
                <div className="mt-5 rounded-xl bg-primary/[0.05] p-4">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Tóm tắt do AI tạo (tiếng Việt)
                  </p>
                  <p className="mt-2 max-w-prose whitespace-pre-line text-[13px] leading-relaxed text-foreground/85">{formatDescriptionText(book.summary_vi)}</p>
                </div>
              ) : null}
            </section>
          </FadeItem>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-4">
          <FadeItem>
            <section aria-labelledby="book-price-title" className="rounded-2xl border border-border bg-card p-5">
              <h2 id="book-price-title" className="font-display text-[18px] font-semibold tracking-tight">Giá</h2>
              <dl className="mt-3 space-y-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[13px] text-muted-foreground">Giá bìa</dt>
                  <dd className="font-display text-[20px] font-semibold tabular-nums text-foreground">{formatCurrency(listPrice)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[13px] text-muted-foreground">Giá vốn</dt>
                  <dd className="text-[14px] tabular-nums text-foreground">{formatCurrency(unitCost)}</dd>
                </div>
                {listPrice > 0 && unitCost > 0 ? (
                  <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
                    <dt className="text-[13px] text-muted-foreground">Chênh lệch</dt>
                    <dd className="text-[14px] tabular-nums text-foreground">
                      {formatCurrency(listPrice - unitCost)}
                      <span className="ml-1 text-[12px] text-muted-foreground">({Math.round(((listPrice - unitCost) / listPrice) * 100)}%)</span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </FadeItem>

          <FadeItem>
            <section aria-labelledby="book-info-title" className="rounded-2xl border border-border bg-card p-5">
              <h2 id="book-info-title" className="font-display text-[18px] font-semibold tracking-tight">Thông tin chi tiết</h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3.5">
                {details.map((item) => <DetailItem key={item.label} label={item.label} value={item.value} mono={item.mono} />)}
              </dl>
            </section>
          </FadeItem>
        </aside>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowEditModal(false)} role="dialog" aria-modal="true" aria-labelledby="book-edit-modal-title">
          <motion.div ref={editModalRef} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-3xl rounded-2xl bg-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <h3 id="book-edit-modal-title" className="mb-5 text-[16px] font-semibold">Chỉnh sửa thông tin sách</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Tên sách *</label>
                  <input value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Phụ đề</label>
                  <input value={editForm.subtitle} onChange={(e) => setEditForm((p) => ({ ...p, subtitle: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Tác giả</label>
                  <input value={editForm.author_name} onChange={(e) => setEditForm((p) => ({ ...p, author_name: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Nhà xuất bản</label>
                  <input value={editForm.publisher_name} onChange={(e) => setEditForm((p) => ({ ...p, publisher_name: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Thể loại</label>
                  <input value={editForm.category_name} onChange={(e) => setEditForm((p) => ({ ...p, category_name: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[12px] font-semibold text-muted-foreground">ISBN / Barcode</label>
                    <button type="button" onClick={() => void handleApplyAiMetadata()} disabled={isApplyingAiMetadata}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary/[0.08] px-2.5 py-1 text-[12px] font-semibold text-primary hover:bg-primary/[0.14] transition-colors disabled:opacity-50">
                      <Sparkles className="w-3.5 h-3.5" />
                      {isApplyingAiMetadata ? "Đang tải..." : "AI điền giúp"}
                    </button>
                  </div>
                  <input value={editForm.isbn_or_barcode} onChange={(e) => setEditForm((p) => ({ ...p, isbn_or_barcode: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] font-mono outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Ngôn ngữ</label>
                  <input value={editForm.language} onChange={(e) => setEditForm((p) => ({ ...p, language: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Năm xuất bản</label>
                  <input type="number" value={editForm.publish_year} onChange={(e) => setEditForm((p) => ({ ...p, publish_year: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Giá bìa (VND)</label>
                  <input type="number" value={editForm.list_price} onChange={(e) => setEditForm((p) => ({ ...p, list_price: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Giá vốn (VND)</label>
                  <input type="number" value={editForm.unit_cost} onChange={(e) => setEditForm((p) => ({ ...p, unit_cost: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Đường dẫn ảnh bìa</label>
                <input value={editForm.cover_image_url || ""} onChange={(e) => setEditForm((p) => ({ ...p, cover_image_url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                {editForm.cover_image_url && (
                  <img src={editForm.cover_image_url} alt="Xem trước ảnh bìa" className="mt-2 max-h-24 rounded-lg object-contain border border-border" />
                )}
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Mô tả</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  rows={4}
                  className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all resize-none" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[12px] font-semibold text-muted-foreground">Tóm tắt AI (tiếng Việt)</label>
                  <button type="button" onClick={() => void handleGenerateSummaryVi()} disabled={summaryLoading || !editForm.title.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary/[0.08] px-2.5 py-1 text-[12px] font-semibold text-primary hover:bg-primary/[0.14] transition-colors disabled:opacity-40">
                    {summaryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {summaryLoading ? "Đang tạo..." : "Tạo bằng AI"}
                  </button>
                </div>
                <textarea value={editForm.summary_vi} onChange={(e) => setEditForm((p) => ({ ...p, summary_vi: e.target.value }))}
                  rows={5}
                  className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all resize-none" />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button type="button" onClick={() => setShowEditModal(false)}
                className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] font-semibold text-muted-foreground hover:bg-muted transition-colors">
                Hủy
              </button>
              <button type="button" onClick={() => void handleSaveBook()} disabled={isSaving || isApplyingAiMetadata}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSaving ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </PageWrapper>
  );
}
