import { AI_TIMEOUT_MS, apiFetch } from './client';
import type { CustomerCatalogBook } from '../types/customerCatalog';

export type CoverSearchEvidence = { signal: 'visual' | 'ocr_text'; score: number; label: string };

export type CoverSearchCandidate = CustomerCatalogBook & {
  confidence: number;
  evidence: CoverSearchEvidence[];
};

export type CoverSearchResponse = {
  match_found: boolean;
  candidates: CoverSearchCandidate[];
  signals: {
    ocr_extracted: { title: string | null; author: string | null } | null;
    visual_gallery_size: number;
  };
};

// photoDataUrl comes from PhotoCaptureModal's onCaptured, a `data:image/jpeg;base64,...`
// string — converted to a Blob here (rather than changing PhotoCaptureModal's shared
// contract) so this stays the only place that needs to know the upload is multipart.
// Visual matching + OCR on CPU can take over a minute, hence the AI timeout; `signal`
// lets the screen cancel when the user leaves or retakes the photo.
export async function findBookByCover(photoDataUrl: string, signal?: AbortSignal): Promise<CoverSearchResponse> {
  const blob = await (await fetch(photoDataUrl)).blob();
  const formData = new FormData();
  formData.append('file', blob, 'cover.jpg');
  return apiFetch<CoverSearchResponse>('/ai/find-book-by-cover', {
    method: 'POST',
    body: formData,
    timeoutMs: AI_TIMEOUT_MS,
    signal,
  });
}

// ── Phase F: identification with evidence (POST /ai/vision/identify?stream=false) ──
// React Native's fetch cannot read a response stream, so the mobile client takes the
// one-shot JSON body. Scores are similarity / match scores, never a probability.
export type RecognitionStatus = 'IDENTIFIED' | 'AMBIGUOUS' | 'NO_MATCH';

export type RecognitionCandidate = {
  rank: number;
  book_id: string;
  title: string | null;
  authors: string[];
  isbn?: string | null;
  publisher?: string | null;
  cover_image_url?: string | null;
  match_basis: 'BOTH_SIGNALS' | 'VISUAL_ONLY' | 'TEXT_ONLY';
  visual_similarity: number | null;
  text_match_score: number | null;
  availability?: { available_quantity: number | null; branches: { name: string; available_quantity: number }[] } | null;
};

export type BookRecognition = {
  attachment_id: string;
  status: RecognitionStatus;
  candidates: RecognitionCandidate[];
  ocr: { title: string | null; author: string | null };
  signals: { ocr_status: string; visual_status: string; gallery_size: number; catalog_status: string };
  explanation: { summary: string; facts: string[]; inferences: string[]; unknowns: string[]; limitations: string[] };
};

/** The user saw the external-processing notice before taking the photo (the server requires it). */
export async function identifyBookByPhoto(photoDataUrl: string, signal?: AbortSignal): Promise<BookRecognition> {
  const blob = await (await fetch(photoDataUrl)).blob();
  const formData = new FormData();
  formData.append('file', blob, 'cover.jpg');
  formData.append('external_processing_ack', 'true');
  return apiFetch<BookRecognition>('/ai/vision/identify?stream=false', {
    method: 'POST',
    body: formData,
    timeoutMs: AI_TIMEOUT_MS,
    signal,
  });
}
