import { useEffect, useMemo, useState } from 'react';
import { PageWrapper, FadeItem } from '../motion-utils';
import { motion } from 'motion/react';
import { StatusBadge } from '../status-badge';
import { NavLink, useParams } from 'react-router';
import { ArrowLeft, Edit, ScanBarcode, Sparkles, MapPin, BookOpen, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { aiService } from '@/services/ai';
import { bookService } from '@/services/book';
import { getApiErrorMessage } from '@/services/api.ts';

interface BookLocation {
  warehouse_name: string;
  location_code: string;
  quantity: number;
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

function formatDescriptionText(value?: string | null): string {
  if (!value || !value.trim()) return "-";
  return value.replace(/\n{3,}/g, "\n\n").trim();
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
  const [showEditModal, setShowEditModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    title: "", subtitle: "", author_name: "", publisher_name: "", category_name: "",
    isbn_or_barcode: "", language: "vi", publish_year: "", list_price: "0", unit_cost: "0",
    description: "", summary_vi: "", cover_image_url: "",
  });

  const loadBook = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await bookService.getById(id);
      const payload = (data?.data || data) as BookDetailData;
      setBook(payload);
      setEditForm(toEditForm(payload));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cannot load book details"));
      setBook(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadBook(); }, [id]);

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
      toast.error("Please enter ISBN before using AI");
      return;
    }
    try {
      setIsApplyingAiMetadata(true);
      const lookup = await aiService.lookupBookByIsbn({ isbn: isbnOrBarcode, generateVietnameseSummary: false });
      if (!lookup?.found) {
        toast.info("No metadata found from ISBN.");
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
      toast.success("Metadata applied from ISBN");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cannot fetch AI metadata"));
    } finally {
      setIsApplyingAiMetadata(false);
    }
  };

  const handleGenerateSummaryVi = async () => {
    if (!editForm.title.trim()) {
      toast.error("Title is required before generating AI summary");
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
      toast.success(`AI summary created (${result.ai_provider === "groq" ? "Groq" : "Ollama"})`);
    } catch {
      toast.error("Cannot generate summary. Please try again.");
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleSaveBook = async () => {
    if (!id || !book) return;
    const title = editForm.title.trim();
    if (!title) { toast.error("Title is required"); return; }

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
      toast.success("Book updated successfully");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to update book"));
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <div className="p-6 lg:p-8 max-w-5xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-4 bg-muted rounded w-1/4" />
            <div className="h-40 bg-muted rounded-xl" />
            <div className="h-64 bg-muted rounded-xl" />
          </div>
        </div>
      </PageWrapper>
    );
  }

  if (!book) {
    return (
      <PageWrapper>
        <div className="p-6 lg:p-8 max-w-5xl mx-auto">
          <p className="text-[13px] text-muted-foreground">Book not found.</p>
          <NavLink to="/catalog" className="text-primary hover:underline text-[13px] mt-2 inline-block">Back to catalog</NavLink>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <FadeItem>
        <NavLink to="/catalog" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Catalog
        </NavLink>
      </FadeItem>

      {/* Book Header */}
      <FadeItem>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            {book.cover_image_url ? (
              <img src={book.cover_image_url} alt={book.title} className="w-16 h-20 rounded-[12px] border border-blue-200/40 shrink-0 shadow-sm object-cover" />
            ) : (
              <div className="w-16 h-20 rounded-[12px] bg-gradient-to-br from-blue-100 to-teal-50 flex items-center justify-center border border-blue-200/40 shrink-0">
                <BookOpen className="w-6 h-6 text-blue-500" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-[22px] font-bold tracking-tight text-foreground">{book.title}</h1>
                <StatusBadge label={book.is_incomplete ? "Incomplete" : "Complete"} variant={book.is_incomplete ? "warning" : "success"} dot />
              </div>
              <p className="text-[13px] text-muted-foreground mt-0.5">{book.subtitle || "-"}</p>
              <div className="flex items-center gap-4 mt-2 text-[12px] text-muted-foreground">
                <span>{book.author || "-"}</span>
                <span className="text-slate-300">|</span>
                <span>{book.publisher || "-"}{book.publish_year ? `, ${book.publish_year}` : ""}</span>
                <span className="text-slate-300">|</span>
                <span className="font-mono">{book.isbn || "-"}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowEditModal(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm">
              <Edit className="w-3.5 h-3.5" /> Edit
            </button>
            <NavLink to="/orders/new"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] shadow-md shadow-blue-500/15 hover:shadow-lg transition-all">
              <ScanBarcode className="w-3.5 h-3.5" /> Create Receipt
            </NavLink>
          </div>
        </div>
      </FadeItem>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Metadata */}
        <div className="lg:col-span-2 space-y-5">
          <FadeItem>
            <div className="rounded-xl border border-black/5 bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <h3 className="text-[14px] font-semibold mb-4">Book Metadata</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "ISBN / Barcode", value: book.isbn || "-", mono: true },
                  { label: "Author", value: book.author || "-" },
                  { label: "Publisher", value: book.publisher || "-" },
                  { label: "Year", value: book.publish_year ? String(book.publish_year) : "-" },
                  { label: "Language", value: book.language || "vi" },
                  { label: "Category", value: book.category || "-" },
                  { label: "List Price", value: formatCurrency(Number(book.list_price || 0)) },
                  { label: "Unit Cost", value: formatCurrency(Number(book.unit_cost || 0)) },
                ].map((meta) => (
                  <div key={meta.label}>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{meta.label}</div>
                    <div className={`text-[13px] font-semibold text-foreground ${meta.mono ? "font-mono" : ""}`}>{meta.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">Description</div>
                <p className="text-[13px] text-muted-foreground whitespace-pre-line leading-relaxed">{formatDescriptionText(book.description)}</p>
              </div>
              {book.summary_vi && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">AI Summary (Vietnamese)</div>
                  <p className="text-[13px] text-muted-foreground whitespace-pre-line leading-relaxed">{formatDescriptionText(book.summary_vi)}</p>
                </div>
              )}
            </div>
          </FadeItem>

          <FadeItem>
            <div className="rounded-xl border border-black/5 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-[14px] font-semibold">Inventory by Location</h3>
                  <StatusBadge label={`${totalStock} total`} variant="info" />
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Warehouse", "Location", "Qty"].map((header) => (
                      <th key={header} className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(book.locations || []).length === 0 ? (
                    <tr><td colSpan={3} className="px-5 py-8 text-center text-[12px] text-muted-foreground">No inventory records found.</td></tr>
                  ) : (
                    (book.locations || []).map((location, index) => (
                      <tr key={`${location.warehouse_name}-${location.location_code}-${index}`} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3.5 text-[13px] font-medium">{location.warehouse_name || "-"}</td>
                        <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{location.location_code || "-"}</td>
                        <td className="px-5 py-3.5 text-[14px] font-bold">{location.quantity}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </FadeItem>
        </div>

        {/* Right: Stock Summary */}
        <div className="space-y-5">
          <FadeItem>
            <div className="rounded-xl border border-black/5 bg-gradient-to-br from-blue-50/80 to-teal-50/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <h3 className="text-[14px] font-semibold mb-3">Stock Summary</h3>
              <div className="text-center py-2">
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}
                  className="text-[42px] bg-gradient-to-r from-blue-600 to-teal-600 bg-clip-text text-transparent tracking-[-0.03em]"
                  style={{ fontWeight: 800, lineHeight: 1 }}>
                  {totalStock}
                </motion.div>
                <div className="text-[12px] text-muted-foreground mt-1">total units in stock</div>
              </div>
              <div className="space-y-1.5 mt-3">
                {(book.locations || []).slice(0, 5).map((location, index) => (
                  <div key={`${location.warehouse_name}-${location.location_code}-${index}`}
                    className="flex items-center justify-between text-[12px] py-1.5 px-2 rounded-[7px] hover:bg-white/60 transition-colors">
                    <span className="text-muted-foreground flex items-center gap-1.5"><MapPin className="w-3 h-3 text-teal-500" />{location.warehouse_name} / {location.location_code}</span>
                    <span className="text-blue-700 font-semibold">{location.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </FadeItem>
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowEditModal(false)}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-5 text-[16px] font-semibold">Edit Book Information</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Title *</label>
                  <input value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Subtitle</label>
                  <input value={editForm.subtitle} onChange={(e) => setEditForm((p) => ({ ...p, subtitle: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Author</label>
                  <input value={editForm.author_name} onChange={(e) => setEditForm((p) => ({ ...p, author_name: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Publisher</label>
                  <input value={editForm.publisher_name} onChange={(e) => setEditForm((p) => ({ ...p, publisher_name: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Category</label>
                  <input value={editForm.category_name} onChange={(e) => setEditForm((p) => ({ ...p, category_name: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[12px] font-semibold text-muted-foreground">ISBN / Barcode</label>
                    <button type="button" onClick={() => void handleApplyAiMetadata()} disabled={isApplyingAiMetadata}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 transition-colors disabled:opacity-50">
                      <Sparkles className="w-3.5 h-3.5" />
                      {isApplyingAiMetadata ? "Loading..." : "AI Fill"}
                    </button>
                  </div>
                  <input value={editForm.isbn_or_barcode} onChange={(e) => setEditForm((p) => ({ ...p, isbn_or_barcode: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] font-mono outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Language</label>
                  <input value={editForm.language} onChange={(e) => setEditForm((p) => ({ ...p, language: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Publish Year</label>
                  <input type="number" value={editForm.publish_year} onChange={(e) => setEditForm((p) => ({ ...p, publish_year: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">List Price (VND)</label>
                  <input type="number" value={editForm.list_price} onChange={(e) => setEditForm((p) => ({ ...p, list_price: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Unit Cost (VND)</label>
                  <input type="number" value={editForm.unit_cost} onChange={(e) => setEditForm((p) => ({ ...p, unit_cost: e.target.value }))}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Cover Image URL</label>
                <input value={editForm.cover_image_url || ""} onChange={(e) => setEditForm((p) => ({ ...p, cover_image_url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all" />
                {editForm.cover_image_url && (
                  <img src={editForm.cover_image_url} alt="Cover preview" className="mt-2 max-h-24 rounded-lg object-contain border border-border" />
                )}
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Description</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  rows={4}
                  className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all resize-none" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[12px] font-semibold text-muted-foreground">AI Summary (Vietnamese)</label>
                  <button type="button" onClick={() => void handleGenerateSummaryVi()} disabled={summaryLoading || !editForm.title.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 transition-colors disabled:opacity-40">
                    {summaryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {summaryLoading ? "Generating..." : "Generate AI"}
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
                Cancel
              </button>
              <button type="button" onClick={() => void handleSaveBook()} disabled={isSaving || isApplyingAiMetadata}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </PageWrapper>
  );
}
