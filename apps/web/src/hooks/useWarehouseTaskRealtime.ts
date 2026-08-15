import { useEffect, useRef } from 'react';
import { useSocket } from '@/lib/socket';

export type WarehouseTaskEventCallback = (eventName: string, data: unknown) => void;

export interface WarehouseTaskRealtimeCallbacks {
  onWarehouseTaskEvent?: WarehouseTaskEventCallback;
  onExceptionReportEvent?: WarehouseTaskEventCallback;
}

const WAREHOUSE_TASK_EVENTS = ['warehouse_task:assigned', 'warehouse_task:status_changed'];
const EXCEPTION_REPORT_EVENTS = ['exception_report:created', 'exception_report:resolved'];

export function useWarehouseTaskRealtime(callbacks: WarehouseTaskRealtimeCallbacks = {}) {
  const { socket } = useSocket();
  const cbRef = useRef(callbacks);

  useEffect(() => {
    cbRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    if (!socket) return;

    const handlers: Array<[string, (data: unknown) => void]> = [];

    for (const event of WAREHOUSE_TASK_EVENTS) {
      const handler = (data: unknown) => cbRef.current.onWarehouseTaskEvent?.(event, data);
      socket.on(event, handler);
      handlers.push([event, handler]);
    }

    for (const event of EXCEPTION_REPORT_EVENTS) {
      const handler = (data: unknown) => cbRef.current.onExceptionReportEvent?.(event, data);
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
