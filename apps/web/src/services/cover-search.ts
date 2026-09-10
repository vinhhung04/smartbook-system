import { aiAPI } from './http-clients';
import { CustomerCatalogBook } from './customer-catalog';

export interface CoverSearchEvidence {
  signal: 'visual' | 'ocr_text';
  score: number;
  label: string;
}

export interface CoverSearchCandidate extends CustomerCatalogBook {
  confidence: number;
  evidence: CoverSearchEvidence[];
}

export interface CoverSearchResponse {
  match_found: boolean;
  candidates: CoverSearchCandidate[];
  signals: {
    ocr_extracted: { title: string | null; author: string | null } | null;
    visual_gallery_size: number;
  };
}

export const coverSearchService = {
  async findByCover(file: File): Promise<CoverSearchResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await aiAPI.post('/find-book-by-cover', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data as CoverSearchResponse;
  },
};
