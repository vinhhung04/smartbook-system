import { apiFetch } from './client';
import type { StockAuditDetail, StockAuditLine, StockAuditSummary } from '../types/stockAudit';

export function getMyAudits() {
  return apiFetch<{ data: StockAuditSummary[] }>('/api/stock-audits');
}

export function getAuditById(id: string) {
  return apiFetch<{ data: StockAuditDetail }>(`/api/stock-audits/${id}`);
}

export function submitLineCount(auditId: string, lineId: string, countedQty: number) {
  return apiFetch<{ data: StockAuditLine }>(`/api/stock-audits/${auditId}/lines/${lineId}`, {
    method: 'PATCH',
    body: { counted_qty: countedQty },
  });
}

export function submitAudit(auditId: string) {
  return apiFetch<{ data: { id: string; status: string } }>(`/api/stock-audits/${auditId}/submit`, {
    method: 'PATCH',
  });
}
