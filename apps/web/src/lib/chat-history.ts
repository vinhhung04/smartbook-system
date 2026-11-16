// The floating chatbot's saved conversations: kept in this browser only, per
// account, newest first. Pure functions over a Storage-like object so they can
// be tested without a browser.

export interface ChatLike {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

export interface StoredConversation<M extends ChatLike> {
  id: string;
  title: string;
  updatedAt: number;
  messages: M[];
}

export interface ConversationStore<M extends ChatLike> {
  activeId: string;
  conversations: StoredConversation<M>[];
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const MAX_CONVERSATIONS = 20;
export const MAX_MESSAGES = 40;
const STORE_KEY = 'smartbook_ai_conversations:';
// The single-conversation history this replaced; read once and migrated.
const LEGACY_KEY = 'smartbook_ai_chat_history:';

export function newConversationId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function conversationTitle(messages: ChatLike[]): string {
  const first = messages.find((m) => m.role === 'user')?.text.replace(/\s+/g, ' ').trim();
  if (!first) return 'Cuộc trò chuyện';
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}

function isConversation(value: unknown): value is StoredConversation<ChatLike> {
  const c = value as StoredConversation<ChatLike>;
  return !!c && typeof c.id === 'string' && typeof c.updatedAt === 'number' && Array.isArray(c.messages);
}

export function loadStore<M extends ChatLike>(storage: StorageLike | null, userKey: string, now = Date.now()): ConversationStore<M> {
  const empty: ConversationStore<M> = { activeId: newConversationId(), conversations: [] };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(`${STORE_KEY}${userKey}`);
    if (raw) {
      const parsed = JSON.parse(raw) as ConversationStore<M>;
      const conversations = Array.isArray(parsed?.conversations) ? parsed.conversations.filter(isConversation) as StoredConversation<M>[] : [];
      return { activeId: typeof parsed?.activeId === 'string' ? parsed.activeId : empty.activeId, conversations };
    }
    const legacy = JSON.parse(storage.getItem(`${LEGACY_KEY}${userKey}`) || '[]') as M[];
    if (Array.isArray(legacy) && legacy.length > 0) {
      const id = newConversationId();
      return { activeId: id, conversations: [{ id, title: conversationTitle(legacy), updatedAt: now, messages: legacy.slice(-MAX_MESSAGES) }] };
    }
  } catch {
    // Unreadable history starts fresh rather than breaking the chat.
  }
  return empty;
}

export function saveStore<M extends ChatLike>(storage: StorageLike | null, userKey: string, store: ConversationStore<M>): void {
  if (!storage) return;
  try {
    storage.setItem(`${STORE_KEY}${userKey}`, JSON.stringify(store));
    storage.removeItem(`${LEGACY_KEY}${userKey}`);
  } catch {
    // Storage full or blocked: the chat still works for this visit.
  }
}

/** Writes the open conversation's messages; an empty one is not saved. Only new content moves it to the top. */
export function upsertActive<M extends ChatLike>(store: ConversationStore<M>, messages: M[], now = Date.now()): ConversationStore<M> {
  if (messages.length === 0) return store;
  const kept = messages.slice(-MAX_MESSAGES);
  const existing = store.conversations.find((c) => c.id === store.activeId);
  const changed = !existing
    || existing.messages.length !== kept.length
    || existing.messages[existing.messages.length - 1]?.text !== kept[kept.length - 1]?.text;
  const next: StoredConversation<M> = {
    id: store.activeId,
    title: conversationTitle(kept),
    updatedAt: changed ? now : existing!.updatedAt,
    messages: kept,
  };
  const others = store.conversations.filter((c) => c.id !== store.activeId);
  const conversations = [next, ...others].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
  return { ...store, conversations };
}

export function startConversation<M extends ChatLike>(store: ConversationStore<M>): ConversationStore<M> {
  return { ...store, activeId: newConversationId() };
}

export function removeConversation<M extends ChatLike>(store: ConversationStore<M>, id: string): ConversationStore<M> {
  const conversations = store.conversations.filter((c) => c.id !== id);
  return { activeId: id === store.activeId ? newConversationId() : store.activeId, conversations };
}

/** Puts a removed conversation back (undo), keeping the list order and cap. */
export function restoreConversation<M extends ChatLike>(store: ConversationStore<M>, conversation: StoredConversation<M>): ConversationStore<M> {
  const conversations = [conversation, ...store.conversations.filter((c) => c.id !== conversation.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
  return { ...store, conversations };
}
