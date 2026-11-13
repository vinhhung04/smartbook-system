import { aiAPI, getToken } from './http-clients';

// Phase F client for the role-aware, multimodal and explainable AI surface:
// GET /ai/capabilities and POST /ai/vision/identify. Kept apart from ai.ts so
// the existing client stays as it was; chat/assistant only gained an optional
// `image` reference (see ai.ts).

export type ClaimVerdict = 'SUPPORTED' | 'CONTRADICTED' | 'UNSUPPORTED' | 'UNVERIFIABLE' | null;
export type ClaimKind = 'FACT' | 'INFERENCE' | 'ASSUMPTION' | 'UNKNOWN';

export interface AiEvidence {
  id: string;
  source_type: 'API' | 'DOCUMENT' | 'IMAGE_RECOGNITION' | 'OCR' | 'CLIP' | 'CATALOG' | string;
  source?: string | null;
  source_ref?: string | null;
  field?: string | null;
  value?: unknown;
  unit?: string | null;
  scope?: string;
  retrieved_at?: string | null;
  kind?: string;
  snippet?: string;
  label?: string;
}

/** The unified evidence contract shared by /chat and /assistant (ai_core/explainability.py). */
export interface AiExplainability {
  version: string;
  evidence: AiEvidence[];
  claims: Array<{ id: string; claim: string; kind: ClaimKind; verdict: ClaimVerdict; evidence_ids: string[]; detail: string }>;
  explanation: {
    facts: string[];
    inferences: string[];
    assumptions: string[];
    unknowns: string[];
    limitations: string[];
    method: string;
  };
  verification: {
    status: 'PASSED' | 'PARTIAL' | 'WARNING' | 'FAILED' | 'NO_FACTUAL_CLAIMS' | 'NO_EVIDENCE' | string;
    supported_claims: number;
    contradicted_claims: number;
    unsupported_claims: number;
    unverifiable_claims: number;
  };
}

export interface BookAvailability {
  available_quantity: number | null;
  availability_status?: string | null;
  branches: Array<{ name: string; available_quantity: number }>;
  borrow_count?: number | null;
  retrieved_at?: string;
}

export interface RecognitionCandidate {
  rank: number;
  book_id: string;
  variant_id?: string | null;
  title: string | null;
  authors: string[];
  isbn?: string | null;
  publisher?: string | null;
  cover_image_url?: string | null;
  match_basis: 'BOTH_SIGNALS' | 'VISUAL_ONLY' | 'TEXT_ONLY';
  visual_similarity: number | null;
  text_match_score: number | null;
  availability?: BookAvailability | null;
}

export type RecognitionStatus = 'IDENTIFIED' | 'AMBIGUOUS' | 'NO_MATCH';

export interface BookRecognition {
  attachment_id: string;
  status: RecognitionStatus;
  reasons: string[];
  candidates: RecognitionCandidate[];
  ocr: { title: string | null; author: string | null };
  signals: { ocr_status: string; visual_status: string; gallery_size: number; catalog_status: string };
  explanation: {
    summary: string;
    facts: string[];
    inferences: string[];
    unknowns: string[];
    limitations: string[];
    evidence: AiEvidence[];
  };
  expires_in_seconds: number;
}

export interface AiCapabilities {
  experience: 'decision_assistant' | 'library_operations' | 'warehouse_work' | 'reader' | 'supplier' | 'anonymous' | 'general';
  persona: { primary_role: string | null; roles: string[]; label: string };
  capabilities: Array<{ id: string; label: string; data_scope: string; personal: boolean; actions: string[]; requires_confirmation: boolean }>;
  starter_questions: string[];
  multimodal: { enabled: boolean; max_bytes: number; formats: string[]; notice: string };
}

/** The photo reference a chat / assistant turn may carry. */
export interface TurnImage {
  attachment_id: string;
  book_id?: string | null;
  /** The question was sent together with this photo. */
  image_turn?: boolean;
}

export type IdentifyStage =
  | 'uploading' | 'received' | 'analyzing' | 'text_read' | 'visual_done' | 'catalog_loaded' | 'matching_catalog';

export class AiHttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function readHttpError(response: Response, fallback: string): Promise<AiHttpError> {
  let detail = fallback;
  try {
    const body = await response.json();
    if (typeof body?.detail === 'string') detail = body.detail;
  } catch {
    // non-JSON error body: keep the fallback text
  }
  return new AiHttpError(detail, response.status);
}

export const aiExperienceService = {
  getCapabilities: async (): Promise<AiCapabilities> => (await aiAPI.get('/capabilities')).data,

  /**
   * Streams the real identification stages (SSE) and resolves with the
   * recognition. The photo is sent once; nothing is kept on the client
   * beyond the in-memory preview the caller owns.
   */
  identifyBook: async (
    file: File,
    onStage: (stage: IdentifyStage, ok?: boolean) => void,
    signal?: AbortSignal,
  ): Promise<BookRecognition> => {
    const form = new FormData();
    form.append('file', file);
    form.append('external_processing_ack', 'true');
    const token = getToken();
    onStage('uploading');
    const response = await fetch(`${aiAPI.defaults.baseURL || ''}/vision/identify`, {
      method: 'POST',
      body: form,
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok || !response.body) throw await readHttpError(response, 'Không gửi được ảnh.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: BookRecognition | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const raw of events) {
        let name = 'message';
        let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) name = line.slice(6).trim();
          else if (line.startsWith('data:')) data = line.slice(5).trim();
        }
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (name === 'status' && parsed.stage) onStage(parsed.stage as IdentifyStage, parsed.ok);
        else if (name === 'recognition') result = parsed as BookRecognition;
        else if (name === 'error') throw new AiHttpError(parsed.message || 'Không phân tích được ảnh.', 502);
      }
    }
    if (!result) throw new AiHttpError('Không nhận được kết quả nhận diện.', 502);
    return result;
  },
};
