import { apiFetch } from './client';
import type { BarcodeResolveResult, BookSummary } from '../types/catalog';

export function findByBarcode(barcode: string) {
  return apiFetch<BarcodeResolveResult>(`/api/books/barcode/${encodeURIComponent(barcode)}`);
}

export function getBookById(bookId: string) {
  return apiFetch<BookSummary>(`/api/books/${bookId}`);
}
