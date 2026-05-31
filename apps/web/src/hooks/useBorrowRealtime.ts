import { useEffect, useRef } from 'react';
import { useSocket } from '@/lib/socket';

export type BorrowEventCallback = (eventName: string, data: unknown) => void;

export interface BorrowRealtimeCallbacks {
  onLoanEvent?: BorrowEventCallback;
  onReservationEvent?: BorrowEventCallback;
  onFineEvent?: BorrowEventCallback;
}

const LOAN_EVENTS = [
  'loan:created', 'loan:status_changed', 'loan:returned',
  'loan:overdue', 'loan:renewal_requested', 'loan:renewal_reviewed',
];

const RESERVATION_EVENTS = [
  'reservation:created', 'reservation:confirmed', 'reservation:ready_for_pickup',
  'reservation:cancelled', 'reservation:expired', 'reservation:converted_to_loan',
];

const FINE_EVENTS = ['fine:created', 'fine:paid', 'fine:waived'];

export function useBorrowRealtime(callbacks: BorrowRealtimeCallbacks = {}) {
  const { socket } = useSocket();
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    if (!socket) return;

    const handlers: Array<[string, (data: unknown) => void]> = [];

    for (const event of LOAN_EVENTS) {
      const handler = (data: unknown) => cbRef.current.onLoanEvent?.(event, data);
      socket.on(event, handler);
      handlers.push([event, handler]);
    }

    for (const event of RESERVATION_EVENTS) {
      const handler = (data: unknown) => cbRef.current.onReservationEvent?.(event, data);
      socket.on(event, handler);
      handlers.push([event, handler]);
    }

    for (const event of FINE_EVENTS) {
      const handler = (data: unknown) => cbRef.current.onFineEvent?.(event, data);
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
