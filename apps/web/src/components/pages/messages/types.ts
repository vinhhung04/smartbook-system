export type StaffRole = 'ADMIN' | 'WAREHOUSE_MANAGER' | 'WAREHOUSE_STAFF' | 'LIBRARIAN';

export interface StaffMember {
  id: string;
  full_name: string;
  role: StaffRole;
  avatar_url?: string | null;
  online: boolean;
}

export type ConversationType = 'DIRECT' | 'GROUP';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  member_ids: string[];
  last_message: Message | null;
  unread_count: number;
  last_read_message_id: Record<string, string | null>;
  updated_at: string;
}
