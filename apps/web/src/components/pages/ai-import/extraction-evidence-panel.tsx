import type { MetadataPipeline } from '@/services/metadata-pipeline-types';
import type { ReconciliationDraft } from '@/services/metadata-intelligence';
import { fieldLabel, displayEvidenceValue } from './utils';

const ORIGINS = { SOURCE_DIRECT: 'Dữ liệu API', RULE_EXTRACTED: 'Trích xuất bằng rule', LLM_EXTRACTED: 'Qwen trích xuất' };

export function ExtractionEvidencePanel({ bundle, draft, onDecide }: {
  bundle: MetadataPipeline; draft: ReconciliationDraft | null;
  onDecide: (field: string, status: 'ACCEPTED' | 'REJECTED', value?: unknown) => Promise<void>;
}) {
  return <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Bằng chứng trích xuất metadata">
    <h2 className="font-semibold">Trích xuất có bằng chứng</h2>
    <p className="text-sm text-muted-foreground">Xem đoạn nguồn, kiểm tra ấn bản rồi duyệt từng trường. Điểm tin cậy là điểm quy tắc, không phải xác suất đúng.</p>
    {bundle.warnings.length > 0 && <p role="status" className="text-sm text-amber-700">Một phần nguồn chưa xử lý đầy đủ: {bundle.warnings.join(', ')}</p>}
    {!draft && <p role="alert" className="text-sm text-destructive">Chưa lưu được bản nháp kiểm duyệt. Vui lòng tra cứu lại trước khi lưu catalog.</p>}
    {Object.entries(bundle.decisions).filter(([, d]) => d.selectedCandidateIds.length || d.alternativeCandidateIds.length).map(([field, decision]) => {
      const current = draft?.decisions.find(d => d.field === field);
      const ids = [...decision.selectedCandidateIds, ...decision.alternativeCandidateIds];
      return <details key={field} className="rounded-lg border p-3" open={current?.status === 'PENDING'}>
        <summary className="cursor-pointer text-sm font-medium">{fieldLabel(field)} · {displayEvidenceValue(decision.proposedValue)} · {Math.round(decision.confidence * 100)} điểm · {current?.status || decision.status}</summary>
        <div className="mt-3 space-y-3">
          {bundle.candidates.filter(c => ids.includes(c.id)).map(candidate => {
            const doc = bundle.documents.find(d => d.id === candidate.sourceDocumentId);
            return <div key={candidate.id} className="space-y-2 border-l-2 pl-3 text-sm">
              <p>{ORIGINS[candidate.origin]} · {doc?.provider} · Edition: {candidate.editionStatus}</p>
              <p className="font-medium">{displayEvidenceValue(candidate.normalizedValue)}</p>
              {bundle.evidence.filter(e => candidate.evidenceIds.includes(e.id)).map(e => <blockquote key={e.id} className="break-words rounded bg-muted p-2">
                {e.kind === 'TEXT_SPAN' ? <><mark className="whitespace-pre-wrap">{e.quote}</mark><span className="block text-xs text-muted-foreground">Span {e.start}–{e.end}</span></> : <><code>{e.jsonPointer}</code><p>{displayEvidenceValue(e.rawJsonValue)}</p></>}
              </blockquote>)}
              {doc?.url && /^https?:\/\//.test(doc.url) && <a href={doc.url} target="_blank" rel="noreferrer" className="underline">Mở nguồn</a>}
              {current && <button type="button" className="ml-3 rounded border px-3 py-1.5" onClick={() => void onDecide(field, 'ACCEPTED', candidate.normalizedValue)}>Chọn giá trị nguồn này</button>}
            </div>;
          })}
          {current && <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void onDecide(field, 'ACCEPTED')}>Duyệt giá trị đang sửa</button>
            <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void onDecide(field, 'REJECTED')}>Không sử dụng trường này</button>
          </div>}
        </div>
      </details>;
    })}
  </section>;
}
