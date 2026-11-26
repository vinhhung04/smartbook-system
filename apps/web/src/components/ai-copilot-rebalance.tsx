import { AlertTriangle, ArrowRight, Check, CircleDashed, ClipboardCheck, Lock, RotateCw, Scale, Truck, Users, Warehouse, X } from 'lucide-react';
import type { AiExecution, AiRebalanceDecision, AiRebalanceOption, AiTimelineStage } from '@/services/ai';
import { cn } from '@/components/ui/utils';

// Inventory rebalancing cards: diagnosis (A), transfer opportunities (B),
// option comparison (C), budget (D), what-if difference (E), execution
// summary (G) and the stages the turn really completed. Every figure comes
// from the backend decision object (analytics /rebalancing-plan); nothing is
// computed here. A value the system does not have is shown as "Không có dữ liệu".

const NONE = 'Không có dữ liệu';

function num(v: number | null | undefined, suffix = ''): string {
  return v === null || v === undefined ? NONE : `${v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}${suffix}`;
}

function vnd(v: number | null | undefined): string {
  return v === null || v === undefined ? NONE : `${Math.round(v).toLocaleString('vi-VN')} ₫`;
}

function signed(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—';
  return `${v > 0 ? '+' : ''}${v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}${suffix}`;
}

const ACCESS_LABEL: Record<string, string> = { WRITE: 'Toàn quyền', READ: 'Chỉ xem' };
const PERMISSION: Record<string, { label: string; tone: string }> = {
  EXECUTABLE: { label: 'Bạn tự tạo được', tone: 'border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300' },
  COLLABORATIVE: { label: 'Cần Manager kho nguồn', tone: 'border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300' },
  PROPOSAL_ONLY: { label: 'Chỉ đề xuất', tone: 'border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300' },
};
const RISK: Record<string, string> = { LOW: 'Thấp', MEDIUM: 'Vừa', HIGH: 'Cao' };

function Tag({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={cn('inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded border px-1 text-[11px] font-normal', tone)}>{children}</span>;
}

function Card({ title, icon, children, testId }: { title: string; icon: React.ReactNode; children: React.ReactNode; testId: string }) {
  return (
    <section aria-label={title} data-testid={testId} className="rounded-xl border border-border bg-card p-3.5 sm:p-4">
      <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">{icon}{title}</p>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2.5 py-2">
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/** Stages the backend reports as completed for this turn - nothing is marked done ahead of it. */
export function ExecutionTimeline({ stages }: { stages?: AiTimelineStage[] }) {
  if (!stages?.length) return null;
  return (
    <ol aria-label="Tiến trình xử lý" data-testid="rebalance-timeline" className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
      {stages.map((s) => (
        <li key={s.key} data-status={s.status}
          className={cn('inline-flex items-center gap-1', s.status === 'done' ? 'text-foreground/80' : s.status === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground/70')}>
          {s.status === 'done' ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            : s.status === 'failed' ? <X className="h-3 w-3" aria-hidden="true" />
              : s.status === 'warning' ? <AlertTriangle className="h-3 w-3 text-amber-600" aria-hidden="true" />
                : <CircleDashed className="h-3 w-3" aria-hidden="true" />}
          {s.label}
          <span className="sr-only">: {s.status === 'done' ? 'đã xong' : s.status === 'failed' ? 'thất bại' : s.status === 'warning' ? 'có cảnh báo' : 'không thực hiện'}</span>
        </li>
      ))}
    </ol>
  );
}

function OptionsTable({ options }: { options: AiRebalanceOption[] }) {
  return (
    <div className="-mx-3.5 overflow-x-auto px-3.5 sm:-mx-4 sm:px-4">
      <table className="w-full min-w-[720px] border-collapse text-[12.5px] [&_td]:whitespace-nowrap [&_thead_th]:whitespace-nowrap" data-testid="rebalance-options">
        <caption className="sr-only">So sánh phương án điều chuyển và mua mới</caption>
        <thead>
          <tr className="border-b border-border text-left text-[11.5px] text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">Phương án</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Đáp ứng</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Chuyển / mua (bản)</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Chi phí mua mới</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Còn thiếu</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Thời gian</th>
            <th scope="col" className="py-2 text-right font-medium">Rủi ro</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => (
            <tr key={o.code} data-option={o.code} className={cn('border-b border-border/60 align-top last:border-0', o.is_best && 'bg-emerald-50/50 dark:bg-emerald-500/[0.06]')}>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                {o.label}
                <span className="mt-1 flex flex-wrap gap-1">
                  {o.is_best && <Tag tone="border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300">tốt nhất về nghiệp vụ</Tag>}
                  {o.is_executable && <Tag tone="border-sky-300 text-sky-700 dark:border-sky-500/40 dark:text-sky-300">bạn tự thực hiện được</Tag>}
                  {o.collaborative_transfer_lines > 0 && <Tag tone={PERMISSION.COLLABORATIVE.tone}>{o.collaborative_transfer_lines} dòng cần phối hợp</Tag>}
                </span>
              </th>
              <td className="py-2 pr-3 text-right tabular-nums">{num(o.shortage_covered_pct, '%')}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{num(o.transfer_qty)} / {num(o.purchase_qty)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{vnd(o.purchase_cost_vnd)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{num(o.remaining_shortage_qty)}{o.remaining_high_priority_qty ? ` (HIGH ${o.remaining_high_priority_qty})` : ''}</td>
              <td className="py-2 pr-3 text-right tabular-nums" title={o.response_days === null ? 'Thiếu dữ liệu thời gian điều chuyển' : undefined}>{o.response_days === null ? NONE : num(o.response_days, ' ngày')}</td>
              <td className="py-2 text-right">{RISK[o.risk_level] ?? o.risk_level}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RebalanceDecision({ decision, onRetry }: { decision?: AiRebalanceDecision | null; onRetry?: () => void }) {
  if (!decision || decision.kind !== 'rebalance') return null;
  if (decision.error) {
    const denied = decision.permission_denied;
    return (
      <div role="alert" data-testid="rebalance-error"
        className="flex flex-wrap items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        {denied ? <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="flex-1">{denied ? 'Bạn không có quyền xem kho được yêu cầu, nên không có số liệu nào được hiển thị.'
          : decision.scope_unavailable ? 'Chưa xác minh được quyền kho lúc này nên hệ thống không phân tích (an toàn mặc định).'
            : `Không lấy được dữ liệu điều chuyển: ${decision.error}`}</span>
        {!denied && onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-400 px-2 py-0.5 text-[12px] font-medium hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-amber-500/15">
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Thử lại
          </button>
        )}
      </div>
    );
  }
  if (!decision.scope?.length) {
    return (
      <p data-testid="rebalance-empty" className="rounded-xl border border-dashed border-border px-3.5 py-3 text-[13px] text-muted-foreground">
        {decision.notice || 'Tài khoản chưa được phân quyền đọc kho nào đang hoạt động, nên chưa có gì để phân tích.'}
      </p>
    );
  }
  const d = decision.diagnosis;
  const options = decision.options ?? [];
  const best = options.find((o) => o.is_best);
  const executable = options.find((o) => o.is_executable);
  const transfers = decision.transfers ?? [];
  const cmp = decision.comparison;
  const showBudget = decision.budget_vnd !== null && decision.budget_vnd !== undefined;
  return (
    <div className="space-y-3" data-testid="rebalance-decision">
      {decision.conclusion && <p className="text-[14px] font-medium leading-relaxed text-foreground">{decision.conclusion}</p>}

      {d && (
        <Card title="Chẩn đoán tồn kho" icon={<Warehouse className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} testId="rebalance-diagnosis">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Kho được phân tích" value={num(d.warehouses_analyzed)} />
            <Stat label="Đầu sách thiếu" value={num(d.shortage_variants)} />
            <Stat label="Đầu sách dư" value={num(d.surplus_variants)} />
            <Stat label="Nhu cầu dự kiến (bản)" value={num(d.forecast_demand_qty)} />
          </div>
          <ul className="mt-2.5 divide-y divide-border/70 text-[12.5px]">
            {d.per_warehouse.map((w) => (
              <li key={w.warehouse_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  {w.warehouse}
                  <Tag tone={w.access === 'WRITE' ? 'border-border text-muted-foreground' : PERMISSION.PROPOSAL_ONLY.tone}>{ACCESS_LABEL[w.access] ?? w.access}</Tag>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  thiếu {w.shortage_qty} bản ({w.shortage_variants} đầu sách) · dư {w.surplus_qty} bản ({w.surplus_variants}) · nhu cầu {num(w.forecast_demand_qty)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {transfers.length > 0 && (
        <Card title="Cơ hội điều chuyển" icon={<Truck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} testId="rebalance-transfers">
          <ul className="divide-y divide-border/70 text-[12.5px]">
            {transfers.map((t, i) => (
              <li key={`${t.variant_id}-${i}`} className="py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-medium text-foreground">{t.title}</span>
                  <Tag tone={(PERMISSION[t.permission] ?? PERMISSION.PROPOSAL_ONLY).tone}>{(PERMISSION[t.permission] ?? { label: t.permission }).label}</Tag>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1 tabular-nums text-muted-foreground">
                  {t.from_warehouse} <ArrowRight className="h-3 w-3" aria-hidden="true" /> {t.to_warehouse}: <b className="text-foreground">{t.quantity}</b> bản
                  · kho nguồn còn {num(t.source_available_after)} (giữ tối thiểu {num(t.source_protected_qty)})
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {options.length > 0 && (
        <Card title="So sánh phương án" icon={<Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} testId="rebalance-comparison">
          <OptionsTable options={options} />
          {decision.recommendation?.rule && <p className="mt-2 text-[11.5px] text-muted-foreground">Quy tắc xếp hạng: {decision.recommendation.rule}</p>}
        </Card>
      )}

      {showBudget && best && (
        <Card title="Phân bổ ngân sách mua mới" icon={<ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} testId="rebalance-budget">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Ngân sách" value={vnd(decision.budget_vnd)} />
            <Stat label="Chi phí mua mới" value={vnd(best.purchase_cost_vnd)} />
            <Stat label="Chi phí điều chuyển" value={best.transfer_cost_vnd === null ? NONE : vnd(best.transfer_cost_vnd)} />
            <Stat label="Ngân sách còn lại" value={vnd(best.remaining_budget_vnd)} />
            <Stat label="Mức đáp ứng thiếu hụt" value={num(best.shortage_covered_pct, '%')} />
            <Stat label="Còn thiếu" value={`${num(best.remaining_shortage_qty)} bản`} />
          </div>
          {executable && executable.code !== best.code && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Phần bạn tự thực hiện được ({executable.label}): mua {vnd(executable.purchase_cost_vnd)}, đáp ứng {num(executable.shortage_covered_pct, '%')}.
            </p>
          )}
        </Card>
      )}

      {cmp && (
        <Card title="So sánh kịch bản (trước → sau)" icon={<Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} testId="rebalance-whatif">
          <table className="w-full border-collapse text-[12.5px]">
            <caption className="sr-only">Kịch bản trước và kịch bản mới</caption>
            <thead>
              <tr className="border-b border-border text-left text-[11.5px] text-muted-foreground">
                <th scope="col" className="py-1.5 pr-3 font-medium">Chỉ số</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Trước</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Sau</th>
                <th scope="col" className="py-1.5 text-right font-medium">Chênh lệch</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Ngân sách', vnd(cmp.base.budget_vnd), vnd(cmp.current.budget_vnd), null],
                ['Mức đáp ứng', num(cmp.base.shortage_covered_pct, '%'), num(cmp.current.shortage_covered_pct, '%'), signed(cmp.diff.shortage_covered_pct, ' điểm %')],
                ['Còn thiếu (bản)', num(cmp.base.remaining_shortage_qty), num(cmp.current.remaining_shortage_qty), signed(cmp.diff.remaining_shortage_qty)],
                ['Chi phí mua mới', vnd(cmp.base.purchase_cost_vnd), vnd(cmp.current.purchase_cost_vnd), signed(cmp.diff.purchase_cost_vnd, ' ₫')],
                ['Bản điều chuyển', num(cmp.base.transfer_qty), num(cmp.current.transfer_qty), signed(cmp.diff.transfer_qty)],
                ['Ngân sách còn lại', vnd(cmp.base.remaining_budget_vnd), vnd(cmp.current.remaining_budget_vnd), signed(cmp.diff.remaining_budget_vnd, ' ₫')],
                ...(cmp.executable ? [
                  [`Bạn tự thực hiện (${cmp.executable.label}): mức đáp ứng`, num(cmp.executable.base.shortage_covered_pct, '%'), num(cmp.executable.current.shortage_covered_pct, '%'), signed(cmp.executable.diff.shortage_covered_pct, ' điểm %')],
                  ['Bạn tự thực hiện: còn thiếu (bản)', num(cmp.executable.base.remaining_shortage_qty), num(cmp.executable.current.remaining_shortage_qty), signed(cmp.executable.diff.remaining_shortage_qty)],
                  ['Bạn tự thực hiện: chi phí mua mới', vnd(cmp.executable.base.purchase_cost_vnd), vnd(cmp.executable.current.purchase_cost_vnd), signed(cmp.executable.diff.purchase_cost_vnd, ' ₫')],
                ] as const : []),
              ] as const).map(([label, a, b, diff], i) => (
                <tr key={label} data-row={i >= 6 ? 'executable' : 'best'} className={cn('border-b border-border/60 last:border-0', i === 6 && 'border-t-2 border-t-border')}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal text-foreground">{label}</th>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{a}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{b}</td>
                  <td className="py-1.5 text-right tabular-nums">{diff ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            Sáu dòng đầu: phương án tốt nhất về nghiệp vụ ({cmp.current.best_option ?? NONE}).
            {cmp.executable && ' Các dòng "Bạn tự thực hiện": phương án không cần kho khác phối hợp.'}
          </p>
        </Card>
      )}

      {(decision.assumptions?.length ?? 0) > 0 && (
        <details className="text-[12px] text-muted-foreground">
          <summary className="cursor-pointer">Giả định và giới hạn dữ liệu</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {decision.assumptions!.map((a) => <li key={a}>{a}</li>)}
            {decision.data_quality?.transfer_lead_time_days == null && <li>Thời gian điều chuyển: {NONE} (chưa đủ lịch sử).</li>}
          </ul>
        </details>
      )}
      {decision.evidence?.retrieved_at && (
        <p className="text-[11.5px] text-muted-foreground">Nguồn: {decision.evidence.source} · truy xuất {new Date(decision.evidence.retrieved_at).toLocaleString('vi-VN')}</p>
      )}
    </div>
  );
}

/** G. What confirming the draft really did: request codes, statuses, what another manager must do. */
export function ExecutionSummary({ execution }: { execution?: AiExecution | null }) {
  if (!execution || !execution.action_id) return null;
  const r = execution.result ?? {};
  const created = [...(r.created_transfers ?? []).map((t) => ({ ...t, kind: 'Yêu cầu điều chuyển' })),
    ...(r.created_purchase_requests ?? []).map((p) => ({ ...p, kind: 'Phiếu yêu cầu nhập' }))];
  return (
    <Card title="Kết quả thực hiện" icon={<ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} testId="rebalance-execution">
      <p className="mb-2 text-[12.5px]">Trạng thái: <b data-testid="execution-status">{execution.status ?? '—'}</b>{execution.error ? ` — ${execution.error}` : ''}</p>
      {created.length > 0 && (
        <ul className="divide-y divide-border/70 text-[12.5px]">
          {created.map((c, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>{c.kind} <b data-testid="execution-code">{c.number}</b> · {c.label}</span>
              <span className="text-muted-foreground">{c.status} · chờ duyệt theo quy trình</span>
            </li>
          ))}
        </ul>
      )}
      {(r.skipped?.length ?? 0) > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-amber-800 dark:text-amber-300">
          {r.skipped!.map((s, i) => <li key={i}>Không thực hiện: {s.label} — {s.reason}</li>)}
        </ul>
      )}
      {(r.proposals?.length ?? 0) > 0 && (
        <div className="mt-2">
          <p className="flex items-center gap-1 text-[12px] font-medium text-foreground"><Users className="h-3.5 w-3.5" aria-hidden="true" />Cần Manager khác xử lý</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
            {r.proposals!.map((p, i) => (
              <li key={i}>{p.title}: {p.quantity} bản {p.kind === 'TRANSFER' ? `${p.from_warehouse} → ${p.to_warehouse}` : `tại ${p.warehouse}`} — {p.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
