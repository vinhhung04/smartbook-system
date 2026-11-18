import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, BookOpen, CheckCircle2, Hand, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '@/components/motion-utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/components/ui/utils';
import { useSocketEvent } from '@/lib/socket';
import { getApiErrorCode, getApiErrorMessage } from '@/services/http-clients';
import { incidentService, type IncidentDetail, type MonitoringCapabilities } from '@/services/incidents';
import { CATEGORY_LABEL, CHANNEL_LABEL, DELIVERY_LABEL, EVENT_LABEL, SUPPRESS_REASON, formatDateTime, incidentAge } from './admin-monitor/incident-format';
import { SeverityBadge, StatusPill } from './admin-monitor/incident-badges';

type Action = 'acknowledge' | 'resolve' | null;

function eventDetail(event: IncidentDetail['events'][number]) {
  const reason = typeof event.payload?.reason === 'string' ? SUPPRESS_REASON[event.payload.reason] : null;
  if (reason) return `Lý do: ${reason}.`;
  if (event.event_type === 'SEVERITY_ESCALATED') return `Từ ${String(event.payload.from)} lên ${String(event.payload.to)}.`;
  if (event.event_type === 'REOPENED') return `Lần xuất hiện thứ ${String(event.payload.occurrence)}.`;
  return null;
}

export function AdminMonitorIncidentPage() {
  const { id = '' } = useParams();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [can, setCan] = useState<MonitoringCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [actionNote, setActionNote] = useState('');
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, capabilities] = await Promise.all([incidentService.get(id), incidentService.capabilities().catch(() => null)]);
      setIncident(detail);
      setCan(capabilities);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được sự cố'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  // Another administrator (or Grafana) changed this incident: show it.
  useSocketEvent<{ incident_id?: string }>('incident:notification', (data) => { if (data?.incident_id === id) void load(); });

  const runAction = async () => {
    if (!incident || !action) return;
    try {
      const fn = action === 'acknowledge' ? incidentService.acknowledge : incidentService.resolve;
      await fn(incident.id, incident.version, actionNote.trim() || undefined);
      toast.success(action === 'acknowledge' ? 'Đã tiếp nhận sự cố' : 'Đã đánh dấu sự cố đã xử lý');
      setAction(null);
      setActionNote('');
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Không cập nhật được sự cố'));
      if (getApiErrorCode(err) === 'VERSION_CONFLICT' || getApiErrorCode(err) === 'INVALID_STATE') { setAction(null); await load(); }
    }
  };

  const saveNote = async () => {
    if (!incident || !note.trim()) return;
    setSavingNote(true);
    try {
      await incidentService.addNote(incident.id, note.trim());
      setNote('');
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Không lưu được ghi chú'));
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) return <PageWrapper><SectionCard><LoadingOverlay /></SectionCard></PageWrapper>;
  if (error || !incident) {
    return (
      <PageWrapper>
        <SectionCard>
          <EmptyState variant="error" title="Không tải được sự cố" description={error || 'Không tìm thấy sự cố'}
            action={<Button asChild variant="outline"><Link to="/admin/monitor?tab=incidents"><ArrowLeft className="h-4 w-4" />Về danh sách sự cố</Link></Button>} />
        </SectionCard>
      </PageWrapper>
    );
  }

  const canManage = Boolean(can?.manage);
  const facts: Array<[string, string]> = [
    ['Dịch vụ', incident.service_name],
    ['Phân loại', CATEGORY_LABEL[incident.category]],
    ['Nguồn', incident.source === 'GRAFANA' ? `Grafana${incident.rule_uid ? ` · ${incident.rule_uid}` : ''}` : 'healthcheck.sh'],
    ['Phát hiện lúc', formatDateTime(incident.first_seen_at, true)],
    ['Gần nhất', formatDateTime(incident.last_seen_at, true)],
    ['Số lần xuất hiện', String(incident.occurrence_count)],
    ['Thời gian tồn tại', incidentAge(incident)],
    ['Người tiếp nhận', incident.acknowledged_by_name ? `${incident.acknowledged_by_name} · ${formatDateTime(incident.acknowledged_at)}` : '—'],
    ['Xử lý', incident.resolved_at ? `${incident.resolution_type === 'AUTO' ? 'Tự phục hồi' : incident.resolved_by_name || 'Thủ công'} · ${formatDateTime(incident.resolved_at)}` : '—'],
  ];

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <Link to="/admin/monitor?tab=incidents" className="mb-3 inline-flex items-center gap-1.5 rounded text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Danh sách sự cố
        </Link>
        <PageHeader
          title={incident.title}
          description={<span className="inline-flex flex-wrap items-center gap-2"><SeverityBadge severity={incident.severity} /><StatusPill status={incident.status} /><span>{incident.service_name}</span></span>}
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="gap-2"><RefreshCw className="h-4 w-4" />Tải lại</Button>
              {canManage && incident.status === 'OPEN' ? <Button type="button" size="sm" onClick={() => setAction('acknowledge')} className="gap-2"><Hand className="h-4 w-4" />Tiếp nhận</Button> : null}
              {canManage && incident.status !== 'RESOLVED' ? <Button type="button" size="sm" variant={incident.status === 'OPEN' ? 'outline' : 'default'} onClick={() => setAction('resolve')} className="gap-2"><CheckCircle2 className="h-4 w-4" />Đánh dấu đã xử lý</Button> : null}
            </>
          }
        />
      </FadeItem>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <section aria-labelledby="incident-summary" className="rounded-2xl border border-border bg-card px-5 py-4">
            <h2 id="incident-summary" className="font-display text-[16px] font-semibold text-foreground">Mô tả</h2>
            <p className="mt-2 whitespace-pre-line text-[13px] leading-6 text-foreground">{incident.summary || incident.description || 'Không có mô tả.'}</p>
            {incident.description && incident.summary ? <p className="mt-2 whitespace-pre-line text-[13px] leading-6 text-muted-foreground">{incident.description}</p> : null}
            {incident.runbook_url ? (
              <a href={incident.runbook_url} target="_blank" rel="noreferrer noopener" className="mt-3 inline-flex items-center gap-2 text-[13px] font-semibold text-primary hover:underline">
                <BookOpen className="h-4 w-4" aria-hidden="true" />Mở hướng dẫn xử lý (runbook)
              </a>
            ) : null}
            {incident.resolution_note ? (
              <div className="mt-4 rounded-xl border border-border bg-muted/40 px-4 py-3">
                <p className="text-[12px] text-muted-foreground">Nguyên nhân và cách xử lý</p>
                <p className="mt-1 whitespace-pre-line text-[13px] text-foreground">{incident.resolution_note}</p>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="incident-timeline" className="overflow-hidden rounded-2xl border border-border bg-card">
            <h2 id="incident-timeline" className="border-b border-border px-5 py-3.5 font-display text-[16px] font-semibold text-foreground">Dòng thời gian</h2>
            <ol className="px-5 py-4">
              {incident.events.map((event, index) => (
                <li key={event.id} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
                  <span className="relative flex justify-center">
                    <span className={cn('mt-1.5 h-2.5 w-2.5 rounded-full', event.event_type.includes('RESOLVED') ? 'bg-emerald-600' : event.event_type === 'DELIVERY_FAILED' ? 'bg-red-600' : 'bg-primary')} aria-hidden="true" />
                    {index < incident.events.length - 1 ? <span className="absolute top-5 bottom-[-4px] w-px bg-border" aria-hidden="true" /> : null}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">
                      {EVENT_LABEL[event.event_type] || event.event_type}
                      <span className="ml-2 font-normal tabular-nums text-muted-foreground">{formatDateTime(event.created_at, true)}</span>
                    </p>
                    {event.actor_name ? <p className="text-[12px] text-muted-foreground">bởi {event.actor_name}</p> : null}
                    {event.message ? <p className="mt-1 whitespace-pre-line text-[13px] text-foreground">{event.message}</p> : null}
                    {eventDetail(event) ? <p className="mt-0.5 text-[12px] text-muted-foreground">{eventDetail(event)}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
            {canManage ? (
              <div className="border-t border-border px-5 py-4">
                <label htmlFor="incident-note" className="text-[13px] font-semibold text-foreground">Thêm ghi chú xử lý</label>
                <Textarea id="incident-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={3} className="mt-2" placeholder="Đã kiểm tra gì, nguyên nhân nghi ngờ, bước tiếp theo…" />
                <div className="mt-2 flex justify-end">
                  <Button type="button" size="sm" onClick={() => void saveNote()} disabled={!note.trim()} loading={savingNote} loadingLabel="Đang lưu">Lưu ghi chú</Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="space-y-5">
          <section aria-labelledby="incident-facts" className="rounded-2xl border border-border bg-card px-5 py-4">
            <h2 id="incident-facts" className="font-display text-[16px] font-semibold text-foreground">Thông tin</h2>
            <dl className="mt-3 space-y-2 text-[13px]">
              {facts.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 truncate text-right tabular-nums text-foreground" title={value}>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="incident-deliveries" className="overflow-hidden rounded-2xl border border-border bg-card">
            <h2 id="incident-deliveries" className="border-b border-border px-5 py-3.5 font-display text-[16px] font-semibold text-foreground">Lịch sử gửi thông báo</h2>
            {incident.deliveries.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-muted-foreground">Chưa gửi thông báo nào cho sự cố này (xem lý do trong dòng thời gian).</p>
            ) : (
              <ul>
                {incident.deliveries.map((delivery) => (
                  <li key={delivery.id} className="border-b border-border px-5 py-3 last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{CHANNEL_LABEL[delivery.channel]} · {delivery.channel_config?.name}</span>
                      <span className={cn('shrink-0 text-[12px] font-semibold', delivery.status === 'SENT' ? 'text-emerald-700 dark:text-emerald-400' : delivery.status === 'DEAD' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-300')}>{DELIVERY_LABEL[delivery.status]}</span>
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      {delivery.kind === 'RESOLVED' ? 'Thông báo phục hồi' : delivery.kind === 'REOPENED' ? 'Tái diễn' : 'Phát hiện'} · {delivery.attempt_count}/{delivery.max_attempts} lần thử
                      {delivery.status === 'RETRY' ? ` · thử lại lúc ${formatDateTime(delivery.next_attempt_at)}` : ''}
                    </p>
                    {delivery.attempts?.length ? (
                      <ul className="mt-1.5 space-y-0.5 text-[12px] tabular-nums text-muted-foreground">
                        {delivery.attempts.map((attempt) => (
                          <li key={attempt.id}>#{attempt.attempt_no} {formatDateTime(attempt.created_at)} · {attempt.outcome === 'SENT' ? 'thành công' : attempt.outcome === 'RETRY' ? 'lỗi, sẽ thử lại' : 'lỗi, dừng'}{attempt.error_code ? ` · ${attempt.error_code}` : ''} · {attempt.duration_ms} ms</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => { if (!open) { setAction(null); setActionNote(''); } }}
        title={action === 'acknowledge' ? 'Tiếp nhận sự cố?' : 'Đánh dấu sự cố đã xử lý?'}
        description={action === 'acknowledge'
          ? 'Mọi quản trị viên sẽ thấy bạn đang xử lý sự cố này.'
          : 'Nếu cảnh báo vẫn còn, Grafana sẽ báo lại và sự cố được mở lại tự động.'}
        confirmLabel={action === 'acknowledge' ? 'Tiếp nhận' : 'Đã xử lý'}
        onConfirm={runAction}
      >
        <label htmlFor="incident-action-note" className="text-[13px] font-medium text-foreground">{action === 'resolve' ? 'Nguyên nhân và cách xử lý (khuyến nghị)' : 'Ghi chú (không bắt buộc)'}</label>
        <Textarea id="incident-action-note" value={actionNote} onChange={(event) => setActionNote(event.target.value)} maxLength={2000} rows={3} className="mt-2" />
      </ConfirmDialog>
    </PageWrapper>
  );
}
