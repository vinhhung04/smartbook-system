export interface MetadataEvidence {
  id: string; sourceDocumentId: string; sourceRecordId: string; snapshotHash: string;
  kind: 'TEXT_SPAN' | 'JSON_POINTER'; quote?: string | null; jsonPointer?: string | null;
  rawJsonValue?: unknown; start?: number | null; end?: number | null;
  locatorValid: boolean; supportValidation: { supportsValue: boolean; supportsRole: boolean };
}
export interface MetadataCandidate {
  id: string; field: string; sourceDocumentId: string; sourceRecordId: string;
  rawValue: unknown; normalizedValue: unknown;
  origin: 'SOURCE_DIRECT' | 'RULE_EXTRACTED' | 'LLM_EXTRACTED';
  model?: string | null; evidenceIds: string[]; editionStatus: string;
  eligibleForFusion: boolean; rejectionReasons: string[];
}
export interface MetadataPipeline {
  schemaVersion: string; targetIsbn: string | null;
  documents: Array<{ id: string; provider: string; url: string | null; cleanText: string }>;
  candidates: MetadataCandidate[]; evidence: MetadataEvidence[];
  decisions: Record<string, { field: string; proposedValue: unknown; selectedCandidateIds: string[];
    alternativeCandidateIds: string[]; status: string; confidence: number; reasonCodes: string[] }>;
  provenance: Record<string, unknown>; warnings: string[]; usage: Array<Record<string, unknown>>;
  cacheHit: boolean; processingTimeMs: number;
}
