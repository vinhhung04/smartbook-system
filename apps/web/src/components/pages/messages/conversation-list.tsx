import { useMemo, useState } from 'react';
import { Users, SquarePen, Search } from 'lucide-react';
import { IconButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';
import { PresenceAvatar } from './presence-avatar';
import { getConversationDisplay } from './conversation-display';
import { formatRelativeTime } from './utils';
import type { Conversation, StaffMember } from './types';

interface ConversationListProps {
  conversations: Conversation[];
  staffById: Map<string, StaffMember>;
  currentUserId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
}

export function ConversationList({
  conversations,
  staffById,
  currentUserId,
  selectedId,
  onSelect,
  onNewConversation,
}: ConversationListProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const { title } = getConversationDisplay(c, staffById, currentUserId);
      return title.toLowerCase().includes(q);
    });
  }, [conversations, query, staffById, currentUserId]);

  return (
    <div className="flex h-full w-full flex-col border-r border-border bg-card sm:w-[300px] shrink-0">
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border">
        <h1 className="flex-1 text-[15px]" style={{ fontWeight: 650 }}>Tin nhắn</h1>
        <IconButton
          label="Hội thoại mới"
          size="sm-icon"
          variant="ghost"
          className="text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
          onClick={onNewConversation}
        >
          <SquarePen className="w-4 h-4" />
        </IconButton>
      </div>

      <div className="px-3 py-2.5 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm đồng nghiệp hoặc nhóm..."
            className="h-8 pl-8 text-[13px]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[12px] text-slate-500">Không tìm thấy hội thoại nào.</p>
          </div>
        ) : (
          filtered.map((conversation) => {
            const { title, subtitle, otherMember, members } = getConversationDisplay(
              conversation,
              staffById,
              currentUserId,
            );
            const isActive = conversation.id === selectedId;
            const isUnread = conversation.unread_count > 0;

            return (
              <button
                key={conversation.id}
                onClick={() => onSelect(conversation.id)}
                className={cn(
                  'w-full flex items-start gap-2.5 px-4 py-3 text-left border-b border-border/50 transition-colors',
                  isActive ? 'bg-indigo-50/60 dark:bg-indigo-500/10' : 'hover:bg-muted/50',
                )}
              >
                {otherMember ? (
                  <PresenceAvatar member={otherMember} />
                ) : (
                  <div className="w-10 h-10 shrink-0 rounded-full bg-indigo-500/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-indigo-600" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] truncate" style={{ fontWeight: isUnread ? 650 : 550 }}>
                      {title}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {formatRelativeTime(conversation.updated_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className={cn('text-[12px] truncate', isUnread ? 'text-foreground' : 'text-slate-500')}>
                      {conversation.last_message
                        ? `${conversation.last_message.sender_id === currentUserId ? 'Bạn: ' : ''}${conversation.last_message.content}`
                        : subtitle}
                    </p>
                    {isUnread && (
                      <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center" style={{ fontWeight: 700 }}>
                        {conversation.unread_count}
                      </span>
                    )}
                  </div>
                  {conversation.type === 'GROUP' && (
                    <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                      {members.map((m) => { const parts = m.full_name.split(' '); return parts[parts.length - 1]; }).join(', ')}
                    </p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
