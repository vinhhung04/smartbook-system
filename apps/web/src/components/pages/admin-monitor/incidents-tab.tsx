import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getApiErrorMessage } from '@/services/http-clients';
import { incidentService, type IncidentList, type IncidentSeverity } from '@/services/incidents';
import { CATEGORY_LABEL, SEVERITY_META, formatDateTime, incidentAge } from './incident-format';
import { SeverityBadge, StatusPill } from './incident-badges';

type StatusFilter = 'ACTIVE' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'ALL';
const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ACTIVE', label: 'Chưa xử lý' },
  { value: 'OPEN', label: 'Đang mở' },
  { value: 'ACKNOWLEDGED', label: 'Đã tiếp nhận' },
  { value: 'RESOLVED', label: 'Đã xử lý' },
  { value: 'ALL', label: 'Tất cả' },
];
const PAGE_SIZE = 20;

export function IncidentsTab({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [severity, setSeverity] = useState<IncidentSeverity | 'ALL'>('ALL');
  const [service, setService] = useState('ALL');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<IncidentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await incidentService.list({
        status: status === 'ACTIVE' ? 'OPEN,ACKNOWLEDGED' : status === 'ALL' ? undefined : status,
        severity: severity === 'ALL' ? undefined : severity,
        service: service === 'ALL' ? undefined : service,
        q: query || undefined, page, page_size: PAGE_SIZE,
      });
      setData(result);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được danh sách sự cố'));
    } finally {
      setLoading(false);
    }
  }, [status, severity, service, query, page]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section aria-labelledby="incidents-title" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <h2 id="incidents-title" className="font-display text-[18px] font-semibold tracking-tight text-foreground">
          Sự cố{data ? <span className="ml-2 text-[13px] font-normal text-muted-foreground tabular-nums">{data.total.toLocaleString('vi-VN')}</span> : null}
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} loading={loading} loadingLabel="Đang tải" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Tải lại
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <SegmentedControl options={STATUS_OPTIONS} value={status} onChange={(value) => { setStatus(value); setPage(1); }} layoutId="incident-status-filter" className="max-w-full overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap" />
        <Select value={severity} onValueChange={(value) => { setSeverity(value as IncidentSeverity | 'ALL'); setPage(1); }}>
          <SelectTrigger className="h-9 w-[160px]" aria-label="Lọc theo mức độ"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Mọi mức độ</SelectItem>
            {(Object.keys(SEVERITY_META) as IncidentSeverity[]).map((key) => <SelectItem key={key} value={key}>{SEVERITY_META[key].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={service} onValueChange={(value) => { setService(value); setPage(1); }}>
          <SelectTrigger className="h-9 w-[190px]" aria-label="Lọc theo dịch vụ"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Mọi dịch vụ</SelectItem>
            {(data?.services || []).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Tìm sự cố</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tên, mô tả hoặc dịch vụ" className="h-9 pl-9" />
        </label>
      </div>

      {error ? (
        <EmptyState variant="error" title="Không tải được danh sách sự cố" description={error} action={<Button type="button" onClick={() => void load()}>Thử lại</Button>} />
      ) : data && data.items.length === 0 ? (
        <EmptyState variant="no-data" title={status === 'ACTIVE' ? 'Không có sự cố nào chưa xử lý' : 'Không có sự cố phù hợp'} description="Sự cố được tạo tự động khi Grafana hoặc healthcheck phát hiện bất thường." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-border text-[12px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Sự cố</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Mức độ</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Phát hiện</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Tái diễn</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Người tiếp nhận</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items || []).map((incident) => (
                <tr key={incident.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="max-w-[340px] px-5 py-3">
                    <Link to={`/admin/monitor/incidents/${incident.id}`} className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                      <span className="block truncate font-semibold text-foreground">{incident.title}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{incident.service_name} · {CATEGORY_LABEL[incident.category]}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-3"><SeverityBadge severity={incident.severity} /></td>
                  <td className="px-3 py-3"><StatusPill status={incident.status} /></td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums text-muted-foreground">{formatDateTime(incident.first_seen_at)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{incident.occurrence_count}</td>
                  <td className="max-w-[160px] truncate px-3 py-3 text-muted-foreground">{incident.acknowledged_by_name || incident.resolved_by_name || '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-muted-foreground">{incidentAge(incident)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
          <span className="tabular-nums">Trang {page} / {totalPages}</span>
          <span className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Trước</Button>
            <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Sau</Button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
