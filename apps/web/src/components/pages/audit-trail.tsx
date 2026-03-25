import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  ScrollText, RefreshCw, ChevronLeft, ChevronRight, Search, Eye, X,
} from 'lucide-react';
import { inventoryAPI } from '@/services/http-clients';
import { toast } from 'sonner';

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

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-100',
  DELETE: 'bg-rose-50 text-rose-700 border-rose-100',
  PAY: 'bg-amber-50 text-amber-700 border-amber-100',
  RETURN: 'bg-violet-50 text-violet-700 border-violet-100',
  REQUEST: 'bg-cyan-50 text-cyan-700 border-cyan-100',
};

function getActionColor(action: string) {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.toUpperCase().includes(key)) return color;
  }
  return 'bg-slate-50 text-slate-700 border-slate-100';
}

export function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [entityFilter, setEntityFilter] = useState('');
  const [searchAction, setSearchAction] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params: any = { page, pageSize: 20 };
      if (entityFilter) params.entity_type = entityFilter;
      if (searchAction) params.action_name = searchAction;

      const resp = await inventoryAPI.get('/borrow/audit-logs', { params });
      setLogs(resp.data?.data || []);
      setTotalPages(resp.data?.meta?.totalPages || 1);
    } catch (err) {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, entityFilter, searchAction]);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  const entityTypes = ['', 'LOAN_TRANSACTION', 'RESERVATION', 'FINE', 'CUSTOMER', 'LOAN_ITEM'];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-slate-100 to-zinc-50 flex items-center justify-center border border-slate-200/40">
            <ScrollText className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h1 className="tracking-[-0.02em]" style={{ fontWeight: 700 }}>Audit Trail</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">Lịch sử thao tác hệ thống</p>
          </div>
        </div>
        <button onClick={() => void loadLogs()} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] hover:bg-slate-50 transition-all" style={{ fontWeight: 550 }}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-slate-200 px-3 text-[12px] bg-white focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none">
          <option value="">Tất cả Entity</option>
          {entityTypes.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Tìm action..." value={searchAction}
            onChange={(e) => { setSearchAction(e.target.value); setPage(1); }}
            className="h-9 rounded-lg border border-slate-200 pl-8 pr-3 text-[12px] bg-white focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none w-52" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-slate-50/50">
                {['Thời gian', 'Action', 'Entity', 'Entity ID', 'Actor', ''].map(h => (
                  <th key={h} className="text-left text-[11px] text-slate-500 uppercase tracking-wider px-4 py-3" style={{ fontWeight: 550 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-[13px] text-slate-400">Không có dữ liệu</td></tr>
              ) : logs.map((log, i) => (
                <motion.tr key={log.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 text-[12px] text-slate-500 whitespace-nowrap">{new Date(log.created_at).toLocaleString('vi-VN')}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] border ${getActionColor(log.action_name)}`} style={{ fontWeight: 600 }}>
                      {log.action_name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-600 font-mono">{log.entity_type}</td>
                  <td className="px-4 py-3 text-[11px] text-slate-400 font-mono">{log.entity_id?.slice(0, 8) || '—'}</td>
                  <td className="px-4 py-3 text-[11px] text-slate-400 font-mono">{log.actor_user_id?.slice(0, 8) || 'System'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedLog(log)} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-slate-400">Trang {page} / {totalPages}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="h-8 px-3 rounded-lg border text-[12px] hover:bg-slate-50 disabled:opacity-40 transition-all">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="h-8 px-3 rounded-lg border text-[12px] hover:bg-slate-50 disabled:opacity-40 transition-all">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedLog(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl border shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="text-[14px]" style={{ fontWeight: 650 }}>Chi tiết Audit Log</h3>
                <p className="text-[11px] text-slate-400">{selectedLog.action_name} — {selectedLog.entity_type}</p>
              </div>
              <button onClick={() => setSelectedLog(null)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[60vh] space-y-4">
              <div className="grid grid-cols-2 gap-4 text-[12px]">
                <div><span className="text-slate-400">ID:</span> <span className="font-mono">{selectedLog.id}</span></div>
                <div><span className="text-slate-400">Thời gian:</span> {new Date(selectedLog.created_at).toLocaleString('vi-VN')}</div>
                <div><span className="text-slate-400">Entity ID:</span> <span className="font-mono">{selectedLog.entity_id || '—'}</span></div>
                <div><span className="text-slate-400">Actor:</span> <span className="font-mono">{selectedLog.actor_user_id || 'System'}</span></div>
              </div>
              {selectedLog.before_data && (
                <div>
                  <p className="text-[11px] text-slate-400 mb-1" style={{ fontWeight: 600 }}>Before</p>
                  <pre className="bg-rose-50 rounded-lg p-3 text-[11px] font-mono overflow-x-auto border border-rose-100">
                    {JSON.stringify(selectedLog.before_data, null, 2)}
                  </pre>
                </div>
              )}
              {selectedLog.after_data && (
                <div>
                  <p className="text-[11px] text-slate-400 mb-1" style={{ fontWeight: 600 }}>After</p>
                  <pre className="bg-emerald-50 rounded-lg p-3 text-[11px] font-mono overflow-x-auto border border-emerald-100">
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
