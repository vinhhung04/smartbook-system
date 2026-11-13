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
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageWrapper, FadeItem } from '../motion-utils';
import { useMediaQuery } from './ai-import/use-media-query';
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

/** What changed in one log entry; shown in the side panel on wide screens and in a dialog on phones. */
function LogDetail({ log }: { log: AuditLog }) {
  const diff = buildDiff(log.before_data, log.after_data);
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <div className="min-w-0"><dt className="text-muted-foreground">Mã đối tượng</dt><dd className="break-all font-mono text-foreground">{log.entity_id || '—'}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Người thực hiện</dt><dd className="break-all font-mono text-foreground">{log.actor_user_id || 'Hệ thống'}</dd></div>
        <div className="min-w-0 sm:col-span-2 lg:col-span-1 xl:col-span-2"><dt className="text-muted-foreground">Mã nhật ký</dt><dd className="break-all font-mono text-foreground">{log.id}</dd></div>
      </dl>

      <div>
        <p className="mb-2 text-[12px] font-semibold text-foreground">Thay đổi</p>
        {diff.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
            Không có giá trị nào thay đổi trong bản ghi này.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border text-[12px]">
            {diff.map((row) => (
              <li key={row.key} className="px-3 py-2">
                <p className="break-words font-mono font-medium text-foreground">{row.key}</p>
                <p className="mt-0.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
                  <span className="text-muted-foreground">Trước</span>
                  <span className={cn('break-words font-mono', row.before === undefined ? 'text-muted-foreground' : 'text-rose-700 dark:text-rose-400')}>{formatValue(row.before)}</span>
                  <span className="text-muted-foreground">Sau</span>
                  <span className={cn('break-words font-mono', row.after === undefined ? 'text-muted-foreground' : 'text-emerald-700 dark:text-emerald-400')}>{formatValue(row.after)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(log.before_data || log.after_data) ? (
        <details className="group rounded-lg border border-border">
          <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Xem dữ liệu JSON gốc
          </summary>
          <div className="space-y-3 border-t border-border p-3">
            {log.before_data ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Trước</p>
                <pre className="overflow-x-auto rounded-lg border border-rose-100 bg-rose-50 p-3 font-mono text-[11px] text-foreground dark:border-rose-500/20 dark:bg-rose-500/10">
                  {JSON.stringify(log.before_data, null, 2)}
                </pre>
              </div>
            ) : null}
            {log.after_data ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Sau</p>
                <pre className="overflow-x-auto rounded-lg border border-emerald-100 bg-emerald-50 p-3 font-mono text-[11px] text-foreground dark:border-emerald-500/20 dark:bg-emerald-500/10">
                  {JSON.stringify(log.after_data, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
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
  // Wide screens show the selected entry in a side panel; phones keep the dialog.
  const wide = useMediaQuery('(min-width: 1024px)');
  useDialogA11y(Boolean(selectedLog) && !wide, closeLog, modalRef);

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

  const entitySelect = (
    <Select value={entityFilter || 'all'} onValueChange={(value) => { setEntityFilter(value === 'all' ? '' : value); setPage(1); }}>
      <SelectTrigger className="h-9 w-full sm:w-[220px]" aria-label="Lọc theo đối tượng">
        <SelectValue placeholder="Tất cả đối tượng" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tất cả đối tượng</SelectItem>
        {ENTITY_TYPES.map((type) => <SelectItem key={type} value={type}>{ENTITY_LABELS[type]}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={ScrollText}
          title="Nhật ký thao tác"
          description="Ai đã làm gì, lúc nào, trên phiếu mượn, đặt trước, tiền phạt và khách hàng"
          iconBg="bg-slate-100 dark:bg-slate-500/15"
          iconColor="text-slate-600 dark:text-slate-400"
          actions={
            <Button variant="outline" size="sm" onClick={() => void loadLogs()} disabled={loading} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Làm mới
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <FilterBar
            searchValue={searchAction}
            onSearchChange={(value) => { setSearchAction(value); setPage(1); }}
            searchPlaceholder="Tìm theo tên hành động, ví dụ MARK_ITEM_OVERDUE..."
            showSearchClear
            filters={entitySelect}
          />
        </div>
      </FadeItem>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <FadeItem>
          <SectionCard noPadding className="overflow-hidden">
            {loading ? (
              <div className="space-y-2 p-4" aria-busy="true">
                {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60 motion-reduce:animate-none" />)}
              </div>
            ) : logs.length === 0 ? (
              <EmptyState
                variant={searchAction || entityFilter ? 'no-results' : 'no-data'}
                title="Không có nhật ký phù hợp"
                description={searchAction || entityFilter ? 'Thử bỏ bộ lọc hoặc tìm tên hành động khác.' : 'Thao tác trên phiếu mượn, đặt trước, tiền phạt và khách hàng sẽ được ghi lại ở đây.'}
                className="py-12"
              />
            ) : (
              groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h2 className="sticky top-0 z-10 border-y border-border bg-muted/80 px-4 py-2 text-[12px] font-semibold text-foreground backdrop-blur first:border-t-0 sm:px-5">
                    {group.label}
                    <span className="ml-2 font-normal text-muted-foreground">{group.items.length} thao tác</span>
                  </h2>
                  <ul className="divide-y divide-border">
                    {group.items.map((log) => {
                      const active = selectedLog?.id === log.id;
                      return (
                        <li key={log.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedLog(log)}
                            aria-current={active ? 'true' : undefined}
                            className={cn(
                              'group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:bg-muted/40 focus-visible:outline-none sm:gap-4 sm:px-5',
                              active ? 'bg-indigo-50/70 dark:bg-indigo-500/10' : 'hover:bg-muted/40',
                            )}
                          >
                            <time dateTime={log.created_at} className="w-11 shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                              {new Date(log.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                            </time>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-[13px] font-medium text-foreground">{ENTITY_LABELS[log.entity_type] ?? log.entity_type}</span>
                                <StatusBadge label={log.action_name} variant={getActionVariant(log.action_name)} />
                              </div>
                              <p className="mt-1 truncate text-[12px] text-muted-foreground">
                                <span className="font-mono">#{shortId(log.entity_id)}</span>, bởi {log.actor_user_id ? <span className="font-mono">{shortId(log.actor_user_id)}</span> : 'hệ thống'}
                              </p>
                            </div>
                            <ChevronRight className={cn('h-4 w-4 shrink-0 transition-colors', active ? 'text-indigo-500' : 'text-muted-foreground/40 group-hover:text-muted-foreground')} aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
            <div className="flex items-center justify-between border-t border-border px-4 py-3 sm:px-5">
              <p className="text-[12px] text-muted-foreground">Trang <span className="font-medium text-foreground">{page}</span> / {totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Trang trước">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} aria-label="Trang sau">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </SectionCard>
        </FadeItem>

        {wide && (
          <FadeItem className="lg:sticky lg:top-4 lg:self-start">
            <SectionCard
              title={selectedLog ? (ENTITY_LABELS[selectedLog.entity_type] ?? selectedLog.entity_type) : 'Chi tiết thao tác'}
              subtitle={selectedLog ? `${selectedLog.action_name}, ${new Date(selectedLog.created_at).toLocaleString('vi-VN')}` : undefined}
              actions={selectedLog ? (
                <button onClick={closeLog} aria-label="Bỏ chọn" className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="h-4 w-4" />
                </button>
              ) : undefined}
            >
              {selectedLog ? (
                <div className="max-h-[calc(100vh-14rem)] overflow-y-auto pr-1"><LogDetail log={selectedLog} /></div>
              ) : (
                <p className="text-[13px] text-muted-foreground">Chọn một dòng bên trái để xem trường nào đã thay đổi, giá trị trước và sau.</p>
              )}
            </SectionCard>
          </FadeItem>
        )}
      </div>

      {selectedLog && !wide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeLog} role="dialog" aria-modal="true" aria-labelledby="audit-log-modal-title">
          <motion.div ref={modalRef} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h3 id="audit-log-modal-title" className="text-[14px] font-semibold text-foreground">
                  {ENTITY_LABELS[selectedLog.entity_type] ?? selectedLog.entity_type}
                </h3>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  <span className="font-mono">{selectedLog.action_name}</span>, {new Date(selectedLog.created_at).toLocaleString('vi-VN')}
                </p>
              </div>
              <button onClick={closeLog} aria-label="Đóng" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-5"><LogDetail log={selectedLog} /></div>
          </motion.div>
        </div>
      )}
    </PageWrapper>
  );
}
