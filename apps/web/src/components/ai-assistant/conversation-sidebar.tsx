import { useMemo, useState } from 'react';
import { isToday, isYesterday, subDays } from 'date-fns';
import { History, PanelLeftClose, Pencil, Plus, RotateCw, Search, Trash2, X } from 'lucide-react';
import type { AiConversationSummary } from '@/services/ai';
import { cn } from '@/components/ui/utils';

// Conversation history rail (desktop) and drawer body (tablet/phone). Grouped
// by recency like Vercel ai-chatbot / LibreChat / Open WebUI. The API has no
// search endpoint, so the filter narrows the list already loaded - it never
// queries the backend.

export type ConversationsStatus = 'loading' | 'ready' | 'error';

interface ConversationSidebarProps {
  conversations: AiConversationSummary[];
  status: ConversationsStatus;
  activeId: string;
  /** An answer is streaming or a conversation is opening: switching would race it. */
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, currentTitle: string | null) => void;
  onDelete: (id: string, title: string | null) => void;
  onRetry: () => void;
  onClearAll: () => void;
  /** Desktop rail only. */
  onCollapse?: () => void;
  /** Drawer only: close button for touch users. */
  onClose?: () => void;
}

const GROUPS = ['Hôm nay', 'Hôm qua', '7 ngày qua', '30 ngày qua', 'Cũ hơn'] as const;

function groupOf(iso: string, now: Date): (typeof GROUPS)[number] {
  const date = new Date(iso);
  if (isToday(date)) return 'Hôm nay';
  if (isYesterday(date)) return 'Hôm qua';
  if (date > subDays(now, 7)) return '7 ngày qua';
  if (date > subDays(now, 30)) return '30 ngày qua';
  return 'Cũ hơn';
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  return isToday(date)
    ? date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

const UNTITLED = 'Hội thoại chưa đặt tên';

export function ConversationSidebar({
  conversations, status, activeId, busy, onSelect, onNew, onRename, onDelete, onRetry, onClearAll, onCollapse, onClose,
}: ConversationSidebarProps) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('vi');
    const now = new Date();
    const buckets = new Map<string, AiConversationSummary[]>();
    for (const conv of conversations) {
      if (needle && !(conv.title || UNTITLED).toLocaleLowerCase('vi').includes(needle)) continue;
      const key = groupOf(conv.last_message_at ?? conv.updated_at, now);
      buckets.set(key, [...(buckets.get(key) ?? []), conv]);
    }
    return GROUPS.filter((g) => buckets.has(g)).map((g) => ({ label: g, items: buckets.get(g)! }));
  }, [conversations, query]);

  return (
    <nav aria-label="Lịch sử hội thoại" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Lịch sử
        </p>
        {onCollapse && (
          <button type="button" onClick={onCollapse} aria-label="Thu gọn lịch sử hội thoại" title="Thu gọn"
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Đóng lịch sử hội thoại"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="space-y-2 px-3 pb-3">
        <button type="button" onClick={onNew} disabled={busy}
          className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-[13px] font-medium text-foreground shadow-xs transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Hội thoại mới
        </button>
        {conversations.length > 0 && (
          <label className="flex h-8 items-center gap-1.5 rounded-lg border border-transparent bg-muted/70 px-2.5 focus-within:border-ring/50 focus-within:bg-card">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Lọc theo tên hội thoại"
              aria-label="Lọc hội thoại đã tải theo tên"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground" />
          </label>
        )}
      </div>

      {busy && conversations.length > 0 && (
        <p className="mx-3 mb-2 rounded-md bg-muted/70 px-2.5 py-1.5 text-[11.5px] leading-snug text-muted-foreground" role="status">
          Đang xử lý — chờ hoàn tất để chuyển hội thoại.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {status === 'loading' && conversations.length === 0 ? (
          <ul className="space-y-1 px-1" aria-label="Đang tải lịch sử">
            {[72, 56, 64, 48].map((w) => (
              <li key={w} className="space-y-1.5 rounded-lg px-2 py-2.5">
                <span className="block h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
                <span className="block h-2.5 w-14 animate-pulse rounded bg-muted" />
              </li>
            ))}
          </ul>
        ) : status === 'error' && conversations.length === 0 ? (
          <div className="mx-1 space-y-2 rounded-lg border border-dashed border-border px-3 py-4 text-center">
            <p className="text-[12.5px] text-muted-foreground">Không tải được lịch sử hội thoại.</p>
            <button type="button" onClick={onRetry}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring">
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              Thử lại
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
            Chưa có hội thoại nào. Câu hỏi đầu tiên sẽ tạo một hội thoại và được lưu ở đây.
          </p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] text-muted-foreground">Không có hội thoại nào khớp “{query.trim()}”.</p>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="pb-2">
              <h3 className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-muted-foreground">{group.label}</h3>
              <ul className="space-y-px">
                {group.items.map((conv) => {
                  const active = conv.conversation_id === activeId;
                  const title = conv.title || UNTITLED;
                  return (
                    <li key={conv.conversation_id}
                      className={cn('group relative flex items-center rounded-lg transition-colors',
                        active ? 'bg-primary/10' : 'hover:bg-muted/80 focus-within:bg-muted/80')}>
                      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" aria-hidden="true" />}
                      <button type="button" onClick={() => onSelect(conv.conversation_id)}
                        disabled={busy && !active}
                        aria-current={active ? 'true' : undefined}
                        className="min-w-0 flex-1 cursor-pointer rounded-lg py-2 pl-3 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-60">
                        <span className={cn('block truncate text-[13px]', active ? 'font-semibold text-foreground' : 'font-medium text-foreground/90', !conv.title && 'italic text-muted-foreground')}>
                          {title}
                        </span>
                        <span className="block text-[11.5px] tabular-nums text-muted-foreground">
                          {timeLabel(conv.last_message_at ?? conv.updated_at)}
                        </span>
                      </button>
                      {/* Hidden until hover/focus on pointer devices, always visible on touch. */}
                      <span className="flex shrink-0 items-center gap-0.5 pr-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                        <button type="button" onClick={() => onRename(conv.conversation_id, conv.title)}
                          aria-label={`Đổi tên hội thoại “${title}”`} title="Đổi tên"
                          className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => onDelete(conv.conversation_id, conv.title)}
                          disabled={busy && active}
                          aria-label={`Xóa hội thoại “${title}”`} title="Xóa"
                          className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-rose-500/10 dark:hover:text-rose-400">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      {conversations.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <button type="button" onClick={onClearAll} disabled={busy}
            className="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-rose-500/10 dark:hover:text-rose-400">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Xóa toàn bộ lịch sử
          </button>
        </div>
      )}
    </nav>
  );
}
