import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { PresenceAvatar } from './presence-avatar';
import { getConversationDisplay } from './conversation-display';
import { Composer } from './composer';
import { formatClockTime } from './utils';
import type { Conversation, Message, StaffMember } from './types';

interface ThreadPaneProps {
  conversation: Conversation;
  messages: Message[];
  staffById: Map<string, StaffMember>;
  currentUserId: string;
  typingMemberIds: string[];
  onSend: (content: string) => void;
}

export function ThreadPane({ conversation, messages, staffById, currentUserId, typingMemberIds, onSend }: ThreadPaneProps) {
  const { title, subtitle, otherMember } = getConversationDisplay(conversation, staffById, currentUserId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, conversation.id]);

  const typingNames = typingMemberIds
    .filter((id) => id !== currentUserId)
    .map((id) => {
      const parts = staffById.get(id)?.full_name.split(' ');
      return parts?.[parts.length - 1];
    })
    .filter(Boolean);

  const lastOwnMessage = [...messages].reverse().find((m) => m.sender_id === currentUserId);
  const seenByOther =
    conversation.type === 'DIRECT' && otherMember && lastOwnMessage
      ? conversation.last_read_message_id[otherMember.id] === lastOwnMessage.id
      : false;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-card/60 backdrop-blur-sm shrink-0">
        {otherMember ? (
          <PresenceAvatar member={otherMember} size="sm" />
        ) : (
          <div className="w-8 h-8 shrink-0 rounded-full bg-indigo-500/10 flex items-center justify-center">
            <Users className="w-3.5 h-3.5 text-indigo-600" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[13px] truncate" style={{ fontWeight: 650 }}>{title}</p>
          <p className="text-[11px] text-slate-500 truncate">
            {typingNames.length > 0 ? (
              <span className="text-indigo-600" style={{ fontWeight: 550 }}>
                {typingNames.join(', ')} đang nhập...
              </span>
            ) : (
              subtitle
            )}
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.map((message, i) => {
          const isOwn = message.sender_id === currentUserId;
          const sender = staffById.get(message.sender_id);
          const prev = messages[i - 1];
          const showSender = conversation.type === 'GROUP' && !isOwn && prev?.sender_id !== message.sender_id;

          return (
            <div key={message.id} className={cn('flex gap-2', isOwn ? 'justify-end' : 'justify-start')}>
              {!isOwn && conversation.type === 'GROUP' && (
                <div className="w-6 shrink-0 self-end">
                  {showSender && sender && <PresenceAvatar member={sender} size="sm" />}
                </div>
              )}
              <div className={cn('max-w-[70%] flex flex-col', isOwn ? 'items-end' : 'items-start')}>
                {showSender && sender && (
                  <span className="text-[10px] text-slate-400 mb-0.5 px-1">{sender.full_name}</span>
                )}
                <div
                  className={cn(
                    'rounded-[14px] px-3.5 py-2 text-[13px] leading-relaxed',
                    isOwn
                      ? 'bg-indigo-50 dark:bg-indigo-500/15 text-foreground rounded-br-[4px]'
                      : 'bg-card border border-border rounded-bl-[4px]',
                  )}
                >
                  {message.content}
                </div>
                <span className="text-[10px] text-slate-400 mt-0.5 px-1">{formatClockTime(message.created_at)}</span>
              </div>
            </div>
          );
        })}

        <AnimatePresence>
          {typingNames.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 px-1"
            >
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-slate-400"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {seenByOther && (
          <p className="text-[10px] text-slate-400 text-right px-1">Đã xem</p>
        )}
      </div>

      <Composer onSend={onSend} />
    </div>
  );
}
