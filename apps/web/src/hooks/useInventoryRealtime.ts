import { useEffect, useRef } from 'react';
import { useSocket } from '@/lib/socket';

export type InventoryEventCallback = (eventName: string, data: unknown) => void;

export interface InventoryRealtimeCallbacks {
  onStockEvent?: InventoryEventCallback;
  onPurchaseRequestEvent?: InventoryEventCallback;
  onGoodsReceiptEvent?: InventoryEventCallback;
}

const STOCK_EVENTS = ['stock:movement_created', 'stock:low', 'stock:out_of_stock', 'stock:adjusted'];
const PURCHASE_REQUEST_EVENTS = ['purchase_request:created', 'purchase_request:status_changed'];
const GOODS_RECEIPT_EVENTS = ['goods_receipt:created'];

export function useInventoryRealtime(callbacks: InventoryRealtimeCallbacks = {}) {
  const { socket } = useSocket();
  const cbRef = useRef(callbacks);

  useEffect(() => {
    cbRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    if (!socket) return;

    const handlers: Array<[string, (data: unknown) => void]> = [];

    for (const event of STOCK_EVENTS) {
      const handler = (data: unknown) => cbRef.current.onStockEvent?.(event, data);
      socket.on(event, handler);
      handlers.push([event, handler]);
    }

    for (const event of PURCHASE_REQUEST_EVENTS) {
      const handler = (data: unknown) => cbRef.current.onPurchaseRequestEvent?.(event, data);
      socket.on(event, handler);
      handlers.push([event, handler]);
    }

    for (const event of GOODS_RECEIPT_EVENTS) {
      const handler = (data: unknown) => cbRef.current.onGoodsReceiptEvent?.(event, data);
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
