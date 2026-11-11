import AsyncStorage from '@react-native-async-storage/async-storage';

// A "phiên" is tracked entirely on-device — there is no backend concept of a scan
// session, only individual outbound/transfer order confirmations (those are the
// system's real history, kept by inventory-service). This keeps the cap + history
// feature self-contained in the mobile app without touching the shared API.
//
// Sessions are stored per signed-in user: the shared key used before let the next
// person to sign in on a shared warehouse phone read the previous user's scans.
const LEGACY_STORAGE_KEY = 'smartbook_outbound_sessions';
const keyFor = (userId: string) => `smartbook_outbound_sessions:${userId}`;
export const SESSION_SCAN_CAP = 50;
const MAX_STORED_SESSIONS = 30;

export type OutboundSessionMode = 'outbound' | 'transfer';

export type ScanAttempt = {
  code: string;
  success: boolean;
  message: string;
  order_number: string | null;
  timestamp: string;
  /** The confirm request got no answer; the order was re-checked (see outcome text). */
  uncertain?: boolean;
};

export type OutboundSession = {
  id: string;
  mode: OutboundSessionMode;
  started_at: string;
  ended_at: string | null;
  attempts: ScanAttempt[];
  /** Closed because the app was killed / the screen was left without "Kết thúc phiên". */
  interrupted?: boolean;
};

export function createSession(mode: OutboundSessionMode, now = new Date()): OutboundSession {
  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    mode,
    started_at: now.toISOString(),
    ended_at: null,
    attempts: [],
  };
}

export function successCount(session: OutboundSession): number {
  return session.attempts.filter((a) => a.success).length;
}

/** True when this exact order was already confirmed earlier in the same session. */
export function alreadyConfirmedInSession(session: OutboundSession, orderNumber: string): boolean {
  return session.attempts.some((a) => a.success && a.order_number === orderNumber);
}

/**
 * A session still open when the history is read again was never finished (app killed,
 * phone died). It cannot be resumed — its screen state is gone — so it is closed as
 * interrupted at its last known activity instead of showing "Đang thực hiện" forever.
 */
export function closeAbandoned(sessions: OutboundSession[], activeSessionId: string | null): OutboundSession[] {
  return sessions.map((session) => {
    if (session.ended_at || session.id === activeSessionId) return session;
    const lastActivity = session.attempts[session.attempts.length - 1]?.timestamp ?? session.started_at;
    return { ...session, ended_at: lastActivity, interrupted: true };
  });
}

async function readAll(userId: string): Promise<OutboundSession[]> {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(userId: string, sessions: OutboundSession[]) {
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(sessions.slice(0, MAX_STORED_SESSIONS)));
}

export async function loadSessions(userId: string, activeSessionId: string | null = null): Promise<OutboundSession[]> {
  // Unattributed sessions from before per-user storage cannot be shown to anyone safely.
  AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
  const sessions = await readAll(userId);
  const closed = closeAbandoned(sessions, activeSessionId);
  if (closed.some((session, index) => session !== sessions[index])) await writeAll(userId, closed);
  return closed;
}

export async function saveSession(userId: string, session: OutboundSession): Promise<void> {
  const sessions = await readAll(userId);
  const index = sessions.findIndex((s) => s.id === session.id);
  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.unshift(session);
  }
  await writeAll(userId, sessions);
}

export async function getSessionById(userId: string, id: string): Promise<OutboundSession | null> {
  const sessions = await loadSessions(userId);
  return sessions.find((s) => s.id === id) ?? null;
}
