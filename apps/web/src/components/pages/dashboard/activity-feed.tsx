import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Radio } from 'lucide-react';
import { actionLabel, ENTITY_LABELS } from '@/lib/borrow-audit-labels';
import { timeAgo } from '@/components/ops/ops-utils';
import { cn } from '@/components/ui/utils';
import { BlockEmpty, BlockError, Panel, PanelBody, PanelHeader, PanelLink } from './panel';

/** Rows kept on screen; older ones scroll off as new events arrive. */
export const FEED_SIZE = 8;

/** One row of GET /borrow/audit-logs (borrow-service writes these for every loan, reservation and fine change). */
export type AuditLogEntry = { id: string; action_name: string; entity_type: string; created_at: string };

/** A socket event that arrived while the page was open. */
export type LiveEvent = { id: string; name: string; at: string };

// Socket event names from useBorrowRealtime / useInventoryRealtime, in the feed's words.
const LIVE_LABELS: Record<string, string> = {
  'loan:created': 'Phiếu mượn mới',
  'loan:status_changed': 'Phiếu mượn đổi trạng thái',
  'loan:returned': 'Bạn đọc trả sách',
  'loan:overdue': 'Phiếu mượn quá hạn',
  'loan:renewal_requested': 'Bạn đọc xin gia hạn',
  'loan:renewal_reviewed': 'Đã xử lý yêu cầu gia hạn',
  'reservation:created': 'Đặt trước mới',
  'reservation:confirmed': 'Xác nhận đặt trước',
  'reservation:ready_for_pickup': 'Sách sẵn sàng để lấy',
  'reservation:cancelled': 'Hủy đặt trước',
  'reservation:expired': 'Đặt trước hết hạn',
  'reservation:converted_to_loan': 'Đặt trước chuyển thành phiếu mượn',
  'fine:created': 'Phát sinh tiền phạt',
  'fine:paid': 'Thanh toán tiền phạt',
  'fine:waived': 'Miễn giảm tiền phạt',
};

function liveLabel(name: string) {
  if (LIVE_LABELS[name]) return LIVE_LABELS[name];
  if (name.startsWith('stock') || name.startsWith('inventory')) return 'Tồn kho thay đổi';
  if (name.startsWith('purchase')) return 'Yêu cầu mua hàng cập nhật';
  return name;
}

type FeedRow = { key: string; label: string; detail: string; when: string; live: boolean };

/** Newest first: live events on top of the logs loaded with the page, capped at FEED_SIZE. */
function feedRows(logs: AuditLogEntry[], live: LiveEvent[]): FeedRow[] {
  const liveRows = live.map((event) => ({ key: `live-${event.id}`, label: liveLabel(event.name), detail: 'Trực tiếp', when: 'Vừa xong', live: true }));
  const logRows = logs.map((log) => ({
    key: log.id,
    label: actionLabel(log.action_name),
    detail: ENTITY_LABELS[log.entity_type] ?? log.entity_type,
    when: timeAgo(log.created_at) ?? '—',
    live: false,
  }));
  return [...liveRows, ...logRows].slice(0, FEED_SIZE);
}

interface ActivityFeedProps {
  logs: AuditLogEntry[] | null;
  live: LiveEvent[];
  canOpenAudit: boolean;
  onRetry: () => void;
}

export function ActivityFeed({ logs, live, canOpenAudit, onRetry }: ActivityFeedProps) {
  const reduce = useReducedMotion();
  const rows = feedRows(logs ?? [], live);

  return (
    <Panel titleId="activity-title" className="@5xl:col-span-4">
      <PanelHeader
        id="activity-title"
        title="Hoạt động trực tiếp"
        description="Mượn, trả, đặt trước và tiền phạt mới nhất"
        aside={(
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Đang nghe
          </span>
        )}
      />
      <PanelBody>
        {!logs && !live.length ? (
          <BlockError what="nhật ký hoạt động" onRetry={onRetry} />
        ) : !rows.length ? (
          <BlockEmpty>Chưa có hoạt động nào. Thao tác mượn, trả mới sẽ hiện ở đây ngay.</BlockEmpty>
        ) : (
          // Idea from React Bits `AnimatedList` (github.com/DavidHDev/react-bits, MIT + Commons Clause): new rows slide in on top.
          <ol aria-live="polite" aria-relevant="additions">
            <AnimatePresence initial={false}>
              {rows.map((row) => (
                <motion.li
                  key={row.key}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/70 py-2 last:border-0"
                >
                  {row.live
                    ? <Radio className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    : <span className="mx-[3px] h-2 w-2 rounded-full bg-border" aria-hidden="true" />}
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground">{row.label}</span>
                    <span className={cn('block truncate text-[12px] leading-5', row.live ? 'text-primary' : 'text-muted-foreground')}>{row.detail}</span>
                  </span>
                  <span className="whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">{row.when}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
        {canOpenAudit ? <div className="mt-3"><PanelLink to="/audit-trail">Xem nhật ký</PanelLink></div> : null}
      </PanelBody>
    </Panel>
  );
}
