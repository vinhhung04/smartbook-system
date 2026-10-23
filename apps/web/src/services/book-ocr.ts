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
