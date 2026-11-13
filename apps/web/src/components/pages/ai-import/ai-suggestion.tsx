import { useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Flip } from "gsap/Flip";
import { SplitText } from "gsap/SplitText";
import { AlertTriangle, Check, ChevronDown, Columns2, FolderCheck, Loader2, Plus, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import type { AiAppliedChange, AiFieldCandidate } from "./types";
import { normalizeForCompare, splitCommaValues } from "./utils";

gsap.registerPlugin(Flip, SplitText);

// Achromatic ledger (design-taste app style): the chrome is ink and grey; the one hue,
// #1d5fbf, marks the AI's own output and the figure that changed. No tinted cards,
// no shadow at rest; one layer of tone (a grey shell) holds one white core.
const AI_HUE = "text-[#1d5fbf] dark:text-[#8ab4f8]";
const STROKE = 1.5;

export interface AiFieldCopy {
  /** "mô tả", "tóm tắt", "từ khóa", "thể loại" - used inside sentences. */
  noun: string;
  kind: "text" | "chips";
}

const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
/** Share of letters carrying Vietnamese diacritics - enough to tell a Vietnamese text from an English one. */
const looksVietnamese = (text: string) => {
  const letters = text.normalize("NFC").match(/\p{L}/gu) || [];
  const marked = letters.filter((ch) => /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(ch)).length;
  return letters.length > 20 && marked / letters.length > 0.06;
};

/** What the suggestion changes, said in facts computed from the two texts (no guessing). */
function textInsight(current: string, value: string): string[] {
  if (!current.trim()) return [`${wordCount(value)} từ`];
  const facts: string[] = [];
  if (looksVietnamese(value) && !looksVietnamese(current)) facts.push("bản tiếng Việt");
  const delta = wordCount(value) - wordCount(current);
  facts.push(delta === 0 ? "cùng độ dài" : delta > 0 ? `dài hơn ${delta} từ` : `ngắn hơn ${-delta} từ`);
  return facts;
}

const greyButton = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[#ececec] px-3 text-[13px] font-medium text-foreground transition-[background-color,transform] duration-150 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#e2e2e2] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/15";
const ghostButton = "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-[#f2f2f2] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-white/5";

/** The grey shell + white core: one tonal layer that says "this came from the assistant". */
function Shell({ children, live, busy, rootRef }: { children: ReactNode; live?: "status" | "alert"; busy?: boolean; rootRef?: Ref<HTMLDivElement> }) {
  return (
    <div className="mx-2 mb-2 rounded-[10px] bg-[#f4f4f4] p-1 dark:bg-white/[0.04]">
      <div ref={rootRef} role={live} aria-busy={busy || undefined}
        className="rounded-md bg-card px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-black/[0.04] dark:shadow-none dark:ring-white/[0.06]">
        {children}
      </div>
    </div>
  );
}

function AiMark({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <Sparkles className={`h-4 w-4 ${AI_HUE}`} strokeWidth={STROKE} aria-hidden="true" />{children}
      </p>
      {meta ? <div className="flex flex-wrap items-center gap-x-3 text-[12px] text-muted-foreground">{meta}</div> : null}
    </div>
  );
}

/**
 * Mount with `key={candidate.value}`: a new suggestion starts fresh (chip choices,
 * compare view) and plays its arrival once.
 *
 * The AI suggestion for one field, in the state it is really in: being written,
 * failed, waiting for the user, or applied (with Undo in the same place). Nothing
 * here writes the form: every action goes back through the page's own handlers.
 */
export function AiSuggestionPanel({
  copy, candidate, loading, error, applied, currentValue, existingCategories, disabled,
  onApply, onUndo, onDismiss, onRegenerate,
}: {
  copy: AiFieldCopy;
  candidate: AiFieldCandidate | null;
  loading: boolean;
  error?: string;
  applied?: AiAppliedChange;
  currentValue: string;
  /** Catalog categories, to tell an existing category from a new one. */
  existingCategories?: string[];
  disabled: boolean;
  onApply: (selected?: string[]) => void;
  onUndo: () => void;
  onDismiss: () => void;
  onRegenerate: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const [compare, setCompare] = useState(false);
  const state = loading ? "loading" : error ? "error" : applied ? "applied" : candidate?.value.trim() ? "pending" : "none";

  // Chips: what is already in the field is not offered again; the rest start selected.
  const present = useMemo(() => new Set(splitCommaValues(currentValue).map(normalizeForCompare)), [currentValue]);
  const catalog = useMemo(() => new Set((existingCategories || []).map(normalizeForCompare)), [existingCategories]);
  const chips = useMemo(() => [...new Set(splitCommaValues(candidate?.value || ""))], [candidate?.value]);
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(() => new Set());
  const offered = chips.filter((chip) => !present.has(normalizeForCompare(chip)));
  const selected = offered.filter((chip) => !deselected.has(chip));

  // Arrival: the suggestion's words rise in, once per new suggestion - the panel's one
  // signature move. Opacity/transform only, so its buttons stay focusable throughout.
  useGSAP(() => {
    if (state === "none") return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.fromTo(rootRef.current, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.45, ease: EASE_OUT, clearProps: "transform,opacity" });
      if (state === "pending" && textRef.current) {
        const split = SplitText.create(textRef.current, { type: "words", aria: "auto" });
        gsap.from(split.words, {
          opacity: 0, y: 4, filter: "blur(3px)", duration: 0.5, ease: "power2.out",
          stagger: { amount: Math.min(0.6, split.words.length * 0.012) },
          onComplete: () => split.revert(), // plain text again: line clamp and screen readers see one paragraph
        });
      }
      if (state === "pending" && copy.kind === "chips") {
        gsap.from("[data-ai-chip]", { opacity: 0, scale: 0.92, duration: 0.35, ease: "back.out(2)", stagger: 0.035 });
      }
    });
    return () => mm.revert();
  }, { dependencies: [state], scope: rootRef, revertOnUpdate: true });

  // Compare: the single column opens into current | suggestion, and Flip carries each
  // block to its new place so the eye keeps track of which text is which.
  useGSAP(() => {
    if (!flipState.current) return;
    const recorded = flipState.current;
    flipState.current = null;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      Flip.from(recorded, { duration: 0.5, ease: "expo.out", nested: true, onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.3 }) });
    });
    return () => mm.revert();
  }, { dependencies: [compare], scope: rootRef, revertOnUpdate: true });

  // A click on Apply removes that button; the focus goes to its Undo in the same place.
  useGSAP(() => {
    if (state === "applied" && applied?.direct) undoRef.current?.focus();
  }, { dependencies: [state, applied?.direct] });

  if (state === "none") return null;

  if (state === "loading") {
    return (
      <Shell live="status" busy rootRef={rootRef}>
        <AiMark meta={<span className="inline-flex items-center gap-1.5"><Loader2 className={`h-3.5 w-3.5 animate-spin motion-reduce:animate-none ${AI_HUE}`} aria-hidden="true" />Đang viết</span>}>
          AI đang viết {copy.noun}
        </AiMark>
        {/* The final layout at its real size, flat grey, no shimmer: nothing jumps when the text lands. */}
        <div className="mt-3 space-y-2" aria-hidden="true">
          {copy.kind === "chips" ? (
            <div className="flex flex-wrap gap-1.5">{[64, 92, 56, 108, 76].map((w) => <span key={w} className="h-8 rounded-md bg-[#eeeeee] dark:bg-white/10" style={{ width: w }} />)}</div>
          ) : (
            [100, 97, 92, 58].map((w) => <span key={w} className="block h-3 rounded bg-[#eeeeee] dark:bg-white/10" style={{ width: `${w}%` }} />)
          )}
        </div>
      </Shell>
    );
  }

  if (state === "error") {
    return (
      <Shell live="alert" rootRef={rootRef}>
        <p className="flex items-start gap-2 text-[13.5px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#92400e] dark:text-amber-400" strokeWidth={STROKE} aria-hidden="true" />
          <span>Chưa tạo được {copy.noun}. <span className="text-muted-foreground">{error}</span></span>
        </p>
        <div className="mt-3 flex gap-1">
          <button type="button" onClick={onRegenerate} disabled={disabled} className={greyButton}><RefreshCw className="h-3.5 w-3.5" strokeWidth={STROKE} aria-hidden="true" />Thử lại</button>
          <button type="button" onClick={onDismiss} className={ghostButton}>Đóng</button>
        </div>
      </Shell>
    );
  }

  if (state === "applied" && applied) {
    const added = copy.kind === "chips" ? splitCommaValues(applied.applied).length - splitCommaValues(applied.previous).length : 0;
    return (
      <Shell live="status" rootRef={rootRef}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[13.5px] text-foreground">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-[#141414] text-white dark:bg-white dark:text-[#141414]"><Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" /></span>
            {copy.kind === "chips" ? <>Đã thêm <span className={`font-semibold tabular-nums ${AI_HUE}`}>{added}</span> {copy.noun} từ đề xuất AI</>
              : applied.previous.trim() ? `Đã thay ${copy.noun} bằng đề xuất AI` : `Đã dùng ${copy.noun} do AI viết`}
          </p>
          <button ref={undoRef} type="button" onClick={onUndo} className={ghostButton}>
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={STROKE} aria-hidden="true" />Hoàn tác<span className="sr-only"> {copy.noun}</span>
          </button>
        </div>
      </Shell>
    );
  }

  const value = candidate!.value;
  const origin = candidate!.source === "postIsbn" ? "Viết từ metadata đã tra cứu" : "Tạo theo yêu cầu của bạn";
  const replacing = copy.kind === "text" && currentValue.trim().length > 0;
  const same = copy.kind === "text" && currentValue.trim() === value.trim();
  const comparing = compare && replacing && !same;
  const long = copy.kind === "text" && (value.length > 360 || (comparing && currentValue.length > 360));
  const facts = copy.kind === "text" ? textInsight(currentValue, value)
    : [`${offered.length} ${copy.noun} mới`, ...(chips.length - offered.length ? [`${chips.length - offered.length} đã có`] : []),
      ...(catalog.size ? [`${offered.filter((chip) => catalog.has(normalizeForCompare(chip))).length} có trong danh mục`] : [])];

  const toggleCompare = () => {
    flipState.current = Flip.getState(rootRef.current?.querySelectorAll("[data-flip-id]") || []);
    setCompare((v) => !v);
  };

  return (
    <Shell rootRef={rootRef}>
      <AiMark meta={facts.map((fact, index) => (
        <span key={fact} className={index === facts.length - 1 && copy.kind === "text" && replacing ? `font-medium tabular-nums ${AI_HUE}` : "tabular-nums"}>{fact}</span>
      ))}>
        Đề xuất AI
      </AiMark>
      <p className="mt-0.5 pl-6 text-[12px] text-muted-foreground">{origin}. Chưa áp dụng.</p>

      {copy.kind === "text" ? (
        <div id={bodyId} className={`mt-3 grid gap-4 ${comparing ? "md:grid-cols-2" : ""}`}>
          {comparing ? (
            <div data-flip-id="current" className="min-w-0">
              <p className="text-[12px] font-medium text-muted-foreground">Đang dùng, <span className="tabular-nums">{wordCount(currentValue)} từ</span></p>
              <p className={`mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-6 text-muted-foreground ${expanded ? "" : "line-clamp-6"}`}>{currentValue}</p>
            </div>
          ) : null}
          <div data-flip-id="suggested" className="min-w-0">
            {comparing ? <p className={`text-[12px] font-medium ${AI_HUE}`}>Đề xuất, <span className="tabular-nums">{wordCount(value)} từ</span></p> : null}
            <p ref={textRef} className={`max-w-[68ch] whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-foreground ${comparing ? "mt-1" : ""} ${expanded ? "" : "line-clamp-6"}`}>{value}</p>
            {same ? <p className="mt-1 text-[12px] text-muted-foreground">Giống hệt nội dung đang có.</p> : null}
          </div>
          {long ? (
            <button type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded((v) => !v)}
              className="inline-flex w-fit cursor-pointer items-center gap-1 text-[12.5px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring md:col-span-full">
              {expanded ? "Thu gọn" : "Đọc toàn bộ"}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} strokeWidth={STROKE} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : (
        <ul id={bodyId} className="mt-3 flex flex-wrap gap-1.5" aria-label={`Chọn ${copy.noun} muốn thêm`}>
          {chips.map((chip) => {
            const already = present.has(normalizeForCompare(chip));
            const inCatalog = catalog.size > 0 && catalog.has(normalizeForCompare(chip));
            const isOn = !already && !deselected.has(chip);
            if (already) {
              return (
                <li key={chip} data-ai-chip className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground">
                  <Check className="h-3.5 w-3.5" strokeWidth={STROKE} aria-hidden="true" />{chip}<span className="sr-only">, đã có trong biểu mẫu</span>
                </li>
              );
            }
            return (
              <li key={chip} data-ai-chip>
                <button type="button" aria-pressed={isOn}
                  onClick={() => setDeselected((current) => { const next = new Set(current); if (next.has(chip)) next.delete(chip); else next.add(chip); return next; })}
                  className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-[background-color,border-color,color,transform] duration-200 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
                    isOn ? "border-black/15 bg-card font-medium text-foreground dark:border-white/20"
                      : "border-dashed border-black/15 bg-transparent text-muted-foreground hover:text-foreground dark:border-white/15"
                  }`}>
                  {isOn ? <Check className={`h-3.5 w-3.5 ${AI_HUE}`} strokeWidth={2} aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" strokeWidth={STROKE} aria-hidden="true" />}
                  {chip}
                  {catalog.size ? (inCatalog
                    ? <FolderCheck className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={STROKE} aria-label="có trong danh mục" />
                    : <span className="text-[11.5px] font-normal text-muted-foreground">mới</span>) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-[#f0f0f0] pt-3 dark:border-white/[0.06]">
        {copy.kind === "chips" ? (
          <button type="button" onClick={() => onApply(selected)} disabled={!selected.length} className={greyButton}>
            {selected.length ? <>Thêm <span className="tabular-nums">{selected.length}</span> {copy.noun}</> : offered.length ? `Chọn ${copy.noun} để thêm` : `Mọi ${copy.noun} đã có`}
          </button>
        ) : (
          <button type="button" onClick={() => onApply()} disabled={same} className={greyButton}>
            {replacing ? `Thay bằng ${copy.noun} này` : `Dùng ${copy.noun} này`}
          </button>
        )}
        {replacing && !same ? (
          <button type="button" aria-pressed={compare} aria-controls={bodyId} onClick={toggleCompare} className={ghostButton}>
            <Columns2 className="h-3.5 w-3.5" strokeWidth={STROKE} aria-hidden="true" />{compare ? "Chỉ xem đề xuất" : "So với bản hiện tại"}
          </button>
        ) : null}
        <button type="button" onClick={onDismiss} className={`${ghostButton} ml-auto`}>
          <X className="h-3.5 w-3.5" strokeWidth={STROKE} aria-hidden="true" />Bỏ qua<span className="sr-only"> đề xuất {copy.noun}</span>
        </button>
      </div>
    </Shell>
  );
}

export interface AiReviewItem {
  key: string;
  state: "pending" | "applied" | "dismissed";
  /** "thay mô tả", "thêm 5 từ khóa" - what applying it would do. */
  action: string;
}

const SEGMENT: Record<AiReviewItem["state"], string> = {
  applied: "bg-[#141414] dark:bg-white",
  dismissed: "bg-[#bdbdbd] dark:bg-white/35",
  pending: "bg-[#e6e6e6] dark:bg-white/10",
};

/**
 * The review of the AI's suggestions as a task with a real count: one segment per
 * suggestion, filled as the user applies (ink) or skips (grey) it. The one dark
 * button applies every suggestion still waiting; Undo all comes back once some are in.
 */
export function AiReviewStrip({ items, note, onApplyAll, onUndoAll }: {
  items: AiReviewItem[];
  note?: string | null;
  onApplyAll: () => void;
  onUndoAll: () => void;
}) {
  if (!items.length) return null;
  const pending = items.filter((item) => item.state === "pending");
  const applied = items.filter((item) => item.state === "applied").length;
  const done = items.length - pending.length;
  return (
    <section aria-labelledby="ai-review-title" className="mt-3 rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h4 id="ai-review-title" className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
            <Sparkles className={`h-4 w-4 ${AI_HUE}`} strokeWidth={STROKE} aria-hidden="true" />Đề xuất AI
            <span className="font-normal tabular-nums text-muted-foreground" aria-live="polite">đã xử lý {done}/{items.length}</span>
          </h4>
          <p className="mt-1 pl-6 text-[13px] text-muted-foreground">
            {pending.length ? <>Chờ bạn duyệt: <span className="text-foreground">{pending.map((item) => item.action).join(", ")}</span>.</>
              : applied ? "Đã duyệt xong. Vẫn nên đọc lại nội dung trước khi lưu." : "Đã bỏ qua mọi đề xuất."}
          </p>
          {note ? <p className="mt-0.5 pl-6 text-[12px] text-muted-foreground">{note}</p> : null}
        </div>
        {pending.length > 1 ? (
          <button type="button" onClick={onApplyAll}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 self-start whitespace-nowrap rounded-md bg-[#141414] px-3.5 text-[13px] font-medium text-white transition-[background-color,transform] duration-150 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#2a2a2a] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:bg-white dark:text-[#141414] dark:hover:bg-white/90">
            Áp dụng {pending.length} đề xuất còn lại
          </button>
        ) : applied > 1 ? (
          <button type="button" onClick={onUndoAll} className={`${ghostButton} shrink-0 self-start whitespace-nowrap`}>
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={STROKE} aria-hidden="true" />Hoàn tác tất cả
          </button>
        ) : null}
      </div>
      <ol className="mt-3 flex gap-1" aria-label="Tiến độ duyệt đề xuất AI">
        {items.map((item) => (
          <li key={item.key} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${SEGMENT[item.state]}`}>
            <span className="sr-only">{item.action}: {item.state === "applied" ? "đã áp dụng" : item.state === "dismissed" ? "đã bỏ qua" : "chờ duyệt"}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A field AI can write: label, status and the generate action share the header,
 * the control sits below, and the suggestion unfolds in the same frame, next to
 * the value it would change. When a suggestion is applied the frame's edge glows
 * once in the AI hue and settles, so the eye follows the change into the field.
 */
export function AiField({ id, label, status, generating, hasSuggestion, disabled, onGenerate, appliedKey, children, suggestion }: {
  id: string;
  label: string;
  status?: ReactNode;
  generating: boolean;
  hasSuggestion: boolean;
  disabled: boolean;
  onGenerate: () => void;
  /** Changes each time a suggestion is applied to this field. */
  appliedKey?: string;
  children: ReactNode;
  suggestion: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const seen = useRef(appliedKey);
  useGSAP(() => {
    const fresh = appliedKey && appliedKey !== seen.current;
    seen.current = appliedKey;
    if (!fresh) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.fromTo(frameRef.current, { boxShadow: "0 0 0 3px rgba(29, 95, 191, 0.35)" }, { boxShadow: "0 0 0 0px rgba(29, 95, 191, 0)", duration: 1.1, ease: "power2.out", clearProps: "boxShadow" });
    });
    return () => mm.revert();
  }, { dependencies: [appliedKey], revertOnUpdate: true });

  return (
    <div ref={frameRef} className="overflow-hidden rounded-lg border border-border bg-card transition-colors focus-within:border-[#c9c9c9] dark:focus-within:border-white/25">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 pl-4 pr-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
          <Label htmlFor={id} className="text-[13px] font-semibold text-foreground">{label}</Label>
          {status}
        </div>
        <button type="button" onClick={onGenerate} disabled={generating || disabled} title={disabled ? "Cần có tên sách để dùng AI" : undefined}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-foreground transition-[background-color,transform] duration-150 hover:bg-[#f2f2f2] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-white/5">
          {generating ? <Loader2 className={`h-3.5 w-3.5 animate-spin motion-reduce:animate-none ${AI_HUE}`} aria-hidden="true" />
            : hasSuggestion ? <RefreshCw className={`h-3.5 w-3.5 ${AI_HUE}`} strokeWidth={STROKE} aria-hidden="true" />
            : <Sparkles className={`h-3.5 w-3.5 ${AI_HUE}`} strokeWidth={STROKE} aria-hidden="true" />}
          {generating ? "Đang viết…" : hasSuggestion ? "Viết lại" : "Viết bằng AI"}
          <span className="sr-only"> {label.charAt(0).toLowerCase() + label.slice(1)}</span>
        </button>
      </div>
      <div className="px-4 pb-3">{children}</div>
      {suggestion}
    </div>
  );
}
