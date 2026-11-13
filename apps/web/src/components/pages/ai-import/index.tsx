import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { AlertTriangle, ChevronDown, FileText, X } from "lucide-react";
import { toast } from "sonner";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { OCR_STATUS_META } from "@/lib/book-ocr";
import type { FieldOrigin } from "./field";
import { REVIEW_CARD_IDS } from "./review-ids";
import { StudioHeader, type SessionTone, type StudioStep } from "./studio-ui";
import { useMediaQuery, WIDE_WORKSPACE_QUERY } from "./use-media-query";
import type { SaveIssue } from "./sticky-footer";
import { ExtractionEvidencePanel } from "./extraction-evidence-panel";
import { aiService, type EnrichBookAfterIsbnResponse, type EnrichMode, type LookupBookByIsbnResponse, type PostIsbnAiSuggestions } from "@/services/ai";
import { bookService } from "@/services/book";
import { metadataIntelligenceService, type DuplicateDecisionResult, type DuplicateReview, type ReconciliationDraft } from "@/services/metadata-intelligence";
import { ProgressStreamUnavailable, type LookupProgressEvent } from "@/services/lookup-progress-stream";
import { getApiErrorMessage } from "@/services/api";
import { EmptyLookupState } from "./empty-state";
import { LookupSearchCard } from "./lookup-search-card";
import { BookProfileAside } from "./book-profile-aside";
import { ReviewTab } from "./review-tab";
import { StickyFooter } from "./sticky-footer";
import { ImageOcrCard, OcrAvailabilityNotice } from "./image-ocr-card";
import { OcrReviewPanel } from "./ocr-review-panel";
import { useBookOcr } from "./use-book-ocr";
import { MetadataReview } from "./metadata-review";
import { ProcessingTimeline } from "./processing-timeline";
import { SourceComparison } from "./source-comparison";
import { ReviewChecklist, type ChecklistItem } from "./review-checklist";
import { applyProgressEvent, finishProgress, initialProgress, markClientStep, type LookupProgress, type PhaseState } from "./lookup-progress";
import type { FieldFilter } from "./field-review-model";
import { AI_FORM_FIELD, EMPTY_FORM, type AiAppliedChange, type AiFieldCandidates, type AiFieldKey, type CatalogBookLite, type EditableBookForm } from "./types";
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
/** A lookup that has not answered by then is abandoned on this page (the server may still finish and cache it). */
const LOOKUP_TIMEOUT_MS = 180_000;
/** Evidence keys (fieldEvidence / conflicts) -> the review row of that field. */
const ROW_FOR_EVIDENCE: Record<string, keyof EditableBookForm> = {
  authors: "authorsText", translator: "translatorText", categories: "categoriesText", isbn: "isbn",
};

type WorkspaceTab = "metadata" | "sources" | "ocr" | "review";
type PanelTab = Exclude<WorkspaceTab, "metadata">;

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

  // Lookup progress (presentation of real backend events only). Each lookup/scan gets a
  // sequence number: an answer, progress event or review step of an older one is dropped.
  const [progress, setProgress] = useState<LookupProgress>(() => initialProgress());
  const [lookupStartedAt, setLookupStartedAt] = useState<number | null>(null);
  const [lookupCode, setLookupCode] = useState("");
  const lookupSeqRef = useRef(0);
  const lookupAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    lookupSeqRef.current += 1;
    lookupAbortRef.current?.abort();
  }, []);

  const [aiFieldCandidates, setAiFieldCandidates] = useState<AiFieldCandidates>(EMPTY_AI_FIELD_CANDIDATES);
  const [aiFieldLoading, setAiFieldLoading] = useState<Record<AiFieldKey, boolean>>(EMPTY_AI_FIELD_LOADING);
  // Presentation state of the suggestions: an inline error per field, and what was applied (for Undo).
  const [aiFieldErrors, setAiFieldErrors] = useState<Partial<Record<AiFieldKey, string>>>({});
  const [aiApplied, setAiApplied] = useState<Partial<Record<AiFieldKey, AiAppliedChange>>>({});
  const [aiDismissed, setAiDismissed] = useState<Partial<Record<AiFieldKey, true>>>({});
  const [qualityCheckLoading, setQualityCheckLoading] = useState(false);
  const [qualityCheckResult, setQualityCheckResult] = useState<{ provider: string; warnings: string[] } | null>(null);

  const [catalogBooks, setCatalogBooks] = useState<CatalogBookLite[]>([]);
  const [confirmDuplicateSave, setConfirmDuplicateSave] = useState(false);
  const [activeReviewId, setActiveReviewId] = useState<"duplicate" | "authority" | "evidence" | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("metadata");
  const [lastPanelTab, setLastPanelTab] = useState<PanelTab>("sources");
  const [fieldFilter, setFieldFilter] = useState<FieldFilter>("all");
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

  function selectTab(tab: WorkspaceTab) {
    setWorkspaceTab(tab);
    if (tab !== "metadata") setLastPanelTab(tab);
  }

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

  // A new result opens on what needs attention: the review when something is pending,
  // the OCR comparison after a scan, otherwise the metadata (and the sources beside it).
  useEffect(() => {
    if (!lookupData) {
      initializedTabForLookup.current = null;
      setWorkspaceTab("metadata");
      return;
    }
    if (initializedTabForLookup.current === lookupData) return;
    initializedTabForLookup.current = lookupData;
    setFieldFilter("all");
    if (ocr.result && !ocr.resultStale) selectTab("ocr");
    else if (reviewIssueCount > 0) selectTab("review");
    else { setWorkspaceTab("metadata"); setLastPanelTab("sources"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new lookup result re-initializes the tab
  }, [lookupData, reviewIssueCount]);

  /** Starts a new import session: older lookups, their events and review steps are ignored from now on. */
  function beginSession(): number {
    lookupSeqRef.current += 1;
    lookupAbortRef.current?.abort();
    lookupAbortRef.current = null;
    return lookupSeqRef.current;
  }

  async function fetchLookup(seq: number, normalized: string, pasted: boolean, signal: AbortSignal): Promise<EnrichBookAfterIsbnResponse> {
    const onProgress = (event: LookupProgressEvent) => {
      if (seq === lookupSeqRef.current) setProgress((current) => applyProgressEvent(current, event));
    };
    const type = pasted ? sourceType : 'isbn';
    const value = pasted ? sourceText : normalized;
    const target = pasted ? normalized || undefined : undefined;
    try {
      return pipelineEnabled
        ? { success: true, lookup: await metadataIntelligenceService.extractWithProgress(type, value, target, { signal, onProgress }), aiSuggestions: NO_AI_SUGGESTIONS }
        : await aiService.enrichBookAfterIsbnWithProgress({ isbn: normalized, existingCategories }, { signal, onProgress });
    } catch (error) {
      if (!(error instanceof ProgressStreamUnavailable)) throw error;
      // No live channel (older ai-service, proxy, refused): same lookup through the plain
      // endpoint. The timeline then says it can only show that the request is running.
      if (seq === lookupSeqRef.current) setProgress((current) => ({ ...current, channel: "unavailable" }));
      return pipelineEnabled
        ? { success: true, lookup: await metadataIntelligenceService.extract(type, value, target), aiSuggestions: NO_AI_SUGGESTIONS }
        : await aiService.enrichBookAfterIsbn({ isbn: normalized, existingCategories });
    }
  }

  async function handleLookup(rawInput?: string, pasted = false) {
    const normalized = normalizeIsbnInput(rawInput ?? isbnInput);
    if (!normalized && !pasted) {
      toast.error("Vui lòng nhập ISBN");
      return;
    }

    const seq = beginSession();
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, LOOKUP_TIMEOUT_MS);
    const isCurrent = () => seq === lookupSeqRef.current;

    setLookupCode(normalized || (pasted ? "nội dung đã dán" : ""));
    setLookupStartedAt(Date.now());
    setProgress(initialProgress());
    setLookupLoading(true);
    setPostIsbnSuggestions(null);
    setReconciliationDraft(null);
    setCreateAuthorityEntities({});
    setDuplicateReview(null);
    setDuplicateDecisionResult(null);
    setAiFieldCandidates(EMPTY_AI_FIELD_CANDIDATES);
    setAiFieldErrors({});
    setAiApplied({});
    setAiDismissed({});
    setQualityCheckResult(null);
    try {
      const result = await fetchLookup(seq, normalized, pasted, controller.signal);
      if (!isCurrent()) return; // a newer lookup or scan owns the page now
      const lookup = result.lookup;

      setIsbnInput(normalized);
      // An explicit ISBN lookup replaces the form (below), so OCR proposals no longer apply.
      ocr.clearResult();
      setUserEditedFields(new Set());
      setProgress((current) => finishProgress(current, lookup));
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
        await startCatalogReview(lookup, result.aiSuggestions, mapLookupToForm(lookup), seq);
        if (!isCurrent()) return;
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
        // No source carries this code: the book itself is the reliable source - its
        // copyright page holds ISBN, publisher, year and page count for the OCR flow.
        toast.info(lookup.message || "Không tìm thấy metadata. Chuyển sang nhập tay.", {
          description: "Chụp trang thông tin xuất bản để AI đọc ISBN, NXB, năm và số trang, hoặc nhập tay.",
          action: {
            label: "Chụp trang xuất bản",
            onClick: scrollToCopyrightSlot,
          },
          duration: 10000,
        });
      }
    } catch (error) {
      if (!isCurrent()) return; // cancelled or superseded: nothing to report
      if (timedOut) toast.error("Tra cứu quá thời gian. Bạn có thể thử lại, dùng ảnh sách (OCR) hoặc nhập tay.");
      else toast.error(getApiErrorMessage(error, "Tra cứu ISBN thất bại"));
    } finally {
      window.clearTimeout(timer);
      if (isCurrent()) {
        setLookupLoading(false);
        lookupAbortRef.current = null;
      }
    }
  }

  function cancelLookup() {
    beginSession();
    setLookupLoading(false);
    toast.info("Đã hủy tra cứu trên trang này. Máy chủ có thể vẫn hoàn tất và lưu kết quả vào bộ nhớ đệm.");
  }

  function scrollToCopyrightSlot() {
    document.querySelector('[data-testid="ocr-slot-copyright_page"]')
      ?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block: "center" });
  }

  /** Reconciliation draft (only for a provider record) + duplicate check, shared by the
   *  ISBN lookup and the image OCR flows. Catalog intelligence is additive: the import
   *  stays usable when its review APIs are unavailable. */
  async function startCatalogReview(lookup: LookupBookByIsbnResponse, aiSuggestions: PostIsbnAiSuggestions, formForCheck: EditableBookForm, seq: number, fromScan = false) {
    const isCurrent = () => seq === lookupSeqRef.current;
    const step = (name: "draft" | "duplicate", phase: PhaseState) => { if (isCurrent()) setProgress((current) => markClientStep(current, name, phase)); };
    let failedStep: "draft" | "duplicate" = "draft";
    try {
      let normalizedMetadata: Record<string, unknown> = {};
      let draftNeedsReview = false;
      if (lookup.found) {
        step("draft", "active");
        const draft = await metadataIntelligenceService.createReconciliationDraft(lookup, aiSuggestions);
        if (!isCurrent()) return;
        setReconciliationDraft(draft);
        step("draft", "done");
        normalizedMetadata = draft.normalized_metadata;
        draftNeedsReview = draft.decisions.length === 0 || draft.decisions.some((item) => item.status === "PENDING");
      } else {
        step("draft", "skipped");
      }
      failedStep = "duplicate";
      step("duplicate", "active");
      const duplicate = await metadataIntelligenceService.checkDuplicate(buildDuplicateCheckMetadata({ lookup, normalizedMetadata, form: formForCheck }));
      if (!isCurrent()) return;
      setDuplicateReview(duplicate);
      step("duplicate", "done");
      const duplicateRequiresAction = duplicate.classification !== "NEW_TITLE";
      // After a scan the OCR comparison stays in front; the review tab carries its own count.
      if (!fromScan && (draftNeedsReview || duplicateRequiresAction || Boolean(lookup.conflicts?.length))) selectTab("review");
      initializedTabForLookup.current = lookup;
    } catch {
      if (!isCurrent()) return;
      step(failedStep, "failed");
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
    const seq = beginSession();
    setLookupLoading(false);
    const lookup = lookupStateFromScan(result);
    const { form: nextForm, applied, keptUserValues } = formFromScan(formRef.current, result.proposals, userEditedRef.current, EMPTY_FORM);
    setPostIsbnSuggestions(null);
    setReconciliationDraft(null);
    setCreateAuthorityEntities({});
    setDuplicateReview(null);
    setDuplicateDecisionResult(null);
    setAiFieldCandidates(EMPTY_AI_FIELD_CANDIDATES);
    setAiFieldErrors({});
    setAiApplied({});
    setAiDismissed({});
    setQualityCheckResult(null);
    setConfirmDuplicateSave(false);
    setForm(nextForm);
    setLookupCode(lookup.isbn || "");
    setLookupStartedAt(null);
    setProgress(finishProgress({ ...initialProgress("unavailable") }, lookup));
    setLookupData(lookup);
    const conflicts = Object.values(result.proposals).filter((proposal) => proposal.status === "CONFLICTED").length;
    if (result.status === "NO_DATA") toast.warning("AI không đọc được thông tin sử dụng được từ ảnh. Hãy thử ảnh rõ hơn hoặc nhập tay.");
    else toast.success(`Đã điền ${applied.length} trường an toàn từ ảnh${conflicts ? `; ${conflicts} trường có xung đột cần bạn chọn` : ""}.`);
    if (keptUserValues.length) toast.info(`Giữ nguyên ${keptUserValues.length} trường bạn đã nhập.`);
    if (lookup.found || nextForm.title.trim() || nextForm.isbn.trim()) await startCatalogReview(lookup, NO_AI_SUGGESTIONS, nextForm, seq, true);
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
    setAiFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    // A new suggestion replaces the old one, so the old one's Undo no longer applies.
    setAiApplied((prev) => ({ ...prev, [field]: undefined }));
    setAiDismissed((prev) => ({ ...prev, [field]: undefined }));
    const failed = (message: string) => setAiFieldErrors((prev) => ({ ...prev, [field]: message }));
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
          if (result.keywords?.length) setAiApplied((prev) => ({ ...prev, keywords: undefined }));
          if (!result.summaryVi) failed("AI không trả về mô tả mới.");
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
          } else {
            failed(result.qualityWarnings[0] || "AI không tạo được mô tả mới.");
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

      // The new suggestion appears in its own field (and is announced there); a failure is
      // said inline next to it, with a retry, instead of in a toast far from the field.
      if (field === "summaryVi" && result.shortSummary) {
        setAiFieldCandidates((prev) => ({ ...prev, summaryVi: { value: result.shortSummary!, source: "generated" } }));
      } else if (field === "keywords" && result.keywords.length > 0) {
        const sanitized = [...new Set(result.keywords.map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= 50))].slice(0, 15);
        setAiFieldCandidates((prev) => ({ ...prev, keywords: { value: sanitized.join(", "), source: "generated" } }));
      } else if (field === "categories" && result.suggestedCategories.length > 0) {
        setAiFieldCandidates((prev) => ({ ...prev, categories: { value: result.suggestedCategories.join(", "), source: "generated" } }));
      } else {
        failed(result.qualityWarnings[0] || "AI không trả về kết quả nào.");
      }
    } catch (err) {
      failed(getApiErrorMessage(err, "Công cụ AI gặp lỗi."));
    } finally {
      setAiFieldLoading((prev) => ({ ...prev, [field]: false }));
    }
  }

  /** The value a suggestion would leave in its field: text replaces, chips merge into
   *  what is there (the same rules as before; `selected` only narrows which chips). */
  function aiAppliedValue(field: AiFieldKey, current: string, selected?: string[]): string | null {
    const candidate = aiFieldCandidates[field];
    if (!candidate || !candidate.value.trim()) return null;
    if (field === "description" || field === "summaryVi") return candidate.value;
    return mergeCommaText(current, selected ?? splitCommaValues(candidate.value));
  }

  function applyAiFieldCandidate(field: AiFieldKey, selected?: string[]) {
    const target = AI_FORM_FIELD[field];
    const previous = form[target];
    const next = aiAppliedValue(field, previous, selected);
    if (next === null || next === previous) return;
    setForm((prev) => ({ ...prev, [target]: next }));
    setAiApplied((prev) => ({ ...prev, [field]: { previous, applied: next, direct: true } }));
  }

  function applyAllAiFieldCandidates() {
    const fields = (Object.keys(AI_FORM_FIELD) as AiFieldKey[]).filter((field) => !aiApplied[field] && aiFieldCandidates[field]?.value.trim());
    const changes: Partial<Record<AiFieldKey, AiAppliedChange>> = {};
    const patch: Partial<EditableBookForm> = {};
    for (const field of fields) {
      const previous = form[AI_FORM_FIELD[field]];
      const next = aiAppliedValue(field, previous);
      if (next === null || next === previous) continue;
      patch[AI_FORM_FIELD[field]] = next;
      changes[field] = { previous, applied: next, direct: false };
    }
    if (!Object.keys(changes).length) return;
    setForm((prev) => ({ ...prev, ...patch }));
    setAiApplied((prev) => ({ ...prev, ...changes }));
  }

  /** Undo puts the old value back only if the field still holds what the suggestion wrote;
   *  a later edit by the user is never thrown away. */
  function undoAiFields(fields: AiFieldKey[]) {
    const patch: Partial<EditableBookForm> = {};
    let kept = 0;
    for (const field of fields) {
      const change = aiApplied[field];
      if (!change) continue;
      const target = AI_FORM_FIELD[field];
      if (form[target] === change.applied) patch[target] = change.previous;
      else kept += 1;
    }
    setForm((prev) => ({ ...prev, ...patch }));
    setAiApplied((prev) => ({ ...prev, ...Object.fromEntries(fields.map((field) => [field, undefined])) }));
    if (kept) toast.info("Trường đã được sửa sau khi áp dụng, nên giữ nguyên nội dung hiện tại.");
  }

  function dismissAiSuggestion(field: AiFieldKey) {
    setAiFieldCandidates((prev) => ({ ...prev, [field]: null }));
    setAiFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    setAiApplied((prev) => ({ ...prev, [field]: undefined }));
    setAiDismissed((prev) => ({ ...prev, [field]: true }));
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
      setAiFieldErrors({});
      setAiApplied({});
      setAiDismissed({});
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

  function scrollToId(id: string, block: ScrollLogicalPosition = "center", focus = false) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const element = document.getElementById(id);
        element?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block });
        if (focus) element?.focus({ preventScroll: true });
      });
    });
  }

  function focusField(fieldId: string) {
    setFieldFilter("all");
    selectTab("metadata");
    scrollToId(fieldId, "center", true);
  }

  /** "So sánh và chọn" on a conflict: the metadata review, filtered to conflicts, at that field. */
  function showConflict(evidenceField: string) {
    const row = ROW_FOR_EVIDENCE[evidenceField] || (evidenceField as keyof EditableBookForm);
    setFieldFilter("conflict");
    selectTab("metadata");
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.querySelector(`[data-field-row="${row}"]`)?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block: "center" });
    }));
  }

  function handleReset() {
    beginSession();
    setLookupLoading(false);
    setLookupData(null);
    setPostIsbnSuggestions(null);
    setAiFieldCandidates(EMPTY_AI_FIELD_CANDIDATES);
    setAiFieldErrors({});
    setAiApplied({});
    setAiDismissed({});
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
    if (cardId === REVIEW_CARD_IDS.ocr) {
      selectTab("ocr");
      scrollToId(cardId, "start");
      return;
    }
    selectTab("review");
    scrollToId(cardId, "start");
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

  // One list for the review checklist and the save bar. Its required items mirror
  // handleSave's refusals, in the same order, so neither promises a save that will be refused.
  const checklist: Array<ChecklistItem & { short: string }> = [];
  if (lookupData) {
    if (lookupData.intelligence) checklist.push({ key: "draft", required: true, done: Boolean(reconciliationDraft), label: "Bản nháp kiểm duyệt đã được tạo", short: "Chưa có bản nháp kiểm duyệt", detail: "Tra cứu lại nếu bản nháp không tạo được.", onGo: () => goToReview(REVIEW_CARD_IDS.authority) });
    const hasIsbn = Boolean(normalizeIsbnInput(form.isbn || isbnInput));
    checklist.push({ key: "isbn", required: true, done: hasIsbn, label: "Có mã ISBN", short: "Thiếu ISBN", onGo: () => focusField("isbn") });
    checklist.push({ key: "title", required: true, done: Boolean(form.title.trim()), label: "Có tên sách", short: "Thiếu tên sách", onGo: () => focusField("title") });
    if (duplicateMatches.length > 0) checklist.push({ key: "catalog-dup", required: true, done: !catalogDuplicateNeedsReview, label: "Xác nhận sách có thể đã có trong catalog", short: "Xác nhận trùng catalog", onGo: () => goToReview(REVIEW_CARD_IDS.duplicate) });
    if (reconciliationDraft) checklist.push({ key: "authority", required: true, done: !reconciliationDraft.decisions.some((item) => item.status === "PENDING"), label: "Duyệt chuẩn hóa tác giả, NXB, thể loại", short: "Quyết định chuẩn hóa còn chờ", onGo: () => goToReview(REVIEW_CARD_IDS.authority) });
    if (duplicateReview || duplicateDecisionResult) checklist.push({ key: "duplicate", required: true, done: !duplicateNeedsReview, label: "Xử lý trùng lặp và ấn bản", short: "Xử lý trùng lặp & ấn bản", onGo: () => goToReview(REVIEW_CARD_IDS.duplicate) });
    if (evidenceNeedsReview) checklist.push({ key: "evidence", required: false, done: false, label: `So sánh ${lookupData.conflicts?.length || 0} trường các nguồn ghi khác nhau`, short: `${lookupData.conflicts?.length || 0} trường nguồn ghi khác nhau`, detail: "Hệ thống đã chọn một giá trị; bạn có thể chọn giá trị khác.", onGo: () => goToReview(REVIEW_CARD_IDS.evidence) });
    if (ocr.result) checklist.push({ key: "ocr", required: false, done: !ocrDecisionCount, label: ocrDecisionCount ? `${ocrDecisionCount} trường đọc từ ảnh cần quyết định` : "Kết quả đọc ảnh đã được xem", short: `${ocrDecisionCount} trường OCR cần quyết định`, onGo: () => goToReview(REVIEW_CARD_IDS.ocr) });
    reviewSignals.filter((signal) => ["authors", "description"].includes(signal.fieldId))
      .forEach((signal) => checklist.push({ key: signal.fieldId, required: false, done: signal.complete, label: `Có ${signal.label.toLowerCase()}`, short: `Chưa có ${signal.label.toLowerCase()}`, detail: signal.detail, onGo: () => focusField(signal.fieldId) }));
  }
  const saveBlockers: SaveIssue[] = checklist.filter((item) => item.required && !item.done).map((item) => ({ key: item.key, label: item.short, onGo: item.onGo! }));
  const saveAdvisories: SaveIssue[] = checklist.filter((item) => !item.required && !item.done).map((item) => ({ key: item.key, label: item.short, onGo: item.onGo! }));

  const steps: StudioStep[] = [
    { label: "Nhập dữ liệu", hint: "Mã ISBN, mã vạch hoặc ảnh sách", state: lookupData || lookupLoading || ocr.scanning ? "done" : "active" },
    { label: "Tra cứu và trích xuất", hint: "Hai vòng nguồn, đọc ảnh, tổng hợp", state: lookupLoading || ocr.scanning ? "active" : lookupData ? "done" : "todo" },
    { label: "Kiểm duyệt metadata", hint: "Nguồn, xung đột, trùng lặp", state: !lookupData || lookupLoading ? "todo" : saveBlockers.length || ocrDecisionCount ? "active" : "done" },
    { label: "Lưu vào catalog", hint: "Chỉ khi bạn bấm Lưu", state: !lookupData || lookupLoading ? "todo" : saving || (!saveBlockers.length && !ocrDecisionCount) ? "active" : "todo" },
  ];
  const session: { label: string; tone: SessionTone } = saving ? { label: "Đang lưu", tone: "busy" }
    : lookupLoading ? { label: "Đang tra cứu", tone: "busy" }
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

  // A new lookup/scan result moves the focus of work from the inputs to the workspace.
  useEffect(() => {
    if (!lookupData) return;
    const frame = window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lookupData, shouldReduceMotion]);

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

  const metadataPane = (
    <MetadataReview
      form={form}
      onFieldChange={(field, value) => {
        markUserEdited(field);
        setForm((prev) => ({ ...prev, [field]: value }));
        // Typing in a field makes it the user's again: its AI Undo no longer applies.
        const aiField = (Object.keys(AI_FORM_FIELD) as AiFieldKey[]).find((key) => AI_FORM_FIELD[key] === field);
        if (aiField && aiApplied[aiField]) setAiApplied((prev) => ({ ...prev, [aiField]: undefined }));
      }}
      lookup={lookupData}
      userEdited={userEditedFields}
      origins={origins}
      showRequired={attemptedSave}
      filter={fieldFilter}
      onFilterChange={setFieldFilter}
      aiFieldCandidates={aiFieldCandidates}
      aiFieldLoading={aiFieldLoading}
      onRegenerateField={(field) => void regenerateAiField(field)}
      aiFieldErrors={aiFieldErrors}
      aiApplied={aiApplied}
      aiDismissed={aiDismissed}
      existingCategories={existingCategories}
      onApplyField={applyAiFieldCandidate}
      onApplyAllFields={applyAllAiFieldCandidates}
      onUndoAiField={(field) => undoAiFields([field])}
      onUndoAllAiFields={() => undoAiFields(Object.keys(aiApplied).filter((key) => aiApplied[key as AiFieldKey]) as AiFieldKey[])}
      onDismissAiField={dismissAiSuggestion}
      qualityCheckLoading={qualityCheckLoading}
      qualityCheckResult={qualityCheckResult}
      onQualityCheck={() => void handleQualityCheck()}
      onDismissQualityCheck={() => setQualityCheckResult(null)}
      postIsbnSuggestions={postIsbnSuggestions}
      hasPostIsbnSuggestions={hasPostIsbnSuggestions}
    />
  );

  const sourcesPane = lookupData ? (
    <div className="space-y-6">
      <SourceComparison lookup={lookupData} onUseOcr={scrollToCopyrightSlot} onManualEntry={() => focusField("title")} />
      {progress.sources.length || progress.channel === "live" ? (
        <details className="group">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-border px-4 text-[13.5px] font-semibold text-foreground hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            Diễn biến tra cứu từng bước
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="mt-3">
            <ProcessingTimeline progress={progress} code={lookupCode || lookupData.isbn} running={false} startedAt={lookupStartedAt} finishedMs={lookupData.processingTimeMs} />
          </div>
        </details>
      ) : null}
    </div>
  ) : null;

  const ocrPane = ocr.result ? (
    <div id={REVIEW_CARD_IDS.ocr} className="scroll-mt-24">
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
    </div>
  ) : null;

  const reviewPane = lookupData ? (
    <div className="space-y-4">
      <ReviewChecklist items={checklist} />
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
        onAuthorityDecision={(field, status) => void handleAuthorityDecision(field, status)}
        onCreateAuthorityEntity={handleCreateAuthorityEntity}
        onDuplicateAction={handleDuplicateAction}
        onShowConflict={showConflict}
      />
    </div>
  ) : null;

  const foundSources = lookupData?.verification?.sourcesFound ?? (lookupData?.sources || []).filter((s) => s.status === "SUCCESS").length;
  const reviewCount = saveBlockers.length + (evidenceNeedsReview ? 1 : 0);
  const tabCount = (count: number, words: string) => count ? (
    <span className="rounded-md bg-muted px-1.5 text-[11.5px] font-semibold tabular-nums text-muted-foreground group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary" aria-label={`${count} ${words}`}>{count}</span>
  ) : null;
  const triggerClass = "group min-h-10 min-w-0 flex-1 gap-1 rounded-lg px-1.5 text-[12.5px] data-[state=active]:shadow-sm sm:gap-1.5 sm:px-3 sm:text-[13px]";
  const panelTabs: Array<{ id: PanelTab; label: string; badge: ReactNode }> = [
    { id: "sources", label: "Nguồn", badge: tabCount(foundSources, "nguồn có dữ liệu") },
    ...(ocr.result ? [{ id: "ocr" as const, label: "Ảnh & OCR", badge: tabCount(ocrDecisionCount, "trường cần quyết định") }] : []),
    { id: "review", label: "Kiểm duyệt", badge: tabCount(reviewCount, "mục cần xử lý") },
  ];
  const panelContent: Record<PanelTab, ReactNode> = { sources: sourcesPane, ocr: ocrPane, review: reviewPane };
  const panelTab: PanelTab = workspaceTab === "metadata" ? lastPanelTab : workspaceTab;
  const safePanelTab: PanelTab = panelTab === "ocr" && !ocr.result ? "review" : panelTab;

  return (
    <div ref={rootRef} className="mx-auto max-w-[1440px] space-y-6 p-4 pb-10 sm:p-6 lg:p-8">
      <StudioHeader session={session} steps={steps} ocrAvailability={ocr.availability} />

      <section data-reveal aria-labelledby="import-sources-title" className="rounded-2xl border border-border bg-card">
        <div className="px-5 pt-5 sm:px-6">
          <h2 id="import-sources-title" className="text-[16px] font-semibold text-foreground">Dữ liệu đầu vào</h2>
          <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed text-muted-foreground">
            Dùng mã in trên sách, hoặc chụp bìa trước, bìa sau và trang thông tin xuất bản. Tra mã mới sẽ thay biểu mẫu; quét ảnh giữ lại trường bạn đã tự sửa.
          </p>
        </div>
        <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
          <LookupSearchCard
            isbnInput={isbnInput}
            onIsbnInputChange={setIsbnInput}
            onLookup={() => void handleLookup()}
            onScanClick={() => setShowScanner(true)}
            lookupLoading={lookupLoading}
            hasLookupData={Boolean(lookupData)}
          />
          <div className="min-w-0 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
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
          <details className="group mx-5 mb-5 rounded-xl border border-border px-4 py-3 sm:mx-6">
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
      </section>

      {lookupLoading ? (
        <div className="space-y-3">
          <ProcessingTimeline progress={progress} code={lookupCode} running startedAt={lookupStartedAt} />
          <div className="flex justify-end">
            <button type="button" onClick={cancelLookup}
              className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <X className="h-4 w-4" aria-hidden="true" />Hủy tra cứu
            </button>
          </div>
        </div>
      ) : lookupData ? (
        <div ref={workspaceRef} className="scroll-mt-4 space-y-5">
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
                    <p className="mt-0.5 text-[13px] text-muted-foreground">Vui lòng nhập tay thông tin sách — ISBN đã được giữ lại. Tab Nguồn cho biết từng nguồn đã trả lời ra sao.</p>
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

          <BookProfileAside
            lookup={lookupData}
            form={form}
            signals={reviewSignals}
            reviewIssueCount={reviewIssueCount}
            onFocusField={focusField}
          />

          {wideWorkspace ? (
            // Paperless-style split: the record being edited on the left; sources, OCR and the
            // review decisions beside it in a wide panel, so a value and its evidence are read together.
            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(420px,1fr)] items-start gap-6">
              <div className="min-w-0 space-y-4">
                {metadataPane}
                {footer}
              </div>
              {/* Sticks under the top bar and ends above the viewport bottom (the scroll container is
                  <main>), so its last card stays reachable; the save bar lives under the form column. */}
              <aside aria-label="Nguồn, ảnh và kiểm duyệt" className="sticky top-4 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-muted/25 [scrollbar-width:thin]">
                <Tabs value={safePanelTab} onValueChange={(value) => selectTab(value as PanelTab)} className="gap-0">
                  <div className="sticky top-0 z-10 border-b border-border bg-card/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-card/85">
                    <TabsList className="flex h-auto w-full rounded-xl bg-muted p-1" aria-label="Chọn bảng bên phải">
                      {panelTabs.map((tab) => <TabsTrigger key={tab.id} value={tab.id} className={triggerClass}>{tab.label}{tab.badge}</TabsTrigger>)}
                    </TabsList>
                  </div>
                  {panelTabs.map((tab) => <TabsContent key={tab.id} value={tab.id} className="p-4">{panelContent[tab.id]}</TabsContent>)}
                </Tabs>
              </aside>
            </div>
          ) : (
            <div className="space-y-4">
              <Tabs value={workspaceTab === "ocr" && !ocr.result ? "review" : workspaceTab} onValueChange={(value) => selectTab(value as WorkspaceTab)} className="min-w-0 gap-0">
                <TabsList className="grid h-auto w-full rounded-xl bg-muted p-1" style={{ gridTemplateColumns: `repeat(${panelTabs.length + 1}, minmax(0, 1fr))` }} aria-label="Không gian kiểm duyệt">
                  <TabsTrigger value="metadata" className={triggerClass}>Metadata</TabsTrigger>
                  {panelTabs.map((tab) => <TabsTrigger key={tab.id} value={tab.id} className={triggerClass}>{tab.label}{tab.badge}</TabsTrigger>)}
                </TabsList>
                {/* Kept mounted (hidden) so every field can be focused from the checklist and save bar. */}
                <TabsContent value="metadata" forceMount className="mt-4 data-[state=inactive]:hidden">{metadataPane}</TabsContent>
                {panelTabs.map((tab) => <TabsContent key={tab.id} value={tab.id} className="mt-4">{panelContent[tab.id]}</TabsContent>)}
              </Tabs>
              {footer}
            </div>
          )}
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
