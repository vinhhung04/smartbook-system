import type { IsbnLookupSource, IsbnSourceName, IsbnVerification, LookupBookByIsbnResponse } from "@/services/ai";
import type { LookupProgressEvent } from "@/services/lookup-progress-stream";

/**
 * What the lookup timeline shows, built only from what really happened:
 * - "live": events streamed by ai-service while the lookup ran;
 * - "replay": rebuilt after the fact from the response's own trace
 *   (verification.round1.attempts, sources[]) when no live channel was available.
 * "unreported" marks a step the backend did not report - shown as such, never guessed.
 */
export type PhaseState = "pending" | "active" | "done" | "skipped" | "failed" | "unreported";
export type ProgressChannel = "connecting" | "live" | "unavailable";

export interface SourceTrace {
  source: IsbnSourceName;
  round: 1 | 2;
  query?: "code" | "title" | "-";
  state: "queued" | "running" | "done";
  status?: IsbnLookupSource["status"];
  durationMs?: number;
  attempts?: number;
  verification?: IsbnVerification;
  reason?: string;
  errorCode?: string;
  sourceUrl?: string;
}

export interface LookupProgress {
  channel: ProgressChannel;
  /** The source rows came from the final response, not from live events. */
  replayed: boolean;
  lastSeq: number;
  validate: { state: PhaseState; kind?: string; code?: string };
  cache: { store: string; fallback: boolean } | null;
  fieldLevel: boolean;
  round1: { state: PhaseState; order: IsbnSourceName[]; matchedSource: IsbnSourceName | null };
  round2: { state: PhaseState; sources: IsbnSourceName[]; found?: number };
  fusion: { state: PhaseState; conflicts?: number; foundFields?: number; totalFields?: number; found?: boolean };
  pipeline: PhaseState;
  authority: PhaseState;
  ai: PhaseState;
  draft: PhaseState;
  duplicate: PhaseState;
  sources: SourceTrace[];
}

export function initialProgress(channel: ProgressChannel = "connecting"): LookupProgress {
  return {
    channel,
    replayed: false,
    lastSeq: 0,
    validate: { state: "pending" },
    cache: null,
    fieldLevel: false,
    round1: { state: "pending", order: [], matchedSource: null },
    round2: { state: "pending", sources: [] },
    fusion: { state: "pending" },
    pipeline: "pending",
    authority: "pending",
    ai: "pending",
    draft: "pending",
    duplicate: "pending",
    sources: [],
  };
}

const STAGE_STATE: Record<string, PhaseState> = { started: "active", done: "done", failed: "failed" };

function upsertSource(sources: SourceTrace[], round: 1 | 2, source: IsbnSourceName, patch: Partial<SourceTrace>): SourceTrace[] {
  const index = sources.findIndex((row) => row.round === round && row.source === source);
  if (index === -1) return [...sources, { source, round, state: "queued", ...patch }];
  const next = sources.slice();
  next[index] = { ...next[index], ...patch };
  return next;
}

/** Apply one event. Duplicate or late (out-of-order) events are ignored by sequence number. */
export function applyProgressEvent(state: LookupProgress, event: LookupProgressEvent): LookupProgress {
  if (!event || typeof event.seq !== "number" || event.seq <= state.lastSeq) return state;
  const next: LookupProgress = { ...state, channel: "live", lastSeq: event.seq };

  if (event.type === "source") {
    if (event.state === "started") {
      next.sources = upsertSource(state.sources, event.round, event.source, { state: "running", query: event.query });
    } else {
      next.sources = upsertSource(state.sources, event.round, event.source, {
        state: "done", query: event.query, status: event.status, durationMs: event.durationMs, attempts: event.attempts,
        verification: event.verification, reason: event.reason, errorCode: event.errorCode, sourceUrl: event.sourceUrl,
      });
    }
    return next;
  }

  const phase = STAGE_STATE[event.state] ?? "active";
  const detail = event.detail || {};
  switch (event.stage) {
    case "validate":
      next.validate = { state: phase, kind: typeof detail.kind === "string" ? detail.kind : undefined, code: typeof detail.code === "string" ? detail.code : undefined };
      break;
    case "cache":
      next.cache = { store: String(detail.store || "memory"), fallback: Boolean(detail.fallback) };
      break;
    case "retrieval":
      next.fieldLevel = detail.mode === "field-level";
      break;
    case "round1": {
      const order = Array.isArray(detail.order) ? (detail.order as IsbnSourceName[]) : state.round1.order;
      next.round1 = { state: phase, order, matchedSource: (detail.matchedSource as IsbnSourceName | null | undefined) ?? state.round1.matchedSource };
      if (event.state === "started") {
        // The backend announced the order: these sources are queued, one at a time.
        next.sources = order.reduce((rows, source) => (rows.some((row) => row.round === 1 && row.source === source)
          ? rows : [...rows, { source, round: 1 as const, state: "queued" as const, query: "code" as const }]), state.sources);
      }
      if (event.state === "done" && !detail.matchedSource) next.round2 = { ...state.round2, state: "skipped" };
      break;
    }
    case "round2": {
      const sources = Array.isArray(detail.sources) ? (detail.sources as IsbnSourceName[]) : state.round2.sources;
      next.round2 = { state: phase, sources, found: typeof detail.found === "number" ? detail.found : state.round2.found };
      if (event.state === "started") {
        next.sources = sources.reduce((rows, source) => (rows.some((row) => row.round === 2 && row.source === source)
          ? rows : [...rows, { source, round: 2 as const, state: "queued" as const }]), state.sources);
      }
      break;
    }
    case "fusion":
      next.fusion = {
        state: phase,
        conflicts: typeof detail.conflicts === "number" ? detail.conflicts : state.fusion.conflicts,
        foundFields: typeof detail.foundFields === "number" ? detail.foundFields : state.fusion.foundFields,
        totalFields: typeof detail.totalFields === "number" ? detail.totalFields : state.fusion.totalFields,
        found: typeof detail.found === "boolean" ? detail.found : state.fusion.found,
      };
      break;
    case "pipeline":
      next.pipeline = phase;
      break;
    case "authority":
      next.authority = phase;
      break;
    case "ai":
      next.ai = phase;
      break;
  }
  return next;
}

/** Source rows rebuilt from a finished response (no live events): Round 1 in its
 *  real order from verification.round1.attempts, Round 2 from sources[]. */
export function sourceRowsFromLookup(lookup: LookupBookByIsbnResponse): SourceTrace[] {
  const rows: SourceTrace[] = [];
  for (const attempt of lookup.verification?.round1.attempts || []) {
    rows.push({
      source: attempt.source, round: 1, query: "code", state: "done", status: attempt.status,
      durationMs: attempt.durationMs, attempts: attempt.attempts, reason: attempt.reason,
      verification: attempt.status === "SUCCESS" ? "CODE_MATCH" : undefined,
    });
  }
  for (const source of lookup.sources || []) {
    if (source.round !== 2) continue;
    rows.push({
      source: source.name, round: 2, query: source.query, state: "done", status: source.status,
      durationMs: source.durationMs, attempts: source.attempts, verification: source.verification,
      reason: source.reason, sourceUrl: source.sourceUrl,
    });
  }
  return rows;
}

/**
 * The finished lookup. A live channel keeps what it saw; anything it did not
 * report stays "unreported". Without a channel (or for a cached result, whose
 * sources were not asked again) the rows are rebuilt from the response's trace
 * and flagged as replayed.
 */
export function finishProgress(state: LookupProgress, lookup: LookupBookByIsbnResponse): LookupProgress {
  const live = state.channel === "live";
  const unreported = (phase: PhaseState): PhaseState => (phase === "pending" ? "unreported" : phase);
  const next: LookupProgress = {
    ...state,
    validate: { ...state.validate, state: unreported(state.validate.state) },
    round1: { ...state.round1, state: unreported(state.round1.state) },
    round2: { ...state.round2, state: unreported(state.round2.state) },
    fusion: { ...state.fusion, state: unreported(state.fusion.state) },
    pipeline: lookup.intelligence ? unreported(state.pipeline) : "skipped",
    authority: unreported(state.authority),
    ai: unreported(state.ai),
  };
  const hasLiveRows = live && state.sources.some((row) => row.state !== "queued" || row.status);
  if (!hasLiveRows && !lookup.intelligence) {
    next.sources = sourceRowsFromLookup(lookup);
    next.replayed = next.sources.length > 0;
    const verification = lookup.verification;
    if (verification) {
      // The trace itself says whether each round ran.
      next.round1 = { state: verification.round1.attempts.length ? "done" : next.round1.state, order: verification.round1.order, matchedSource: verification.round1.matchedSource };
      next.round2 = { ...next.round2, state: verification.round2Ran ? "done" : "skipped" };
    }
  }
  return next;
}

export function markClientStep(state: LookupProgress, step: "draft" | "duplicate", phase: PhaseState): LookupProgress {
  return { ...state, [step]: phase };
}

/** Counts for the "x / y nguồn đã trả lời" line - only from reported rows. */
export function sourceCounts(rows: SourceTrace[], round: 1 | 2) {
  const inRound = rows.filter((row) => row.round === round);
  return {
    total: inRound.length,
    answered: inRound.filter((row) => row.state === "done").length,
    running: inRound.filter((row) => row.state === "running").length,
  };
}
