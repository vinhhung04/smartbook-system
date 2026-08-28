import { useCallback, useMemo, useState } from 'react';
import type { Conversation, Message, StaffMember } from './types';
import { CURRENT_USER_ID, MOCK_CONVERSATIONS, MOCK_MESSAGES, MOCK_TYPING, STAFF_DIRECTORY } from './mock-data';

// In-memory stand-in for the messaging-service API + socket events. Shaped so the
// components only ever see `conversations` / `messagesByConversation` / actions —
// swapping this hook's body for real REST calls + useSocketEvent later won't
// require touching conversation-list.tsx / thread-pane.tsx / composer.tsx.
export function useMessaging() {
  const [conversations, setConversations] = useState<Conversation[]>(MOCK_CONVERSATIONS);
  const [messagesByConversation, setMessagesByConversation] = useState(MOCK_MESSAGES);
  const [typingByConversation] = useState(MOCK_TYPING);
  const [selectedId, setSelectedId] = useState<string | null>(MOCK_CONVERSATIONS[0]?.id ?? null);

  const staffById = useMemo(() => {
    const map = new Map<string, StaffMember>();
    STAFF_DIRECTORY.forEach((member) => map.set(member.id, member));
    return map;
  }, []);

  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [conversations],
  );

  const selectConversation = useCallback((id: string) => {
    setSelectedId(id);
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.unread_count === 0) return c;
        return {
          ...c,
          unread_count: 0,
          last_read_message_id: { ...c.last_read_message_id, [CURRENT_USER_ID]: c.last_message?.id ?? null },
        };
      }),
    );
  }, []);

  const sendMessage = useCallback((conversationId: string, content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const message: Message = {
      id: `m-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: CURRENT_USER_ID,
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] ?? []), message],
    }));
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              last_message: message,
              updated_at: message.created_at,
              last_read_message_id: { ...c.last_read_message_id, [CURRENT_USER_ID]: message.id },
            }
          : c,
      ),
    );
  }, []);

  const createConversation = useCallback(
    (memberIds: string[], name?: string) => {
      const allMembers = Array.from(new Set([CURRENT_USER_ID, ...memberIds]));
      const isDirect = allMembers.length === 2;

      if (isDirect) {
        const existing = conversations.find(
          (c) => c.type === 'DIRECT' && c.member_ids.length === 2 && allMembers.every((id) => c.member_ids.includes(id)),
        );
        if (existing) {
          setSelectedId(existing.id);
          return existing.id;
        }
      }

      const id = `c-${Date.now()}`;
      const conversation: Conversation = {
        id,
        type: isDirect ? 'DIRECT' : 'GROUP',
        name: isDirect ? null : name || 'Nhóm mới',
        member_ids: allMembers,
        last_message: null,
        unread_count: 0,
        last_read_message_id: {},
        updated_at: new Date().toISOString(),
      };
      setConversations((prev) => [conversation, ...prev]);
      setMessagesByConversation((prev) => ({ ...prev, [id]: [] }));
      setSelectedId(id);
      return id;
    },
    [conversations],
  );

  return {
    currentUserId: CURRENT_USER_ID,
    directory: STAFF_DIRECTORY,
    staffById,
    conversations: sortedConversations,
    messagesByConversation,
    typingByConversation,
    selectedId,
    selectConversation,
    sendMessage,
    createConversation,
  };
}
