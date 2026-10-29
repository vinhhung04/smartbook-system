import { useState } from 'react';
import { ChevronDown, CircleCheck, ClipboardList, Minus, Plus, Scale, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AiDecision } from '@/services/ai';

// Phase 6: the structured decision the backend builds from tool data
// (copilot_decision.py) - options side by side, pros / cons, risks,
// assumptions, a CONDITIONAL recommendation and the verification state.
// Nothing here is computed in the browser; the draft button only sends a
// message, and the backend still asks the user to confirm before creating
// any draft (no purchase order is created or approved automatically).

const VERIFICATION: Record<string, { label: string; tone: string }> = {
  PASSED: { label: 'Đã đối chiếu với dữ liệu', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' },
  REPAIRED: { label: 'Đã sửa số liệu theo dữ liệu', tone: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300' },
  WARNING: { label: 'Một số nhận định đã được lược bỏ', tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' },
  BLOCKED: { label: 'Câu trả lời không kiểm chứng được — chỉ dùng số liệu bên dưới', tone: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300' },
};

function vnd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value).toLocaleString('vi-VN')} ₫`;
}

function num(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}${suffix}`;
}

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-1 rounded text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        {title}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

/** Service level as a bar plus its number: the bar is the backend's own percentage, drawn to scale. */
function ServiceMeter({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) return <>—</>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
        <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
      {num(pct, '%')}
    </span>
  );
}

export function CopilotDecision({ decision, onDraft, disabled }: {
  decision?: AiDecision | null;
  onDraft?: (message: string) => void;
  disabled?: boolean;
}) {
  if (!decision || !decision.options?.length) return null;
  const status = decision.verification?.status ?? '';
  const badge = VERIFICATION[status];
  return (
    <section aria-label="Phân tích quyết định" className="overflow-hidden rounded-xl border border-border bg-card" data-testid="copilot-decision">
      <div className="space-y-3 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Phân tích quyết định
          </p>
          {badge && (
            <span className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${badge.tone}`} data-testid="decision-verification">
              {status === 'BLOCKED' ? <ShieldAlert className="h-3 w-3" aria-hidden="true" /> : <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
              {badge.label}
            </span>
          )}
        </div>

        <p className="text-[14px] font-medium leading-relaxed text-foreground">{decision.conclusion}</p>

        <div className="-mx-3.5 overflow-x-auto px-3.5 sm:-mx-4 sm:px-4">
          <table className="w-full min-w-[540px] border-collapse text-[12.5px]" data-testid="decision-options">
            <caption className="sr-only">So sánh các phương án</caption>
            <thead>
              <tr className="border-b border-border text-left text-[11.5px] text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">Phương án</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Chi phí duyệt</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Đầu sách / bản</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium" title="Phần nhu cầu dự kiến trong thời gian chờ hàng được đáp ứng (mô hình Poisson của analytics)">Mức đáp ứng</th>
                <th scope="col" className="py-2 text-right font-medium">Ưu tiên cao bị bỏ lại</th>
              </tr>
            </thead>
            <tbody>
              {decision.options.map((o) => (
                <tr key={o.label} className={`border-b border-border/60 align-top last:border-0 ${o.is_least_risk ? 'bg-emerald-50/50 dark:bg-emerald-500/[0.06]' : ''}`}>
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                    {o.label}
                    <span className="mt-1 flex flex-wrap gap-1">
                      {o.kind === 'condition' && (
                        <span className="rounded border border-slate-300 px-1 text-[11px] font-normal text-slate-600 dark:border-slate-500/40 dark:text-slate-300">
                          điều kiện giả định
                        </span>
                      )}
                      {o.is_least_risk && (
                        <span className="inline-flex items-center gap-0.5 rounded border border-emerald-300 px-1 text-[11px] font-normal text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300">
                          <CircleCheck className="h-3 w-3" aria-hidden="true" />
                          ít rủi ro nhất
                        </span>
                      )}
                    </span>
                  </th>
                  <td className="py-2 pr-3 text-right tabular-nums">{vnd(o.funded_cost)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{num(o.funded_lines)} / {num(o.funded_qty)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums"><ServiceMeter pct={o.expected_service_pct} /></td>
                  <td className="py-2 text-right tabular-nums">{num(o.unfunded_high_priority)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {decision.options.map((o) => (o.pros.length || o.cons.length ? (
            <div key={`pc-${o.label}`} className="rounded-lg border border-border/70 p-2.5 text-[12.5px]">
              <p className="mb-1.5 font-medium text-foreground">{o.label}</p>
              <ul className="space-y-1">
                {o.pros.map((p) => (
                  <li key={p} className="flex gap-1.5 text-foreground">
                    <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Lợi ích" />{p}
                  </li>
                ))}
                {o.cons.map((c) => (
                  <li key={c} className="flex gap-1.5 text-foreground">
                    <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Đánh đổi" />{c}
                  </li>
                ))}
              </ul>
            </div>
          ) : null))}
        </div>

        <div className="rounded-lg border-l-[3px] border-primary bg-primary/[0.05] py-2.5 pl-3.5 pr-3 text-[13px] leading-relaxed text-foreground" data-testid="decision-recommendation">
          <p className="font-semibold text-primary">Khuyến nghị có điều kiện</p>
          <p>{decision.recommendation.condition}</p>
        </div>

        {decision.risks.length > 0 && (
          <ul className="space-y-1 text-[12.5px]" aria-label="Rủi ro">
            {decision.risks.map((r) => (
              <li key={r} className="flex gap-1.5 text-amber-800 dark:text-amber-300">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
        )}

        <Collapsible title="Giả định, số liệu và nguồn">
          <div className="space-y-1.5 rounded-lg bg-muted/40 p-2.5 text-[12px] text-muted-foreground">
            <ul className="list-disc space-y-0.5 pl-4">
              {decision.assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
            <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
              {decision.data_points.map((d) => (
                <div key={d.label} className="flex justify-between gap-2">
                  <dt>{d.label}</dt>
                  <dd className="tabular-nums text-foreground">{d.unit === 'đ' ? vnd(d.value) : `${num(d.value)} ${d.unit}`}</dd>
                </div>
              ))}
            </dl>
            {decision.evidence.map((e) => (
              <p key={e.source}>Nguồn: {e.source}{e.as_of ? ` · truy xuất ${new Date(e.as_of).toLocaleString('vi-VN')}` : ''}</p>
            ))}
          </div>
        </Collapsible>
      </div>

      {decision.next_step && onDraft && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-muted/30 px-3.5 py-3 sm:px-4">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDraft(decision.next_step!.message)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="decision-draft"
          >
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            {decision.next_step.label}: {decision.next_step.option}
          </button>
          <span className="text-[12px] text-muted-foreground">{decision.next_step.note}</span>
        </div>
      )}
    </section>
  );
}
