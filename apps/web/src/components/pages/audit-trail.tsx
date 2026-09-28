import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import {
  ScrollText, RefreshCw, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { gatewayAPI } from '@/services/http-clients';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import { StatusBadge } from '@/components/status-badge';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { cn } from '@/components/ui/utils';

interface AuditLog {
  id: string;
  actor_user_id: string | null;
  action_name: string;
  entity_type: string;
  entity_id: string | null;
  before_data: unknown;
  after_data: unknown;
  created_at: string;
}

const ACTION_VARIANTS: Record<string, string> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'rose',
  PAY: 'amber',
  RETURN: 'violet',
  REQUEST: 'cyan',
};

const ENTITY_LABELS: Record<string, string> = {
  LOAN_TRANSACTION: 'Phiếu mượn',
  LOAN_ITEM: 'Sách trong phiếu mượn',
  RESERVATION: 'Đặt trước',
  FINE: 'Tiền phạt',
  CUSTOMER: 'Khách hàng',
};

const ENTITY_TYPES = Object.keys(ENTITY_LABELS);

function getActionVariant(action: string) {
  for (const [key, variant] of Object.entries(ACTION_VARIANTS)) {
    if (action.toUpperCase().includes(key)) return variant;
  }
  return 'neutral';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Only the fields whose value actually changed - a create lists every new field, an update just the edits. */
function buildDiff(before: unknown, after: unknown) {
  const b = isRecord(before) ? before : {};
  const a = isRecord(after) ? after : {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  return keys
    .filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]))
    .map((key) => ({ key, before: b[key], after: a[key] }));
}

function dayLabel(date: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Hôm qua';
  return date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : '—';
}

export function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [entityFilter, setEntityFilter] = useState('');
  const [searchAction, setSearchAction] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeLog = useCallback(() => setSelectedLog(null), []);
  useDialogA11y(Boolean(selectedLog), closeLog, modalRef);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page, pageSize: 20 };
      if (entityFilter) params.entity_type = entityFilter;
      if (searchAction) params.action_name = searchAction;

      const resp = await gatewayAPI.get('/borrow/audit-logs', { params });
      setLogs(resp.data?.data || []);
      setTotalPages(resp.data?.meta?.totalPages || 1);
    } catch (_err) {
      toast.error('Không tải được nhật ký kiểm tra');
    } finally {
      setLoading(false);
    }
  }, [page, entityFilter, searchAction]);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  const groups = useMemo(() => {
    const byDay = new Map<string, { label: string; items: AuditLog[] }>();
    for (const log of logs) {
      const date = new Date(log.created_at);
      const key = Number.isNaN(date.getTime()) ? 'unknown' : date.toDateString();
      if (!byDay.has(key)) byDay.set(key, { label: key === 'unknown' ? 'Không rõ thời gian' : dayLabel(date), items: [] });
      byDay.get(key)!.items.push(log);
    }
    return Array.from(byDay.values());
  }, [logs]);

  const diff = useMemo(
    () => (selectedLog ? buildDiff(selectedLog.before_data, selectedLog.after_data) : []),
    [selectedLog],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        icon={ScrollText}
        title="Nhật ký thao tác"
        description="Ai đã làm gì, lúc nào, trên phiếu mượn, đặt trước, tiền phạt và khách hàng"
        iconBg="bg-gradient-to-br from-slate-100 to-zinc-50 border border-slate-200/40 dark:from-slate-500/15 dark:to-zinc-500/10 dark:border-slate-500/20"
        iconColor="text-slate-600 dark:text-slate-400"
        actions={
          <button onClick={() => void loadLogs()} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-input bg-background text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all" style={{ fontWeight: 550 }}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới
          </button>
        }
      />

      <FilterBar
        searchValue={searchAction}
        onSearchChange={(value) => { setSearchAction(value); setPage(1); }}
        searchPlaceholder="Tìm theo tên hành động..."
        showSearchClear
        filters={
          <select value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
            aria-label="Lọc theo đối tượng"
            className="h-9 rounded-lg border border-input bg-background px-3 text-[12px] text-foreground focus:border-indigo-300 dark:focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-200 dark:focus:ring-indigo-500/20 outline-none">
            <option value="">Tất cả đối tượng</option>
            {ENTITY_TYPES.map((type) => <option key={type} value={type}>{ENTITY_LABELS[type]}</option>)}
          </select>
        }
      />

      <SectionCard noPadding className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />)}
          </div>
        ) : logs.length === 0 ? (
          <EmptyState variant="no-data" title="Không có dữ liệu" description="Chưa có nhật ký thao tác nào phù hợp với bộ lọc hiện tại." className="py-12" />
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="sticky top-0 z-10 border-y border-border bg-muted/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur first:border-t-0 sm:px-5">
                {group.label}
              </h2>
              <ul className="divide-y divide-border">
                {group.items.map((log) => (
                  <li key={log.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedLog(log)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:gap-4 sm:px-5"
                    >
                      <time
                        dateTime={log.created_at}
                        className="w-11 shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground"
                      >
                        {new Date(log.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                      </time>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <StatusBadge label={log.action_name} variant={getActionVariant(log.action_name)} />
                          <span className="text-[13px] font-medium text-foreground">{ENTITY_LABELS[log.entity_type] ?? log.entity_type}</span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                          #{shortId(log.entity_id)} · bởi {log.actor_user_id ? shortId(log.actor_user_id) : 'Hệ thống'}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </SectionCard>

      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">Trang {page} / {totalPages}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Trang trước"
            className="h-8 px-3 rounded-lg border border-input bg-background text-[12px] hover:bg-muted disabled:opacity-40 transition-all">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} aria-label="Trang sau"
            className="h-8 px-3 rounded-lg border border-input bg-background text-[12px] hover:bg-muted disabled:opacity-40 transition-all">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedLog(null)} role="dialog" aria-modal="true" aria-labelledby="audit-log-modal-title">
          <motion.div ref={modalRef} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h3 id="audit-log-modal-title" className="text-[14px] text-foreground" style={{ fontWeight: 650 }}>
                  {ENTITY_LABELS[selectedLog.entity_type] ?? selectedLog.entity_type}
                </h3>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                  <span className="font-mono">{selectedLog.action_name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{new Date(selectedLog.created_at).toLocaleString('vi-VN')}</span>
                </p>
              </div>
              <button onClick={() => setSelectedLog(null)} aria-label="Đóng" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-5">
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-muted-foreground">Mã đối tượng</dt><dd className="break-all font-mono text-foreground">{selectedLog.entity_id || '—'}</dd></div>
                <div className="min-w-0"><dt className="text-muted-foreground">Người thực hiện</dt><dd className="break-all font-mono text-foreground">{selectedLog.actor_user_id || 'Hệ thống'}</dd></div>
                <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Mã nhật ký</dt><dd className="break-all font-mono text-foreground">{selectedLog.id}</dd></div>
              </dl>

              <div>
                <p className="mb-2 text-[12px] font-semibold text-foreground">Thay đổi</p>
                {diff.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
                    Không có giá trị nào thay đổi trong bản ghi này.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border text-[12px]">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] gap-x-3 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>Trường</span><span>Trước</span><span>Sau</span>
                    </div>
                    <ul className="divide-y divide-border">
                      {diff.map((row) => (
                        <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] gap-x-3 px-3 py-2">
                          <span className="break-words font-mono text-foreground">{row.key}</span>
                          <span className={cn('break-words font-mono', row.before === undefined ? 'text-muted-foreground' : 'text-rose-700 dark:text-rose-400')}>{formatValue(row.before)}</span>
                          <span className={cn('break-words font-mono', row.after === undefined ? 'text-muted-foreground' : 'text-emerald-700 dark:text-emerald-400')}>{formatValue(row.after)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {(selectedLog.before_data || selectedLog.after_data) ? (
                <details className="group rounded-lg border border-border">
                  <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                    Xem dữ liệu JSON gốc
                  </summary>
                  <div className="space-y-3 border-t border-border p-3">
                    {selectedLog.before_data ? (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Trước</p>
                        <pre className="overflow-x-auto rounded-lg border border-rose-100 bg-rose-50 p-3 font-mono text-[11px] text-foreground dark:border-rose-500/20 dark:bg-rose-500/10">
                          {JSON.stringify(selectedLog.before_data, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                    {selectedLog.after_data ? (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Sau</p>
                        <pre className="overflow-x-auto rounded-lg border border-emerald-100 bg-emerald-50 p-3 font-mono text-[11px] text-foreground dark:border-emerald-500/20 dark:bg-emerald-500/10">
                          {JSON.stringify(selectedLog.after_data, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
