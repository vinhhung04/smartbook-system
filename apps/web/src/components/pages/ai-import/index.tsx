import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../../motion-utils";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { aiService, type EnrichMode, type LookupBookByIsbnResponse, type PostIsbnAiSuggestions } from "@/services/ai";
import { bookService } from "@/services/book";
import { metadataIntelligenceService, type DuplicateDecisionResult, type DuplicateReview, type ReconciliationDraft } from "@/services/metadata-intelligence";
import { getApiErrorMessage } from "@/services/api";
import { BookInfoTab } from "./book-info-tab";
import { EmptyLookupState } from "./empty-state";
import { IsbnLookupProgress } from "./isbn-lookup-progress";
import { LookupSearchCard } from "./lookup-search-card";
import { MetadataFoundHero } from "./metadata-found-hero";
import { MetadataReadiness } from "./metadata-readiness";
import { ReviewTab } from "./review-tab";
import { StickyFooter } from "./sticky-footer";
import { EMPTY_FORM, type AiFieldCandidates, type AiFieldKey, type CatalogBookLite, type EditableBookForm } from "./types";
import {
  buildDuplicateCheckMetadata,
  finalMetadataFromForm,
  findDuplicateMatches,
  mapLookupToForm,
  mergeCommaText,
  normalizeIsbnInput,
  parsePublishYear,
  reconciliationValueFromForm,
  splitCommaValues,
} from "./utils";

const EMPTY_AI_FIELD_CANDIDATES: AiFieldCandidates = { description: null, summaryVi: null, keywords: null, categories: null };
const EMPTY_AI_FIELD_LOADING: Record<AiFieldKey, boolean> = { description: false, summaryVi: false, keywords: false, categories: false };

export function AIImportPage() {
  const shouldReduceMotion = useReducedMotion();
  const [isbnInput, setIsbnInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [lookupData, setLookupData] = useState<LookupBookByIsbnResponse | null>(null);
  const [postIsbnSuggestions, setPostIsbnSuggestions] = useState<PostIsbnAiSuggestions | null>(null);
  const [reconciliationDraft, setReconciliationDraft] = useState<ReconciliationDraft | null>(null);
  const [createAuthorityEntities, setCreateAuthorityEntities] = useState<Record<string, boolean>>({});
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReview | null>(null);
  const [duplicateDecisionResult, setDuplicateDecisionResult] = useState<DuplicateDecisionResult | null>(null);
  const [form, setForm] = useState<EditableBookForm>(EMPTY_FORM);

  const [aiFieldCandidates, setAiFieldCandidates] = useState<AiFieldCandidates>(EMPTY_AI_FIELD_CANDIDATES);
  const [aiFieldLoading, setAiFieldLoading] = useState<Record<AiFieldKey, boolean>>(EMPTY_AI_FIELD_LOADING);
  const [qualityCheckLoading, setQualityCheckLoading] = useState(false);
  const [qualityCheckResult, setQualityCheckResult] = useState<{ provider: string; warnings: string[] } | null>(null);

  const [catalogBooks, setCatalogBooks] = useState<CatalogBookLite[]>([]);
  const [confirmDuplicateSave, setConfirmDuplicateSave] = useState(false);
  const [activeReviewId, setActiveReviewId] = useState<"duplicate" | "authority" | "evidence" | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"book" | "review">("book");
  const initializedTabForLookup = useRef<LookupBookByIsbnResponse | null>(null);

  const [confirmEntityField, setConfirmEntityField] = useState<string | null>(null);
  const [confirmEntityLoading, setConfirmEntityLoading] = useState(false);
  const [confirmDuplicateAction, setConfirmDuplicateAction] = useState<{ action: string; candidate?: DuplicateReview["candidates"][number] } | null>(null);
  const [confirmDuplicateActionLoading, setConfirmDuplicateActionLoading] = useState(false);

  // Loaded once for two AI-assist features: matching category suggestions against the
  // real catalog, and warning about likely duplicate books before save.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await bookService.getAll();
        const rows = (Array.isArray(response) ? response : []).map((row: unknown) => {
          const book = row as Partial<Record<"id" | "title" | "author" | "isbn" | "category", unknown>>;
          return {
            id: String(book.id || ""),
            title: String(book.title || ""),
            author: String(book.author || ""),
            isbn: String(book.isbn || ""),
            category: String(book.category || ""),
          };
        });
        if (!cancelled) setCatalogBooks(rows);
      } catch {
        // Non-critical: category suggestions and duplicate check just degrade gracefully.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    catalogBooks.forEach((book) => {
      const trimmed = book.category.trim();
      if (trimmed) set.add(trimmed);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogBooks]);

  const duplicateMatches = useMemo(
    () => findDuplicateMatches(form, catalogBooks),
    [form, catalogBooks],
  );

  useEffect(() => {
    setConfirmDuplicateSave(false);
  }, [duplicateMatches.length]);

  const manualMode = Boolean(lookupData && !lookupData.found);

  const sourceCount = useMemo(() => {
    if (!lookupData) return 0;
    const keys = ["googleBooks", "openLibrary", "worldCat", "fahasa", "tiki", "vinabook", "webSearch"] as const;
    return keys.filter((key) => lookupData.source[key]).length;
  }, [lookupData]);

  const hasPostIsbnSuggestions = Boolean(
    postIsbnSuggestions
      && (
        postIsbnSuggestions.description
        || postIsbnSuggestions.summaryVi
        || postIsbnSuggestions.keywords.length > 0
        || postIsbnSuggestions.categories.length > 0
        || postIsbnSuggestions.qualityWarnings.length > 0
      ),
  );
  const aiSuggestionCount = useMemo(
    () => (Object.values(aiFieldCandidates) as (AiFieldCandidates[AiFieldKey])[]).filter((candidate) => Boolean(candidate?.value.trim())).length,
    [aiFieldCandidates],
  );
  const reviewSignals = useMemo(() => {
    const isbn = normalizeIsbnInput(form.isbn || form.isbn13 || form.isbn10);
    const hasTitle = Boolean(form.title.trim());
    const hasAuthor = Boolean(form.authorsText.trim());
    const hasDescription = Boolean(form.description.trim() || aiFieldCandidates.description?.value.trim());
    return [
      {
        label: "ISBN",
        detail: isbn ? `Sẵn sàng kiểm duplicate: ${isbn}` : "Thiếu ISBN, chưa thể lưu",
        complete: Boolean(isbn),
        fieldId: "isbn",
      },
      {
        label: "Nhan đề",
        detail: hasTitle ? "Đã có tên sách để catalog" : "Cần tên sách trước khi lưu",
        complete: hasTitle,
        fieldId: "title",
      },
      {
        label: "Tác giả",
        detail: hasAuthor ? "Có dữ liệu tác giả để tìm kiếm" : "Nên bổ sung tác giả nếu lookup thiếu",
        complete: hasAuthor,
        fieldId: "authors",
      },
      {
        label: "Mô tả",
        detail: hasDescription ? "Có mô tả hoặc đề xuất AI chờ duyệt" : "Có thể dùng AI để tạo mô tả",
        complete: hasDescription,
        fieldId: "description",
      },
    ];
  }, [form.authorsText, form.description, form.isbn, form.isbn10, form.isbn13, form.title, aiFieldCandidates.description]);
  const completeSignalCount = reviewSignals.filter((signal) => signal.complete).length;
  const authorityNeedsReview = Boolean(
    reconciliationDraft
      && (reconciliationDraft.decisions.length === 0 || reconciliationDraft.decisions.some((item) => item.status === "PENDING")),
  );
  const duplicateNeedsReview = Boolean(duplicateReview && duplicateReview.classification !== "NEW_TITLE");
  const evidenceNeedsReview = Boolean(lookupData?.conflicts?.length);
  const catalogDuplicateNeedsReview = duplicateMatches.length > 0 && !confirmDuplicateSave;
  const reviewIssueCount = [duplicateNeedsReview, authorityNeedsReview, evidenceNeedsReview, catalogDuplicateNeedsReview].filter(Boolean).length;

  useEffect(() => {
    if (duplicateNeedsReview) {
      setActiveReviewId("duplicate");
      return;
    }
    if (authorityNeedsReview) {
      setActiveReviewId("authority");
      return;
    }
    if (evidenceNeedsReview) {
      setActiveReviewId("evidence");
      return;
    }
    setActiveReviewId(null);
  }, [duplicateNeedsReview, authorityNeedsReview, evidenceNeedsReview, lookupData?.isbn]);

  useEffect(() => {
    if (!lookupData) {
      initializedTabForLookup.current = null;
      setActiveWorkspaceTab("book");
      return;
    }
    if (initializedTabForLookup.current === lookupData) return;
    initializedTabForLookup.current = lookupData;
    setActiveWorkspaceTab(reviewIssueCount > 0 ? "review" : "book");
  }, [lookupData, reviewIssueCount]);

  async function handleLookup(rawInput?: string) {
    const normalized = normalizeIsbnInput(rawInput ?? isbnInput);
    if (!normalized) {
      toast.error("Vui lòng nhập ISBN");
      return;
    }

    setLookupLoading(true);
    setPostIsbnSuggestions(null);
    setReconciliationDraft(null);
    setCreateAuthorityEntities({});
    setDuplicateReview(null);
    setDuplicateDecisionResult(null);
    setAiFieldCandidates(EMPTY_AI_FIELD_CANDIDATES);
    setQualityCheckResult(null);
    try {
      const result = await aiService.enrichBookAfterIsbn({
        isbn: normalized,
        existingCategories,
      });
      const lookup = result.lookup;

      setIsbnInput(normalized);
      setLookupData(lookup);
      setPostIsbnSuggestions(result.aiSuggestions);
      setAiFieldCandidates({
        description: result.aiSuggestions.description ? { value: result.aiSuggestions.description, source: "postIsbn" } : null,
        summaryVi: result.aiSuggestions.summaryVi ? { value: result.aiSuggestions.summaryVi, source: "postIsbn" } : null,
        keywords: result.aiSuggestions.keywords.length > 0 ? { value: result.aiSuggestions.keywords.join(", "), source: "postIsbn" } : null,
        categories: result.aiSuggestions.categories.length > 0 ? { value: result.aiSuggestions.categories.join(", "), source: "postIsbn" } : null,
      });

      if (lookup.found) {
        setForm(mapLookupToForm(lookup));
        try {
          const draft = await metadataIntelligenceService.createReconciliationDraft(lookup, result.aiSuggestions);
          setReconciliationDraft(draft);
          const duplicate = await metadataIntelligenceService.checkDuplicate(buildDuplicateCheckMetadata({ lookup, normalizedMetadata: draft.normalized_metadata, form: mapLookupToForm(lookup) }));
          setDuplicateReview(duplicate);
          const draftNeedsReview = draft.decisions.length === 0 || draft.decisions.some((item) => item.status === "PENDING");
          const duplicateRequiresAction = duplicate.classification !== "NEW_TITLE";
          setActiveWorkspaceTab(draftNeedsReview || duplicateRequiresAction || Boolean(lookup.conflicts?.length) ? "review" : "book");
          initializedTabForLookup.current = lookup;
        } catch {
          // Catalog intelligence is additive: ISBN lookup remains usable when its review APIs are unavailable.
          toast.info("Không thể tải review catalog lúc này; bạn vẫn có thể kiểm tra metadata thủ công.");
        }
        if (result.aiSuggestions.provider && result.aiSuggestions.provider !== "none") {
          toast.success("Đã tìm thấy metadata và AI đã tạo đề xuất hậu xử lý");
        } else {
          toast.success("Đã tìm thấy metadata sách");
        }
      } else {
        setForm({
          ...EMPTY_FORM,
          isbn: lookup.isbn || normalized,
          isbn13: lookup.isbn13 || (normalized.length === 13 ? normalized : ""),
          isbn10: lookup.isbn10 || (normalized.length === 10 ? normalized : ""),
        });
        toast.info("Không tìm thấy metadata. Chuyển sang nhập tay.");
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tra cứu ISBN thất bại"));
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleAuthorityDecision(field: string, status: "ACCEPTED" | "REJECTED") {
    if (!reconciliationDraft) return;
    try {
      const value = status === "ACCEPTED" ? reconciliationValueFromForm(field, form) : undefined;
      const decision = await metadataIntelligenceService.decideField(reconciliationDraft.id, field, status, value);
      setReconciliationDraft((current) => current ? {
        ...current,
        decisions: current.decisions.map((item) => item.field === field ? { ...item, status: decision.status, value: decision.value } : item),
      } : current);
      toast.success(status === "ACCEPTED" ? "Đã chấp nhận đề xuất" : "Đã từ chối đề xuất");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể lưu quyết định metadata"));
    }
  }

  function handleCreateAuthorityEntity(field: string) {
    setConfirmEntityField(field);
  }

  async function confirmCreateAuthorityEntity() {
    const field = confirmEntityField;
    if (!field) return;
    setConfirmEntityLoading(true);
    try {
      setCreateAuthorityEntities((current) => ({ ...current, [field]: true }));
      await handleAuthorityDecision(field, "ACCEPTED");
    } finally {
      setConfirmEntityLoading(false);
      setConfirmEntityField(null);
    }
  }

  async function runDuplicateAction(action: string, candidate?: DuplicateReview["candidates"][number]) {
    if (!duplicateReview) return;
    try {
      const variantId = candidate?.variantIds[0];
      const result = await metadataIntelligenceService.decideDuplicate(duplicateReview.id, action, {
        ...(action === "LINK_EXISTING_VARIANT" && variantId ? { selectedVariantId: variantId } : {}),
        ...(["CREATE_VARIANT_FOR_EDITION", "CREATE_NEW_EDITION"].includes(action) && candidate ? { selectedBookId: candidate.bookId } : {}),
      });
      toast.success(action === "DISMISS_WARNING" ? "Đã ghi nhận quyết định bỏ qua cảnh báo duplicate" : "Đã lưu quyết định duplicate; chỉ metadata được duyệt mới được áp dụng.");
      setDuplicateReview(null);
      setDuplicateDecisionResult(result);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể lưu quyết định duplicate"));
    }
  }

  function handleDuplicateAction(action: string, candidate?: DuplicateReview["candidates"][number]) {
    if (["CREATE_VARIANT_FOR_EDITION", "CREATE_NEW_EDITION", "CREATE_NEW_TITLE"].includes(action)) {
      setConfirmDuplicateAction({ action, candidate });
      return;
    }
    void runDuplicateAction(action, candidate);
  }

  async function confirmRunDuplicateAction() {
    if (!confirmDuplicateAction) return;
    setConfirmDuplicateActionLoading(true);
    try {
      await runDuplicateAction(confirmDuplicateAction.action, confirmDuplicateAction.candidate);
    } finally {
      setConfirmDuplicateActionLoading(false);
      setConfirmDuplicateAction(null);
    }
  }

  async function regenerateAiField(field: AiFieldKey) {
    if (!form.title.trim()) {
      toast.error("Cần có tên sách để sử dụng công cụ AI");
      return;
    }
    setAiFieldLoading((prev) => ({ ...prev, [field]: true }));
    try {
      if (field === "description") {
        if (!form.description.trim()) {
          const result = await aiService.generateSummaryVi({
            title: form.title.trim(),
            author: form.authorsText.split(",")[0].trim(),
            publisher: form.publisher || undefined,
            description: form.description,
            categories: form.categoriesText.split(",").map((c) => c.trim()).filter(Boolean),
          });
          setAiFieldCandidates((prev) => ({
            ...prev,
            description: result.summaryVi ? { value: result.summaryVi, source: "generated" } : prev.description,
            keywords: result.keywords?.length ? { value: result.keywords.join(", "), source: "generated" } : prev.keywords,
          }));
          toast.success(`Đã tạo mô tả AI (${result.ai_provider === "anthropic" ? "Anthropic" : "Ollama"})`);
        } else {
          const result = await aiService.enrichBookMetadata({
            title: form.title.trim(),
            authors: form.authorsText.split(",").map((a) => a.trim()).filter(Boolean),
            publisher: form.publisher || undefined,
            description: form.description || undefined,
            categories: form.categoriesText.split(",").map((c) => c.trim()).filter(Boolean),
            mode: "normalize_description",
          });
          if (result.normalizedDescription) {
            setAiFieldCandidates((prev) => ({ ...prev, description: { value: result.normalizedDescription!, source: "generated" } }));
            toast.success("Đã tạo mô tả chuẩn hóa");
          } else {
            toast.warning(result.qualityWarnings[0] || "AI không tạo được mô tả mới");
          }
        }
        return;
      }

      const modeByField: Record<Exclude<AiFieldKey, "description">, EnrichMode> = {
        summaryVi: "short_summary",
        keywords: "keywords",
        categories: "suggest_categories",
      };
      const result = await aiService.enrichBookMetadata({
        title: form.title.trim(),
        authors: form.authorsText.split(",").map((a) => a.trim()).filter(Boolean),
        publisher: form.publisher || undefined,
        description: form.description || undefined,
        categories: form.categoriesText.split(",").map((c) => c.trim()).filter(Boolean),
        existingCategories: field === "categories" ? existingCategories : undefined,
        mode: modeByField[field],
      });

      if (field === "summaryVi" && result.shortSummary) {
        setAiFieldCandidates((prev) => ({ ...prev, summaryVi: { value: result.shortSummary!, source: "generated" } }));
        toast.success("Đã tạo tóm tắt ngắn AI");
      } else if (field === "keywords" && result.keywords.length > 0) {
        const sanitized = [...new Set(result.keywords.map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= 50))].slice(0, 15);
        setAiFieldCandidates((prev) => ({ ...prev, keywords: { value: sanitized.join(", "), source: "generated" } }));
        toast.success("Đã tạo từ khóa AI");
      } else if (field === "categories" && result.suggestedCategories.length > 0) {
        setAiFieldCandidates((prev) => ({ ...prev, categories: { value: result.suggestedCategories.join(", "), source: "generated" } }));
        toast.success("Đã tạo thể loại AI");
      } else {
        toast.warning(result.qualityWarnings[0] || "AI không tạo được kết quả");
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Công cụ AI gặp lỗi, vui lòng thử lại"));
    } finally {
      setAiFieldLoading((prev) => ({ ...prev, [field]: false }));
    }
  }

  function applyAiFieldCandidate(field: AiFieldKey) {
    const candidate = aiFieldCandidates[field];
    if (!candidate || !candidate.value.trim()) return;
    if (field === "description") {
      setForm((prev) => ({ ...prev, description: candidate.value }));
      toast.success("Đã áp dụng mô tả AI");
    } else if (field === "summaryVi") {
      setForm((prev) => ({ ...prev, summaryVi: candidate.value }));
      toast.success("Đã áp dụng tóm tắt AI");
    } else if (field === "keywords") {
      setForm((prev) => ({ ...prev, keywordsText: mergeCommaText(prev.keywordsText, splitCommaValues(candidate.value)) }));
      toast.success("Đã thêm từ khóa AI");
    } else if (field === "categories") {
      setForm((prev) => ({ ...prev, categoriesText: mergeCommaText(prev.categoriesText, splitCommaValues(candidate.value)) }));
      toast.success("Đã thêm thể loại AI");
    }
  }

  function applyAllAiFieldCandidates() {
    const hasAny = Object.values(aiFieldCandidates).some((candidate) => candidate?.value.trim());
    if (!hasAny) return;
    setForm((prev) => ({
      ...prev,
      description: aiFieldCandidates.description?.value.trim() || prev.description,
      summaryVi: aiFieldCandidates.summaryVi?.value.trim() || prev.summaryVi,
      keywordsText: aiFieldCandidates.keywords?.value.trim()
        ? mergeCommaText(prev.keywordsText, splitCommaValues(aiFieldCandidates.keywords.value))
        : prev.keywordsText,
      categoriesText: aiFieldCandidates.categories?.value.trim()
        ? mergeCommaText(prev.categoriesText, splitCommaValues(aiFieldCandidates.categories.value))
        : prev.categoriesText,
    }));
    toast.success("Đã áp dụng tất cả đề xuất AI");
  }

  async function handleQualityCheck() {
    if (!form.title.trim()) {
      toast.error("Cần có tên sách để sử dụng công cụ AI");
      return;
    }
    setQualityCheckLoading(true);
    setQualityCheckResult(null);
    try {
      const result = await aiService.enrichBookMetadata({
        title: form.title.trim(),
        authors: form.authorsText.split(",").map((a) => a.trim()).filter(Boolean),
        publisher: form.publisher || undefined,
        description: form.description || undefined,
        categories: form.categoriesText.split(",").map((c) => c.trim()).filter(Boolean),
        mode: "quality_check",
      });
      setQualityCheckResult({ provider: result.ai_provider, warnings: result.qualityWarnings });
      if (result.qualityWarnings.length === 0) toast.success("Metadata đạt chất lượng tốt");
      else toast.warning(result.qualityWarnings[0]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Công cụ AI gặp lỗi, vui lòng thử lại"));
    } finally {
      setQualityCheckLoading(false);
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
    if (duplicateMatches.length > 0 && !confirmDuplicateSave) {
      toast.error("Sách này có thể đã tồn tại trong catalog. Vui lòng xác nhận ở cảnh báo bên dưới trước khi lưu.");
      return;
    }
    if (reconciliationDraft?.decisions.some((item) => item.status === "PENDING")) {
      toast.error("Vui lòng hoàn tất các quyết định metadata trước khi lưu.");
      return;
    }
    if (duplicateReview && duplicateReview.classification !== "NEW_TITLE") {
      toast.error("Vui lòng xử lý duplicate review trước khi lưu.");
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

      const pageCountNum = parseInt(form.pageCount, 10);
      if (form.pageCount && !isNaN(pageCountNum) && pageCountNum > 0) {
        updatePayload.page_count = pageCountNum;
      }

      const keywords = form.keywordsText
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0 && k.length <= 50);
      const uniqueKeywords = [...new Set(keywords)].slice(0, 15);
      if (uniqueKeywords.length > 0) {
        updatePayload.keywords = uniqueKeywords;
      }

      let savedBookId: string;
      let appendSnapshot = false;
      if (reconciliationDraft) {
        const duplicateAction = duplicateDecisionResult?.review.decision;
        const result = await metadataIntelligenceService.applyReconciliationDraft(reconciliationDraft.id, {
          bookId: duplicateDecisionResult?.book?.id || duplicateDecisionResult?.review.selected_book_id || undefined,
          variantId: duplicateDecisionResult?.variant?.id || duplicateDecisionResult?.review.selected_variant_id || undefined,
          createEntities: createAuthorityEntities,
          finalMetadata: finalMetadataFromForm(form),
          duplicateReviewId: duplicateDecisionResult?.review.id,
        });
        savedBookId = result.book.id;
        appendSnapshot = duplicateAction !== "LINK_EXISTING_VARIANT";
      } else {
        const created = await bookService.createIncomplete({ isbn13: normalizedIsbn, title, price: 0, language: (form.language || "vi").trim() || "vi" });
        const payload = created?.data;
        if (!payload?.book_id) throw new Error("Không lấy được book id để cập nhật metadata");
        savedBookId = String(payload.book_id);
        appendSnapshot = Boolean(payload.created_new);
        await bookService.update(savedBookId, updatePayload);
      }
      toast.success("Đã lưu sách với metadata ISBN");

      // Keep the local catalog snapshot in sync so the duplicate check catches
      // this book if the user immediately tries to import it again this session.
      if (appendSnapshot) setCatalogBooks((prev) => [...prev, { id: savedBookId, title, author: authors[0] || "", isbn: normalizedIsbn, category: categories[0] || "" }]);

      setLookupData(null);
      setPostIsbnSuggestions(null);
      setReconciliationDraft(null);
      setCreateAuthorityEntities({});
      setDuplicateReview(null);
      setDuplicateDecisionResult(null);
      setAiFieldCandidates(EMPTY_AI_FIELD_CANDIDATES);
      setAiFieldLoading(EMPTY_AI_FIELD_LOADING);
      setQualityCheckResult(null);
      setForm(EMPTY_FORM);
      setIsbnInput("");
      setConfirmDuplicateSave(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lưu thông tin sách thất bại"));
    } finally {
      setSaving(false);
    }
  }

  function focusField(fieldId: string) {
    setActiveWorkspaceTab("book");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const field = document.getElementById(fieldId);
        field?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block: "center" });
        field?.focus({ preventScroll: true });
      });
    });
  }

  function handleReset() {
    setLookupData(null);
    setPostIsbnSuggestions(null);
    setAiFieldCandidates(EMPTY_AI_FIELD_CANDIDATES);
    setAiFieldLoading(EMPTY_AI_FIELD_LOADING);
    setQualityCheckResult(null);
    setForm(EMPTY_FORM);
    setIsbnInput("");
  }

  return (
    <PageWrapper className="mx-auto max-w-6xl space-y-6 pb-24">
      <FadeItem>
        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:shadow-none sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">AI-assisted cataloging</p>
          <PageHeader
            className="mt-2"
            icon={Sparkles}
            title="Nhập sách qua AI"
            description="Quét mã vạch hoặc nhập ISBN để tra cứu metadata, sau đó AI tự tạo đề xuất mô tả, tóm tắt, từ khóa và thể loại cho admin duyệt."
            iconBg="bg-cyan-100 dark:bg-cyan-500/15"
            iconColor="text-cyan-600 dark:text-cyan-400"
            iconSize="lg"
          />
        </div>
      </FadeItem>

      <FadeItem>
        <LookupSearchCard
          isbnInput={isbnInput}
          onIsbnInputChange={setIsbnInput}
          onLookup={() => void handleLookup()}
          onScanClick={() => setShowScanner(true)}
          lookupLoading={lookupLoading}
          hasLookupData={Boolean(lookupData)}
        />
      </FadeItem>

      <AnimatePresence mode="wait" initial={false}>
      {lookupLoading ? (
        <motion.div key="lookup-loading" initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}>
          <IsbnLookupProgress />
        </motion.div>
      ) : lookupData ? (
          <motion.div
            key={`lookup-result-${lookupData.isbn || isbnInput}`}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <section className="rounded-lg border border-border/80 bg-card p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-6 dark:shadow-none">
              {lookupData.found ? <MetadataFoundHero lookup={lookupData} form={form} completeSignalCount={completeSignalCount} /> : null}

              {manualMode ? (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">Không tìm thấy metadata từ nhà cung cấp</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">Vui lòng nhập tay thông tin sách — ISBN đã được giữ lại.</p>
                    <button type="button" onClick={() => focusField("title")} className="mt-1.5 inline-flex cursor-pointer items-center text-[12px] font-semibold text-warning underline decoration-warning/50 underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/30">
                      Chuyển tới ô nhập tay
                    </button>
                  </div>
                </div>
              ) : null}

              {lookupData?.reason === "barcode is not a valid ISBN but marketplace lookup attempted" ? (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">Mã quét có thể không phải ISBN chuẩn</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">Có thể là barcode bán lẻ — kết quả được tìm từ nhà sách trực tuyến.</p>
                  </div>
                </div>
              ) : null}

              <div className="space-y-6 pb-24">
                <MetadataReadiness signals={reviewSignals} onFocusField={focusField} />

                <Tabs value={activeWorkspaceTab} onValueChange={(value) => setActiveWorkspaceTab(value as "book" | "review")} className="gap-0">
                  <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 sm:gap-6" aria-label="Không gian làm việc nhập sách">
                    <TabsTrigger
                      value="book"
                      aria-label="Thông tin sách và AI hỗ trợ"
                      className="h-12 min-w-fit rounded-none border-x-0 border-b-2 border-t-0 border-transparent bg-transparent px-3 text-[13px] shadow-none data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent data-[state=active]:text-cyan-700 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-cyan-300"
                    >
                      <span className="sm:hidden">Sách</span><span className="hidden sm:inline">Thông tin & AI</span>
                      <StatusBadge label={`${completeSignalCount}/4`} variant={completeSignalCount === 4 ? "success" : "warning"} />
                    </TabsTrigger>
                    <TabsTrigger
                      value="review"
                      aria-label={`Kiểm duyệt, ${reviewIssueCount} mục cần xử lý`}
                      className="h-12 min-w-fit rounded-none border-x-0 border-b-2 border-t-0 border-transparent bg-transparent px-3 text-[13px] shadow-none data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent data-[state=active]:text-cyan-700 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-cyan-300"
                    >
                      <span className="sm:hidden">Duyệt</span><span className="hidden sm:inline">Kiểm duyệt</span>
                      <StatusBadge label={String(reviewIssueCount)} variant={reviewIssueCount ? "warning" : "success"} />
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="review" className="mt-0 pt-6">
                    <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}>
                      <ReviewTab
                        lookupData={lookupData}
                        reconciliationDraft={reconciliationDraft}
                        duplicateReview={duplicateReview}
                        duplicateMatches={duplicateMatches}
                        confirmDuplicateSave={confirmDuplicateSave}
                        onConfirmDuplicateSave={setConfirmDuplicateSave}
                        activeReviewId={activeReviewId}
                        onToggleReview={(id) => setActiveReviewId((current) => current === id ? null : id)}
                        duplicateNeedsReview={duplicateNeedsReview}
                        authorityNeedsReview={authorityNeedsReview}
                        evidenceNeedsReview={evidenceNeedsReview}
                        reviewIssueCount={reviewIssueCount}
                        sourceCount={sourceCount}
                        onAuthorityDecision={(field, status) => void handleAuthorityDecision(field, status)}
                        onCreateAuthorityEntity={handleCreateAuthorityEntity}
                        onDuplicateAction={handleDuplicateAction}
                      />
                    </motion.div>
                  </TabsContent>

                  <TabsContent value="book" className="mt-0 pt-6">
                    <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }} className="min-w-0">
                      <BookInfoTab
                        form={form}
                        onFieldChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
                        completeSignalCount={completeSignalCount}
                        aiFieldCandidates={aiFieldCandidates}
                        aiFieldLoading={aiFieldLoading}
                        onRegenerateField={(field) => void regenerateAiField(field)}
                        onApplyField={applyAiFieldCandidate}
                        onApplyAllFields={applyAllAiFieldCandidates}
                        aiSuggestionCount={aiSuggestionCount}
                        qualityCheckLoading={qualityCheckLoading}
                        qualityCheckResult={qualityCheckResult}
                        onQualityCheck={() => void handleQualityCheck()}
                        onDismissQualityCheck={() => setQualityCheckResult(null)}
                        postIsbnSuggestions={postIsbnSuggestions}
                        hasPostIsbnSuggestions={hasPostIsbnSuggestions}
                      />
                    </motion.div>
                  </TabsContent>
                </Tabs>
              </div>

              <StickyFooter
                completeSignalCount={completeSignalCount}
                reviewIssueCount={reviewIssueCount}
                catalogDuplicateNeedsReview={catalogDuplicateNeedsReview}
                onGoToReview={() => setActiveWorkspaceTab("review")}
                onReset={handleReset}
                onSave={() => void handleSave()}
                saving={saving}
                saveDisabled={duplicateMatches.length > 0 && !confirmDuplicateSave}
              />
            </section>
          </motion.div>
        ) : (
          <motion.div
            key="lookup-empty"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <EmptyLookupState />
          </motion.div>
      )}
      </AnimatePresence>

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

      <ConfirmDialog
        open={confirmEntityField !== null}
        onOpenChange={(open) => { if (!open) setConfirmEntityField(null); }}
        title="Tạo entity mới?"
        description="Entity mới chỉ được tạo khi bạn chấp nhận field này. Bạn có muốn tiếp tục?"
        onConfirm={confirmCreateAuthorityEntity}
        loading={confirmEntityLoading}
      />

      <ConfirmDialog
        open={confirmDuplicateAction !== null}
        onOpenChange={(open) => { if (!open) setConfirmDuplicateAction(null); }}
        title="Tạo catalog/edition mới?"
        description="Thao tác này sẽ tạo catalog/edition mới. Bạn có muốn tiếp tục?"
        variant="destructive"
        onConfirm={confirmRunDuplicateAction}
        loading={confirmDuplicateActionLoading}
      />
    </PageWrapper>
  );
}
