import { useState } from 'react';
import { ChevronDown, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import type { AiExplainability } from '@/services/ai-experience';

// "Vì sao AI đưa ra kết quả này?" for one answer: the verification status
// (words, never a percentage), then on demand the claims with their verdict,
// the sources with retrieval time, assumptions, unknowns and limits. Collapsed
// by default so a short answer stays short.

const STATUS: Record<string, { label: string; icon: typeof ShieldCheck; tone: string }> = {
  PASSED: { label: 'Đã kiểm chứng với dữ liệu', icon: ShieldCheck, tone: 'text-emerald-700 dark:text-emerald-300' },
  PARTIAL: { label: 'Có bằng chứng một phần', icon: ShieldQuestion, tone: 'text-sky-700 dark:text-sky-300' },
  WARNING: { label: 'Có nội dung chưa đủ bằng chứng', icon: ShieldAlert, tone: 'text-amber-700 dark:text-amber-300' },
  FAILED: { label: 'Có mâu thuẫn với dữ liệu', icon: ShieldAlert, tone: 'text-rose-700 dark:text-rose-300' },
  NO_EVIDENCE: { label: 'Không thể xác định từ dữ liệu', icon: ShieldQuestion, tone: 'text-muted-foreground' },
};
const VERDICT: Record<string, string> = {
  SUPPORTED: 'Có bằng chứng', CONTRADICTED: 'Mâu thuẫn', UNSUPPORTED: 'Thiếu bằng chứng', UNVERIFIABLE: 'Không kiểm chứng được',
};
const KIND: Record<string, string> = { FACT: 'Dữ kiện', INFERENCE: 'Suy luận', ASSUMPTION: 'Giả định', UNKNOWN: 'Chưa biết' };
const SOURCE_TYPE: Record<string, string> = {
  API: 'Dữ liệu hệ thống', DOCUMENT: 'Tài liệu nội bộ', IMAGE_RECOGNITION: 'Nhận diện ảnh', OCR: 'OCR', CLIP: 'So khớp ảnh', CATALOG: 'Danh mục',
};

function time(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export function EvidencePanel({ explainability }: { explainability?: AiExplainability | null }) {
  const [open, setOpen] = useState(false);
  if (!explainability) return null;
  const { verification, claims, evidence, explanation } = explainability;
  if (verification.status === 'NO_FACTUAL_CLAIMS' && evidence.length === 0) return null;
  const status = STATUS[verification.status] ?? STATUS.PARTIAL;
  const Icon = status.icon;
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return (
    <div className="mt-1 w-full">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="inline-flex min-h-6 cursor-pointer items-center gap-1 text-[10.5px] font-medium focus-visible:outline-2 focus-visible:outline-ring">
        <Icon className={cn('h-3.5 w-3.5', status.tone)} aria-hidden="true" />
        <span className={status.tone}>{status.label}</span>
        <span className="text-muted-foreground">· Vì sao AI đưa ra kết quả này?</span>
        <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-1 space-y-2 rounded-lg border border-border bg-card p-2 text-[11px] leading-relaxed text-foreground">
          {claims.length > 0 && (
            <div>
              <p className="font-semibold">Từng nhận định</p>
              <ul className="space-y-1">
                {claims.map((c) => (
                  <li key={c.id} className="rounded bg-muted/50 px-1.5 py-1">
                    <span className="font-medium">{KIND[c.kind] ?? c.kind}</span>
                    {c.verdict && <span className="text-muted-foreground"> · {VERDICT[c.verdict] ?? c.verdict}</span>}
                    <span className="block">{c.claim}</span>
                    {c.detail && <span className="block text-muted-foreground">{c.detail}</span>}
                    {c.evidence_ids.length > 0 && (
                      <span className="block text-muted-foreground">
                        Nguồn: {c.evidence_ids.map((id) => byId.get(id)?.source).filter(Boolean).join(', ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evidence.length > 0 && (
            <div>
              <p className="font-semibold">Nguồn dữ liệu đã dùng</p>
              <ul className="space-y-1">
                {evidence.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{SOURCE_TYPE[e.source_type] ?? e.source_type}</span>: {e.label || e.source}
                    {e.value != null && typeof e.value !== 'object' && ` = ${String(e.value)}${e.unit ? ` ${e.unit}` : ''}`}
                    {time(e.retrieved_at) && <span className="text-muted-foreground"> · lúc {time(e.retrieved_at)}</span>}
                    {e.snippet && <q className="mt-0.5 block border-l-2 border-border pl-1.5 italic text-muted-foreground">{e.snippet}</q>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {[['Giả định', explanation.assumptions], ['Chưa xác định', explanation.unknowns],
            ['Giới hạn', explanation.limitations]].map(([title, items]) =>
            (items as string[]).length > 0 ? (
              <div key={title as string}>
                <p className="font-semibold">{title as string}</p>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {(items as string[]).map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ) : null)}
          {explanation.method && <p className="text-muted-foreground">{explanation.method}</p>}
        </div>
      )}
    </div>
  );
}
