import { apiFetch } from './client';
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
export async function findBookByCover(photoDataUrl: string): Promise<CoverSearchResponse> {
  const blob = await (await fetch(photoDataUrl)).blob();
  const formData = new FormData();
  formData.append('file', blob, 'cover.jpg');
  return apiFetch<CoverSearchResponse>('/ai/find-book-by-cover', { method: 'POST', body: formData });
}
