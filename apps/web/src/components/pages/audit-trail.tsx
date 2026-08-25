import { useEffect, useState, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import {
  ScrollText, RefreshCw, ChevronLeft, ChevronRight, Eye, X,
} from 'lucide-react';
import { gatewayAPI } from '@/services/http-clients';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import { SkeletonTableRow } from '@/components/ui/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface AuditLog {
  id: string;
  actor_user_id: string | null;
  action_name: string;
  entity_type: string;
  entity_id: string | null;
  before_data: any;
  after_data: any;
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

function getActionVariant(action: string) {
  for (const [key, variant] of Object.entries(ACTION_VARIANTS)) {
    if (action.toUpperCase().includes(key)) return variant;
  }
  return 'neutral';
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
      const params: any = { page, pageSize: 20 };
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

  const entityTypes = ['', 'LOAN_TRANSACTION', 'RESERVATION', 'FINE', 'CUSTOMER', 'LOAN_ITEM'];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <PageHeader
        icon={ScrollText}
        title="Audit Trail"
        description="Lịch sử thao tác hệ thống"
        iconBg="bg-gradient-to-br from-slate-100 to-zinc-50 border border-slate-200/40 dark:from-slate-500/15 dark:to-zinc-500/10 dark:border-slate-500/20"
        iconColor="text-slate-600 dark:text-slate-400"
        actions={
          <button onClick={() => void loadLogs()} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-input bg-background text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all" style={{ fontWeight: 550 }}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới
          </button>
        }
      />

      {/* Filters */}
      <FilterBar
        searchValue={searchAction}
        onSearchChange={(value) => { setSearchAction(value); setPage(1); }}
        searchPlaceholder="Tìm action..."
        showSearchClear
        filters={
          <select value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
            className="h-9 rounded-lg border border-input bg-background px-3 text-[12px] text-foreground focus:border-indigo-300 dark:focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-200 dark:focus:ring-indigo-500/20 outline-none">
            <option value="">Tất cả Entity</option>
            {entityTypes.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        }
      />

      {/* Table */}
      <SectionCard noPadding className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Thời gian', 'Hành động', 'Đối tượng', 'ID đối tượng', 'Người dùng', ''].map(h => (
                  <th key={h} className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-4 py-3" style={{ fontWeight: 550 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={6} rows={6} />
              ) : logs.length === 0 ? (
                <tr><td colSpan={6}><EmptyState variant="no-data" title="Không có dữ liệu" description="Chưa có nhật ký thao tác nào phù hợp với bộ lọc hiện tại." className="py-12" /></td></tr>
              ) : logs.map((log, i) => (
                <motion.tr key={log.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">{new Date(log.created_at).toLocaleString('vi-VN')}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={log.action_name} variant={getActionVariant(log.action_name)} />
                  </td>
                  <td className="px-4 py-3 text-[12px] text-foreground font-mono">{log.entity_type}</td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground font-mono">{log.entity_id?.slice(0, 8) || '—'}</td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground font-mono">{log.actor_user_id?.slice(0, 8) || 'Hệ thống'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedLog(log)} aria-label="Xem chi tiết" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-all">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Pagination */}
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

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedLog(null)} role="dialog" aria-modal="true" aria-labelledby="audit-log-modal-title">
          <motion.div ref={modalRef} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 id="audit-log-modal-title" className="text-[14px] text-foreground" style={{ fontWeight: 650 }}>Chi tiết Audit Log</h3>
                <p className="text-[11px] text-muted-foreground">{selectedLog.action_name} — {selectedLog.entity_type}</p>
              </div>
              <button onClick={() => setSelectedLog(null)} aria-label="Đóng" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[60vh] space-y-4">
              <div className="grid grid-cols-2 gap-4 text-[12px] text-foreground">
                <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{selectedLog.id}</span></div>
                <div><span className="text-muted-foreground">Thời gian:</span> {new Date(selectedLog.created_at).toLocaleString('vi-VN')}</div>
                <div><span className="text-muted-foreground">Entity ID:</span> <span className="font-mono">{selectedLog.entity_id || '—'}</span></div>
                <div><span className="text-muted-foreground">Người dùng:</span> <span className="font-mono">{selectedLog.actor_user_id || 'Hệ thống'}</span></div>
              </div>
              {selectedLog.before_data && (
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1" style={{ fontWeight: 600 }}>Trước</p>
                  <pre className="bg-rose-50 dark:bg-rose-500/10 text-foreground rounded-lg p-3 text-[11px] font-mono overflow-x-auto border border-rose-100 dark:border-rose-500/20">
                    {JSON.stringify(selectedLog.before_data, null, 2)}
                  </pre>
                </div>
              )}
              {selectedLog.after_data && (
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1" style={{ fontWeight: 600 }}>Sau</p>
                  <pre className="bg-emerald-50 dark:bg-emerald-500/10 text-foreground rounded-lg p-3 text-[11px] font-mono overflow-x-auto border border-emerald-100 dark:border-emerald-500/20">
                    {JSON.stringify(selectedLog.after_data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
