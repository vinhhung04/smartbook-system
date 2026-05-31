import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { TOKEN_KEY } from '@/services/http-clients';

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
});

const GATEWAY_URL =
  import.meta.env.VITE_GATEWAY_BASE_URL || 'http://localhost:3000';

const isDev = import.meta.env.DEV;

export function SocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));

  // Sync token state from localStorage when auth changes (login/logout/cross-tab)
  useEffect(() => {
    const sync = () => setToken(localStorage.getItem(TOKEN_KEY));
    window.addEventListener('smartbook:auth-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('smartbook:auth-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    // Disconnect any previous socket before creating a new one
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setConnected(false);
    }

    if (!token) return;

    const socket = io(GATEWAY_URL, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (isDev) console.log('[ws] connected', socket.id);
    });

    socket.on('disconnect', (reason) => {
      setConnected(false);
      if (isDev) console.log('[ws] disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      if (isDev) console.warn('[ws] connect error:', err.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

/**
 * Subscribe to a socket event. The callback is stable across re-renders.
 */
export function useSocketEvent<T = unknown>(
  eventName: string,
  callback: (data: T) => void,
) {
  const { socket } = useSocket();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!socket) return;

    const handler = (data: T) => callbackRef.current(data);
    socket.on(eventName, handler);
    return () => {
      socket.off(eventName, handler);
    };
  }, [socket, eventName]);
}
