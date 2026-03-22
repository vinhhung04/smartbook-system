import { useEffect, useMemo, useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { StatusBadge } from "../status-badge";
import { NavLink, useParams } from "react-router";
import { ArrowLeft, Edit, ScanBarcode, Sparkles, MapPin, BookOpen, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { aiService } from "@/services/ai";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api.ts";

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

  return value
    .replace(/\\n/g, "\n")
    .replace(/\s*(📘|🧠|✨|🎯)\s*/g, "\n$1 ")
    .replace(/\s*•\s*/g, "\n• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const [showEditModal, setShowEditModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    title: "",
    subtitle: "",
    author_name: "",
    publisher_name: "",
    category_name: "",
    isbn_or_barcode: "",
    language: "vi",
    publish_year: "",
    list_price: "0",
    unit_cost: "0",
    description: "",
    summary_vi: "",
    cover_image_url: "",
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
      toast.error(getApiErrorMessage(error, "Khong the tai chi tiet sach"));
      setBook(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBook();
  }, [id]);

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
      toast.error("Vui long nhap ISBN truoc khi dung AI");
      return;
    }

    try {
      setIsApplyingAiMetadata(true);
      const lookup = await aiService.lookupBookByIsbn({
        isbn: isbnOrBarcode,
        generateVietnameseSummary: true,
      });

      if (!lookup?.found) {
        toast.info("Khong tim thay metadata tu ISBN. Ban co the tiep tuc nhap tay.");
        return;
      }

      setEditForm((prev) => {
        const firstAuthor = lookup.authors?.[0] || prev.author_name;
        const firstCategory = lookup.categories?.[0] || prev.category_name;
        const suggestedDescription = lookup.description?.trim() || prev.description;
        const suggestedSummaryVi = lookup.summaryVi?.trim() || prev.summary_vi;

        return {
          ...prev,
          title: lookup.title || prev.title,
          subtitle: lookup.subtitle || prev.subtitle,
          author_name: firstAuthor,
          publisher_name: lookup.publisher || prev.publisher_name,
          category_name: firstCategory,
          isbn_or_barcode: lookup.isbn || prev.isbn_or_barcode,
          language: lookup.language || prev.language,
          publish_year: extractPublishYear(lookup.publishedDate) || prev.publish_year,
          description: suggestedDescription,
          summary_vi: suggestedSummaryVi,
          cover_image_url: lookup.thumbnail || prev.cover_image_url,
        };
      });

      toast.success("Da dien metadata, description va summary TIeng Viet bang AI");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong the lay metadata bang AI"));
    } finally {
      setIsApplyingAiMetadata(false);
    }
  };

  const handleSaveBook = async () => {
    if (!id || !book) return;

    const title = editForm.title.trim();
    if (!title) {
      toast.error("Ten sach la bat buoc");
      return;
    }

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

    if (editForm.cover_image_url?.trim()) {
      payload.cover_image_url = editForm.cover_image_url.trim();
    }

    if (editForm.publish_year.trim()) {
      payload.publish_year = Number(editForm.publish_year);
    }

    if (isbnOrBarcode) {
      if (/^\d{13}$/.test(isbnOrBarcode)) {
        payload.isbn13 = isbnOrBarcode;
      } else if (/^\d{10}$/.test(isbnOrBarcode)) {
        payload.isbn10 = isbnOrBarcode;
      } else {
        payload.internal_barcode = isbnOrBarcode;
      }
    }

    try {
      setIsSaving(true);
      const response = await bookService.update(String(id), payload);
      const updated = (response?.data || response) as BookDetailData;
      setBook(updated);
      setEditForm(toEditForm(updated));
      setShowEditModal(false);
      toast.success("Da cap nhat thong tin sach");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cap nhat thong tin sach that bai"));
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-400">Dang tai chi tiet sach...</p>
      </PageWrapper>
    );
  }

  if (!book) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-400">Khong tim thay sach.</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <NavLink to="/catalog" className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-blue-600 transition-colors" style={{ fontWeight: 550 }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Catalog
        </NavLink>
      </FadeItem>

      <FadeItem>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {book.cover_image_url ? (
              <img
                src={book.cover_image_url}
                alt={book.title}
                className="w-16 h-20 rounded-[12px] border border-blue-200/40 shrink-0 shadow-sm shadow-blue-100/30 object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-16 h-20 rounded-[12px] bg-gradient-to-br from-blue-100 to-teal-50 flex items-center justify-center border border-blue-200/40 shrink-0 shadow-sm shadow-blue-100/30">
                <BookOpen className="w-6 h-6 text-blue-500" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="tracking-[-0.02em]">{book.title}</h1>
                <StatusBadge label={book.is_incomplete ? "Incomplete" : "Complete"} variant={book.is_incomplete ? "warning" : "success"} dot />
              </div>
              <p className="text-[13px] text-slate-500 mt-0.5">{book.subtitle || "-"}</p>
              <div className="flex items-center gap-4 mt-2 text-[12px] text-slate-400">
                <span>{book.author || "-"}</span><span className="text-slate-200">|</span>
                <span>{book.publisher || "-"}{book.publish_year ? `, ${book.publish_year}` : ""}</span><span className="text-slate-200">|</span>
                <span className="font-mono">{book.isbn || "-"}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowEditModal(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm"
              style={{ fontWeight: 550 }}
            >
              <Edit className="w-3.5 h-3.5" /> Edit
            </button>
            <NavLink to="/orders/new" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] shadow-md shadow-blue-500/15 hover:shadow-lg transition-all" style={{ fontWeight: 550 }}>
              <ScanBarcode className="w-3.5 h-3.5" /> Create Receipt
            </NavLink>
          </div>
        </div>
      </FadeItem>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <FadeItem>
            <div className="bg-white rounded-[16px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <h3 className="text-[14px] mb-4" style={{ fontWeight: 650 }}>Book Metadata</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
                    <div className="text-[11px] text-slate-400 uppercase tracking-[0.05em] mb-1" style={{ fontWeight: 550 }}>{meta.label}</div>
                    <div className={`text-[13px] ${meta.mono ? "font-mono" : ""}`} style={{ fontWeight: 550 }}>{meta.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="text-[11px] text-slate-400 uppercase tracking-[0.05em] mb-2" style={{ fontWeight: 550 }}>Description</div>
                <p className="text-[13px] text-slate-500 whitespace-pre-line break-words" style={{ lineHeight: 1.6 }}>
                  {formatDescriptionText(book.description)}
                </p>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="text-[11px] text-slate-400 uppercase tracking-[0.05em] mb-2" style={{ fontWeight: 550 }}>Summary TIeng Viet (AI)</div>
                <p className="text-[13px] text-slate-500 whitespace-pre-line break-words" style={{ lineHeight: 1.6 }}>
                  {formatDescriptionText(book.summary_vi)}
                </p>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="bg-white rounded-[16px] border border-white/80 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-[14px]" style={{ fontWeight: 650 }}>Inventory by Location</h3>
                  <StatusBadge label={`${totalStock} total`} variant="teal" />
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-t border-b border-slate-100 bg-gradient-to-r from-teal-50/30 to-transparent">
                    {["Warehouse", "Location", "Qty"].map((header) => (
                      <th key={header} className="text-left text-[11px] text-slate-400 px-5 py-2.5 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(book.locations || []).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-5 py-6 text-[12px] text-slate-400">Chua co ton kho theo vi tri.</td>
                    </tr>
                  ) : (
                    (book.locations || []).map((location, index) => (
                      <tr key={`${location.warehouse_name}-${location.location_code}-${index}`} className="border-b border-slate-50 last:border-0 hover:bg-emerald-50/20 transition-colors">
                        <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>{location.warehouse_name || "-"}</td>
                        <td className="px-5 py-3.5 text-[12px] font-mono text-slate-500">{location.location_code || "-"}</td>
                        <td className="px-5 py-3.5 text-[14px]" style={{ fontWeight: 700 }}>{location.quantity}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </FadeItem>
        </div>

        <div className="space-y-5">
          <FadeItem>
            <div className="bg-gradient-to-br from-blue-50/80 to-teal-50/50 rounded-[16px] border border-blue-100/60 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <h3 className="text-[14px] mb-3" style={{ fontWeight: 650 }}>Stock Summary</h3>
              <div className="text-center py-2">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="text-[42px] bg-gradient-to-r from-blue-600 to-teal-600 bg-clip-text text-transparent tracking-[-0.03em]"
                  style={{ fontWeight: 800, lineHeight: 1 }}
                >
                  {totalStock}
                </motion.div>
                <div className="text-[12px] text-slate-500 mt-1">total units in stock</div>
              </div>
              <div className="space-y-2 mt-3">
                {(book.locations || []).slice(0, 5).map((location, index) => (
                  <div key={`${location.warehouse_name}-${location.location_code}-${index}`} className="flex items-center justify-between text-[12px] py-1.5 px-2 rounded-[7px] hover:bg-white/60 transition-colors">
                    <span className="text-slate-500 flex items-center gap-1.5"><MapPin className="w-3 h-3 text-teal-500" />{location.warehouse_name} / {location.location_code}</span>
                    <span className="text-blue-700" style={{ fontWeight: 650 }}>{location.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </FadeItem>
        </div>
      </div>

      {showEditModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-3xl rounded-[16px] bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <h3 className="mb-5 text-[16px] font-semibold">Chinh sua thong tin sach</h3>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                    Ten sach <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={editForm.title}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Nhap ten sach"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                    Subtitle
                  </label>
                  <input
                    value={editForm.subtitle}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, subtitle: event.target.value }))}
                    placeholder="Nhap subtitle"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                    Tac gia
                  </label>
                  <input
                    value={editForm.author_name}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, author_name: event.target.value }))}
                    placeholder="Nhap ten tac gia"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                    Nha xuat ban
                  </label>
                  <input
                    value={editForm.publisher_name}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, publisher_name: event.target.value }))}
                    placeholder="Nhap ten nha xuat ban"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                    The loai
                  </label>
                  <input
                    value={editForm.category_name}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, category_name: event.target.value }))}
                    placeholder="Nhap the loai"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="block text-[12px] font-semibold text-slate-700 uppercase tracking-[0.02em]">
                      ISBN / Barcode
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleApplyAiMetadata()}
                      disabled={isApplyingAiMetadata}
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 transition-colors disabled:opacity-60"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {isApplyingAiMetadata ? "Dang lay AI..." : "Dien metadata + mo ta AI"}
                    </button>
                  </div>
                  <input
                    value={editForm.isbn_or_barcode}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, isbn_or_barcode: event.target.value }))}
                    placeholder="Nhap ISBN hoac barcode"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 font-mono text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                    Ngon ngu
                  </label>
                  <input
                    value={editForm.language}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, language: event.target.value }))}
                    placeholder="vd: vi, en"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                    Nam xuat ban
                  </label>
                  <input
                    value={editForm.publish_year}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, publish_year: event.target.value }))}
                    placeholder="vd: 2024"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                    type="number"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                    Gia ban (VND)
                  </label>
                  <input
                    value={editForm.list_price}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, list_price: event.target.value }))}
                    placeholder="Nhap gia ban"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                    type="number"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                    Gia nhap (VND)
                  </label>
                  <input
                    value={editForm.unit_cost}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, unit_cost: event.target.value }))}
                    placeholder="Nhap gia nhap"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                    type="number"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-2 uppercase tracking-[0.02em]">
                  Anh bia sach
                </label>
                <div className="flex items-center gap-2">
                  <input
                    value={editForm.cover_image_url}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, cover_image_url: event.target.value }))}
                    placeholder="https://example.com/cover.jpg hoac tai anh len"
                    className="flex-1 rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                  />
                  <label className="shrink-0 flex items-center justify-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">
                    <Upload className="w-4 h-4" /> Tai len
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 5 * 1024 * 1024) {
                            toast.error("Anh qua lon (toi da 5MB)");
                            return;
                          }
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setEditForm((prev) => ({ ...prev, cover_image_url: reader.result as string }));
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                </div>
                {editForm.cover_image_url && (
                  <div className="mt-2 px-3 py-2 rounded-[10px] bg-blue-50 border border-blue-100 flex items-center justify-between">
                    <img
                      src={editForm.cover_image_url}
                      alt="Cover preview"
                      className="max-w-full max-h-32 rounded object-contain"
                      onError={() => {
                        /* Handle image load error */
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, cover_image_url: "" }))}
                      className="text-[12px] text-red-500 hover:underline font-semibold"
                    >
                      Xoa
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-[12px] font-semibold text-slate-700 uppercase tracking-[0.02em]">
                    Mo ta
                  </label>
                </div>
                <textarea
                  value={editForm.description}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows={4}
                  placeholder="Nhap mo ta chi tiet ve sach"
                  className="w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10 resize-none"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-[12px] font-semibold text-slate-700 uppercase tracking-[0.02em]">
                    Summary TIeng Viet (AI)
                  </label>
                </div>
                <textarea
                  value={editForm.summary_vi}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, summary_vi: event.target.value }))}
                  rows={5}
                  placeholder="Nhap hoac chinh sua summary TIeng Viet"
                  className="w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10 resize-none"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="flex-1 rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Huy
              </button>
              <button
                type="button"
                onClick={() => void handleSaveBook()}
                disabled={isSaving || isApplyingAiMetadata}
                className="flex flex-1 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60 hover:shadow-md transition-shadow"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSaving ? "Dang luu" : "Luu thay doi"}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </PageWrapper>
  );
}
