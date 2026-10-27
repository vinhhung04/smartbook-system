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
