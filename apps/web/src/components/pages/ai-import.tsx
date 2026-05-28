import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { BookCheck, Loader2, ScanBarcode, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { aiService, type LookupBookByIsbnResponse } from "@/services/ai";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api";

interface EditableBookForm {
  isbn: string;
  isbn13: string;
  isbn10: string;
  title: string;
  subtitle: string;
  authorsText: string;
  publisher: string;
  publishedDate: string;
  description: string;
  categoriesText: string;
  language: string;
  pageCount: string;
  thumbnail: string;
  summaryVi: string;
  keywordsText: string;
}

const EMPTY_FORM: EditableBookForm = {
  isbn: "",
  isbn13: "",
  isbn10: "",
  title: "",
  subtitle: "",
  authorsText: "",
  publisher: "",
  publishedDate: "",
  description: "",
  categoriesText: "",
  language: "vi",
  pageCount: "",
  thumbnail: "",
  summaryVi: "",
  keywordsText: "",
};

function normalizeIsbnInput(value: string): string {
  const cleaned = String(value || "").trim().replace(/[^0-9Xx]/g, "");
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 9)}${cleaned.slice(9).toUpperCase()}`;
  }
  return cleaned;
}

function parsePublishYear(publishedDate: string): number | undefined {
  const matched = String(publishedDate || "").match(/\b(\d{4})\b/);
  if (!matched) return undefined;
  const year = Number(matched[1]);
  if (!Number.isInteger(year) || year < 1000 || year > 2100) return undefined;
  return year;
}

function mapLookupToForm(data: LookupBookByIsbnResponse): EditableBookForm {
  return {
    isbn: data.isbn || "",
    isbn13: data.isbn13 || "",
    isbn10: data.isbn10 || "",
    title: data.title || "",
    subtitle: data.subtitle || "",
    authorsText: (data.authors || []).join(", "),
    publisher: data.publisher || "",
    publishedDate: data.publishedDate || "",
    description: data.description || "",
    categoriesText: (data.categories || []).join(", "),
    language: data.language || "vi",
    pageCount: data.pageCount != null ? String(data.pageCount) : "",
    thumbnail: data.thumbnail || "",
    summaryVi: data.summaryVi || "",
    keywordsText: (data.keywords || []).join(", "),
  };
}

export function AIImportPage() {
  const [isbnInput, setIsbnInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [lookupData, setLookupData] = useState<LookupBookByIsbnResponse | null>(null);
  const [form, setForm] = useState<EditableBookForm>(EMPTY_FORM);

  const [summaryLoading, setSummaryLoading] = useState(false);

  const manualMode = Boolean(lookupData && !lookupData.found);

  const confidenceText = useMemo(() => {
    const confidence = lookupData?.confidence?.overall;
    if (typeof confidence !== "number") return "-";
    return `${Math.round(confidence * 100)}%`;
  }, [lookupData]);

  async function handleLookup(rawInput?: string) {
    const normalized = normalizeIsbnInput(rawInput ?? isbnInput);
    if (!normalized) {
      toast.error("Vui lòng nhập ISBN");
      return;
    }

    setLookupLoading(true);
    try {
      // Lookup nhanh: không chờ Ollama/Groq sinh summary
      const result = await aiService.lookupBookByIsbn({
        isbn: normalized,
        generateVietnameseSummary: false,
      });

      setIsbnInput(normalized);
      setLookupData(result);

      if (result.found) {
        setForm(mapLookupToForm(result));
        toast.success("Đã tìm thấy metadata sách");
      } else {
        setForm({
          ...EMPTY_FORM,
          isbn: result.isbn || normalized,
          isbn13: result.isbn13 || (normalized.length === 13 ? normalized : ""),
          isbn10: result.isbn10 || (normalized.length === 10 ? normalized : ""),
        });
        toast.info("Không tìm thấy metadata. Chuyển sang nhập tay.");
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tra cứu ISBN thất bại"));
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleGenerateDescription() {
    if (!form.title.trim()) {
      toast.error("Cần có tên sách trước khi tạo mô tả AI");
      return;
    }
    setSummaryLoading(true);
    try {
      const result = await aiService.generateSummaryVi({
        title: form.title.trim(),
        author: form.authorsText.split(",")[0].trim(),
        publisher: form.publisher || undefined,
        description: "",
        categories: form.categoriesText.split(",").map((c) => c.trim()).filter(Boolean),
      });
      setForm((prev) => ({
        ...prev,
        description: result.summaryVi || prev.description,
        keywordsText: (result.keywords || []).join(", ") || prev.keywordsText,
      }));
      toast.success(`Đã tạo mô tả AI (${result.ai_provider === "groq" ? "Groq" : "Ollama"})`);
    } catch {
      toast.error("Không thể tạo mô tả. Vui lòng thử lại.");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleSave() {
    const normalizedIsbn = normalizeIsbnInput(form.isbn || isbnInput);
    const title = form.title.trim();
    if (!normalizedIsbn) {
      toast.error("ISBN là bắt buộc");
      return;
    }
    if (!title) {
      toast.error("Tên sách là bắt buộc");
      return;
    }

    const authors = form.authorsText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const categories = form.categoriesText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const created = await bookService.createIncomplete({
        isbn13: normalizedIsbn,
        title,
        price: 0,
        language: (form.language || "vi").trim() || "vi",
      });

      const payload = created?.data;
      if (!payload?.book_id) {
        toast.error("Không lấy được book id để cập nhật metadata");
        return;
      }

      const updatePayload: Record<string, unknown> = {
        title,
        subtitle: form.subtitle.trim() || null,
        author_name: authors[0] || null,
        publisher_name: form.publisher.trim() || null,
        category_name: categories[0] || null,
        description: form.description.trim() || null,
        summary_vi: form.summaryVi.trim() || null,
        language: (form.language || "vi").trim() || "vi",
        internal_barcode: normalizedIsbn,
      };

      const isbn13 = normalizeIsbnInput(form.isbn13 || "");
      const isbn10 = normalizeIsbnInput(form.isbn10 || "");
      if (isbn13.length === 13) updatePayload.isbn13 = isbn13;
      if (isbn10.length === 10) updatePayload.isbn10 = isbn10;

      const year = parsePublishYear(form.publishedDate);
      if (year) updatePayload.publish_year = year;

      if (form.thumbnail.trim()) updatePayload.cover_image_url = form.thumbnail.trim();

      await bookService.update(String(payload.book_id), updatePayload);
      toast.success("Đã lưu sách với metadata ISBN");

      setLookupData(null);
      setForm(EMPTY_FORM);
      setIsbnInput("");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lưu thông tin sách thất bại"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-cyan-200/40 bg-gradient-to-br from-cyan-100 to-blue-50">
            <Sparkles className="h-5 w-5 text-cyan-600" />
          </div>
          <div>
            <h1 className="tracking-[-0.02em]">Nhập sách qua AI</h1>
            <p className="mt-0.5 text-[12px] text-slate-400">Quét mã vạch hoặc nhập ISBN để tự động điền metadata</p>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-400">Bước 1 — Tra cứu</div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-500" />
              <input
                value={isbnInput}
                onChange={(event) => setIsbnInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleLookup();
                  }
                }}
                placeholder="Nhập hoặc quét ISBN-10 / ISBN-13"
                className="w-full rounded-[12px] border-2 border-cyan-300/40 bg-gradient-to-r from-cyan-50/30 to-blue-50/30 py-2.5 pl-10 pr-4 text-[13px] outline-none transition-all focus:border-cyan-400/60 focus:ring-[3px] focus:ring-cyan-500/10"
              />
            </div>

            <button
              onClick={() => void handleLookup()}
              disabled={lookupLoading}
              className="inline-flex items-center gap-2 rounded-[12px] bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {lookupLoading ? "Đang tra cứu" : "Tra cứu"}
            </button>

            <button
              onClick={() => setShowScanner(true)}
              disabled={lookupLoading}
              className="inline-flex items-center gap-2 rounded-[12px] border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[13px] font-semibold text-indigo-700"
            >
              <ScanBarcode className="h-4 w-4" />
              Quét camera
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Hỗ trợ scanner có khoảng trắng/dấu gạch ngang — hệ thống sẽ tự động chuẩn hóa.</p>
        </div>
      </FadeItem>

      {lookupData ? (
        <FadeItem>
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-400">Bước 2 — Xem & sửa</div>
                <h3 className="text-[15px] font-semibold text-slate-800">
                  {lookupData.found ? "Đã tìm thấy metadata" : "Không tìm thấy metadata"}
                </h3>
              </div>
              <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-right text-[11px] text-slate-500">
                <div>Độ tin cậy: <span className="font-semibold text-slate-700">{confidenceText}</span></div>
                <div>
                  Nguồn:{" "}
                  {(() => {
                    const labels = [
                      lookupData.source.googleBooks && "Google",
                      lookupData.source.openLibrary && "OpenLibrary",
                      lookupData.source.worldCat && "WorldCat",
                      lookupData.source.fahasa && "Fahasa",
                      lookupData.source.tiki && "Tiki",
                      lookupData.source.vinabook && "Vinabook",
                      lookupData.source.webSearch && "Web",
                    ].filter(Boolean) as string[];
                    return labels.length > 0 ? labels.join(", ") : "Thủ công";
                  })()}
                </div>
              </div>
            </div>

            {manualMode ? (
              <div className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                Không tìm thấy metadata từ nhà cung cấp. Vui lòng nhập tay thông tin sách, ISBN đã được giữ lại.
              </div>
            ) : null}

            {lookupData?.reason === "barcode is not a valid ISBN but marketplace lookup attempted" ? (
              <div className="mb-4 rounded-[10px] border border-yellow-200 bg-yellow-50 px-3 py-2 text-[12px] text-yellow-700">
                Mã quét có thể là barcode bán lẻ, không phải ISBN chuẩn. Kết quả được tìm từ nhà sách trực tuyến.
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">ISBN</label>
                <input value={form.isbn} onChange={(e) => setForm((prev) => ({ ...prev, isbn: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] font-mono" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">Tên sách</label>
                <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">Tựa phụ</label>
                <input value={form.subtitle} onChange={(e) => setForm((prev) => ({ ...prev, subtitle: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">Tác giả (cách nhau dấu phẩy)</label>
                <input value={form.authorsText} onChange={(e) => setForm((prev) => ({ ...prev, authorsText: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">Nhà xuất bản</label>
                <input value={form.publisher} onChange={(e) => setForm((prev) => ({ ...prev, publisher: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">Ngày xuất bản</label>
                <input value={form.publishedDate} onChange={(e) => setForm((prev) => ({ ...prev, publishedDate: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">Thể loại (cách nhau dấu phẩy)</label>
                <input value={form.categoriesText} onChange={(e) => setForm((prev) => ({ ...prev, categoriesText: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">Ngôn ngữ</label>
                <input value={form.language} onChange={(e) => setForm((prev) => ({ ...prev, language: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">ISBN13</label>
                <input value={form.isbn13} onChange={(e) => setForm((prev) => ({ ...prev, isbn13: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] font-mono" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">ISBN10</label>
                <input value={form.isbn10} onChange={(e) => setForm((prev) => ({ ...prev, isbn10: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] font-mono" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">Số trang</label>
                <input value={form.pageCount} onChange={(e) => setForm((prev) => ({ ...prev, pageCount: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">URL ảnh bìa</label>
                <input value={form.thumbnail} onChange={(e) => setForm((prev) => ({ ...prev, thumbnail: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-500">Mô tả</label>
                  {!form.description.trim() && (
                    <button
                      onClick={() => void handleGenerateDescription()}
                      disabled={summaryLoading || !form.title.trim()}
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[11px] font-semibold text-cyan-700 transition-colors hover:border-cyan-300 hover:bg-cyan-100 disabled:opacity-40"
                    >
                      {summaryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {summaryLoading ? "Đang tạo..." : "Tạo mô tả AI"}
                    </button>
                  )}
                </div>
                <textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} rows={4} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">Từ khóa (cách nhau dấu phẩy)</label>
                <input value={form.keywordsText} onChange={(e) => setForm((prev) => ({ ...prev, keywordsText: e.target.value }))} className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px]" />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setLookupData(null);
                  setForm(EMPTY_FORM);
                  setIsbnInput("");
                }}
                disabled={saving}
                className="rounded-[10px] border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700"
              >
                Đặt lại
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookCheck className="h-4 w-4" />}
                {saving ? "Đang lưu" : "Lưu sách"}
              </button>
            </div>
          </motion.div>
        </FadeItem>
      ) : null}

      <BarcodeScanModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onDetected={(code) => {
          setShowScanner(false);
          setIsbnInput(code);
          void handleLookup(code);
        }}
        title="Quét ISBN"
      />
    </PageWrapper>
  );
}
