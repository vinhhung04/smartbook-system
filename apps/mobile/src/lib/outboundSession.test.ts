import AsyncStorage from '@react-native-async-storage/async-storage';
import { alreadyConfirmedInSession, closeAbandoned, createSession, getSessionById, loadSessions, saveSession } from './outboundSession';

// jest.mock calls are hoisted above the imports by babel-jest.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      store,
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
      removeItem: jest.fn(async (key: string) => { store.delete(key); }),
    },
  };
});

const store = (AsyncStorage as unknown as { store: Map<string, string> }).store;

beforeEach(() => store.clear());

describe('per-user session storage', () => {
  it('never shows one user\'s sessions to another', async () => {
    const mine = createSession('outbound');
    await saveSession('user-a', mine);
    expect((await loadSessions('user-a')).map((s) => s.id)).toEqual([mine.id]);
    expect(await loadSessions('user-b')).toEqual([]);
    expect(await getSessionById('user-b', mine.id)).toBeNull();
  });

  it('drops the old shared (unattributed) history', async () => {
    store.set('smartbook_outbound_sessions', JSON.stringify([createSession('outbound')]));
    await loadSessions('user-a');
    expect(store.has('smartbook_outbound_sessions')).toBe(false);
  });
});

describe('closeAbandoned', () => {
  it('closes sessions left open by a killed app, but not the active one', () => {
    const active = createSession('outbound');
    const abandoned = {
      ...createSession('transfer'),
      attempts: [{ code: 'X', success: true, message: 'ok', order_number: 'TO-1', timestamp: '2026-10-27T08:00:00.000Z' }],
    };
    const [a, b] = closeAbandoned([active, abandoned], active.id);
    expect(a.ended_at).toBeNull();
    expect(b).toMatchObject({ ended_at: '2026-10-27T08:00:00.000Z', interrupted: true });
  });

  it('persists the closure', async () => {
    const abandoned = createSession('outbound');
    await saveSession('user-a', abandoned);
    await loadSessions('user-a');
    const [stored] = JSON.parse(store.get('smartbook_outbound_sessions:user-a')!);
    expect(stored.interrupted).toBe(true);
  });
});

describe('alreadyConfirmedInSession', () => {
  it('detects a repeat scan of an order confirmed earlier in the session', () => {
    const session = {
      ...createSession('outbound'),
      attempts: [
        { code: 'OB-1', success: true, message: 'ok', order_number: 'OB-1', timestamp: 't' },
        { code: 'OB-2', success: false, message: 'no', order_number: 'OB-2', timestamp: 't' },
      ],
    };
    expect(alreadyConfirmedInSession(session, 'OB-1')).toBe(true);
    expect(alreadyConfirmedInSession(session, 'OB-2')).toBe(false);
  });
});
