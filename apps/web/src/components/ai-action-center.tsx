import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertTriangle, Bell, BookOpen, ChevronDown, ChevronRight, ClipboardList, FileText, Inbox, RefreshCw, ShoppingCart, Sparkles,
} from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { getStatusVariant } from '@/lib/status-registry';
import { AI_ACTION_TYPE_LABEL, AI_ACTION_STATUS_LABEL, AI_ACTION_RISK_LABEL, AI_AUDIT_EVENT_LABEL } from '@/lib/ai-action-labels';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/components/ui/utils';
import { ActionCard } from '@/components/ai-action-card';
import { aiService, type AiActionListItem, type AiActionDetail, type AiAuditLogEntry } from '@/services/ai';
import { getApiErrorMessage } from '@/services/http-clients';
import { toast } from 'sonner';
import { useSocket } from '@/lib/socket';
import { useAIActionRealtime } from '@/hooks/useAIActionRealtime';

// Action Center — lists AI-drafted actions (pending/executed/cancelled/failed/expired)
// with their audit trail. Complements the inline ActionCard shown in the chat itself
// (components/ai-action-card.tsx): that's for acting on an action right when the AI
// proposes it, this is for browsing what happened across the whole history.
// Wide screens get list + detail side by side; narrower ones open the detail in a sheet.

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'PENDING_CONFIRMATION', label: 'Chờ xác nhận' },
  { value: 'EXECUTED', label: 'Đã thực thi' },
  { value: 'CANCELLED', label: 'Đã hủy' },
  { value: 'FAILED', label: 'Thất bại' },
  { value: 'EXPIRED', label: 'Hết hạn' },
];

const TYPE_ICON: Record<string, typeof Sparkles> = {
  CREATE_REORDER_DRAFT: ShoppingCart,
  CREATE_REPORT_DRAFT: FileText,
  CREATE_RESERVATION_DRAFT: BookOpen,
  CREATE_STOCK_ALERT: Bell,
  CREATE_STAFF_TASK_DRAFT: ClipboardList,
};

const WIDE_QUERY = '(min-width: 1024px)';

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN');
}

function relative(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: vi });
}

function TypeTile({ type, className }: { type: string; className?: string }) {
  const Icon = TYPE_ICON[type] ?? Sparkles;
  return (
    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground', className)} aria-hidden="true">
      <Icon className="h-4 w-4" />
    </span>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex cursor-pointer items-center gap-1 rounded text-[12.5px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        {title}
      </button>
      {open && (
        <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-[11.5px] text-foreground">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AuditTimeline({ logs }: { logs: AiAuditLogEntry[] }) {
  if (!logs.length) return <p className="text-[12.5px] text-muted-foreground">Chưa có sự kiện nào.</p>;
  return (
    <ol className="relative space-y-3 border-l border-border pl-4">
      {logs.map((log, idx) => (
        <li key={idx} className="relative">
          <span className={cn('absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card',
            log.event_type === 'FAILED' ? 'bg-rose-500' : log.event_type === 'EXECUTED' ? 'bg-emerald-500' : 'bg-muted-foreground/50')}
            aria-hidden="true" />
          <p className="text-[13px] font-medium text-foreground">{AI_AUDIT_EVENT_LABEL[log.event_type] ?? log.event_type}</p>
          <p className="text-[12px] text-muted-foreground">
            {log.actor_user_id ?? 'hệ thống'}
            {log.actor_roles?.length ? ` (${log.actor_roles.join(', ')})` : ''} · <time dateTime={log.created_at}>{formatDate(log.created_at)}</time>
          </p>
          {(log.old_status || log.new_status) && (
            <p className="text-[11.5px] text-muted-foreground">
              {log.old_status ? `${AI_ACTION_STATUS_LABEL[log.old_status] ?? log.old_status} → ` : ''}
              {log.new_status ? AI_ACTION_STATUS_LABEL[log.new_status] ?? log.new_status : ''}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function ActionDetailPanel({ actionId }: { actionId: string }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<{ action: AiActionDetail; audit_logs: AiAuditLogEntry[] } | null>(null);

  const refetch = () => aiService.getActionDetail(actionId).then(setDetail).catch(() => {});

  useEffect(() => {
    // Keyed by actionId at the call site, so this runs once per action with fresh state.
    let cancelled = false;
    aiService
      .getActionDetail(actionId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setFailed(true);
        toast.error(getApiErrorMessage(err, 'Không tải được chi tiết hành động.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actionId]);

  // If this exact action changes elsewhere (e.g. confirmed from the chat tab while this
  // detail panel is open here), quietly refetch instead of leaving stale data on screen.
  useAIActionRealtime((_event, data) => {
    const eventActionId = (data as { action_id?: string } | null)?.action_id;
    if (eventActionId !== actionId) return;
    refetch();
  });

  if (loading && !detail) {
    return (
      <div className="space-y-3 p-5" aria-label="Đang tải chi tiết">
        <span className="block h-4 w-1/3 animate-pulse rounded bg-muted" />
        <span className="block h-6 w-2/3 animate-pulse rounded bg-muted" />
        <span className="block h-24 w-full animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  if (!detail) {
    return failed ? (
      <div className="p-5 text-[13px] text-muted-foreground">
        Không tải được chi tiết hành động.{' '}
        <button type="button" onClick={() => { setLoading(true); refetch().finally(() => setLoading(false)); }}
          className="cursor-pointer font-medium text-primary hover:underline">Thử lại</button>
      </div>
    ) : null;
  }

  const { action, audit_logs: auditLogs } = detail;

  return (
    <div className="space-y-5 p-4 sm:p-5">
      <header className="space-y-2">
        <p className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
          <TypeTile type={action.type} className="h-6 w-6 rounded-md [&_svg]:h-3.5 [&_svg]:w-3.5" />
          {AI_ACTION_TYPE_LABEL[action.type] ?? action.type}
        </p>
        <h3 className="text-[16px] font-semibold leading-snug text-foreground">{action.summary}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge label={AI_ACTION_STATUS_LABEL[action.status] ?? action.status} variant={getStatusVariant('aiAction', action.status)} dot />
          <StatusBadge label={AI_ACTION_RISK_LABEL[action.risk] ?? action.risk} variant={getStatusVariant('pendingActionRisk', action.risk)} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-[12px] sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Tạo lúc</dt><dd className="tabular-nums text-foreground">{formatDate(action.created_at)}</dd></div>
          {action.status === 'PENDING_CONFIRMATION' && action.expires_at && (
            <div><dt className="text-muted-foreground">Hết hạn</dt><dd className="tabular-nums text-foreground">{formatDate(action.expires_at)}</dd></div>
          )}
          {action.executed_at && <div><dt className="text-muted-foreground">Thực thi lúc</dt><dd className="tabular-nums text-foreground">{formatDate(action.executed_at)}</dd></div>}
          {action.cancelled_at && <div><dt className="text-muted-foreground">Từ chối lúc</dt><dd className="tabular-nums text-foreground">{formatDate(action.cancelled_at)}</dd></div>}
          {action.failed_at && <div><dt className="text-muted-foreground">Thất bại lúc</dt><dd className="tabular-nums text-foreground">{formatDate(action.failed_at)}</dd></div>}
        </dl>
        {action.created_from_message && (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-[12.5px] text-muted-foreground">
            Từ câu hỏi: <span className="text-foreground">“{action.created_from_message}”</span>
          </p>
        )}
      </header>

      {action.status === 'PENDING_CONFIRMATION' && (
        // Actions created outside a chat (e.g. the nightly briefing agent, conversation_id
        // null) have nowhere else to be confirmed/cancelled — this is their only surface.
        <ActionCard
          action={{ ...action, intent: action.intent ?? undefined }}
          onConfirmed={() => void refetch()}
          onCancelled={() => void refetch()}
        />
      )}

      {action.error_message && (
        <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span><span className="font-semibold">Lỗi khi thực thi: </span>{action.error_message}</span>
        </div>
      )}

      <section aria-label="Lịch sử audit" className="space-y-2">
        <h4 className="text-[13px] font-semibold text-foreground">Lịch sử audit</h4>
        <AuditTimeline logs={auditLogs} />
      </section>

      <section aria-label="Dữ liệu kỹ thuật" className="space-y-2 border-t border-border pt-4">
        {action.result != null && <JsonBlock title="Kết quả thực thi" value={action.result} />}
        <JsonBlock title="Nội dung (payload)" value={action.payload} />
      </section>
    </div>
  );
}

export function AIActionCenter() {
  const [items, setItems] = useState<AiActionListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { connected } = useSocket();
  const wide = useMediaQuery(WIDE_QUERY);
  const reloadTimerRef = useRef<number | null>(null);

  const load = () => {
    setLoading(true);
    aiService
      // mine:false — this is meant to be the system-wide history (see the comment
      // above), not "actions I personally triggered". The backend still forces
      // non-admins back to their own regardless, so this is a no-op for them and
      // only actually widens the view for admins — but without it, an action with
      // no creator (e.g. the nightly briefing agent, created_by_user_id null) can
      // never match anyone's "mine" filter and silently never appears here.
      .listActions({ status: statusFilter || undefined, limit: 50, mine: false })
      .then((res) => setItems(res.items))
      .catch((err) => toast.error(getApiErrorMessage(err, 'Không tải được danh sách hành động.')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // Action lifecycle events (created/confirmed/executed/failed/cancelled) can arrive as a
  // quick burst from one confirm click — debounce so that only triggers one refetch, not N.
  useAIActionRealtime(() => {
    if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(load, 300);
  });

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
    };
  }, []);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const pendingShown = items.filter((item) => item.status === 'PENDING_CONFIRMATION').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="order-last -mx-1 flex w-full min-w-0 gap-1 overflow-x-auto px-1 pb-0.5 sm:order-none sm:w-auto sm:flex-1" role="group" aria-label="Lọc theo trạng thái">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={statusFilter === f.value}
              onClick={() => { setStatusFilter(f.value); setSelectedId(null); }}
              className={cn('h-8 shrink-0 cursor-pointer rounded-lg px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                statusFilter === f.value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span
          className="mr-auto flex items-center gap-1.5 text-[12px] text-muted-foreground sm:mr-0"
          title={connected ? 'Đang nhận cập nhật trực tiếp' : 'Mất kết nối trực tiếp — danh sách chỉ cập nhật khi bấm Làm mới'}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} aria-hidden="true" />
          {connected ? 'Trực tiếp' : 'Ngoại tuyến'}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading} className="h-8">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Làm mới
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn('min-h-0 overflow-y-auto', wide ? 'w-[400px] shrink-0 border-r border-border' : 'flex-1')}>
          {!statusFilter && pendingShown > 0 && (
            <p className="flex items-center gap-1.5 border-b border-border bg-amber-50/70 px-4 py-2 text-[12.5px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200 sm:px-5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {pendingShown} đề xuất đang chờ xác nhận trong danh sách
            </p>
          )}
          {loading && items.length === 0 ? (
            <ul className="divide-y divide-border" aria-label="Đang tải">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex gap-3 px-4 py-3.5 sm:px-5">
                  <span className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
                  <span className="flex-1 space-y-2"><span className="block h-3.5 w-3/4 animate-pulse rounded bg-muted" /><span className="block h-3 w-1/3 animate-pulse rounded bg-muted" /></span>
                </li>
              ))}
            </ul>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><Inbox className="h-5 w-5" aria-hidden="true" /></span>
              <p className="mt-3 text-[14px] font-medium text-foreground">Chưa có hành động nào</p>
              <p className="mt-1 max-w-xs text-[12.5px] text-muted-foreground">
                {statusFilter ? 'Không có hành động nào ở trạng thái này.' : 'Các hành động AI đề xuất sẽ xuất hiện ở đây để bạn xác nhận và theo dõi.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const active = item.id === selectedId;
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => setSelectedId(active && !wide ? null : item.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn('flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5',
                        active ? 'bg-primary/[0.07]' : 'hover:bg-muted/50')}>
                      <TypeTile type={item.type} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[13.5px] font-medium leading-snug text-foreground">{item.summary}</span>
                        <span className="mt-0.5 block text-[12px] text-muted-foreground">
                          {AI_ACTION_TYPE_LABEL[item.type] ?? item.type} · <time dateTime={item.created_at} title={formatDate(item.created_at)}>{relative(item.created_at)}</time>
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          <StatusBadge label={AI_ACTION_STATUS_LABEL[item.status] ?? item.status} variant={getStatusVariant('aiAction', item.status)} dot />
                          <StatusBadge label={AI_ACTION_RISK_LABEL[item.risk] ?? item.risk} variant={getStatusVariant('pendingActionRisk', item.risk)} />
                        </span>
                      </span>
                      <ChevronRight className={cn('mt-2 h-4 w-4 shrink-0 text-muted-foreground', active && 'text-primary')} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {wide && (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {selected ? (
              <ActionDetailPanel key={selected.id} actionId={selected.id} />
            ) : (
              <div className="grid h-full place-items-center p-8 text-center">
                <div>
                  <p className="text-[14px] font-medium text-foreground">Chọn một hành động</p>
                  <p className="mt-1 max-w-xs text-[12.5px] text-muted-foreground">Xem chi tiết, xác nhận đề xuất đang chờ và lịch sử audit đầy đủ.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!wide && (
        <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
          <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
            <SheetTitle className="sr-only">{selected?.summary ?? 'Chi tiết hành động'}</SheetTitle>
            <SheetDescription className="sr-only">Chi tiết, xác nhận và lịch sử audit của hành động AI.</SheetDescription>
            {selected && <ActionDetailPanel key={selected.id} actionId={selected.id} />}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
