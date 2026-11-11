import { ExternalLink, Quote } from 'lucide-react';
import type { MetadataPipeline } from '@/services/metadata-pipeline-types';
import type { ReconciliationDraft } from '@/services/metadata-intelligence';
import { fieldLabel, displayEvidenceValue } from './utils';

const ORIGINS = { SOURCE_DIRECT: 'Dữ liệu API', RULE_EXTRACTED: 'Trích xuất bằng rule', LLM_EXTRACTED: 'Qwen trích xuất' };
const STATUS_LABEL: Record<string, string> = { PENDING: 'Chờ duyệt', ACCEPTED: 'Đã chấp nhận', REJECTED: 'Không dùng' };

const btn = 'inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-border bg-card px-3 text-[12.5px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

export function ExtractionEvidencePanel({ bundle, draft, onDecide }: {
  bundle: MetadataPipeline; draft: ReconciliationDraft | null;
  onDecide: (field: string, status: 'ACCEPTED' | 'REJECTED', value?: unknown) => Promise<void>;
}) {
  return <section className="space-y-3 rounded-xl border border-border bg-card p-3.5" aria-label="Bằng chứng trích xuất metadata">
    <div>
      <h3 className="text-[13.5px] font-semibold text-foreground">Trích xuất có bằng chứng</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">Xem đoạn nguồn, kiểm tra ấn bản rồi duyệt từng trường. Điểm tin cậy là điểm quy tắc, không phải xác suất đúng.</p>
    </div>
    {bundle.warnings.length > 0 && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">Một phần nguồn chưa xử lý đầy đủ: {bundle.warnings.join(', ')}</p>}
    {!draft && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">Chưa lưu được bản nháp kiểm duyệt. Vui lòng tra cứu lại trước khi lưu catalog.</p>}
    {Object.entries(bundle.decisions).filter(([, d]) => d.selectedCandidateIds.length || d.alternativeCandidateIds.length).map(([field, decision]) => {
      const current = draft?.decisions.find(d => d.field === field);
      const ids = [...decision.selectedCandidateIds, ...decision.alternativeCandidateIds];
      const status = current?.status || decision.status;
      return <details key={field} className="rounded-lg border border-border p-3" open={current?.status === 'PENDING'}>
        <summary className="flex min-h-8 cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] focus-visible:outline-2 focus-visible:outline-ring">
          <span className="font-semibold text-foreground">{fieldLabel(field)}</span>
          <span className="min-w-0 truncate text-muted-foreground">{displayEvidenceValue(decision.proposedValue)}</span>
          <span className="text-[11.5px] tabular-nums text-muted-foreground">{Math.round(decision.confidence * 100)} điểm quy tắc</span>
          <span className={`ml-auto text-[11.5px] font-medium ${status === 'PENDING' ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground'}`}>{STATUS_LABEL[status] || status}</span>
        </summary>
        <div className="mt-3 space-y-3">
          {bundle.candidates.filter(c => ids.includes(c.id)).map(candidate => {
            const doc = bundle.documents.find(d => d.id === candidate.sourceDocumentId);
            return <div key={candidate.id} className="space-y-2 border-l-2 border-primary/30 pl-3 text-[12.5px]">
              <p className="text-muted-foreground">{ORIGINS[candidate.origin]} · {doc?.provider} · Ấn bản: {candidate.editionStatus}</p>
              <p className="font-medium text-foreground">{displayEvidenceValue(candidate.normalizedValue)}</p>
              {bundle.evidence.filter(e => candidate.evidenceIds.includes(e.id)).map(e => <blockquote key={e.id} className="flex gap-2 break-words rounded-lg bg-muted/50 p-2">
                <Quote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0">
                  {e.kind === 'TEXT_SPAN' ? <><mark className="whitespace-pre-wrap bg-amber-100 dark:bg-amber-500/20 dark:text-foreground">{e.quote}</mark><span className="block text-[11px] text-muted-foreground">Span {e.start}–{e.end}</span></> : <><code className="text-[11.5px]">{e.jsonPointer}</code><span className="block">{displayEvidenceValue(e.rawJsonValue)}</span></>}
                </span>
              </blockquote>)}
              <div className="flex flex-wrap items-center gap-2">
                {doc?.url && /^https?:\/\//.test(doc.url) && <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 text-primary underline-offset-2 hover:underline">Mở nguồn <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
                {current && <button type="button" className={btn} onClick={() => void onDecide(field, 'ACCEPTED', candidate.normalizedValue)}>Chọn giá trị nguồn này</button>}
              </div>
            </div>;
          })}
          {current && <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <button type="button" className={btn} onClick={() => void onDecide(field, 'ACCEPTED')}>Duyệt giá trị đang sửa</button>
            <button type="button" className={btn} onClick={() => void onDecide(field, 'REJECTED')}>Không sử dụng trường này</button>
          </div>}
        </div>
      </details>;
    })}
  </section>;
}
