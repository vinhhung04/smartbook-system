import AsyncStorage from '@react-native-async-storage/async-storage';

// A "phiên" is tracked entirely on-device — there is no backend concept of a scan
// session, only individual outbound/transfer order confirmations. This keeps the
// cap + history feature self-contained in the mobile app without touching the
// shared inventory-service API (which the web app also depends on).
const STORAGE_KEY = 'smartbook_outbound_sessions';
export const SESSION_SCAN_CAP = 50;

export type OutboundSessionMode = 'outbound' | 'transfer';

export type ScanAttempt = {
  code: string;
  success: boolean;
  message: string;
  order_number: string | null;
  timestamp: string;
};

export type OutboundSession = {
  id: string;
  mode: OutboundSessionMode;
  started_at: string;
  ended_at: string | null;
  attempts: ScanAttempt[];
};

export function createSession(mode: OutboundSessionMode): OutboundSession {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode,
    started_at: new Date().toISOString(),
    ended_at: null,
    attempts: [],
  };
}

export function successCount(session: OutboundSession): number {
  return session.attempts.filter((a) => a.success).length;
}

export async function loadSessions(): Promise<OutboundSession[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSession(session: OutboundSession): Promise<void> {
  const sessions = await loadSessions();
  const index = sessions.findIndex((s) => s.id === session.id);
  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.unshift(session);
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export async function getSessionById(id: string): Promise<OutboundSession | null> {
  const sessions = await loadSessions();
  return sessions.find((s) => s.id === id) ?? null;
}
