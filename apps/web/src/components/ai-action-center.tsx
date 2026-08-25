import { Fragment, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import {
  DataTable,
  DataTableHeader,
  DataTableHead,
  DataTableBody,
  DataTableRow,
  DataTableCell,
} from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { aiService, type AiActionListItem, type AiActionDetail, type AiAuditLogEntry } from '@/services/ai';
import { getApiErrorMessage } from '@/services/http-clients';
import { toast } from 'sonner';
import { useSocket } from '@/lib/socket';
import { useAIActionRealtime } from '@/hooks/useAIActionRealtime';

// Action Center — lists AI-drafted actions (pending/executed/cancelled/failed/expired)
// with their audit trail. Complements the inline ActionCard shown in the chat itself
// (components/ai-action-card.tsx): that's for acting on an action right when the AI
// proposes it, this is for browsing what happened across the whole history.

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'PENDING_CONFIRMATION', label: 'Chờ xác nhận' },
  { value: 'EXECUTED', label: 'Đã thực thi' },
  { value: 'CANCELLED', label: 'Đã hủy' },
  { value: 'FAILED', label: 'Thất bại' },
  { value: 'EXPIRED', label: 'Hết hạn' },
];

const STATUS_VARIANT: Record<string, string> = {
  PENDING_CONFIRMATION: 'info',
  EXECUTED: 'success',
  CANCELLED: 'neutral',
  FAILED: 'danger',
  EXPIRED: 'danger',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING_CONFIRMATION: 'Chờ xác nhận',
  EXECUTED: 'Đã thực thi',
  CANCELLED: 'Đã hủy',
  FAILED: 'Thất bại',
  EXPIRED: 'Hết hạn',
};

const RISK_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  LOW: 'secondary',
  MEDIUM: 'outline',
  HIGH: 'destructive',
};

const TYPE_LABEL: Record<string, string> = {
  CREATE_REORDER_DRAFT: 'Đề xuất nhập sách',
  CREATE_REPORT_DRAFT: 'Tạo báo cáo',
  CREATE_RESERVATION_DRAFT: 'Đặt chỗ sách',
  CREATE_STOCK_ALERT: 'Cảnh báo tồn kho',
  CREATE_STAFF_TASK_DRAFT: 'Task cho staff',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN');
}

function ActionDetailPanel({ actionId }: { actionId: string }) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ action: AiActionDetail; audit_logs: AiAuditLogEntry[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    aiService
      .getActionDetail(actionId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
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
    aiService.getActionDetail(actionId).then(setDetail).catch(() => {});
  });

  if (loading) {
    return <p className="px-5 py-4 text-[12px] text-muted-foreground">Đang tải chi tiết...</p>;
  }
  if (!detail) return null;

  const { action, audit_logs: auditLogs } = detail;

  return (
    <div className="space-y-3 border-t border-border bg-muted/20 px-5 py-4 text-[12px]">
      {action.error_message && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400">
          Lỗi: {action.error_message}
        </div>
      )}
      {action.result != null && (
        <div>
          <p className="mb-1 font-medium text-muted-foreground">Kết quả</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-2 text-[11px]">
            {JSON.stringify(action.result, null, 2)}
          </pre>
        </div>
      )}
      <div>
        <p className="mb-1 font-medium text-muted-foreground">Nội dung (payload)</p>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-2 text-[11px]">
          {JSON.stringify(action.payload, null, 2)}
        </pre>
      </div>
      <div>
        <p className="mb-1 font-medium text-muted-foreground">Lịch sử audit</p>
        <div className="space-y-1">
          {auditLogs.map((log, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-2.5 py-1.5"
            >
              <span className="font-medium text-foreground">{log.event_type}</span>
              <span className="text-muted-foreground">
                {log.actor_user_id ?? 'hệ thống'} · {formatDate(log.created_at)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AIActionCenter() {
  const [items, setItems] = useState<AiActionListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { connected } = useSocket();
  const reloadTimerRef = useRef<number | null>(null);

  const load = () => {
    setLoading(true);
    aiService
      .listActions({ status: statusFilter || undefined, limit: 50 })
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

  return (
    <div className="space-y-4 px-5 py-6">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              statusFilter === f.value
                ? 'bg-indigo-600 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span
          className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground"
          title={connected ? 'Đang nhận cập nhật trực tiếp' : 'Mất kết nối trực tiếp — danh sách chỉ cập nhật khi bấm Làm mới'}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
          {connected ? 'Trực tiếp' : 'Ngoại tuyến'}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </Button>
      </div>

      {items.length === 0 && !loading ? (
        <EmptyState
          variant="no-data"
          title="Chưa có hành động nào"
          description="Các hành động AI đề xuất sẽ xuất hiện ở đây."
        />
      ) : (
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Loại</DataTableHead>
              <DataTableHead>Tóm tắt</DataTableHead>
              <DataTableHead>Mức rủi ro</DataTableHead>
              <DataTableHead>Trạng thái</DataTableHead>
              <DataTableHead>Tạo lúc</DataTableHead>
              <DataTableHead />
            </DataTableHeader>
            <DataTableBody>
              {items.map((item) => (
                <Fragment key={item.id}>
                  <DataTableRow
                    className="cursor-pointer"
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  >
                    <DataTableCell>{TYPE_LABEL[item.type] ?? item.type}</DataTableCell>
                    <DataTableCell className="max-w-xs truncate">{item.summary}</DataTableCell>
                    <DataTableCell>
                      <Badge variant={RISK_VARIANT[item.risk] ?? 'outline'}>{item.risk}</Badge>
                    </DataTableCell>
                    <DataTableCell>
                      <StatusBadge
                        label={STATUS_LABEL[item.status] ?? item.status}
                        variant={STATUS_VARIANT[item.status] ?? 'neutral'}
                        dot
                      />
                    </DataTableCell>
                    <DataTableCell>{formatDate(item.created_at)}</DataTableCell>
                    <DataTableCell>
                      {expandedId === item.id ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </DataTableCell>
                  </DataTableRow>
                  {expandedId === item.id && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <ActionDetailPanel actionId={item.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </DataTableBody>
          </table>
        </DataTable>
      )}
    </div>
  );
}
