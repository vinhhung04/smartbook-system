import type { ComponentType } from "react";
import {
  Ban, BookMarked, Building2, CheckCircle2, CircleSlash, Clock3, CopyX, FileWarning, Library, PauseCircle, Search, SkipForward, Sparkles, Store, XCircle,
} from "lucide-react";
import type { IsbnLookupSource, IsbnSourceName, IsbnVerification, LookupBookByIsbnResponse } from "@/services/ai";
import { SOURCE_LABELS } from "./utils";

export type SourceStatus = IsbnLookupSource["status"];
export type Tone = "ok" | "warn" | "error" | "muted";

/** Every status keeps its own icon and words - none is folded into "failed". */
export const SOURCE_STATUS_META: Record<SourceStatus, { label: string; hint: string; icon: ComponentType<{ className?: string }>; tone: Tone }> = {
  SUCCESS: { label: "Tìm thấy", hint: "Nguồn có bản ghi khớp và dữ liệu được dùng để đối chiếu.", icon: CheckCircle2, tone: "ok" },
  NOT_FOUND: { label: "Không tìm thấy", hint: "Nguồn trả lời nhưng không có cuốn sách này.", icon: CircleSlash, tone: "muted" },
  TIMEOUT: { label: "Quá thời gian", hint: "Nguồn không trả lời kịp trong thời gian cho phép.", icon: Clock3, tone: "warn" },
  ERROR: { label: "Lỗi", hint: "Không đọc được phản hồi của nguồn.", icon: XCircle, tone: "error" },
  DISABLED: { label: "Đã tắt", hint: "Nguồn không được truy vấn (tắt trong cấu hình hoặc ngừng hoạt động).", icon: Ban, tone: "muted" },
  SKIPPED: { label: "Bỏ qua", hint: "Nguồn không cần hỏi ở bước này.", icon: SkipForward, tone: "muted" },
  MISMATCH: { label: "Sai mã", hint: "Bản ghi ghi một mã khác (hoặc không ghi mã) — không dùng làm bằng chứng.", icon: FileWarning, tone: "warn" },
  DIFFERENT_EDITION: { label: "Khác ấn bản", hint: "Cùng tên sách nhưng mã ISBN khác — đã loại.", icon: CopyX, tone: "warn" },
  PAUSED: { label: "Tạm dừng", hint: "Nguồn vừa chặn truy vấn (HTTP 403/429) nên đang được tạm nghỉ.", icon: PauseCircle, tone: "warn" },
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-800 dark:text-amber-300",
  error: "text-red-700 dark:text-red-400",
  muted: "text-muted-foreground",
};

export const TONE_CHIP: Record<Tone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
  error: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  muted: "border-border bg-muted/50 text-muted-foreground",
};

export const VERIFICATION_LABELS: Record<IsbnVerification, string> = {
  CODE_MATCH: "Khớp mã chính xác",
  TITLE_MATCH: "Khớp tên và tác giả",
  CODE_IN_SNIPPET: "Mã xuất hiện trong trích đoạn",
};

export const QUERY_LABELS: Record<string, string> = { code: "Theo mã", title: "Theo tên và tác giả", "-": "—" };

const REASON_LABELS: Record<string, string> = {
  ROUND1_ALREADY_MATCHED: "Vòng 1 đã khớp ở nguồn trước",
  ROUND1_NOT_FOUND: "Vòng 1 không xác định được sách",
  CODE_NOT_SUPPORTED: "Nguồn không tra được loại mã này",
  BOOK_IN_CATALOG: "Sách đã có trong kho — không cần gọi",
  CODE_MISMATCH: "Trang ghi mã khác mã đang tra",
  CODE_UNKNOWN: "Trang không ghi mã để đối chiếu",
};

/** Reason codes in words; "INACTIVE: ..." / "DISABLED_BY_CONFIG: ..." keep their own explanation. */
export function reasonLabel(reason?: string): string | null {
  if (!reason) return null;
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  if (reason.startsWith("INACTIVE:")) return `Ngừng hoạt động — ${reason.slice(9).trim()}`;
  if (reason.startsWith("DISABLED_BY_CONFIG:")) return "Tắt trong cấu hình hệ thống";
  return reason.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** Only our own short codes are shown; any other backend error text is reduced to the status. */
export function publicError(error?: string): string | null {
  if (!error) return null;
  return /^(HTTP \d{3}|Tạm dừng đến \S+ sau HTTP \d{3})$/.test(error) ? error : null;
}

export function formatDuration(ms?: number): string | null {
  if (ms == null || ms <= 0) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function safeHttpUrl(url?: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export interface SourceSummary {
  checked: number;
  found: number;
  notFound: number;
  failed: number;
  rejected: number;
  disabled: number;
  /** Pipeline (Metadata Intelligence v2) lists the providers that yielded documents, not per-round statuses. */
  pipeline: boolean;
}

/** Counts as the backend defines them (isbn_rounds.build_verification); derived from
 *  sources[] the same way when an older/pipeline response has no verification block. */
export function summarizeSources(lookup: LookupBookByIsbnResponse): SourceSummary {
  const v = lookup.verification;
  const sources = lookup.sources || [];
  const count = (statuses: SourceStatus[]) => sources.filter((s) => statuses.includes(s.status)).length;
  if (v) {
    return {
      checked: v.totalSourcesChecked, found: v.sourcesFound, notFound: v.sourcesNotFound, failed: v.sourcesFailed,
      rejected: v.sourcesRejected, disabled: v.disabledSources.length, pipeline: false,
    };
  }
  return {
    checked: sources.filter((s) => !["DISABLED", "SKIPPED", "PAUSED"].includes(s.status)).length,
    found: count(["SUCCESS"]), notFound: count(["NOT_FOUND"]), failed: count(["TIMEOUT", "ERROR", "PAUSED"]),
    rejected: count(["MISMATCH", "DIFFERENT_EDITION"]), disabled: count(["DISABLED"]), pipeline: Boolean(lookup.intelligence),
  };
}

export type SourceKind = "catalog" | "library" | "publisher" | "store" | "web" | "ai";

/** What kind of place each source is - drawn as the tile icon so a list of names scans by type. */
const SOURCE_KIND: Partial<Record<IsbnSourceName, SourceKind>> = {
  catalog: "catalog",
  googleBooks: "library", openLibrary: "library", worldCat: "library",
  fahasa: "store", tiki: "store", vinabook: "store", phuongNam: "store", nhanVan: "store",
  webSearch: "web", aiWebSearch: "ai",
};

export function sourceKind(source: IsbnSourceName): SourceKind {
  return SOURCE_KIND[source] ?? "publisher";
}

export const SOURCE_KIND_META: Record<SourceKind, { label: string; icon: ComponentType<{ className?: string }> }> = {
  catalog: { label: "Kho SmartBook", icon: Library },
  library: { label: "Thư viện số / cơ sở dữ liệu sách", icon: BookMarked },
  publisher: { label: "Nhà xuất bản / nhà phát hành", icon: Building2 },
  store: { label: "Nhà sách trực tuyến", icon: Store },
  web: { label: "Tìm kiếm web", icon: Search },
  ai: { label: "AI đọc kết quả tìm kiếm web", icon: Sparkles },
};

export interface SourceTileData {
  source: IsbnSourceName;
  /** queued = announced by the backend, not asked yet; running = asked, no answer yet. */
  state: "queued" | "running" | "done";
  status?: SourceStatus;
  round?: 1 | 2;
  query?: string;
  durationMs?: number;
  attempts?: number;
  verification?: string;
  matchConfidence?: number;
  reason?: string;
  error?: string;
}

/** The tile's accessible name: everything its tooltip says, in one sentence. */
export function describeTile(tile: SourceTileData): string {
  const meta = tile.status ? SOURCE_STATUS_META[tile.status] : null;
  const parts = [
    SOURCE_LABELS[tile.source] || tile.source,
    SOURCE_KIND_META[sourceKind(tile.source)].label,
    tile.state === "running" ? "đang truy vấn" : meta ? meta.label.toLowerCase() : "chờ lượt",
    tile.round ? `vòng ${tile.round}` : null,
    tile.query && tile.query !== "-" ? QUERY_LABELS[tile.query]?.toLowerCase() : null,
    tile.verification ? (VERIFICATION_LABELS[tile.verification as keyof typeof VERIFICATION_LABELS] || tile.verification).toLowerCase() : null,
    tile.status && tile.status !== "SUCCESS" ? reasonLabel(tile.reason) || publicError(tile.error) : null,
  ];
  return parts.filter(Boolean).join(", ");
}

