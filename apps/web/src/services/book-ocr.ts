import { aiAPI } from './http-clients';
import type { LookupBookByIsbnResponse } from './ai';

export type OcrImageKind = 'front_cover' | 'back_cover' | 'copyright_page';

export type OcrFieldStatus =
  | 'EXTRACTED' | 'CORROBORATED' | 'CONFLICTED' | 'MISSING' | 'INVALID'
  | 'REVIEW_REQUIRED' | 'INFERRED' | 'LOOKUP_ONLY';

export type OcrProposalSource = 'images' | 'isbn_lookup' | 'images+isbn_lookup' | 'barcode' | 'rule';

export interface OcrObservation {
  source: string;
  value: unknown;
  normalizedValue: unknown;
  observedText: string | null;
  valid: boolean;
  issues: string[];
}

export type OcrVisualStatus = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'ILLEGIBLE';

/** Fractions (0-1) of the image's width/height. */
export interface OcrVisualBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrVisualEvidence {
  /** The image kind this check ran against (front_cover/back_cover/copyright_page). */
  source: string;
  status: OcrVisualStatus;
  /** The line(s) the second model read on that image that matched. */
  readText: string | null;
  /** Where the second model says it read those lines - its own estimate, never a verified position. */
  boxes: OcrVisualBox[];
}

export type AnomalySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type AnomalyType = 'ISBN_ANOMALY' | 'AUTHOR_TRANSLATOR_ANOMALY' | 'PUBLICATION_ANOMALY'
  | 'PHYSICAL_METADATA_ANOMALY' | 'CROSS_SOURCE_ANOMALY';

/** Feature B (rule-based v1) - every anomaly traces to a rule already computed
 *  elsewhere in book_ocr; this is only the severity-graded, explained packaging
 *  of it. Never auto-applied: recommendedAction is a suggestion for a person. */
export interface Anomaly {
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  affectedFields: string[];
  detectedValue: unknown;
  expectedValue: unknown;
  explanation: string;
  evidence: string[];
  recommendedAction: string;
  requiresHumanReview: boolean;
}

export interface OcrFieldResult {
  field: string;
  status: OcrFieldStatus;
  value: unknown;
  sources: string[];
  observations: OcrObservation[];
  reasons: string[];
}

export interface OcrProposal {
  formField: string;
  value: string | null;
  status: OcrFieldStatus;
  source: OcrProposalSource | null;
  safeToApply: boolean;
  reasons: string[];
  ocrValue: string | null;
  lookupValue: string | null;
  options: Array<{ source: string; value: string }>;
}

export interface OcrUsageCall {
  model: string;
  trigger: string;
  status: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  error: string | null;
}

export interface BookOcrScanResult {
  schemaVersion: string;
  promptVersion: string;
  status: 'SUCCESS' | 'PARTIAL' | 'NO_DATA';
  images: Array<{ kind: OcrImageKind; originalBytes: number; processedBytes: number; size: [number, number]; resized: boolean }>;
  metadata: {
    title: string | null; subtitle: string | null; authors: string[]; translators: string[];
    publisher: string | null; distributor: string | null; publishedYear: number | null; printYear: number | null;
    copyrightYear: number | null; editionStatement: string | null; isbn13: string | null; isbn10: string | null;
    pageCount: number | null; coverPrice: string | null; description: string | null; language: string | null;
  };
  fields: Record<string, OcrFieldResult>;
  fieldEvidence: Record<string, Array<{ source: string; observedText: string }>>;
  /** Feature A - per observation (keyed like `fields`, not `fieldEvidence`): a second
   *  model's blind re-read of that exact image checked against the reading taken
   *  from it. `{}` when the feature is off, over budget or the verifier failed. */
  visualEvidence: Record<string, OcrVisualEvidence[]>;
  /** Feature B (rule-based v1), sorted most severe first. */
  anomalies: Anomaly[];
  missingFields: string[];
  conflictedFields: string[];
  otherCodes: Array<{ source: string; label: string | null; value: string; observedText?: string | null }>;
  warnings: string[];
  isbnLookup: {
    status: 'FOUND' | 'NOT_FOUND' | 'SKIPPED_NO_VALID_ISBN' | 'SKIPPED_ISBN_CONFLICT' | 'TIMEOUT' | 'ERROR' | 'DISABLED';
    isbn: string | null;
    editionMatches: boolean | null;
    lookup: LookupBookByIsbnResponse | null;
  };
  proposals: Record<string, OcrProposal>;
  usage: {
    model: string | null; fallbackUsed: boolean; cacheHit: boolean; imageCount: number;
    promptTokens: number; completionTokens: number; costUsd: number | null; latencyMs: number; calls: OcrUsageCall[];
  };
  processingTimeMs: number;
}

export interface BookOcrCapabilities {
  enabled: boolean;
  imageKinds: OcrImageKind[];
  maxImages: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  acceptedTypes: string[];
  model: string;
  visualVerificationEnabled: boolean;
  visualVerificationModel: string | null;
}

export const bookOcrService = {
  capabilities: async (): Promise<BookOcrCapabilities> => (await aiAPI.get('/book-metadata/capabilities')).data,
  scan: async (
    images: Partial<Record<OcrImageKind, File>>,
    options: { barcode?: string | null; signal?: AbortSignal } = {},
  ): Promise<BookOcrScanResult> => {
    const formData = new FormData();
    for (const [kind, file] of Object.entries(images)) {
      if (file) formData.append(kind, file, file.name);
    }
    if (options.barcode) formData.append('barcode', options.barcode);
    // OCR (one model call) + the ISBN lookup can take a while; the server bounds both.
    const response = await aiAPI.post('/book-metadata/scan-images', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
      signal: options.signal,
    });
    return response.data;
  },
};
