import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { OCR_STATUS_META } from "@/lib/book-ocr";
import type { FieldOrigin } from "./field";
import { REVIEW_CARD_IDS } from "./review-ids";
import { StudioHeader, StudioSection, type SessionTone, type StudioStep } from "./studio-ui";
import { useMediaQuery, WIDE_WORKSPACE_QUERY } from "./use-media-query";
import type { SaveIssue } from "./sticky-footer";
import { ExtractionEvidencePanel } from './extraction-evidence-panel';
import { aiService, type EnrichMode, type LookupBookByIsbnResponse, type PostIsbnAiSuggestions } from "@/services/ai";
import { bookService } from "@/services/book";
import { metadataIntelligenceService, type DuplicateDecisionResult, type DuplicateReview, type ReconciliationDraft } from "@/services/metadata-intelligence";
import { getApiErrorMessage } from "@/services/api";
import { BookInfoTab } from "./book-info-tab";
import { EmptyLookupState } from "./empty-state";
import { IsbnLookupProgress } from "./isbn-lookup-progress";
import { LookupSearchCard } from "./lookup-search-card";
import { BookProfileAside } from "./book-profile-aside";
import { ReviewTab } from "./review-tab";
import { StickyFooter } from "./sticky-footer";
import { ImageOcrCard, OcrAvailabilityNotice } from "./image-ocr-card";
import { OcrReviewPanel } from "./ocr-review-panel";
import { useBookOcr } from "./use-book-ocr";
import { EMPTY_FORM, type AiFieldCandidates, type AiFieldKey, type CatalogBookLite, type EditableBookForm } from "./types";
import { applySafeProposals, formFromScan, lookupStateFromScan, singleSourceProposals } from "@/lib/book-ocr";
import type { BookOcrScanResult } from "@/services/book-ocr";
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
const NO_AI_SUGGESTIONS: PostIsbnAiSuggestions = { description: null, summaryVi: null, keywords: [], categories: [], qualityWarnings: [], provider: 'none', confidence: 0 };

export function AIImportPage() {
  const shouldReduceMotion = useReducedMotion();
  const [isbnInput, setIsbnInput] = useState("");
  const [pipelineEnabled, setPipelineEnabled] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [sourceType, setSourceType] = useState<'text' | 'html'>('text');
  useEffect(() => {
    let active = true;
    metadataIntelligenceService.capabilities().then(c => { if (active) setPipelineEnabled(c.enabled); }).catch(() => {});
    return () => { active = false; };
  }, []);
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
  // Fields the user typed into (or explicitly chose a value for): an OCR result that
  // arrives later never overwrites them. Refs give the async scan handler the latest values.
  const [userEditedFields, setUserEditedFields] = useState<ReadonlySet<string>>(() => new Set());
  const formRef = useRef(form);
  const userEditedRef = useRef(userEditedFields);
  useEffect(() => { formRef.current = form; }, [form]);
  useEffect(() => { userEditedRef.current = userEditedFields; }, [userEditedFields]);
  const ocr = useBookOcr();

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
  // Presentation-only state of the studio: none of it changes what can be saved.
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [ocrCancelled, setOcrCancelled] = useState(false);
  const wideWorkspace = useMediaQuery(WIDE_WORKSPACE_QUERY);

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

  async function handleLookup(rawInput?: string, pasted = false) {
    const normalized = normalizeIsbnInput(rawInput ?? isbnInput);
    if (!normalized && !pasted) {
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
      const result = pipelineEnabled ? {
        lookup: await metadataIntelligenceService.extract(pasted ? sourceType : 'isbn', pasted ? sourceText : normalized, pasted ? normalized || undefined : undefined),
        aiSuggestions: NO_AI_SUGGESTIONS,
      } : await aiService.enrichBookAfterIsbn({
        isbn: normalized,
        existingCategories,
      });
      const lookup = result.lookup;

      setIsbnInput(normalized);
      // An explicit ISBN lookup replaces the form (below), so OCR proposals no longer apply.
      ocr.clearResult();
      setUserEditedFields(new Set());
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
        await startCatalogReview(lookup, result.aiSuggestions, mapLookupToForm(lookup));
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

  /** Reconciliation draft (only for a provider record) + duplicate check, shared by the
   *  ISBN lookup and the image OCR flows. Catalog intelligence is additive: the import
   *  stays usable when its review APIs are unavailable. */
  async function startCatalogReview(lookup: LookupBookByIsbnResponse, aiSuggestions: PostIsbnAiSuggestions, formForCheck: EditableBookForm) {
    try {
      let normalizedMetadata: Record<string, unknown> = {};
      let draftNeedsReview = false;
      if (lookup.found) {
        const draft = await metadataIntelligenceService.createReconciliationDraft(lookup, aiSuggestions);
        setReconciliationDraft(draft);
        normalizedMetadata = draft.normalized_metadata;
        draftNeedsReview = draft.decisions.length === 0 || draft.decisions.some((item) => item.status === "PENDING");
      }
      const duplicate = await metadataIntelligenceService.checkDuplicate(buildDuplicateCheckMetadata({ lookup, normalizedMetadata, form: formForCheck }));
      setDuplicateReview(duplicate);
      const duplicateRequiresAction = duplicate.classification !== "NEW_TITLE";
      setActiveWorkspaceTab(draftNeedsReview || duplicateRequiresAction || Boolean(lookup.conflicts?.length) ? "review" : "book");
      initializedTabForLookup.current = lookup;
    } catch {
      toast.info("Không thể tải review catalog lúc này; bạn vẫn có thể kiểm tra metadata thủ công.");
    }
  }

  function markUserEdited(...fields: string[]) {
    setUserEditedFields((current) => fields.every((field) => current.has(field)) ? current : new Set([...current, ...fields]));
  }

  async function handleOcrScan() {
    setOcrCancelled(false);
    const outcome = await ocr.scan();
    if (!outcome) return;
    if (outcome.reused) {
      toast.info("Ảnh chưa thay đổi — đang dùng kết quả quét trước, không gửi lại.");
      return;
    }
    await applyOcrResult(outcome.result);
  }

  async function applyOcrResult(result: BookOcrScanResult) {
    // A scan starts a new import session, exactly like a new ISBN lookup does,
    // except that fields the user typed into are kept.
    const lookup = lookupStateFromScan(result);
    const { form: nextForm, applied, keptUserValues } = formFromScan(formRef.current, result.proposals, userEditedRef.current, EMPTY_FORM);
    setPostIsbnSuggestions(null);
    setReconciliationDraft(null);
    setCreateAuthorityEntities({});
    setDuplicateReview(null);
    setDuplicateDecisionResult(null);
    setAiFieldCandidates(EMPTY_AI_FIELD_CANDIDATES);
    setQualityCheckResult(null);
    setConfirmDuplicateSave(false);
    setForm(nextForm);
    setLookupData(lookup);
    const conflicts = Object.values(result.proposals).filter((proposal) => proposal.status === "CONFLICTED").length;
    if (result.status === "NO_DATA") toast.warning("AI không đọc được thông tin sử dụng được từ ảnh. Hãy thử ảnh rõ hơn hoặc nhập tay.");
    else toast.success(`Đã điền ${applied.length} trường an toàn từ ảnh${conflicts ? `; ${conflicts} trường có xung đột cần bạn chọn` : ""}.`);
    if (keptUserValues.length) toast.info(`Giữ nguyên ${keptUserValues.length} trường bạn đã nhập.`);
    if (lookup.found || nextForm.title.trim() || nextForm.isbn.trim()) await startCatalogReview(lookup, NO_AI_SUGGESTIONS, nextForm);
  }

  function handleOcrApply(fields: Array<keyof EditableBookForm>, value: string, label: string) {
    if (ocr.resultStale) return;
    setForm((prev) => ({ ...prev, ...Object.fromEntries(fields.map((field) => [field, value])) }));
    markUserEdited(...fields); // an explicit choice: later safe-applies keep it
    toast.success(`Đã áp dụng ${label.toLowerCase()}`);
  }

  function handleOcrApplySafe() {
    if (!ocr.result || ocr.resultStale) return; // a result for other photos is never applied
    const { form: next, applied } = applySafeProposals(form, ocr.result.proposals, userEditedFields);
    setForm(next);
    if (applied.length) toast.success(`Đã áp dụng ${applied.length} trường an toàn`);
    else toast.info("Không có trường an toàn nào cần áp dụng (các trường bạn đã sửa được giữ nguyên).");
  }

  function handleOcrApplySingleSource() {
    if (!ocr.result || ocr.resultStale) return;
    const chosen = singleSourceProposals(ocr.result.proposals, userEditedFields);
    const fields = chosen.flatMap((proposal) => (proposal.formField === "isbn" ? ["isbn", "isbn13"] : [proposal.formField]));
    setForm((prev) => ({ ...prev, ...Object.fromEntries(chosen.flatMap((proposal) => (proposal.formField === "isbn"
      ? [["isbn", proposal.value], ["isbn13", proposal.value]] : [[proposal.formField, proposal.value]]))) }));
    markUserEdited(...fields); // an explicit choice, kept like a typed value
    toast.success(`Đã áp dụng ${chosen.length} giá trị đọc từ một ảnh`);
  }

  async function handleAuthorityDecision(field: string, status: "ACCEPTED" | "REJECTED", override?: unknown) {
    if (!reconciliationDraft) return;
    try {
      const value = status === "ACCEPTED" ? override === undefined ? reconciliationValueFromForm(field, form) : override : undefined;
      const decision = await metadataIntelligenceService.decideField(reconciliationDraft.id, field, status, value);
      if (override !== undefined) {
        const formField: Record<string, keyof EditableBookForm> = { authors: 'authorsText', translator: 'translatorText', categories: 'categoriesText', isbn: 'isbn13' };
        const target = formField[field] || field as keyof EditableBookForm;
        if (target in form || target === 'translatorText') {
          setForm(current => ({ ...current, [target]: Array.isArray(value) ? value.join(', ') : String(value ?? '') }));
          markUserEdited(target);
        }
      }
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
          toast.success(`Đã tạo mô tả AI (${result.ai_provider === "openrouter" ? "OpenRouter" : result.ai_provider})`);
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
      if (result.qualityWarnings.length === 0) toast.success("AI không đưa ra cảnh báo chất lượng nào");
      else toast.warning(result.qualityWarnings[0]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Công cụ AI gặp lỗi, vui lòng thử lại"));
    } finally {
      setQualityCheckLoading(false);
    }
  }

  async function handleSave() {
    setAttemptedSave(true); // reveals inline errors on the required fields; the checks below are unchanged
    if (lookupData?.intelligence && !reconciliationDraft) {
      toast.error('Cần có bản nháp kiểm duyệt trước khi lưu kết quả trích xuất.');
      return;
    }
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
      setUserEditedFields(new Set());
      setAttemptedSave(false);
      ocr.reset();
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
    setUserEditedFields(new Set());
    setAttemptedSave(false);
    setOcrCancelled(false);
    ocr.reset();
  }

  // Ask before discarding real work; an untouched form resets silently.
  function requestReset() {
    const touched = Object.keys(EMPTY_FORM).some((key) => {
      const field = key as keyof EditableBookForm;
      return (form[field] ?? "") !== (EMPTY_FORM[field] ?? "");
    }) || Object.keys(ocr.slots).length > 0;
    if (touched) setConfirmReset(true);
    else handleReset();
  }

  function goToReview(cardId: string) {
    setActiveWorkspaceTab("review");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById(cardId)?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block: "start" });
      });
    });
  }

  // ── Studio presentation (derived; never feeds back into save rules) ─────────
  const ocrDecisionCount = ocr.result && !ocr.resultStale
    ? Object.values(ocr.result.proposals).filter((proposal) => ["CONFLICTED", "REVIEW_REQUIRED", "INVALID"].includes(proposal.status)).length
    : 0;

  const origins = useMemo(() => {
    const map: Partial<Record<keyof EditableBookForm, FieldOrigin>> = {};
    (Object.keys(form) as Array<keyof EditableBookForm>).forEach((field) => {
      const value = String(form[field] ?? "").trim();
      if (!value) return;
      if (userEditedFields.has(field)) {
        map[field] = { label: "Bạn đã sửa", tone: "edited" };
        return;
      }
      const proposal = ocr.result?.proposals[field === "isbn13" ? "isbn" : field];
      if (proposal && proposal.value === form[field]) {
        map[field] = { label: OCR_STATUS_META[proposal.status].label, tone: proposal.status === "CORROBORATED" ? "ocr" : "ocr-weak" };
        return;
      }
      if (lookupData?.found && !ocr.result) map[field] = { label: "Từ tra cứu", tone: "lookup" };
    });
    return map;
  }, [form, userEditedFields, ocr.result, lookupData]);

  // Mirrors handleSave's refusals, in the same order, so the bar never promises a save that will be refused.
  const saveBlockers: SaveIssue[] = [];
  if (lookupData) {
    if (lookupData.intelligence && !reconciliationDraft) saveBlockers.push({ key: "draft", label: "Chưa có bản nháp kiểm duyệt", onGo: () => goToReview(REVIEW_CARD_IDS.authority) });
    if (!normalizeIsbnInput(form.isbn || isbnInput)) saveBlockers.push({ key: "isbn", label: "Thiếu ISBN", onGo: () => focusField("isbn") });
    if (!form.title.trim()) saveBlockers.push({ key: "title", label: "Thiếu tên sách", onGo: () => focusField("title") });
    if (catalogDuplicateNeedsReview) saveBlockers.push({ key: "catalog-dup", label: "Xác nhận trùng catalog", onGo: () => goToReview(REVIEW_CARD_IDS.duplicate) });
    if (reconciliationDraft?.decisions.some((item) => item.status === "PENDING")) saveBlockers.push({ key: "authority", label: "Quyết định chuẩn hóa còn chờ", onGo: () => goToReview(REVIEW_CARD_IDS.authority) });
    if (duplicateNeedsReview) saveBlockers.push({ key: "duplicate", label: "Xử lý trùng lặp & ấn bản", onGo: () => goToReview(REVIEW_CARD_IDS.duplicate) });
  }
  const saveAdvisories: SaveIssue[] = [];
  if (lookupData) {
    if (evidenceNeedsReview) saveAdvisories.push({ key: "evidence", label: `${lookupData.conflicts?.length || 0} trường nguồn ghi khác nhau`, onGo: () => goToReview(REVIEW_CARD_IDS.evidence) });
    if (ocrDecisionCount) saveAdvisories.push({ key: "ocr", label: `${ocrDecisionCount} trường OCR cần quyết định`, onGo: () => goToReview(REVIEW_CARD_IDS.ocr) });
    reviewSignals.filter((signal) => !signal.complete && ["authors", "description"].includes(signal.fieldId))
      .forEach((signal) => saveAdvisories.push({ key: signal.fieldId, label: `Chưa có ${signal.label.toLowerCase()}`, onGo: () => focusField(signal.fieldId) }));
  }

  const steps: StudioStep[] = [
    { label: "Nguồn dữ liệu", hint: "ISBN hoặc ảnh sách", state: lookupData || lookupLoading || ocr.scanning ? "done" : "active" },
    { label: "Trích xuất", hint: "Tra cứu, đọc ảnh, đối chiếu", state: lookupLoading || ocr.scanning ? "active" : lookupData ? "done" : "todo" },
    { label: "Kiểm duyệt", hint: "Xung đột, trùng lặp, chuẩn hóa", state: !lookupData || lookupLoading ? "todo" : reviewIssueCount || ocrDecisionCount ? "active" : "done" },
    { label: "Lưu", hint: "Chỉ khi bạn bấm Lưu", state: !lookupData || lookupLoading ? "todo" : saving || (!reviewIssueCount && !ocrDecisionCount) ? "active" : "todo" },
  ];
  const session: { label: string; tone: SessionTone } = saving ? { label: "Đang lưu", tone: "busy" }
    : lookupLoading ? { label: "Đang tra cứu ISBN", tone: "busy" }
    : ocr.scanning ? { label: "AI đang đọc ảnh", tone: "busy" }
    : !lookupData ? { label: "Chưa bắt đầu", tone: "idle" }
    : saveBlockers.length ? { label: `Đang kiểm duyệt · ${saveBlockers.length} việc bắt buộc`, tone: "review" }
    : { label: "Sẵn sàng lưu", tone: "ready" };

  const rootRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  // Entrance once; afterwards only a new lookup/scan result moves. Transform/opacity only,
  // reduced motion gets the final layout. Motion components never wrap these nodes.
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.from("[data-reveal]", { autoAlpha: 0, y: 10, duration: 0.6, stagger: 0.07, ease: EASE_OUT });
    });
    return () => mm.revert();
  }, { scope: rootRef });
  useGSAP(() => {
    if (!lookupData || !workspaceRef.current) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.from(workspaceRef.current, { autoAlpha: 0, y: 12, duration: 0.45, ease: EASE_OUT, clearProps: "all" });
    });
    return () => mm.revert();
  }, { dependencies: [lookupData], revertOnUpdate: true });

  const footer = (
    <StickyFooter
      blockers={saveBlockers}
      advisories={saveAdvisories}
      onReset={requestReset}
      onSave={() => void handleSave()}
      saving={saving}
      saveDisabled={duplicateMatches.length > 0 && !confirmDuplicateSave}
    />
  );

  // A new lookup/scan result moves the focus of work from the sources to the review workspace.
  useEffect(() => {
    if (!lookupData) return;
    const frame = window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lookupData, shouldReduceMotion]);

  const profile = lookupData ? (
    <BookProfileAside
      lookup={lookupData}
      form={form}
      signals={reviewSignals}
      reviewIssueCount={reviewIssueCount}
      onThumbnailChange={(value) => { markUserEdited("thumbnail"); setForm((prev) => ({ ...prev, thumbnail: value })); }}
      onFocusField={focusField}
    />
  ) : null;

  const bookInfo = (
    <BookInfoTab
      form={form}
      onFieldChange={(field, value) => { markUserEdited(field); setForm((prev) => ({ ...prev, [field]: value })); }}
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
      origins={origins}
      showRequired={attemptedSave}
    />
  );

  const review = lookupData ? (
    <div className="space-y-3">
      {lookupData.intelligence ? <ExtractionEvidencePanel bundle={lookupData.intelligence} draft={reconciliationDraft} onDecide={handleAuthorityDecision} /> : null}
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
        ocrDecisionCount={ocrDecisionCount}
        ocrPanel={ocr.result ? (
          <OcrReviewPanel
            result={ocr.result}
            stale={ocr.resultStale}
            slots={ocr.slots}
            form={form}
            userEdited={userEditedFields}
            onApply={handleOcrApply}
            onApplySafe={handleOcrApplySafe}
            onApplySingleSource={handleOcrApplySingleSource}
            onDismiss={ocr.clearResult}
          />
        ) : undefined}
      />
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="mx-auto max-w-[1440px] space-y-5 p-4 pb-10 sm:p-6 lg:p-8">
      <StudioHeader session={session} steps={steps} ocrAvailability={ocr.availability} />

      <div data-reveal>
        <StudioSection
          id="import-sources"
          step={1}
          title="Bắt đầu từ ISBN hoặc ảnh sách"
          description="Hai cách cùng dẫn vào một không gian kiểm duyệt. Tra ISBN mới sẽ thay biểu mẫu; quét ảnh giữ lại trường bạn đã tự sửa."
        >
          <div className="space-y-5">
            <LookupSearchCard
              isbnInput={isbnInput}
              onIsbnInputChange={setIsbnInput}
              onLookup={() => void handleLookup()}
              onScanClick={() => setShowScanner(true)}
              lookupLoading={lookupLoading}
              hasLookupData={Boolean(lookupData)}
            />
            <div className="border-t border-border pt-5">
              {ocr.availability === "AVAILABLE" && ocr.capabilities ? (
                <ImageOcrCard
                  slots={ocr.slots}
                  preparing={ocr.preparing}
                  scanning={ocr.scanning}
                  error={ocr.error}
                  maxImages={ocr.capabilities.maxImages}
                  maxFileBytes={ocr.capabilities.maxFileBytes}
                  onSelect={(kind, file) => void ocr.selectFile(kind, file)}
                  onRemove={ocr.removeFile}
                  onScan={() => void handleOcrScan()}
                  onCancel={() => { ocr.cancel(); setOcrCancelled(true); }}
                  hasResult={Boolean(ocr.result)}
                  stale={ocr.resultStale}
                  cancelled={ocrCancelled}
                />
              ) : ocr.availability !== "AVAILABLE" ? (
                <OcrAvailabilityNotice availability={ocr.availability} onRetry={() => void ocr.retryCapabilities()} />
              ) : null}
            </div>
          </div>

          {pipelineEnabled ? (
            <details className="group mt-5 rounded-xl border border-border px-4 py-3">
              <summary className="flex min-h-8 cursor-pointer items-center gap-2 text-[13.5px] font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Trích xuất từ nội dung sách (văn bản / HTML)
              </summary>
              <div className="mt-3 space-y-2.5">
                <p className="text-[12.5px] text-muted-foreground">Dán thông tin từ trang sách. ISBN ở ô tra cứu là tùy chọn để đối chiếu ấn bản.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="metadataSourceType" className="text-[12px] text-muted-foreground">Định dạng</label>
                  <select id="metadataSourceType" aria-label="Định dạng nội dung" value={sourceType} onChange={e => setSourceType(e.target.value as 'text' | 'html')} className="h-9 rounded-lg border border-border bg-input-background px-2 text-[13px] text-foreground">
                    <option value="text">Văn bản</option><option value="html">HTML</option>
                  </select>
                </div>
                <label htmlFor="metadataSource" className="sr-only">Nội dung sách</label>
                <Textarea id="metadataSource" value={sourceText} onChange={e => setSourceText(e.target.value)} maxLength={100000} rows={5} placeholder="Tên sách, tác giả, thông tin xuất bản, mô tả…" />
                <button type="button" disabled={lookupLoading || !sourceText.trim()} onClick={() => void handleLookup(undefined, true)} className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55">
                  {lookupLoading ? 'Đang trích xuất…' : 'Trích xuất thông tin'}
                </button>
              </div>
            </details>
          ) : null}
        </StudioSection>
      </div>

      {lookupLoading ? (
        <IsbnLookupProgress />
      ) : lookupData ? (
        <div ref={workspaceRef} className="space-y-4">
          {manualMode ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-50/70 px-4 py-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {lookupData.reason === "OCR_WITHOUT_PROVIDER_RECORD" || lookupData.reason === "OCR_LOOKUP_MISMATCH" ? (
                  <>
                    <p className="text-[13px] font-semibold text-foreground">
                      {lookupData.reason === "OCR_LOOKUP_MISMATCH"
                        ? "Bản ghi tra cứu ISBN không khớp sách trong ảnh — biểu mẫu chỉ dùng dữ liệu đọc từ ảnh, hãy kiểm tra lại ISBN"
                        : "Chưa có metadata từ nhà cung cấp — biểu mẫu chỉ dùng dữ liệu đọc từ ảnh"}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{form.isbn.trim() ? "Kiểm tra lại từng trường với sách thật trước khi lưu." : "Ảnh không có ISBN hợp lệ — nhập ISBN in trên sách để lưu (ISBN là bắt buộc)."}</p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-semibold text-foreground">Không tìm thấy metadata từ nhà cung cấp</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">Vui lòng nhập tay thông tin sách — ISBN đã được giữ lại.</p>
                  </>
                )}
                <button type="button" onClick={() => focusField("title")} className="mt-1.5 inline-flex min-h-8 cursor-pointer items-center text-[12.5px] font-semibold text-amber-800 underline decoration-amber-500/50 underline-offset-4 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring dark:text-amber-300">
                  Chuyển tới ô nhập tay
                </button>
              </div>
            </div>
          ) : null}

          {lookupData?.reason === "barcode is not a valid ISBN but marketplace lookup attempted" ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-50/70 px-4 py-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground">Mã quét có thể không phải ISBN chuẩn</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Có thể là barcode bán lẻ — kết quả được tìm từ nhà sách trực tuyến.</p>
              </div>
            </div>
          ) : null}

          {wideWorkspace ? (
            // Paperless-style two panes: the record on the left, every pending decision on the right.
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(380px,440px)] items-start gap-5">
              <div className="min-w-0 space-y-4">
                {profile}
                {bookInfo}
                {footer}
              </div>
              {/* Sticks just under the top bar and ends above the viewport bottom (the scroll
                  container is <main>, below a 52px top bar), so its last card is always reachable;
                  the save bar lives under the form column and never covers it. */}
              <aside aria-label="Kiểm duyệt" className="sticky top-4 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-muted/30 p-3 [scrollbar-width:thin]">
                {review}
              </aside>
            </div>
          ) : (
            <div className="space-y-4">
              {profile}
              <Tabs value={activeWorkspaceTab} onValueChange={(value) => setActiveWorkspaceTab(value as "book" | "review")} className="min-w-0 gap-0">
                <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl bg-muted p-1" aria-label="Không gian làm việc nhập sách">
                  <TabsTrigger value="book" className="min-h-10 rounded-lg text-[13px]">Thông tin sách</TabsTrigger>
                  <TabsTrigger value="review" className="min-h-10 gap-1.5 rounded-lg text-[13px]" aria-label={`Kiểm duyệt, ${reviewIssueCount + (ocrDecisionCount ? 1 : 0)} nhóm cần xử lý`}>
                    Kiểm duyệt
                    {reviewIssueCount + (ocrDecisionCount ? 1 : 0) ? (
                      <span className="rounded-md bg-amber-100 px-1.5 text-[11.5px] font-semibold tabular-nums text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">{reviewIssueCount + (ocrDecisionCount ? 1 : 0)}</span>
                    ) : null}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="book" className="mt-4">{bookInfo}</TabsContent>
                <TabsContent value="review" className="mt-4">{review}</TabsContent>
              </Tabs>
            </div>
          )}

          {wideWorkspace ? null : footer}
        </div>
      ) : (
        <div data-reveal><EmptyLookupState /></div>
      )}

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
        title="Thêm mục mới vào danh mục?"
        description="Trường này sẽ được chấp nhận, và mục mới (tác giả, NXB hoặc thể loại) chỉ được tạo trong danh mục khi bạn bấm Lưu sách. Tiếp tục?"
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

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Đặt lại phiên nhập sách?"
        description="Biểu mẫu, ảnh đã chọn và kết quả đọc ảnh sẽ bị xóa. Chưa có gì được lưu vào catalog."
        variant="destructive"
        onConfirm={() => { handleReset(); setConfirmReset(false); }}
      />
    </div>
  );
}
