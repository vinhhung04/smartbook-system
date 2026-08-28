import { ROLE_META } from './role-meta';
import type { Conversation, StaffMember } from './types';

export function getConversationDisplay(
  conversation: Conversation,
  staffById: Map<string, StaffMember>,
  currentUserId: string,
) {
  const members = conversation.member_ids.map((id) => staffById.get(id)).filter((m): m is StaffMember => Boolean(m));

  if (conversation.type === 'DIRECT') {
    const other = members.find((m) => m.id !== currentUserId) ?? members[0];
    return {
      title: other?.full_name ?? 'Không rõ',
      subtitle: other ? ROLE_META[other.role].label : '',
      otherMember: other,
      members,
    };
  }

  return {
    title: conversation.name || 'Nhóm chat',
    subtitle: `${members.length} thành viên`,
    otherMember: undefined,
    members,
  };
}
