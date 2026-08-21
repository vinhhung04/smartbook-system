import { useEffect, useRef } from 'react';
import { useSocket } from '@/lib/socket';

export type AIActionEventCallback = (eventName: string, data: unknown) => void;

const AI_ACTION_EVENTS = [
  'ai_action:created',
  'ai_action:confirmed',
  'ai_action:executed',
  'ai_action:failed',
  'ai_action:cancelled',
];

export function useAIActionRealtime(onEvent: AIActionEventCallback) {
  const { socket } = useSocket();
  const cbRef = useRef(onEvent);

  useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!socket) return;

    const handlers: Array<[string, (data: unknown) => void]> = [];

    for (const event of AI_ACTION_EVENTS) {
      const handler = (data: unknown) => cbRef.current(event, data);
      socket.on(event, handler);
      handlers.push([event, handler]);
    }

    return () => {
      for (const [event, handler] of handlers) {
        socket.off(event, handler);
      }
    };
  }, [socket]);
}
